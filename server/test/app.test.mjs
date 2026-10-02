import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { Wallet } from 'ethers';
import { createApp } from '../app.mjs';
import { loadConfig } from '../config.mjs';
import { backupDatabase } from '../backup.mjs';
import { RateLimiter } from '../rate-limit.mjs';
import { pruneAuth } from '../database.mjs';

const origin = 'https://riftwell.example';
const iso = (time) => new Date(time).toISOString();

async function fixture(t, overrides = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'riftwell-server-'));
  let time = Date.parse('2030-01-01T12:00:00.000Z');
  const owner = Wallet.createRandom();
  const lender = Wallet.createRandom();
  const outsider = Wallet.createRandom();
  const positions = new Map();
  const position = (id, account = owner.address, extra = {}) => ({
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
  const chain = {
    async getPosition(id) {
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
      return positions.get(id);
    },
    async getPositions(ids) {
      batches++;
      return Promise.all(
        ids.map(async (id) => {
          try {
            return await chain.getPosition(id);
          } catch (error) {
            if (error.code === 'POSITION_NOT_FOUND') return null;
            throw error;
          }
        }),
      );
    },
    async getOwnedPositions(account, { cursor, limit }) {
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
    advance(ms) {
      time += ms;
    },
    unavailable(value) {
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

async function send(f, method, url, payload, session, headers = {}) {
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
async function challenge(f, wallet = f.owner) {
  const response = await send(f, 'POST', '/auth/challenge', {
    address: wallet.address,
    chainId: 999,
  });
  assert.equal(response.statusCode, 200, response.body);
  return response.json();
}
async function login(f, wallet = f.owner) {
  const issued = await challenge(f, wallet);
  const response = await send(f, 'POST', '/auth/verify', {
    challengeId: issued.challengeId,
    signature: await wallet.signMessage(issued.message),
  });
  assert.equal(response.statusCode, 200, response.body);
  return {
    ...response.json(),
    cookie: response.headers['set-cookie'].split(';')[0],
    setCookie: response.headers['set-cookie'],
  };
}
const listing = (f, tokenId = '1', extra = {}) => ({
  tokenId,
  priceMicros: '4200000000',
  expiresAt: iso(f.time + 2 * 86400000),
  idempotencyKey: randomUUID(),
  ...extra,
});
const borrowing = (f, extra = {}) => ({
  tokenId: '1',
  principalMicros: '1000000000',
  aprBps: 1200,
  durationDays: 7,
  expiresAt: iso(f.time + 2 * 86400000),
  idempotencyKey: randomUUID(),
  ...extra,
});
const offer = (f, requestId, extra = {}) => ({
  requestId,
  principalMicros: '1000000000',
  aprBps: 1000,
  durationDays: 7,
  expiresAt: iso(f.time + 86400000),
  idempotencyKey: randomUUID(),
  ...extra,
});
function error(response, status, code) {
  assert.equal(response.statusCode, status, response.body);
  assert.equal(response.json().error.code, code);
  assert.match(response.json().error.requestId, /^[0-9a-f-]{36}$/);
  assert.equal(
    response.headers['x-request-id'],
    response.json().error.requestId,
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
      lending: true,
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
    f.app.store.prepare('SELECT count(*) AS n FROM audit_events').get().n,
    0,
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
  const cookie = verified.headers['set-cookie'];
  assert.ok(cookie.startsWith('__Host-riftwell_session='));
  for (const flag of ['HttpOnly', 'SameSite=Strict', 'Secure', 'Path=/'])
    assert.ok(cookie.includes(flag));
  const token = cookie.split(';')[0].split('=')[1];
  const stored = f.app.store.prepare('SELECT * FROM sessions').get();
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
    f.app.store.prepare('SELECT count(*) AS n FROM sessions').get().n,
    1,
  );
  assert.equal(
    f.app.store
      .prepare(
        "SELECT count(*) AS n FROM audit_events WHERE event = 'auth.challenge-consumed'",
      )
      .get().n,
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
    f.app.store.prepare('SELECT count(*) AS n FROM sessions').get().n,
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
  assert.ok(loggedOut.headers['set-cookie'].includes('Max-Age=0'));
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
  pruneAuth(f.app.store, f.time);
  assert.equal(
    f.app.store.prepare('SELECT count(*) AS n FROM sessions').get().n,
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
    f.app.store.prepare('SELECT count(*) AS n FROM listings').get().n,
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
    f.app.store.prepare('SELECT count(*) AS n FROM listings').get().n,
    2,
  );
  assert.equal(
    f.app.store
      .prepare(
        "SELECT count(*) AS n FROM audit_events WHERE event = 'listing.created'",
      )
      .get().n,
    2,
  );
});

test('money stays exact and canonical; bounds, unsafe integers, malformed token IDs and invalid terms are rejected', async (t) => {
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
  for (const [field, value, code] of [
    ['aprBps', 99, 'INVALID_APR'],
    ['aprBps', 1200.1, 'INVALID_APR'],
    ['durationDays', 8, 'INVALID_DURATION'],
  ])
    error(
      await send(
        f,
        'POST',
        '/loan-requests',
        borrowing(f, { [field]: value }),
        session,
      ),
      400,
      code,
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
      .prepare('SELECT status FROM listings WHERE id = ?')
      .get(created.id).status,
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
    new Set([...first.items, ...second.items].map((item) => item.id)).size,
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
      .prepare("SELECT count(*) AS n FROM listings WHERE status = 'expired'")
      .get().n,
    3,
  );
});

test('borrow requests require positive sufficient locks; unfunded offers obey borrower terms, no self-lending and lender-only cancellation', async (t) => {
  const f = await fixture(t);
  const owner = await login(f);
  const lender = await login(f, f.lender);
  const outsider = await login(f, f.outsider);
  f.positions.set(
    '1',
    f.position('1', f.owner.address, { lockedAmountRaw: '0' }),
  );
  error(
    await send(f, 'POST', '/loan-requests', borrowing(f), owner),
    400,
    'LOCK_INELIGIBLE',
  );
  f.positions.set(
    '1',
    f.position('1', f.owner.address, {
      lockedUntil: iso(f.time + 6 * 86400000),
    }),
  );
  error(
    await send(f, 'POST', '/loan-requests', borrowing(f), owner),
    400,
    'LOCK_INELIGIBLE',
  );
  f.positions.set('1', f.position('1'));
  const created = await send(f, 'POST', '/loan-requests', borrowing(f), owner);
  assert.equal(created.statusCode, 200, created.body);
  const requestId = created.json().id;
  error(
    await send(f, 'POST', '/offers', offer(f, requestId), owner),
    403,
    'SELF_LENDING',
  );
  for (const extra of [
    { principalMicros: '2000000000' },
    { aprBps: 1300 },
    { durationDays: 14 },
    { expiresAt: iso(f.time + 3 * 86400000) },
  ])
    error(
      await send(f, 'POST', '/offers', offer(f, requestId, extra), lender),
      400,
      'OFFER_TERMS_REJECTED',
    );
  const payload = offer(f, requestId);
  const proposed = await send(f, 'POST', '/offers', payload, lender);
  assert.equal(proposed.statusCode, 200, proposed.body);
  assert.equal(proposed.json().status, 'proposed');
  assert.deepEqual(
    (await send(f, 'POST', '/offers', payload, lender)).json(),
    proposed.json(),
  );
  error(
    await send(
      f,
      'DELETE',
      `/offers/${proposed.json().id}`,
      undefined,
      outsider,
    ),
    403,
    'FORBIDDEN',
  );
  assert.equal(
    (
      await send(
        f,
        'DELETE',
        `/offers/${proposed.json().id}`,
        undefined,
        lender,
      )
    ).json().status,
    'cancelled',
  );
  const second = await send(f, 'POST', '/offers', offer(f, requestId), lender);
  assert.equal(second.statusCode, 200);
  assert.equal(
    (
      await send(f, 'DELETE', `/loan-requests/${requestId}`, undefined, owner)
    ).json().status,
    'cancelled',
  );
  assert.equal(
    f.app.store
      .prepare('SELECT status FROM offers WHERE id = ?')
      .get(second.json().id).status,
    'invalidated',
  );
  assert.ok(!proposed.body.includes('funded'));
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
  ).json();
  assert.equal(account.address, f.owner.address);
  assert.equal(account.positions.length, 2);
  assert.ok(
    account.positions.every((position) => position.owner === f.owner.address),
  );
  assert.equal(
    account.listings.find((item) => item.id === created.id).status,
    'invalidated',
  );
  assert.equal(account.historyTruncated, false);
  error(
    await send(f, 'GET', '/account?positionsCursor=bad', undefined, session),
    400,
    'INVALID_PAGINATION',
  );
});

test('borrowers receive only proposals on their own requests and outage history permits authorized cancellation without chain writes', async (t) => {
  const f = await fixture(t);
  const owner = await login(f);
  const lender = await login(f, f.lender);
  const outsider = await login(f, f.outsider);
  const listed = (
    await send(f, 'POST', '/listings', listing(f, '2'), owner)
  ).json();
  const request = (
    await send(f, 'POST', '/loan-requests', borrowing(f), owner)
  ).json();
  const proposed = (
    await send(f, 'POST', '/offers', offer(f, request.id), lender)
  ).json();
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
  assert.equal(account.json().listings.length, 500);
  assert.equal(account.json().historyTruncated, true);
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
    .prepare('SELECT count(*) AS n FROM audit_events')
    .get().n;
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
    f.app.store.prepare('SELECT count(*) AS n FROM audit_events').get().n,
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
    f.app.store.prepare('SELECT count(*) AS n FROM audit_events').get().n > 0,
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
    index.headers['content-security-policy'].includes("connect-src 'self'"),
  );
  assert.ok(
    index.headers['content-security-policy'].includes("frame-ancestors 'none'"),
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

test('encoded API aliases cannot issue or consume challenges, read sessions or reach disabled settlement', async (t) => {
  const f = await fixture(t);
  await f.app.listen({ host: '127.0.0.1', port: 0 });
  const port = f.app.server.address().port;
  // Use raw HTTP request targets: URL-based clients normalize dot segments
  // before the server sees them and would miss these routing regressions.
  const wireRequest = (method, url, payload, cookie) =>
    new Promise((resolve, reject) => {
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
              json: () => JSON.parse(body),
            }),
          );
          response.on('error', reject);
        },
      );
      request.on('error', reject);
      request.end(body);
    });
  const aliases = (suffix) => [
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
  const rejectAliases = async (method, suffix, payload, cookie) => {
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
    f.app.store.prepare('SELECT count(*) AS n FROM challenges').get().n,
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
      .prepare('SELECT consumed_at FROM challenges WHERE id = ?')
      .get(issued.challengeId).consumed_at,
    null,
  );
  assert.equal(
    f.app.store.prepare('SELECT count(*) AS n FROM sessions').get().n,
    0,
  );
  const verified = await send(f, 'POST', '/auth/verify', payload);
  assert.equal(verified.statusCode, 200, verified.body);
  await rejectAliases(
    'GET',
    '/auth/session',
    undefined,
    verified.headers['set-cookie'].split(';')[0],
  );
  await rejectAliases('POST', '/settlement', { action: 'fund-loan' });
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
  let resolveProbe;
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
    f.app.store.prepare('SELECT count(*) AS n FROM challenges').get().n,
    10,
  );
  let now = 0;
  const limiter = new RateLimiter(() => now, 2);
  limiter.take('one', 1, 100);
  limiter.take('two', 1, 100);
  assert.throws(
    () => limiter.take('three', 1, 100),
    (error) => error.status === 429,
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
