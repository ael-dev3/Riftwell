import { parseUSDCMicros, type Asset, type PurchaseReceipt } from './domain';

export const MARKETPLACE_STORAGE_KEY = 'riftwell.marketplace-ledger.v1';
export const PREVIEW_ADDRESS = '0x00000000000000000000000000000000000a11ce';
const SAMPLE_SELLERS = [
  '0x000000000000000000000000000000000000b001',
  '0x000000000000000000000000000000000000b002',
];
const MAX_MONEY = 1_000_000_000_000n;
const MAX_RECORDS = 250;
const DAY = 86_400_000;
export type ListingKind = 'fixed' | 'dutch';
export type PreviewListing = {
  id: string;
  assetId: string;
  seller: string;
  kind: ListingKind;
  startPriceMicros: string;
  endPriceMicros: string;
  startsAt: string;
  expiresAt: string;
  auctionEndsAt: string | null;
  recipient: string | null;
  revision: number;
  status: 'active' | 'cancelled' | 'sold';
};
export type ListingTerms = {
  kind: ListingKind;
  startPriceMicros: string;
  endPriceMicros: string;
  expiresAt: string;
  auctionEndsAt: string | null;
  recipient: string | null;
};
export type PurchaseQuote = {
  id: string;
  revision: number;
  maxPriceMicros: string;
};
export type SaleItem = {
  listingId: string;
  assetId: string;
  seller: string;
  priceMicros: string;
  feeMicros: string;
  sellerProceedsMicros: string;
};
export type MarketplaceEvent = {
  id: string;
  kind: 'list' | 'edit' | 'cancel' | 'purchase' | 'sweep' | 'migrate';
  createdAt: string;
  assetIds: string[];
  items: SaleItem[];
};
export type MarketplaceState = {
  version: 1;
  balanceMicros: string;
  platformFeesMicros: string;
  sellerProceedsMicros: Record<string, string>;
  ownerByAsset: Record<string, string>;
  listings: PreviewListing[];
  history: MarketplaceEvent[];
};
export class MarketplaceError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'MarketplaceError';
  }
}
function fail(code: string, message: string): never {
  throw new MarketplaceError(code, message);
}
const address = (value: unknown): value is string =>
  typeof value === 'string' && /^0x[0-9a-f]{40}$/i.test(value);
const raw = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^(0|[1-9]\d{0,12})$/.test(value) &&
  BigInt(value) <= MAX_MONEY;
const timestamp = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value;
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const iso = (now: number) => new Date(now).toISOString();
const sameAddress = (left: string | undefined, right: string) =>
  left?.toLowerCase() === right.toLowerCase();
