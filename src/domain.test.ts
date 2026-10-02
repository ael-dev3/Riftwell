import { describe, expect, it } from 'vitest';
import { ASSETS } from './data';
import {
  filterAssets,
  formatMicros,
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
    ).toEqual([2600, 3100, 4200]);
    expect(ASSETS[0].id).toBe('rift-041');
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
