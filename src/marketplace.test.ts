import { describe, expect, it } from 'vitest';
import { ALL_MARKET_ASSETS, ASSETS, OWNED_MARKET_ASSETS } from './data';
import {
  buyListings,
  cancelListing,
  createMarketplaceState,
  currentAskMicros,
  compareUnitPrice,
  displayUnitPrice,
  editListing,
  isListingActive,
  listAsset,
  migrateMarketplacePurchases,
  parseMarketplaceState,
  PREVIEW_ADDRESS,
  type ListingTerms,
  type MarketplaceState,
  type PreviewListing,
  type PurchaseQuote,
} from './marketplace';

function fixtureAt<T>(items: readonly T[], index: number): T {
  const value = items[index];
  if (value === undefined) throw new Error(`Missing fixture element ${index}`);
  return value;
}

const NOW = Date.parse('2026-10-02T12:00:00.000Z');
const DAY = 86_400_000;
const ownedIds = OWNED_MARKET_ASSETS.map((asset) => asset.id);
const seed = () => createMarketplaceState(ALL_MARKET_ASSETS, ownedIds, NOW);
const fixed = (price = '1000000000'): ListingTerms => ({
  kind: 'fixed',
  startPriceMicros: price,
  endPriceMicros: price,
  expiresAt: new Date(NOW + 7 * DAY).toISOString(),
  auctionEndsAt: null,
  recipient: null,
});
const quote = (listing: PreviewListing, now = NOW): PurchaseQuote => ({
  id: listing.id,
  revision: listing.revision,
  maxPriceMicros: currentAskMicros(listing, now),
});
const lastListing = (state: MarketplaceState) => state.listings.at(-1)!;
const cash = (state: MarketplaceState) =>
  BigInt(state.balanceMicros) +
  BigInt(state.platformFeesMicros) +
  Object.values(state.sellerProceedsMicros).reduce(
    (sum, value) => sum + BigInt(value),
    0n,
  );

describe('marketplace listings and ownership', () => {
  it('seeds other sellers separately from three owned positions', () => {
    const state = seed();
    expect(state.listings).toHaveLength(6);
    expect(
      state.listings.every((listing) => listing.seller !== PREVIEW_ADDRESS),
    ).toBe(true);
    expect(
      ownedIds.every((id) => state.ownerByAsset[id] === PREVIEW_ADDRESS),
    ).toBe(true);
    expect(state.balanceMicros).toBe('25000000000');
    expect(
      parseMarketplaceState(
        JSON.stringify(state),
        ALL_MARKET_ASSETS,
        ownedIds,
        NOW,
      ),
    ).toEqual(state);
  });
  it('lists only unlisted owned positions, then reviews revisions before editing or cancellation', () => {
    let state = seed();
    expect(() =>
      listAsset(state, ASSETS[0].id, fixed(), ALL_MARKET_ASSETS, NOW),
    ).toThrowError(expect.objectContaining({ code: 'NOT_OWNER' }));
    state = listAsset(
      state,
      fixtureAt(ownedIds, 0),
      fixed(),
      ALL_MARKET_ASSETS,
      NOW,
    );
    const listing = lastListing(state);
    expect(() =>
      listAsset(state, fixtureAt(ownedIds, 0), fixed(), ALL_MARKET_ASSETS, NOW),
    ).toThrowError(expect.objectContaining({ code: 'ALREADY_LISTED' }));
    state = editListing(
      state,
      listing.id,
      1,
      fixed('1500000000'),
      ALL_MARKET_ASSETS,
      NOW,
    );
    expect(lastListing(state).revision).toBe(2);
    expect(() =>
      cancelListing(state, listing.id, 1, ALL_MARKET_ASSETS, NOW),
    ).toThrowError(expect.objectContaining({ code: 'STALE_LISTING' }));
    state = cancelListing(state, listing.id, 2, ALL_MARKET_ASSETS, NOW);
    expect(lastListing(state).status).toBe('cancelled');
    state = listAsset(
      state,
      fixtureAt(ownedIds, 0),
      fixed(),
      ALL_MARKET_ASSETS,
      NOW,
    );
    expect(lastListing(state).id).not.toBe(listing.id);
    expect(cash(state)).toBe(25_000_000_000n);
  });
  it('allows an expired position to be relisted and rejects invalid prices, expiry and recipient fields', () => {
    const state = listAsset(
      seed(),
      fixtureAt(ownedIds, 0),
      fixed(),
      ALL_MARKET_ASSETS,
      NOW,
    );
    expect(() =>
      listAsset(
        state,
        fixtureAt(ownedIds, 0),
        { ...fixed(), expiresAt: new Date(NOW + 15 * DAY).toISOString() },
        ALL_MARKET_ASSETS,
        NOW + 8 * DAY,
      ),
    ).not.toThrow();
    for (const price of ['0', '-1', '1e6', '01', '1000000000001'])
      expect(() =>
        listAsset(
          seed(),
          fixtureAt(ownedIds, 0),
          fixed(price),
          ALL_MARKET_ASSETS,
          NOW,
        ),
      ).toThrow();
    for (const expiresAt of [
      new Date(NOW).toISOString(),
      new Date(NOW + 31 * DAY).toISOString(),
      'invalid',
    ])
      expect(() =>
        listAsset(
          seed(),
          fixtureAt(ownedIds, 0),
          { ...fixed(), expiresAt },
          ALL_MARKET_ASSETS,
          NOW,
        ),
      ).toThrow();
    for (const recipient of [
      PREVIEW_ADDRESS,
      '0x0',
      '0x0000000000000000000000000000000000000000',
    ])
      expect(() =>
        listAsset(
          seed(),
          fixtureAt(ownedIds, 0),
          { ...fixed(), recipient },
          ALL_MARKET_ASSETS,
          NOW,
        ),
      ).toThrow();
  });
});

