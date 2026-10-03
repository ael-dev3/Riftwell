import assert from 'node:assert/strict';
import type * as axe from 'axe-core';

export type AuditReport = {
  view: string;
  violations: {
    id: string;
    impact: axe.ImpactValue | undefined;
    nodes: { target: axe.UnlabelledFrameSelector; failureSummary?: string }[];
  }[];
  passes?: number;
};
export type WalletRequest = {
  method: string;
  params?: readonly unknown[] | object;
};
export type WalletListener = (...args: unknown[]) => void;
export type FixtureWalletProvider = {
  request(request: WalletRequest): Promise<unknown>;
  on(event: string, listener: WalletListener): void;
  removeListener(event: string, listener: WalletListener): void;
};
declare global {
  interface Window {
    axe: typeof axe;
    ethereum: FixtureWalletProvider;
    fixtureWalletRequest(request: WalletRequest): Promise<unknown>;
    fixtureWalletDisconnect(): void;
  }
}
export type LendingActivityKind =
  | 'supply'
  | 'withdraw'
  | 'redeem'
  | 'deposit-collateral'
  | 'remove-collateral'
  | 'borrow'
  | 'repay'
  | 'epoch'
  | 'purchase'
  | 'relayer-deposit'
  | 'relayer-withdraw'
  | 'merge'
  | 'increase-lock';
export type LendingActivityFixture = {
  id: string;
  kind: LendingActivityKind;
  createdAt: string;
  amountMicros: string;
  sharesRaw: string;
  feeMicros: string;
  collateralId: string | null;
  rewardRepaidMicros: string;
  rewardSurplusMicros: string;
  poolYieldMicros: string;
};
export type LendingFixture = {
  version: 1;
  walletMicros: string;
  poolCashMicros: string;
  poolOutstandingMicros: string;
  totalSharesRaw: string;
  shareBalanceRaw: string;
  debtMicros: string;
  platformFeesMicros: string;
  collateralIds: string[];
  epoch: number;
  activity: LendingActivityFixture[];
};
export const lendingMoneyFields = [
  'walletMicros',
  'poolCashMicros',
  'poolOutstandingMicros',
  'totalSharesRaw',
  'shareBalanceRaw',
  'debtMicros',
  'platformFeesMicros',
] as const satisfies readonly (keyof LendingFixture)[];
export type LendingMoneyFields = Partial<
  Pick<LendingFixture, (typeof lendingMoneyFields)[number] | 'epoch'>
>;
export type MarketEventKind =
  'list' | 'edit' | 'cancel' | 'purchase' | 'sweep' | 'migrate';
export type PreviewListingFixture = {
  id: string;
  assetId: string;
  seller: string;
  kind: 'fixed' | 'dutch';
  startPriceMicros: string;
  endPriceMicros: string;
  startsAt: string;
  expiresAt: string;
  auctionEndsAt: string | null;
  recipient: string | null;
  revision: number;
  status: 'active' | 'cancelled' | 'sold';
};
export type MarketFixture = {
  version: 1;
  balanceMicros: string;
  platformFeesMicros: string;
  sellerProceedsMicros: Record<string, string>;
  ownerByAsset: Record<string, string>;
  listings: PreviewListingFixture[];
  history: {
    id: string;
    kind: MarketEventKind;
    createdAt: string;
    assetIds: string[];
    items: {
      listingId: string;
      assetId: string;
      seller: string;
      priceMicros: string;
      feeMicros: string;
      sellerProceedsMicros: string;
    }[];
  }[];
};
export type PositionFixture = {
  id: string;
  tokenId: string;
  marketId: 'kittenswap';
  owner: string;
  lockedAmountRaw: string;
  lockedUntil: string;
  votingPowerRaw: string;
  blockNumber: number;
  blockHash: string;
  observedAt: string;
};
export type ListingFixture = {
  id: string;
  marketId: 'kittenswap';
  tokenId: string;
  owner: string;
  kind: 'fixed' | 'dutch';
  startPriceMicros: string;
  endPriceMicros: string;
  priceMicros: string;
  startsAt: string;
  expiresAt: string;
  auctionEndsAt: string | null;
  recipient: string | null;
  revision: number;
  status: 'active' | 'cancelled' | 'expired' | 'invalidated';
  updatedAt: string;
  createdAt: string;
  position: PositionFixture;
};
export type ListingsFixture = {
  items: ListingFixture[];
  nextCursor: string | null;
};
export type JsonResponse = { json(): Promise<unknown> };

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
const raw = (value: unknown): value is string =>
  typeof value === 'string' && /^(0|[1-9]\d{0,77})$/.test(value);
