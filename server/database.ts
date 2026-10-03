import type Database from 'better-sqlite3';
import { createRequire } from 'node:module';
import { AsyncLocalStorage } from 'node:async_hooks';
import postgres from 'postgres';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  ServerConfig,
  SqliteStore,
  SqlParameter,
  Store,
} from './types.ts';

export function openDatabase(path: string): SqliteStore {
  // Native SQLite is loaded only in the local/container runtime. The serverless
  // PostgreSQL path never loads a native addon.
  const SQLite = createRequire(import.meta.url)(
    'better-sqlite3',
  ) as typeof Database;
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new SQLite(path, { timeout: 5000 });
  try {
    chmodSync(path, 0o600);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = FULL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    const version: unknown = db.pragma('user_version', { simple: true });
    if (typeof version !== 'number' || version < 0 || version > 3)
      throw new Error('Unsupported database schema');
    if (version < 3)
      db.transaction(() => {
        // Acquire the write lock before checking the version again: two service
        // processes may both have observed a legacy database before migration.
        const currentVersion: unknown = db.pragma('user_version', {
          simple: true,
        });
        if (
          typeof currentVersion !== 'number' ||
          currentVersion < 0 ||
          currentVersion > 3
        )
          throw new Error('Unsupported database schema');
        if (currentVersion === 0)
          db.exec(`
        CREATE TABLE challenges (
          id TEXT PRIMARY KEY, address TEXT NOT NULL, chain_id INTEGER NOT NULL CHECK(chain_id = 999),
          nonce TEXT NOT NULL UNIQUE, message TEXT NOT NULL,
          created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, consumed_at INTEGER
        );
        CREATE TABLE sessions (
          token_hash TEXT PRIMARY KEY, address TEXT NOT NULL, chain_id INTEGER NOT NULL CHECK(chain_id = 999),
          csrf_hash TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
        );
        CREATE INDEX sessions_expiry ON sessions(expires_at);
        CREATE INDEX challenges_expiry ON challenges(expires_at);
        CREATE TABLE listings (
          id TEXT PRIMARY KEY, market TEXT NOT NULL CHECK(market = 'kittenswap'), token_id TEXT NOT NULL,
          owner TEXT NOT NULL, price_micros TEXT NOT NULL, expires_at INTEGER NOT NULL,
          created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('active','cancelled','expired','invalidated')),
          position_json TEXT NOT NULL
        );
        CREATE UNIQUE INDEX listing_active_token ON listings(market, token_id) WHERE status = 'active';
        CREATE INDEX listing_page ON listings(status, created_at, id);
        CREATE INDEX listing_owner ON listings(owner, created_at);
        CREATE TABLE loan_requests (
          id TEXT PRIMARY KEY, market TEXT NOT NULL CHECK(market = 'kittenswap'), token_id TEXT NOT NULL,
          owner TEXT NOT NULL, principal_micros TEXT NOT NULL, apr_bps INTEGER NOT NULL,
          duration_days INTEGER NOT NULL, expires_at INTEGER NOT NULL,
          created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('active','cancelled','expired','invalidated')),
          position_json TEXT NOT NULL
        );
        CREATE UNIQUE INDEX request_active_token ON loan_requests(market, token_id) WHERE status = 'active';
        CREATE INDEX request_page ON loan_requests(status, created_at, id);
        CREATE INDEX request_owner ON loan_requests(owner, created_at);
        CREATE TABLE offers (
          id TEXT PRIMARY KEY, request_id TEXT NOT NULL REFERENCES loan_requests(id), lender TEXT NOT NULL,
          principal_micros TEXT NOT NULL, apr_bps INTEGER NOT NULL, duration_days INTEGER NOT NULL,
          expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('proposed','cancelled','expired','invalidated'))
        );
        CREATE UNIQUE INDEX offer_active_lender ON offers(request_id, lender) WHERE status = 'proposed';
        CREATE INDEX offer_lender ON offers(lender, created_at);
        CREATE TABLE idempotency (
          actor TEXT NOT NULL, operation TEXT NOT NULL, key TEXT NOT NULL, payload_hash TEXT NOT NULL,
          entity_id TEXT NOT NULL, response_json TEXT NOT NULL, created_at INTEGER NOT NULL,
          PRIMARY KEY(actor, operation, key)
        );
        CREATE TABLE audit_events (
          sequence INTEGER PRIMARY KEY AUTOINCREMENT, created_at INTEGER NOT NULL,
          actor TEXT, event TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT,
          detail_json TEXT NOT NULL
        );
        PRAGMA user_version = 1;
      `);
        if (currentVersion < 2)
          db.exec(`
          ALTER TABLE listings ADD COLUMN revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0);
          PRAGMA user_version = 2;
          `);
        if (currentVersion < 3)
          db.exec(`
            ALTER TABLE listings ADD COLUMN kind TEXT NOT NULL DEFAULT 'fixed' CHECK(kind IN ('fixed','dutch'));
            ALTER TABLE listings ADD COLUMN end_price_micros TEXT NOT NULL DEFAULT '1000000';
            ALTER TABLE listings ADD COLUMN starts_at INTEGER NOT NULL DEFAULT 0;
            ALTER TABLE listings ADD COLUMN auction_ends_at INTEGER;
            ALTER TABLE listings ADD COLUMN recipient TEXT;
            UPDATE listings SET end_price_micros = price_micros, starts_at = created_at;
            PRAGMA user_version = 3;
          `);
      }).immediate();
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

// Promise-based SQLite transactions must keep BEGIN/COMMIT around the entire
// awaited callback. Share the queue by filename so two apps in one process do
// not block the event loop waiting on each other's SQLite write locks.
const sqliteQueues = new Map<
  string,
  { tail: Promise<unknown>; users: number }
>();
function sqliteStore(path: string): Store {
  const sqlite = openDatabase(path);
  const state = sqliteQueues.get(path) ?? { tail: Promise.resolve(), users: 0 };
  state.users++;
  sqliteQueues.set(path, state);
  const context = new AsyncLocalStorage<boolean>();
  let savepointSequence = 0;
  let closed = false;
  const exclusive = <T>(operation: () => T | Promise<T>): Promise<T> => {
    if (closed) return Promise.reject(new Error('Database is closed'));
    if (context.getStore()) return Promise.resolve().then(operation);
    const result = state.tail.then(operation);
    state.tail = result.catch(() => {});
    return result;
  };
  const store: Store = {
    dialect: 'sqlite',
    sqlite,
    get: <T>(query: string, ...parameters: SqlParameter[]) =>
      exclusive(() =>
        sqlite.prepare<SqlParameter[], T>(query).get(...parameters),
      ),
    all: <T>(query: string, ...parameters: SqlParameter[]) =>
      exclusive(() =>
        sqlite.prepare<SqlParameter[], T>(query).all(...parameters),
      ),
    run: (query, ...parameters) =>
      exclusive(() => ({
        changes: sqlite.prepare(query).run(...parameters).changes,
      })),
    transaction: async <T>(operation: () => Promise<T>): Promise<T> => {
      if (context.getStore()) {
        const savepoint = `riftwell_${++savepointSequence}`;
        sqlite.exec(`SAVEPOINT ${savepoint}`);
        try {
          const result = await operation();
          sqlite.exec(`RELEASE SAVEPOINT ${savepoint}`);
          return result;
        } catch (error) {
          sqlite.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
          sqlite.exec(`RELEASE SAVEPOINT ${savepoint}`);
          throw error;
        }
      }
      return exclusive(async () => {
        sqlite.exec('BEGIN IMMEDIATE');
        try {
          const result = await context.run(true, operation);
          sqlite.exec('COMMIT');
          return result;
        } catch (error) {
          sqlite.exec('ROLLBACK');
          throw error;
        }
      });
    },
    close: async () => {
      if (closed) return;
      await exclusive(() => {
        if (closed) return;
        closed = true;
        try {
          sqlite.pragma('wal_checkpoint(TRUNCATE)');
        } finally {
          sqlite.close();
          state.users--;
          if (!state.users) sqliteQueues.delete(path);
        }
      });
    },
  };
  return store;
}

const postgresSchema = `
CREATE TABLE challenges (
  id TEXT PRIMARY KEY, address TEXT NOT NULL, chain_id INTEGER NOT NULL CHECK(chain_id = 999),
  nonce TEXT NOT NULL UNIQUE, message TEXT NOT NULL,
  created_at BIGINT NOT NULL, expires_at BIGINT NOT NULL, consumed_at BIGINT
);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY, address TEXT NOT NULL, chain_id INTEGER NOT NULL CHECK(chain_id = 999),
  csrf_hash TEXT NOT NULL, created_at BIGINT NOT NULL, expires_at BIGINT NOT NULL
);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE INDEX challenges_expiry ON challenges(expires_at);
CREATE TABLE listings (
  id TEXT PRIMARY KEY, market TEXT NOT NULL CHECK(market = 'kittenswap'), token_id TEXT NOT NULL,
  owner TEXT NOT NULL, price_micros TEXT NOT NULL, expires_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active','cancelled','expired','invalidated')),
  position_json TEXT NOT NULL, revision BIGINT NOT NULL DEFAULT 1 CHECK(revision > 0 AND revision <= 9007199254740991),
  kind TEXT NOT NULL DEFAULT 'fixed' CHECK(kind IN ('fixed','dutch')),
  end_price_micros TEXT NOT NULL DEFAULT '1000000', starts_at BIGINT NOT NULL DEFAULT 0,
  auction_ends_at BIGINT, recipient TEXT
);
CREATE UNIQUE INDEX listing_active_token ON listings(market, token_id) WHERE status = 'active';
CREATE INDEX listing_page ON listings(status, created_at, id);
CREATE INDEX listing_owner ON listings(owner, created_at);
CREATE TABLE loan_requests (
  id TEXT PRIMARY KEY, market TEXT NOT NULL CHECK(market = 'kittenswap'), token_id TEXT NOT NULL,
  owner TEXT NOT NULL, principal_micros TEXT NOT NULL, apr_bps INTEGER NOT NULL,
  duration_days INTEGER NOT NULL, expires_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active','cancelled','expired','invalidated')),
  position_json TEXT NOT NULL
);
CREATE UNIQUE INDEX request_active_token ON loan_requests(market, token_id) WHERE status = 'active';
CREATE INDEX request_page ON loan_requests(status, created_at, id);
CREATE INDEX request_owner ON loan_requests(owner, created_at);
CREATE TABLE offers (
  id TEXT PRIMARY KEY, request_id TEXT NOT NULL REFERENCES loan_requests(id), lender TEXT NOT NULL,
  principal_micros TEXT NOT NULL, apr_bps INTEGER NOT NULL, duration_days INTEGER NOT NULL,
  expires_at BIGINT NOT NULL, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('proposed','cancelled','expired','invalidated'))
);
CREATE UNIQUE INDEX offer_active_lender ON offers(request_id, lender) WHERE status = 'proposed';
CREATE INDEX offer_lender ON offers(lender, created_at);
CREATE TABLE idempotency (
  actor TEXT NOT NULL, operation TEXT NOT NULL, key TEXT NOT NULL, payload_hash TEXT NOT NULL,
  entity_id TEXT NOT NULL, response_json TEXT NOT NULL, created_at BIGINT NOT NULL,
  PRIMARY KEY(actor, operation, key)
);
CREATE TABLE audit_events (
  sequence BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, created_at BIGINT NOT NULL,
  actor TEXT, event TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT,
  detail_json TEXT NOT NULL
);
`;

// All writes use a short database-wide transaction lock, mirroring SQLite's
// single writer. RPC calls stay outside transactions. The lock lives in PG,
// covers every service instance, and is scoped by schema for isolated databases.
const writeLock =
  'SELECT pg_advisory_xact_lock(729692930, hashtext(current_schema()))';

/** Convert the application's bound ? placeholders, never interpolating values. */
function postgresQuery(query: string): string {
  let result = '';
  let quoted = false;
  let parameter = 0;
  for (let index = 0; index < query.length; index++) {
    const character = query[index];
    if (character === "'") {
      if (quoted && query[index + 1] === "'") {
        result += "''";
        index++;
        continue;
      }
      quoted = !quoted;
    }
    result += character === '?' && !quoted ? `$${++parameter}` : character;
  }
  return result;
}

export async function openPostgresStore(
  databaseUrl: string,
  poolSize = 3,
): Promise<Store> {
  const url = new URL(databaseUrl);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const sql = postgres(databaseUrl, {
    max: poolSize,
    // Verify the certificate for managed PostgreSQL, including URLs whose
    // sslmode=require would otherwise encrypt without authenticating the server.
    ssl: local ? undefined : { rejectUnauthorized: true },
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 20,
    max_lifetime: 300,
    onnotice: () => {},
    connection: {
      application_name: 'riftwell',
      statement_timeout: 15000,
      lock_timeout: 5000,
      idle_in_transaction_session_timeout: 15000,
    },
    transform: {
      value: {
        from: (value, column) => {
          if (value === null || column.type !== 20) return value;
          const number = Number(value);
          if (!Number.isSafeInteger(number))
            throw new Error('Database integer exceeds supported precision');
          return number;
        },
      },
    },
  });
  const context = new AsyncLocalStorage<postgres.TransactionSql>();
  const query = <T extends unknown[]>(
    text: string,
    parameters: SqlParameter[],
  ) => (context.getStore() ?? sql).unsafe<T>(postgresQuery(text), parameters);
  const store: Store = {
    dialect: 'postgres',
    get: async <T>(text: string, ...parameters: SqlParameter[]) =>
      (await query<T[]>(text, parameters))[0],
    all: async <T>(text: string, ...parameters: SqlParameter[]) =>
      Array.from(await query<T[]>(text, parameters)),
    run: async (text, ...parameters) => ({
      changes: (await query(text, parameters)).count ?? 0,
    }),
    transaction: async <T>(operation: () => Promise<T>): Promise<T> => {
      const parent = context.getStore();
      if (parent) {
        const result = await parent.savepoint(async (nested) => ({
          value: await context.run(nested, operation),
        }));
        return result.value;
      }
      const result = await sql.begin(
        'isolation level read committed',
        async (transaction) => {
          await transaction.unsafe(writeLock);
          // Explicit wrapper avoids Postgres.js treating array callback results as
          // arrays of pending SQL queries. Callers receive their exact result.
          return { value: await context.run(transaction, operation) };
        },
      );
      return result.value;
    },
    close: () => sql.end({ timeout: 5 }),
  };
  try {
    await store.transaction(async () => {
      await store.run(
        'CREATE TABLE IF NOT EXISTS riftwell_schema (version INTEGER PRIMARY KEY CHECK(version > 0))',
      );
      const versions = await store.all<{ version: number }>(
        'SELECT version FROM riftwell_schema',
      );
      const version = versions[0]?.version ?? 0;
      if (versions.length > 1 || version < 0 || version > 2)
        throw new Error('Unsupported PostgreSQL database schema');
      if (version === 0) {
        await store.run(postgresSchema);
        await store.run('INSERT INTO riftwell_schema(version) VALUES (1)');
      }
      if (version < 2) {
        await store.run(
          'CREATE TABLE rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL CHECK(count > 0), until BIGINT NOT NULL)',
        );
        await store.run(
          'CREATE INDEX rate_limits_expiry ON rate_limits(until)',
        );
        await store.run('UPDATE riftwell_schema SET version = 2');
      }
    });
    return store;
  } catch (error) {
    await store.close();
    throw error;
  }
}

export async function openStore(config: ServerConfig): Promise<Store> {
  return config.databaseUrl
    ? openPostgresStore(config.databaseUrl, config.databasePoolSize)
    : sqliteStore(config.dbPath);
}

export async function appendAudit(
  db: Store,
  now: number,
  actor: string | null,
  event: string,
  entityType: string,
  entityId: string | null,
  detail: Record<string, unknown> = {},
): Promise<void> {
  await db.run(
    'INSERT INTO audit_events(created_at, actor, event, entity_type, entity_id, detail_json) VALUES (?, ?, ?, ?, ?, ?)',
    now,
    actor,
    event,
    entityType,
    entityId,
    JSON.stringify(detail),
  );
}

export async function invalidateOffers(
  db: Store,
  requestId: string,
  now: number,
  actor: string | null = null,
): Promise<void> {
  const rows = await db.all<{ id: string }>(
    "SELECT id FROM offers WHERE request_id = ? AND status = 'proposed'",
    requestId,
  );
  for (const row of rows) {
    const { changes } = await db.run(
      "UPDATE offers SET status = 'invalidated', updated_at = ? WHERE id = ? AND status = 'proposed'",
      now,
      row.id,
    );
    if (changes)
      await appendAudit(db, now, actor, 'offer.invalidated', 'offer', row.id, {
        requestId,
      });
  }
}

export async function expireRecords(db: Store, now: number): Promise<void> {
  await db.transaction(async () => {
    for (const [table, kind] of [
      ['listings', 'listing'],
      ['loan_requests', 'loan-request'],
    ]) {
      const rows = await db.all<{ id: string }>(
        `SELECT id FROM ${table} WHERE status = 'active' AND expires_at <= ?`,
        now,
      );
      for (const row of rows) {
        const { changes } = await db.run(
          `UPDATE ${table} SET status = 'expired', updated_at = ?${table === 'listings' ? ', revision = revision + 1' : ''} WHERE id = ? AND status = 'active'`,
          now,
          row.id,
        );
        if (changes) {
          await appendAudit(db, now, null, `${kind}.expired`, kind, row.id);
          if (table === 'loan_requests')
            await invalidateOffers(db, row.id, now);
        }
      }
    }
    const offers = await db.all<{ id: string }>(
      "SELECT id FROM offers WHERE status = 'proposed' AND expires_at <= ?",
      now,
    );
    for (const row of offers) {
      const { changes } = await db.run(
        "UPDATE offers SET status = 'expired', updated_at = ? WHERE id = ? AND status = 'proposed'",
        now,
        row.id,
      );
      if (changes)
        await appendAudit(db, now, null, 'offer.expired', 'offer', row.id);
    }
  });
}

export async function pruneAuth(db: Store, now: number): Promise<void> {
  await db.transaction(async () => {
    const sessions = (
      await db.run('DELETE FROM sessions WHERE expires_at <= ?', now)
    ).changes;
    const challenges = (
      await db.run(
        'DELETE FROM challenges WHERE expires_at <= ?',
        now - 86400000,
      )
    ).changes;
    if (sessions || challenges)
      await appendAudit(db, now, null, 'auth.pruned', 'auth', null, {
        sessions,
        challenges,
      });
  });
}
