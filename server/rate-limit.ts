import { fail } from './errors.ts';
import type { Clock, Store } from './types.ts';

export interface RateControl {
  take(key: string, maximum: number, windowMs: number): void | Promise<void>;
  prune(): void | Promise<void>;
}

export class RateLimiter implements RateControl {
  readonly now: Clock;
  readonly maximumEntries: number;
  readonly entries = new Map<string, { count: number; until: number }>();
  constructor(now: Clock, maximumEntries = 10000) {
    this.now = now;
    this.maximumEntries = maximumEntries;
  }
  prune() {
    const now = this.now();
    for (const [key, entry] of this.entries)
      if (entry.until <= now) this.entries.delete(key);
  }
  take(key: string, maximum: number, windowMs: number): void {
    const now = this.now();
    let entry = this.entries.get(key);
    if (!entry || entry.until <= now) {
      if (this.entries.size >= this.maximumEntries) this.prune();
      if (this.entries.size >= this.maximumEntries)
        fail(429, 'RATE_LIMITED', 'Too many requests. Please try again later.');
      entry = { count: 0, until: now + windowMs };
      this.entries.set(key, entry);
    }
    if (++entry.count > maximum)
      fail(429, 'RATE_LIMITED', 'Too many requests. Please try again later.');
  }
}

/** PostgreSQL enforces the same window across cold starts and instances. */
export class PersistentRateLimiter implements RateControl {
  readonly db: Store;
  readonly now: Clock;
  readonly hash: (value: string) => string;
  constructor(db: Store, now: Clock, hash: (value: string) => string) {
    this.db = db;
    this.now = now;
    this.hash = hash;
  }
  async take(key: string, maximum: number, windowMs: number): Promise<void> {
    const now = this.now();
    const result = await this.db.get<{ count: number }>(
      `INSERT INTO rate_limits(key,count,until) VALUES (?,1,?)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE WHEN rate_limits.until <= ? THEN 1
                 ELSE LEAST(rate_limits.count + 1, ?) END,
         until = CASE WHEN rate_limits.until <= ? THEN ? ELSE rate_limits.until END
       RETURNING count`,
      this.hash(`rate-limit:${key}`),
      now + windowMs,
      now,
      maximum + 1,
      now,
      now + windowMs,
    );
    if (!result || result.count > maximum)
      fail(429, 'RATE_LIMITED', 'Too many requests. Please try again later.');
  }
  async prune(): Promise<void> {
    await this.db.run('DELETE FROM rate_limits WHERE until <= ?', this.now());
  }
}
