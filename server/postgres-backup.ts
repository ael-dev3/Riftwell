import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const tables = [
  'riftwell_schema',
  'challenges',
  'sessions',
  'listings',
  'loan_requests',
  'offers',
  'idempotency',
  'audit_events',
  'rate_limits',
] as const;

export interface BackupConnection {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  local: boolean;
  tls: boolean;
}

export interface PostgresBackupOptions {
  databaseUrl: string;
  outputDirectory: string;
  databaseName?: string;
  clientBin?: string;
  caFile?: string;
  signal?: AbortSignal;
}

export interface PostgresBackupManifest {
  formatVersion: 1;
  archive: 'riftwell.pgdump';
  archiveFormat: 'postgres-custom';
  archiveBytes: number;
  archiveSha256: string;
  createdAt: string;
  schemaVersion: 2;
  serverVersion: string;
  dumpVersion: string;
  tableCounts: Record<(typeof tables)[number], string>;
  limitation: string;
}

export function parseBackupConnection(
  input: string,
  databaseName?: string,
): BackupConnection {
  try {
    const url = new URL(input);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    const database = decodeURIComponent(url.pathname.slice(1)) || databaseName;
    const user = decodeURIComponent(url.username);
    const password = decodeURIComponent(url.password);
    const port = Number(url.port || '5432');
    const query = [...url.searchParams];
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !url.hostname ||
      url.hash ||
      !database ||
      !user ||
      !password ||
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65535 ||
      [url.hostname, user, database].some((value) => /[\r\n\0*]/.test(value)) ||
      /[\r\n\0]/.test(password) ||
      query.length > 1 ||
      query.some(
        ([key, value]) =>
          key !== 'sslmode' ||
          !['require', 'verify-full', ...(local ? ['disable'] : [])].includes(
            value,
          ),
      )
    )
      throw new Error();
    return {
      host: url.hostname.replace(/^\[|\]$/g, ''),
      port,
      user,
      password,
      database,
      local,
      tls:
        !local ||
        ['require', 'verify-full'].includes(
          url.searchParams.get('sslmode') ?? '',
        ),
    };
  } catch {
    throw new Error('Backup requires a valid named PostgreSQL connection');
  }
}

export function backupChildEnvironment(
  connection: BackupConnection,
  passFile: string,
  caFile?: string,
  environment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  // Do not forward DATABASE_URL, inherited libpq settings or application secrets.
  const env: NodeJS.ProcessEnv = {};
  for (const key of ['PATH', 'SystemRoot', 'TMPDIR'])
    if (environment[key]) env[key] = environment[key];
  return {
    ...env,
    PGHOST: connection.host,
    PGPORT: String(connection.port),
    PGUSER: connection.user,
    PGDATABASE: connection.database,
    PGPASSFILE: passFile,
    PGCONNECT_TIMEOUT: '15',
    PGSSLMODE: connection.tls ? 'verify-full' : 'disable',
    ...(connection.tls ? { PGSSLROOTCERT: caFile ?? 'system' } : {}),
  };
}

