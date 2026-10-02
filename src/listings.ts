import { parseUSDCMicros } from './domain';

/** A seller's off-chain intent saved in this browser. Nothing is escrowed. */
export type PreviewListing = {
  id: string;
  assetId: string;
  priceMicros: string;
  createdAt: string;
  expiresAt: string;
  status: 'active' | 'cancelled';
};
export type ListingBook = { version: 1; listings: PreviewListing[] };

export const LISTINGS_STORAGE_KEY = 'riftwell.preview-listings.v1';
export const LISTING_EXPIRY_DAYS = [1, 7, 30] as const;
export const MIN_LISTING_MICROS = 1_000_000n;
export const MAX_LISTING_MICROS = 1_000_000_000_000n;
const MAX_LISTINGS = 200;
const DAY_MS = 86_400_000;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export class ListingError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ListingError';
    this.code = code;
  }
}

export const emptyListingBook = (): ListingBook => ({
  version: 1,
  listings: [],
});

function isoDate(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    ISO.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function validListing(value: unknown): value is PreviewListing {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.id === 'string' &&
    entry.id.length > 0 &&
    entry.id.length <= 100 &&
    typeof entry.assetId === 'string' &&
    entry.assetId.length > 0 &&
    entry.assetId.length <= 100 &&
    typeof entry.priceMicros === 'string' &&
    /^[1-9][0-9]{0,15}$/.test(entry.priceMicros) &&
    BigInt(entry.priceMicros) >= MIN_LISTING_MICROS &&
    BigInt(entry.priceMicros) <= MAX_LISTING_MICROS &&
    isoDate(entry.createdAt) &&
    isoDate(entry.expiresAt) &&
    Date.parse(entry.expiresAt) > Date.parse(entry.createdAt) &&
    (entry.status === 'active' || entry.status === 'cancelled')
  );
}

/** Keep valid listings for known positions; at most one active listing per position. */
export function parseListingBook(
  raw: string | null,
  knownAssetIds: readonly string[],
): ListingBook {
  if (!raw || raw.length > 200_000) return emptyListingBook();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return emptyListingBook();
    const value = parsed as Record<string, unknown>;
    if (value.version !== 1 || !Array.isArray(value.listings))
      return emptyListingBook();
    const active = new Set<string>();
    const ids = new Set<string>();
    const listings = value.listings
      .slice(-MAX_LISTINGS)
      .filter(validListing)
      .filter((entry) => {
        if (!knownAssetIds.includes(entry.assetId) || ids.has(entry.id))
          return false;
        ids.add(entry.id);
        if (entry.status !== 'active') return true;
        if (active.has(entry.assetId)) return false;
        active.add(entry.assetId);
        return true;
      });
    return { version: 1, listings };
  } catch {
    return emptyListingBook();
  }
}

export const isLive = (listing: PreviewListing, now = Date.now()) =>
  listing.status === 'active' && Date.parse(listing.expiresAt) > now;

export function liveListings(book: ListingBook, now = Date.now()) {
  return book.listings.filter((listing) => isLive(listing, now));
}

export type ListingDraft = {
  assetId: string;
  price: string;
  expiryDays: number;
};

/** Validate a draft into exact micros. Returns a message instead of throwing. */
export function listingPriceError(price: string): string | null {
  const micros = parseUSDCMicros(price);
  if (micros === null)
    return 'Use a plain decimal amount with up to six decimal places.';
  if (micros < MIN_LISTING_MICROS || micros > MAX_LISTING_MICROS)
    return 'Enter an ask from 1 to 1,000,000 USDC.';
  return null;
}

export function createListing(
  book: ListingBook,
  draft: ListingDraft,
  availableAssetIds: readonly string[],
  now = Date.now(),
): ListingBook {
  if (!availableAssetIds.includes(draft.assetId))
    throw new ListingError(
      'POSITION_UNAVAILABLE',
      'Choose a position from your wallet that is not deposited or listed.',
    );
  if (liveListings(book, now).some((item) => item.assetId === draft.assetId))
    throw new ListingError(
      'ALREADY_LISTED',
      'This position already has an active listing.',
    );
  const issue = listingPriceError(draft.price);
  if (issue) throw new ListingError('INVALID_PRICE', issue);
  if (!(LISTING_EXPIRY_DAYS as readonly number[]).includes(draft.expiryDays))
    throw new ListingError('INVALID_EXPIRY', 'Choose 1, 7 or 30 days.');
  const createdAt = new Date(now).toISOString();
  const listing: PreviewListing = {
    id: globalThis.crypto.randomUUID(),
    assetId: draft.assetId,
    priceMicros: parseUSDCMicros(draft.price)!.toString(),
    createdAt,
    expiresAt: new Date(now + draft.expiryDays * DAY_MS).toISOString(),
    status: 'active',
  };
  return {
    version: 1,
    listings: [...book.listings, listing].slice(-MAX_LISTINGS),
  };
}

export function cancelListing(book: ListingBook, id: string): ListingBook {
  const target = book.listings.find((item) => item.id === id);
  if (!target || target.status !== 'active')
    throw new ListingError('NOT_ACTIVE', 'This listing is no longer active.');
  return {
    version: 1,
    listings: book.listings.map((item) =>
      item.id === id ? { ...item, status: 'cancelled' } : item,
    ),
  };
}
