import test, { type TestContext } from 'node:test';
import type {
  InjectOptions,
  Response as InjectResponse,
} from 'light-my-request';
type HTTPMethods = NonNullable<InjectOptions['method']>;
import type { IncomingHttpHeaders, OutgoingHttpHeaders } from 'node:http';
import type {
  ChainAdapter,
  ChainHealth,
  Listing,
  ListingRow,
  SessionRow,
  IdempotencyRow,
  LoanRequest,
  Offer,
  OwnershipOptions,
  Page,
  Position,
  ServerConfig,
  Session,
} from '../types.ts';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { Wallet } from 'ethers';
import { createApp } from '../app.ts';
import { loadConfig } from '../config.ts';
import { backupDatabase } from '../backup.ts';
import { RateLimiter } from '../rate-limit.ts';
import { pruneAuth } from '../database.ts';

const origin = 'https://riftwell.example';
const iso = (time: number) => new Date(time).toISOString();

async function fixture(t: TestContext, overrides: Partial<ServerConfig> = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'riftwell-server-'));
  let time = Date.parse('2030-01-01T12:00:00.000Z');
  const owner = Wallet.createRandom();
  const lender = Wallet.createRandom();
  const outsider = Wallet.createRandom();
  const positions = new Map<string, Position>();
  const position = (
    id: string,
    account = owner.address,
    extra: Record<string, unknown> = {},
  ): Position => ({
    id: `kittenswap-${id}`,
    tokenId: id,
    marketId: 'kittenswap',
    owner: account,
    lockedAmountRaw: '540157719850561543735839',
    lockedUntil: '2031-01-01T00:00:00.000Z',
    votingPowerRaw: '127458152638650785493',
    blockNumber: 1234,
    blockHash: `0x${'11'.repeat(32)}`,
    observedAt: iso(time),
    ...extra,
  });
  for (const id of ['1', '2', '3', '4']) positions.set(id, position(id));
  let unavailable = false;
  let reads = 0;
  let batches = 0;
  const chain: ChainAdapter & {
    getPositions: NonNullable<ChainAdapter['getPositions']>;
    sendTransaction(): never;
  } = {
    async getPosition(id: string) {
      reads++;
      await Promise.resolve();
      if (unavailable)
        throw Object.assign(
          new Error('https://rpc.invalid/secret-credential'),
          { code: 'CHAIN_UNAVAILABLE' },
        );
      if (!positions.has(id))
        throw Object.assign(new Error('missing'), {
          code: 'POSITION_NOT_FOUND',
        });
      return positions.get(id)!;
    },
    async getPositions(ids: readonly string[]) {
      batches++;
      return Promise.all(
        ids.map(async (id) => {
          try {
            return await chain.getPosition(id);
          } catch (error) {
            if (
              error instanceof Error &&
              'code' in error &&
              error.code === 'POSITION_NOT_FOUND'
            )
              return null;
            throw error;
          }
        }),
      );
    },
    async getOwnedPositions(
      account: string,
      { cursor, limit }: OwnershipOptions = {},
    ) {
      if (cursor)
        throw Object.assign(new Error('bad cursor'), {
          code: 'INVALID_CURSOR',
        });
      if (unavailable)
        throw Object.assign(new Error('secret-credential'), {
          code: 'CHAIN_UNAVAILABLE',
        });
      return {
        items: [...positions.values()]
          .filter((item) => item.owner === account)
          .slice(0, limit),
        nextCursor: null,
      };
    },
    async health() {
      return {
        ready: !unavailable,
        available: !unavailable,
        chainId: 999,
        rpcUrl: 'secret-credential',
      };
    },
    sendTransaction() {
      throw new Error('Financial writes are forbidden');
    },
  };
  const config = {
    ...loadConfig({
      NODE_ENV: 'test',
      APP_ORIGIN: origin,
      DB_PATH: join(directory, 'state.sqlite'),
      SESSION_SECRET: 'a'.repeat(64),
      DIST_PATH: join(directory, 'dist'),
    }),
    ...overrides,
  };
  let app = await createApp({ config, chain, now: () => time });
  t.after(async () => {
    if (app) await app.close();
    await rm(directory, { recursive: true, force: true });
  });
  return {
    get app() {
      return app;
    },
    config,
    chain,
    positions,
    position,
    directory,
    owner,
    lender,
    outsider,
    get time() {
      return time;
    },
    advance(ms: number) {
      time += ms;
    },
    unavailable(value: boolean) {
      unavailable = value;
    },
    get reads() {
      return reads;
    },
    get batches() {
      return batches;
    },
    async restart(dbPath = config.dbPath) {
      await app.close();
      app = await createApp({
        config: { ...config, dbPath },
        chain,
        now: () => time,
      });
    },
  };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;
interface TestAccount {
  positionsUnavailable: boolean;
  address: string;
  positions: Position[];
  listings: Listing[];
  loanRequests: LoanRequest[];
  offers: Offer[];
  receivedOffers: Offer[];
  historyTruncated: boolean;
}
type TestSession = Session & { cookie: string; setCookie: string };
type RequestPayload = Record<string, unknown> | string | Buffer | undefined;
async function send(
  f: Fixture,
  method: HTTPMethods,
  url: string,
  payload?: RequestPayload,
  session?: { cookie: string; csrfToken?: string } | null,
  headers: IncomingHttpHeaders = {},
): Promise<InjectResponse> {
  return f.app.inject({
    method,
    url: `/api/v1${url}`,
    ...(payload !== undefined ? { payload } : {}),
    headers: {
      ...(method !== 'GET' ? { origin } : {}),
      ...(session
        ? {
            cookie: session.cookie,
            ...(session.csrfToken ? { 'x-csrf-token': session.csrfToken } : {}),
          }
        : {}),
      ...headers,
    },
  });
}
async function challenge(f: Fixture, wallet = f.owner) {
  const response = await send(f, 'POST', '/auth/challenge', {
    address: wallet.address,
    chainId: 999,
  });
  assert.equal(response.statusCode, 200, response.body);
  return response.json<{
    challengeId: string;
    message: string;
    expiresAt: string;
  }>();
}
async function login(f: Fixture, wallet = f.owner) {
  const issued = await challenge(f, wallet);
  const response = await send(f, 'POST', '/auth/verify', {
    challengeId: issued.challengeId,
    signature: await wallet.signMessage(issued.message),
  });
  assert.equal(response.statusCode, 200, response.body);
  return {
    ...response.json<Session>(),
    cookie: header(response.headers['set-cookie']).split(';')[0]!,
    setCookie: header(response.headers['set-cookie']),
  };
}
const listing = (
  f: Fixture,
  tokenId = '1',
  extra: Record<string, unknown> = {},
) => ({
  tokenId,
  priceMicros: '4200000000',
  expiresAt: iso(f.time + 2 * 86400000),
  idempotencyKey: randomUUID(),
  ...extra,
});
const listingUpdate = (
  f: Fixture,
  record: Listing,
  extra: Record<string, unknown> = {},
) => ({
  priceMicros: '990000000',
  expiresAt: iso(f.time + 3 * 86400000),
  expectedRevision: record.revision,
  idempotencyKey: randomUUID(),
  ...extra,
});
const listingTermsSnapshot = ({
  kind,
  startPriceMicros,
  endPriceMicros,
  startsAt,
  auctionEndsAt,
  recipient,
}: Listing) => ({
  kind,
  startPriceMicros,
  endPriceMicros,
  startsAt,
  auctionEndsAt,
  recipient,
});
const dutchListing = (
  f: Fixture,
  tokenId = '1',
  extra: Record<string, unknown> = {},
) =>
  listing(f, tokenId, {
    kind: 'dutch',
    priceMicros: '10000000000',
    endPriceMicros: '2000000000',
    auctionEndsAt: iso(f.time + 86400000),
    expiresAt: iso(f.time + 7 * 86400000),
    ...extra,
  });
