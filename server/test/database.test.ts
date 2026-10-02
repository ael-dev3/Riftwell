import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { loadConfig } from '../config.ts';
import { openStore } from '../database.ts';
import type { Store } from '../types.ts';

interface Probe {
  id: number;
  value: string;
}

async function fixture(t: TestContext, count = 1) {
  const directory = await mkdtemp(join(tmpdir(), 'riftwell-database-'));
  const config = loadConfig({
    NODE_ENV: 'test',
    DB_PATH: join(directory, 'state.sqlite'),
    DIST_PATH: join(directory, 'dist'),
  });
  const stores: Store[] = [];
  t.after(async () => {
    try {
      await Promise.all(stores.map((store) => store.close()));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  for (let index = 0; index < count; index++)
    stores.push(await openStore(config));
  for (const store of stores) assert.equal(store.dialect, 'sqlite');
  await stores[0]!.run(
    'CREATE TABLE transaction_probe (id INTEGER PRIMARY KEY, value TEXT NOT NULL)',
  );
  return { stores, config };
}

function signal() {
  let open: () => void = () => assert.fail('Signal not initialized');
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

test('SQLite adapter commits writes across awaits and retains them after reopening', async (t) => {
  const f = await fixture(t);
  const store = f.stores[0]!;
  const result = await store.transaction(async () => {
    assert.deepEqual(
      await store.run(
        'INSERT INTO transaction_probe(id, value) VALUES (?, ?)',
        1,
        'first',
      ),
      { changes: 1 },
    );
    await nextTurn();
    await store.run(
      'INSERT INTO transaction_probe(id, value) VALUES (?, ?)',
      2,
      'second',
    );
    assert.deepEqual(
      await store.get<Probe>('SELECT * FROM transaction_probe WHERE id = ?', 1),
      { id: 1, value: 'first' },
    );
    return store.all<Probe>('SELECT * FROM transaction_probe ORDER BY id');
  });
  assert.deepEqual(result, [
    { id: 1, value: 'first' },
    { id: 2, value: 'second' },
  ]);
  await store.close();
  const reopened = await openStore(f.config);
  f.stores.push(reopened);
  assert.deepEqual(
    await reopened.all<Probe>('SELECT * FROM transaction_probe ORDER BY id'),
    result,
  );
});

test('SQLite adapter rolls back awaited nested writes and accepts a subsequent transaction', async (t) => {
  const { stores } = await fixture(t);
  const store = stores[0]!;
  await assert.rejects(
    store.transaction(async () => {
      await store.run(
        'INSERT INTO transaction_probe(id, value) VALUES (?, ?)',
        1,
        'outer',
      );
      await nextTurn();
      await store.transaction(async () => {
        await store.run(
          'INSERT INTO transaction_probe(id, value) VALUES (?, ?)',
          2,
          'inner',
        );
        await nextTurn();
      });
      throw new Error('rollback requested');
    }),
    /rollback requested/,
  );
  assert.deepEqual(
    await store.all<Probe>('SELECT * FROM transaction_probe'),
    [],
  );
  await store.transaction(async () => {
    await store.run(
      'INSERT INTO transaction_probe(id, value) VALUES (?, ?)',
      3,
      'recovered',
    );
  });
  assert.deepEqual(
    await store.get<Probe>('SELECT * FROM transaction_probe WHERE id = ?', 3),
    {
      id: 3,
      value: 'recovered',
    },
  );
});

test('SQLite nested savepoints roll back a caught inner exception while the outer transaction commits', async (t) => {
  const { stores } = await fixture(t);
  const store = stores[0]!;
  await store.transaction(async () => {
    await store.run(
      'INSERT INTO transaction_probe(id, value) VALUES (?, ?)',
      1,
      'before',
    );
    await assert.rejects(
      store.transaction(async () => {
        await store.run(
          'INSERT INTO transaction_probe(id, value) VALUES (?, ?)',
          2,
          'discarded',
        );
        await nextTurn();
        throw new Error('inner rollback');
      }),
      /inner rollback/,
    );
    assert.equal(
      await store.get<Probe>('SELECT * FROM transaction_probe WHERE id = ?', 2),
      undefined,
    );
    await store.run(
      'INSERT INTO transaction_probe(id, value) VALUES (?, ?)',
      3,
      'after',
    );
  });
  assert.deepEqual(
    await store.all<Probe>('SELECT * FROM transaction_probe ORDER BY id'),
    [
      { id: 1, value: 'before' },
      { id: 3, value: 'after' },
    ],
  );
});

test(
  'SQLite stores sharing one filename queue awaited transactions without blocking the event loop',
  { timeout: 10_000 },
  async (t) => {
    const { stores } = await fixture(t, 2);
    const entered = signal();
    const release = signal();
    const first = stores[0]!.transaction(async () => {
      await stores[0]!.run(
        'INSERT INTO transaction_probe(id, value) VALUES (?, ?)',
        1,
        'pending',
      );
      entered.open();
      await release.promise;
      await stores[0]!.run(
        'UPDATE transaction_probe SET value = ? WHERE id = ?',
        'committed',
        1,
      );
      return 'first';
    });
    await entered.promise;
    let secondEntered = false;
    let secondSettled = false;
    const second = stores[1]!.transaction(async () => {
      secondEntered = true;
      assert.deepEqual(
        await stores[1]!.get<Probe>(
          'SELECT * FROM transaction_probe WHERE id = ?',
          1,
        ),
        {
          id: 1,
          value: 'committed',
        },
      );
      await stores[1]!.run(
        'INSERT INTO transaction_probe(id, value) VALUES (?, ?)',
        2,
        'second',
      );
      await nextTurn();
      return 'second';
    });
    const observedSecond = second.then(
      (value) => {
        secondSettled = true;
        return { value };
      },
      (error: unknown) => {
        secondSettled = true;
        return { error };
      },
    );
    try {
      // A synchronous SQLite BEGIN on the second connection would block this turn
      // until SQLITE_BUSY, and the second promise would already be rejected.
      await nextTurn();
      assert.equal(secondEntered, false);
      assert.equal(secondSettled, false);
    } finally {
      release.open();
    }
    assert.equal(await first, 'first');
    const result = await observedSecond;
    if ('error' in result) throw result.error;
    assert.equal(result.value, 'second');
    assert.deepEqual(
      await stores[0]!.all<Probe>(
        'SELECT * FROM transaction_probe ORDER BY id',
      ),
      [
        { id: 1, value: 'committed' },
        { id: 2, value: 'second' },
      ],
    );
  },
);

const productionPostgres: NodeJS.ProcessEnv = {
  NODE_ENV: 'production',
  APP_ORIGIN: 'https://riftwell.example',
  SESSION_SECRET: 's'.repeat(64),
  HYPEREVM_RPC_URL: 'https://rpc.example.invalid',
  DATABASE_URL:
    'postgresql://riftwell:test-password@db.example.invalid:5432/riftwell?sslmode=require',
};

test('configuration accepts a production PostgreSQL URL and bounds its connection pool', () => {
  const config = loadConfig(productionPostgres);
  assert.equal(config.production, true);
  assert.equal(config.databaseUrl, productionPostgres.DATABASE_URL);
  assert.equal(config.databasePoolSize, 3);
  for (const size of ['1', '10'])
    assert.equal(
      loadConfig({ ...productionPostgres, DATABASE_POOL_SIZE: size })
        .databasePoolSize,
      Number(size),
    );
  for (const size of ['0', '11', '-1', '1.5', '01', 'unbounded'])
    assert.throws(
      () => loadConfig({ ...productionPostgres, DATABASE_POOL_SIZE: size }),
      /DATABASE_POOL_SIZE/,
    );
});

test('configuration rejects conflicting storage and malformed or insecure production PostgreSQL URLs', () => {
  assert.throws(
    () =>
      loadConfig({ ...productionPostgres, DB_PATH: '/data/riftwell.sqlite' }),
    /DATABASE_URL or DB_PATH, never both/,
  );
  for (const databaseUrl of [
    'https://riftwell:test-password@db.example.invalid/riftwell',
    'postgresql://riftwell:test-password@db.example.invalid/',
    'postgresql://riftwell:test-password@db.example.invalid',
    'postgresql://db.example.invalid/riftwell',
    'postgresql://riftwell@db.example.invalid/riftwell?sslmode=require',
    'postgresql://riftwell:test-password@db.example.invalid/riftwell?sslmode=disable',
  ])
    assert.throws(
      () => loadConfig({ ...productionPostgres, DATABASE_URL: databaseUrl }),
      /DATABASE_URL must be a PostgreSQL connection URL/,
    );
});
