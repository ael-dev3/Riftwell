import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import { Wallet } from 'ethers';
import type { IncomingHttpHeaders, OutgoingHttpHeaders } from 'node:http';
import type { Response as InjectResponse } from 'light-my-request';
import { createApp } from '../app.ts';
import { loadConfig } from '../config.ts';
import type { ServerConfig, Session } from '../types.ts';

const origin = 'https://riftwell-ael.web.app';
const secret = 'f'.repeat(64);
type BearerSession = Session & { accessToken: string };

async function fixture(t: TestContext, overrides: Partial<ServerConfig> = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'riftwell-transport-'));
  const distPath = join(directory, 'dist');
  await mkdir(distPath);
  await writeFile(
    join(distPath, 'index.html'),
    '<html>frontend fixture</html>',
  );
  let time = Date.parse('2030-01-01T00:00:00Z');
  const wallet = Wallet.createRandom();
  const config: ServerConfig = {
    ...loadConfig({
      NODE_ENV: 'test',
      APP_ORIGIN: origin,
      DB_PATH: join(directory, 'state.sqlite'),
      DIST_PATH: distPath,
      SESSION_SECRET: secret,
      SESSION_TRANSPORT: 'bearer',
      API_ONLY: 'true',
    }),
    ...overrides,
  };
  const app = await createApp({
    config,
    now: () => time,
    chain: {
      async getPosition() {
        throw Object.assign(new Error('Missing position'), {
          code: 'POSITION_NOT_FOUND',
        });
      },
      async getOwnedPositions() {
        return { items: [], nextCursor: null };
      },
      async health() {
        return { ready: true, available: true, chainId: 999 };
      },
    },
  });
  t.after(async () => {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  });
  async function login(headers: OutgoingHttpHeaders = {}) {
    const challenge = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/challenge',
      headers: { origin },
      payload: { address: wallet.address, chainId: 999 },
    });
    assert.equal(challenge.statusCode, 200, challenge.body);
    const issued = challenge.json<{ challengeId: string; message: string }>();
    assert.ok(
      issued.message.startsWith('riftwell-ael.web.app wants you to sign in'),
    );
    assert.ok(issued.message.includes(`URI: ${origin}\n`));
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/verify',
      headers: { origin, ...headers },
      payload: {
        challengeId: issued.challengeId,
        signature: await wallet.signMessage(issued.message),
      },
    });
    assert.equal(response.statusCode, 200, response.body);
    return response;
  }
  return {
    app,
    config,
    wallet,
    login,
    advance(milliseconds: number) {
      time += milliseconds;
    },
  };
}

function error(response: InjectResponse, status: number, code: string) {
  assert.equal(response.statusCode, status, response.body);
  assert.equal(response.json<{ error: { code: string } }>().error.code, code);
}

test('bearer login exposes a token once, stores only its hash and sends no cookie', async (t) => {
  const f = await fixture(t, { production: true });
  const verified = await f.login();
  const session = verified.json<BearerSession>();
  assert.deepEqual(Object.keys(session).sort(), [
    'accessToken',
    'address',
    'chainId',
    'csrfToken',
    'expiresAt',
  ]);
  assert.match(session.accessToken, /^[0-9a-f]{64}$/);
  assert.match(session.csrfToken, /^[0-9a-f]{64}$/);
  assert.notEqual(session.csrfToken, session.accessToken);
  assert.equal(verified.headers['set-cookie'], undefined);
  assert.equal(verified.headers['cache-control'], 'no-store');
  const rows = f.app.store
    .prepare('SELECT token_hash,csrf_hash FROM sessions')
    .all() as {
    token_hash: string;
    csrf_hash: string;
  }[];
  assert.equal(rows.length, 1);
  assert.equal(
    rows[0].token_hash,
    createHmac('sha256', secret).update(session.accessToken).digest('hex'),
  );
  assert.notEqual(rows[0].csrf_hash, session.csrfToken);
  const restored = await f.app.inject({
    url: '/api/v1/auth/session',
    headers: { authorization: `Bearer ${session.accessToken}`, origin },
  });
  assert.equal(restored.statusCode, 200, restored.body);
  assert.deepEqual(restored.json(), {
    address: session.address,
    chainId: session.chainId,
    csrfToken: session.csrfToken,
    expiresAt: session.expiresAt,
  });
  assert.equal(restored.headers['set-cookie'], undefined);
  assert.equal(restored.headers['access-control-allow-origin'], origin);
});

