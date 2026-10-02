import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { openPostgresStore } from '../database.ts';

const databaseUrl = Deno.env.get('TEST_DATABASE_URL');

Deno.test({
  name: 'Deno PostgreSQL storage migrates and preserves transactions without native SQLite',
  ignore: !databaseUrl,
  async fn() {
    assert.ok(databaseUrl, 'TEST_DATABASE_URL must name a disposable database');
    const schema = `riftwell_deno_${randomUUID().replaceAll('-', '')}`;
    const admin = postgres(databaseUrl, {
      max: 1,
      connect_timeout: 5,
      onnotice: () => {},
    });
    const stores = [];
    let created = false;
    try {
      await admin.unsafe(`CREATE SCHEMA "${schema}"`);
      created = true;
      const url = new URL(databaseUrl);
      url.searchParams.set(
        'options',
        `${url.searchParams.get('options') ?? ''} -c search_path=${schema}`.trim(),
      );
      const opened = await Promise.allSettled([
        openPostgresStore(url.toString(), 2),
        openPostgresStore(url.toString(), 2),
      ]);
      for (const result of opened)
        if (result.status === 'fulfilled') stores.push(result.value);
      for (const result of opened)
        if (result.status === 'rejected') throw result.reason;
      assert.equal(stores.length, 2);
      const [first, second] = stores;
      assert.equal(first.dialect, 'postgres');
      assert.equal(first.sqlite, undefined);
      assert.deepEqual(await first.get('SELECT version FROM riftwell_schema'), {
        version: 2,
      });
      assert.equal(
        (
          await first.run(
            'CREATE TABLE deno_probe (id TEXT PRIMARY KEY, amount BIGINT NOT NULL, optional BIGINT, detail TEXT NOT NULL)',
          )
        ).changes,
        0,
      );
      await first.transaction(async () => {
        await first.run(
          'INSERT INTO deno_probe(id,amount,optional,detail) VALUES (?,?,?,?)',
          'committed',
          Number.MAX_SAFE_INTEGER,
          null,
          "question? and apostrophe's sign",
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
        assert.equal(
          await second.get(
            'SELECT * FROM deno_probe WHERE id = ?',
            'committed',
          ),
          undefined,
        );
        await assert.rejects(
          first.transaction(async () => {
            await first.run(
              'INSERT INTO deno_probe VALUES (?,?,?,?)',
              'inner',
              1,
              null,
              'rollback',
            );
            await Promise.resolve();
            throw new Error('inner rollback');
          }),
          /inner rollback/,
        );
        assert.equal(
          await first.get('SELECT * FROM deno_probe WHERE id = ?', 'inner'),
          undefined,
        );
      });
      assert.deepEqual(
        await second.get('SELECT * FROM deno_probe WHERE id = ?', 'committed'),
        {
          id: 'committed',
          amount: Number.MAX_SAFE_INTEGER,
          optional: null,
          detail: "question? and apostrophe's sign",
        },
      );
      await assert.rejects(
        first.transaction(async () => {
          await first.run(
            'INSERT INTO deno_probe VALUES (?,?,?,?)',
            'outer',
            2,
            null,
            'rollback',
          );
          await Promise.resolve();
          throw new Error('outer rollback');
        }),
        /outer rollback/,
      );
      assert.equal(
        await second.get('SELECT * FROM deno_probe WHERE id = ?', 'outer'),
        undefined,
      );
      assert.deepEqual(
        await second.get(
          "SELECT ?::text AS bound, '?'::text AS literal",
          "a?'b",
        ),
        {
          bound: "a?'b",
          literal: '?',
        },
      );
      assert.deepEqual(
        await second.get('SELECT count(*) AS n FROM deno_probe'),
        { n: 1 },
      );
    } finally {
      try {
        await Promise.all(stores.map((store) => store.close()));
      } finally {
        try {
          if (created) await admin.unsafe(`DROP SCHEMA "${schema}" CASCADE`);
        } finally {
          await admin.end({ timeout: 5 });
        }
      }
    }
  },
});
