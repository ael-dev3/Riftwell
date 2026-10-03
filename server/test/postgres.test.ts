import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Wallet } from 'ethers';
import postgres from 'postgres';
import type {
  InjectOptions,
  Response as InjectResponse,
} from 'light-my-request';
import { createApp } from '../app.ts';
import { loadConfig } from '../config.ts';
import type {
  App,
  ChallengeRow,
  ChainAdapter,
  IdempotencyRow,
  Listing,
  ListingRow,
  Position,
  Session,
  SessionRow,
  SqlParameter,
} from '../types.ts';

const origin = 'https://riftwell.example';
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integrationOptions = {
  skip: testDatabaseUrl
    ? false
    : 'PostgreSQL integration requires TEST_DATABASE_URL pointing to a disposable test database.',
  timeout: 30_000,
};
const iso = (time: number) => new Date(time).toISOString();
type HTTPMethods = NonNullable<InjectOptions['method']>;
type TestSession = Session & { cookie: string };

async function fixture(t: TestContext) {
  assert.ok(testDatabaseUrl, 'TEST_DATABASE_URL is required');
  const schema = `riftwell_test_${randomUUID().replaceAll('-', '')}`;
  const directory = await mkdtemp(join(tmpdir(), 'riftwell-postgres-'));
  const admin = postgres(testDatabaseUrl, {
    max: 1,
    connect_timeout: 5,
    onnotice: () => {},
  });
  const apps: App[] = [];
  let schemaCreated = false;
  t.after(async () => {
    try {
      await Promise.all(apps.map((app) => app.close()));
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
  const time = Date.parse('2030-01-01T12:00:00.000Z');
  const owner = Wallet.createRandom();
  const positions = new Map<string, Position>();
  for (const tokenId of ['1', '2', '3', '4'])
    positions.set(tokenId, {
      id: `kittenswap-${tokenId}`,
      tokenId,
      marketId: 'kittenswap',
      owner: owner.address,
      lockedAmountRaw: '540157719850561543735839',
      lockedUntil: '2031-01-01T00:00:00.000Z',
      votingPowerRaw: '127458152638650785493',
      blockNumber: 1234,
      blockHash: `0x${'11'.repeat(32)}`,
      observedAt: iso(time),
    });
  const chain: ChainAdapter = {
    async getPosition(tokenId) {
      const position = positions.get(tokenId);
      if (!position)
        throw Object.assign(new Error('missing'), {
          code: 'POSITION_NOT_FOUND',
        });
      return position;
    },
    async getOwnedPositions(address) {
      return {
        items: [...positions.values()].filter(
          (position) => position.owner === address,
        ),
        nextCursor: null,
      };
    },
    async health() {
      return { ready: true, available: true, chainId: 999 };
    },
  };
  const config = loadConfig({
    NODE_ENV: 'test',
    APP_ORIGIN: origin,
    DATABASE_URL: url.toString(),
    SESSION_SECRET: 'a'.repeat(64),
    DIST_PATH: join(directory, 'dist'),
  });
  // Separate pools share one schema; concurrent startup also exercises migration
  // coordination before any of the request concurrency assertions run.
  const started = await Promise.allSettled([
    createApp({ config, chain, now: () => time }),
    createApp({ config, chain, now: () => time }),
  ]);
  for (const result of started)
    if (result.status === 'fulfilled') apps.push(result.value);
  for (const result of started)
    if (result.status === 'rejected') throw result.reason;
  assert.equal(apps.length, 2);
  for (const app of apps) {
    assert.equal(app.database.dialect, 'postgres');
    const backend = await app.database.get<{
      schema: string;
      version: string;
    }>(
      "SELECT current_schema() AS schema, current_setting('server_version') AS version",
    );
    assert.ok(backend);
    assert.equal(backend.schema, schema);
    assert.ok(backend.version);
  }
  return {
    apps: apps as [App, App],
    chain,
    owner,
    time,
    async restart() {
      await Promise.all(apps.map((app) => app.close()));
      apps.length = 0;
      const restarted = await Promise.allSettled([
        createApp({ config, chain, now: () => time }),
        createApp({ config, chain, now: () => time }),
      ]);
      for (const result of restarted)
        if (result.status === 'fulfilled') apps.push(result.value);
      for (const result of restarted)
        if (result.status === 'rejected') throw result.reason;
      assert.equal(apps.length, 2);
    },
  };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

async function send(
  app: App,
  method: HTTPMethods,
  path: string,
  payload?: Record<string, unknown>,
  session?: TestSession,
): Promise<InjectResponse> {
  return app.inject({
    method,
    url: `/api/v1${path}`,
    ...(payload === undefined ? {} : { payload }),
    headers: {
      ...(method === 'GET' ? {} : { origin }),
      ...(session
        ? { cookie: session.cookie, 'x-csrf-token': session.csrfToken }
        : {}),
    },
  });
}

async function challenge(f: Fixture) {
  const response = await send(f.apps[0], 'POST', '/auth/challenge', {
    address: f.owner.address,
    chainId: 999,
  });
  assert.equal(response.statusCode, 200, response.body);
  return response.json<{ challengeId: string; message: string }>();
}

async function login(f: Fixture): Promise<TestSession> {
  const issued = await challenge(f);
  const response = await send(f.apps[0], 'POST', '/auth/verify', {
    challengeId: issued.challengeId,
    signature: await f.owner.signMessage(issued.message),
  });
  assert.equal(response.statusCode, 200, response.body);
  const cookie = response.headers['set-cookie'];
  assert.equal(typeof cookie, 'string');
  return {
    ...response.json<Session>(),
    cookie: (cookie as string).split(';')[0]!,
  };
}

const listing = (f: Fixture, tokenId = '1') => ({
  tokenId,
  priceMicros: '4200000000',
  expiresAt: iso(f.time + 2 * 86400000),
  idempotencyKey: randomUUID(),
});

const edit = (f: Fixture, record: Listing, priceMicros = '990000000') => ({
  priceMicros,
  expiresAt: iso(f.time + 3 * 86400000),
  expectedRevision: record.revision,
  idempotencyKey: randomUUID(),
});

function error(response: InjectResponse, status: number, code: string) {
  assert.equal(response.statusCode, status, response.body);
  assert.equal(response.json<{ error: { code: string } }>().error.code, code);
}

async function count(
  app: App,
  table: string,
  where = '',
  params: SqlParameter[] = [],
) {
  assert.ok(
    [
      'sessions',
      'listings',
      'idempotency',
      'audit_events',
      'challenges',
    ].includes(table),
  );
  const row = await app.database.get<{ n: number }>(
    `SELECT count(*) AS n FROM ${table}${where ? ` WHERE ${where}` : ''}`,
    ...params,
  );
  assert.ok(row);
  assert.equal(typeof row.n, 'number', 'PostgreSQL counts must be decoded');
  return row.n;
}

function gateReads(f: Fixture, expected: number) {
  const original = f.chain.getPosition;
  let entered: () => void = () => assert.fail('Gate not initialized');
  let release: () => void = () => assert.fail('Gate not initialized');
  let reads = 0;
  const reached = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.chain.getPosition = async (tokenId) => {
    if (++reads === expected) entered();
    await gate;
    return original(tokenId);
  };
  return {
    reached,
    release() {
      f.chain.getPosition = original;
      release();
    },
  };
}

async function waitForReads(reached: Promise<void>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      reached,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Requests did not reach the ownership gate')),
          5000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function concurrentOwnership(
  f: Fixture,
  requests: (() => Promise<InjectResponse>)[],
) {
  const gate = gateReads(f, requests.length);
  const pending = Promise.all(requests.map((request) => request()));
  try {
    await waitForReads(gate.reached);
  } finally {
    gate.release();
  }
  return pending;
}

test(
  'PostgreSQL: two instances consume one challenge and share numeric session expiry',
  integrationOptions,
  async (t) => {
    const f = await fixture(t);
    const issued = await challenge(f);
    const payload = {
      challengeId: issued.challengeId,
      signature: await f.owner.signMessage(issued.message),
    };
    const responses = await Promise.all(
      f.apps.map((app) => send(app, 'POST', '/auth/verify', payload)),
    );
    assert.deepEqual(
      responses.map((response) => response.statusCode).sort(),
      [200, 401],
    );
    error(
      responses.find((response) => response.statusCode === 401)!,
      401,
      'CHALLENGE_INVALID',
    );
    error(
      await send(f.apps[1], 'POST', '/auth/verify', payload),
      401,
      'CHALLENGE_INVALID',
    );
    assert.equal(await count(f.apps[1], 'sessions'), 1);
    assert.equal(
      await count(f.apps[1], 'audit_events', 'event = ? AND entity_id = ?', [
        'auth.challenge-consumed',
        issued.challengeId,
      ]),
      1,
    );
    const storedChallenge = await f.apps[1].database.get<ChallengeRow>(
      'SELECT * FROM challenges WHERE id = ?',
      issued.challengeId,
    );
    assert.ok(storedChallenge);
    assert.equal(storedChallenge.created_at, f.time);
    assert.equal(storedChallenge.expires_at, f.time + 300_000);
    assert.equal(storedChallenge.consumed_at, f.time);
    const storedSession = await f.apps[1].database.get<SessionRow>(
      'SELECT * FROM sessions',
    );
    assert.ok(storedSession);
    assert.equal(storedSession.created_at, f.time);
    assert.equal(storedSession.expires_at, f.time + 28_800_000);
    const success = responses.find((response) => response.statusCode === 200)!;
    const cookie = success.headers['set-cookie'];
    assert.equal(typeof cookie, 'string');
    const session = {
      ...success.json<Session>(),
      cookie: (cookie as string).split(';')[0]!,
    };
    const restored = await send(
      f.apps[1],
      'GET',
      '/auth/session',
      undefined,
      session,
    );
    assert.equal(restored.statusCode, 200, restored.body);
    assert.deepEqual(restored.json(), success.json());
  },
);

test(
  'PostgreSQL: cross-instance identical listing retries preserve one immutable snapshot',
  integrationOptions,
  async (t) => {
    const f = await fixture(t);
    const session = await login(f);
    const input = listing(f);
    const responses = await concurrentOwnership(
      f,
      f.apps.map((app) => () => send(app, 'POST', '/listings', input, session)),
    );
    for (const response of responses)
      assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(responses[0].json(), responses[1].json());
    const original = responses[0].json<Listing>();
    const updated = await send(
      f.apps[1],
      'PATCH',
      `/listings/${original.id}`,
      edit(f, original),
      session,
    );
    assert.equal(updated.statusCode, 200, updated.body);
    assert.equal(updated.json<Listing>().revision, 2);
    const retried = await send(f.apps[0], 'POST', '/listings', input, session);
    assert.equal(retried.statusCode, 200, retried.body);
    assert.deepEqual(retried.json(), original);
    error(
      await send(
        f.apps[1],
        'POST',
        '/listings',
        { ...input, priceMicros: '4300000000' },
        session,
      ),
      409,
      'IDEMPOTENCY_CONFLICT',
    );
    assert.equal(await count(f.apps[1], 'listings'), 1);
    assert.equal(
      await count(f.apps[1], 'idempotency', 'operation = ?', ['listings']),
      1,
    );
    assert.equal(
      await count(f.apps[1], 'audit_events', 'event = ?', ['listing.created']),
      1,
    );
    const snapshot = await f.apps[1].database.get<IdempotencyRow>(
      'SELECT * FROM idempotency WHERE key = ?',
      input.idempotencyKey,
    );
    assert.ok(snapshot);
    assert.deepEqual(JSON.parse(snapshot.response_json), original);
  },
);

test(
  'PostgreSQL: cross-instance competing keys cannot create two active listings for one token',
  integrationOptions,
  async (t) => {
    const f = await fixture(t);
    const session = await login(f);
    const responses = await concurrentOwnership(
      f,
      f.apps.map(
        (app) => () => send(app, 'POST', '/listings', listing(f), session),
      ),
    );
    assert.deepEqual(
      responses.map((response) => response.statusCode).sort(),
      [200, 409],
    );
    error(
      responses.find((response) => response.statusCode === 409)!,
      409,
      'ACTIVE_ORDER_EXISTS',
    );
    assert.equal(await count(f.apps[1], 'listings', "status = 'active'"), 1);
    assert.equal(await count(f.apps[1], 'idempotency'), 1);
    assert.equal(
      await count(f.apps[1], 'audit_events', 'event = ?', ['listing.created']),
      1,
    );
  },
);

test(
  'PostgreSQL: cross-instance edit retries commit once and stale revisions cannot overwrite',
  integrationOptions,
  async (t) => {
    const f = await fixture(t);
    const session = await login(f);
    const created = await send(
      f.apps[0],
      'POST',
      '/listings',
      listing(f),
      session,
    );
    assert.equal(created.statusCode, 200, created.body);
    const original = created.json<Listing>();
    const update = edit(f, original);
    const retries = await concurrentOwnership(
      f,
      f.apps.map(
        (app) => () =>
          send(app, 'PATCH', `/listings/${original.id}`, update, session),
      ),
    );
    for (const response of retries)
      assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(retries[0].json(), retries[1].json());
    const second = retries[0].json<Listing>();
    assert.equal(second.revision, 2);
    const competing = await concurrentOwnership(f, [
      () =>
        send(
          f.apps[0],
          'PATCH',
          `/listings/${original.id}`,
          edit(f, second, '1000000'),
          session,
        ),
      () =>
        send(
          f.apps[1],
          'PATCH',
          `/listings/${original.id}`,
          edit(f, second, '1000000000000'),
          session,
        ),
    ]);
    assert.deepEqual(
      competing.map((response) => response.statusCode).sort(),
      [200, 409],
    );
    error(
      competing.find((response) => response.statusCode === 409)!,
      409,
      'LISTING_CHANGED',
    );
    const winner = competing
      .find((response) => response.statusCode === 200)!
      .json<Listing>();
    const current = await f.apps[0].database.get<ListingRow>(
      'SELECT * FROM listings WHERE id = ?',
      original.id,
    );
    assert.equal(current?.revision, 3);
    assert.equal(current?.price_micros, winner.priceMicros);
    const replay = await send(
      f.apps[1],
      'PATCH',
      `/listings/${original.id}`,
      update,
      session,
    );
    assert.equal(replay.statusCode, 200, replay.body);
    assert.deepEqual(replay.json(), second);
    assert.equal(
      await count(f.apps[1], 'audit_events', 'event = ?', ['listing.updated']),
      2,
    );
    assert.equal(
      await count(f.apps[1], 'idempotency', 'operation = ?', [
        'listings.update',
      ]),
      2,
    );
  },
);

test(
  'PostgreSQL: revocation on another instance prevents awaited create and edit mutations',
  integrationOptions,
  async (t) => {
    const f = await fixture(t);
    let session = await login(f);
    let gate = gateReads(f, 1);
    const pendingCreate = send(
      f.apps[0],
      'POST',
      '/listings',
      listing(f),
      session,
    );
    try {
      await waitForReads(gate.reached);
      const logout = await send(f.apps[1], 'POST', '/auth/logout', {}, session);
      assert.equal(logout.statusCode, 200, logout.body);
    } finally {
      gate.release();
    }
    error(await pendingCreate, 401, 'AUTH_REQUIRED');
    assert.equal(await count(f.apps[1], 'listings'), 0);
    assert.equal(await count(f.apps[1], 'idempotency'), 0);
    session = await login(f);
    const created = await send(
      f.apps[0],
      'POST',
      '/listings',
      listing(f),
      session,
    );
    assert.equal(created.statusCode, 200, created.body);
    const original = created.json<Listing>();
    gate = gateReads(f, 1);
    const pendingEdit = send(
      f.apps[0],
      'PATCH',
      `/listings/${original.id}`,
      edit(f, original),
      session,
    );
    try {
      await waitForReads(gate.reached);
      const logout = await send(f.apps[1], 'POST', '/auth/logout', {}, session);
      assert.equal(logout.statusCode, 200, logout.body);
    } finally {
      gate.release();
    }
    error(await pendingEdit, 401, 'AUTH_REQUIRED');
    const stored = await f.apps[1].database.get<ListingRow>(
      'SELECT * FROM listings WHERE id = ?',
      original.id,
    );
    assert.equal(stored?.revision, 1);
    assert.equal(stored?.price_micros, original.priceMicros);
    assert.equal(await count(f.apps[1], 'idempotency'), 1);
    assert.equal(await count(f.apps[1], 'sessions'), 0);
    assert.equal(
      await count(f.apps[1], 'audit_events', 'event = ?', ['listing.updated']),
      0,
    );
  },
);

test(
  'PostgreSQL: awaited nested adapter operations roll back on one connection',
  integrationOptions,
  async (t) => {
    const f = await fixture(t);
    const id = randomUUID();
    await assert.rejects(
      f.apps[0].database.transaction(async () => {
        await f.apps[0].database.run(
          'INSERT INTO challenges(id,address,chain_id,nonce,message,created_at,expires_at) VALUES (?,?,999,?,?,?,?)',
          id,
          f.owner.address,
          randomUUID(),
          'rollback test',
          f.time,
          f.time + 300_000,
        );
        await Promise.resolve();
        await f.apps[0].database.transaction(async () => {
          await f.apps[0].database.run(
            'INSERT INTO audit_events(created_at,actor,event,entity_type,entity_id,detail_json) VALUES (?,?,?,?,?,?)',
            f.time,
            f.owner.address,
            'test.rollback',
            'auth',
            id,
            '{}',
          );
        });
        assert.equal(await count(f.apps[0], 'challenges', 'id = ?', [id]), 1);
        assert.equal(await count(f.apps[1], 'challenges', 'id = ?', [id]), 0);
        throw new Error('rollback requested');
      }),
      /rollback requested/,
    );
    assert.equal(await count(f.apps[1], 'challenges', 'id = ?', [id]), 0);
    assert.equal(
      await count(f.apps[1], 'audit_events', 'entity_id = ?', [id]),
      0,
    );
  },
);

test(
  'PostgreSQL: a failed audit insert rolls back listing and idempotency writes before a safe retry',
  integrationOptions,
  async (t) => {
    const f = await fixture(t);
    const session = await login(f);
    const input = listing(f);
    await f.apps[0].database.run(`
    CREATE FUNCTION reject_listing_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.event = 'listing.created' THEN
        RAISE EXCEPTION 'injected audit failure';
      END IF;
      RETURN NEW;
    END;
    $$
  `);
    await f.apps[0].database.run(
      'CREATE TRIGGER reject_listing_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_listing_audit()',
    );
    error(
      await send(f.apps[0], 'POST', '/listings', input, session),
      500,
      'INTERNAL_ERROR',
    );
    assert.equal(await count(f.apps[1], 'listings'), 0);
    assert.equal(await count(f.apps[1], 'idempotency'), 0);
    assert.equal(
      await count(f.apps[1], 'audit_events', 'event = ?', ['listing.created']),
      0,
    );
    await f.apps[0].database.run(
      'DROP TRIGGER reject_listing_audit ON audit_events',
    );
    const retry = await send(f.apps[1], 'POST', '/listings', input, session);
    assert.equal(retry.statusCode, 200, retry.body);
    assert.equal(await count(f.apps[0], 'listings'), 1);
    assert.equal(await count(f.apps[0], 'idempotency'), 1);
    assert.equal(
      await count(f.apps[0], 'audit_events', 'event = ?', ['listing.created']),
      1,
    );
  },
);

test(
  'PostgreSQL: nullable challenge and fixed listing fields stay null',
  integrationOptions,
  async (t) => {
    const f = await fixture(t);
    const issued = await challenge(f);
    const storedChallenge = await f.apps[1].database.get<ChallengeRow>(
      'SELECT * FROM challenges WHERE id = ?',
      issued.challengeId,
    );
    assert.ok(storedChallenge);
    assert.equal(storedChallenge.consumed_at, null);
    assert.equal(storedChallenge.created_at, f.time);
    const session = await login(f);
    const created = await send(
      f.apps[0],
      'POST',
      '/listings',
      listing(f),
      session,
    );
    assert.equal(created.statusCode, 200, created.body);
    const record = created.json<Listing>();
    assert.equal(record.auctionEndsAt, null);
    assert.equal(record.recipient, null);
    const storedListing = await f.apps[1].database.get<ListingRow>(
      'SELECT * FROM listings WHERE id = ?',
      record.id,
    );
    assert.ok(storedListing);
    assert.equal(storedListing.auction_ends_at, null);
    assert.equal(storedListing.recipient, null);
    assert.equal(storedListing.starts_at, f.time);
  },
);

test(
  'PostgreSQL: version 1 migration preserves listing, authentication, snapshots and audits after reopening',
  integrationOptions,
  async (t) => {
    const f = await fixture(t);
    const session = await login(f);
    const input = listing(f);
    const created = await send(f.apps[0], 'POST', '/listings', input, session);
    assert.equal(created.statusCode, 200, created.body);
    const record = created.json<Listing>();
    const tables = [
      ['challenges', 'id'],
      ['sessions', 'token_hash'],
      ['listings', 'id'],
      ['idempotency', 'actor, operation, key'],
      ['audit_events', 'sequence'],
    ] as const;
    const before = await Promise.all(
      tables.map(([table, order]) =>
        f.apps[0].database.all<Record<string, unknown>>(
          `SELECT * FROM ${table} ORDER BY ${order}`,
        ),
      ),
    );
    // Version 1 has these same durable core tables, without the rate limit table.
    await f.apps[0].database.transaction(async () => {
      assert.deepEqual(await f.apps[0].database.run('DROP TABLE rate_limits'), {
        changes: 0,
      });
      await f.apps[0].database.run('UPDATE riftwell_schema SET version = 1');
    });
    await f.restart();
    assert.deepEqual(
      await f.apps[1].database.get<{ version: number }>(
        'SELECT version FROM riftwell_schema',
      ),
      { version: 2 },
    );
    const after = await Promise.all(
      tables.map(([table, order]) =>
        f.apps[1].database.all<Record<string, unknown>>(
          `SELECT * FROM ${table} ORDER BY ${order}`,
        ),
      ),
    );
    assert.deepEqual(after, before);
    const index = await f.apps[1].database.get<{ n: number }>(
      "SELECT count(*) AS n FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'rate_limits_expiry'",
    );
    assert.equal(index?.n, 1);
    await f.apps[1].database.run(
      'INSERT INTO rate_limits(key,count,until) VALUES (?,?,?)',
      'migration-probe',
      1,
      f.time + 60_000,
    );
    assert.deepEqual(
      await f.apps[0].database.get<{ count: number; until: number }>(
        'SELECT count, until FROM rate_limits WHERE key = ?',
        'migration-probe',
      ),
      { count: 1, until: f.time + 60_000 },
    );
    const restored = await send(
      f.apps[1],
      'GET',
      '/auth/session',
      undefined,
      session,
    );
    assert.equal(restored.statusCode, 200, restored.body);
    const { cookie: _cookie, ...expectedSession } = session;
    assert.deepEqual(restored.json(), expectedSession);
    const retry = await send(f.apps[0], 'POST', '/listings', input, session);
    assert.equal(retry.statusCode, 200, retry.body);
    assert.deepEqual(retry.json(), record);
  },
);

test(
  'PostgreSQL: a caught savepoint exception rolls back inner writes while the outer transaction commits',
  integrationOptions,
  async (t) => {
    const f = await fixture(t);
    await f.apps[0].database.transaction(async () => {
      await f.apps[0].database.run(
        'INSERT INTO rate_limits(key,count,until) VALUES (?,?,?)',
        'outer-before',
        1,
        f.time,
      );
      await assert.rejects(
        f.apps[0].database.transaction(async () => {
          await f.apps[0].database.run(
            'INSERT INTO rate_limits(key,count,until) VALUES (?,?,?)',
            'inner-discarded',
            1,
            f.time,
          );
          await Promise.resolve();
          throw new Error('inner rollback');
        }),
        /inner rollback/,
      );
      assert.equal(
        await f.apps[0].database.get<{ key: string }>(
          'SELECT key FROM rate_limits WHERE key = ?',
          'inner-discarded',
        ),
        undefined,
      );
      await f.apps[0].database.run(
        'INSERT INTO rate_limits(key,count,until) VALUES (?,?,?)',
        'outer-after',
        1,
        f.time,
      );
    });
    assert.deepEqual(
      await f.apps[1].database.all<{ key: string }>(
        'SELECT key FROM rate_limits ORDER BY key',
      ),
      [{ key: 'outer-after' }, { key: 'outer-before' }],
    );
  },
);
