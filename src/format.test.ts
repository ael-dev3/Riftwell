import { describe, expect, it } from 'vitest';
import { formatShares, plain, usd } from './format';

describe('display formatting', () => {
  it('groups exact share amounts without rounding', () => {
    expect(formatShares('750000000')).toBe('750');
    expect(formatShares('1000000000')).toBe('1,000');
    expect(formatShares(1234567890123n)).toBe('1,234,567.890123');
    expect(formatShares('0')).toBe('0');
  });

  it('keeps headline and table numbers compact', () => {
    expect(usd(280750)).toBe('280,750');
    expect(usd(1592.5)).toBe('1,592.5');
    expect(plain(0.0775)).toBe('0.0775');
    expect(plain(310000)).toBe('310,000');
  });
});
