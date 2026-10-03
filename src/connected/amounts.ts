import { normalizeAmountInput, parseUSDCMicros } from '../domain';

/** Keep server integer amounts exact, including values beyond Number's range. */
export function decimalAmount(raw: string, decimals: number): string {
  if (!/^\d+$/.test(raw)) return 'Unavailable';
  const value = BigInt(raw);
  const scale = 10n ** BigInt(decimals);
  const fraction = (value % scale)
    .toString()
    .padStart(decimals, '0')
    .replace(/0+$/, '');
  return `${(value / scale).toLocaleString('en-GB')}${fraction ? `.${fraction}` : ''}`;
}

export const usdc = (raw: string) => `${decimalAmount(raw, 6)} USDC`;
export const kitten = (raw: string) => `${decimalAmount(raw, 18)} KITTEN`;
export const feeMicros = (raw: string) =>
  ((BigInt(raw) * 5n) / 1000n).toString();
export const interestMicros = (raw: string, aprBps: number, days: number) =>
  ((BigInt(raw) * BigInt(aprBps) * BigInt(days)) / (10_000n * 365n)).toString();
export const shortAddress = (address: string) =>
  `${address.slice(0, 6)}…${address.slice(-4)}`;
export const dateLabel = (value: string | number) => {
  const date = new Date(typeof value === 'number' ? value * 1000 : value);
  return Number.isNaN(date.getTime())
    ? 'Unavailable'
    : new Intl.DateTimeFormat('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(date);
};

export function parseAmount(value: string): string | null {
  const micros = parseUSDCMicros(normalizeAmountInput(value));
  return micros !== null && micros > 0n ? micros.toString() : null;
}

export function parseApr(value: string): number | null {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  const bps = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(bps) && bps >= 100 && bps <= 4000 ? bps : null;
}

export function validateOfferTerms(
  principalMicros: string,
  aprBps: number,
  durationDays: number,
  request: { principalMicros: string; aprBps: number; durationDays: number },
): string | null {
  if (
    principalMicros !== request.principalMicros ||
    durationDays !== request.durationDays
  )
    return 'The offer amount and duration must match the borrowing request.';
  if (aprBps > request.aprBps)
    return `Offer an APR of ${request.aprBps / 100}% or lower, as requested by the borrower.`;
  return null;
}

/** Quote calculation is integer-only; fresh server reads remain authoritative. */
export function listingAskMicros(
  listing: Pick<
    import('./api').Listing,
    | 'kind'
    | 'startPriceMicros'
    | 'endPriceMicros'
    | 'startsAt'
    | 'auctionEndsAt'
  >,
  now = Date.now(),
): string {
  if (listing.kind === 'fixed') return listing.startPriceMicros;
  const start = Date.parse(listing.startsAt);
  const end = Date.parse(listing.auctionEndsAt!);
  const duration = BigInt(end - start);
  const remaining = BigInt(
    Math.min(Math.max(Math.trunc(end - now), 0), end - start),
  );
  const scale = 10n ** 18n;
  const fraction = (remaining * scale) / duration;
  const squared = (fraction * fraction) / scale;
  const cubed = (squared * fraction) / scale;
  return (
    BigInt(listing.endPriceMicros) +
    ((BigInt(listing.startPriceMicros) - BigInt(listing.endPriceMicros)) *
      cubed) /
      scale
  ).toString();
}
