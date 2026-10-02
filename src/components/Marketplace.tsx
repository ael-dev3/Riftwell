import { Check, Plus, Search, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { ALL_MARKET_ASSETS, CATEGORIES } from '../data';
import { formatBalance, formatDate, formatMicros, type Asset } from '../domain';
import {
  currentAskMicros,
  discountBps,
  isListingActive,
  listingStatus,
  PREVIEW_ADDRESS,
  compareUnitPrice,
  displayUnitPrice,
  type MarketplaceState,
  type PreviewListing,
  type PurchaseQuote,
} from '../marketplace';
import type { Market } from '../markets';

export type MarketplaceTab = 'all' | 'mine' | 'history';
export type MarketplaceAction =
  | { kind: 'list'; asset?: Asset }
  | { kind: 'edit'; listing: PreviewListing }
  | { kind: 'cancel'; listing: PreviewListing }
  | { kind: 'details'; listing: PreviewListing }
  | { kind: 'buy' | 'sweep'; quotes: PurchaseQuote[] };
type Props = {
  market: Market;
  state: MarketplaceState;
  onAction: (action: MarketplaceAction) => void;
};
type Order = 'position' | 'price-asc' | 'price-desc' | 'unit-asc';
const own = (seller: string) =>
  seller.toLowerCase() === PREVIEW_ADDRESS.toLowerCase();
const eventLabel: Readonly<Record<string, string>> = {
  list: 'Listed',
  edit: 'Edited',
  cancel: 'Cancelled',
  purchase: 'Bought',
  sweep: 'Sweep bought',
  migrate: 'Purchase migrated',
};

export default function Marketplace({ market, state, onAction }: Props) {
  const [tab, setTab] = useState<MarketplaceTab>('all');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  const [order, setOrder] = useState<Order>('position');
  const [selected, setSelected] = useState<string[]>([]);
  const [clock, setNow] = useState(Date.now());
  const now = Math.max(clock, Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    setSelected((previous) => {
      const next = previous.filter((id) =>
        state.listings.some(
          (listing) =>
            listing.id === id &&
            isListingActive(listing, now) &&
            !own(listing.seller),
        ),
      );
      return next.length === previous.length ? previous : next;
    });
  }, [state.listings, now]);
  const rows = useMemo(
    () =>
      state.listings
        .filter((listing) => {
          const asset = ALL_MARKET_ASSETS.find(
            (item) => item.id === listing.assetId,
          );
          return (
            asset &&
            asset.marketId === market.id &&
            (tab === 'mine'
              ? own(listing.seller)
              : isListingActive(listing, now)) &&
            (category === 'All' || asset.category === category) &&
            `${asset.positionId} ${asset.name}`
              .toLowerCase()
              .includes(query.trim().toLowerCase())
          );
        })
        .sort((left, right) => {
          const leftAsset = ALL_MARKET_ASSETS.find(
            (asset) => asset.id === left.assetId,
          )!;
          const rightAsset = ALL_MARKET_ASSETS.find(
            (asset) => asset.id === right.assetId,
          )!;
          if (order === 'position')
            return Number(leftAsset.positionId) - Number(rightAsset.positionId);
          if (order === 'unit-asc')
            return compareUnitPrice(
              currentAskMicros(left, now),
              leftAsset,
              currentAskMicros(right, now),
              rightAsset,
            );
          const a = BigInt(currentAskMicros(left, now));
          const b = BigInt(currentAskMicros(right, now));
          return a === b
            ? 0
            : (a < b ? -1 : 1) * (order === 'price-desc' ? -1 : 1);
        }),
    [state.listings, tab, category, query, order, market.id, now],
  );
  const purchasable = rows.filter(
    (listing) =>
      !own(listing.seller) &&
      isListingActive(listing, now) &&
      (listing.recipient === null || own(listing.recipient)),
  );
  const selectedListings = state.listings.filter(
    (listing) => selected.includes(listing.id) && isListingActive(listing, now),
  );
  const selectedTotal = selectedListings.reduce(
    (sum, listing) => sum + BigInt(currentAskMicros(listing, now)),
    0n,
  );
  const allSelected =
    purchasable.length > 0 &&
    purchasable.every((listing) => selected.includes(listing.id));
  function quotes(listings: readonly PreviewListing[]): PurchaseQuote[] {
    return listings.map((listing) => ({
      id: listing.id,
      revision: listing.revision,
      maxPriceMicros: currentAskMicros(listing, Date.now()),
    }));
  }
  function clearFilters() {
    setQuery('');
    setCategory('All');
    setOrder('position');
  }

  return (
    <>
      <div className="section-heading market-table-heading">
        <div>
          <p className="section-eyebrow">{market.name} · PREVIEW</p>
          <h1 className="section-title">{market.positionSymbol} marketplace</h1>
        </div>
        <button
          className="button primary"
          onClick={() => onAction({ kind: 'list' })}
        >
          <Plus size={16} aria-hidden="true" /> List yours
        </button>
      </div>
      <div className="market-table-nav">
        <div className="segmented-control" aria-label="Marketplace view">
          {(['all', 'mine', 'history'] as const).map((value) => (
            <button
              key={value}
              aria-pressed={tab === value}
              className={tab === value ? 'active' : ''}
              onClick={() => {
                setTab(value);
                setSelected([]);
              }}
            >
              {value === 'all'
                ? 'All listings'
                : value === 'mine'
                  ? 'My listings'
                  : 'History'}
            </button>
          ))}
        </div>
        <span className="market-balance">
          Marketplace demo balance{' '}
          <strong>{formatMicros(state.balanceMicros)}</strong>
        </span>
      </div>
      {tab !== 'history' && (
        <div className="market-toolbar">
          <div className="search-field">
            <Search size={16} aria-hidden="true" />
            <label className="sr-only" htmlFor="asset-search">
              Search positions
            </label>
            <input
              id="asset-search"
              type="search"
              placeholder="Token ID"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {query && (
              <button
                className="button icon-button ghost"
                aria-label="Clear search"
                onClick={() => setQuery('')}
              >
                <X size={16} aria-hidden="true" />
              </button>
            )}
          </div>
          <div className="filter-field">
            <label className="sr-only" htmlFor="category-filter">
              Lock category
            </label>
            <select
              id="category-filter"
              className="filter-control"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              {CATEGORIES.map((value) => (
                <option key={value} value={value}>
                  {value === 'All' ? 'All locks' : value}
                </option>
              ))}
            </select>
          </div>
          <div className="filter-field">
            <label className="sr-only" htmlFor="sort-order">
              Sort listings
            </label>
            <select
              id="sort-order"
              className="filter-control"
              value={order}
              onChange={(event) => setOrder(event.target.value as Order)}
            >
              <option value="position">Token ID</option>
              <option value="price-asc">Ask: low to high</option>
              <option value="price-desc">Ask: high to low</option>
              <option value="unit-asc">Unit price: low to high</option>
            </select>
          </div>
          <span className="results-count" role="status">
            {rows.length} {rows.length === 1 ? 'listing' : 'listings'}
          </span>
        </div>
      )}
      {tab === 'history' ? (
        <div
          className="market-table-wrap"
          role="region"
          aria-label="Marketplace history"
          tabIndex={0}
        >
          <table className="market-table market-history-table">
            <caption className="sr-only">
              Your local marketplace history
            </caption>
            <thead>
              <tr>
                <th scope="col">Action</th>
                <th scope="col">Position</th>
                <th scope="col">Total</th>
                <th scope="col">Date</th>
              </tr>
            </thead>
            <tbody>
              {state.history
                .slice()
                .reverse()
                .map((event) => (
                  <tr key={event.id}>
                    <td>{eventLabel[event.kind]}</td>
                    <td>
                      {event.assetIds
                        .map(
                          (id) =>
                            `#${ALL_MARKET_ASSETS.find((asset) => asset.id === id)?.positionId ?? '?'}`,
                        )
                        .join(', ')}
                    </td>
                    <td>
                      {event.items.length
                        ? formatMicros(
                            event.items.reduce(
                              (sum, item) => sum + BigInt(item.priceMicros),
                              0n,
                            ),
                          )
                        : '—'}
                    </td>
                    <td>{formatDate(event.createdAt)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
          {!state.history.length && (
            <div className="empty-state">
              <h3>No marketplace activity.</h3>
            </div>
          )}
        </div>
      ) : rows.length ? (
        <div
          className="market-table-wrap"
          role="region"
          aria-label={
            tab === 'all' ? 'Marketplace listings' : 'Your active listings'
          }
          tabIndex={0}
        >
          <table className="market-table">
            <caption className="sr-only">
              {tab === 'all'
                ? 'Illustrative veKITTEN listings from sample sellers'
                : 'Your marketplace preview listings'}
            </caption>
            <thead>
              <tr>
                {tab === 'all' && (
                  <th scope="col" className="market-select-cell">
                    <input
                      type="checkbox"
                      aria-label="Select all available listings"
                      checked={allSelected}
                      disabled={!purchasable.length}
                      onChange={(event) =>
                        setSelected(
                          event.target.checked
                            ? purchasable
                                .slice(0, 10)
                                .map((listing) => listing.id)
                            : [],
                        )
                      }
                    />
                  </th>
                )}
                <th scope="col">Token ID</th>
                <th scope="col">Locked KITTEN</th>
                <th scope="col">Unlocks</th>
                <th scope="col">Ask · USDC</th>
                <th scope="col">USDC / KITTEN</th>
                <th scope="col">vs demo reference</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((listing) => {
                const asset = ALL_MARKET_ASSETS.find(
                  (item) => item.id === listing.assetId,
                )!;
                const ask = currentAskMicros(listing, now);
                const discount = discountBps(ask, asset);
                const active = isListingActive(listing, now);
                const mine = own(listing.seller);
                const canBuy =
                  active &&
                  !mine &&
                  (listing.recipient === null || own(listing.recipient));
                return (
                  <tr key={listing.id}>
                    {tab === 'all' && (
                      <td className="market-select-cell">
                        <input
                          type="checkbox"
                          aria-label={`Select veKITTEN #${asset.positionId}`}
                          checked={selected.includes(listing.id)}
                          disabled={
                            !canBuy ||
                            (!selected.includes(listing.id) &&
                              selected.length >= 10)
                          }
                          onChange={(event) =>
                            setSelected((previous) =>
                              event.target.checked
                                ? [...previous, listing.id]
                                : previous.filter((id) => id !== listing.id),
                            )
                          }
                        />
                      </td>
                    )}
                    <td>
                      <button
                        className="market-token-link"
                        onClick={() => onAction({ kind: 'details', listing })}
                      >
                        #{asset.positionId}
                      </button>
                      <span className="market-row-secondary">
                        {listing.kind === 'dutch' ? 'Dutch' : 'Fixed'}
                        {mine ? ' · Yours' : ''}
                        {listing.recipient ? ' · Reserved' : ''}
                      </span>
                    </td>
                    <td>
                      <span className="mobile-label">Locked KITTEN</span>
                      {formatBalance(asset.underlyingBalance, '')}
                    </td>
                    <td>
                      <span className="mobile-label">Unlocks</span>
                      {formatDate(asset.unlockDate)}
                      <span className="market-row-secondary">
                        {asset.lockTerm}
                      </span>
                    </td>
                    <td>
                      <span className="mobile-label">Ask</span>
                      <strong>{formatMicros(ask)}</strong>
                      {tab === 'mine' && (
                        <span className="market-row-secondary">
                          {listingStatus(listing, now)}
                        </span>
                      )}
                    </td>
                    <td>
                      <span className="mobile-label">USDC / KITTEN</span>
                      <span title="Approximate unit price, up to twelve decimal places">
                        ≈ {displayUnitPrice(ask, asset)}
                      </span>
                    </td>
                    <td>
                      <span className="mobile-label">vs demo reference</span>
                      <span className="market-discount">
                        {discount === null
                          ? '—'
                          : `${(Math.abs(discount) / 100).toFixed(1)}% ${discount >= 0 ? 'below' : 'above'}`}
                      </span>
                    </td>
                    <td className="market-row-actions">
                      {mine ? (
                        active ? (
                          <>
                            <button
                              className="button secondary small"
                              onClick={() =>
                                onAction({ kind: 'edit', listing })
                              }
                            >
                              Edit
                            </button>
                            <button
                              className="inline-link"
                              onClick={() =>
                                onAction({ kind: 'cancel', listing })
                              }
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <span className="status-pill muted">
                            {listingStatus(listing, now)}
                          </span>
                        )
                      ) : (
                        <button
                          className="button secondary small"
                          disabled={!canBuy}
                          onClick={() =>
                            onAction({ kind: 'buy', quotes: quotes([listing]) })
                          }
                        >
                          Buy
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-state">
          <Search size={24} aria-hidden="true" />
          <h3>{tab === 'mine' ? 'No listings here.' : 'No listings found.'}</h3>
          {query || category !== 'All' ? (
            <button className="button secondary" onClick={clearFilters}>
              Clear filters
            </button>
          ) : (
            tab === 'mine' && (
              <button
                className="button secondary"
                onClick={() => onAction({ kind: 'list' })}
              >
                List yours
              </button>
            )
          )}
        </div>
      )}
      {tab === 'all' && selected.length > 0 && (
        <div className="market-sweep-bar">
          <div>
            <span>
              <Check size={15} aria-hidden="true" /> {selectedListings.length}{' '}
              selected
            </span>
            <strong>{formatMicros(selectedTotal)}</strong>
          </div>
          <div>
            <button className="inline-link" onClick={() => setSelected([])}>
              Clear
            </button>
            <button
              className="button primary"
              onClick={() =>
                onAction({ kind: 'sweep', quotes: quotes(selectedListings) })
              }
            >
              Review sweep
            </button>
          </div>
        </div>
      )}
      <p className="workspace-note">
        Preview listings and demo values. Reference comparisons are
        illustrative. No wallet or live settlement.
      </p>
    </>
  );
}
