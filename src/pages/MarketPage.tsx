import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  History,
  Search,
  ShoppingBag,
  Tag,
  X,
} from 'lucide-react';
import { useMemo, useState, type CSSProperties, type RefObject } from 'react';
import { EmptyState, PageHead } from '../components/page';
import { BarChart } from '../components/ui/Charts';
import { TabPanel, Tabs } from '../components/ui/Tabs';
import { CATEGORIES, SMALL_POSITION_KITTEN, assetById } from '../data';
import {
  discountBps,
  filterAssets,
  formatAmount,
  formatBalance,
  formatBps,
  formatDate,
  formatLockRemaining,
  formatMicros,
  lockDaysRemaining,
  priceMicros,
  type Asset,
  type PurchaseReceipt,
  type SortOrder,
} from '../domain';
import { isLive, type ListingBook, type PreviewListing } from '../listings';
import type { Market } from '../markets';
import type { Holdings } from '../preview/store';
import { plain } from '../format';

type Tab = 'listings' | 'yours' | 'history';
type Props = {
  market: Market;
  holdings: Holdings;
  receipts: readonly PurchaseReceipt[];
  listings: ListingBook;
  walletMicros: string;
  now: number;
  searchRef: RefObject<HTMLInputElement | null>;
  onDetails: (asset: Asset, listing?: PreviewListing) => void;
  onBuy: (asset: Asset) => void;
  onSweep: (assets: Asset[]) => void;
  onSell: (asset?: Asset) => void;
  onCancel: (listing: PreviewListing) => void;
};

const SORT_LABELS: Readonly<Record<SortOrder, string>> = {
  curated: 'Featured',
  'discount-desc': 'Highest discount',
  'price-asc': 'Ask: low to high',
  'price-desc': 'Ask: high to low',
  'balance-desc': 'Largest locked balance',
  'unlock-asc': 'Unlocking soonest',
};

const pricePerToken = (asset: Asset) =>
  `${(asset.price / asset.underlyingBalance).toLocaleString('en-GB', {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  })}`;

function SortHeader({
  label,
  orders,
  sort,
  onSort,
  numeric = true,
}: {
  label: string;
  orders: readonly SortOrder[];
  sort: SortOrder;
  onSort: (sort: SortOrder) => void;
  numeric?: boolean;
}) {
  const active = orders.includes(sort);
  const next =
    active && orders.length > 1
      ? orders[(orders.indexOf(sort) + 1) % orders.length]
      : orders[0];
  const direction =
    sort === 'price-asc' || sort === 'unlock-asc' ? 'ascending' : 'descending';
  const Icon = !active
    ? ArrowUpDown
    : direction === 'ascending'
      ? ArrowUp
      : ArrowDown;
  return (
    <th
      scope="col"
      className={numeric ? 'numeric' : undefined}
      aria-sort={active ? direction : undefined}
    >
      <button
        type="button"
        className="sort-button"
        onClick={() => onSort(next)}
      >
        {label}
        <Icon size={13} aria-hidden="true" />
      </button>
    </th>
  );
}