test('bearer transport ignores even a valid legacy session cookie', async (t) => {
  const f = await fixture(t);
  const session = (await f.login()).json<BearerSession>();
  error(
    await f.app.inject({
      url: '/api/v1/auth/session',
      headers: { cookie: `riftwell_session=${session.accessToken}`, origin },
    }),
    401,
    'AUTH_REQUIRED',
  );
  const valid = await f.app.inject({
    url: '/api/v1/auth/session',
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      cookie: `riftwell_session=${'0'.repeat(64)}`,
      origin,
    },
  });
  assert.equal(valid.statusCode, 200, valid.body);
});

test('cookie transport keeps its normal response and ignores Authorization', async (t) => {
  const f = await fixture(t, { sessionTransport: 'cookie' });
  const response = await f.login();
  assert.equal(response.json().accessToken, undefined);
  const setCookie = response.headers['set-cookie'];
  assert.equal(typeof setCookie, 'string');
  const cookie = (setCookie as string).split(';')[0];
  const token = cookie.split('=')[1];
  error(
    await f.app.inject({
      url: '/api/v1/auth/session',
      headers: { authorization: `Bearer ${token}` },
    }),
    401,
    'AUTH_REQUIRED',
  );
  const restored = await f.app.inject({
    url: '/api/v1/auth/session',
    headers: { cookie, authorization: `Bearer ${'0'.repeat(64)}` },
  });
  assert.equal(restored.statusCode, 200, restored.body);
  assert.equal(restored.headers['access-control-allow-origin'], undefined);
});

test('malformed, ambiguous or duplicate bearer credentials are rejected', async (t) => {
  const f = await fixture(t);
  const session = (await f.login()).json<BearerSession>();
  const token = session.accessToken;
  for (const authorization of [
    `bearer ${token}`,
    `Bearer  ${token}`,
    `Bearer ${token} `,
    `Bearer ${token.toUpperCase()}`,
    `Basic ${token}`,
    `Bearer ${token.slice(1)}`,
    `Bearer ${token}, Bearer ${token}`,
    [`Bearer ${token}`, `Bearer ${token}`],
    [`Bearer ${token}`, `Bearer ${'0'.repeat(64)}`],
  ]) {
    const response = await f.app.inject({
      url: '/api/v1/auth/session',
      // Arrays model duplicate wire headers even though Node's parsed
      // IncomingHttpHeaders type narrows Authorization to a single string.
      headers: { authorization } as IncomingHttpHeaders,
    });
    error(response, 401, 'AUTH_REQUIRED');
  }
});

test('bearer mutations still require the frontend origin and matching CSRF token', async (t) => {
  const f = await fixture(t);
  const session = (await f.login()).json<BearerSession>();
  const authorization = `Bearer ${session.accessToken}`;
  for (const suppliedOrigin of [
    undefined,
    'null',
    'https://attacker.example',
    `${origin}/`,
  ])
    error(
      await f.app.inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
        headers: {
          authorization,
          'x-csrf-token': session.csrfToken,
          ...(suppliedOrigin ? { origin: suppliedOrigin } : {}),
        },
      }),
      403,
      'ORIGIN_REJECTED',
    );
  for (const csrf of [
    undefined,
    '0'.repeat(64),
    session.accessToken,
    `${session.csrfToken},${session.csrfToken}`,
  ])
    error(
      await f.app.inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
        headers: {
          authorization,
          origin,
          ...(csrf ? { 'x-csrf-token': csrf } : {}),
        },
      }),
      403,
      'CSRF_REJECTED',
    );
  const loggedOut = await f.app.inject({
    method: 'POST',
    url: '/api/v1/auth/logout',
    headers: { authorization, origin, 'x-csrf-token': session.csrfToken },
  });
  assert.equal(loggedOut.statusCode, 200, loggedOut.body);
  assert.deepEqual(loggedOut.json(), { ok: true });
  assert.equal(loggedOut.headers['set-cookie'], undefined);
  error(
    await f.app.inject({
      url: '/api/v1/auth/session',
      headers: { authorization },
    }),
    401,
    'AUTH_REQUIRED',
  );
});