const borrowing = (f: Fixture, extra: Record<string, unknown> = {}) => ({
  tokenId: '1',
  principalMicros: '1000000000',
  aprBps: 1200,
  durationDays: 7,
  expiresAt: iso(f.time + 2 * 86400000),
  idempotencyKey: randomUUID(),
  ...extra,
});
const offer = (
  f: Fixture,
  requestId: string,
  extra: Record<string, unknown> = {},
) => ({
  requestId,
  principalMicros: '1000000000',
  aprBps: 1000,
  durationDays: 7,
  expiresAt: iso(f.time + 86400000),
  idempotencyKey: randomUUID(),
  ...extra,
});
// Pre-retirement records are seeded directly: public APIs cannot create them.
function seedLegacyRequest(f: Fixture, extra: Record<string, unknown> = {}) {
  const input = borrowing(f, extra);
  const record = {
    id: randomUUID(),
    marketId: 'kittenswap',
    owner: f.owner.address,
    status: 'active',
    createdAt: iso(f.time),
    position: f.positions.get(input.tokenId),
    ...input,
  };
  f.app.store
    .prepare(
      'INSERT INTO loan_requests(id,market,token_id,owner,principal_micros,apr_bps,duration_days,expires_at,created_at,updated_at,status,position_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    )
    .run(
      record.id,
      record.marketId,
      record.tokenId,
      record.owner,
      record.principalMicros,
      record.aprBps,
      record.durationDays,
      Date.parse(record.expiresAt),
      f.time,
      f.time,
      record.status,
      JSON.stringify(record.position),
    );
  return record;
}
function seedLegacyOffer(
  f: Fixture,
  requestId: string,
  extra: Record<string, unknown> = {},
) {
  const record = {
    id: randomUUID(),
    lender: f.lender.address,
    status: 'proposed',
    createdAt: iso(f.time),
    ...offer(f, requestId, extra),
  };
  f.app.store
    .prepare(
      'INSERT INTO offers(id,request_id,lender,principal_micros,apr_bps,duration_days,expires_at,created_at,updated_at,status) VALUES (?,?,?,?,?,?,?,?,?,?)',
    )
    .run(
      record.id,
      record.requestId,
      record.lender,
      record.principalMicros,
      record.aprBps,
      record.durationDays,
      Date.parse(record.expiresAt),
      f.time,
      f.time,
      record.status,
    );
  return record;
}
interface ErrorResponse {
  statusCode?: number;
  body: string;
  headers: IncomingHttpHeaders | OutgoingHttpHeaders;
  json<T>(): T;
}
function header(
  value: string | readonly string[] | number | undefined,
): string {
  assert.equal(typeof value, 'string');
  return value as string;
}
function error(response: ErrorResponse, status: number, code: string) {
  assert.equal(response.statusCode, status, response.body);
  assert.equal(
    response.json<{ error: { code: string; requestId: string } }>().error.code,
    code,
  );
  assert.match(
    response.json<{ error: { code: string; requestId: string } }>().error
      .requestId,
    /^[0-9a-f-]{36}$/,
  );
  assert.equal(
    response.headers['x-request-id'],
    response.json<{ error: { code: string; requestId: string } }>().error
      .requestId,
  );
}

test('status exposes only durable off-chain capabilities and all settlement requests fail without chain or database writes', async (t) => {
  const f = await fixture(t);
  assert.deepEqual((await send(f, 'GET', '/status')).json(), {
    mode: 'connected',
    chainId: 999,
    marketId: 'kittenswap',
    settlementEnabled: false,
    capabilities: {
      walletSignIn: true,
      marketplace: true,
      lending: false,
      settlement: false,
    },
  });
  assert.equal(
    (await send(f, 'GET', '/markets')).json().markets[0].accentColor,
    '#bff4aa',
  );
  for (const payload of [
    { action: 'purchase' },
    { action: 'fund-loan' },
    { action: 'repay' },
    { action: 'approve' },
  ]) {
    const response = await f.app.inject({
      method: 'POST',
      url: '/api/v1/settlement',
      payload,
    });
    error(response, 503, 'SMART_CONTRACTS_DISABLED');
    assert.ok(!response.body.includes('calldata'));
  }
  assert.equal(f.reads, 0);
  assert.equal(
    f.app.store
      .prepare<unknown[], { n: number }>(
        'SELECT count(*) AS n FROM audit_events',
      )
      .get()!.n,
    0,
  );
});

test('pooled lending exposes undeployed state without fabricated accounting, terms, addresses or RPC reads', async (t) => {
  const f = await fixture(t);
  f.unavailable(true);
  const response = await send(f, 'GET', '/lending');
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.deepEqual(response.json(), {
    model: 'pooled-revenue',
    state: 'not-deployed',
    marketId: 'kittenswap',
    asset: 'USDC',
    chainId: 999,
    vaultAddress: null,
    portfolioAddress: null,
    accounting: null,
    terms: null,
    executionEnabled: false,
  });
  error(await send(f, 'GET', '/lending?market=unknown'), 400, 'UNKNOWN_FIELD');
  assert.equal(f.reads, 0);
  assert.equal(f.batches, 0);
  assert.equal(
    f.app.store
      .prepare<unknown[], { n: number }>(
        'SELECT count(*) AS n FROM audit_events',
      )
      .get()!.n,
    0,
  );
});

test('pooled actions and retired lending mutations preserve Origin, session and CSRF guards without writes', async (t) => {
  const f = await fixture(t);
  const session = await login(f);
  const before = Object.fromEntries(
    ['loan_requests', 'offers', 'idempotency', 'audit_events'].map((table) => [
      table,
      f.app.store
        .prepare<unknown[], { n: number }>(`SELECT count(*) AS n FROM ${table}`)
        .get()!.n,
    ]),
  );
  for (const [path, payload, status, code] of [
    [
      '/lending/actions',
      { action: 'supply', amountMicros: '1000000' },
      503,
      'SMART_CONTRACTS_DISABLED',
    ],
    ['/loan-requests', borrowing(f), 410, 'LEGACY_LENDING_RETIRED'],
    ['/offers', offer(f, randomUUID()), 410, 'LEGACY_LENDING_RETIRED'],
  ] as const) {
    error(await send(f, 'POST', path, payload), 401, 'AUTH_REQUIRED');
    error(
      await send(f, 'POST', path, payload, session, {
        origin: 'https://attacker.example',
      }),
      403,
      'ORIGIN_REJECTED',
    );
    error(
      await send(f, 'POST', path, payload, { cookie: session.cookie }),
      403,
      'CSRF_REJECTED',
    );
    error(
      await send(f, 'POST', path, payload, session, {
        'x-csrf-token': '0'.repeat(64),
      }),
      403,
      'CSRF_REJECTED',
    );
    const response = await send(f, 'POST', path, payload, session);
    error(response, status, code);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.ok(!response.body.includes('calldata'));
  }
  for (const action of [
    'deposit-collateral',
    'borrow',
    'repay',
    'withdraw',
    'redeem',
  ])
    error(
      await send(f, 'POST', '/lending/actions', { action }, session),
      503,
      'SMART_CONTRACTS_DISABLED',
    );
  error(
    await send(
      f,
      'POST',
      '/lending/actions',
      { action: 'borrow', padding: 'x'.repeat(20000) },
      session,
    ),
    413,
    'REQUEST_TOO_LARGE',
  );
  assert.equal(f.reads, 0);
  assert.equal(f.batches, 0);
  for (const [table, count] of Object.entries(before))
    assert.equal(
      f.app.store
        .prepare<unknown[], { n: number }>(`SELECT count(*) AS n FROM ${table}`)
        .get()!.n,
      count,
      table,
    );
});

test('retirement suppresses public legacy requests and rejects retries without changing historical records', async (t) => {
  const f = await fixture(t);
  const owner = await login(f);
  const lender = await login(f, f.lender);
  const request = seedLegacyRequest(f);
  const proposed = seedLegacyOffer(f, request.id);
  f.app.store
    .prepare(
      'INSERT INTO idempotency(actor,operation,key,payload_hash,entity_id,response_json,created_at) VALUES (?,?,?,?,?,?,?)',
    )
    .run(
      owner.address,
      'loan-requests',
      request.idempotencyKey,
      'old-digest',
      request.id,
      JSON.stringify(request),
      f.time,
    );
  const before = {
    request: f.app.store
      .prepare('SELECT * FROM loan_requests WHERE id = ?')
      .get(request.id),
    offer: f.app.store
      .prepare('SELECT * FROM offers WHERE id = ?')
      .get(proposed.id),
    idempotency: f.app.store
      .prepare<unknown[], IdempotencyRow>('SELECT * FROM idempotency')
      .all(),
    audit: f.app.store
      .prepare<unknown[], { detail_json: string }>('SELECT * FROM audit_events')
      .all(),
  };
  f.unavailable(true);
  for (const suffix of ['', '?market=kittenswap&limit=24', '?cursor=invalid'])
    error(
      await send(f, 'GET', `/loan-requests${suffix}`),
      410,
      'LEGACY_LENDING_RETIRED',
    );
  for (const payload of [
    borrowing(f, { idempotencyKey: request.idempotencyKey }),
    borrowing(f, { aprBps: 99, durationDays: 8 }),
  ])
    error(
      await send(f, 'POST', '/loan-requests', payload, owner),
      410,
      'LEGACY_LENDING_RETIRED',
    );
  error(
    await send(f, 'POST', '/offers', offer(f, request.id), lender),
    410,
    'LEGACY_LENDING_RETIRED',
  );
  assert.deepEqual(
    f.app.store
      .prepare('SELECT * FROM loan_requests WHERE id = ?')
      .get(request.id)!,
    before.request,
  );
  assert.deepEqual(
    f.app.store.prepare('SELECT * FROM offers WHERE id = ?').get(proposed.id),
    before.offer,
  );
  assert.deepEqual(
    f.app.store
      .prepare<unknown[], IdempotencyRow>('SELECT * FROM idempotency')
      .all(),
    before.idempotency,
  );
  assert.deepEqual(
    f.app.store
      .prepare<unknown[], { detail_json: string }>('SELECT * FROM audit_events')
      .all(),
    before.audit,
  );
  assert.equal(f.reads, 0);
  await f.restart();
  const account = (
    await send(f, 'GET', '/account', undefined, owner)
  ).json<TestAccount>();
  assert.equal(account.positionsUnavailable, true);
  assert.equal(account.loanRequests[0].id, request.id);
  assert.equal(account.receivedOffers[0].id, proposed.id);
  assert.deepEqual(
    f.app.store
      .prepare<unknown[], IdempotencyRow>('SELECT * FROM idempotency')
      .all(),
    before.idempotency,
  );
});

test('sign-in binds the exact ERC-4361 domain, address, chain, nonce and expiry; stores only session hashes', async (t) => {
  const f = await fixture(t, { production: true });
  const issued = await challenge(f);
  assert.ok(
    issued.message.startsWith(
      `riftwell.example wants you to sign in with your Ethereum account:\n${f.owner.address}\n`,
    ),
  );
  assert.ok(
    issued.message.includes(
      `URI: ${origin}\nVersion: 1\nChain ID: 999\nNonce: `,
    ),
  );
  assert.match(issued.message, /Nonce: [0-9a-f]{32}\nIssued At:/);
  assert.equal(Date.parse(issued.expiresAt) - f.time, 300000);
  const verified = await send(f, 'POST', '/auth/verify', {
    challengeId: issued.challengeId,
    signature: await f.owner.signMessage(issued.message),
  });
  assert.equal(verified.statusCode, 200);
  const cookie = header(verified.headers['set-cookie']);
  assert.ok(cookie.startsWith('__Host-riftwell_session='));
  for (const flag of ['HttpOnly', 'SameSite=Strict', 'Secure', 'Path=/'])
    assert.ok(cookie.includes(flag));
  const token = cookie.split(';')[0]!.split('=')[1]!;
  const stored = f.app.store
    .prepare<unknown[], SessionRow>('SELECT * FROM sessions')
    .get()!;
  assert.notEqual(stored.token_hash, token);
  assert.notEqual(stored.csrf_hash, verified.json().csrfToken);
  assert.ok(!JSON.stringify(stored).includes(token));
  const restored = await send(f, 'GET', '/auth/session', undefined, {
    cookie: cookie.split(';')[0],
  });
  assert.deepEqual(restored.json(), verified.json());
});

test('concurrent nonce verification consumes a challenge once and rejects replay without creating extra sessions', async (t) => {
  const f = await fixture(t);
  const issued = await challenge(f);
  const payload = {
    challengeId: issued.challengeId,
    signature: await f.owner.signMessage(issued.message),
  };
  const responses = await Promise.all([
    send(f, 'POST', '/auth/verify', payload),
    send(f, 'POST', '/auth/verify', payload),
  ]);
  assert.deepEqual(
    responses.map((value) => value.statusCode).sort(),
    [200, 401],
  );
  error(
    await send(f, 'POST', '/auth/verify', payload),
    401,
    'CHALLENGE_INVALID',
  );
  assert.equal(
    f.app.store
      .prepare<unknown[], { n: number }>('SELECT count(*) AS n FROM sessions')
      .get()!.n,
    1,
  );
  assert.equal(
    f.app.store
      .prepare<unknown[], { n: number }>(
        "SELECT count(*) AS n FROM audit_events WHERE event = 'auth.challenge-consumed'",
      )
      .get()!.n,
    1,
  );
});

test('wrong wallet, changed message, wrong chain, unknown fields and expired challenges are rejected', async (t) => {
  const f = await fixture(t);
  error(
    await send(f, 'POST', '/auth/challenge', {
      address: f.owner.address,
      chainId: 1,
    }),
    400,
    'WRONG_CHAIN',
  );
  error(
    await send(f, 'POST', '/auth/challenge', {
      address: f.owner.address,
      chainId: 999,
      owner: f.owner.address,
    }),
    400,
    'UNKNOWN_FIELD',
  );
  const issued = await challenge(f);
  for (const signature of [
    await f.outsider.signMessage(issued.message),
    await f.owner.signMessage(
      issued.message.replace(origin, 'https://attacker.example'),
    ),
  ])
    error(
      await send(f, 'POST', '/auth/verify', {
        challengeId: issued.challengeId,
        signature,
      }),
      401,
      'SIGNATURE_REJECTED',
    );
  f.advance(300001);
  error(
    await send(f, 'POST', '/auth/verify', {
      challengeId: issued.challengeId,
      signature: await f.owner.signMessage(issued.message),
    }),
    401,
    'CHALLENGE_INVALID',
  );
  assert.equal(
    f.app.store
      .prepare<unknown[], { n: number }>('SELECT count(*) AS n FROM sessions')
      .get()!.n,
    0,
  );
});

test('Origin and CSRF protect mutations; logout revokes cookies and expired sessions are pruned', async (t) => {
  const f = await fixture(t);
  const session = await login(f);
  error(
    await send(f, 'POST', '/listings', listing(f), session, {
      origin: 'https://attacker.example',
    }),
    403,
    'ORIGIN_REJECTED',
  );
  error(
    await f.app.inject({
      method: 'POST',
      url: '/api/v1/listings',
      payload: listing(f),
      headers: { cookie: session.cookie, 'x-csrf-token': session.csrfToken },
    }),
    403,
    'ORIGIN_REJECTED',
  );
  error(
    await send(f, 'POST', '/listings', listing(f), session, {
      'x-csrf-token': '0'.repeat(64),
    }),
    403,
    'CSRF_REJECTED',
  );
  error(await send(f, 'POST', '/listings', listing(f)), 401, 'AUTH_REQUIRED');
  error(
    await send(f, 'POST', '/auth/logout', {}, session, { 'x-csrf-token': '' }),
    403,
    'CSRF_REJECTED',
  );
  const loggedOut = await send(f, 'POST', '/auth/logout', {}, session);
  assert.deepEqual(loggedOut.json(), { ok: true });
  assert.ok(header(loggedOut.headers['set-cookie']).includes('Max-Age=0'));
  error(
    await send(f, 'GET', '/auth/session', undefined, session),
    401,
    'AUTH_REQUIRED',
  );
  const expiring = await login(f);
  f.advance(f.config.sessionTtlSeconds * 1000 + 1);
  error(
    await send(f, 'GET', '/auth/session', undefined, expiring),
    401,
    'AUTH_REQUIRED',
  );
  await pruneAuth(f.app.database, f.time);
  assert.equal(
    f.app.store
      .prepare<unknown[], { n: number }>('SELECT count(*) AS n FROM sessions')
      .get()!.n,
    0,
  );
});

test('strict JSON fields and bounded bodies fail safely before creating orders', async (t) => {
  const f = await fixture(t);
  const session = await login(f);
  error(
    await send(
      f,
      'POST',
      '/listings',
      listing(f, '1', { owner: f.outsider.address }),
      session,
    ),
    400,
    'UNKNOWN_FIELD',
  );
  error(
    await send(
      f,
      'POST',
      '/listings',
      { ...listing(f), padding: 'x'.repeat(17000) },
      session,
    ),
    413,
    'REQUEST_TOO_LARGE',
  );
  error(
    await send(f, 'POST', '/listings', '{broken', session, {
      'content-type': 'application/json',
    }),
    400,
    'INVALID_REQUEST',
  );
  assert.equal(
    f.app.store
      .prepare<unknown[], { n: number }>('SELECT count(*) AS n FROM listings')
      .get()!.n,
    0,
  );
});

test('concurrent same-key retries return exactly one result; conflicting payloads and concurrent active orders return 409', async (t) => {
  const f = await fixture(t);
  const session = await login(f);
  const payload = listing(f);
  const same = await Promise.all([
    send(f, 'POST', '/listings', payload, session),
    send(f, 'POST', '/listings', payload, session),
  ]);
  assert.deepEqual(
    same.map((value) => value.statusCode),
    [200, 200],
  );
  assert.deepEqual(same[0].json(), same[1].json());
  error(
    await send(
      f,
      'POST',
      '/listings',
      { ...payload, priceMicros: '4300000000' },
      session,
    ),
    409,
    'IDEMPOTENCY_CONFLICT',
  );
  const competing = await Promise.all([
    send(f, 'POST', '/listings', listing(f, '2'), session),
    send(f, 'POST', '/listings', listing(f, '2'), session),
  ]);
  assert.deepEqual(
    competing.map((value) => value.statusCode).sort(),
    [200, 409],
  );
  assert.equal(
    f.app.store
      .prepare<unknown[], { n: number }>('SELECT count(*) AS n FROM listings')
      .get()!.n,
    2,
  );
  assert.equal(
    f.app.store
      .prepare<unknown[], { n: number }>(
        "SELECT count(*) AS n FROM audit_events WHERE event = 'listing.created'",
      )
      .get()!.n,
    2,
  );
});

test('marketplace money stays exact and canonical; bounds, unsafe integers, malformed token IDs and expiries are rejected', async (t) => {
  const f = await fixture(t);
  const session = await login(f);
  for (const priceMicros of [
    4200,
    '1.0',
    '-1',
    '01',
    '999999',
    '1000000000001',
    '9007199254740993',
  ])
    error(
      await send(
        f,
        'POST',
        '/listings',
        listing(f, '1', { priceMicros }),
        session,
      ),
      400,
      'INVALID_AMOUNT',
    );
  for (const tokenId of [
    '0',
    '01',
    '-1',
    '1;DROP TABLE listings',
    (1n << 256n).toString(),
  ])
    error(
      await send(f, 'POST', '/listings', listing(f, tokenId), session),
      400,
      'INVALID_TOKEN_ID',
    );
  for (const expiresAt of [
    '2030-02-31T00:00:00Z',
    iso(f.time),
    iso(f.time + 31 * 86400000),
  ])
    error(
      await send(
        f,
        'POST',
        '/listings',
        listing(f, '1', { expiresAt }),
        session,
      ),
      400,
      'INVALID_EXPIRY',
    );
  const created = await send(
    f,
    'POST',
    '/listings',
    listing(f, '1', { priceMicros: '1000000000000' }),
    session,
  );
  assert.equal(created.statusCode, 200, created.body);
  assert.equal(created.json().priceMicros, '1000000000000');
});

test('ownership changes suppress and invalidate orders; a new owner cannot edit the previous creator intent', async (t) => {
  const f = await fixture(t);
  const owner = await login(f);
  const buyer = await login(f, f.outsider);
  const payload = listing(f);
  const created = (await send(f, 'POST', '/listings', payload, owner)).json();
  f.positions.set('1', f.position('1', f.outsider.address));
  const publicPage = await send(f, 'GET', '/listings?market=kittenswap');
  assert.deepEqual(publicPage.json().items, []);
  assert.equal(
    f.app.store
      .prepare<unknown[], { status: string }>(
        'SELECT status FROM listings WHERE id = ?',
      )
      .get(created.id)!.status,
    'invalidated',
  );
  error(
    await send(f, 'DELETE', `/listings/${created.id}`, undefined, buyer),
    403,
    'FORBIDDEN',
  );
  assert.equal(
    (
      await send(f, 'DELETE', `/listings/${created.id}`, undefined, owner)
    ).json().status,
    'invalidated',
  );
  error(await send(f, 'POST', '/listings', payload, owner), 403, 'NOT_OWNER');
  assert.equal(
    (await send(f, 'POST', '/listings', listing(f), buyer)).statusCode,
    200,
  );
  f.unavailable(true);
  const unavailable = await send(f, 'GET', '/listings');
  error(unavailable, 503, 'CHAIN_UNAVAILABLE');
  assert.ok(!unavailable.body.includes('secret-credential'));
});

test('listing pages use batch ownership proofs, signed cursors, exact limits and explicit expiration', async (t) => {
  const f = await fixture(t);
  const session = await login(f);
  for (const id of ['1', '2', '3'])
    assert.equal(
      (await send(f, 'POST', '/listings', listing(f, id), session)).statusCode,
      200,
    );
  const first = (await send(f, 'GET', '/listings?limit=2')).json();
  assert.equal(first.items.length, 2);
  assert.ok(first.nextCursor);
  const second = (
    await send(f, 'GET', `/listings?limit=2&cursor=${first.nextCursor}`)
  ).json();
  assert.equal(second.items.length, 1);
  assert.equal(
    new Set(
      [...first.items, ...second.items].map((item: Listing | Offer) => item.id),
    ).size,
    3,
  );
  assert.ok(f.batches >= 2);
  error(
    await send(f, 'GET', '/listings?cursor=attacker'),
    400,
    'INVALID_PAGINATION',
  );
  error(await send(f, 'GET', '/listings?limit=51'), 400, 'INVALID_PAGINATION');
  error(
    await send(f, 'GET', '/listings?market=unknown'),
    400,
    'INVALID_MARKET',
  );
  f.advance(2 * 86400000 + 1);
  assert.deepEqual((await send(f, 'GET', '/listings')).json().items, []);
  assert.equal(
    f.app.store
      .prepare<unknown[], { n: number }>(
        "SELECT count(*) AS n FROM listings WHERE status = 'expired'",
      )
      .get()!.n,
    3,
  );
});

test('historical lending intents retain creator-only cancellation during RPC outages and across restart', async (t) => {
  const f = await fixture(t);
  const owner = await login(f);
  const lender = await login(f, f.lender);
  const outsider = await login(f, f.outsider);
  const request = seedLegacyRequest(f);
  const proposed = seedLegacyOffer(f, request.id);
  f.positions.set('1', f.position('1', f.outsider.address));
  f.unavailable(true);
  for (const session of [owner, outsider])
    error(
      await send(f, 'DELETE', `/offers/${proposed.id}`, undefined, session),
      403,
      'FORBIDDEN',
    );
  for (const session of [lender, outsider])
    error(
      await send(
        f,
        'DELETE',
        `/loan-requests/${request.id}`,
        undefined,
        session,
      ),
      403,
      'FORBIDDEN',
    );
  assert.equal(
    (
      await send(f, 'DELETE', `/offers/${proposed.id}`, undefined, lender)
    ).json().status,
    'cancelled',
  );
  const second = seedLegacyOffer(f, request.id);
  assert.equal(
    (
      await send(f, 'DELETE', `/loan-requests/${request.id}`, undefined, owner)
    ).json().status,
    'cancelled',
  );
  assert.equal(
    f.app.store
      .prepare<unknown[], { status: string }>(
        'SELECT status FROM offers WHERE id = ?',
      )
      .get(second.id)!.status,
    'invalidated',
  );
  assert.equal(f.reads, 0);
  await f.restart();
  const account = (
    await send(f, 'GET', '/account', undefined, owner)
  ).json<TestAccount>();
  assert.equal(account.loanRequests[0].status, 'cancelled');
  assert.equal(
    account.receivedOffers.find(
      (item: Listing | Offer) => item.id === proposed.id,
    )!.status,
    'cancelled',
  );
  assert.equal(
    account.receivedOffers.find(
      (item: Listing | Offer) => item.id === second.id,
    )!.status,
    'invalidated',
  );
  assert.equal(
    f.app.store
      .prepare<unknown[], { n: number }>(
        "SELECT count(*) AS n FROM audit_events WHERE event IN ('loan-request.cancelled','offer.cancelled','offer.invalidated')",
      )
      .get()!.n,
    3,
  );
});

test('account reads fresh ownership, maintains explicit historical statuses and rejects bad ownership cursors', async (t) => {
  const f = await fixture(t);
  const session = await login(f);
  const created = (
    await send(f, 'POST', '/listings', listing(f), session)
  ).json();
  f.positions.set('1', f.position('1', f.outsider.address));
  const account = (
    await send(f, 'GET', '/account?limit=2', undefined, session)
  ).json<TestAccount>();
  assert.equal(account.address, f.owner.address);
  assert.equal(account.positions.length, 2);
  assert.ok(
    account.positions.every(
      (position: Position) => position.owner === f.owner.address,
    ),
  );
  assert.equal(
    account.listings.find((item: Listing | Offer) => item.id === created.id)!
      .status,
    'invalidated',
  );
  assert.equal(account.historyTruncated, false);
  error(
    await send(f, 'GET', '/account?positionsCursor=bad', undefined, session),
    400,
    'INVALID_PAGINATION',
  );
});

test('legacy borrowers receive only historical proposals on their own requests and outage history remains cancelable', async (t) => {
  const f = await fixture(t);
  const owner = await login(f);
  const lender = await login(f, f.lender);
  const outsider = await login(f, f.outsider);
  const listed = (
    await send(f, 'POST', '/listings', listing(f, '2'), owner)
  ).json();
  const request = seedLegacyRequest(f);
  const proposed = seedLegacyOffer(f, request.id);
  const ownerAccount = (
    await send(f, 'GET', '/account', undefined, owner)
  ).json();
  assert.equal(ownerAccount.receivedOffers[0].id, proposed.id);
  assert.deepEqual(ownerAccount.offers, []);
  assert.deepEqual(
    (await send(f, 'GET', '/account', undefined, outsider)).json()
      .receivedOffers,
    [],
  );
  const lenderAccount = (
    await send(f, 'GET', '/account', undefined, lender)
  ).json();
  assert.equal(lenderAccount.offers[0].id, proposed.id);
  assert.deepEqual(lenderAccount.receivedOffers, []);
  f.unavailable(true);
  const outage = await send(f, 'GET', '/account', undefined, owner);
  assert.equal(outage.statusCode, 200, outage.body);
  assert.equal(outage.json().positionsUnavailable, true);
  assert.deepEqual(outage.json().positions, []);
  assert.equal(outage.json().nextPositionsCursor, null);
  assert.equal(outage.json().listings[0].id, listed.id);
  assert.equal(outage.json().receivedOffers[0].id, proposed.id);
  error(
    await send(f, 'POST', '/listings', listing(f, '3'), owner),
    503,
    'CHAIN_UNAVAILABLE',
  );
  error(await send(f, 'GET', '/listings'), 503, 'CHAIN_UNAVAILABLE');
  assert.equal(
    (
      await send(f, 'DELETE', `/offers/${proposed.id}`, undefined, lender)
    ).json().status,
    'cancelled',
  );
  assert.equal(
    (await send(f, 'DELETE', `/listings/${listed.id}`, undefined, owner)).json()
      .status,
    'cancelled',
  );
  assert.equal(
    (
      await send(f, 'DELETE', `/loan-requests/${request.id}`, undefined, owner)
    ).json().status,
    'cancelled',
  );
});

test('account history is bounded to 500 records and declares truncation', async (t) => {
  const f = await fixture(t);
  const session = await login(f);
  const insert = f.app.store.prepare(
    "INSERT INTO listings(id,market,token_id,owner,price_micros,expires_at,created_at,updated_at,status,position_json) VALUES (?,'kittenswap','1',?,'1000000',?,?,?,'cancelled',?)",
  );
  f.app.store.transaction(() => {
    for (let index = 0; index < 501; index++)
      insert.run(
        randomUUID(),
        f.owner.address,
        f.time + 86400000,
        f.time,
        f.time,
        JSON.stringify(f.position('1')),
      );
  })();
  const account = await send(f, 'GET', '/account', undefined, session);
  assert.equal(account.statusCode, 200, account.body);
  assert.equal(account.json<TestAccount>().listings.length, 500);
  assert.equal(account.json().historyTruncated, true);
});

test('creator pagination retrieves older active listings beyond capped history and allows outage cancellation', async (t) => {
  const f = await fixture(t);
  const session = await login(f);
  const outsider = await login(f, f.outsider);
  const old = (
    await send(f, 'POST', '/listings', listing(f, '1'), session)
  ).json<Listing>();
  f.advance(1000);
  const insert = f.app.store.prepare(
    "INSERT INTO listings(id,market,token_id,owner,price_micros,expires_at,created_at,updated_at,status,position_json) VALUES (?,'kittenswap','1',?,'1000000',?,?,?,'cancelled',?)",
  );
  f.app.store.transaction(() => {
    for (let index = 0; index < 501; index++)
      insert.run(
        randomUUID(),
        f.owner.address,
        f.time + 86400000,
        f.time,
        f.time,
        JSON.stringify(f.position('1')),
      );
  })();
  const recent = (
    await send(f, 'POST', '/listings', listing(f, '2'), session)
  ).json<Listing>();
  f.unavailable(true);
  const account = (
    await send(f, 'GET', '/account', undefined, session)
  ).json<TestAccount>();
  assert.equal(account.positionsUnavailable, true);
  assert.equal(account.historyTruncated, true);
  assert.equal(account.listings.length, 500);
  assert.ok(account.listings.every((item) => item.id !== old.id));
  error(await send(f, 'GET', '/listings'), 503, 'CHAIN_UNAVAILABLE');
  const reads = f.reads;
  const first = await send(
    f,
    'GET',
    '/account/listings?market=kittenswap&limit=1',
    undefined,
    session,
  );
  assert.equal(first.statusCode, 200, first.body);
  assert.equal(first.headers['cache-control'], 'no-store');
  const firstPage = first.json<Page<Listing>>();
  assert.deepEqual(
    firstPage.items.map((item) => item.id),
    [recent.id],
  );
  assert.ok(firstPage.nextCursor);
  const second = await send(
    f,
    'GET',
    `/account/listings?limit=1&cursor=${encodeURIComponent(firstPage.nextCursor)}`,
    undefined,
    session,
  );
  assert.equal(second.statusCode, 200, second.body);
  const secondPage = second.json<Page<Listing>>();
  assert.deepEqual(
    secondPage.items.map((item) => item.id),
    [old.id],
  );
  assert.deepEqual(secondPage.items[0].position, old.position);
  assert.equal(secondPage.nextCursor, null);
  assert.deepEqual(
    (await send(f, 'GET', '/account/listings', undefined, outsider)).json(),
    { items: [], nextCursor: null },
  );
  error(
    await send(f, 'DELETE', `/listings/${old.id}`, undefined, outsider),
    403,
    'FORBIDDEN',
  );
  error(
    await send(f, 'DELETE', `/listings/${old.id}`, undefined, session, {
      'x-csrf-token': '0'.repeat(64),
    }),
    403,
    'CSRF_REJECTED',
  );
  const cancelled = await send(
    f,
    'DELETE',
    `/listings/${old.id}`,
    undefined,
    session,
  );
  assert.equal(cancelled.statusCode, 200, cancelled.body);
  assert.equal(cancelled.json<Listing>().status, 'cancelled');
  const remaining = await send(
    f,
    'GET',
    '/account/listings',
    undefined,
    session,
  );
  assert.deepEqual(
    remaining.json<Page<Listing>>().items.map((item) => item.id),
    [recent.id],
  );
  assert.equal(f.reads, reads);
});

test('creator listing pagination bounds pages and binds signed cursors to owner and route scope', async (t) => {
  const f = await fixture(t);
  const session = await login(f);
  const outsider = await login(f, f.outsider);
  for (const id of ['1', '2', '3']) {
    const created = await send(f, 'POST', '/listings', listing(f, id), session);
    assert.equal(created.statusCode, 200, created.body);
  }
  const publicPage = (await send(f, 'GET', '/listings?limit=1')).json<
    Page<Listing>
  >();
  assert.ok(publicPage.nextCursor);
  f.unavailable(true);
  const reads = f.reads;
  error(await send(f, 'GET', '/account/listings'), 401, 'AUTH_REQUIRED');
  for (const query of [
    'limit=51',
    'limit=0',
    'owner=other',
    'status=cancelled',
  ])
    assert.equal(
      (await send(f, 'GET', `/account/listings?${query}`, undefined, session))
        .statusCode,
      400,
    );
  error(
    await send(f, 'GET', '/account/listings?market=other', undefined, session),
    400,
    'INVALID_MARKET',
  );
  const first = (
    await send(f, 'GET', '/account/listings?limit=1', undefined, session)
  ).json<Page<Listing>>();
  assert.ok(first.nextCursor);
  const cursorPath = `/account/listings?limit=1&cursor=${encodeURIComponent(first.nextCursor)}`;
  error(
    await send(f, 'GET', cursorPath, undefined, outsider),
    400,
    'INVALID_PAGINATION',
  );
  error(
    await send(
      f,
      'GET',
      `/account/listings?cursor=${encodeURIComponent(publicPage.nextCursor ?? '')}`,
      undefined,
      session,
    ),
    400,
    'INVALID_PAGINATION',
  );
  error(
    await send(
      f,
      'GET',
      `/listings?cursor=${encodeURIComponent(first.nextCursor)}`,
    ),
    400,
    'INVALID_PAGINATION',
  );
  const [payload, signature] = first.nextCursor.split('.');
  const decoded: unknown = JSON.parse(
    Buffer.from(payload, 'base64url').toString(),
  );
  assert.ok(
    typeof decoded === 'object' && decoded !== null && !Array.isArray(decoded),
  );
  const forged = Buffer.from(JSON.stringify({ ...decoded, time: 0 })).toString(
    'base64url',
  );
  error(
    await send(
      f,
      'GET',
      `/account/listings?cursor=${forged}.${signature}`,
      undefined,
      session,
    ),
    400,
    'INVALID_PAGINATION',
  );
  const seen = first.items.map((item) => item.id);
  let cursor: string | null = first.nextCursor;
  while (cursor) {
    const response = await send(
      f,
      'GET',
      `/account/listings?limit=1&cursor=${encodeURIComponent(cursor)}`,
      undefined,
      session,
    );
    assert.equal(response.statusCode, 200, response.body);
    const page = response.json<Page<Listing>>();
    seen.push(...page.items.map((item) => item.id));
    cursor = page.nextCursor;
  }
  assert.equal(seen.length, 3);
  assert.equal(new Set(seen).size, 3);
  f.app.store
    .prepare("UPDATE listings SET expires_at = ? WHERE status = 'active'")
    .run(f.time + 1);
  f.advance(2);
  assert.deepEqual(
    (await send(f, 'GET', '/account/listings', undefined, session)).json(),
    { items: [], nextCursor: null },
  );
  assert.equal(f.reads, reads);
});

test('a hanging adapter is bounded by the service timeout and returns a safe unavailable response', async (t) => {
  const f = await fixture(t, { timeoutMs: 10 });
  f.chain.getPosition = () => new Promise(() => {});
  const began = performance.now();
  error(await send(f, 'GET', '/positions/1'), 503, 'CHAIN_UNAVAILABLE');
  assert.ok(performance.now() - began < 1000);
});

test('real WAL SQLite retains session, order, audit and idempotency records across process-like restart', async (t) => {
  const f = await fixture(t);
  const session = await login(f);
  const payload = listing(f);
  const created = (await send(f, 'POST', '/listings', payload, session)).json();
  assert.equal(f.app.store.pragma('journal_mode', { simple: true }), 'wal');
  const auditCount = f.app.store
    .prepare<unknown[], { n: number }>('SELECT count(*) AS n FROM audit_events')
    .get()!.n;
  await f.restart();
  assert.equal(
    (await send(f, 'GET', '/auth/session', undefined, session)).statusCode,
    200,
  );
  assert.deepEqual(
    (await send(f, 'POST', '/listings', payload, session)).json(),
    created,
  );
  assert.equal(
    f.app.store
      .prepare<unknown[], { n: number }>(
        'SELECT count(*) AS n FROM audit_events',
      )
      .get()!.n,
    auditCount,
  );
  assert.equal(
    (await send(f, 'GET', '/listings')).json().items[0].id,
    created.id,
  );
});

test('online SQLite backup includes committed WAL state and restores orders, sessions and audit without overwriting a backup', async (t) => {
  const f = await fixture(t);
  const session = await login(f);
  const created = (
    await send(f, 'POST', '/listings', listing(f), session)
  ).json();
  const destination = join(f.directory, 'restored.sqlite');
  await backupDatabase(f.config.dbPath, destination);
  await assert.rejects(
    backupDatabase(f.config.dbPath, destination),
    /already exists/,
  );
  await assert.rejects(
    backupDatabase(f.config.dbPath, f.config.dbPath),
    /distinct/,
  );
  await f.restart(destination);
  assert.equal(
    (await send(f, 'GET', '/listings')).json().items[0].id,
    created.id,
  );
  assert.equal(
    (await send(f, 'GET', '/auth/session', undefined, session)).statusCode,
    200,
  );
  assert.equal(f.app.store.pragma('integrity_check', { simple: true }), 'ok');
  assert.ok(
    f.app.store
      .prepare<unknown[], { n: number }>(
        'SELECT count(*) AS n FROM audit_events',
      )
      .get()!.n > 0,
  );
});

test('same-origin frontend serving has CSP, immutable hashed assets, index revalidation and path/symlink confinement', async (t) => {
  const f = await fixture(t);
  await mkdir(join(f.config.distPath, 'assets'), { recursive: true });
  await writeFile(
    join(f.config.distPath, 'index.html'),
    '<!doctype html><title>Riftwell</title>',
  );
  await writeFile(
    join(f.config.distPath, 'assets/app-12345678.js'),
    'console.log("local");',
  );
  const secret = join(f.directory, 'private.txt');
  await writeFile(secret, 'private-fixture');
  await symlink(secret, join(f.config.distPath, 'leak.txt'));
  const index = await f.app.inject({ method: 'GET', url: '/' });
  assert.equal(index.statusCode, 200);
  assert.equal(index.headers['cache-control'], 'no-cache');
  assert.ok(
    header(index.headers['content-security-policy']).includes(
      "connect-src 'self'",
    ),
  );
  assert.ok(
    header(index.headers['content-security-policy']).includes(
      "frame-ancestors 'none'",
    ),
  );
  const revalidated = await f.app.inject({
    method: 'GET',
    url: '/',
    headers: { 'if-none-match': index.headers.etag },
  });
  assert.equal(revalidated.statusCode, 304);
  const asset = await f.app.inject({
    method: 'GET',
    url: '/assets/app-12345678.js',
  });
  assert.equal(
    asset.headers['cache-control'],
    'public, max-age=31536000, immutable',
  );
  assert.equal((await f.app.inject({ method: 'HEAD', url: '/' })).body, '');
  for (const path of [
    '/leak.txt',
    '/%2e%2e/private.txt',
    '/.env',
    '/assets/missing.js',
  ]) {
    const blocked = await f.app.inject({ method: 'GET', url: path });
    assert.equal(blocked.statusCode, 404, path);
    assert.ok(!blocked.body.includes('private-fixture'));
  }
});

test('readiness fails on chain unavailability and never exposes RPC credentials; position output is whitelisted', async (t) => {
  const f = await fixture(t);
  assert.equal(
    (await f.app.inject({ method: 'GET', url: '/health/live' })).statusCode,
    200,
  );
  assert.equal(
    (await f.app.inject({ method: 'GET', url: '/health/ready' })).statusCode,
    200,
  );
  f.positions.set(
    '1',
    f.position('1', f.owner.address, { rpcUrl: 'secret-credential' }),
  );
  assert.ok(
    !(await send(f, 'GET', '/positions/1')).body.includes('secret-credential'),
  );
  f.unavailable(true);
  f.advance(5001);
  const ready = await f.app.inject({ method: 'GET', url: '/health/ready' });
  assert.equal(ready.statusCode, 503);
  assert.ok(!ready.body.includes('secret-credential'));
  error(await send(f, 'GET', '/positions/1'), 503, 'CHAIN_UNAVAILABLE');
});

test('encoded API aliases cannot bypass authentication, retirement or disabled financial actions', async (t) => {
  const f = await fixture(t);
  await f.app.listen({ host: '127.0.0.1', port: 0 });
  const address = f.app.server.address();
  assert.ok(address && typeof address !== 'string');
  const port = address.port;
  // Use raw HTTP request targets: URL-based clients normalize dot segments
  // before the server sees them and would miss these routing regressions.
  const wireRequest = (
    method: HTTPMethods,
    url: string,
    payload?: RequestPayload,
    cookie?: string,
  ) =>
    new Promise<ErrorResponse>((resolve, reject) => {
      const body = payload === undefined ? undefined : JSON.stringify(payload);
      const request = httpRequest(
        {
          host: '127.0.0.1',
          port,
          method,
          path: url,
          headers: {
            origin: 'https://attacker.example',
            ...(cookie ? { cookie } : {}),
            ...(body
              ? {
                  'content-type': 'application/json',
                  'content-length': Buffer.byteLength(body),
                }
              : {}),
          },
        },
        (response) => {
          let body = '';
          response.setEncoding('utf8');
          response.on('data', (chunk) => {
            body += chunk;
          });
          response.on('end', () =>
            resolve({
              statusCode: response.statusCode,
              headers: response.headers,
              body,
              json: <T>() => JSON.parse(body) as T,
            }),
          );
          response.on('error', reject);
        },
      );
      request.on('error', reject);
      request.end(body);
    });
  const aliases = (suffix: string) => [
    `/%61pi/v1${suffix}`,
    `/%2561pi/v1${suffix}`,
    `/api%2fv1${suffix}`,
    `/api%252fv1${suffix}`,
    `/%2fapi/v1${suffix}`,
    `/%252fapi/v1${suffix}`,
    `//api/v1${suffix}`,
    `/api//v1${suffix}`,
    `/api/v1/%2e%2e/v1${suffix}`,
    `/ignored/%2e%2e/%61pi/v1${suffix}`,
  ];
  const rejectAliases = async (
    method: HTTPMethods,
    suffix: string,
    payload?: RequestPayload,
    cookie?: string,
  ) => {
    for (const url of aliases(suffix)) {
      const response = await wireRequest(method, url, payload, cookie);
      assert.equal(response.statusCode, 400, `${url}: ${response.body}`);
      error(response, 400, 'NON_CANONICAL_PATH');
      assert.equal(response.headers['cache-control'], 'no-store', url);
      assert.ok(!response.body.includes('csrfToken'), url);
    }
  };
  await rejectAliases('POST', '/auth/challenge', {
    address: f.owner.address,
    chainId: 999,
  });
  assert.equal(
    f.app.store
      .prepare<unknown[], { n: number }>('SELECT count(*) AS n FROM challenges')
      .get()!.n,
    0,
  );
  const issued = await challenge(f);
  const payload = {
    challengeId: issued.challengeId,
    signature: await f.owner.signMessage(issued.message),
  };
  await rejectAliases('POST', '/auth/verify', payload);
  assert.equal(
    f.app.store
      .prepare<unknown[], { consumed_at: number | null }>(
        'SELECT consumed_at FROM challenges WHERE id = ?',
      )
      .get(issued.challengeId)!.consumed_at,
    null,
  );
  assert.equal(
    f.app.store
      .prepare<unknown[], { n: number }>('SELECT count(*) AS n FROM sessions')
      .get()!.n,
    0,
  );
  const verified = await send(f, 'POST', '/auth/verify', payload);
  assert.equal(verified.statusCode, 200, verified.body);
  await rejectAliases(
    'GET',
    '/auth/session',
    undefined,
    header(verified.headers['set-cookie']).split(';')[0],
  );
  await rejectAliases('POST', '/settlement', { action: 'fund-loan' });
  await rejectAliases('GET', '/lending');
  await rejectAliases('POST', '/lending/actions', { action: 'supply' });
  await rejectAliases('GET', '/loan-requests');
  await rejectAliases('POST', '/loan-requests', borrowing(f));
  await rejectAliases('POST', '/offers', offer(f, randomUUID()));
  for (const url of ['/api/v1/auth/%63hallenge', '/api/v1/%61uth/challenge'])
    error(
      await wireRequest('POST', url, {
        address: f.owner.address,
        chainId: 999,
      }),
      400,
      'NON_CANONICAL_PATH',
    );
  assert.equal(f.reads, 0);
});

test('readiness shares one in-flight probe and caches healthy and failed results for at most five seconds', async (t) => {
  const f = await fixture(t);
  let calls = 0;
  let resolveProbe: (result: ChainHealth) => void = () =>
    assert.fail('Probe not started');
  f.chain.health = () => {
    calls++;
    return new Promise((resolve) => {
      resolveProbe = resolve;
    });
  };
  const pending = Array.from({ length: 20 }, () =>
    f.app.inject({ method: 'GET', url: '/health/ready' }),
  );
  // Starting every request before releasing the adapter exposes duplicate probes.
  const started = pending.map((request) =>
    request.then((response) => response),
  );
  await new Promise(setImmediate);
  assert.equal(calls, 1);
  resolveProbe({ ready: true, available: true, chainId: 999 });
  assert.ok(
    (await Promise.all(started)).every(
      (response) => response.statusCode === 200,
    ),
  );
  assert.equal(
    (await f.app.inject({ method: 'GET', url: '/health/ready' })).statusCode,
    200,
  );
  assert.equal(calls, 1);
  f.chain.health = async () => {
    calls++;
    return { ready: false, available: false, chainId: 999 };
  };
  f.advance(5001);
  assert.equal(
    (await f.app.inject({ method: 'GET', url: '/health/ready' })).statusCode,
    503,
  );
  assert.equal(
    (await f.app.inject({ method: 'GET', url: '/health/ready' })).statusCode,
    503,
  );
  assert.equal(calls, 2);
  f.chain.health = async () => {
    calls++;
    return { ready: true, available: true, chainId: 999 };
  };
  f.advance(5001);
  assert.equal(
    (await f.app.inject({ method: 'GET', url: '/health/ready' })).statusCode,
    200,
  );
  assert.equal(calls, 3);
});

test('readiness throttles each caller while sharing cached probes across caller IPs and rejecting encoded health aliases', async (t) => {
  const f = await fixture(t);
  let calls = 0;
  f.chain.health = async () => {
    calls++;
    return { ready: true, available: true, chainId: 999 };
  };
  for (let index = 0; index < 30; index++)
    assert.equal(
      (await f.app.inject({ method: 'GET', url: '/health/ready' })).statusCode,
      200,
    );
  error(
    await f.app.inject({ method: 'GET', url: '/health/ready' }),
    429,
    'RATE_LIMITED',
  );
  assert.equal(calls, 1);
  assert.equal(
    (
      await f.app.inject({
        method: 'GET',
        url: '/health/ready',
        remoteAddress: '203.0.113.10',
      })
    ).statusCode,
    200,
  );
  assert.equal(calls, 1);
  for (const url of [
    '/%68ealth/ready',
    '/%2568ealth/ready',
    '/health%2fready',
    '//health/ready',
  ])
    error(
      await f.app.inject({ method: 'GET', url }),
      400,
      'NON_CANONICAL_PATH',
    );
  assert.equal(calls, 1);
  f.advance(60001);
  assert.equal(
    (await f.app.inject({ method: 'GET', url: '/health/ready' })).statusCode,
    200,
  );
  assert.equal(calls, 2);
});

test('authentication rate limits and bounded limiter storage prevent unbounded challenge or memory growth', async (t) => {
  const f = await fixture(t);
  for (let index = 0; index < 10; index++) await challenge(f);
  error(
    await send(f, 'POST', '/auth/challenge', {
      address: f.owner.address,
      chainId: 999,
    }),
    429,
    'RATE_LIMITED',
  );
  assert.equal(
    f.app.store
      .prepare<unknown[], { n: number }>('SELECT count(*) AS n FROM challenges')
      .get()!.n,
    10,
  );
  let now = 0;
  const limiter = new RateLimiter(() => now, 2);
  limiter.take('one', 1, 100);
  limiter.take('two', 1, 100);
  assert.throws(
    () => limiter.take('three', 1, 100),
    (error: unknown) =>
      error instanceof Error && 'status' in error && error.status === 429,
  );
  assert.equal(limiter.entries.size, 2);
  now = 101;
  limiter.take('three', 1, 100);
  assert.equal(limiter.entries.size, 1);
});

test('production configuration requires durable storage, HTTPS origin, explicit secrets and an operator RPC', () => {
  assert.throws(() => loadConfig({ NODE_ENV: 'production' }), /required/);
  const env = {
    NODE_ENV: 'production',
    APP_ORIGIN: origin,
    DB_PATH: '/data/riftwell.sqlite',
    SESSION_SECRET: 's'.repeat(64),
    HYPEREVM_RPC_URL: 'https://rpc.example',
  };
  assert.equal(loadConfig(env).production, true);
  for (const changes of [
    { APP_ORIGIN: 'http://riftwell.example' },
    { APP_ORIGIN: `${origin}/path` },
    { DB_PATH: '/tmp/state.sqlite' },
    { DB_PATH: 'relative.sqlite' },
    { SESSION_SECRET: 'short' },
    { TRUST_PROXY: '*' },
  ])
    assert.throws(() => loadConfig({ ...env, ...changes }));
});

test('listing repricing keeps identity, exact terms and original retry snapshots across later edits', async (t) => {
  const f = await fixture(t);
  const session = await login(f);
  const input = listing(f);
  const original = (await send(f, 'POST', '/listings', input, session)).json();
  assert.equal(original.revision, 1);
  assert.equal(original.updatedAt, original.createdAt);
  f.advance(1000);
  f.positions.set('1', {
    ...f.positions.get('1')!,
    votingPowerRaw: '0',
    observedAt: iso(f.time),
  });
  const update = listingUpdate(f, original, { priceMicros: '9999999' });
  const response = await send(
    f,
    'PATCH',
    `/listings/${original.id}`,
    update,
    session,
  );
  assert.equal(response.statusCode, 200, response.body);
  const edited = response.json();
  assert.equal(edited.id, original.id);
  assert.equal(edited.createdAt, original.createdAt);
  assert.equal(edited.updatedAt, iso(f.time));
  assert.equal(edited.revision, 2);
  assert.equal(edited.priceMicros, '9999999');
  assert.equal(edited.position.votingPowerRaw, '0');
  const audit = f.app.store
    .prepare<unknown[], { detail_json: string }>(
      "SELECT * FROM audit_events WHERE event = 'listing.updated'",
    )
    .get()!;
  assert.deepEqual(JSON.parse(audit.detail_json), {
    previous: {
      priceMicros: original.priceMicros,
      expiresAt: original.expiresAt,
      revision: 1,
    },
    next: {
      priceMicros: edited.priceMicros,
      expiresAt: edited.expiresAt,
      revision: 2,
    },
    previousTerms: listingTermsSnapshot(original),
    nextTerms: listingTermsSnapshot(edited),
  });
  assert.deepEqual(
    (
      await send(f, 'PATCH', `/listings/${original.id}`, update, session)
    ).json(),
    edited,
  );
  error(
    await send(
      f,
      'PATCH',
      `/listings/${original.id}`,
      { ...update, priceMicros: '10000000' },
      session,
    ),
    409,
    'IDEMPOTENCY_CONFLICT',
  );
  const later = (
    await send(
      f,
      'PATCH',
      `/listings/${original.id}`,
      listingUpdate(f, edited),
      session,
    )
  ).json();
  assert.equal(later.revision, 3);
  assert.deepEqual(
    (
      await send(f, 'PATCH', `/listings/${original.id}`, update, session)
    ).json(),
    edited,
  );
  assert.deepEqual(
    (await send(f, 'POST', '/listings', input, session)).json(),
    original,
  );
  assert.deepEqual(
    (await send(f, 'GET', `/listings/${original.id}`)).json(),
    later,
  );
  assert.equal(
    f.app.store
      .prepare<unknown[], { n: number }>(
        "SELECT count(*) AS n FROM audit_events WHERE event = 'listing.updated'",
      )
      .get()!.n,
    2,
  );
  await f.restart();
  assert.deepEqual(
    (await send(f, 'GET', '/account', undefined, session)).json().listings[0],
    later,
  );
  assert.deepEqual(
    (
      await send(f, 'PATCH', `/listings/${original.id}`, update, session)
    ).json(),
    edited,
  );
});

test('concurrent listing retries edit once and competing revisions cannot overwrite each other', async (t) => {
  const f = await fixture(t);
  const session = await login(f);
  const original = (
    await send(f, 'POST', '/listings', listing(f), session)
  ).json();
  const update = listingUpdate(f, original);
  const retries = await Promise.all([
    send(f, 'PATCH', `/listings/${original.id}`, update, session),
    send(f, 'PATCH', `/listings/${original.id}`, update, session),
  ]);
  assert.deepEqual(
    retries.map((value) => value.statusCode),
    [200, 200],
  );
  assert.deepEqual(retries[0].json(), retries[1].json());
  const second = retries[0].json();
  const competing = await Promise.all([
    send(
      f,
      'PATCH',
      `/listings/${original.id}`,
      listingUpdate(f, second, { priceMicros: '1000000' }),
      session,
    ),
    send(
      f,
      'PATCH',
      `/listings/${original.id}`,
      listingUpdate(f, second, { priceMicros: '1000000000000' }),
      session,
    ),
  ]);
  assert.deepEqual(
    competing.map((value) => value.statusCode).sort(),
    [200, 409],
  );
  assert.equal(
    competing.find((value) => value.statusCode === 409)!.json().error.code,
    'LISTING_CHANGED',
  );
  const current = (await send(f, 'GET', `/listings/${original.id}`)).json();
  assert.equal(current.revision, 3);
  assert.equal(
    current.priceMicros,
    competing.find((value) => value.statusCode === 200)!.json().priceMicros,
  );
  assert.equal(
    f.app.store
      .prepare<unknown[], { n: number }>(
        "SELECT count(*) AS n FROM audit_events WHERE event = 'listing.updated'",
      )
      .get()!.n,
    2,
  );
});

test('listing edits enforce mutation security, exact terms and immutable creator authority', async (t) => {
  const f = await fixture(t);
  const session = await login(f);
  const outsider = await login(f, f.outsider);
  const original = (
    await send(f, 'POST', '/listings', listing(f), session)
  ).json();
  const update = listingUpdate(f, original);
  const beforeReads = f.reads;
  error(
    await send(f, 'PATCH', `/listings/${original.id}`, update),
    401,
    'AUTH_REQUIRED',
  );
  error(
    await send(f, 'PATCH', `/listings/${original.id}`, update, session, {
      origin: 'https://attacker.example',
    }),
    403,
    'ORIGIN_REJECTED',
  );
  error(
    await send(f, 'PATCH', `/listings/${original.id}`, update, session, {
      'x-csrf-token': '0'.repeat(64),
    }),
    403,
    'CSRF_REJECTED',
  );
  error(
    await send(f, 'PATCH', `/listings/${original.id}`, update, outsider),
    403,
    'NOT_OWNER',
  );
  for (const expectedRevision of [0, -1, 1.5, '1', Number.MAX_SAFE_INTEGER])
    error(
      await send(
        f,
        'PATCH',
        `/listings/${original.id}`,
        { ...update, expectedRevision },
        session,
      ),
      400,
      'INVALID_REVISION',
    );
  for (const priceMicros of [
    '0990000000',
    '999999',
    '1000000000001',
    1000000,
    '1e6',
  ])
    error(
      await send(
        f,
        'PATCH',
        `/listings/${original.id}`,
        { ...update, priceMicros },
        session,
      ),
      400,
      'INVALID_AMOUNT',
    );
  error(
    await send(
      f,
      'PATCH',
      `/listings/${original.id}`,
      { ...update, expiresAt: iso(f.time) },
      session,
    ),
    400,
    'INVALID_EXPIRY',
  );
  for (const extra of [
    { tokenId: '2' },
    { owner: f.outsider.address },
    { startsAt: iso(f.time) },
    { startPriceMicros: '1000000' },
  ])
    error(
      await send(
        f,
        'PATCH',
        `/listings/${original.id}`,
        { ...update, ...extra },
        session,
      ),
      400,
      'UNKNOWN_FIELD',
    );
  error(
    await send(f, 'PATCH', `/listings/${randomUUID()}`, update, session),
    404,
    'ORDER_NOT_FOUND',
  );
  assert.equal(f.reads, beforeReads);
  assert.deepEqual(
    (await send(f, 'GET', `/listings/${original.id}`)).json(),
    original,
  );
});

test('an awaited listing edit cannot resurrect a cancellation or use a revoked session', async (t) => {
  const f = await fixture(t);
  let session = await login(f);
  let original = (
    await send(f, 'POST', '/listings', listing(f), session)
  ).json();
  const originalRead = f.chain.getPosition;
  async function pauseEdit(record: Listing, activeSession: TestSession) {
    let enter: () => void = () => assert.fail('Gate not initialized');
    let release: () => void = () => assert.fail('Gate not initialized');
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    f.chain.getPosition = async (id) => {
      enter();
      await gate;
      return originalRead(id);
    };
    const response = send(
      f,
      'PATCH',
      `/listings/${record.id}`,
      listingUpdate(f, record),
      activeSession,
    );
    await entered;
    return { response, release };
  }
  const cancelledEdit = await pauseEdit(original, session);
  const cancelled = (
    await send(f, 'DELETE', `/listings/${original.id}`, undefined, session)
  ).json();
  assert.equal(cancelled.revision, 2);
  cancelledEdit.release();
  error(await cancelledEdit.response, 409, 'ORDER_INACTIVE');
  f.chain.getPosition = originalRead;
  original = (
    await send(
      f,
      'POST',
      '/listings',
      listing(f, '1', { expiresAt: iso(f.time + 1000) }),
      session,
    )
  ).json();
  const expiredEdit = await pauseEdit(original, session);
  f.advance(1001);
  expiredEdit.release();
  error(await expiredEdit.response, 409, 'ORDER_INACTIVE');
  const expired = f.app.store
    .prepare<unknown[], { status: string }>(
      'SELECT status, revision FROM listings WHERE id = ?',
    )
    .get(original.id)!;
  assert.deepEqual(expired, { status: 'expired', revision: 2 });
  f.chain.getPosition = originalRead;
  original = (await send(f, 'POST', '/listings', listing(f), session)).json();
  const revokedEdit = await pauseEdit(original, session);
  assert.equal(
    (await send(f, 'POST', '/auth/logout', {}, session)).statusCode,
    200,
  );
  revokedEdit.release();
  error(await revokedEdit.response, 401, 'AUTH_REQUIRED');
  f.chain.getPosition = originalRead;
  session = await login(f);
  assert.deepEqual(
    (await send(f, 'GET', `/listings/${original.id}`)).json(),
    original,
  );
  assert.equal(
    f.app.store
      .prepare<unknown[], { n: number }>(
        "SELECT count(*) AS n FROM audit_events WHERE event = 'listing.updated'",
      )
      .get()!.n,
    0,
  );
});

test('listing detail and repricing reject ownership loss; outage retains history and creator cancellation', async (t) => {
  const f = await fixture(t);
  const session = await login(f);
  const nextOwner = await login(f, f.lender);
  const original = (
    await send(f, 'POST', '/listings', listing(f), session)
  ).json();
  f.positions.set('1', { ...f.positions.get('1')!, owner: f.lender.address });
  error(
    await send(
      f,
      'PATCH',
      `/listings/${original.id}`,
      listingUpdate(f, original),
      session,
    ),
    409,
    'ORDER_INACTIVE',
  );
  error(
    await send(
      f,
      'PATCH',
      `/listings/${original.id}`,
      listingUpdate(f, original),
      nextOwner,
    ),
    403,
    'NOT_OWNER',
  );
  error(
    await send(f, 'GET', `/listings/${original.id}`),
    409,
    'ORDER_INACTIVE',
  );
  const invalidated = f.app.store
    .prepare<unknown[], ListingRow>('SELECT * FROM listings WHERE id = ?')
    .get(original.id)!;
  assert.equal(invalidated.status, 'invalidated');
  assert.equal(invalidated.revision, 2);
  const second = (
    await send(f, 'POST', '/listings', listing(f, '2'), session)
  ).json();
  f.unavailable(true);
  error(
    await send(f, 'GET', `/listings/${second.id}`),
    503,
    'CHAIN_UNAVAILABLE',
  );
  error(
    await send(
      f,
      'PATCH',
      `/listings/${second.id}`,
      listingUpdate(f, second),
      session,
    ),
    503,
    'CHAIN_UNAVAILABLE',
  );
  assert.equal(
    f.app.store
      .prepare<unknown[], { revision: number }>(
        'SELECT revision FROM listings WHERE id = ?',
      )
      .get(second.id)!.revision,
    1,
  );
  f.advance(1000);
  const cancelled = (
    await send(f, 'DELETE', `/listings/${second.id}`, undefined, session)
  ).json();
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.revision, 2);
  assert.equal(cancelled.updatedAt, iso(f.time));
  assert.deepEqual(
    (
      await send(f, 'DELETE', `/listings/${second.id}`, undefined, session)
    ).json(),
    cancelled,
  );
  error(await send(f, 'GET', `/listings/${second.id}`), 409, 'ORDER_INACTIVE');
  const account = (
    await send(f, 'GET', '/account', undefined, session)
  ).json<TestAccount>();
  assert.equal(account.positionsUnavailable, true);
  assert.equal(
    account.listings.find((value: Listing) => value.id === second.id)!.revision,
    2,
  );
  assert.equal(
    account.listings.find((value: Listing) => value.id === original.id)!.status,
    'invalidated',
  );
  error(
    await send(f, 'GET', `/listings/${randomUUID()}`),
    404,
    'ORDER_NOT_FOUND',
  );
});

