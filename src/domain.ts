import type { MarketId } from './markets.ts';

export type AssetCategory = 'Short lock' | 'Long lock' | 'Max lock';
export type Asset = {
  id: string;
  name: string;
  collection: string;
  marketId: MarketId;
  underlyingSymbol: string;
  category: AssetCategory;
  artwork: string;
  price: number;
  referenceValue: number;
  underlyingBalance: number;
  lockTerm: string;
  unlockDate: string;
  positionId: string;
  description: string;
};

export type SortOrder =
  | 'curated'
  | 'price-asc'
  | 'price-desc'
  | 'discount-desc'
  | 'balance-desc'
  | 'unlock-asc';
export const PLATFORM_FEE_RATE = 0.005;
const USDC_SCALE = 1_000_000n;
const DAY_MS = 86_400_000;

/** Parse decimal USDC exactly. Scientific notation, signs and fractional micros are rejected. */
export function parseUSDCMicros(value: string): bigint | null {
  if (value.length > 32 || !/^\d+(?:\.\d{1,6})?$/.test(value)) return null;
  const [whole = '', fraction = ''] = value.split('.');
  return BigInt(whole) * USDC_SCALE + BigInt(fraction.padEnd(6, '0'));
}

/** Convert exact micro amounts to a number only at the bounded sample UI boundary. */
export const roundAmount = (micros: bigint): number =>
  Number(micros) / Number(USDC_SCALE);

function amountToMicros(value: number): bigint {
  const micros = parseUSDCMicros(String(value));
  if (micros === null || micros > BigInt(Number.MAX_SAFE_INTEGER))
    throw new RangeError(
      'Amount must be a bounded decimal with at most six places.',
    );
  return micros;
}

export const marketplaceFee = (price: number): number =>
  roundAmount((amountToMicros(price) * 5n) / 1000n);
export const marketplaceProceeds = (price: number): number => {
  const principal = amountToMicros(price);
  return roundAmount(principal - (principal * 5n) / 1000n);
};
export const priceMicros = (price: number): bigint => amountToMicros(price);

/** Ask discount against the fixed example reference value, in basis points. */
export function discountBps(asset: Pick<Asset, 'price' | 'referenceValue'>) {
  const reference = amountToMicros(asset.referenceValue);
  if (reference === 0n) return 0;
  return Number(
    ((reference - amountToMicros(asset.price)) * 10_000n) / reference,
  );
}

export const formatBps = (bps: number): string => `${(bps / 100).toFixed(2)}%`;

/** Remaining lock length in whole UTC days, never negative. */
export function lockDaysRemaining(unlockDate: string, now = Date.now()) {
  const end = Date.parse(unlockDate);
  return Number.isFinite(end)
    ? Math.max(0, Math.ceil((end - now) / DAY_MS))
    : 0;
}

export function formatLockRemaining(days: number): string {
  if (days <= 0) return 'Unlocked';
  let years = Math.floor(days / 365);
  const rest = days - years * 365;
  if (years) {
    // Whole years with rounded months: 727 days reads as 2y, not 1y 12m.
    let months = Math.round(rest / 30.4375);
    if (months === 12) {
      years += 1;
      months = 0;
    }
    return months ? `${years}y ${months}m` : `${years}y`;
  }
  const months = Math.floor(days / 30);
  if (months >= 12) return '1y';
  const remainder = days - months * 30;
  if (months) return remainder ? `${months}m ${remainder}d` : `${months}m`;
  return `${remainder}d`;
}

