import { fail } from './errors.mjs';

export class RateLimiter {
  constructor(now, maximumEntries = 10000) {
    this.now = now;
    this.maximumEntries = maximumEntries;
    this.entries = new Map();
  }
  prune() {
    const now = this.now();
    for (const [key, entry] of this.entries)
      if (entry.until <= now) this.entries.delete(key);
  }
  take(key, maximum, windowMs) {
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