test('listing filters compare numeric prices exactly and bind cursors to normalized query terms', async (t) => {
  const f = await fixture(t);
  const session = await login(f);
  const outsider = await login(f, f.outsider);
  f.positions.set('4', { ...f.positions.get('4')!, owner: f.outsider.address });
  for (const [tokenId, priceMicros] of [
    ['1', '9000000'],
    ['2', '100000000'],
    ['3', '10000000'],
    ['4', '1000000000000'],
  ]) {
    const created = await send(
      f,
      'POST',
      '/listings',
      listing(f, tokenId, { priceMicros }),
      tokenId === '4' ? outsider : session,
    );
    assert.equal(created.statusCode, 200, created.body);
    f.advance(1);
  }
  const query = `seller=${f.owner.address.toLowerCase()}&minPriceMicros=9000000&maxPriceMicros=100000000`;
  const first = (await send(f, 'GET', `/listings?${query}&limit=1`)).json();
  assert.deepEqual(
    first.items.map((value: Listing) => value.tokenId),
    ['3'],
  );
  const second = (
    await send(
      f,
      'GET',
      `/listings?${query.replace(f.owner.address.toLowerCase(), f.owner.address)}&market=kittenswap&limit=1&cursor=${first.nextCursor}`,
    )
  ).json();
  assert.deepEqual(
    second.items.map((value: Listing) => value.tokenId),
    ['2'],
  );
  const third = (
    await send(
      f,
      'GET',
      `/listings?${query}&limit=1&cursor=${second.nextCursor}`,
    )
  ).json();
  assert.deepEqual(
    third.items.map((value: Listing) => value.tokenId),
    ['1'],
  );
  assert.equal(third.nextCursor, null);
  assert.deepEqual(
    (await send(f, 'GET', '/listings?tokenId=2'))
      .json()
      .items.map((value: Listing) => value.tokenId),
    ['2'],
  );
  assert.deepEqual(
    (await send(f, 'GET', `/listings?seller=${f.outsider.address}`))
      .json()
      .items.map((value: Listing) => value.tokenId),
    ['4'],
  );
  const beforeReads = f.reads;
  for (const changed of [
    query.replace('9000000', '10000000'),
    query.replace(f.owner.address.toLowerCase(), f.outsider.address),
    `${query}&tokenId=1`,
  ])
    error(
      await send(f, 'GET', `/listings?${changed}&cursor=${first.nextCursor}`),
      400,
      'INVALID_PAGINATION',
    );
  error(
    await send(
      f,
      'GET',
      '/listings?minPriceMicros=10000000&maxPriceMicros=9000000',
    ),
    400,
    'INVALID_AMOUNT',
  );
  error(
    await send(f, 'GET', '/listings?seller=attacker'),
    400,
    'INVALID_ADDRESS',
  );
  error(await send(f, 'GET', '/listings?tokenId=01'), 400, 'INVALID_TOKEN_ID');
  error(
    await send(f, 'GET', '/listings?minPriceMicros=1e6'),
    400,
    'INVALID_AMOUNT',
  );
  error(await send(f, 'GET', '/listings?sort=price-asc'), 400, 'UNKNOWN_FIELD');
  assert.equal(f.reads, beforeReads);
});