export function filterAssets(
  assets: readonly Asset[],
  query: string,
  category: string,
  sort: SortOrder,
  options: { hideSmall?: boolean; smallBelow?: number } = {},
): Asset[] {
  const search = query.trim().toLocaleLowerCase();
  const matching = assets.filter(
    (asset) =>
      (category === 'All' || asset.category === category) &&
      !(
        options.hideSmall && asset.underlyingBalance < (options.smallBelow ?? 0)
      ) &&
      `${asset.name} ${asset.collection} ${asset.positionId}`
        .toLocaleLowerCase()
        .includes(search),
  );
  if (sort === 'price-asc') return matching.sort((a, b) => a.price - b.price);
  if (sort === 'price-desc') return matching.sort((a, b) => b.price - a.price);
  if (sort === 'discount-desc')
    return matching.sort((a, b) => discountBps(b) - discountBps(a));
  if (sort === 'balance-desc')
    return matching.sort((a, b) => b.underlyingBalance - a.underlyingBalance);
  if (sort === 'unlock-asc')
    return matching.sort(
      (a, b) => Date.parse(a.unlockDate) - Date.parse(b.unlockDate),
    );
  return matching;
}

type ReceiptBase = { id: string; assetId: string; createdAt: string };
export type PurchaseDestination = 'wallet' | 'collateral' | 'relayer';
export type PurchaseReceipt = ReceiptBase & {
  kind: 'purchase';
  price: number;
  sellerFee: number;
  destination?: PurchaseDestination;
};
export type Receipt = PurchaseReceipt;
export type Portfolio = { version: 3; receipts: PurchaseReceipt[] };
export const emptyPortfolio = (): Portfolio => ({ version: 3, receipts: [] });
export const STORAGE_KEY = 'riftwell.marketplace-preview.v3';
export const LEGACY_STORAGE_KEY = 'riftwell.positions-preview.v2';

function validReceipt(value: unknown): value is PurchaseReceipt {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  if (
    entry.kind !== 'purchase' ||
    typeof entry.id !== 'string' ||
    entry.id.length > 100 ||
    typeof entry.assetId !== 'string' ||
    typeof entry.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(entry.createdAt))
  )
    return false;
  const finite = (key: string) =>
    typeof entry[key] === 'number' &&
    Number.isFinite(entry[key]) &&
    (entry[key] as number) >= 0 &&
    (entry[key] as number) <= 1_000_000 &&
    parseUSDCMicros(String(entry[key])) !== null;
  return (
    finite('price') &&
    finite('sellerFee') &&
    entry.sellerFee === marketplaceFee(entry.price as number) &&
    (entry.destination === undefined ||
      entry.destination === 'wallet' ||
      entry.destination === 'collateral' ||
      entry.destination === 'relayer')
  );
}

/** Migrate purchases only. Prior unfunded lending intents never become pooled balances. */
export function parsePortfolio(
  raw: string | null,
  knownAssetIds: readonly string[],
): Portfolio {
  if (!raw) return emptyPortfolio();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return emptyPortfolio();
    const value = parsed as Record<string, unknown>;
    if (
      ![2, 3].includes(value.version as number) ||
      !Array.isArray(value.receipts)
    )
      return emptyPortfolio();
    const seen = new Set<string>();
    const receipts = value.receipts
      .slice(0, 1000)
      .filter(validReceipt)
      .filter((entry) => {
        if (!knownAssetIds.includes(entry.assetId) || seen.has(entry.assetId))
          return false;
        seen.add(entry.assetId);
        return true;
      });
    return { version: 3, receipts };
  } catch {
    return emptyPortfolio();
  }
}

export function formatAmount(value: number): string {
  return `${new Intl.NumberFormat('en-GB', { maximumFractionDigits: 6 }).format(value)} USDC`;
}

export function formatBalance(value: number, symbol: string): string {
  return `${new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 }).format(value)} ${symbol}`;
}

export function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(value));
}

/** Format exact micro-USDC without a floating-point conversion. */
export function microsToDecimal(value: string | bigint): string {
  const raw = BigInt(value);
  const fraction = (raw % USDC_SCALE)
    .toString()
    .padStart(6, '0')
    .replace(/0+$/, '');
  return `${raw / USDC_SCALE}${fraction ? `.${fraction}` : ''}`;
}

export function formatMicros(value: string | bigint): string {
  const raw = BigInt(value);
  const fraction = (raw % USDC_SCALE)
    .toString()
    .padStart(6, '0')
    .replace(/0+$/, '');
  return `${new Intl.NumberFormat('en-GB').format(raw / USDC_SCALE)}${fraction ? `.${fraction}` : ''} USDC`;
}
