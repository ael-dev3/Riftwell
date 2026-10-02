import Database from 'better-sqlite3';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Store } from './types.ts';

export function openDatabase(path: string): Store {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new Database(path, { timeout: 5000 });
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

export function appendAudit(
  db: Store,
  now: number,
  actor: string | null,
  event: string,
  entityType: string,
  entityId: string | null,
  detail: Record<string, unknown> = {},
) {
  db.prepare(
    'INSERT INTO audit_events(created_at, actor, event, entity_type, entity_id, detail_json) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(now, actor, event, entityType, entityId, JSON.stringify(detail));
}

export function invalidateOffers(
  db: Store,
  requestId: string,
  now: number,
  actor: string | null = null,
): void {
  const rows = db
    .prepare<unknown[], { id: string }>(
      "SELECT id FROM offers WHERE request_id = ? AND status = 'proposed'",
    )
    .all(requestId);
  const update = db.prepare(
    "UPDATE offers SET status = 'invalidated', updated_at = ? WHERE id = ? AND status = 'proposed'",
  );
  for (const row of rows) {
    update.run(now, row.id);
    appendAudit(db, now, actor, 'offer.invalidated', 'offer', row.id, {
      requestId,
    });
  }
}

export function expireRecords(db: Store, now: number): void {
  db.transaction(() => {
    for (const [table, kind] of [
      ['listings', 'listing'],
      ['loan_requests', 'loan-request'],
    ]) {
      const rows = db
        .prepare<unknown[], { id: string }>(
          `SELECT id FROM ${table} WHERE status = 'active' AND expires_at <= ?`,
        )
        .all(now);
      for (const row of rows) {
        db.prepare(
          `UPDATE ${table} SET status = 'expired', updated_at = ?${table === 'listings' ? ', revision = revision + 1' : ''} WHERE id = ? AND status = 'active'`,
        ).run(now, row.id);
        appendAudit(db, now, null, `${kind}.expired`, kind, row.id);
        if (table === 'loan_requests') invalidateOffers(db, row.id, now);
      }
    }
    const offers = db
      .prepare<unknown[], { id: string }>(
        "SELECT id FROM offers WHERE status = 'proposed' AND expires_at <= ?",
      )
      .all(now);
    for (const row of offers) {
      db.prepare(
        "UPDATE offers SET status = 'expired', updated_at = ? WHERE id = ? AND status = 'proposed'",
      ).run(now, row.id);
      appendAudit(db, now, null, 'offer.expired', 'offer', row.id);
    }
  })();
}

export function pruneAuth(db: Store, now: number): void {
  db.transaction(() => {
    const sessions = db
      .prepare('DELETE FROM sessions WHERE expires_at <= ?')
      .run(now).changes;
    const challenges = db
      .prepare('DELETE FROM challenges WHERE expires_at <= ?')
      .run(now - 86400000).changes;
    if (sessions || challenges)
      appendAudit(db, now, null, 'auth.pruned', 'auth', null, {
        sessions,
        challenges,
      });
  })();
}
