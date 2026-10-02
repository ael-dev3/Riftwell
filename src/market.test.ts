import { describe, expect, it } from 'vitest';
import type { PurchaseReceipt } from './domain';
import {
  DAY_MS,
  SAMPLE_SALES,
  marketSales,
  marketSeries,
  receiptSales,
  salesInRange,
  summarize,
  type Sale,
} from './market';

const now = Date.parse('2026-10-02T12:00:00Z');
const receipt: PurchaseReceipt = {
  id: 'r1',
  assetId: 'rift-009',
  createdAt: '2026-10-02T10:00:00.000Z',
  kind: 'purchase',
  price: 3100,
  sellerFee: 15.5,
  destination: 'wallet',
};
const sale = (soldAt: number, discountBps: number, usdc: number): Sale => ({
  id: `s${soldAt}`,
  label: 'Test',
  lockedKitten: 1000,
  priceMicros: BigInt(usdc * 1e6),
  discountBps,
  soldAt,
  source: 'sample',
  swept: false,
});

describe('sample market history', () => {
  it('is fixed, labelled sample data consistent with the example rate', () => {
    expect(SAMPLE_SALES).toHaveLength(48);
    expect(new Set(SAMPLE_SALES.map((item) => item.id)).size).toBe(48);
    for (const item of SAMPLE_SALES) {
      expect(item.source).toBe('sample');
      expect(item.soldAt).toBeGreaterThanOrEqual(
        Date.parse('2026-08-03T00:00:00Z'),
      );
      expect(item.soldAt).toBeLessThan(Date.parse('2026-10-01T00:00:00Z'));
      const reference = BigInt(item.lockedKitten) * 100_000n;
      expect(item.priceMicros).toBeLessThan(reference);
      expect(item.priceMicros % 10_000n).toBe(0n);
      expect(item.discountBps).toBeGreaterThan(0);
      expect(item.discountBps).toBeLessThan(5000);
    }
    expect(SAMPLE_SALES.filter((item) => item.swept).length).toBeGreaterThan(0);
  });

  it('adds purchases from this browser with their discount', () => {
    const [mine] = receiptSales([receipt]);
    expect(mine).toMatchObject({
      label: 'Demo veKITTEN #009',
      lockedKitten: 40000,
      priceMicros: 3_100_000_000n,
      discountBps: 2250,
      source: 'yours',
      swept: false,
    });
    expect(receiptSales([{ ...receipt, assetId: 'missing' }])).toEqual([]);
    const swept = receiptSales([receipt, { ...receipt, id: 'r2' }]);
    expect(swept.every((item) => item.swept)).toBe(true);
    const all = marketSales([receipt]);
    expect(all[0].source).toBe('yours');
    expect(all).toHaveLength(49);
  });
});

describe('market statistics', () => {
  const sales = [
    sale(now - 1 * DAY_MS, 1000, 100),
    sale(now - 1 * DAY_MS + 1000, 2000, 300),
    sale(now - 10 * DAY_MS, 3000, 50),
    sale(now - 40 * DAY_MS, 500, 10),
  ];

  it('filters by UTC day ranges and summarizes exact volume', () => {
    expect(salesInRange(sales, '7d', now)).toHaveLength(2);
    expect(salesInRange(sales, '30d', now)).toHaveLength(3);
    expect(salesInRange(sales, 'all', now)).toHaveLength(4);
    expect(summarize(salesInRange(sales, '7d', now))).toEqual({
      count: 2,
      volumeMicros: 400_000_000n,
      discountBps: 1500,
    });
    expect(summarize([])).toEqual({
      count: 0,
      volumeMicros: 0n,
      discountBps: null,
    });
  });

  it('charts daily sales, volume and a carried average discount', () => {
    const counts = marketSeries(sales, '7d', 'sales', now);
    expect(counts.labels).toHaveLength(7);
    expect(counts.labels[6]).toBe('2 Oct');
    expect(counts.values).toEqual([0, 0, 0, 0, 0, 2, 0]);
    expect(marketSeries(sales, '7d', 'volume', now).values[5]).toBe(400);
    const discount = marketSeries(sales, '7d', 'discount', now).values;
    expect(discount).toEqual([15, 15, 15, 15, 15, 15, 15]);
    expect(marketSeries([], '30d', 'discount', now).values).toEqual(
      Array(30).fill(0),
    );
  });

  it('groups all-time history by KittenSwap epoch', () => {
    const series = marketSeries(sales, 'all', 'sales', now);
    expect(series.labels.at(-1)).toBe('Epoch 2961');
    expect(series.values.reduce((sum, value) => sum + value, 0)).toBe(4);
    expect(series.labels.every((label) => label.startsWith('Epoch '))).toBe(
      true,
    );
  });
});