const address = (value: unknown): value is string =>
  typeof value === 'string' && /^0x[0-9a-f]{40}$/i.test(value);
const date = (value: unknown): value is string =>
  typeof value === 'string' && Number.isFinite(Date.parse(value));
const strings = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.every((item: unknown) => typeof item === 'string');
function fields(
  value: Record<string, unknown>,
  keys: readonly string[],
  predicate: (field: unknown) => boolean,
): boolean {
  return keys.every((key) => predicate(value[key]));
}
function dictionary(
  value: unknown,
  predicate: (field: unknown) => boolean,
): boolean {
  return object(value) && Object.values(value).every(predicate);
}
function activity(value: unknown): boolean {
  return (
    object(value) &&
    typeof value.id === 'string' &&
    date(value.createdAt) &&
    [
      'supply',
      'withdraw',
      'redeem',
      'deposit-collateral',
      'remove-collateral',
      'borrow',
      'repay',
      'epoch',
      'purchase',
      'relayer-deposit',
      'relayer-withdraw',
      'merge',
      'increase-lock',
    ].includes(String(value.kind)) &&
    fields(
      value,
      [
        'amountMicros',
        'sharesRaw',
        'feeMicros',
        'rewardRepaidMicros',
        'rewardSurplusMicros',
        'poolYieldMicros',
      ],
      raw,
    ) &&
    (value.collateralId === null || typeof value.collateralId === 'string')
  );
}
export function decodeLendingFixture(value: unknown): LendingFixture {
  assert.ok(
    object(value) &&
      value.version === 1 &&
      fields(value, lendingMoneyFields, raw) &&
      strings(value.collateralIds) &&
      Number.isInteger(value.epoch) &&
      Array.isArray(value.activity) &&
      value.activity.every(activity),
    'Stored lending fixture must have a valid typed shape',
  );
  return value as LendingFixture;
}
function previewListing(value: unknown): boolean {
  return (
    object(value) &&
    fields(value, ['id', 'assetId'], (field) => typeof field === 'string') &&
    address(value.seller) &&
    ['fixed', 'dutch'].includes(String(value.kind)) &&
    fields(value, ['startPriceMicros', 'endPriceMicros'], raw) &&
    fields(value, ['startsAt', 'expiresAt'], date) &&
    (value.auctionEndsAt === null || date(value.auctionEndsAt)) &&
    (value.recipient === null || address(value.recipient)) &&
    Number.isInteger(value.revision) &&
    ['active', 'cancelled', 'sold'].includes(String(value.status))
  );
}
function marketEvent(value: unknown): boolean {
  return (
    object(value) &&
    typeof value.id === 'string' &&
    date(value.createdAt) &&
    ['list', 'edit', 'cancel', 'purchase', 'sweep', 'migrate'].includes(
      String(value.kind),
    ) &&
    strings(value.assetIds) &&
    Array.isArray(value.items) &&
    value.items.every(
      (item: unknown) =>
        object(item) &&
        fields(
          item,
          ['listingId', 'assetId'],
          (field) => typeof field === 'string',
        ) &&
        address(item.seller) &&
        fields(item, ['priceMicros', 'feeMicros', 'sellerProceedsMicros'], raw),
    )
  );
}
export function decodeMarketFixture(value: unknown): MarketFixture {
  assert.ok(
    object(value) &&
      value.version === 1 &&
      fields(value, ['balanceMicros', 'platformFeesMicros'], raw) &&
      dictionary(value.sellerProceedsMicros, raw) &&
      dictionary(value.ownerByAsset, address) &&
      Array.isArray(value.listings) &&
      value.listings.every(previewListing) &&
      Array.isArray(value.history) &&
      value.history.every(marketEvent),
    'Stored marketplace fixture must have a valid typed shape',
  );
  return value as MarketFixture;
}
function position(value: unknown): boolean {
  return (
    object(value) &&
    value.marketId === 'kittenswap' &&
    fields(value, ['id', 'tokenId'], (field) => typeof field === 'string') &&
    address(value.owner) &&
    fields(value, ['lockedAmountRaw', 'votingPowerRaw'], raw) &&
    fields(value, ['lockedUntil', 'observedAt'], date) &&
    typeof value.blockNumber === 'number' &&
    Number.isSafeInteger(value.blockNumber) &&
    typeof value.blockHash === 'string' &&
    /^0x[0-9a-f]{64}$/i.test(value.blockHash)
  );
}
function listing(value: unknown): value is ListingFixture {
  return (
    object(value) &&
    value.marketId === 'kittenswap' &&
    fields(value, ['id', 'tokenId'], (field) => typeof field === 'string') &&
    address(value.owner) &&
    ['fixed', 'dutch'].includes(String(value.kind)) &&
    fields(value, ['startPriceMicros', 'endPriceMicros', 'priceMicros'], raw) &&
    fields(value, ['startsAt', 'expiresAt', 'createdAt', 'updatedAt'], date) &&
    (value.auctionEndsAt === null || date(value.auctionEndsAt)) &&
    (value.recipient === null || address(value.recipient)) &&
    typeof value.revision === 'number' &&
    Number.isInteger(value.revision) &&
    ['active', 'cancelled', 'expired', 'invalidated'].includes(
      String(value.status),
    ) &&
    position(value.position)
  );
}
export async function readListing(
  response: JsonResponse,
): Promise<ListingFixture> {
  const value = await response.json();
  assert.ok(
    listing(value),
    'Listing response must contain typed current terms',
  );
  return value;
}
export async function readListings(
  response: JsonResponse,
): Promise<ListingsFixture> {
  const value = await response.json();
  assert.ok(
    object(value) &&
      Array.isArray(value.items) &&
      value.items.every(listing) &&
      (value.nextCursor === null || typeof value.nextCursor === 'string'),
    'Listings response must be a typed page',
  );
  return value as ListingsFixture;
}
export async function readCapabilities(
  response: JsonResponse,
): Promise<{ lending: boolean; settlement: boolean }> {
  const value = await response.json();
  assert.ok(
    object(value) &&
      object(value.capabilities) &&
      typeof value.capabilities.lending === 'boolean' &&
      typeof value.capabilities.settlement === 'boolean',
    'Status must contain typed capabilities',
  );
  return {
    lending: value.capabilities.lending,
    settlement: value.capabilities.settlement,
  };
}
export async function readError(
  response: JsonResponse,
): Promise<{ error: { code: string; message: string } }> {
  const value = await response.json();
  assert.ok(
    object(value) &&
      object(value.error) &&
      typeof value.error.code === 'string' &&
      typeof value.error.message === 'string',
    'Error response must contain typed details',
  );
  return { error: { code: value.error.code, message: value.error.message } };
}
export function expectedRevision(requestBody: string | null): number {
  assert.ok(requestBody !== null, 'Revision mutation must have a JSON body');
  const value: unknown = JSON.parse(requestBody);
  assert.ok(
    object(value) &&
      typeof value.expectedRevision === 'number' &&
      Number.isInteger(value.expectedRevision),
    'Mutation must include an integer expectedRevision',
  );
  return value.expectedRevision;
}