describe('Dutch price curve', () => {
  const listing: PreviewListing = {
    id: 'dutch',
    assetId: ASSETS[0].id,
    seller: '0x000000000000000000000000000000000000b001',
    kind: 'dutch',
    startPriceMicros: '10000000000',
    endPriceMicros: '2000000000',
    startsAt: new Date(NOW).toISOString(),
    auctionEndsAt: new Date(NOW + DAY).toISOString(),
    expiresAt: new Date(NOW + 7 * DAY).toISOString(),
    recipient: null,
    revision: 1,
    status: 'active',
  };
  it('decays premium cubically and holds the floor before separate expiry', () => {
    expect(currentAskMicros(listing, NOW - 1)).toBe('10000000000');
    expect(currentAskMicros(listing, NOW)).toBe('10000000000');
    expect(currentAskMicros(listing, NOW + DAY / 2)).toBe('3000000000');
    expect(currentAskMicros(listing, NOW + DAY)).toBe('2000000000');
    expect(currentAskMicros(listing, NOW + 3 * DAY)).toBe('2000000000');
    expect(isListingActive(listing, NOW + 3 * DAY)).toBe(true);
    expect(isListingActive(listing, NOW + 7 * DAY)).toBe(false);
  });
  it('uses fixed-point floors at fractional elapsed times without passing below the floor', () => {
    const fractional = {
      ...listing,
      startPriceMicros: '1000002',
      endPriceMicros: '1000000',
      auctionEndsAt: new Date(NOW + 3).toISOString(),
    };
    expect(currentAskMicros(fractional, NOW + 1)).toBe('1000000');
    expect(currentAskMicros(fractional, NOW + 2)).toBe('1000000');
  });
  it('requires the decay period to finish before listing expiry', () => {
    expect(() =>
      listAsset(
        seed(),
        fixtureAt(ownedIds, 0),
        {
          ...fixed(),
          kind: 'dutch',
          endPriceMicros: '500000000',
          auctionEndsAt: new Date(NOW + 8 * DAY).toISOString(),
        },
        ALL_MARKET_ASSETS,
        NOW,
      ),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_AUCTION' }));
  });
});

describe('atomic preview purchases', () => {
  it('floors the seller fee and transfers exact proceeds without charging the buyer extra', () => {
    const initial = seed();
    const first = fixtureAt(initial.listings, 0);
    const listing = {
      ...first,
      startPriceMicros: '1000199',
      endPriceMicros: '1000199',
    };
    const before = {
      ...initial,
      listings: [listing, ...initial.listings.slice(1)],
    };
    const next = buyListings(before, [quote(listing)], ALL_MARKET_ASSETS, NOW);
    expect(next.balanceMicros).toBe('24998999801');
    expect(next.platformFeesMicros).toBe('5000');
    expect(next.sellerProceedsMicros[listing.seller]).toBe('995199');
    expect(next.ownerByAsset[listing.assetId]).toBe(PREVIEW_ADDRESS);
    expect(next.history.at(-1)?.items[0]?.priceMicros).toBe('1000199');
    expect(cash(next)).toBe(cash(before));
    expect(before.ownerByAsset[listing.assetId]).toBe(listing.seller);
    expect(() =>
      buyListings(next, [quote(listing)], ALL_MARKET_ASSETS, NOW),
    ).toThrowError(expect.objectContaining({ code: 'LISTING_UNAVAILABLE' }));
  });
  it('fails a whole sweep when one quote is stale, expired or unavailable', () => {
    const initial = seed();
    const choices = initial.listings
      .slice(0, 2)
      .map((listing) => quote(listing));
    expect(() =>
      buyListings(
        initial,
        [{ ...fixtureAt(choices, 0), revision: 999 }, fixtureAt(choices, 1)],
        ALL_MARKET_ASSETS,
        NOW,
      ),
    ).toThrowError(expect.objectContaining({ code: 'STALE_LISTING' }));
    expect(() =>
      buyListings(initial, choices, ALL_MARKET_ASSETS, NOW + 7 * DAY),
    ).toThrowError(expect.objectContaining({ code: 'LISTING_UNAVAILABLE' }));
    expect(() =>
      buyListings(
        initial,
        [fixtureAt(choices, 0), { ...fixtureAt(choices, 1), id: 'missing' }],
        ALL_MARKET_ASSETS,
        NOW,
      ),
    ).toThrow();
    expect(initial.balanceMicros).toBe('25000000000');
    expect(initial.history).toEqual([]);
  });
  it('rejects self-purchases, duplicate selections, changed asks and insufficient balance', () => {
    const initial = seed();
    const mine = listAsset(
      initial,
      fixtureAt(ownedIds, 0),
      fixed(),
      ALL_MARKET_ASSETS,
      NOW,
    );
    expect(() =>
      buyListings(mine, [quote(lastListing(mine))], ALL_MARKET_ASSETS, NOW),
    ).toThrowError(expect.objectContaining({ code: 'SELF_PURCHASE' }));
    const first = quote(fixtureAt(initial.listings, 0));
    expect(() =>
      buyListings(initial, [first, first], ALL_MARKET_ASSETS, NOW),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_SELECTION' }));
    expect(() =>
      buyListings(
        initial,
        [{ ...first, maxPriceMicros: '1' }],
        ALL_MARKET_ASSETS,
        NOW,
      ),
    ).toThrowError(expect.objectContaining({ code: 'PRICE_CHANGED' }));
    expect(() =>
      buyListings(
        initial,
        initial.listings.map((listing) => quote(listing)),
        ALL_MARKET_ASSETS,
        NOW,
      ),
    ).toThrowError(expect.objectContaining({ code: 'INSUFFICIENT_BALANCE' }));
  });
  it('executes multiple purchases together and uses lower current Dutch asks within consent ceilings', () => {
    const initial = seed();
    const choices = [
      fixtureAt(initial.listings, 0),
      fixtureAt(initial.listings, 2),
    ];
    const max = choices.map((listing) => quote(listing));
    const next = buyListings(initial, max, ALL_MARKET_ASSETS, NOW + 3 * DAY);
    expect(next.history.at(-1)?.kind).toBe('sweep');
    expect(next.history.at(-1)?.items.map((item) => item.priceMicros)).toEqual([
      '4200000000',
      '2325000000',
    ]);
    expect(next.balanceMicros).toBe('18475000000');
    expect(cash(next)).toBe(25_000_000_000n);
  });
  it('enforces the reserved buyer while keeping it a preview-only address restriction', () => {
    const initial = seed();
    const listing = {
      ...fixtureAt(initial.listings, 0),
      recipient: '0x000000000000000000000000000000000000b099',
    };
    const state = {
      ...initial,
      listings: [listing, ...initial.listings.slice(1)],
    };
    expect(() =>
      buyListings(state, [quote(listing)], ALL_MARKET_ASSETS, NOW),
    ).toThrowError(expect.objectContaining({ code: 'PRIVATE_LISTING' }));
    const mine = { ...listing, recipient: PREVIEW_ADDRESS };
    const allowed = {
      ...initial,
      listings: [mine, ...initial.listings.slice(1)],
    };
    expect(
      buyListings(allowed, [quote(mine)], ALL_MARKET_ASSETS, NOW).ownerByAsset[
        mine.assetId
      ],
    ).toBe(PREVIEW_ADDRESS);
  });
});

describe('marketplace persistence and migration', () => {
  it('restores valid state and rejects malformed, overfunded or inconsistent state', () => {
    const state = buyListings(
      seed(),
      [quote(fixtureAt(seed().listings, 0))],
      ALL_MARKET_ASSETS,
      NOW,
    );
    expect(
      parseMarketplaceState(
        JSON.stringify(state),
        ALL_MARKET_ASSETS,
        ownedIds,
        NOW,
      ),
    ).toEqual(state);
    for (const input of [
      'invalid',
      JSON.stringify({ ...state, balanceMicros: '1e6' }),
      JSON.stringify({ ...state, balanceMicros: '1000000000000' }),
      JSON.stringify({ ...state, ownerByAsset: {} }),
      JSON.stringify({
        ...state,
        listings: [...state.listings, fixtureAt(state.listings, 0)],
      }),
    ]) {
      expect(
        parseMarketplaceState(input, ALL_MARKET_ASSETS, ownedIds, NOW),
      ).toEqual(seed());
    }
  });
  it('migrates prior purchases once without debiting the new independent demo balance', () => {
    const prior = [
      {
        id: 'old',
        assetId: ASSETS[0].id,
        createdAt: new Date(NOW).toISOString(),
        kind: 'purchase' as const,
        price: 4200,
        sellerFee: 21,
      },
    ];
    const migrated = migrateMarketplacePurchases(
      seed(),
      prior,
      ALL_MARKET_ASSETS,
      NOW,
    );
    expect(migrated.ownerByAsset[ASSETS[0].id]).toBe(PREVIEW_ADDRESS);
    expect(fixtureAt(migrated.listings, 0).status).toBe('sold');
    expect(migrated.balanceMicros).toBe('25000000000');
    expect(migrated.history.at(-1)?.kind).toBe('migrate');
    expect(
      migrateMarketplacePurchases(migrated, prior, ALL_MARKET_ASSETS, NOW),
    ).toBe(migrated);
  });
});

describe('unit price precision', () => {
  it('orders ratios exactly even when both would round to zero at six decimals', () => {
    expect(compareUnitPrice('1', ASSETS[0], '1', ASSETS[5])).toBe(1);
    expect(compareUnitPrice('2', ASSETS[0], '4', ASSETS[5])).toBe(0);
  });
  it('shows tiny positive unit prices with twelve decimals or an explicit lower bound', () => {
    expect(displayUnitPrice('1', ASSETS[5])).toBe('0.00000000001');
    expect(displayUnitPrice('4200000000', ASSETS[0])).toBe('0.084');
    expect(
      displayUnitPrice('1', { ...ASSETS[5], underlyingBalance: 2000000 }),
    ).toBe('<0.000000000001');
  });
});