test('a concurrent reprice cannot escape price filters while ownership verification waits', async (t) => {
  const f = await fixture(t);
  const session = await login(f);
  const original = (
    await send(
      f,
      'POST',
      '/listings',
      listing(f, '1', { priceMicros: '9000000' }),
      session,
    )
  ).json();
  let enter: () => void = () => assert.fail('Gate not initialized');
  let release: () => void = () => assert.fail('Gate not initialized');
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const originalBatch = f.chain.getPositions;
  f.chain.getPositions = async (ids) => {
    enter();
    await gate;
    return originalBatch(ids);
  };
  const pending = send(f, 'GET', '/listings?maxPriceMicros=10000000');
  await entered;
  const updated = await send(
    f,
    'PATCH',
    `/listings/${original.id}`,
    listingUpdate(f, original, { priceMicros: '100000000' }),
    session,
  );
  assert.equal(updated.statusCode, 200, updated.body);
  release();
  const page = await pending;
  assert.equal(page.statusCode, 200, page.body);
  assert.deepEqual(page.json(), { items: [], nextCursor: null });
});

test('schema migration adds listing revisions without rewriting create snapshots or histories', async (t) => {
  const f = await fixture(t);
  const session = await login(f);
  const input = listing(f);
  const created = (await send(f, 'POST', '/listings', input, session)).json();
  const legacySnapshot = { ...created };
  delete legacySnapshot.revision;
  delete legacySnapshot.updatedAt;
  for (const field of Object.keys(listingTermsSnapshot(created)))
    delete legacySnapshot[field];
  f.app.store
    .prepare('UPDATE idempotency SET response_json = ? WHERE key = ?')
    .run(JSON.stringify(legacySnapshot), input.idempotencyKey);
  f.app.store.exec(
    'ALTER TABLE listings DROP COLUMN revision; ALTER TABLE listings DROP COLUMN kind; ALTER TABLE listings DROP COLUMN end_price_micros; ALTER TABLE listings DROP COLUMN starts_at; ALTER TABLE listings DROP COLUMN auction_ends_at; ALTER TABLE listings DROP COLUMN recipient; PRAGMA user_version = 1;',
  );
  const beforeIdempotency = f.app.store
    .prepare<unknown[], IdempotencyRow>('SELECT * FROM idempotency')
    .all();
  const beforeAudit = f.app.store
    .prepare<unknown[], { detail_json: string }>('SELECT * FROM audit_events')
    .all();
  await f.restart();
  assert.equal(f.app.store.pragma('user_version', { simple: true }), 3);
  assert.deepEqual(
    (await send(f, 'POST', '/listings', input, session)).json(),
    created,
  );
  assert.deepEqual(
    f.app.store
      .prepare<unknown[], IdempotencyRow>('SELECT * FROM idempotency')
      .all(),
    beforeIdempotency,
  );
  assert.deepEqual(
    f.app.store
      .prepare<unknown[], { detail_json: string }>('SELECT * FROM audit_events')
      .all(),
    beforeAudit,
  );
  assert.deepEqual(
    (await send(f, 'GET', `/listings/${created.id}`)).json(),
    created,
  );
  const response = await send(
    f,
    'PATCH',
    `/listings/${created.id}`,
    listingUpdate(f, created),
    session,
  );
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().revision, 2);
});

