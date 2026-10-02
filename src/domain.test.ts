import { describe, expect, it } from 'vitest';
import { ASSETS } from './data';
import {
  calculateLoan,
  filterAssets,
  marketplaceFee,
  marketplaceProceeds,
  parsePortfolio,
  parseUSDCMicros,
  validateApr,
  validateLoan,
} from './domain';

describe('exact USDC fees and interest', () => {
  it('charges the seller 0.5% and preserves the full buyer price', () => {
    expect(marketplaceFee(4200)).toBe(21);
    expect(marketplaceProceeds(4200)).toBe(4179);
  });
  it('floors a fee at the micro boundary instead of rounding up', () => {
    expect(marketplaceFee(1.000199)).toBe(0.005);
    expect(marketplaceFee(1.0002)).toBe(0.005001);
    expect(marketplaceProceeds(1.000199)).toBe(0.995199);
  });
  it('separates the origination fee from prorated lender interest', () => {
    expect(calculateLoan(2000, 12, 30)).toEqual({
      principal: 2000,
      originationFee: 10,
      interest: 19.726027,
      netProceeds: 1990,
      repayment: 2019.726027,
    });
    expect(calculateLoan(1.123456, 12.34, 7).interest).toBe(0.002658);
  });
});

describe('position discovery', () => {
  it('matches IDs without case or surrounding-space sensitivity', () => {
    expect(
      filterAssets(ASSETS, '  VEKITTEN #041  ', 'All', 'curated').map(
        (asset) => asset.id,
      ),
    ).toEqual(['rift-041']);
  });
  it('combines lock filters and ask sorting without mutating the source', () => {
    expect(
      filterAssets(ASSETS, '', 'Short lock', 'price-asc').map(
        (asset) => asset.price,
      ),
    ).toEqual([2600, 3100, 4200]);
    expect(ASSETS[0].id).toBe('rift-041');
  });
});

describe('borrow and proposal validation', () => {
  it('rejects non-decimal notation and fractional USDC micros', () => {
    for (const amount of [
      '1e3',
      '0x10',
      '+10',
      '-10',
      ' 10 ',
      '1.0000001',
      '.5',
      '1.',
      'NaN',
      'Infinity',
    ]) {
      expect(parseUSDCMicros(amount)).toBeNull();
      expect(validateLoan(amount, 30, 2000)).not.toBeNull();
    }
    expect(parseUSDCMicros('1.123456')).toBe(1123456n);
  });
  it('enforces the sample minimum, collateral cap and supported durations', () => {
    for (const amount of ['', '0', '0.99', '2000.000001'])
      expect(validateLoan(amount, 30, 2000)).not.toBeNull();
    expect(validateLoan('2000', 999, 2000)).not.toBeNull();
    expect(validateLoan('2000', 30, 2000)).toBeNull();
  });
  it('keeps proposal APR within the explicit 1–40% preview range', () => {
    for (const apr of ['', '0', '40.01', '1e1', '+12', '12.345'])
      expect(validateApr(apr)).not.toBeNull();
    expect(validateApr('40.00')).toBeNull();
    expect(validateApr('12.34')).toBeNull();
  });
});

describe('stored preview receipts', () => {
  const ids = ASSETS.map((asset) => asset.id);
  const purchase = {
    id: 'one',
    assetId: 'rift-041',
    createdAt: '2026-10-02T12:00:00Z',
    kind: 'purchase',
    price: 4200,
    sellerFee: 21,
  };
  it('recovers from corrupt storage and ignores unknown assets or invalid receipts', () => {
    expect(parsePortfolio('not JSON', ids).receipts).toEqual([]);
    const raw = JSON.stringify({
      version: 2,
      receipts: [
        purchase,
        { ...purchase, id: 'two', assetId: 'unknown' },
        { ...purchase, id: 'three', createdAt: 'invalid' },
      ],
    });
    expect(
      parsePortfolio(raw, ids).receipts.map((receipt) => receipt.id),
    ).toEqual(['one']);
  });
  it('preserves purchases and active collateral across long cancellation histories', () => {
    const active = {
      id: 'active',
      assetId: 'rift-018',
      createdAt: '2026-10-02T12:00:01Z',
      kind: 'borrow',
      principal: 2000,
      apr: 12,
      duration: 30,
      originationFee: 10,
      interest: 19.726027,
      status: 'active',
    };
    const cancelled = Array.from({ length: 205 }, (_, index) => ({
      ...active,
      id: `cancelled-${index}`,
      status: 'cancelled',
    }));
    const result = parsePortfolio(
      JSON.stringify({
        version: 2,
        receipts: [purchase, active, ...cancelled],
      }),
      ids,
    );
    expect(result.receipts.some((receipt) => receipt.id === 'one')).toBe(true);
    expect(result.receipts.some((receipt) => receipt.id === 'active')).toBe(
      true,
    );
    expect(result.receipts).toHaveLength(202);
  });
});
