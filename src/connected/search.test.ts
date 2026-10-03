import { describe, expect, it } from 'vitest';
import { listingMatches } from './search';

const seller = '0x1d1010aBcDeF0000000000000000000000000101';
const listing = (tokenId: string) => ({ tokenId, owner: seller });

describe('connected marketplace search', () => {
  it('matches token IDs by prefix and never the digits inside an address', () => {
    for (const query of ['101', '#101', ' 101 '])
      expect(listingMatches(listing('101'), query, 'veKITTEN')).toBe(true);
    expect(listingMatches(listing('1015'), '101', 'veKITTEN')).toBe(true);
    expect(listingMatches(listing('102'), '101', 'veKITTEN')).toBe(false);
    expect(listingMatches(listing('2101'), '101', 'veKITTEN')).toBe(false);
  });

  it('matches sellers and position names as text', () => {
    expect(listingMatches(listing('102'), '0x1D1010', 'veKITTEN')).toBe(true);
    expect(listingMatches(listing('102'), 'vekitten #10', 'veKITTEN')).toBe(
      true,
    );
    expect(listingMatches(listing('102'), '0x999', 'veKITTEN')).toBe(false);
    expect(listingMatches(listing('102'), '', 'veKITTEN')).toBe(true);
  });
});
