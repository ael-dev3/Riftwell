import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import {
  access,
  lstat,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import postgres from 'postgres';
import { openPostgresStore } from '../database.ts';
import {
  backupChildEnvironment,
  backupPostgres,
  parseBackupConnection,
} from '../postgres-backup.ts';

const url =
  'postgresql://backup_user:p%3Aass%5Cword@db.example:5433/riftwell?sslmode=require';

test('backup connection verifies remote TLS and rejects libpq overrides', () => {
  const connection = parseBackupConnection(url);
  assert.equal(connection.password, 'p:ass\\word');
  assert.equal(connection.database, 'riftwell');
  assert.equal(connection.port, 5433);
  assert.equal(connection.tls, true);
  for (const value of [
    'not-a-url',
    url.replace('postgresql:', 'https:'),
    url.replace('sslmode=require', 'sslmode=disable'),
    url.replace('sslmode=require', 'options=-c%20search_path=other'),
    url + '&sslmode=verify-full',
    url.replace('backup_user', '*'),
    url.replace('p%3Aass%5Cword', '%0Aprivate-password'),
    url.replace('/riftwell', '/'),
    url + '#secret',
  ]) {
    assert.throws(
      () => parseBackupConnection(value),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(
          error.message,
          'Backup requires a valid named PostgreSQL connection',
        );
        assert.ok(!error.message.includes('password'));
        return true;
      },
    );
  }
  assert.equal(
    parseBackupConnection(url.replace('/riftwell', '/'), 'riftwell').database,
    'riftwell',
  );
  assert.equal(parseBackupConnection('postgres://u:p@[::1]/test').host, '::1');
  assert.equal(
    parseBackupConnection('postgres://u:p@localhost/test').tls,
    false,
  );
  assert.equal(
    parseBackupConnection('postgres://u:p@localhost/test?sslmode=require').tls,
    true,
  );
});

test('native utilities receive no URL, password, app secret or inherited libpq override', () => {
  const env = backupChildEnvironment(
    parseBackupConnection(url),
    '/private/backup/.pgpass',
    undefined,
    {
      PATH: '/safe/bin',
      DATABASE_URL: url,
      PGPASSWORD: 'unexpected-password',
      PGOPTIONS: '-c search_path=bad',
      PGSSLMODE: 'disable',
      SESSION_SECRET: 'session-private',
      HOME: '/unused/home',
    },
  );
  assert.equal(env.PGSSLMODE, 'verify-full');
  assert.equal(env.PGSSLROOTCERT, 'system');
  assert.equal(env.PGPASSFILE, '/private/backup/.pgpass');
  assert.equal(env.PGHOST, 'db.example');
  assert.equal(env.PGPORT, '5433');
  assert.equal(env.PATH, '/safe/bin');
  for (const key of [
    'DATABASE_URL',
    'PGPASSWORD',
    'PGOPTIONS',
    'SESSION_SECRET',
    'HOME',
  ])
    assert.equal(env[key], undefined);
  assert.ok(!JSON.stringify(env).includes('p:ass'));
});

test('validation and native utility failures disclose no connection details', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'riftwell-backup-invalid-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const options of [
    { outputDirectory: 'relative-path' },
    { outputDirectory: join(directory, 'backup'), clientBin: 'relative-bin' },
    {
      outputDirectory: join(directory, 'backup'),
      clientBin: join(directory, 'missing-bin'),
    },
  ]) {
    await assert.rejects(
      backupPostgres({ databaseUrl: url, ...options }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(
          error.message,
          'PostgreSQL backup failed during input validation; no connection details were logged',
        );
        assert.ok(!error.message.includes('db.example'));
        return true;
      },
    );
  }
  assert.deepEqual(await readdir(directory), []);
});