test('replacing a bearer session revokes the supplied previous session', async (t) => {
  const f = await fixture(t);
  const old = (await f.login()).json<BearerSession>();
  const fresh = (
    await f.login({ authorization: `Bearer ${old.accessToken}` })
  ).json<BearerSession>();
  assert.notEqual(old.accessToken, fresh.accessToken);
  error(
    await f.app.inject({
      url: '/api/v1/auth/session',
      headers: { authorization: `Bearer ${old.accessToken}` },
    }),
    401,
    'AUTH_REQUIRED',
  );
  assert.equal(
    (
      await f.app.inject({
        url: '/api/v1/auth/session',
        headers: { authorization: `Bearer ${fresh.accessToken}` },
      })
    ).statusCode,
    200,
  );
  const row = f.app.store
    .prepare('SELECT COUNT(*) AS n FROM sessions')
    .get() as { n: number };
  assert.equal(row.n, 1);
});

test('expired bearer sessions stop authenticating at the exact expiry boundary', async (t) => {
  const f = await fixture(t, { sessionTtlSeconds: 300 });
  const session = (await f.login()).json<BearerSession>();
  const authorization = `Bearer ${session.accessToken}`;
  f.advance(299999);
  assert.equal(
    (
      await f.app.inject({
        url: '/api/v1/auth/session',
        headers: { authorization },
      })
    ).statusCode,
    200,
  );
  f.advance(1);
  error(
    await f.app.inject({
      url: '/api/v1/auth/session',
      headers: { authorization },
    }),
    401,
    'AUTH_REQUIRED',
  );
});

