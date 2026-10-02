import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.mjs';
import { loadConfig } from '../server/config.mjs';

const serverRequire = createRequire(
  new URL('../server/package.json', import.meta.url),
);
const { Wallet } = serverRequire('ethers');

// This service uses a temporary database and simulated read-only chain data.
// It never launches a browser, installs a wallet provider, or sends transactions.
export async function createQAService({
  port = Number(process.env.RIFTWELL_QA_PORT ?? 5194),
  distPath = process.env.RIFTWELL_CONNECTED_DIST ??
    '/tmp/riftwell-connected-qa',
  seedPublicListing = false,
  seedLegacyHistory = true,
} = {}) {
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('RIFTWELL_QA_PORT must be an integer from 1 to 65535');
  const alice = Wallet.createRandom();
  const bob = Wallet.createRandom();
  const directory = await mkdtemp(join(tmpdir(), 'riftwell-browser-'));
  const base = `http://127.0.0.1:${port}`;
  const config = loadConfig({
    NODE_ENV: 'test',
    APP_ORIGIN: base,
    PORT: String(port),
    DB_PATH: join(directory, 'application.sqlite'),
    SESSION_SECRET: randomBytes(32).toString('hex'),
    DIST_PATH: resolve(distPath),
  });
  const lockedUntil = new Date(Date.now() + 365 * 86400000).toISOString();
  let unavailable = false;
  let app;
  const position = (id) => ({
    id: `kittenswap-${id}`,
    tokenId: id,
    marketId: 'kittenswap',
    owner: alice.address,
    lockedAmountRaw: '123456789012345678901234',
    lockedUntil,
    votingPowerRaw: '98765432109876543210987',
    blockNumber: 47000000,
    blockHash: `0x${'ab'.repeat(32)}`,
    observedAt: new Date().toISOString(),
  });
  const checkChain = () => {
    if (unavailable)
      throw Object.assign(new Error('fixture outage'), {
        code: 'CHAIN_UNAVAILABLE',
      });
  };
  const chain = {
    async health() {
      checkChain();
      return { ready: true, available: true, chainId: 999 };
    },
    async getPosition(id) {
      checkChain();
      if (!['101', '102'].includes(id))
        throw Object.assign(new Error('missing'), {
          code: 'POSITION_NOT_FOUND',
        });
      return position(id);
    },
    async getPositions(ids) {
      checkChain();
      return ids.map((id) =>
        ['101', '102'].includes(id) ? position(id) : null,
      );
    },
    async getOwnedPositions(address) {
      checkChain();
      return {
        items:
          address.toLowerCase() === alice.address.toLowerCase()
            ? [position('101'), position('102')]
            : [],
        nextCursor: null,
      };
    },
  };
  const legacy = { requestId: randomUUID(), offerId: randomUUID() };
  async function start() {
    app = await createApp({ config, chain });
    try {
      await app.listen({ host: '127.0.0.1', port });
    } catch (error) {
      await app.close();
      throw error;
    }
  }
  try {
    await start();
    const created = Date.now();
    const expires = created + 7 * 86400000;
    app.store.transaction(() => {
      if (seedPublicListing)
        app.store
          .prepare(
            'INSERT INTO listings(id,market,token_id,owner,price_micros,expires_at,created_at,updated_at,status,position_json) VALUES (?,?,?,?,?,?,?,?,?,?)',
          )
          .run(
            randomUUID(),
            'kittenswap',
            '101',
            alice.address,
            '100000001',
            expires,
            created,
            created,
            'active',
            JSON.stringify(position('101')),
          );
      // Historical records are direct fixture rows: retired public APIs cannot create them.
      if (seedLegacyHistory) {
        app.store
          .prepare(
            'INSERT INTO loan_requests(id,market,token_id,owner,principal_micros,apr_bps,duration_days,expires_at,created_at,updated_at,status,position_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
          )
          .run(
            legacy.requestId,
            'kittenswap',
            '102',
            alice.address,
            '500000000',
            1200,
            14,
            expires,
            created,
            created,
            'active',
            JSON.stringify(position('102')),
          );
        app.store
          .prepare(
            'INSERT INTO offers(id,request_id,lender,principal_micros,apr_bps,duration_days,expires_at,created_at,updated_at,status) VALUES (?,?,?,?,?,?,?,?,?,?)',
          )
          .run(
            legacy.offerId,
            legacy.requestId,
            bob.address,
            '500000000',
            1025,
            14,
            expires,
            created,
            created,
            'proposed',
          );
      }
    })();
  } catch (error) {
    await app?.close();
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  return {
    base,
    alice,
    bob,
    legacy,
    get app() {
      return app;
    },
    setUnavailable(value) {
      unavailable = Boolean(value);
    },
    async restart() {
      await app.close();
      await start();
    },
    async close() {
      await app?.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const fixture = await createQAService({ seedPublicListing: true });
  console.log(`Connected QA fixture: ${fixture.base}`);
  console.log(
    'Temporary SQLite + simulated read-only positions; lending is not deployed. No browser or wallet provider is started.',
  );
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    await fixture.close();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
