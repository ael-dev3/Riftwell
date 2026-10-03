import { describe, expect, it } from 'vitest';
import {
  ALL_MARKET_ASSETS,
  ASSETS,
  OWNED_MARKET_ASSETS,
  STARTING_POSITION_IDS,
} from '../data';
import { marketplaceFee, type PurchaseReceipt } from '../domain';
import { createLendingState } from '../lending';
import { emptyListingBook } from '../listings';
import {
  buyListings,
  createMarketplaceState,
  currentAskMicros,
} from '../marketplace';
import { deriveHoldings, parsePreviewPortfolio } from './store';

const NOW = Date.parse('2026-10-03T00:00:00.000Z');
const receipts: PurchaseReceipt[] = ASSETS.slice(0, 6).map((asset) => ({
  id: `old-${asset.id}`,
  kind: 'purchase',
  assetId: asset.id,
  price: asset.price,
  sellerFee: marketplaceFee(asset.price),
  createdAt: '2026-10-02T12:00:00.000Z',
}));

describe('preview purchase migration', () => {
  it.each([2, 3])(
    'retains every original sample receipt saved in version %s',
    (version) => {
      const portfolio = parsePreviewPortfolio(
        JSON.stringify({ version, receipts }),
      );
      expect(portfolio.receipts).toEqual(receipts);
      expect(portfolio.version).toBe(3);
      for (const id of STARTING_POSITION_IDS)
        expect(
          portfolio.receipts.some((receipt) => receipt.assetId === id),
        ).toBe(true);
    },
  );

  it('does not duplicate holdings or their rewards after retaining historic receipts', () => {
    const portfolio = parsePreviewPortfolio(
      JSON.stringify({ version: 3, receipts }),
    );
    const holdings = deriveHoldings(
      portfolio,
      createLendingState(),
      emptyListingBook(),
      NOW,
    );
    expect(holdings.owned.map((asset) => asset.id).sort()).toEqual(
      receipts.map((receipt) => receipt.assetId).sort(),
    );
    expect(holdings.wallet).toHaveLength(6);
    expect(new Set(holdings.owned.map((asset) => asset.id)).size).toBe(6);
    expect(
      holdings.market.some((asset) =>
        receipts.some((receipt) => receipt.assetId === asset.id),
      ),
    ).toBe(false);
  });

  it('carries paid purchases from the previous marketplace ledger without charging again', () => {
    const before = createMarketplaceState(
      ALL_MARKET_ASSETS,
      OWNED_MARKET_ASSETS.map((asset) => asset.id),
      NOW,
    );
    const listing = before.listings.find(
      (entry) => entry.assetId === 'rift-009',
    );
    if (!listing) throw new Error('Missing original listing');
    const bought = buyListings(
      before,
      [
        {
          id: listing.id,
          revision: listing.revision,
          maxPriceMicros: currentAskMicros(listing, NOW),
        },
      ],
      ALL_MARKET_ASSETS,
      NOW,
    );
    const saved = JSON.stringify(bought);
    const portfolio = parsePreviewPortfolio(null, saved);
    expect(portfolio.receipts).toHaveLength(1);
    expect(portfolio.receipts[0]).toMatchObject({
      assetId: 'rift-009',
      price: 3100,
      sellerFee: 15.5,
      createdAt: new Date(NOW).toISOString(),
    });
    const state = createLendingState();
    const holdings = deriveHoldings(portfolio, state, emptyListingBook(), NOW);
    expect(holdings.wallet.some((asset) => asset.id === 'rift-009')).toBe(true);
    expect(state.walletMicros).toBe('25000000000');
    expect(state.platformFeesMicros).toBe('0');
    expect(parsePreviewPortfolio(JSON.stringify(portfolio), saved)).toEqual(
      portfolio,
    );
  });
});
