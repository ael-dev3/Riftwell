import { Check, Plus, RefreshCw, Search, X } from 'lucide-react';
import { useEffect, useMemo, useState, type RefObject } from 'react';
import { PageHead } from '../components/page';
import type { Market } from '../markets';
import type { Account, Listing } from './api';
import {
  dateLabel,
  decimalAmount,
  listingAskMicros,
  shortAddress,
  usdc,
} from './amounts';

export type ConnectedMarketplaceProps = {
  market: Market;
  items: Listing[];
  loading: boolean;
  error: string;
  ownItems: Listing[];
  ownLoading: boolean;
  ownError: string;
  ownHasMore: boolean;
  onOwnMore: () => void;
  account: Account | null;
  signedIn: boolean;
  signedAddress: string | null;
  accountLoading: boolean;
  hasMore: boolean;
  onMore: () => void;
  onRefresh: () => void;
  onList: () => void;
  onAccount: () => void;
  onReview: (listing: Listing) => void;
  onSweep: (listings: Listing[]) => void;
  onEdit: (listing: Listing) => void;
  onCancel: (listing: Listing) => void;
  searchRef?: RefObject<HTMLInputElement | null>;
};

type Tab = 'all' | 'mine' | 'history';
type Order = 'newest' | 'price-asc' | 'price-desc' | 'unit-asc';
type Selection = { id: string; revision: number };
const MAX_SELECTED = 20;
const activeAt = (listing: Listing, now: number) =>
  listing.status === 'active' && Date.parse(listing.expiresAt) > now;
const statusAt = (listing: Listing, now: number) =>
  listing.status === 'active' && !activeAt(listing, now)
    ? 'expired'
    : listing.status;
const canBuy = (listing: Listing, address: string | undefined) =>
  listing.owner.toLowerCase() !== address &&
  (listing.recipient === null || listing.recipient.toLowerCase() === address);
const compareRaw = (left: bigint, right: bigint) =>
  left === right ? 0 : left < right ? -1 : 1;

/** Price is USDC micros; the locked balance is KITTEN with 18 decimals. */
function unitPrice(listing: Listing, now: number): string {
  const locked = BigInt(listing.position.lockedAmountRaw);
  if (locked === 0n) return '—';
  const numerator = BigInt(listingAskMicros(listing, now)) * 10n ** 24n;
  const scaled = numerator / locked;
  if (scaled === 0n && numerator > 0n) return '<0.000000000001';
  return `${numerator % locked === 0n ? '' : '≈ '}${decimalAmount(scaled.toString(), 12)}`;
}

function compareUnitPrice(left: Listing, right: Listing, now: number): number {
  const leftLocked = BigInt(left.position.lockedAmountRaw);
  const rightLocked = BigInt(right.position.lockedAmountRaw);
  if (leftLocked === 0n || rightLocked === 0n)
    return leftLocked === rightLocked ? 0 : leftLocked === 0n ? 1 : -1;
  return compareRaw(
    BigInt(listingAskMicros(left, now)) * rightLocked,
    BigInt(listingAskMicros(right, now)) * leftLocked,
  );
}

