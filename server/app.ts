import Fastify from 'fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { createHmac, randomUUID } from 'node:crypto';
import { openStore, expireRecords, pruneAuth } from './database.ts';
import { registerAuth } from './auth.ts';
import { registerOrders } from './orders.ts';
import { registerStatic } from './static.ts';
import { PersistentRateLimiter, RateLimiter } from './rate-limit.ts';
import { ApiError, fail, errorCode } from './errors.ts';
import { fields, tokenId, address, isRecord } from './validation.ts';
import type {
  App,
  AppContext,
  ChainAdapter,
  ChainHealth,
  Clock,
  Position,
  ServerConfig,
  ServiceContext,
} from './types.ts';

const market = {
  id: 'kittenswap',
  name: 'KittenSwap',
  shortName: 'Kitten',
  chain: 'HyperEVM',
  tokenSymbol: 'KITTEN',
  positionSymbol: 'veKITTEN',
  accentColor: '#bff4aa',
  logoPath: 'markets/kittenswap.png',
};

export async function createApp({
  config,
  chain,
  now = Date.now,
}: {
  config: ServerConfig;
  chain: ChainAdapter;
  now?: Clock;
}): Promise<App> {
  if (
    !chain ||
    !(['getPosition', 'getOwnedPositions', 'health'] as const).every(
      (method) => typeof chain[method] === 'function',
    )
  )
    throw new Error('A read-only chain adapter is required');
  const db = await openStore(config);
  // Opaque application-lifetime identity lets operators distinguish a restart
  // from another request. Never derive it from host, credentials or wallet data.
  const runtime = Object.freeze({
    instanceId: randomUUID(),
    startedAt: new Date().toISOString(),
  });
  const app = Fastify({
    bodyLimit: 16384,
    requestTimeout: 30000,
    connectionTimeout: 15000,
    keepAliveTimeout: 5000,
    trustProxy: config.trustProxy ?? false,
    genReqId: () => randomUUID(),
    logger: config.logger
      ? {
          redact: [
            'req.headers.cookie',
            'req.headers.authorization',
            'req.headers.x-csrf-token',
            'res.headers.set-cookie',
          ],
          serializers: {
            req: (request: Pick<FastifyRequest, 'method' | 'url'>) => ({
              method: request.method,
              url: request.url.split('?')[0],
            }),
            res: (reply: Pick<FastifyReply, 'statusCode'>) => ({
              statusCode: reply.statusCode,
            }),
          },
        }
      : false,
  });
  app.decorate('database', db);
  app.decorate('store', {
    getter: () => {
      if (!db.sqlite)
        throw new Error(
          'Native SQLite tooling is unavailable with PostgreSQL; use app.database',
        );
      return db.sqlite;
    },
  });
  const hash = (value: string): string =>
    createHmac('sha256', config.sessionSecret).update(value).digest('hex');
  const limiter =
    db.dialect === 'postgres'
      ? new PersistentRateLimiter(db, now, hash)
      : new RateLimiter(now);
  const baseContext = {
    db,
    config,
    chain,
    now,
    limiter,
    hash,
  };
  const chainCall = async <T>(operation: () => Promise<T>): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        Promise.resolve().then(operation),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new ApiError(
                  503,
                  'CHAIN_UNAVAILABLE',
                  'Confirmed position data is unavailable.',
                ),
              ),
            Math.min(30000, config.timeoutMs * 4),
          );
        }),
      ]);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (errorCode(error) === 'POSITION_NOT_FOUND')
        fail(404, 'POSITION_NOT_FOUND', 'The position was not found.');
      if (errorCode(error) === 'INVALID_TOKEN_ID')
        fail(400, 'INVALID_TOKEN_ID', 'The token ID is invalid.');
      if (
        ['INVALID_PAGINATION', 'INVALID_CURSOR'].includes(
          errorCode(error) ?? '',
        )
      )
        fail(400, 'INVALID_PAGINATION', 'The ownership cursor is invalid.');
      fail(503, 'CHAIN_UNAVAILABLE', 'Confirmed position data is unavailable.');
    } finally {
      clearTimeout(timer);
    }
  };
  const checkPosition = (position: unknown, id: string): Position => {
    try {
      if (
        !isRecord(position) ||
        position.tokenId !== tokenId(id) ||
        position.id !== `kittenswap-${id}` ||
        position.marketId !== 'kittenswap' ||
        typeof position.owner !== 'string' ||
        address(position.owner) !== position.owner ||
        typeof position.lockedAmountRaw !== 'string' ||
        !/^(0|[1-9][0-9]{0,77})$/.test(position.lockedAmountRaw) ||
        typeof position.votingPowerRaw !== 'string' ||
        !/^(0|[1-9][0-9]{0,77})$/.test(position.votingPowerRaw) ||
        typeof position.blockNumber !== 'number' ||
        !Number.isSafeInteger(position.blockNumber) ||
        position.blockNumber < 0 ||
        typeof position.blockHash !== 'string' ||
        !/^0x[0-9a-fA-F]{64}$/.test(position.blockHash) ||
        typeof position.lockedUntil !== 'string' ||
        !Number.isFinite(Date.parse(position.lockedUntil)) ||
        typeof position.observedAt !== 'string' ||
        !Number.isFinite(Date.parse(position.observedAt))
      )
        throw new Error('Invalid adapter response');
      return {
        id: position.id,
        tokenId: position.tokenId,
        marketId: position.marketId,
        owner: position.owner,
        lockedAmountRaw: position.lockedAmountRaw,
        lockedUntil: position.lockedUntil,
        votingPowerRaw: position.votingPowerRaw,
        blockNumber: position.blockNumber,
        blockHash: position.blockHash,
        observedAt: position.observedAt,
      };
    } catch {
      fail(503, 'CHAIN_UNAVAILABLE', 'Confirmed position data is unavailable.');
    }
  };
  const freshPosition = async (id: string): Promise<Position> =>
    checkPosition(await chainCall(() => chain.getPosition(id)), id);
  const freshPositions = async (
    ids: readonly string[],
  ): Promise<(Position | null)[]> => {
    const getPositions =
      typeof chain.getPositions === 'function'
        ? chain.getPositions.bind(chain)
        : undefined;
    if (!getPositions)
      return Promise.all(
        ids.map(async (id) => {
          try {
            return await freshPosition(id);
          } catch (error) {
            if (errorCode(error) === 'POSITION_NOT_FOUND') return null;
            throw error;
          }
        }),
      );
    const result: (Position | null)[] = [];
    for (let offset = 0; offset < ids.length; offset += 50) {
      const chunk = ids.slice(offset, offset + 50);
      const positions = await chainCall(() => getPositions(chunk));
      if (!Array.isArray(positions) || positions.length !== chunk.length)
        fail(
          503,
          'CHAIN_UNAVAILABLE',
          'Confirmed position data is unavailable.',
        );
      result.push(
        ...positions.map((position, index) =>
          position === null ? null : checkPosition(position, chunk[index]),
        ),
      );
    }
    return result;
  };
  const serviceContext: ServiceContext = {
    ...baseContext,
    chainCall,
    checkPosition,
    freshPosition,
    freshPositions,
  };

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'same-origin');
    reply.header(
      'permissions-policy',
      'camera=(), microphone=(), geolocation=()',
    );
    reply.header('cross-origin-opener-policy', 'same-origin-allow-popups');
    reply.header(
      'content-security-policy',
      `default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'${config.production ? '; upgrade-insecure-requests' : ''}`,
    );
    if (config.production)
      reply.header('strict-transport-security', 'max-age=31536000');
    const path = request.url.split('?')[0];
    if (!path.startsWith('/') || path.length > 2048)
      fail(400, 'NON_CANONICAL_PATH', 'Use a canonical application path.');
    let decoded = path;
    try {
      for (let depth = 0; depth < 8 && decoded.includes('%'); depth++)
        decoded = decodeURIComponent(decoded);
    } catch {
      reply.header('cache-control', 'no-store');
      fail(400, 'NON_CANONICAL_PATH', 'Use a canonical application path.');
    }
    const normalized = new URL(
      decoded.replaceAll('\\', '/').replace(/\/+/g, '/'),
      config.origin,
    ).pathname;
    const protectedPath =
      /^\/(?:api|health)(?:\/|$)/.test(normalized) ||
      /^\/(?:api|health)(?:\/|$)/.test(path);
    if (protectedPath) reply.header('x-riftwell-instance', runtime.instanceId);
    if (protectedPath || decoded.includes('%'))
      reply.header('cache-control', 'no-store');
    // Fastify can match decoded path segments. Reject aliases before any API
    // handler, including auth and disabled settlement, can observe the request.
    if (
      decoded.includes('%') ||
      (protectedPath && (path !== normalized || path.includes('%')))
    )
      fail(400, 'NON_CANONICAL_PATH', 'Use a canonical application path.');
    if (path === '/health/ready')
      await limiter.take(`readiness:${request.ip}`, 30, 60000);
    if (path.startsWith('/api/')) {
      reply.header('cache-control', 'no-store');
      // The default Firebase host and Deno API are different sites. Only our
      // exact frontend origin can read API responses, including error responses.
      if (config.sessionTransport === 'bearer') {
        reply.header('vary', 'Origin');
        if (request.headers.origin === config.origin)
          reply.header('access-control-allow-origin', config.origin);
        if (request.method === 'OPTIONS') {
          if (request.headers.origin !== config.origin)
            fail(403, 'ORIGIN_REJECTED', 'The request origin is not allowed.');
          const method = request.headers['access-control-request-method'];
          const headers = request.headers['access-control-request-headers'];
          if (
            typeof method !== 'string' ||
            !['GET', 'HEAD', 'POST', 'PATCH', 'DELETE'].includes(method) ||
            (headers !== undefined &&
              (typeof headers !== 'string' ||
                headers
                  .split(',')
                  .some(
                    (name) =>
                      ![
                        'authorization',
                        'content-type',
                        'x-csrf-token',
                        'accept',
                      ].includes(name.trim().toLowerCase()),
                  )))
          )
            fail(
              403,
              'PREFLIGHT_REJECTED',
              'The request could not be verified.',
            );
          await limiter.take(`api:${request.ip}`, 180, 60000);
          reply.header(
            'access-control-allow-methods',
            'GET, HEAD, POST, PATCH, DELETE',
          );
          reply.header(
            'access-control-allow-headers',
            'Authorization, Content-Type, X-CSRF-Token, Accept',
          );
          reply.header('access-control-max-age', '300');
          return reply.code(204).send();
        }
      }
      if (path === '/api/v1/settlement' && request.method === 'POST')
        fail(
          503,
          'SMART_CONTRACTS_DISABLED',
          'Smart-contract settlement is disabled. No funds or tokens have moved.',
        );
      await limiter.take(`api:${request.ip}`, 180, 60000);
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
        if (request.headers.origin !== config.origin)
          fail(403, 'ORIGIN_REJECTED', 'The request origin is not allowed.');
        await limiter.take(`mutation:${request.ip}`, 60, 60000);
        fields(request.query, []);
      }
      if (path.startsWith('/api/v1/auth/') && request.method === 'POST')
        await limiter.take(`auth:${request.ip}`, 20, 300000);
    }
  });
  app.setErrorHandler((error, request, reply) => {
    let status = 500;
    let code = 'INTERNAL_ERROR';
    let message = 'The request could not be completed.';
    if (error instanceof ApiError) ({ status, code, message } = error);
    else if (errorCode(error) === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      status = 413;
      code = 'REQUEST_TOO_LARGE';
      message = 'The request body is too large.';
    } else if (errorCode(error) === 'FST_ERR_CTP_INVALID_MEDIA_TYPE') {
      status = 415;
      code = 'UNSUPPORTED_MEDIA_TYPE';
      message = 'Use application/json for request bodies.';
    } else if (isRecord(error) && error.statusCode === 400) {
      status = 400;
      code = 'INVALID_REQUEST';
      message = 'The request is invalid.';
    } else if (
      errorCode(error)?.startsWith('SQLITE_CONSTRAINT') ||
      errorCode(error) === '23505'
    ) {
      status = 409;
      code = 'ACTIVE_ORDER_EXISTS';
      message = 'An active order conflicts with this request.';
    }
    if (status >= 500)
      request.log.error({ requestId: request.id, code }, 'Request failed');
    reply
      .code(status)
      .send({ error: { code, message, requestId: request.id } });
  });

  const ctx: AppContext = {
    ...serviceContext,
    requireSession: registerAuth(app, serviceContext),
  };
  app.get('/api/v1/status', async (request) => {
    fields(request.query, []);
    return {
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
    };
  });
  app.get('/api/v1/markets', async (request) => {
    fields(request.query, []);
    return { markets: [market] };
  });
  app.get('/api/v1/lending', async (request) => {
    fields(request.query, []);
    return {
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
    };
  });
  app.post('/api/v1/lending/actions', async (request) => {
    await ctx.requireSession(request, true);
    fail(
      503,
      'SMART_CONTRACTS_DISABLED',
      'Pooled lending is not deployed. No funds or tokens have moved.',
    );
  });
  app.get('/health/live', async () => ({ status: 'live', runtime }));
  type Readiness = {
    ready: boolean;
    database: string;
    chain: ChainHealth;
    runtime: typeof runtime;
  };
  let readinessCache: { until: number; result: Readiness } | undefined;
  let readinessFlight: Promise<Readiness> | undefined;
  const probeReadiness = async () => {
    let database = false;
    try {
      database = (await db.get<{ ok: number }>('SELECT 1 AS ok'))?.ok === 1;
    } catch {
      /* Redact storage errors. */
    }
    let health: ChainHealth;
    try {
      health = await ctx.chainCall(() => chain.health());
    } catch {
      health = {
        ready: false,
        available: false,
        chainId: 999,
        errorCode: 'CHAIN_UNAVAILABLE',
      };
    }
    const chainReady =
      health?.ready === true &&
      health?.available === true &&
      health?.chainId === 999;
    const safeHealth = {
      ready: chainReady,
      available: chainReady,
      chainId: 999,
      ...(Number.isSafeInteger(health?.blockNumber)
        ? { blockNumber: health.blockNumber }
        : {}),
      ...(typeof health.blockHash === 'string' &&
      /^0x[0-9a-fA-F]{64}$/.test(health.blockHash)
        ? { blockHash: health.blockHash }
        : {}),
      ...(typeof health?.observedAt === 'string' &&
      Number.isFinite(Date.parse(health.observedAt))
        ? { observedAt: health.observedAt }
        : {}),
      ...(!chainReady ? { errorCode: 'CHAIN_UNAVAILABLE' } : {}),
    };
    const ready = database && chainReady;
    return {
      ready,
      database: database ? 'ready' : 'unavailable',
      chain: safeHealth,
      runtime,
    };
  };
  app.get('/health/ready', async (_request, reply) => {
    let result;
    if (readinessCache && readinessCache.until > now())
      result = readinessCache.result;
    else {
      if (!readinessFlight)
        readinessFlight = probeReadiness()
          .then((value) => {
            readinessCache = { until: now() + 5000, result: value };
            return value;
          })
          .finally(() => {
            readinessFlight = undefined;
          });
      result = await readinessFlight;
    }
    return reply.code(result.ready ? 200 : 503).send(result);
  });
  registerOrders(app, ctx);
  if (config.sessionTransport === 'bearer')
    app.options('/api/*', async (_request, reply) => reply.code(204).send());
  if (!config.apiOnly) registerStatic(app, config);
  let interval: ReturnType<typeof setInterval> | undefined;
  let cleanupFlight: Promise<void> | undefined;
  app.addHook('onReady', async () => {
    const cleanup = async () => {
      await expireRecords(db, now());
      await pruneAuth(db, now());
      await limiter.prune();
    };
    await cleanup();
    app.log.info({ event: 'runtime_ready', ...runtime }, 'Runtime ready');
    interval = setInterval(() => {
      if (cleanupFlight) return;
      cleanupFlight = cleanup()
        .catch(() => {
          app.log.error({ code: 'MAINTENANCE_FAILED' }, 'Maintenance failed');
        })
        .finally(() => {
          cleanupFlight = undefined;
        });
    }, 60000);
    interval.unref();
  });
  app.addHook('onClose', async () => {
    clearInterval(interval);
    await cleanupFlight;
    await db.close();
    app.log.info({ event: 'runtime_closed', ...runtime }, 'Runtime closed');
  });
  try {
    await app.ready();
    return app;
  } catch (error) {
    await app.close();
    throw error;
  }
}