export default function MarketPage({
  market,
  holdings,
  receipts,
  listings,
  walletMicros,
  now,
  searchRef,
  onDetails,
  onBuy,
  onSweep,
  onSell,
  onCancel,
}: Props) {
  const [tab, setTab] = useState<Tab>('listings');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>('All');
  const [sort, setSort] = useState<SortOrder>('curated');
  const [hideSmall, setHideSmall] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const own = useMemo(
    () =>
      new Map(
        holdings.listed.map(({ asset, listing }) => [
          asset.id,
          {
            asset: { ...asset, price: Number(listing.priceMicros) / 1e6 },
            listing,
          },
        ]),
      ),
    [holdings.listed],
  );
  const pool = useMemo(
    () => [...holdings.market, ...[...own.values()].map((item) => item.asset)],
    [holdings.market, own],
  );
  const rows = useMemo(
    () =>
      filterAssets(pool, query, category, sort, {
        hideSmall,
        smallBelow: SMALL_POSITION_KITTEN,
      }),
    [pool, query, category, sort, hideSmall],
  );
  const selectable = rows.filter((asset) => !own.has(asset.id));
  const selection = holdings.market.filter((asset) => selected.has(asset.id));
  const selectionTotal = selection.reduce(
    (sum, asset) => sum + priceMicros(asset.price),
    0n,
  );
  const marketDiscounts = holdings.market.map((asset) => discountBps(asset));
  const floor = holdings.market.reduce<Asset | null>(
    (lowest, asset) => (!lowest || asset.price < lowest.price ? asset : lowest),
    null,
  );
  const average = marketDiscounts.length
    ? Math.round(
        marketDiscounts.reduce((sum, value) => sum + value, 0) /
          marketDiscounts.length,
      )
    : 0;
  const lockedListed = pool.reduce(
    (sum, asset) => sum + asset.underlyingBalance,
    0,
  );
  const history = listings.listings.filter((listing) => !isLive(listing, now));
  const [chart, setChart] = useState<'discount' | 'lock'>('discount');
  const discountBuckets = [
    ['Under 10%', 0, 1000],
    ['10–15%', 1000, 1500],
    ['15–20%', 1500, 2000],
    ['20–25%', 2000, 2500],
    ['25%+', 2500, Infinity],
  ] as const;
  const lockBuckets = [
    ['< 6m', 0, 182],
    ['6–12m', 182, 365],
    ['12–18m', 365, 548],
    ['18–24m', 548, Infinity],
  ] as const;

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const resetFilters = () => {
    setQuery('');
    setCategory('All');
    setSort('curated');
    setHideSmall(false);
  };

  return (
    <>
      <PageHead
        eyebrow={`${market.name} · ${market.chain}`}
        title={`${market.positionSymbol} marketplace`}
        lede="Buy positions at a discount to their locked value, straight into your wallet or your credit line. List your own in a few seconds."
        actions={
          <button
            type="button"
            className="button primary"
            onClick={() => onSell()}
          >
            <Tag size={16} aria-hidden="true" /> List a position
          </button>
        }
      />
      <section
        className="collection-strip"
        aria-label={`${market.positionSymbol} market overview`}
      >
        <div className="collection-id">
          <img
            src={`${import.meta.env.BASE_URL}${market.logoPath}`}
            alt=""
            width="48"
            height="48"
          />
          <div>
            <h2>{market.positionSymbol}</h2>
            <p>
              {market.name} · {market.chain} · sample listings
            </p>
          </div>
        </div>
        <dl className="collection-stats">
          <div>
            <dt>Floor ask</dt>
            <dd>{floor ? formatAmount(floor.price) : '—'}</dd>
          </div>
          <div>
            <dt>Best discount</dt>
            <dd className="accent-text">
              {marketDiscounts.length
                ? formatBps(Math.max(...marketDiscounts))
                : '—'}
            </dd>
          </div>
          <div>
            <dt>Average discount</dt>
            <dd>{marketDiscounts.length ? formatBps(average) : '—'}</dd>
          </div>
          <div>
            <dt>Listed</dt>
            <dd>
              {pool.length}
              <small>
                {' '}
                · {formatBalance(lockedListed, market.tokenSymbol)}
              </small>
            </dd>
          </div>
        </dl>
      </section>

      <div className="market-layout">
        <section className="listings-card" aria-label="Listings">
          <Tabs<Tab>
            idBase="market"
            label="Marketplace views"
            active={tab}
            onChange={setTab}
            items={[
              { id: 'listings', label: 'All listings', count: pool.length },
              {
                id: 'yours',
                label: 'Your listings',
                count: holdings.listed.length,
              },
              {
                id: 'history',
                label: 'History',
                count: receipts.length + history.length,
              },
            ]}
          />
          {tab === 'listings' && (
            <TabPanel idBase="market" id="listings" className="listings-panel">
              <div className="listings-toolbar">
                <div className="toolbar-row">
                  <div className="search-field">
                    <Search size={17} aria-hidden="true" />
                    <label className="sr-only" htmlFor="asset-search">
                      Search positions
                    </label>
                    <input
                      ref={searchRef}
                      id="asset-search"
                      type="search"
                      placeholder="Search by name or ID"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                    />
                    <kbd className="search-kbd" aria-hidden="true">
                      /
                    </kbd>
                  </div>
                  <label className="select-field">
                    <span className="sr-only">Sort positions</span>
                    <select
                      className="input-control compact"
                      value={sort}
                      onChange={(event) =>
                        setSort(event.target.value as SortOrder)
                      }
                    >
                      {(Object.keys(SORT_LABELS) as SortOrder[]).map(
                        (order) => (
                          <option key={order} value={order}>
                            {SORT_LABELS[order]}
                          </option>
                        ),
                      )}
                    </select>
                  </label>
                </div>
                <div className="toolbar-row">
                  <div className="chip-row" role="group" aria-label="Lock term">
                    {CATEGORIES.map((item) => (
                      <button
                        key={item}
                        type="button"
                        className="chip-toggle"
                        aria-pressed={category === item}
                        onClick={() => setCategory(item)}
                      >
                        {item === 'All' ? 'All locks' : item}
                      </button>
                    ))}
                  </div>
                  <label className="switch">
                    <input
                      type="checkbox"
                      role="switch"
                      checked={hideSmall}
                      onChange={(event) => setHideSmall(event.target.checked)}
                    />
                    <span className="switch-track" aria-hidden="true" />
                    Hide small
                  </label>
                </div>
              </div>
              <p className="results-count" role="status">
                {rows.length} {rows.length === 1 ? 'listing' : 'listings'}
                {hideSmall
                  ? ` · small positions under ${formatBalance(SMALL_POSITION_KITTEN, market.tokenSymbol)} hidden`
                  : ''}
              </p>
              {rows.length ? (
                <div className="table-scroll">
                  <table className="data-table listings-table">
                    <caption className="sr-only">
                      {market.positionSymbol} listings with discount, locked
                      balance, lock remaining and ask
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col" className="select-col">
                          <input
                            type="checkbox"
                            aria-label="Select all visible listings"
                            checked={
                              selectable.length > 0 &&
                              selectable.every((asset) =>
                                selected.has(asset.id),
                              )
                            }
                            disabled={!selectable.length}
                            onChange={(event) =>
                              setSelected(
                                event.target.checked
                                  ? new Set([
                                      ...selected,
                                      ...selectable.map((asset) => asset.id),
                                    ])
                                  : new Set(),
                              )
                            }
                          />
                        </th>
                        <th scope="col">Position</th>
                        <SortHeader
                          label="Discount"
                          orders={['discount-desc']}
                          sort={sort}
                          onSort={setSort}
                        />
                        <SortHeader
                          label={`Locked ${market.tokenSymbol}`}
                          orders={['balance-desc']}
                          sort={sort}
                          onSort={setSort}
                        />
                        <SortHeader
                          label="Lock left"
                          orders={['unlock-asc']}
                          sort={sort}
                          onSort={setSort}
                        />
                        <SortHeader
                          label="Ask USDC"
                          orders={['price-asc', 'price-desc']}
                          sort={sort}
                          onSort={setSort}
                        />
                        <th scope="col" className="numeric">
                          <span className="sr-only">Action</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((asset, index) => {
                        const mine = own.get(asset.id);
                        const discount = discountBps(asset);
                        return (
                          <tr
                            key={asset.id}
                            className={
                              selected.has(asset.id) ? 'selected' : undefined
                            }
                            style={
                              { '--i': Math.min(index, 12) } as CSSProperties
                            }
                          >
                            <td className="select-col">
                              {mine ? null : (
                                <input
                                  type="checkbox"
                                  aria-label={`Select ${asset.name}`}
                                  checked={selected.has(asset.id)}
                                  onChange={() => toggle(asset.id)}
                                />
                              )}
                            </td>
                            <td data-label="Position">
                              <button
                                type="button"
                                className="position-cell"
                                aria-label={`View ${asset.name}`}
                                onClick={() => onDetails(asset, mine?.listing)}
                              >
                                <img
                                  className="thumb"
                                  src={asset.artwork}
                                  alt=""
                                  width="40"
                                  height="40"
                                  loading="lazy"
                                />
                                <span>
                                  <strong className="asset-title">
                                    {asset.name}
                                  </strong>
                                  <small>
                                    {asset.category}
                                    {mine ? (
                                      <span className="pill accent">Yours</span>
                                    ) : (
                                      <span className="pill muted">Demo</span>
                                    )}
                                  </small>
                                </span>
                              </button>
                            </td>
                            <td data-label="Discount" className="numeric">
                              <span
                                className={
                                  discount >= 2000 ? 'discount hot' : 'discount'
                                }
                              >
                                {formatBps(discount)}
                              </span>
                            </td>
                            <td
                              data-label={`Locked ${market.tokenSymbol}`}
                              className="numeric"
                            >
                              {plain(asset.underlyingBalance)}
                            </td>
                            <td data-label="Lock left" className="numeric">
                              <span
                                title={`Unlocks ${formatDate(asset.unlockDate)}`}
                              >
                                {formatLockRemaining(
                                  lockDaysRemaining(asset.unlockDate, now),
                                )}
                              </span>
                            </td>
                            <td data-label="Ask USDC" className="numeric">
                              <strong>{plain(asset.price)}</strong>
                              <small className="cell-sub">
                                {pricePerToken(asset)} / {market.tokenSymbol}
                              </small>
                            </td>
                            <td className="numeric action-cell">
                              {mine ? (
                                <button
                                  type="button"
                                  className="button secondary small"
                                  aria-label={`Cancel listing for ${asset.name}`}
                                  onClick={() => onCancel(mine.listing)}
                                >
                                  Cancel
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className="button secondary small"
                                  aria-label={`Buy ${asset.name}`}
                                  onClick={() => onBuy(asset)}
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
                <EmptyState
                  icon={Search}
                  title={
                    pool.length
                      ? 'No positions found.'
                      : 'All sample positions bought.'
                  }
                  action={
                    pool.length ? (
                      <button
                        type="button"
                        className="button secondary"
                        onClick={resetFilters}
                      >
                        Clear filters
                      </button>
                    ) : undefined
                  }
                >
                  {pool.length
                    ? 'Try another search or change the lock filter.'
                    : 'Every sample listing is in your preview account. Reset the preview to explore again.'}
                </EmptyState>
              )}
              {selection.length > 0 && (
                <div
                  className="sweep-bar"
                  role="region"
                  aria-label="Selected listings"
                >
                  <span>
                    <strong>{selection.length}</strong> selected ·{' '}
                    {formatMicros(selectionTotal)}
                    {selectionTotal > BigInt(walletMicros) && (
                      <span className="pill warning">Exceeds demo balance</span>
                    )}
                  </span>
                  <span className="sweep-actions">
                    <button
                      type="button"
                      className="button ghost small"
                      onClick={() => setSelected(new Set())}
                    >
                      <X size={14} aria-hidden="true" /> Clear
                    </button>
                    <button
                      type="button"
                      className="button primary small"
                      onClick={() => onSweep(selection)}
                    >
                      <ShoppingBag size={14} aria-hidden="true" /> Buy selected
                    </button>
                  </span>
                </div>
              )}
            </TabPanel>
          )}
          {tab === 'yours' && (
            <TabPanel idBase="market" id="yours">
              {holdings.listed.length ? (
                <ul className="row-list">
                  {holdings.listed.map(({ asset, listing }) => (
                    <li key={listing.id} className="list-row">
                      <img
                        className="thumb"
                        src={asset.artwork}
                        alt=""
                        width="40"
                        height="40"
                      />
                      <span className="list-row-main">
                        <strong>{asset.name}</strong>
                        <small>
                          Listed {formatDate(listing.createdAt)} · expires{' '}
                          {formatDate(listing.expiresAt)}
                        </small>
                      </span>
                      <strong>{formatMicros(listing.priceMicros)}</strong>
                      <button
                        type="button"
                        className="button secondary small"
                        aria-label={`Cancel listing for ${asset.name}`}
                        onClick={() => onCancel(listing)}
                      >
                        Cancel
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState
                  icon={Tag}
                  title="No active listings."
                  action={
                    <button
                      type="button"
                      className="button secondary"
                      onClick={() => onSell()}
                    >
                      List a position
                    </button>
                  }
                >
                  List a position from your demo wallet. It stays reserved until
                  you cancel it or it expires.
                </EmptyState>
              )}
            </TabPanel>
          )}
          {tab === 'history' && (
            <TabPanel idBase="market" id="history">
              {receipts.length + history.length ? (
                <ul className="row-list">
                  {receipts
                    .slice()
                    .reverse()
                    .map((receipt) => {
                      const asset = assetById(receipt.assetId);
                      if (!asset) return null;
                      return (
                        <li key={receipt.id} className="list-row">
                          <img
                            className="thumb"
                            src={asset.artwork}
                            alt=""
                            width="40"
                            height="40"
                          />
                          <span className="list-row-main">
                            <strong>{asset.name}</strong>
                            <small>
                              Bought {formatDate(receipt.createdAt)} ·{' '}
                              {receipt.destination === 'collateral'
                                ? 'into credit line'
                                : 'to wallet'}
                            </small>
                          </span>
                          <strong>{formatAmount(receipt.price)}</strong>
                          <span className="pill accent">Purchase</span>
                        </li>
                      );
                    })}
                  {history
                    .slice()
                    .reverse()
                    .map((listing) => {
                      const asset = assetById(listing.assetId);
                      if (!asset) return null;
                      return (
                        <li key={listing.id} className="list-row">
                          <img
                            className="thumb"
                            src={asset.artwork}
                            alt=""
                            width="40"
                            height="40"
                          />
                          <span className="list-row-main">
                            <strong>{asset.name}</strong>
                            <small>
                              Listed {formatDate(listing.createdAt)}
                            </small>
                          </span>
                          <strong>{formatMicros(listing.priceMicros)}</strong>
                          <span className="pill muted">
                            {listing.status === 'cancelled'
                              ? 'Cancelled'
                              : 'Expired'}
                          </span>
                        </li>
                      );
                    })}
                </ul>
              ) : (
                <EmptyState icon={History} title="No history yet." compact>
                  Purchases and ended listings from this browser appear here.
                </EmptyState>
              )}
            </TabPanel>
          )}
        </section>

        <aside className="market-side" aria-label="Market insights">
          <section className="panel">
            <div className="block-head">
              <h2>Market stats</h2>
              <div className="mini-toggle" role="group" aria-label="Chart">
                <button
                  type="button"
                  aria-pressed={chart === 'discount'}
                  onClick={() => setChart('discount')}
                >
                  Discount
                </button>
                <button
                  type="button"
                  aria-pressed={chart === 'lock'}
                  onClick={() => setChart('lock')}
                >
                  Lock
                </button>
              </div>
            </div>
            {chart === 'discount' ? (
              <BarChart
                ariaLabel={`Sample listings by discount: ${discountBuckets
                  .map(
                    ([label, low, high]) =>
                      `${label} ${marketDiscounts.filter((value) => value >= low && value < high).length}`,
                  )
                  .join(', ')}`}
                bars={discountBuckets.map(([label, low, high]) => {
                  const count = marketDiscounts.filter(
                    (value) => value >= low && value < high,
                  ).length;
                  return { label, value: count, display: String(count) };
                })}
              />
            ) : (
              <BarChart
                ariaLabel="Sample listings by lock remaining"
                bars={lockBuckets.map(([label, low, high]) => {
                  const count = holdings.market.filter((asset) => {
                    const days = lockDaysRemaining(asset.unlockDate, now);
                    return days >= low && days < high;
                  }).length;
                  return { label, value: count, display: String(count) };
                })}
              />
            )}
            <p className="form-hint">
              Distribution of the {holdings.market.length} sample listings from
              other sellers.
            </p>
          </section>
          <section className="panel">
            <div className="block-head">
              <h2>Your purchases</h2>
              <span className="text-muted">This browser</span>
            </div>
            {receipts.length ? (
              <ul className="history-feed">
                {receipts
                  .slice(-5)
                  .reverse()
                  .map((receipt) => {
                    const asset = assetById(receipt.assetId);
                    return (
                      <li key={receipt.id}>
                        <span>
                          <strong>{asset?.name ?? 'Sample position'}</strong>
                          <small>{formatDate(receipt.createdAt)}</small>
                        </span>
                        <span className="numeric">
                          {formatAmount(receipt.price)}
                          <small>
                            {asset
                              ? `${formatBps(discountBps({ ...asset, price: receipt.price }))} off`
                              : ''}
                          </small>
                        </span>
                      </li>
                    );
                  })}
              </ul>
            ) : (
              <p className="panel-text">
                Buy a position to see it here. Purchases spend your demo USDC
                and never leave this browser.
              </p>
            )}
          </section>
        </aside>
      </div>
      <p className="page-note">
        Demo {market.positionSymbol} positions and sample {market.tokenSymbol}{' '}
        units. Discounts compare each ask with a fixed example reference value;
        no chain data or yield is shown.
      </p>
    </>
  );
}