function assetById(assets: readonly Asset[], id: string): Asset {
  const asset = assets.find((entry) => entry.id === id);
  if (!asset)
    fail('UNKNOWN_ASSET', 'This position is not available in the preview.');
  return asset;
}
function validListing(
  value: unknown,
  knownIds: readonly string[],
): value is PreviewListing {
  return (
    record(value) &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    value.id.length <= 100 &&
    typeof value.assetId === 'string' &&
    knownIds.includes(value.assetId) &&
    address(value.seller) &&
    (value.kind === 'fixed' || value.kind === 'dutch') &&
    raw(value.startPriceMicros) &&
    BigInt(value.startPriceMicros) > 0n &&
    raw(value.endPriceMicros) &&
    BigInt(value.endPriceMicros) > 0n &&
    BigInt(value.endPriceMicros) <= BigInt(value.startPriceMicros) &&
    (value.kind !== 'fixed' ||
      value.startPriceMicros === value.endPriceMicros) &&
    timestamp(value.startsAt) &&
    timestamp(value.expiresAt) &&
    (value.kind === 'fixed'
      ? value.auctionEndsAt === null
      : timestamp(value.auctionEndsAt) &&
        Date.parse(value.auctionEndsAt) >
          Date.parse(value.startsAt as string) &&
        Date.parse(value.auctionEndsAt) <=
          Date.parse(value.expiresAt as string)) &&
    Date.parse(value.expiresAt) > Date.parse(value.startsAt) &&
    Date.parse(value.expiresAt) - Date.parse(value.startsAt) <= 30 * DAY &&
    (value.recipient === null ||
      (address(value.recipient) &&
        !/^0x0{40}$/i.test(value.recipient) &&
        !sameAddress(value.recipient, value.seller))) &&
    typeof value.revision === 'number' &&
    Number.isSafeInteger(value.revision) &&
    value.revision > 0 &&
    (value.revision <= 10000 ||
      (value.revision === 10001 && value.status !== 'active')) &&
    ['active', 'cancelled', 'sold'].includes(String(value.status))
  );
}
function validSale(value: unknown, ids: readonly string[]): value is SaleItem {
  return (
    record(value) &&
    typeof value.listingId === 'string' &&
    value.listingId.length <= 100 &&
    typeof value.assetId === 'string' &&
    ids.includes(value.assetId) &&
    address(value.seller) &&
    raw(value.priceMicros) &&
    BigInt(value.priceMicros) > 0n &&
    raw(value.feeMicros) &&
    raw(value.sellerProceedsMicros) &&
    BigInt(value.feeMicros) === (BigInt(value.priceMicros) * 5n) / 1000n &&
    BigInt(value.sellerProceedsMicros) + BigInt(value.feeMicros) ===
      BigInt(value.priceMicros)
  );
}
function validState(
  value: unknown,
  assets: readonly Asset[],
  now: number,
): value is MarketplaceState {
  const ids = assets.map((asset) => asset.id);
  if (
    !record(value) ||
    value.version !== 1 ||
    !raw(value.balanceMicros) ||
    !raw(value.platformFeesMicros) ||
    !record(value.ownerByAsset) ||
    Object.keys(value.ownerByAsset).length !== ids.length ||
    !ids.every(
      (id) =>
        Object.hasOwn(value.ownerByAsset as object, id) &&
        address((value.ownerByAsset as Record<string, unknown>)[id]),
    ) ||
    !record(value.sellerProceedsMicros) ||
    Object.keys(value.sellerProceedsMicros).length > 30 ||
    !Object.entries(value.sellerProceedsMicros).every(
      ([seller, amount]) => address(seller) && raw(amount),
    ) ||
    !Array.isArray(value.listings) ||
    value.listings.length > MAX_RECORDS ||
    !value.listings.every((item) => validListing(item, ids)) ||
    new Set(value.listings.map((item: PreviewListing) => item.id)).size !==
      value.listings.length ||
    !Array.isArray(value.history) ||
    value.history.length > MAX_RECORDS
  )
    return false;
  if (
    !value.history.every(
      (entry) =>
        record(entry) &&
        typeof entry.id === 'string' &&
        entry.id.length > 0 &&
        entry.id.length <= 100 &&
        ['list', 'edit', 'cancel', 'purchase', 'sweep', 'migrate'].includes(
          String(entry.kind),
        ) &&
        timestamp(entry.createdAt) &&
        Array.isArray(entry.assetIds) &&
        entry.assetIds.length <= 10 &&
        entry.assetIds.every(
          (id) => typeof id === 'string' && ids.includes(id),
        ) &&
        Array.isArray(entry.items) &&
        entry.items.length <= 10 &&
        entry.items.every((item) => validSale(item, ids)),
    )
  )
    return false;
  const cashTotal =
    BigInt(value.balanceMicros) +
    BigInt(value.platformFeesMicros) +
    Object.values(value.sellerProceedsMicros as Record<string, string>).reduce(
      (sum, amount) => sum + BigInt(String(amount)),
      0n,
    );
  if (cashTotal !== 25_000_000_000n) return false;
  const active = value.listings.filter((entry: PreviewListing) =>
    isListingActive(entry, now),
  );
  return (
    new Set(active.map((entry: PreviewListing) => entry.assetId)).size ===
      active.length &&
    active.every((entry: PreviewListing) =>
      sameAddress(
        (value.ownerByAsset as Record<string, string>)[entry.assetId],
        entry.seller,
      ),
    )
  );
}
function checked(
  state: MarketplaceState,
  assets: readonly Asset[],
  now: number,
) {
  if (!validState(state, assets, now))
    fail(
      'INVALID_STATE',
      'This saved marketplace preview is invalid. Reset the preview to continue.',
    );
}
function append(
  state: MarketplaceState,
  changes: Partial<MarketplaceState>,
  kind: MarketplaceEvent['kind'],
  ids: string[],
  items: SaleItem[],
  now: number,
): MarketplaceState {
  return {
    ...state,
    ...changes,
    history: [
      ...state.history,
      {
        id: crypto.randomUUID(),
        kind,
        createdAt: iso(now),
        assetIds: ids,
        items,
      },
    ].slice(-MAX_RECORDS),
  };
}
export function isListingActive(
  listing: PreviewListing,
  now = Date.now(),
): boolean {
  return (
    listing.status === 'active' &&
    Date.parse(listing.startsAt) <= now &&
    Date.parse(listing.expiresAt) > now
  );
}
export function listingStatus(
  listing: PreviewListing,
  now = Date.now(),
): 'active' | 'expired' | 'cancelled' | 'sold' {
  return listing.status === 'active' && Date.parse(listing.expiresAt) <= now
    ? 'expired'
    : listing.status;
}
export function currentAskMicros(
  listing: PreviewListing,
  now = Date.now(),
): string {
  const start = BigInt(listing.startPriceMicros);
  const end = BigInt(listing.endPriceMicros);
  if (listing.kind === 'fixed') return start.toString();
  const begin = Date.parse(listing.startsAt);
  const finish = Date.parse(listing.auctionEndsAt ?? listing.expiresAt);
  const remaining = BigInt(
    Math.min(Math.max(Math.trunc(finish - now), 0), finish - begin),
  );
  const duration = BigInt(finish - begin);
  const scale = 1_000_000_000_000_000_000n;
  const fraction = (remaining * scale) / duration;
  const squared = (fraction * fraction) / scale;
  const cubed = (squared * fraction) / scale;
  return (end + ((start - end) * cubed) / scale).toString();
}
export function createMarketplaceState(
  assets: readonly Asset[],
  ownedAssetIds: readonly string[],
  now = Date.now(),
): MarketplaceState {
  const ownerByAsset = Object.fromEntries(
    assets.map((asset, index) => [
      asset.id,
      ownedAssetIds.includes(asset.id)
        ? PREVIEW_ADDRESS
        : (SAMPLE_SELLERS[index % SAMPLE_SELLERS.length] ?? SAMPLE_SELLERS[0]!),
    ]),
  );
  const listings = assets
    .filter((asset) => !ownedAssetIds.includes(asset.id))
    .map((asset, index): PreviewListing => {
      const price = parseUSDCMicros(String(asset.price));
      if (price === null || price <= 0n || price > MAX_MONEY)
        fail('INVALID_SEED', 'Invalid preview price.');
      const kind = index % 3 === 2 ? 'dutch' : 'fixed';
      return {
        id: `sample-${asset.id}`,
        assetId: asset.id,
        seller:
          ownerByAsset[asset.id] ??
          fail('INVALID_SEED', 'Missing preview owner.'),
        kind,
        startPriceMicros: price.toString(),
        endPriceMicros: (kind === 'dutch'
          ? (price * 3n) / 4n
          : price
        ).toString(),
        startsAt: iso(now),
        expiresAt: iso(now + 7 * DAY),
        auctionEndsAt: kind === 'dutch' ? iso(now + 3 * DAY) : null,
        recipient: null,
        revision: 1,
        status: 'active',
      };
    });
  return {
    version: 1,
    balanceMicros: '25000000000',
    platformFeesMicros: '0',
    sellerProceedsMicros: {},
    ownerByAsset,
    listings,
    history: [],
  };
}
export function parseMarketplaceState(
  rawState: string | null,
  assets: readonly Asset[],
  ownedIds: readonly string[],
  now = Date.now(),
): MarketplaceState {
  try {
    if (!rawState || rawState.length > 400000)
      return createMarketplaceState(assets, ownedIds, now);
    const state: unknown = JSON.parse(rawState);
    return validState(state, assets, now)
      ? state
      : createMarketplaceState(assets, ownedIds, now);
  } catch {
    return createMarketplaceState(assets, ownedIds, now);
  }
}
function validateTerms(terms: ListingTerms, now: number, seller: string) {
  if (
    !raw(terms.startPriceMicros) ||
    !raw(terms.endPriceMicros) ||
    BigInt(terms.startPriceMicros) <= 0n ||
    BigInt(terms.endPriceMicros) <= 0n ||
    BigInt(terms.endPriceMicros) > BigInt(terms.startPriceMicros) ||
    !['fixed', 'dutch'].includes(terms.kind) ||
    (terms.kind === 'fixed' && terms.startPriceMicros !== terms.endPriceMicros)
  )
    fail(
      'INVALID_PRICE',
      'Use a positive price up to 1,000,000 USDC. A Dutch ending price cannot exceed its starting price.',
    );
  if (
    !timestamp(terms.expiresAt) ||
    Date.parse(terms.expiresAt) <= now ||
    Date.parse(terms.expiresAt) > now + 30 * DAY
  )
    fail('INVALID_EXPIRY', 'Choose an expiry in the next 30 days.');
  if (
    terms.kind === 'fixed'
      ? terms.auctionEndsAt !== null
      : !timestamp(terms.auctionEndsAt) ||
        Date.parse(terms.auctionEndsAt) <= now ||
        Date.parse(terms.auctionEndsAt) > Date.parse(terms.expiresAt)
  )
    fail(
      'INVALID_AUCTION',
      'Choose a Dutch price duration that ends before the listing expires.',
    );
  if (
    terms.recipient !== null &&
    (!address(terms.recipient) ||
      /^0x0{40}$/i.test(terms.recipient) ||
      sameAddress(terms.recipient, seller))
  )
    fail('INVALID_RECIPIENT', 'Use a different valid recipient address.');
}
export function listAsset(
  state: MarketplaceState,
  assetId: string,
  terms: ListingTerms,
  assets: readonly Asset[],
  now = Date.now(),
): MarketplaceState {
  checked(state, assets, now);
  assetById(assets, assetId);
  validateTerms(terms, now, PREVIEW_ADDRESS);
  if (!sameAddress(state.ownerByAsset[assetId], PREVIEW_ADDRESS))
    fail('NOT_OWNER', 'Only your preview positions can be listed.');
  if (
    state.listings.some(
      (entry) => entry.assetId === assetId && isListingActive(entry, now),
    )
  )
    fail('ALREADY_LISTED', 'This position already has an active listing.');
  const listing: PreviewListing = {
    id: crypto.randomUUID(),
    assetId,
    seller: PREVIEW_ADDRESS,
    ...terms,
    startsAt: iso(now),
    revision: 1,
    status: 'active',
  };
  const retained = state.listings.filter(
    (entry) => entry.status === 'active' && Date.parse(entry.expiresAt) > now,
  );
  const previous = state.listings
    .filter(
      (entry) =>
        !(entry.status === 'active' && Date.parse(entry.expiresAt) > now),
    )
    .slice(-(MAX_RECORDS - retained.length - 1));
  return append(
    state,
    { listings: [...previous, ...retained, listing] },
    'list',
    [assetId],
    [],
    now,
  );
}
function editable(
  state: MarketplaceState,
  id: string,
  revision: number,
  now: number,
) {
  const listing = state.listings.find((entry) => entry.id === id);
  if (!listing || !isListingActive(listing, now))
    fail('LISTING_UNAVAILABLE', 'This listing is no longer active.');
  if (!sameAddress(listing.seller, PREVIEW_ADDRESS))
    fail('NOT_SELLER', 'Only your own listings can be changed.');
  if (listing.revision !== revision)
    fail(
      'STALE_LISTING',
      'The listing changed. Close this review and open it again.',
    );
  return listing;
}
export function editListing(
  state: MarketplaceState,
  id: string,
  revision: number,
  terms: ListingTerms,
  assets: readonly Asset[],
  now = Date.now(),
): MarketplaceState {
  checked(state, assets, now);
  editable(state, id, revision, now);
  validateTerms(terms, now, PREVIEW_ADDRESS);
  if (revision >= 10000)
    fail(
      'REVISION_LIMIT',
      'Cancel and relist this preview position to make another change.',
    );
  return append(
    state,
    {
      listings: state.listings.map((entry) =>
        entry.id === id
          ? {
              ...entry,
              ...terms,
              startsAt: iso(now),
              revision: entry.revision + 1,
            }
          : entry,
      ),
    },
    'edit',
    [state.listings.find((entry) => entry.id === id)!.assetId],
    [],
    now,
  );
}
export function cancelListing(
  state: MarketplaceState,
  id: string,
  revision: number,
  assets: readonly Asset[],
  now = Date.now(),
): MarketplaceState {
  checked(state, assets, now);
  const listing = editable(state, id, revision, now);
  return append(
    state,
    {
      listings: state.listings.map((entry) =>
        entry.id === id
          ? { ...entry, status: 'cancelled', revision: entry.revision + 1 }
          : entry,
      ),
    },
    'cancel',
    [listing.assetId],
    [],
    now,
  );
}
export function buyListings(
  state: MarketplaceState,
  quotes: readonly PurchaseQuote[],
  assets: readonly Asset[],
  now = Date.now(),
): MarketplaceState {
  checked(state, assets, now);
  if (
    quotes.length < 1 ||
    quotes.length > 10 ||
    new Set(quotes.map((quote) => quote.id)).size !== quotes.length
  )
    fail('INVALID_SELECTION', 'Select up to ten different listings.');
  const items: SaleItem[] = quotes.map((quote) => {
    const listing = state.listings.find((entry) => entry.id === quote.id);
    if (!listing || !isListingActive(listing, now))
      fail(
        'LISTING_UNAVAILABLE',
        'A selected listing is no longer active. No preview purchase was saved.',
      );
    if (sameAddress(listing.seller, PREVIEW_ADDRESS))
      fail('SELF_PURCHASE', 'You cannot buy your own listing.');
    if (
      listing.recipient !== null &&
      !sameAddress(listing.recipient, PREVIEW_ADDRESS)
    )
      fail(
        'PRIVATE_LISTING',
        'This listing is reserved for another recipient.',
      );
    if (listing.revision !== quote.revision || !raw(quote.maxPriceMicros))
      fail(
        'STALE_LISTING',
        'A selected listing changed. Review the selection again.',
      );
    if (!sameAddress(state.ownerByAsset[listing.assetId], listing.seller))
      fail(
        'OWNERSHIP_CHANGED',
        'The seller no longer owns a selected position.',
      );
    const price = BigInt(currentAskMicros(listing, now));
    if (price > BigInt(quote.maxPriceMicros))
      fail('PRICE_CHANGED', 'The ask increased. Review the selection again.');
    const fee = (price * 5n) / 1000n;
    return {
      listingId: listing.id,
      assetId: listing.assetId,
      seller: listing.seller,
      priceMicros: price.toString(),
      feeMicros: fee.toString(),
      sellerProceedsMicros: (price - fee).toString(),
    };
  });
  const total = items.reduce((sum, item) => sum + BigInt(item.priceMicros), 0n);
  if (total > BigInt(state.balanceMicros))
    fail(
      'INSUFFICIENT_BALANCE',
      'Your marketplace demo balance is too low for this selection.',
    );
  const sellerProceedsMicros = { ...state.sellerProceedsMicros };
  for (const item of items) {
    const amount =
      BigInt(sellerProceedsMicros[item.seller] ?? '0') +
      BigInt(item.sellerProceedsMicros);
    if (amount > MAX_MONEY)
      fail('BALANCE_LIMIT', 'The preview seller balance limit was reached.');
    sellerProceedsMicros[item.seller] = amount.toString();
  }
  const fees =
    BigInt(state.platformFeesMicros) +
    items.reduce((sum, item) => sum + BigInt(item.feeMicros), 0n);
  if (fees > MAX_MONEY)
    fail('BALANCE_LIMIT', 'The preview balance limit was reached.');
  return append(
    state,
    {
      balanceMicros: (BigInt(state.balanceMicros) - total).toString(),
      platformFeesMicros: fees.toString(),
      sellerProceedsMicros,
      ownerByAsset: {
        ...state.ownerByAsset,
        ...Object.fromEntries(
          items.map((item) => [item.assetId, PREVIEW_ADDRESS]),
        ),
      },
      listings: state.listings.map((entry) =>
        items.some((item) => item.listingId === entry.id)
          ? { ...entry, status: 'sold', revision: entry.revision + 1 }
          : entry,
      ),
    },
    items.length === 1 ? 'purchase' : 'sweep',
    items.map((item) => item.assetId),
    items,
    now,
  );
}
/** Retain old local purchase ownership without charging the new independent demo balance again. */
export function migrateMarketplacePurchases(
  state: MarketplaceState,
  receipts: readonly PurchaseReceipt[],
  assets: readonly Asset[],
  now = Date.now(),
): MarketplaceState {
  checked(state, assets, now);
  const ids = [...new Set(receipts.map((receipt) => receipt.assetId))].filter(
    (id) =>
      assets.some((asset) => asset.id === id) &&
      !sameAddress(state.ownerByAsset[id], PREVIEW_ADDRESS),
  );
  if (!ids.length) return state;
  return append(
    state,
    {
      ownerByAsset: {
        ...state.ownerByAsset,
        ...Object.fromEntries(ids.map((id) => [id, PREVIEW_ADDRESS])),
      },
      listings: state.listings.map((entry) =>
        ids.includes(entry.assetId) && entry.status === 'active'
          ? { ...entry, status: 'sold' }
          : entry,
      ),
    },
    'migrate',
    ids,
    [],
    now,
  );
}
export function unitPriceMicros(priceMicros: string, asset: Asset): string {
  const balance = BigInt(asset.underlyingBalance);
  return balance > 0n ? (BigInt(priceMicros) / balance).toString() : '0';
}
/** Compare ratios before display rounding, so tiny positive asks retain their order. */
export function compareUnitPrice(
  leftPrice: string,
  left: Asset,
  rightPrice: string,
  right: Asset,
): number {
  const a = BigInt(leftPrice) * BigInt(right.underlyingBalance);
  const b = BigInt(rightPrice) * BigInt(left.underlyingBalance);
  return a === b ? 0 : a < b ? -1 : 1;
}
/** Approximate twelve decimal places without presenting a positive unit price as zero. */
export function displayUnitPrice(priceMicros: string, asset: Asset): string {
  const amount = BigInt(priceMicros);
  const balance = BigInt(asset.underlyingBalance);
  if (balance <= 0n) return '—';
  const scale = 1_000_000_000_000n;
  const value = (amount * 1_000_000n) / balance;
  if (amount > 0n && value === 0n) return '<0.000000000001';
  const fraction = (value % scale)
    .toString()
    .padStart(12, '0')
    .replace(/0+$/, '');
  return `${new Intl.NumberFormat('en-GB').format(value / scale)}${fraction ? `.${fraction}` : ''}`;
}
export function discountBps(priceMicros: string, asset: Asset): number | null {
  const reference = parseUSDCMicros(String(asset.referenceValue));
  if (!reference || reference <= 0n) return null;
  return Number(((reference - BigInt(priceMicros)) * 10000n) / reference);
}
