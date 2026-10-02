import { assetById } from './data';
import { discountBps, priceMicros, type PurchaseReceipt } from './domain';
import { EPOCH_SECONDS, epochAt } from './epoch';

// Market history for the preview: a fixed set of SAMPLE sales (fictional
// positions, dates and prices, never live data) plus the purchases saved in
// this browser. Every sample reference value uses the same illustrative rate
// as the listings: 0.1 USDC per KITTEN.

export type Sale = {
  id: string;
  label: string;
  lockedKitten: number;
  priceMicros: bigint;
  discountBps: number;
  soldAt: number;
  source: 'sample' | 'yours';
  swept: boolean;
};
export type SaleRange = '7d' | '30d' | 'all';
export type SaleMetric = 'discount' | 'sales' | 'volume';

export const DAY_MS = 86_400_000;
const EPOCH_MS = EPOCH_SECONDS * 1000;
const SAMPLE_START = Date.parse('2026-08-03T00:00:00Z');
const SAMPLE_END = Date.parse('2026-10-01T00:00:00Z');

// A small deterministic generator, so the sample history never changes.
function generator(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildSamples(): Sale[] {
  const random = generator(2961);
  const sales: Sale[] = [];
  for (let index = 0; index < 48; index++) {
    const locked = Math.round(Math.exp(7.4 + random() * 5.3) / 10) * 10; // ~1.6K–330K
    const discount = Math.round(800 + random() * 1700 + random() * 500);
    const reference = BigInt(locked) * 100_000n; // 0.1 USDC per KITTEN
    const price =
      ((reference * BigInt(10_000 - discount)) / 10_000n / 10_000n) * 10_000n;
    const soldAt =
      SAMPLE_START +
      Math.floor(random() * (SAMPLE_END - SAMPLE_START - DAY_MS) + DAY_MS / 2);
    sales.push({
      id: `sample-${201 + index}`,
      label: `Demo veKITTEN #${201 + index}`,
      lockedKitten: locked,
      priceMicros: price,
      discountBps: Number(10_000n - (price * 10_000n) / reference),
      soldAt,
      source: 'sample',
      swept: false,
    });
  }
  sales.sort((a, b) => a.soldAt - b.soldAt);
  // Mark a few back-to-back purchases as sweeps of several listings at once.
  for (const index of [7, 8, 23, 24, 25, 39, 40])
    sales[index] = { ...sales[index], soldAt: sales[index - 1].soldAt };
  for (const index of [6, 7, 8, 22, 23, 24, 25, 38, 39, 40])
    sales[index] = { ...sales[index], swept: true };
  return sales;
}

export const SAMPLE_SALES: readonly Sale[] = buildSamples();

/** Purchases saved in this browser, in the same shape as sample sales. */
export function receiptSales(receipts: readonly PurchaseReceipt[]): Sale[] {
  const counts = new Map<string, number>();
  for (const receipt of receipts)
    counts.set(receipt.createdAt, (counts.get(receipt.createdAt) ?? 0) + 1);
  return receipts.flatMap((receipt) => {
    const asset = assetById(receipt.assetId);
    if (!asset) return [];
    return [
      {
        id: receipt.id,
        label: asset.name,
        lockedKitten: asset.underlyingBalance,
        priceMicros: priceMicros(receipt.price),
        discountBps: discountBps({ ...asset, price: receipt.price }),
        soldAt: Date.parse(receipt.createdAt),
        source: 'yours' as const,
        swept: (counts.get(receipt.createdAt) ?? 0) > 1,
      },
    ];
  });
}

/** Sample and preview sales, newest first. */
export function marketSales(receipts: readonly PurchaseReceipt[]): Sale[] {
  return [...SAMPLE_SALES, ...receiptSales(receipts)].sort(
    (a, b) => b.soldAt - a.soldAt,
  );
}

const dayStart = (ms: number) => Math.floor(ms / DAY_MS) * DAY_MS;

export function salesInRange(
  sales: readonly Sale[],
  range: SaleRange,
  now: number,
): Sale[] {
  if (range === 'all') return [...sales];
  const days = range === '7d' ? 7 : 30;
  const since = dayStart(now) - (days - 1) * DAY_MS;
  return sales.filter((sale) => sale.soldAt >= since && sale.soldAt <= now);
}

export function summarize(sales: readonly Sale[]) {
  const volume = sales.reduce((sum, sale) => sum + sale.priceMicros, 0n);
  const discount = sales.length
    ? Math.round(
        sales.reduce((sum, sale) => sum + sale.discountBps, 0) / sales.length,
      )
    : null;
  return { count: sales.length, volumeMicros: volume, discountBps: discount };
}

const shortDate = (ms: number) =>
  new Date(ms).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });

/**
 * Chart buckets: UTC days for 7D and 30D, KittenSwap epochs (weeks from
 * Thursday 00:00 UTC) for All. Average discount carries the last value
 * across days without sales; counts and volume are zero there.
 */
export function marketSeries(
  sales: readonly Sale[],
  range: SaleRange,
  metric: SaleMetric,
  now: number,
): { labels: string[]; values: number[] } {
  let buckets: { start: number; end: number; label: string }[];
  if (range === 'all') {
    const first = sales.length
      ? Math.min(...sales.map((sale) => sale.soldAt))
      : now;
    const from = epochAt(first).period;
    const to = epochAt(now).period;
    buckets = [];
    for (let period = from; period <= to; period++)
      buckets.push({
        start: period * EPOCH_MS,
        end: (period + 1) * EPOCH_MS,
        label: `Epoch ${period}`,
      });
  } else {
    const days = range === '7d' ? 7 : 30;
    const today = dayStart(now);
    buckets = Array.from({ length: days }, (_, index) => {
      const start = today - (days - 1 - index) * DAY_MS;
      return { start, end: start + DAY_MS, label: shortDate(start) };
    });
  }
  const groups = buckets.map(({ start, end }) =>
    sales.filter((sale) => sale.soldAt >= start && sale.soldAt < end),
  );
  const labels = buckets.map((bucket) => bucket.label);
  if (metric === 'sales')
    return { labels, values: groups.map((group) => group.length) };
  if (metric === 'volume')
    return {
      labels,
      values: groups.map(
        (group) => Number(summarize(group).volumeMicros) / 1e6,
      ),
    };
  const averages = groups.map((group) => summarize(group).discountBps);
  // Before the first sale in range, show the first known average.
  let carried = averages.find((value) => value !== null) ?? null;
  return {
    labels,
    values: averages.map((value) => {
      if (value !== null) carried = value;
      return (carried ?? 0) / 100;
    }),
  };
}
