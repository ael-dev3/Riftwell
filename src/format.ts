import { microsToDecimal } from './domain';

/** Compact USDC display for headline figures; exact values use formatMicros. */
export const usd = (value: number) =>
  new Intl.NumberFormat('en-GB', {
    maximumFractionDigits: value >= 100_000 ? 0 : 2,
    minimumFractionDigits: 0,
  }).format(value);

/** Plain grouped number with up to six decimals, for tables with units in headers. */
export const plain = (value: number) =>
  new Intl.NumberFormat('en-GB', { maximumFractionDigits: 6 }).format(value);

/** Exact share amount from raw six-decimal units, grouped for display. */
export function formatShares(raw: string | bigint) {
  const [whole, fraction] = microsToDecimal(raw).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fraction ? `${grouped}.${fraction}` : grouped;
}
