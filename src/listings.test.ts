import { describe, expect, it } from 'vitest';
import {
  cancelListing,
  createListing,
  emptyListingBook,
  isLive,
  liveListings,
  listingPriceError,
  parseListingBook,
} from './listings';

const now = Date.parse('2026-10-02T12:00:00Z');
const known = ['rift-041', 'rift-018'];

describe('preview seller listings', () => {
  it('creates an exact, expiring listing for an available position', () => {
    const book = createListing(
      emptyListingBook(),
      { assetId: 'rift-041', price: '4250.5', expiryDays: 7 },
      known,
      now,
    );
    const [listing] = book.listings;
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
    const cancelled = cancelListing(book, book.listings[0].id);
    expect(cancelled.listings[0].status).toBe('cancelled');
    expect(liveListings(cancelled, now)).toHaveLength(0);
    expect(() => cancelListing(cancelled, book.listings[0].id)).toThrowError(
      expect.objectContaining({ code: 'NOT_ACTIVE' }),
    );
  });

  it('recovers from corrupt storage and drops invalid or conflicting records', () => {
    const book = createListing(
      emptyListingBook(),
      { assetId: 'rift-041', price: '10', expiryDays: 1 },
      known,
      now,
    );
    const [valid] = book.listings;
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
