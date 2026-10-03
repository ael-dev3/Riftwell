import { describe, expect, it } from 'vitest';
import { sampleDate, sampleShiftMs } from './sample-time';

const DAY = 86_400_000;
const authored = Date.parse('2026-10-02T00:00:00Z');

describe('sample dates', () => {
  it('stay as written on the authored day and never move backwards', () => {
    expect(sampleShiftMs(authored)).toBe(0);
    expect(sampleShiftMs(authored + DAY - 1)).toBe(0);
    expect(sampleShiftMs(authored - 30 * DAY)).toBe(0);
    expect(sampleDate('2028-10-01', 0)).toBe('2028-10-01');
  });

  it('move forward by whole days with the calendar', () => {
    const later = sampleShiftMs(authored + 45 * DAY + 3_600_000);
    expect(later).toBe(45 * DAY);
    expect(sampleDate('2027-01-02', later)).toBe('2027-02-16');
    expect(sampleDate('2028-02-28', DAY)).toBe('2028-02-29');
  });
});