test('listing creation rechecks a session revoked while the ownership read waits', async (t) => {
  const f = await fixture(t);
  const session = await login(f);
  let enter: () => void = () => assert.fail('Gate not initialized');
  let release: () => void = () => assert.fail('Gate not initialized');
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const originalRead = f.chain.getPosition;
  f.chain.getPosition = async (id) => {
    enter();
    await gate;
    return originalRead(id);
  };
  const pending = send(f, 'POST', '/listings', listing(f), session);
  await entered;
  assert.equal(
    (await send(f, 'POST', '/auth/logout', {}, session)).statusCode,
    200,
  );
  release();
  error(await pending, 401, 'AUTH_REQUIRED');
  assert.equal(
    f.app.store
      .prepare<unknown[], { n: number }>('SELECT count(*) AS n FROM listings')
      .get()!.n,
    0,
  );
  assert.equal(
    f.app.store
      .prepare<unknown[], { n: number }>(
        'SELECT count(*) AS n FROM idempotency',
      )
      .get()!.n,
    0,
  );
});

test('matching listing retries retain their snapshots after original expiry when later edits extend the active listing', async (t) => {
  const f = await fixture(t);
  const session = await login(f);
  const input = listing(f, '1', { expiresAt: iso(f.time + 1000) });
  const original = (await send(f, 'POST', '/listings', input, session)).json();
  const update = listingUpdate(f, original, { expiresAt: iso(f.time + 2000) });
  const edited = (
    await send(f, 'PATCH', `/listings/${original.id}`, update, session)
  ).json();
  const current = (
    await send(
      f,
      'PATCH',
      `/listings/${original.id}`,
      listingUpdate(f, edited),
      session,
    )
  ).json();
  f.advance(3000);
  assert.deepEqual(
    (await send(f, 'POST', '/listings', input, session)).json(),
    original,
  );
  assert.deepEqual(
    (
      await send(f, 'PATCH', `/listings/${original.id}`, update, session)
    ).json(),
    edited,
  );
  assert.deepEqual(
    (await send(f, 'GET', `/listings/${original.id}`)).json(),
    current,
  );
  error(
    await send(
      f,
      'PATCH',
      `/listings/${original.id}`,
      {
        ...update,
        idempotencyKey: randomUUID(),
        expectedRevision: current.revision,
      },
      session,
    ),
    400,
    'INVALID_EXPIRY',
  );
  error(
    await send(
      f,
      'POST',
      '/listings',
      { ...input, idempotencyKey: randomUUID() },
      session,
    ),
    400,
    'INVALID_EXPIRY',
  );
  await send(f, 'DELETE', `/listings/${original.id}`, undefined, session);
  error(
    await send(f, 'PATCH', `/listings/${original.id}`, update, session),
    409,
    'ORDER_INACTIVE',
  );
  error(
    await send(f, 'POST', '/listings', input, session),
    409,
    'ORDER_INACTIVE',
  );
  assert.equal(
    f.app.store
      .prepare<unknown[], { n: number }>(
        "SELECT count(*) AS n FROM audit_events WHERE event = 'listing.updated'",
      )
      .get()!.n,
    2,
  );
});

