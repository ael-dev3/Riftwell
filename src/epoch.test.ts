import { describe, expect, it } from 'vitest';
import {
  describeCountdown,
  epochAt,
  epochStartMs,
  formatCountdown,
  formatFlip,
} from './epoch';

describe('KittenSwap weekly periods', () => {
  it('matches the period observed on chain for 2 October 2026', () => {
    const clock = epochAt(Date.parse('2026-10-02T12:00:00Z'));
    expect(clock.period).toBe(2961);
    expect(new Date(clock.startMs).toISOString()).toBe(
      '2026-10-01T00:00:00.000Z',
    );
    expect(new Date(clock.endMs).toISOString()).toBe(
      '2026-10-08T00:00:00.000Z',
    );
    expect(new Date(clock.startMs).getUTCDay()).toBe(4);
  });

  it('flips exactly at Thursday 00:00 UTC', () => {
    const before = epochAt(Date.parse('2026-10-07T23:59:59.999Z'));
    const after = epochAt(Date.parse('2026-10-08T00:00:00Z'));
    expect(before.period).toBe(2961);
    expect(after.period).toBe(2962);
    expect(after.remainingMs).toBe(604_800_000);
    expect(after.progress).toBe(0);
    expect(epochStartMs(2962)).toBe(after.startMs);
  });

  it('formats countdowns at minute resolution', () => {
    expect(formatCountdown(((5 * 24 + 5) * 60 + 4) * 60_000 + 59_000)).toBe(
      '5d 05h 04m',
    );
    expect(formatCountdown(-1)).toBe('0d 00h 00m');
    expect(describeCountdown(((24 + 1) * 60 + 1) * 60_000)).toBe(
      '1 day, 1 hour and 1 minute',
    );
    expect(describeCountdown(2 * 60 * 60_000)).toBe('2 hours');
    expect(describeCountdown(30_000)).toBe('less than a minute');
    expect(formatFlip(Date.parse('2026-10-08T00:00:00Z'))).toBe(
      'Thu 8 Oct, 00:00 UTC',
    );
  });
});