test('CORS permits only the exact frontend origin and never enables ambient cookies', async (t) => {
  const f = await fixture(t);
  for (const suppliedOrigin of [
    origin,
    'https://attacker.example',
    `${origin}/`,
    'null',
    undefined,
  ]) {
    const response = await f.app.inject({
      url: '/api/v1/status',
      headers: suppliedOrigin ? { origin: suppliedOrigin } : {},
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(
      response.headers['access-control-allow-origin'],
      suppliedOrigin === origin ? origin : undefined,
    );
    assert.equal(
      response.headers['access-control-allow-credentials'],
      undefined,
    );
    assert.equal(response.headers.vary, 'Origin');
    assert.equal(response.headers['cache-control'], 'no-store');
  }
  const unauthorized = await f.app.inject({
    url: '/api/v1/auth/session',
    headers: { origin },
  });
  error(unauthorized, 401, 'AUTH_REQUIRED');
  assert.equal(unauthorized.headers['access-control-allow-origin'], origin);
});

test('valid CORS preflight allows authenticated mutations without requiring a session', async (t) => {
  const f = await fixture(t);
  const response = await f.app.inject({
    method: 'OPTIONS',
    url: '/api/v1/auth/logout',
    headers: {
      origin,
      'access-control-request-method': 'POST',
      'access-control-request-headers':
        'authorization, Content-Type, X-CSRF-Token, Accept',
    },
  });
  assert.equal(response.statusCode, 204, response.body);
  assert.equal(response.body, '');
  assert.equal(response.headers['access-control-allow-origin'], origin);
  assert.equal(response.headers['access-control-allow-credentials'], undefined);
  assert.equal(
    response.headers['access-control-allow-methods'],
    'GET, HEAD, POST, PATCH, DELETE',
  );
  assert.equal(
    response.headers['access-control-allow-headers'],
    'Authorization, Content-Type, X-CSRF-Token, Accept',
  );
  assert.equal(response.headers['access-control-max-age'], '300');
});

test('CORS preflight rejects other origins, methods and non-allowlisted headers', async (t) => {
  const f = await fixture(t);
  for (const extra of [
    { origin: 'https://attacker.example' },
    { origin: 'null' },
    { origin: `${origin}/` },
  ])
    error(
      await f.app.inject({
        method: 'OPTIONS',
        url: '/api/v1/auth/logout',
        headers: { 'access-control-request-method': 'POST', ...extra },
      }),
      403,
      'ORIGIN_REJECTED',
    );
  for (const method of ['PUT', 'CONNECT', 'TRACE', 'post', 'POST,DELETE', ''])
    error(
      await f.app.inject({
        method: 'OPTIONS',
        url: '/api/v1/auth/logout',
        headers: { origin, 'access-control-request-method': method },
      }),
      403,
      'PREFLIGHT_REJECTED',
    );
  for (const headers of [
    'Cookie',
    'X-Other',
    'authorization, x-other',
    'content-type,',
    '',
  ])
    error(
      await f.app.inject({
        method: 'OPTIONS',
        url: '/api/v1/auth/logout',
        headers: {
          origin,
          'access-control-request-method': 'POST',
          'access-control-request-headers': headers,
        },
      }),
      403,
      'PREFLIGHT_REJECTED',
    );
  error(
    await f.app.inject({
      method: 'OPTIONS',
      url: '/api/v1/auth/logout',
      headers: { origin },
    }),
    403,
    'PREFLIGHT_REJECTED',
  );
});

test('CORS does not bypass canonical API path checks', async (t) => {
  const f = await fixture(t);
  for (const url of [
    '/api//v1/auth/logout',
    '/%61pi/v1/auth/logout',
    '/api/v1/%61uth/logout',
    '/api/v1/auth/%252e%252e/auth/logout',
  ]) {
    const response = await f.app.inject({
      method: 'OPTIONS',
      url,
      headers: { origin, 'access-control-request-method': 'POST' },
    });
    assert.equal(response.statusCode, 400, url);
    error(response, 400, 'NON_CANONICAL_PATH');
  }
});

test('API_ONLY serves health and API routes while exposing no frontend files or SPA fallback', async (t) => {
  const f = await fixture(t);
  for (const url of ['/', '/index.html', '/marketplace', '/assets/app.js']) {
    const response = await f.app.inject({ url });
    assert.equal(response.statusCode, 404, response.body);
    assert.ok(!response.body.includes('frontend fixture'));
  }
  assert.equal((await f.app.inject({ url: '/api/v1/status' })).statusCode, 200);
  assert.equal((await f.app.inject({ url: '/health/live' })).statusCode, 200);
  assert.equal((await f.app.inject({ url: '/health/ready' })).statusCode, 200);
  assert.equal(
    (await f.app.inject({ url: '/api/v1/lending' })).json().executionEnabled,
    false,
  );
  error(
    await f.app.inject({
      method: 'POST',
      url: '/api/v1/settlement',
      headers: { origin },
    }),
    503,
    'SMART_CONTRACTS_DISABLED',
  );
});

test('the default combined server retains its frontend and has cookie transport', async (t) => {
  const config = loadConfig({ NODE_ENV: 'test' });
  assert.equal(config.sessionTransport, 'cookie');
  assert.equal(config.apiOnly, false);
  const f = await fixture(t, { apiOnly: false, sessionTransport: 'cookie' });
  const response = await f.app.inject({ url: '/' });
  assert.equal(response.statusCode, 200, response.body);
  assert.ok(response.body.includes('frontend fixture'));
});

test('transport and API_ONLY configuration reject ambiguous opt-in values', () => {
  for (const SESSION_TRANSPORT of ['Bearer', 'cookies', '', 'cookie,bearer'])
    assert.throws(
      () => loadConfig({ NODE_ENV: 'test', SESSION_TRANSPORT }),
      /SESSION_TRANSPORT/,
    );
  for (const API_ONLY of ['1', 'TRUE', 'yes'])
    assert.throws(() => loadConfig({ NODE_ENV: 'test', API_ONLY }), /API_ONLY/);
});
