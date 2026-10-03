import { describe, expect, it } from 'vitest';
import {
  buyerError,
  cancelListing,
  createListing,
  emptyListingBook,
  isLive,
  isPrivate,
  liveListings,
  listingPriceError,
  parseListingBook,
} from './listings';

const now = Date.parse('2026-10-02T12:00:00Z');
const known = ['rift-041', 'rift-018'];

function fixtureAt<T>(items: readonly T[], index: number): T {
  const value = items[index];
  if (value === undefined) throw new Error(`Missing fixture element ${index}`);
  return value;
}

describe('preview seller listings', () => {
  it('creates an exact, expiring listing for an available position', () => {
    const book = createListing(
      emptyListingBook(),
      { assetId: 'rift-041', price: '4250.5', expiryDays: 7 },
      known,
      now,
    );
    const listing = fixtureAt(book.listings, 0);
    expect(listing).toMatchObject({
      assetId: 'rift-041',
      priceMicros: '4250500000',
      createdAt: '2026-10-02T12:00:00.000Z',
      expiresAt: '2026-10-09T12:00:00.000Z',
      status: 'active',
    });
    expect(isLive(listing, now)).toBe(true);
    expect(isLive(listing, Date.parse('2026-10-09T12:00:00Z'))).toBe(false);
  });

  it('rejects unavailable positions, duplicates, bad prices and expiries', () => {
    const book = createListing(
      emptyListingBook(),
      { assetId: 'rift-041', price: '10', expiryDays: 1 },
      known,
      now,
    );
    expect(() =>
      createListing(
        book,
        { assetId: 'rift-041', price: '10', expiryDays: 1 },
        known,
        now,
      ),
    ).toThrowError(expect.objectContaining({ code: 'ALREADY_LISTED' }));
    expect(() =>
      createListing(
        book,
        { assetId: 'rift-999', price: '10', expiryDays: 1 },
        known,
        now,
      ),
    ).toThrowError(expect.objectContaining({ code: 'POSITION_UNAVAILABLE' }));
    for (const price of ['0.99', '1000000.000001', '1e3', '', 'abc'])
      expect(listingPriceError(price)).not.toBeNull();
    expect(listingPriceError('1')).toBeNull();
    expect(listingPriceError('1000000')).toBeNull();
    expect(() =>
      createListing(
        emptyListingBook(),
        { assetId: 'rift-018', price: '10', expiryDays: 3 },
        known,
        now,
      ),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_EXPIRY' }));
  });

  it('cancels once and keeps history', () => {
    const book = createListing(
      emptyListingBook(),
      { assetId: 'rift-018', price: '6800', expiryDays: 30 },
      known,
      now,
    );
    const cancelled = cancelListing(book, fixtureAt(book.listings, 0).id);
    expect(fixtureAt(cancelled.listings, 0).status).toBe('cancelled');
    expect(liveListings(cancelled, now)).toHaveLength(0);
    expect(() =>
      cancelListing(cancelled, fixtureAt(book.listings, 0).id),
    ).toThrowError(expect.objectContaining({ code: 'NOT_ACTIVE' }));
  });

  it('recovers from corrupt storage and drops invalid or conflicting records', () => {
    const book = createListing(
      emptyListingBook(),
      { assetId: 'rift-041', price: '10', expiryDays: 1 },
      known,
      now,
    );
    const valid = fixtureAt(book.listings, 0);
    expect(parseListingBook('{broken', known)).toEqual(emptyListingBook());
    expect(parseListingBook(JSON.stringify({ version: 2 }), known)).toEqual(
      emptyListingBook(),
    );
    const raw = JSON.stringify({
      version: 1,
      listings: [
        valid,
        { ...valid, id: 'dup-active' },
        { ...valid, id: 'unknown', assetId: 'rift-999' },
        { ...valid, id: 'cheap', priceMicros: '999999' },
        { ...valid, id: 'bad-date', createdAt: '2026-10-02' },
        { ...valid, id: 'backwards', expiresAt: valid.createdAt },
        { ...valid, id: 'old', status: 'cancelled' },
        { ...valid, id: 'odd', status: 'sold' },
      ],
    });
    expect(
      parseListingBook(raw, known).listings.map((item) => item.id),
    ).toEqual([valid.id, 'old']);
  });
});

describe('private (OTC) listings', () => {
  const buyer = '0xAbCdEf0123456789aBcDeF0123456789AbCdEf01';

  it('reserves a listing for one normalized buyer address', () => {
    const book = createListing(
      emptyListingBook(),
      { assetId: 'rift-041', price: '100', expiryDays: 7, buyer: ` ${buyer} ` },
      known,
      now,
    );
    expect(fixtureAt(book.listings, 0).buyer).toBe(buyer.toLowerCase());
    expect(isPrivate(fixtureAt(book.listings, 0))).toBe(true);
    const open = createListing(
      emptyListingBook(),
      { assetId: 'rift-018', price: '100', expiryDays: 7, buyer: '' },
      known,
      now,
    );
    expect(fixtureAt(open.listings, 0).buyer).toBeNull();
    expect(isPrivate(fixtureAt(open.listings, 0))).toBe(false);
  });

  it('rejects malformed buyer addresses', () => {
    for (const bad of [
      '0x123',
      'abcdef0123456789abcdef0123456789abcdef01',
      `${buyer}0`,
      '0xZZcdef0123456789abcdef0123456789abcdef01',
    ])
      expect(buyerError(bad)).not.toBeNull();
    expect(buyerError('')).toBeNull();
    expect(buyerError(buyer)).toBeNull();
    expect(() =>
      createListing(
        emptyListingBook(),
        { assetId: 'rift-041', price: '100', expiryDays: 7, buyer: '0x123' },
        known,
        now,
      ),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_BUYER' }));
  });

  it('reads listings saved before private listings existed as public', () => {
    const book = createListing(
      emptyListingBook(),
      { assetId: 'rift-041', price: '100', expiryDays: 7 },
      known,
      now,
    );
    const legacy = JSON.parse(JSON.stringify(book));
    delete legacy.listings[0].buyer;
    expect(parseListingBook(JSON.stringify(legacy), known)).toEqual(book);
    legacy.listings[0].buyer = 'not-an-address';
    expect(parseListingBook(JSON.stringify(legacy), known).listings).toEqual(
      [],
    );
  });
});
