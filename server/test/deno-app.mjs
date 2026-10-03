import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Wallet } from 'ethers';
import postgres from 'postgres';
import { createApp } from '../app.ts';
import { loadConfig } from '../config.ts';

const databaseUrl = Deno.env.get('TEST_DATABASE_URL');

Deno.test({
  name: 'Deno Fastify serves bearer authentication, CORS and off-chain listings over HTTP with PostgreSQL',
  ignore: !databaseUrl,
  async fn() {
    assert.ok(databaseUrl, 'TEST_DATABASE_URL must name a disposable database');
    const schema = `riftwell_deno_app_${randomUUID().replaceAll('-', '')}`;
    const admin = postgres(databaseUrl, {
      max: 1,
      connect_timeout: 5,
      onnotice: () => {},
    });
    const client = Deno.createHttpClient({ poolIdleTimeout: 1 });
    let app;
    let created = false;
    const frontend = 'https://riftwell-deno-test.web.app';
    const otherOrigin = 'https://other.example';
    const time = Date.parse('2030-01-01T12:00:00.000Z');
    const owner = Wallet.createRandom();
    let positionReads = 0;
    const position = {
      id: 'kittenswap-1',
      tokenId: '1',
      marketId: 'kittenswap',
      owner: owner.address,
      lockedAmountRaw: '540157719850561543735839',
      lockedUntil: '2031-01-01T00:00:00.000Z',
      votingPowerRaw: '127458152638650785493',
      blockNumber: 1234,
      blockHash: `0x${'11'.repeat(32)}`,
      observedAt: new Date(time).toISOString(),
    };
    const chain = {
      async getPosition(tokenId) {
        positionReads++;
        assert.equal(tokenId, '1');
        return position;
      },
      async getOwnedPositions(account) {
        return {
          items: account === owner.address ? [position] : [],
          nextCursor: null,
        };
      },
      async health() {
        return { ready: true, available: true, chainId: 999 };
      },
    };
    try {
      await admin.unsafe(`CREATE SCHEMA "${schema}"`);
      created = true;
      const url = new URL(databaseUrl);
      url.searchParams.set(
        'options',
        `${url.searchParams.get('options') ?? ''} -c search_path=${schema}`.trim(),
      );
      const config = {
        ...loadConfig({
          NODE_ENV: 'production',
          DATABASE_URL: url.toString(),
          APP_ORIGIN: frontend,
          SESSION_SECRET: 'a'.repeat(64),
          HYPEREVM_RPC_URL: 'https://unused-simulated-rpc.example',
          SESSION_TRANSPORT: 'bearer',
          API_ONLY: 'true',
        }),
        logger: false,
      };
      app = await createApp({ config, chain, now: () => time });
      assert.equal(app.database.dialect, 'postgres');
      const base = await app.listen({ host: '127.0.0.1', port: 0 });
      const request = async (
        path,
        { method = 'GET', payload, session, headers = {} } = {},
      ) => {
        const response = await fetch(base + path, {
          method,
          client,
          headers: {
            origin: frontend,
            ...(payload === undefined
              ? {}
              : { 'content-type': 'application/json' }),
            ...(session
              ? {
                  authorization: `Bearer ${session.accessToken}`,
                  'x-csrf-token': session.csrfToken,
                }
              : {}),
            ...headers,
          },
          ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
        });
        const text = await response.text();
        return {
          status: response.status,
          headers: response.headers,
          body: text ? JSON.parse(text) : null,
        };
      };
      const preflight = await request('/api/v1/auth/verify', {
        method: 'OPTIONS',
        headers: {
          'access-control-request-method': 'POST',
          'access-control-request-headers':
            'Authorization,Content-Type,X-CSRF-Token',
        },
      });
      assert.equal(preflight.status, 204);
      assert.equal(
        preflight.headers.get('access-control-allow-origin'),
        frontend,
      );
      assert.equal(
        preflight.headers.get('access-control-allow-credentials'),
        null,
      );
      const deniedPreflight = await request('/api/v1/auth/verify', {
        method: 'OPTIONS',
        headers: {
          origin: otherOrigin,
          'access-control-request-method': 'POST',
        },
      });
      assert.equal(deniedPreflight.status, 403);
      assert.equal(deniedPreflight.body.error.code, 'ORIGIN_REJECTED');
      assert.equal(
        deniedPreflight.headers.get('access-control-allow-origin'),
        null,
      );
      const challenge = await request('/api/v1/auth/challenge', {
        method: 'POST',
        payload: { address: owner.address, chainId: 999 },
      });
      assert.equal(challenge.status, 200);
      assert.ok(challenge.body.message.startsWith(new URL(frontend).host));
      const verification = {
        challengeId: challenge.body.challengeId,
        signature: await owner.signMessage(challenge.body.message),
      };
      const verified = await request('/api/v1/auth/verify', {
        method: 'POST',
        payload: verification,
      });
      assert.equal(verified.status, 200);
      assert.equal(verified.headers.get('set-cookie'), null);
      assert.equal(
        verified.headers.get('access-control-allow-origin'),
        frontend,
      );
      const session = verified.body;
      assert.ok(/^[0-9a-f]{64}$/.test(session.accessToken));
      assert.ok(/^[0-9a-f]{64}$/.test(session.csrfToken));
      const stored = await app.database.get('SELECT * FROM sessions');
      assert.ok(stored);
      assert.ok(stored.token_hash !== session.accessToken);
      assert.ok(stored.csrf_hash !== session.csrfToken);
      const replay = await request('/api/v1/auth/verify', {
        method: 'POST',
        payload: verification,
      });
      assert.equal(replay.status, 401);
      assert.equal(replay.body.error.code, 'CHALLENGE_INVALID');
      const restored = await request('/api/v1/auth/session', { session });
      assert.equal(restored.status, 200);
      assert.equal(restored.body.address, owner.address);
      assert.equal(restored.body.accessToken, undefined);
      assert.equal(restored.body.csrfToken, session.csrfToken);
      const cookieOnly = await request('/api/v1/auth/session', {
        headers: { cookie: `__Host-riftwell_session=${session.accessToken}` },
      });
      assert.equal(cookieOnly.status, 401);
      const input = {
        tokenId: '1',
        priceMicros: '4200000001',
        expiresAt: new Date(time + 86400000).toISOString(),
        idempotencyKey: randomUUID(),
      };
      const badCsrf = await request('/api/v1/listings', {
        method: 'POST',
        payload: input,
        session,
        headers: { 'x-csrf-token': '0'.repeat(64) },
      });
      assert.equal(badCsrf.status, 403);
      assert.equal(badCsrf.body.error.code, 'CSRF_REJECTED');
      const badOrigin = await request('/api/v1/listings', {
        method: 'POST',
        payload: input,
        session,
        headers: { origin: otherOrigin },
      });
      assert.equal(badOrigin.status, 403);
      assert.equal(badOrigin.body.error.code, 'ORIGIN_REJECTED');
      const listing = await request('/api/v1/listings', {
        method: 'POST',
        payload: input,
        session,
      });
      assert.equal(listing.status, 200);
      assert.equal(listing.body.priceMicros, input.priceMicros);
      assert.equal(listing.body.revision, 1);
      const retry = await request('/api/v1/listings', {
        method: 'POST',
        payload: input,
        session,
      });
      assert.equal(retry.status, 200);
      assert.deepEqual(retry.body, listing.body);
      assert.equal(
        (await app.database.get('SELECT count(*) AS n FROM listings')).n,
        1,
      );
      const detail = await request(`/api/v1/listings/${listing.body.id}`);
      assert.equal(detail.status, 200);
      assert.equal(detail.body.id, listing.body.id);
      assert.ok(positionReads >= 3);
      const settlement = await request('/api/v1/settlement', {
        method: 'POST',
        payload: {},
        session,
      });
      assert.equal(settlement.status, 503);
      assert.equal(settlement.body.error.code, 'SMART_CONTRACTS_DISABLED');
      const readiness = await request('/health/ready');
      assert.equal(readiness.status, 200);
      assert.equal(readiness.body.database, 'ready');
      const logout = await request('/api/v1/auth/logout', {
        method: 'POST',
        payload: {},
        session,
      });
      assert.equal(logout.status, 200);
      assert.equal(logout.headers.get('set-cookie'), null);
      assert.deepEqual(logout.body, { ok: true });
      const revoked = await request('/api/v1/auth/session', { session });
      assert.equal(revoked.status, 401);
      assert.equal(
        (await app.database.get('SELECT count(*) AS n FROM sessions')).n,
        0,
      );
      assert.equal(
        (
          await app.database.get(
            "SELECT count(*) AS n FROM audit_events WHERE event = 'auth.session-revoked'",
          )
        ).n,
        1,
      );
    } finally {
      client.close();
      try {
        if (app) await app.close();
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