export default function ConnectedMarketplace({
  market,
  items,
  loading,
  error,
  ownItems,
  ownLoading,
  ownError,
  ownHasMore,
  onOwnMore,
  account,
  signedIn,
  signedAddress,
  accountLoading,
  hasMore,
  onMore,
  onRefresh,
  onList,
  onAccount,
  onReview,
  onSweep,
  onEdit,
  onCancel,
  searchRef,
}: ConnectedMarketplaceProps) {
  const [tab, setTab] = useState<Tab>('all');
  const [query, setQuery] = useState('');
  const [order, setOrder] = useState<Order>('newest');
  const [selected, setSelected] = useState<Selection[]>([]);
  const [now, setNow] = useState(Date.now());
  const address = signedIn ? signedAddress?.toLowerCase() : undefined;
  const identityPending = signedIn && (accountLoading || !account);
  const own = (listing: Listing) => listing.owner.toLowerCase() === address;
  const busy =
    tab === 'all' ? loading : tab === 'mine' ? ownLoading : accountLoading;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const publicListings = useMemo(
    () =>
      error
        ? []
        : items.filter(
            (listing) =>
              listing.marketId === market.id && activeAt(listing, now),
          ),
    [items, error, market.id, now],
  );
  const selections = useMemo(
    () =>
      publicListings.filter(
        (listing) =>
          canBuy(listing, address) &&
          selected.some(
            (selection) =>
              selection.id === listing.id &&
              selection.revision === listing.revision,
          ),
      ),
    [publicListings, selected, address],
  );
  useEffect(() => {
    setSelected((previous) => {
      const next = previous.filter((selection) =>
        publicListings.some(
          (listing) =>
            listing.id === selection.id &&
            listing.revision === selection.revision &&
            canBuy(listing, address),
        ),
      );
      return next.length === previous.length ? previous : next;
    });
  }, [publicListings, address]);
  useEffect(() => {
    setSelected([]);
  }, [address, signedIn, market.id]);

  const rows = useMemo(() => {
    const source =
      tab === 'all'
        ? publicListings
        : tab === 'mine'
          ? signedIn && !ownError
            ? ownItems.filter(
                (listing) =>
                  listing.marketId === market.id &&
                  listing.owner.toLowerCase() === address &&
                  activeAt(listing, now),
              )
            : []
          : signedIn && account
            ? account.listings.filter(
                (listing) =>
                  listing.marketId === market.id &&
                  listing.owner.toLowerCase() ===
                    account.address.toLowerCase() &&
                  !activeAt(listing, now),
              )
            : [];
    const search = query.trim().toLowerCase();
    return source
      .filter((listing) =>
        `${market.positionSymbol} #${listing.tokenId} ${listing.owner}`
          .toLowerCase()
          .includes(search),
      )
      .sort((left, right) => {
        const difference =
          order === 'newest'
            ? Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
            : order === 'unit-asc'
              ? compareUnitPrice(left, right, now)
              : compareRaw(
                  BigInt(listingAskMicros(left, now)),
                  BigInt(listingAskMicros(right, now)),
                ) * (order === 'price-desc' ? -1 : 1);
        return difference || left.id.localeCompare(right.id);
      });
  }, [
    tab,
    publicListings,
    ownItems,
    ownError,
    address,
    signedIn,
    account,
    market.id,
    market.positionSymbol,
    now,
    query,
    order,
  ]);
  const selectable = rows
    .filter((listing) => canBuy(listing, address))
    .slice(0, MAX_SELECTED);
  const allSelected =
    selectable.length > 0 &&
    selectable.every((listing) =>
      selections.some((selection) => selection.id === listing.id),
    );
  const totalMicros = selections.reduce(
    (sum, listing) => sum + BigInt(listingAskMicros(listing, now)),
    0n,
  );

  function toggle(listing: Listing, checked: boolean) {
    if (
      error ||
      loading ||
      identityPending ||
      !canBuy(listing, address) ||
      !activeAt(listing, Date.now())
    )
      return;
    setSelected((previous) => {
      if (!checked) return previous.filter((item) => item.id !== listing.id);
      if (
        previous.length >= MAX_SELECTED ||
        previous.some((item) => item.id === listing.id)
      )
        return previous;
      return [...previous, { id: listing.id, revision: listing.revision }];
    });
  }
  function review(listing: Listing) {
    const time = Date.now();
    setNow(time);
    if (
      !error &&
      !loading &&
      !identityPending &&
      canBuy(listing, address) &&
      activeAt(listing, time)
    )
      onReview(listing);
  }
  function sweep() {
    const time = Date.now();
    setNow(time);
    const current = selections.filter(
      (listing) => activeAt(listing, time) && canBuy(listing, address),
    );
    if (
      !error &&
      !loading &&
      !identityPending &&
      current.length &&
      current.length === selections.length
    )
      onSweep(current);
  }
  function clearFilters() {
    setQuery('');
    setOrder('newest');
  }

  return (
    <>
      <PageHead
        eyebrow={`${market.name} · USDC`}
        title={`${market.positionSymbol} marketplace`}
        titleId="connected-market-title"
        lede="Browse verified positions, or list one from your wallet."
        actions={
          <button type="button" className="button primary" onClick={onList}>
            <Plus size={16} aria-hidden="true" /> List yours
          </button>
        }
      />
      <section
        className="workspace-card panel connected-marketplace"
        aria-labelledby="connected-market-title"
      >
        <div className="market-table-nav">
          <div className="chip-row" role="group" aria-label="Marketplace view">
            {(['all', 'mine', 'history'] as const).map((value) => (
              <button
                key={value}
                type="button"
                className="chip-toggle"
                aria-pressed={tab === value}
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
          <button
            type="button"
            className="button ghost small"
            disabled={busy}
            onClick={onRefresh}
          >
            <RefreshCw size={14} aria-hidden="true" /> Refresh
          </button>
        </div>
        <div className="market-toolbar">
          <div className="search-field">
            <Search size={16} aria-hidden="true" />
            <label className="sr-only" htmlFor="connected-market-search">
              Search loaded listings by token ID or seller
            </label>
            <input
              id="connected-market-search"
              ref={searchRef}
              type="search"
              placeholder="Token ID or seller"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {query && (
              <button
                className="clear-search"
                type="button"
                aria-label="Clear search"
                onClick={() => setQuery('')}
              >
                <X size={14} aria-hidden="true" />
              </button>
            )}
          </div>
          <div className="filter-group">
            <label className="sr-only" htmlFor="connected-market-sort">
              Sort loaded listings
            </label>
            <select
              id="connected-market-sort"
              className="input-control"
              value={order}
              onChange={(event) => setOrder(event.target.value as Order)}
            >
              <option value="newest">Updated: newest first</option>
              <option value="price-asc">Ask: low to high</option>
              <option value="price-desc">Ask: high to low</option>
              <option value="unit-asc">Unit price: low to high</option>
            </select>
          </div>
          <span className="results-count" role="status">
            {rows.length} loaded {rows.length === 1 ? 'record' : 'records'}
          </span>
        </div>
        {(tab === 'all' && error) ||
        (tab === 'mine' && signedIn && ownError) ? (
          <div className="empty" role="alert">
            <h3>Listings unavailable.</h3>
            <p>{tab === 'mine' ? ownError : error}</p>
            <button
              className="button secondary"
              disabled={busy}
              onClick={onRefresh}
            >
              Retry
            </button>
          </div>
        ) : tab !== 'all' && !signedIn ? (
          <div className="empty">
            <h3>
              Sign in to view{' '}
              {tab === 'mine' ? 'your listings' : 'your history'}.
            </h3>
            <button className="button secondary" onClick={onAccount}>
              Sign in
            </button>
          </div>
        ) : busy && !rows.length ? (
          <div className="empty" role="status">
            <h3>Loading listings…</h3>
          </div>
        ) : tab === 'history' && !account ? (
          <div className="empty">
            <h3>Account unavailable.</h3>
            <button className="button secondary" onClick={onRefresh}>
              Retry
            </button>
          </div>
        ) : rows.length ? (
          <div
            className="market-table-wrap table-scroll"
            role="region"
            aria-label={
              tab === 'all'
                ? 'Marketplace listings'
                : tab === 'mine'
                  ? 'Your active listings'
                  : 'Your listing history'
            }
            tabIndex={0}
          >
            <table
              className={`market-table data-table listings-table${tab !== 'all' ? ' no-selection' : ''}${tab === 'history' ? ' market-history-table' : ''}`}
              aria-busy={busy}
            >
              <caption className="sr-only">
                {tab === 'all'
                  ? 'Loaded active listings'
                  : tab === 'mine'
                    ? 'Your active listings'
                    : 'Your past listings'}{' '}
                in USDC. Unit prices are rounded down to twelve decimal places.
                Search and sorting apply to loaded records.
              </caption>
              <thead>
                <tr>
                  {tab === 'all' && (
                    <th scope="col" className="market-select-cell select-col">
                      <input
                        type="checkbox"
                        aria-label="Select up to 20 available listings"
                        checked={allSelected}
                        disabled={
                          !selectable.length || loading || identityPending
                        }
                        onChange={(event) =>
                          setSelected(
                            event.target.checked
                              ? selectable
                                  .filter((listing) =>
                                    activeAt(listing, Date.now()),
                                  )
                                  .map(({ id, revision }) => ({ id, revision }))
                              : [],
                          )
                        }
                      />
                    </th>
                  )}
                  <th scope="col">Token ID</th>
                  <th scope="col">Seller</th>
                  <th scope="col" className="numeric">
                    Locked {market.tokenSymbol}
                  </th>
                  <th scope="col" className="numeric">
                    Unlocks
                  </th>
                  <th scope="col" className="numeric">
                    Ask · USDC
                  </th>
                  <th scope="col" className="numeric">
                    USDC / {market.tokenSymbol}
                  </th>
                  {tab === 'history' && (
                    <th scope="col" className="numeric">
                      Updated
                    </th>
                  )}
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((listing) => {
                  const mine = own(listing);
                  const eligible = canBuy(listing, address);
                  const active = activeAt(listing, now);
                  const checked = selections.some(
                    (item) => item.id === listing.id,
                  );
                  return (
                    <tr key={listing.id} className={checked ? 'selected' : ''}>
                      {tab === 'all' && (
                        <td className="market-select-cell select-col">
                          <input
                            type="checkbox"
                            aria-label={`Select ${market.positionSymbol} #${listing.tokenId}`}
                            checked={checked}
                            disabled={
                              !eligible ||
                              !active ||
                              loading ||
                              identityPending ||
                              (!checked && selections.length >= MAX_SELECTED)
                            }
                            onChange={(event) =>
                              toggle(listing, event.target.checked)
                            }
                          />
                        </td>
                      )}
                      <td data-label="Position">
                        <span className="market-token-link asset-title">
                          #{listing.tokenId}
                        </span>
                        <span className="market-row-secondary cell-sub">
                          {listing.kind === 'dutch' ? 'Dutch' : 'Fixed'}
                          {listing.recipient !== null ? ' · Reserved' : ''}
                          {mine ? ' · Yours' : ''}
                        </span>
                      </td>
                      <td data-label="Seller">
                        <span title={listing.owner}>
                          {shortAddress(listing.owner)}
                        </span>
                      </td>
                      <td
                        data-label={`Locked ${market.tokenSymbol}`}
                        className="numeric"
                      >
                        {decimalAmount(listing.position.lockedAmountRaw, 18)}
                      </td>
                      <td data-label="Unlocks" className="numeric">
                        {dateLabel(listing.position.lockedUntil)}
                        {Date.parse(listing.position.lockedUntil) <= now && (
                          <span className="market-row-secondary cell-sub">
                            Lock ended
                          </span>
                        )}
                      </td>
                      <td data-label="Ask" className="numeric">
                        <strong>{usdc(listingAskMicros(listing, now))}</strong>
                        <span className="market-row-secondary cell-sub">
                          Listing ends {dateLabel(listing.expiresAt)}
                        </span>
                      </td>
                      <td
                        data-label={`USDC / ${market.tokenSymbol}`}
                        className="numeric"
                      >
                        {unitPrice(listing, now)}
                      </td>
                      {tab === 'history' && (
                        <td data-label="Updated" className="numeric">
                          {dateLabel(listing.updatedAt)}
                        </td>
                      )}
                      <td className="market-row-actions action-cell numeric">
                        <div className="row-actions">
                          {tab === 'history' ? (
                            <span className="pill muted">
                              {statusAt(listing, now)}
                            </span>
                          ) : mine ? (
                            <>
                              <button
                                className="button secondary small"
                                disabled={!active || accountLoading}
                                onClick={() =>
                                  activeAt(listing, Date.now()) &&
                                  onEdit(listing)
                                }
                              >
                                Edit
                              </button>
                              <button
                                className="button ghost small"
                                disabled={!active}
                                onClick={() =>
                                  activeAt(listing, Date.now()) &&
                                  onCancel(listing)
                                }
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <button
                              className="button secondary small"
                              disabled={
                                !active ||
                                !eligible ||
                                loading ||
                                identityPending
                              }
                              onClick={() => review(listing)}
                            >
                              Buy
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">
            <Search size={24} aria-hidden="true" />
            <h3>
              {query
                ? 'No matching listings.'
                : tab === 'mine'
                  ? 'No active listings.'
                  : tab === 'history'
                    ? 'No past listings.'
                    : 'No active listings.'}
            </h3>
            {query ? (
              <button className="button secondary" onClick={clearFilters}>
                Clear filters
              </button>
            ) : tab === 'mine' ? (
              <button className="button secondary" onClick={onList}>
                List yours
              </button>
            ) : null}
          </div>
        )}
        {((tab === 'all' && !error && hasMore) ||
          (tab === 'mine' && signedIn && !ownError && ownHasMore)) && (
          <button
            className="button secondary load-more"
            disabled={busy}
            onClick={tab === 'mine' ? onOwnMore : onMore}
          >
            {busy ? 'Loading…' : 'Load more listings'}
          </button>
        )}
        {tab === 'mine' && signedIn && (
          <p className="form-hint">
            These are your saved off-chain listings. Position details reflect
            their last observed block. Edits require fresh ownership
            verification; cancellation remains available during chain outages.
          </p>
        )}
        {tab === 'history' && account?.historyTruncated && (
          <p className="form-hint">
            History is limited to 500 records per category. Earlier records are
            retained.
          </p>
        )}
        {tab === 'all' && selections.length > 0 && (
          <div className="market-sweep-bar sweep-bar">
            <div>
              <span>
                <Check size={15} aria-hidden="true" /> {selections.length}{' '}
                selected
              </span>
              <strong>{usdc(totalMicros.toString())}</strong>
            </div>
            <div className="sweep-actions">
              <button
                className="button ghost small"
                onClick={() => setSelected([])}
              >
                Clear
              </button>
              <button
                className="button primary"
                disabled={loading || identityPending}
                onClick={sweep}
              >
                Review sweep
              </button>
            </div>
          </div>
        )}
      </section>
    </>
  );
}
