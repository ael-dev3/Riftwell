import { randomBytes } from 'node:crypto';
import { isAbsolute, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ServerConfig } from './types.ts';

const serverRoot = fileURLToPath(new URL('.', import.meta.url));

function integer(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string,
): number {
  const text = value ?? String(fallback);
  if (!/^(0|[1-9][0-9]*)$/.test(text)) throw new Error(`Invalid ${name}`);
  const result = Number(text);
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum)
    throw new Error(`Invalid ${name}`);
  return result;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const mode = env.NODE_ENV ?? 'development';
  if (!['production', 'development', 'test'].includes(mode))
    throw new Error('Invalid NODE_ENV');
  const production = mode === 'production';
  const sessionTransport = env.SESSION_TRANSPORT ?? 'cookie';
  if (!['cookie', 'bearer'].includes(sessionTransport))
    throw new Error('SESSION_TRANSPORT must be cookie or bearer');
  if (env.API_ONLY && !['true', 'false'].includes(env.API_ONLY))
    throw new Error('API_ONLY must be true or false');
  const port = integer(env.PORT, 8080, 1, 65535, 'PORT');
  if (env.DATABASE_URL && env.DB_PATH)
    throw new Error('Configure DATABASE_URL or DB_PATH, never both');
  if (
    production &&
    (!env.APP_ORIGIN ||
      (!env.DB_PATH && !env.DATABASE_URL) ||
      !env.SESSION_SECRET)
  )
    throw new Error(
      'APP_ORIGIN, DATABASE_URL or DB_PATH, and SESSION_SECRET are required in production',
    );
  let databaseUrl: string | undefined;
  if (env.DATABASE_URL) {
    let missingDatabaseName = false;
    try {
      const database = new URL(env.DATABASE_URL);
      if (!database.pathname || database.pathname === '/') {
        // Managed providers may inject the database separately from the URL.
        // Fill only an absent path; never redirect an explicitly named database.
        if (
          !env.PGDATABASE ||
          !/^[A-Za-z0-9_][A-Za-z0-9_-]{0,62}$/.test(env.PGDATABASE)
        ) {
          missingDatabaseName = true;
          throw new Error('Database name is required');
        }
        database.pathname = `/${encodeURIComponent(env.PGDATABASE)}`;
      }
      if (
        !['postgres:', 'postgresql:'].includes(database.protocol) ||
        !database.hostname ||
        !database.username ||
        database.pathname === '/' ||
        !database.pathname ||
        database.hash ||
        (production && !database.password) ||
        (production &&
          database.searchParams.get('sslmode') === 'disable' &&
          !['localhost', '127.0.0.1', '[::1]'].includes(database.hostname))
      )
        throw new Error('Invalid database URL');
      databaseUrl = database.toString();
    } catch {
      throw new Error(
        'DATABASE_URL must be a PostgreSQL connection URL; remote production connections require TLS' +
          (missingDatabaseName
            ? '; DATABASE_NAME_REQUIRED: provide a valid database path or PGDATABASE'
            : ''),
      );
    }
  }
  const origin = new URL(env.APP_ORIGIN ?? `http://127.0.0.1:${port}`);
  if (
    !['http:', 'https:'].includes(origin.protocol) ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    origin.pathname !== '/' ||
    (production && origin.protocol !== 'https:')
  )
    throw new Error('APP_ORIGIN must be an exact HTTPS origin in production');
  const dbPath = env.DB_PATH ?? resolve(serverRoot, 'data/riftwell.sqlite');
  if (!isAbsolute(dbPath) || dbPath === ':memory:')
    throw new Error('DB_PATH must be an absolute durable file path');
  if (production && /^\/(?:tmp|private\/tmp)(?:\/|$)/.test(dbPath))
    throw new Error('Production DB_PATH cannot use a temporary directory');
  const sessionSecret = env.SESSION_SECRET || randomBytes(32).toString('hex');
  if (Buffer.byteLength(sessionSecret) < 32 || sessionSecret.length > 512)
    throw new Error('SESSION_SECRET must contain at least 32 bytes');
  const rpcUrl = env.HYPEREVM_RPC_URL;
  if (production && !rpcUrl)
    throw new Error('HYPEREVM_RPC_URL is required in production');
  if (
    rpcUrl &&
    !['https:', ...(production ? [] : ['http:'])].includes(
      new URL(rpcUrl).protocol,
    )
  )
    throw new Error('Invalid HYPEREVM_RPC_URL protocol');
  const trustedProxy = env.TRUST_PROXY?.split(',').map((value) => value.trim());
  if (
    trustedProxy?.some(
      (value) => !/^[0-9a-fA-F:.]+(?:\/[0-9]{1,3})?$/.test(value),
    )
  )
    throw new Error(
      'TRUST_PROXY must name explicit IP addresses or CIDR ranges',
    );
  const distPath = resolve(env.DIST_PATH ?? resolve(serverRoot, '../dist'));
  if (
    resolve(dbPath) === distPath ||
    resolve(dbPath).startsWith(distPath + sep)
  )
    throw new Error('DB_PATH must be outside the published frontend');
  return {
    production,
    sessionTransport: sessionTransport as 'cookie' | 'bearer',
    apiOnly: env.API_ONLY === 'true',
    origin: origin.origin,
    dbPath,
    ...(databaseUrl ? { databaseUrl } : {}),
    databasePoolSize: integer(
      env.DATABASE_POOL_SIZE,
      3,
      1,
      10,
      'DATABASE_POOL_SIZE',
    ),
    sessionSecret,
    rpcUrl,
    host: env.HOST ?? '127.0.0.1',
    port,
    sessionTtlSeconds: integer(
      env.SESSION_TTL_SECONDS,
      28800,
      300,
      86400,
      'SESSION_TTL_SECONDS',
    ),
    confirmations: integer(
      env.CHAIN_CONFIRMATIONS,
      2,
      1,
      100,
      'CHAIN_CONFIRMATIONS',
    ),
    maxHeadAgeSeconds: integer(
      env.CHAIN_MAX_HEAD_AGE_SECONDS,
      60,
      15,
      300,
      'CHAIN_MAX_HEAD_AGE_SECONDS',
    ),
    timeoutMs: integer(
      env.CHAIN_TIMEOUT_MS,
      8000,
      100,
      15000,
      'CHAIN_TIMEOUT_MS',
    ),
    distPath,
    trustProxy: trustedProxy ?? false,
    logger: mode !== 'test',
  };
}