test(
  'cancelled native utility is reaped even when it ignores SIGTERM',
  {
    timeout: 10_000,
  },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'riftwell-backup-cancel-'));
    const marker = join(directory, 'child.pid');
    let pid: number | undefined;
    t.after(async () => {
      if (pid) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // Successful cancellation already reaped the fixture.
        }
      }
      await rm(directory, { recursive: true, force: true });
    });
    await writeFile(
      join(directory, 'pg_dump'),
      `#!${process.execPath}
import { writeFileSync } from 'node:fs';
process.on('SIGTERM', () => writeFileSync(${JSON.stringify(marker + '.sigterm')}, 'received', { mode: 0o600 }));
writeFileSync(${JSON.stringify(marker)}, String(process.pid), { mode: 0o600 });
setInterval(() => {}, 1000);
`,
      { mode: 0o700 },
    );
    const controller = new AbortController();
    const completion = assert.rejects(
      backupPostgres({
        databaseUrl: 'postgres://fixture:unused@127.0.0.1/unused',
        outputDirectory: join(directory, 'backup'),
        clientBin: directory,
        signal: controller.signal,
      }),
      /input validation/,
    );
    const deadline = Date.now() + 3000;
    while (!pid && Date.now() < deadline) {
      try {
        pid = Number(await readFile(marker, 'utf8'));
      } catch {
        await delay(20);
      }
    }
    assert.ok(
      pid && Number.isInteger(pid),
      'Fixture must be running before abort',
    );
    controller.abort();
    await completion;
    assert.equal(await readFile(marker + '.sigterm', 'utf8'), 'received');
    assert.throws(() => process.kill(pid!, 0), { code: 'ESRCH' });
    pid = undefined;
    await assert.rejects(access(join(directory, 'backup')));
  },
);

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const clientBin = process.env.PG_CLIENT_BIN;
test(
  'native dump uses a consistent snapshot, private files and cleans credentials on success and failure',
  {
    skip:
      testDatabaseUrl && clientBin
        ? false
        : 'Requires a disposable local TEST_DATABASE_URL and absolute PG_CLIENT_BIN.',
    timeout: 60_000,
  },
  async (t) => {
    assert.ok(testDatabaseUrl && clientBin);
    const source = parseBackupConnection(testDatabaseUrl);
    assert.equal(
      source.local,
      true,
      'Backup integration may only use a loopback test database',
    );
    const database = `riftwell_backup_test_${randomUUID().replaceAll('-', '')}`;
    const admin = postgres(testDatabaseUrl, { max: 1, onnotice: () => {} });
    const directory = await mkdtemp(join(tmpdir(), 'riftwell-native-backup-'));
    let databaseCreated = false;
    t.after(async () => {
      try {
        if (databaseCreated)
          await admin.unsafe(`DROP DATABASE ${database} WITH (FORCE)`);
      } finally {
        await admin.end({ timeout: 5 });
        await rm(directory, { recursive: true, force: true });
      }
    });
    await admin.unsafe(`CREATE DATABASE ${database}`);
    databaseCreated = true;
    const connection = new URL(testDatabaseUrl);
    connection.pathname = `/${database}`;
    const db = await openPostgresStore(connection.toString(), 1);
    try {
      await db.run(
        'INSERT INTO audit_events(created_at, actor, event, entity_type, entity_id, detail_json) VALUES (?, ?, ?, ?, ?, ?)',
        1,
        'synthetic-owner',
        'test',
        'test',
        'fixture',
        '{}',
      );
    } finally {
      await db.close();
    }
    const outputDirectory = join(directory, 'snapshot');
    const result = await backupPostgres({
      databaseUrl: connection.toString(),
      outputDirectory,
      clientBin,
    });
    assert.equal(result.schemaVersion, 2);
    assert.equal(result.tableCounts.audit_events, '1');
    assert.equal(result.tableCounts.riftwell_schema, '1');
    assert.equal(result.tableCounts.sessions, '0');
    assert.match(result.dumpVersion, /^pg_dump \(PostgreSQL\)/);
    assert.match(result.serverVersion, /^\d+$/);
    assert.deepEqual(await readdir(outputDirectory), [
      'manifest.json',
      'riftwell.pgdump',
    ]);
    assert.equal((await lstat(outputDirectory)).mode & 0o777, 0o700);
    const archive = await readFile(join(outputDirectory, 'riftwell.pgdump'));
    assert.equal(archive.subarray(0, 5).toString(), 'PGDMP');
    assert.equal(
      result.archiveSha256,
      createHash('sha256').update(archive).digest('hex'),
    );
    assert.equal(result.archiveBytes, archive.length);
    for (const name of ['manifest.json', 'riftwell.pgdump'])
      assert.equal(
        (await lstat(join(outputDirectory, name))).mode & 0o777,
        0o600,
      );
    assert.deepEqual(
      JSON.parse(
        await readFile(join(outputDirectory, 'manifest.json'), 'utf8'),
      ),
      result,
    );
    await assert.rejects(
      backupPostgres({
        databaseUrl: connection.toString(),
        outputDirectory,
        clientBin,
      }),
      /private destination creation/,
    );
    assert.equal(
      createHash('sha256')
        .update(await readFile(join(outputDirectory, 'riftwell.pgdump')))
        .digest('hex'),
      result.archiveSha256,
    );
    const failureDirectory = join(directory, 'failed');
    const missingDatabase = new URL(connection);
    missingDatabase.pathname = '/nonexistent_riftwell_backup_database';
    await assert.rejects(
      backupPostgres({
        databaseUrl: missingDatabase.toString(),
        outputDirectory: failureDirectory,
        clientBin,
      }),
      /consistent read-only snapshot/,
    );
    assert.deepEqual(await readdir(failureDirectory), []);
    await assert.rejects(access(join(failureDirectory, '.pgpass')));
    // Existing symlinks/directories are rejected rather than followed or replaced.
    const occupied = join(directory, 'occupied');
    await writeFile(occupied, 'keep this existing file', { mode: 0o600 });
    await assert.rejects(
      backupPostgres({
        databaseUrl: connection.toString(),
        outputDirectory: occupied,
        clientBin,
      }),
      /private destination creation/,
    );
    assert.equal(await readFile(occupied, 'utf8'), 'keep this existing file');
  },
);