test('Dutch listing asks decay cubically with exact floor rounding and separate terminal expiry', async (t) => {
  const f = await fixture(t);
  const session = await login(f);
  const original = (
    await send(f, 'POST', '/listings', dutchListing(f), session)
  ).json();
  assert.equal(original.priceMicros, '10000000000');
  assert.equal(original.startPriceMicros, '10000000000');
  assert.equal(original.endPriceMicros, '2000000000');
  assert.equal(original.startsAt, iso(f.time));
  assert.equal(original.kind, 'dutch');
  f.advance(86400000 / 2);
  assert.equal(
    (await send(f, 'GET', `/listings/${original.id}`)).json().priceMicros,
    '3000000000',
  );
  f.advance(86400000 / 2);
  assert.equal(
    (await send(f, 'GET', `/listings/${original.id}`)).json().priceMicros,
    '2000000000',
  );
  f.advance(2 * 86400000);
  assert.equal(
    (await send(f, 'GET', `/listings/${original.id}`)).json().priceMicros,
    '2000000000',
  );
  f.advance(4 * 86400000);
  error(
    await send(f, 'GET', `/listings/${original.id}`),
    409,
    'ORDER_INACTIVE',
  );
  assert.deepEqual(
    f.app.store
      .prepare<unknown[], { status: string }>(
        'SELECT status, revision FROM listings WHERE id = ?',
      )
      .get(original.id)!,
    { status: 'expired', revision: 2 },
  );
});

