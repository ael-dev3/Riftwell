import { fail } from './errors.ts';
import type { Clock } from './types.ts';

export class RateLimiter {
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
