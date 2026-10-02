import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import postgres from 'postgres';
import { ApiError } from '../errors.ts';
import { openStore } from '../database.ts';
import { PersistentRateLimiter } from '../rate-limit.ts';
import { loadConfig } from '../config.ts';
import { createApp } from '../app.ts';
import type { App, ChainAdapter, Store } from '../types.ts';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integration = {
  skip: testDatabaseUrl
    ? false
    : 'Requires TEST_DATABASE_URL pointing to a disposable PostgreSQL database.',
  timeout: 30000,
};
const origin = 'https://riftwell-ael.web.app';
const secret = '9'.repeat(64);
const hash = (value: string) =>
  createHmac('sha256', secret).update(value).digest('hex');

async function fixture(t: TestContext) {
  assert.ok(testDatabaseUrl);
  const directory = await mkdtemp(join(tmpdir(), 'riftwell-rate-limit-'));
  const schema = `riftwell_test_${randomUUID().replaceAll('-', '')}`;
  const admin = postgres(testDatabaseUrl, {
    max: 1,
    connect_timeout: 5,
    onnotice() {},
  });
  const stores: Store[] = [];
  const apps: App[] = [];
  let schemaCreated = false;
  let time = Date.parse('2030-01-01T00:00:00Z');
  t.after(async () => {
    try {
      await Promise.all(apps.map((app) => app.close()));
      await Promise.all(stores.map((store) => store.close()));
    } finally {
      try {
        if (schemaCreated)
          await admin.unsafe(`DROP SCHEMA "${schema}" CASCADE`);
      } finally {
        await admin.end({ timeout: 5 });
        await rm(directory, { recursive: true, force: true });
      }
    }
  });
  await admin.unsafe(`CREATE SCHEMA "${schema}"`);
  schemaCreated = true;
  const url = new URL(testDatabaseUrl);
  url.searchParams.set(
    'options',
    `${url.searchParams.get('options') ?? ''} -c search_path=${schema}`.trim(),
  );
  const config = loadConfig({
    NODE_ENV: 'test',
    APP_ORIGIN: origin,
    DATABASE_URL: url.toString(),
    SESSION_SECRET: secret,
    SESSION_TRANSPORT: 'bearer',
    API_ONLY: 'true',
    DIST_PATH: join(directory, 'dist'),
  });
  const now = () => time;
  return {
    now,
    advance(milliseconds: number) {
      time += milliseconds;
    },
    async open() {
      const store = await openStore(config);
      stores.push(store);
      return store;
    },
    async app() {
      const chain: ChainAdapter = {
        async getPosition() {
          throw Object.assign(new Error('Missing'), {
            code: 'POSITION_NOT_FOUND',
          });
        },
        async getOwnedPositions() {
          return { items: [], nextCursor: null };
        },
        async health() {
          return { ready: true, available: true, chainId: 999 };
        },
      };
      const app = await createApp({ config, chain, now });
      apps.push(app);
      return app;
    },
  };
}

function limited(error: unknown) {
  return (
    error instanceof ApiError &&
    error.status === 429 &&
    error.code === 'RATE_LIMITED'
  );
}

test(
  'PostgreSQL limiter enforces a single quota across concurrent instances and cold starts',
  integration,
  async (t) => {
    const f = await fixture(t);
    const first = await f.open();
    const second = await f.open();
    const controls = [first, second].map(
      (store) => new PersistentRateLimiter(store, f.now, hash),
    );
    const key = 'auth:203.0.113.27';
    const outcomes = await Promise.allSettled(
      Array.from({ length: 24 }, (_, i) => controls[i % 2].take(key, 3, 60000)),
    );
    assert.equal(
      outcomes.filter((outcome) => outcome.status === 'fulfilled').length,
      3,
    );
    const rejected = outcomes.filter(
      (outcome): outcome is PromiseRejectedResult =>
        outcome.status === 'rejected',
    );
    assert.equal(rejected.length, 21);
    assert.ok(rejected.every((outcome) => limited(outcome.reason)));
    const row = await first.get<{ key: string; count: number; until: number }>(
      'SELECT key,count,until FROM rate_limits',
    );
    assert.ok(row);
    assert.equal(row.key, hash(`rate-limit:${key}`));
    assert.match(row.key, /^[0-9a-f]{64}$/);
    assert.ok(!row.key.includes('203.0.113.27'));
    assert.equal(
      row.count,
      4,
      'Rejected requests must saturate the counter without unbounded growth',
    );
    assert.equal(row.until, f.now() + 60000);
    const coldStart = new PersistentRateLimiter(await f.open(), f.now, hash);
    await assert.rejects(coldStart.take(key, 3, 60000), limited);
    assert.equal(
      (
        await second.get<{ count: number }>(
          'SELECT count FROM rate_limits WHERE key = ?',
          row.key,
        )
      )?.count,
      4,
    );
  },
);

test(
  'PostgreSQL limiter resets only after the window and prunes expired keys',
  integration,
  async (t) => {
    const f = await fixture(t);
    const db = await f.open();
    const limiter = new PersistentRateLimiter(db, f.now, hash);
    const key = 'mutation:203.0.113.42';
    const originalUntil = f.now() + 1000;
    await limiter.take(key, 1, 1000);
    await assert.rejects(limiter.take(key, 1, 1000), limited);
    f.advance(999);
    await assert.rejects(limiter.take(key, 1, 1000), limited);
    assert.equal(
      (
        await db.get<{ until: number }>(
          'SELECT until FROM rate_limits WHERE key = ?',
          hash(`rate-limit:${key}`),
        )
      )?.until,
      originalUntil,
    );
    f.advance(1);
    await limiter.take(key, 1, 1000);
    assert.deepEqual(
      await db.get<{ count: number; until: number }>(
        'SELECT count,until FROM rate_limits WHERE key = ?',
        hash(`rate-limit:${key}`),
      ),
      { count: 1, until: f.now() + 1000 },
    );
    await limiter.take('still-active', 1, 2000);
    f.advance(1000);
    await limiter.prune();
    const remaining = await db.all<{ key: string }>(
      'SELECT key FROM rate_limits',
    );
    assert.deepEqual(remaining, [{ key: hash('rate-limit:still-active') }]);
    await limiter.take(key, 1, 1000);
    f.advance(1000);
    await limiter.prune();
    assert.deepEqual(await db.all('SELECT key FROM rate_limits'), []);
  },
);

test(
  'API auth throttling is shared by independent PostgreSQL servers and survives a replacement server',
  integration,
  async (t) => {
    const f = await fixture(t);
    const [first, second] = await Promise.all([f.app(), f.app()]);
    const request = (app: App) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/auth/verify',
        headers: { origin },
        payload: {},
      });
    const firstTwenty = await Promise.all(
      Array.from({ length: 20 }, (_, i) => request(i % 2 ? first : second)),
    );
    assert.ok(
      firstTwenty.every((response) => response.statusCode === 400),
      'The first twenty invalid sign-ins reach normal payload validation',
    );
    const blocked = await request(first);
    assert.equal(blocked.statusCode, 429, blocked.body);
    assert.equal(blocked.json().error.code, 'RATE_LIMITED');
    assert.equal(blocked.headers['access-control-allow-origin'], origin);
    await first.close();
    const replaced = await f.app();
    const stillBlocked = await request(replaced);
    assert.equal(stillBlocked.statusCode, 429, stillBlocked.body);
    assert.equal(stillBlocked.json().error.code, 'RATE_LIMITED');
    f.advance(300000);
    const reset = await request(replaced);
    assert.equal(reset.statusCode, 400, reset.body);
  },
);