test('Dutch precision rounds sub-micro premiums down without changing stored starting terms', async (t) => {
  const f = await fixture(t);
  const session = await login(f);
  const original = (
    await send(
      f,
      'POST',
      '/listings',
      dutchListing(f, '1', {
        priceMicros: '1000001',
        endPriceMicros: '1000000',
        auctionEndsAt: iso(f.time + 3),
      }),
      session,
    )
  ).json();
  assert.equal(original.priceMicros, '1000001');
  for (const increment of [1, 1, 1]) {
    f.advance(increment);
    const current = (await send(f, 'GET', `/listings/${original.id}`)).json();
    assert.equal(current.priceMicros, '1000000');
    assert.equal(current.startPriceMicros, '1000001');
    assert.equal(current.revision, 1);
  }
});

test('Dutch edits reset server start time and preserve immutable retry snapshots; reservations remain public intent', async (t) => {
  const f = await fixture(t);
  let session = await login(f);
  const input = dutchListing(f, '1', {
    recipient: f.lender.address.toLowerCase(),
  });
  const original = (await send(f, 'POST', '/listings', input, session)).json();
  assert.equal(original.recipient, f.lender.address);
  assert.equal(
    (await send(f, 'GET', `/listings/${original.id}`)).json().recipient,
    f.lender.address,
  );
  f.advance(86400000 / 2);
  session = await login(f);
  assert.equal(
    (await send(f, 'GET', `/listings/${original.id}`)).json().priceMicros,
    '3000000000',
  );
  assert.deepEqual(
    (
      await send(
        f,
        'POST',
        '/listings',
        { ...input, recipient: f.lender.address },
        session,
      )
    ).json(),
    original,
  );
  error(
    await send(
      f,
      'POST',
      '/listings',
      { ...input, recipient: f.outsider.address },
      session,
    ),
    409,
    'IDEMPOTENCY_CONFLICT',
  );
  const update = listingUpdate(f, original, {
    kind: 'dutch',
    priceMicros: '8000000000',
    endPriceMicros: '1000000000',
    auctionEndsAt: iso(f.time + 86400000),
    recipient: f.outsider.address,
  });
  const edited = (
    await send(f, 'PATCH', `/listings/${original.id}`, update, session)
  ).json();
  assert.equal(edited.startsAt, iso(f.time));
  assert.equal(edited.priceMicros, '8000000000');
  assert.equal(edited.revision, 2);
  f.advance(86400000);
  assert.equal(
    (await send(f, 'GET', `/listings/${original.id}`)).json().priceMicros,
    '1000000000',
  );
  const restored = await login(f);
  assert.deepEqual(
    (await send(f, 'POST', '/listings', input, restored)).json(),
    original,
  );
  assert.deepEqual(
    (
      await send(f, 'PATCH', `/listings/${original.id}`, update, restored)
    ).json(),
    edited,
  );
  const fixed = (
    await send(
      f,
      'PATCH',
      `/listings/${original.id}`,
      listingUpdate(f, edited),
      restored,
    )
  ).json();
  assert.equal(fixed.kind, 'fixed');
  assert.equal(fixed.startPriceMicros, fixed.endPriceMicros);
  assert.equal(fixed.auctionEndsAt, null);
  assert.equal(fixed.recipient, null);
  assert.equal(fixed.startsAt, iso(f.time));
  assert.equal(fixed.revision, 3);
  assert.equal(
    f.app.store
      .prepare<unknown[], { n: number }>(
        "SELECT count(*) AS n FROM audit_events WHERE event = 'listing.updated'",
      )
      .get()!.n,
    2,
  );
});

