import { describe, expect, it } from 'vitest';
import { ASSETS, LISTINGS, SMALL_POSITION_KITTEN } from './data';
import {
  discountBps,
  filterAssets,
  formatBps,
  formatLockRemaining,
  formatMicros,
  lockDaysRemaining,
  marketplaceFee,
  marketplaceProceeds,
  microsToDecimal,
  parsePortfolio,
  parseUSDCMicros,
} from './domain';

describe('exact USDC amounts and marketplace fees', () => {
  it('charges the seller 0.5% and preserves the full buyer price', () => {
    expect(marketplaceFee(4200)).toBe(21);
    expect(marketplaceProceeds(4200)).toBe(4179);
  });
  it('floors fees at the micro boundary', () => {
    expect(marketplaceFee(1.000199)).toBe(0.005);
    expect(marketplaceFee(1.0002)).toBe(0.005001);
    expect(marketplaceProceeds(1.000199)).toBe(0.995199);
  });
  it('rejects ambiguous numeric notation and fractional micros', () => {
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
    ])
      expect(parseUSDCMicros(amount)).toBeNull();
    expect(parseUSDCMicros('1.123456')).toBe(1123456n);
  });
  it('formats exact values without losing the last micro', () => {
    expect(formatMicros('123456789012345678')).toBe(
      '123,456,789,012.345678 USDC',
    );
    expect(microsToDecimal('1000001')).toBe('1.000001');
    expect(microsToDecimal('1000000')).toBe('1');
  });
});

describe('position discovery', () => {
  it('matches position names without case or surrounding-space sensitivity', () => {
    expect(
      filterAssets(ASSETS, '  VEKITTEN #041  ', 'All', 'curated').map(
        (asset) => asset.id,
      ),
    ).toEqual(['rift-041']);
  });
  it('combines lock filters and ask sorting without mutating source data', () => {
    expect(
      filterAssets(ASSETS, '', 'Short lock', 'price-asc').map(
        (asset) => asset.price,
      ),
    ).toEqual([140, 180, 1020, 1780, 2600, 3100, 4200]);
    expect(ASSETS[0].id).toBe('rift-041');
  });
  it('hides small positions and sorts by discount, balance and unlock', () => {
    const visible = filterAssets(LISTINGS, '', 'All', 'curated', {
      hideSmall: true,
      smallBelow: SMALL_POSITION_KITTEN,
    });
    expect(visible.map((asset) => asset.id)).not.toContain('rift-095');
    expect(visible.map((asset) => asset.id)).not.toContain('rift-133');
    expect(visible).toHaveLength(LISTINGS.length - 2);
    const byDiscount = filterAssets(LISTINGS, '', 'All', 'discount-desc');
    expect(byDiscount[0].id).toBe('rift-062');
    for (let index = 1; index < byDiscount.length; index++)
      expect(discountBps(byDiscount[index - 1])).toBeGreaterThanOrEqual(
        discountBps(byDiscount[index]),
      );
    expect(filterAssets(LISTINGS, '', 'All', 'balance-desc')[0].id).toBe(
      'rift-156',
    );
    expect(filterAssets(LISTINGS, '', 'All', 'unlock-asc')[0].id).toBe(
      'rift-062',
    );
  });
});

describe('listing economics', () => {
  it('measures the ask discount against the fixed example reference value', () => {
    const asset = ASSETS.find((item) => item.id === 'rift-041')!;
    expect(asset.referenceValue).toBe(5000);
    expect(discountBps(asset)).toBe(1600);
    expect(formatBps(1600)).toBe('16.00%');
    expect(discountBps({ price: 120, referenceValue: 100 })).toBe(-2000);
    expect(discountBps({ price: 10, referenceValue: 0 })).toBe(0);
  });
  it('counts remaining lock time in whole UTC days and never goes negative', () => {
    const now = Date.parse('2026-10-02T12:00:00Z');
    expect(lockDaysRemaining('2026-10-03', now)).toBe(1);
    expect(lockDaysRemaining('2026-09-01', now)).toBe(0);
    expect(lockDaysRemaining('not a date', now)).toBe(0);
    expect(formatLockRemaining(0)).toBe('Unlocked');
    expect(formatLockRemaining(12)).toBe('12d');
    expect(formatLockRemaining(45)).toBe('1m 15d');
    expect(formatLockRemaining(60)).toBe('2m');
    expect(formatLockRemaining(365)).toBe('1y');
    expect(formatLockRemaining(730 + 70)).toBe('2y 2m');
    expect(formatLockRemaining(727)).toBe('2y');
    expect(formatLockRemaining(362)).toBe('1y');
    expect(formatLockRemaining(365 + 45)).toBe('1y 1m');
  });
  it('keeps every sample reference value at the stated example rate', () => {
    for (const asset of ASSETS)
      expect(asset.referenceValue).toBe(asset.underlyingBalance / 10);
  });
});

describe('stored marketplace previews', () => {
  const ids = ASSETS.map((asset) => asset.id);
  const purchase = {
    id: 'one',
    assetId: 'rift-041',
    createdAt: '2026-10-02T12:00:00Z',
    kind: 'purchase',
    price: 4200,
    sellerFee: 21,
  };
  it('recovers from corrupt storage and filters invalid or duplicate purchases', () => {
    expect(parsePortfolio('not JSON', ids).receipts).toEqual([]);
    const raw = JSON.stringify({
      version: 3,
      receipts: [
        purchase,
        { ...purchase, id: 'two', assetId: 'unknown' },
        { ...purchase, id: 'three', createdAt: 'invalid' },
        { ...purchase, id: 'four' },
        { ...purchase, id: 'five', assetId: 'rift-018', sellerFee: 100 },
      ],
    });
    expect(
      parsePortfolio(raw, ids).receipts.map((receipt) => receipt.id),
    ).toEqual(['one']);
  });
  it('accepts only known purchase destinations', () => {
    const raw = (destination: unknown) =>
      JSON.stringify({ version: 3, receipts: [{ ...purchase, destination }] });
    expect(parsePortfolio(raw('wallet'), ids).receipts).toHaveLength(1);
    expect(parsePortfolio(raw('collateral'), ids).receipts).toHaveLength(1);
    expect(parsePortfolio(raw('vault'), ids).receipts).toHaveLength(0);
  });
  it('migrates purchases without treating old proposals or loans as pooled deposits', () => {
    const result = parsePortfolio(
      JSON.stringify({
        version: 2,
        receipts: [
          purchase,
          {
            id: 'old-loan',
            assetId: 'rift-018',
            kind: 'borrow',
            principal: 2000,
          },
          {
            id: 'old-offer',
            assetId: 'rift-012',
            kind: 'lend',
            principal: 3000,
          },
        ],
      }),
      ids,
    );
    expect(result.version).toBe(3);
    expect(result.receipts).toEqual([purchase]);
  });
});