function utility(
  binary: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  signal?: AbortSignal,
): Promise<string> {
  return new Promise((done, reject) => {
    if (signal?.aborted) {
      reject(new Error('PostgreSQL utility failed'));
      return;
    }
    const child = spawn(binary, args, {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let failed = false;
    let settled = false;
    let forcedKill: NodeJS.Timeout | undefined;
    const terminate = () => {
      failed = true;
      child.kill('SIGTERM');
      forcedKill ??= setTimeout(() => child.kill('SIGKILL'), 2000);
      forcedKill.unref();
    };
    const timeout = setTimeout(terminate, 20 * 60 * 1000);
    timeout.unref();
    signal?.addEventListener('abort', terminate, { once: true });
    if (signal?.aborted) terminate();
    const settle = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearTimeout(forcedKill);
      signal?.removeEventListener('abort', terminate);
      !failed && code === 0
        ? done(output.trim())
        : reject(new Error('PostgreSQL utility failed'));
    };
    let output = '';
    // Capture only the small version response. Never print utility diagnostics.
    child.stdout.on('data', (chunk: Buffer) => {
      if (output.length < 1024) output += chunk.toString().slice(0, 1024);
    });
    child.stderr.resume();
    child.once('error', () => {
      failed = true;
      // A failed spawn has no child to reap. Otherwise cleanup must await close,
      // including when a process ignores the graceful termination signal.
      if (child.pid === undefined) settle(null);
      else terminate();
    });
    child.once('close', settle);
  });
}

export async function backupPostgres(
  options: PostgresBackupOptions,
): Promise<PostgresBackupManifest> {
  let stage = 'input validation';
  let sql: postgres.Sql | undefined;
  let passFile: string | undefined;
  let archive: string | undefined;
  let archiveCreated = false;
  try {
    const connection = parseBackupConnection(
      options.databaseUrl,
      options.databaseName,
    );
    if (
      !isAbsolute(options.outputDirectory) ||
      options.outputDirectory.includes('\0') ||
      (options.clientBin && !isAbsolute(options.clientBin)) ||
      (options.caFile && !isAbsolute(options.caFile))
    )
      throw new Error();
    let ca: string | undefined;
    if (options.caFile) {
      if (!(await lstat(options.caFile)).isFile()) throw new Error();
      ca = await readFile(options.caFile, 'utf8');
    }
    options.signal?.throwIfAborted();
    const binary = options.clientBin
      ? join(options.clientBin, 'pg_dump')
      : 'pg_dump';
    const cleanEnv = backupChildEnvironment(connection, '', options.caFile);
    const dumpVersion = await utility(
      binary,
      ['--version'],
      cleanEnv,
      options.signal,
    );
    if (!/^pg_dump \(PostgreSQL\) [^\r\n]+$/.test(dumpVersion))
      throw new Error();
    stage = 'private destination creation';
    // A new directory is mandatory, including for retries. Existing files are never overwritten.
    await mkdir(options.outputDirectory, { mode: 0o700 });
    await chmod(options.outputDirectory, 0o700);
    passFile = join(options.outputDirectory, '.pgpass');
    const escape = (value: string) =>
      value.replaceAll('\\', '\\\\').replaceAll(':', '\\:');
    await writeFile(
      passFile,
      [
        connection.host,
        String(connection.port),
        connection.database,
        connection.user,
        connection.password,
      ]
        .map(escape)
        .join(':') + '\n',
      { mode: 0o600, flag: 'wx' },
    );
    archive = join(options.outputDirectory, 'riftwell.pgdump');
    await (await open(archive, 'wx', 0o600)).close();
    archiveCreated = true;
    sql = postgres({
      host: connection.host,
      port: connection.port,
      username: connection.user,
      password: connection.password,
      database: connection.database,
      max: 1,
      prepare: false,
      connect_timeout: 15,
      ssl: connection.tls
        ? { rejectUnauthorized: true, ...(ca ? { ca } : {}) }
        : false,
      onnotice: () => {},
    });
    stage = 'consistent read-only snapshot and native dump';
    const snapshot = await sql.begin(
      'isolation level repeatable read read only',
      async (transaction) => {
        const versions = await transaction<
          { version: number }[]
        >`SELECT version FROM public.riftwell_schema`;
        if (versions.length !== 1 || versions[0]?.version !== 2)
          throw new Error();
        const [exported] = await transaction<
          { snapshot: string; serverVersion: string }[]
        >`
        SELECT pg_export_snapshot() AS snapshot, current_setting('server_version_num') AS "serverVersion"`;
        if (!exported || !/^\d+$/.test(exported.serverVersion))
          throw new Error();
        const tableCounts = {} as PostgresBackupManifest['tableCounts'];
        for (const table of tables) {
          const [row] = await transaction.unsafe<{ count: string }[]>(
            `SELECT count(*)::text AS count FROM public.${table}`,
          );
          if (!row || !/^\d+$/.test(row.count)) throw new Error();
          tableCounts[table] = row.count;
        }
        await utility(
          binary,
          [
            '--format=custom',
            '--no-acl',
            '--no-password',
            '--snapshot',
            exported.snapshot,
            '--file',
            archive!,
          ],
          backupChildEnvironment(connection, passFile!, options.caFile),
          options.signal,
        );
        return { tableCounts, serverVersion: exported.serverVersion };
      },
    );
    await sql.end({ timeout: 5 });
    sql = undefined;
    await unlink(passFile);
    passFile = undefined;
    stage = 'archive checksum and completion manifest';
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(archive)) hash.update(chunk);
    const metadata = await lstat(archive);
    if (
      !metadata.isFile() ||
      metadata.size === 0 ||
      (metadata.mode & 0o777) !== 0o600
    )
      throw new Error();
    const manifest: PostgresBackupManifest = {
      formatVersion: 1,
      archive: 'riftwell.pgdump',
      archiveFormat: 'postgres-custom',
      archiveBytes: metadata.size,
      archiveSha256: hash.digest('hex'),
      createdAt: new Date().toISOString(),
      schemaVersion: 2,
      dumpVersion,
      ...snapshot,
      limitation:
        'Manual logical snapshot; restore, retention and point-in-time recovery require separate verification.',
    };
    await writeFile(
      join(options.outputDirectory, 'manifest.json'),
      JSON.stringify(manifest, null, 2) + '\n',
      { mode: 0o600, flag: 'wx' },
    );
    return manifest;
  } catch {
    if (archive && archiveCreated) await unlink(archive).catch(() => {});
    throw new Error(
      `PostgreSQL backup failed during ${stage}; no connection details were logged`,
    );
  } finally {
    await sql?.end({ timeout: 5 }).catch(() => {});
    if (passFile) {
      try {
        await unlink(passFile);
      } catch {
        throw new Error(
          'PostgreSQL backup credential cleanup failed; inspect the protected destination',
        );
      }
    }
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [outputDirectory, ...extra] = process.argv.slice(2);
  if (!outputDirectory || extra.length || !process.env.DATABASE_URL) {
    console.error(
      'Usage: DATABASE_URL set in the environment; npm run backup:postgres -- /absolute/new-backup-directory',
    );
    process.exitCode = 2;
  } else {
    const controller = new AbortController();
    const interrupt = () => controller.abort();
    process.once('SIGINT', interrupt);
    process.once('SIGTERM', interrupt);
    try {
      await backupPostgres({
        databaseUrl: process.env.DATABASE_URL,
        outputDirectory,
        databaseName: process.env.PGDATABASE,
        clientBin: process.env.PG_CLIENT_BIN,
        caFile: process.env.RIFTWELL_BACKUP_CA_FILE,
        signal: controller.signal,
      });
      console.log(
        'PostgreSQL backup completed; private archive and checksum manifest written.',
      );
    } catch (error) {
      console.error(
        error instanceof Error ? error.message : 'PostgreSQL backup failed',
      );
      process.exitCode = 1;
    } finally {
      process.removeListener('SIGINT', interrupt);
      process.removeListener('SIGTERM', interrupt);
    }
  }
}
