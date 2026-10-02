import type { MarketId } from './markets';

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

export type SortOrder = 'curated' | 'price-asc' | 'price-desc';
export const PLATFORM_FEE_RATE = 0.005;
const USDC_SCALE = 1_000_000n;

/** Parse decimal USDC exactly. Scientific notation, signs and fractional micros are rejected. */
export function parseUSDCMicros(value: string): bigint | null {
  if (value.length > 32 || !/^\d+(?:\.\d{1,6})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
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
export function filterAssets(
  assets: readonly Asset[],
  query: string,
  category: string,
  sort: SortOrder,
): Asset[] {
  const search = query.trim().toLocaleLowerCase();
  const matching = assets.filter(
    (asset) =>
      (category === 'All' || asset.category === category) &&
      `${asset.name} ${asset.collection} ${asset.positionId}`
        .toLocaleLowerCase()
        .includes(search),
  );
  if (sort === 'price-asc') return matching.sort((a, b) => a.price - b.price);
  if (sort === 'price-desc') return matching.sort((a, b) => b.price - a.price);
  return matching;
}

type ReceiptBase = { id: string; assetId: string; createdAt: string };
export type PurchaseReceipt = ReceiptBase & {
  kind: 'purchase';
  price: number;
  sellerFee: number;
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
    entry.sellerFee === marketplaceFee(entry.price as number)
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
