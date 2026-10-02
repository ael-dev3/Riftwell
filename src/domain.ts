export type AssetCategory = 'Short lock' | 'Long lock' | 'Max lock';
export type Asset = {
  id: string;
  name: string;
  collection: string;
  category: AssetCategory;
  artwork: string;
  price: number;
  referenceValue: number;
  underlyingBalance: number;
  lockTerm: string;
  unlockDate: string;
  apr: number;
  positionId: string;
  description: string;
};

export type SortOrder = 'curated' | 'price-asc' | 'price-desc';
export const PLATFORM_FEE_RATE = 0.005;
export const MAX_APR = 40;
export const MIN_PRINCIPAL = 1;
export const LOAN_DURATIONS = [7, 14, 30] as const;
export type LoanDuration = (typeof LOAN_DURATIONS)[number];
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

function aprToBps(apr: string): bigint | null {
  if (!/^\d+(?:\.\d{1,2})?$/.test(apr)) return null;
  const [whole, fraction = ''] = apr.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}

export const marketplaceFee = (price: number): number =>
  roundAmount((amountToMicros(price) * 5n) / 1000n);
export const marketplaceProceeds = (price: number): number => {
  const principal = amountToMicros(price);
  return roundAmount(principal - (principal * 5n) / 1000n);
};
export const maxBorrowAmount = (asset: Asset): number =>
  roundAmount((amountToMicros(asset.referenceValue) * 2n) / 5n);

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

export function validateLoan(
  amount: string,
  duration: number,
  maximum: number,
): string | null {
  if (amount === '') return 'Enter an amount to continue.';
  const principal = parseUSDCMicros(amount);
  if (principal === null)
    return 'Use a plain decimal amount with up to six decimal places.';
  if (principal < amountToMicros(MIN_PRINCIPAL))
    return `Enter an amount of at least ${formatAmount(MIN_PRINCIPAL)}.`;
  if (principal > amountToMicros(maximum))
    return `The maximum for this sample position is ${formatAmount(maximum)}.`;
  if (!(LOAN_DURATIONS as readonly number[]).includes(duration))
    return 'Choose a supported loan duration.';
  return null;
}

export function validateApr(apr: string): string | null {
  const bps = aprToBps(apr);
  if (bps === null || bps < 100n || bps > BigInt(MAX_APR * 100))
    return `Enter an APR from 1% to ${MAX_APR}%, with up to two decimal places.`;
  return null;
}

export function calculateLoan(
  principal: number,
  apr: number,
  duration: number,
) {
  const principalMicros = amountToMicros(principal);
  const aprBps = aprToBps(String(apr));
  if (
    aprBps === null ||
    aprBps < 0n ||
    aprBps > BigInt(MAX_APR * 100) ||
    !(LOAN_DURATIONS as readonly number[]).includes(duration)
  )
    throw new RangeError('Unsupported sample rate or duration.');
  const feeMicros = (principalMicros * 5n) / 1000n;
  const interestMicros =
    (principalMicros * aprBps * BigInt(duration)) / (10_000n * 365n);
  return {
    principal,
    originationFee: roundAmount(feeMicros),
    interest: roundAmount(interestMicros),
    netProceeds: roundAmount(principalMicros - feeMicros),
    repayment: roundAmount(principalMicros + interestMicros),
  };
}

type ReceiptBase = { id: string; assetId: string; createdAt: string };
export type PurchaseReceipt = ReceiptBase & {
  kind: 'purchase';
  price: number;
  sellerFee: number;
};
export type BorrowReceipt = ReceiptBase & {
  kind: 'borrow';
  principal: number;
  apr: number;
  duration: LoanDuration;
  originationFee: number;
  interest: number;
  status: 'active' | 'cancelled';
};
export type LendReceipt = ReceiptBase & {
  kind: 'lend';
  principal: number;
  apr: number;
  duration: LoanDuration;
  interest: number;
  status: 'proposed' | 'cancelled';
};
export type Receipt = PurchaseReceipt | BorrowReceipt | LendReceipt;
export type Portfolio = { version: 2; receipts: Receipt[] };
export const emptyPortfolio = (): Portfolio => ({ version: 2, receipts: [] });
export const STORAGE_KEY = 'riftwell.positions-preview.v2';

function validReceipt(value: unknown): value is Receipt {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  if (
    typeof entry.id !== 'string' ||
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
  if (entry.kind === 'purchase') return finite('price') && finite('sellerFee');
  if (entry.kind !== 'borrow' && entry.kind !== 'lend') return false;
  if (
    !finite('principal') ||
    typeof entry.apr !== 'number' ||
    validateApr(String(entry.apr)) ||
    !finite('interest') ||
    !(LOAN_DURATIONS as readonly unknown[]).includes(entry.duration)
  )
    return false;
  return entry.kind === 'borrow'
    ? finite('originationFee') &&
        (entry.status === 'active' || entry.status === 'cancelled')
    : entry.status === 'proposed' || entry.status === 'cancelled';
}

export function parsePortfolio(
  raw: string | null,
  knownAssetIds: readonly string[],
): Portfolio {
  if (!raw) return emptyPortfolio();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return emptyPortfolio();
    const value = parsed as Record<string, unknown>;
    if (value.version !== 2 || !Array.isArray(value.receipts))
      return emptyPortfolio();
    const receipts = value.receipts
      .filter(validReceipt)
      .filter((entry) => knownAssetIds.includes(entry.assetId));
    // Keep purchases and current positions even when a long cancellation history is pruned.
    const current = receipts.filter(
      (entry) => entry.kind === 'purchase' || entry.status !== 'cancelled',
    );
    const cancelled = receipts
      .filter(
        (entry) => entry.kind !== 'purchase' && entry.status === 'cancelled',
      )
      .slice(-200);
    return {
      version: 2,
      receipts: [...current, ...cancelled].sort(
        (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt),
      ),
    };
  } catch {
    return emptyPortfolio();
  }
}

export function formatAmount(value: number): string {
  return `${new Intl.NumberFormat('en-GB', { maximumFractionDigits: 6 }).format(value)} USDC`;
}

export function formatBalance(value: number): string {
  return `${new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 }).format(value)} RIFT`;
}

export function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(value));
}
