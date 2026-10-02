import { ArrowUpRight, Search, SlidersHorizontal, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { CATEGORIES } from '../data';
import type { Market } from '../markets';
import {
  filterAssets,
  formatAmount,
  formatBalance,
  formatDate,
  type Asset,
  type SortOrder,
} from '../domain';

type Props = {
  market: Market;
  assets: readonly Asset[];
  onDetails: (asset: Asset) => void;
  onPurchase: (asset: Asset) => void;
};

export default function Marketplace({
  market,
  assets,
  onDetails,
  onPurchase,
}: Props) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  const [sort, setSort] = useState<SortOrder>('curated');
  const results = useMemo(
    () => filterAssets(assets, query, category, sort),
    [assets, query, category, sort],
  );
  const resetFilters = () => {
    setQuery('');
    setCategory('All');
    setSort('curated');
  };

  return (
    <>
      <div className="section-heading">
        <div>
          <p className="section-eyebrow">{market.name} MARKETPLACE</p>
          <h2 className="section-title">
            Trade {market.positionSymbol} positions.
          </h2>
          <p className="section-description">
            Review locked balances, terms and ask prices. Settle in USDC.
          </p>
        </div>
        <span className="results-count" role="status">
          {results.length} sample{' '}
          {results.length === 1 ? 'position' : 'positions'}
        </span>
      </div>
      <div className="market-toolbar">
        <div className="search-field">
          <Search size={18} aria-hidden="true" />
          <label className="sr-only" htmlFor="asset-search">
            Search positions
          </label>
          <input
            id="asset-search"
            type="search"
            placeholder="Search positions or IDs"
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
          <SlidersHorizontal size={16} aria-hidden="true" />
          <label className="sr-only" htmlFor="category-filter">
            Lock category
          </label>
          <select
            id="category-filter"
            className="filter-control"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          >
            {CATEGORIES.map((item) => (
              <option key={item} value={item}>
                {item === 'All' ? 'All lock terms' : item}
              </option>
            ))}
          </select>
        </div>
        <div className="filter-field">
          <label className="sr-only" htmlFor="sort-order">
            Sort positions
          </label>
          <select
            id="sort-order"
            className="filter-control"
            value={sort}
            onChange={(event) => setSort(event.target.value as SortOrder)}
          >
            <option value="curated">Position order</option>
            <option value="price-asc">Ask: low to high</option>
            <option value="price-desc">Ask: high to low</option>
          </select>
        </div>
      </div>
      {results.length > 0 ? (
        <div className="asset-grid">
          {results.map((asset) => (
            <article className="asset-card" key={asset.id}>
              <button
                className="asset-image"
                onClick={() => onDetails(asset)}
                aria-label={`View ${asset.name}`}
              >
                <img
                  src={asset.artwork}
                  alt={`Portal illustration for ${asset.name}`}
                  width="640"
                  height="640"
                  loading="lazy"
                />
                <span className="asset-image-overlay">
                  <span className="asset-kind">{asset.category}</span>
                  <ArrowUpRight size={19} aria-hidden="true" />
                </span>
              </button>
              <div className="asset-info">
                <p className="asset-collection">
                  {asset.collection}
                  <span className="asset-edition">DEMO</span>
                </p>
                <h3 className="asset-title">
                  <button onClick={() => onDetails(asset)}>{asset.name}</button>
                </h3>
                <div className="position-meta">
                  <div className="position-stat">
                    <span>Locked balance · sample</span>
                    <strong>
                      {formatBalance(
                        asset.underlyingBalance,
                        asset.underlyingSymbol,
                      )}
                    </strong>
                  </div>
                  <div className="position-stat">
                    <span>Unlocks · {asset.lockTerm}</span>
                    <strong>{formatDate(asset.unlockDate)}</strong>
                  </div>
                </div>
                <div className="asset-actions">
                  <div className="asset-price">
                    <span className="asset-price-label">Illustrative ask</span>
                    <strong>{formatAmount(asset.price)}</strong>
                  </div>
                  <button
                    className="button secondary small"
                    onClick={() => onPurchase(asset)}
                  >
                    Review <ArrowUpRight size={15} aria-hidden="true" />
                    <span className="sr-only"> purchase of {asset.name}</span>
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <Search size={28} aria-hidden="true" />
          <h3>
            {assets.length
              ? 'No positions found.'
              : 'All sample positions reviewed.'}
          </h3>
          <p>
            {assets.length
              ? 'Try another search or change the lock filter.'
              : 'All six sample positions are in your preview account. Reset the preview to explore again.'}
          </p>
          {assets.length > 0 && (
            <button className="button secondary" onClick={resetFilters}>
              Clear filters
            </button>
          )}
        </div>
      )}
      <p className="workspace-note">
        Demo {market.positionSymbol} positions and sample {market.tokenSymbol}{' '}
        units. Values are illustrative; no chain data or yield is shown.
      </p>
    </>
  );
}
