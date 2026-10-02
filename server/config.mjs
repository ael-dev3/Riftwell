import { randomBytes } from 'node:crypto';
import { isAbsolute, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverRoot = fileURLToPath(new URL('.', import.meta.url));

function integer(value, fallback, minimum, maximum, name) {
  const text = value ?? String(fallback);
  if (!/^(0|[1-9][0-9]*)$/.test(text)) throw new Error(`Invalid ${name}`);
  const result = Number(text);
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum)
    throw new Error(`Invalid ${name}`);
  return result;
}

export function loadConfig(env = process.env) {
  const mode = env.NODE_ENV ?? 'development';
  if (!['production', 'development', 'test'].includes(mode))
    throw new Error('Invalid NODE_ENV');
  const production = mode === 'production';
  const port = integer(env.PORT, 8080, 1, 65535, 'PORT');
  if (production && (!env.APP_ORIGIN || !env.DB_PATH || !env.SESSION_SECRET))
    throw new Error(
      'APP_ORIGIN, DB_PATH and SESSION_SECRET are required in production',
    );
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
    origin: origin.origin,
    dbPath,
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