test('Dutch durations and reserved buyers are strictly validated before any ownership reads or writes', async (t) => {
  const f = await fixture(t);
  const session = await login(f);
  const invalid: readonly (readonly [Record<string, unknown>, string])[] = [
    [{ kind: null }, 'INVALID_LISTING_KIND'],
    [{ kind: 'auction' }, 'INVALID_LISTING_KIND'],
    [{ endPriceMicros: undefined }, 'INVALID_AMOUNT'],
    [{ endPriceMicros: '10000000001' }, 'INVALID_AMOUNT'],
    [{ endPriceMicros: '999999' }, 'INVALID_AMOUNT'],
    [{ auctionEndsAt: undefined }, 'INVALID_AUCTION'],
    [{ auctionEndsAt: iso(f.time) }, 'INVALID_AUCTION'],
    [{ auctionEndsAt: iso(f.time + 8 * 86400000) }, 'INVALID_AUCTION'],
    [
      {
        expiresAt: iso(f.time + 31 * 86400000),
        auctionEndsAt: iso(f.time + 31 * 86400000),
      },
      'INVALID_EXPIRY',
    ],
    [{ recipient: f.owner.address }, 'INVALID_RECIPIENT'],
    [{ recipient: `0x${'0'.repeat(40)}` }, 'INVALID_RECIPIENT'],
    [{ recipient: 'private-buyer' }, 'INVALID_ADDRESS'],
    [{ startsAt: iso(f.time - 86400000) }, 'UNKNOWN_FIELD'],
  ];
  for (const [extra, code] of invalid)
    error(
      await send(f, 'POST', '/listings', dutchListing(f, '1', extra), session),
      400,
      code,
    );
  error(
    await send(
      f,
      'POST',
      '/listings',
      listing(f, '1', { endPriceMicros: '1000000' }),
      session,
    ),
    400,
    'INVALID_AMOUNT',
  );
  error(
    await send(
      f,
      'POST',
      '/listings',
      listing(f, '1', { auctionEndsAt: iso(f.time + 86400000) }),
      session,
    ),
    400,
    'INVALID_AUCTION',
  );
  assert.equal(f.reads, 0);
  assert.equal(
    f.app.store
      .prepare<unknown[], { n: number }>('SELECT count(*) AS n FROM listings')
      .get()!.n,
    0,
  );
  const validInput = dutchListing(f);
  const created = (
    await send(f, 'POST', '/listings', validInput, session)
  ).json();
  error(
    await send(
      f,
      'PATCH',
      `/listings/${created.id}`,
      {
        ...listingUpdate(f, created),
        kind: 'dutch',
        endPriceMicros: '1000000',
        auctionEndsAt: iso(f.time + 4 * 86400000),
      },
      session,
    ),
    400,
    'INVALID_AUCTION',
  );
});

test('Dutch price filters use current asks before and after RPC rather than persisted starting prices', async (t) => {
  const f = await fixture(t);
  const session = await login(f);
  const created = (
    await send(f, 'POST', '/listings', dutchListing(f), session)
  ).json();
  f.advance(86400000 / 2);
  const page = (
    await send(
      f,
      'GET',
      '/listings?minPriceMicros=3000000000&maxPriceMicros=3000000000',
    )
  ).json();
  assert.deepEqual(
    page.items.map((value: Listing) => value.id),
    [created.id],
  );
  assert.equal(page.items[0].priceMicros, '3000000000');
  let enter: () => void = () => assert.fail('Gate not initialized');
  let release: () => void = () => assert.fail('Gate not initialized');
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const originalBatch = f.chain.getPositions;
  f.chain.getPositions = async (ids) => {
    enter();
    await gate;
    return originalBatch(ids);
  };
  const pending = send(f, 'GET', '/listings?minPriceMicros=3000000000');
  await entered;
  f.advance(86400000 / 2);
  release();
  assert.deepEqual((await pending).json(), { items: [], nextCursor: null });
  f.chain.getPositions = originalBatch;
  assert.equal(
    (await send(f, 'GET', '/listings?maxPriceMicros=2000000000')).json()
      .items[0].priceMicros,
    '2000000000',
  );
});

test('price-filter scan bounds advance a cursor across unmatched rows without invented empty results', async (t) => {
  const f = await fixture(t);
  const insert = f.app.store.prepare(
    "INSERT INTO listings(id,market,token_id,owner,price_micros,expires_at,created_at,updated_at,status,position_json) VALUES (?,'kittenswap',?,?,?,?,?,?,'active',?)",
  );
  let target;
  for (let index = 1; index <= 152; index++) {
    const id = randomUUID();
    const tokenId = String(index);
    const position = f.position(tokenId);
    f.positions.set(tokenId, position);
    insert.run(
      id,
      tokenId,
      f.owner.address,
      index === 152 ? '1000000' : '2000000',
      f.time + 86400000,
      f.time - index,
      f.time - index,
      JSON.stringify(position),
    );
    if (index === 152) target = id;
  }
  const first = (
    await send(f, 'GET', '/listings?maxPriceMicros=1000000&limit=1')
  ).json();
  assert.deepEqual(first.items, []);
  assert.ok(first.nextCursor);
  assert.equal(f.reads, 0);
  const second = (
    await send(
      f,
      'GET',
      `/listings?maxPriceMicros=1000000&limit=1&cursor=${first.nextCursor}`,
    )
  ).json();
  assert.deepEqual(
    second.items.map((value: Listing) => value.id),
    [target],
  );
  assert.equal(second.nextCursor, null);
  assert.equal(f.reads, 1);
});

test('fixed explicit defaults preserve the original create digest and schema-v2 records migrate additively', async (t) => {
  const f = await fixture(t);
  const session = await login(f);
  const input = listing(f);
  const created = (await send(f, 'POST', '/listings', input, session)).json();
  assert.deepEqual(
    (
      await send(
        f,
        'POST',
        '/listings',
        {
          ...input,
          kind: 'fixed',
          endPriceMicros: input.priceMicros,
          auctionEndsAt: null,
          recipient: null,
        },
        session,
      )
    ).json(),
    created,
  );
  f.advance(1000);
  const edited = (
    await send(
      f,
      'PATCH',
      `/listings/${created.id}`,
      listingUpdate(f, created),
      session,
    )
  ).json();
  const rows = f.app.store
    .prepare<unknown[], IdempotencyRow>('SELECT * FROM idempotency')
    .all();
  for (const row of rows) {
    const snapshot = JSON.parse(row.response_json) as Listing &
      Record<string, unknown>;
    for (const field of Object.keys(listingTermsSnapshot(snapshot)))
      delete snapshot[field];
    f.app.store
      .prepare(
        'UPDATE idempotency SET response_json = ? WHERE actor = ? AND operation = ? AND key = ?',
      )
      .run(JSON.stringify(snapshot), row.actor, row.operation, row.key);
  }
  f.app.store.exec(
    'ALTER TABLE listings DROP COLUMN kind; ALTER TABLE listings DROP COLUMN end_price_micros; ALTER TABLE listings DROP COLUMN starts_at; ALTER TABLE listings DROP COLUMN auction_ends_at; ALTER TABLE listings DROP COLUMN recipient; PRAGMA user_version = 2;',
  );
  const before = f.app.store
    .prepare<unknown[], IdempotencyRow>('SELECT * FROM idempotency')
    .all();
  await f.restart();
  const migrated = (await send(f, 'GET', `/listings/${created.id}`)).json();
  assert.equal(migrated.kind, 'fixed');
  assert.equal(migrated.startPriceMicros, edited.priceMicros);
  assert.equal(migrated.endPriceMicros, edited.priceMicros);
  assert.equal(migrated.revision, 2);
  assert.equal(migrated.updatedAt, edited.updatedAt);
  assert.equal(migrated.startsAt, created.createdAt);
  assert.equal(migrated.recipient, null);
  assert.equal(migrated.auctionEndsAt, null);
  assert.deepEqual(
    (await send(f, 'POST', '/listings', input, session)).json(),
    created,
  );
  assert.deepEqual(
    f.app.store
      .prepare<unknown[], IdempotencyRow>('SELECT * FROM idempotency')
      .all(),
    before,
  );
});

test('development defaults bind sign-in origin to the configured local service port', () => {
  const config = loadConfig({ NODE_ENV: 'development' });
  assert.equal(config.port, 8080);
  assert.equal(config.origin, 'http://127.0.0.1:8080');
  const custom = loadConfig({ NODE_ENV: 'development', PORT: '9123' });
  assert.equal(custom.port, 9123);
  assert.equal(custom.origin, 'http://127.0.0.1:9123');
  assert.equal(
    loadConfig({
      NODE_ENV: 'development',
      PORT: '9123',
      APP_ORIGIN: 'https://custom.example',
    }).origin,
    'https://custom.example',
  );
});
