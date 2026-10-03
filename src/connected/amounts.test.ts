import { describe, expect, it } from 'vitest';
import {
  decimalAmount,
  listingAskMicros,
  feeMicros,
  interestMicros,
  parseAmount,
  parseApr,
  validateOfferTerms,
} from './amounts';

describe('connected exact amounts', () => {
  it('shows large token balances and the last token unit without Number rounding', () => {
    expect(decimalAmount('900719925474099312345678901234567891', 18)).toBe(
      '900,719,925,474,099,312.345678901234567891',
    );
    expect(decimalAmount('1', 18)).toBe('0.000000000000000001');
  });
  it('floors future settlement fees and interest at a single USDC micro', () => {
    expect(feeMicros('1000199')).toBe('5000');
    expect(interestMicros('1000001', 1234, 7)).toBe('2366');
  });
  it('rejects alternate numeric encodings in connected money and APR forms', () => {
    for (const input of ['1e3', '+12', '0x10', '12.0000001'])
      expect(parseAmount(input)).toBeNull();
    for (const input of ['1e1', '+12', '0x10', '12.001', '40.01'])
      expect(parseApr(input)).toBeNull();
    expect(parseAmount('1.000001')).toBe('1000001');
    expect(parseApr('12.34')).toBe(1234);
  });
  it('forgives surrounding spaces and bare decimal points in listing prices', () => {
    expect(parseAmount(' 250 ')).toBe('250000000');
    expect(parseAmount('.5')).toBe('500000');
    expect(parseAmount('5.')).toBe('5000000');
    for (const input of ['1,5', '. 5', '.'])
      expect(parseAmount(input)).toBeNull();
  });
});

describe('lending offer consent', () => {
  const request = {
    principalMicros: '1000000001',
    aprBps: 1234,
    durationDays: 14,
  };
  it('accepts the requested rate and a lower rate with the same exact principal and duration', () => {
    expect(validateOfferTerms('1000000001', 1234, 14, request)).toBeNull();
    expect(validateOfferTerms('1000000001', 100, 14, request)).toBeNull();
  });
  it('rejects an offer exceeding the requested APR by one basis point', () => {
    expect(validateOfferTerms('1000000001', 1235, 14, request)).toContain(
      '12.34% or lower',
    );
  });
  it('rejects a changed principal micro or a different duration', () => {
    expect(validateOfferTerms('1000000000', 1000, 14, request)).toContain(
      'amount and duration',
    );
    expect(validateOfferTerms('1000000001', 1000, 7, request)).toContain(
      'amount and duration',
    );
  });
});

describe('connected Dutch quotes', () => {
  const begin = Date.parse('2026-10-02T18:00:00.000Z');
  const quote = {
    kind: 'dutch' as const,
    startPriceMicros: '900000000',
    endPriceMicros: '100000000',
    startsAt: new Date(begin).toISOString(),
    auctionEndsAt: new Date(begin + 3600000).toISOString(),
  };
  it('holds the starting ask before creation and reaches the cubic midpoint', () => {
    expect(listingAskMicros(quote, begin - 1)).toBe('900000000');
    expect(listingAskMicros(quote, begin + 1800000)).toBe('200000000');
  });
  it('holds the floor after decay without rounding below it', () => {
    expect(listingAskMicros(quote, begin + 3600000)).toBe('100000000');
    expect(listingAskMicros(quote, begin + 86400000)).toBe('100000000');
    expect(
      BigInt(listingAskMicros(quote, begin + 3599999)),
    ).toBeGreaterThanOrEqual(100000000n);
  });
  it('keeps fixed asks exact and independent of the client clock', () => {
    expect(
      listingAskMicros(
        {
          ...quote,
          kind: 'fixed',
          auctionEndsAt: null,
          startPriceMicros: '1000000000000',
          endPriceMicros: '1000000000000',
        },
        begin + 365 * 86400000,
      ),
    ).toBe('1000000000000');
  });
});
