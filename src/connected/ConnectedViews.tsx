import { Search, Store, Tag } from 'lucide-react';
import { useMemo, useState, type CSSProperties, type RefObject } from 'react';
import Dialog from '../components/Dialog';
import { EmptyState, PageHead } from '../components/page';
import { TabPanel, Tabs } from '../components/ui/Tabs';
import type { Market } from '../markets';
import type { Account, Listing, LoanRequest, Offer, Position } from './api';
import {
  dateLabel,
  decimalAmount,
  kitten,
  shortAddress,
  usdc,
} from './amounts';
import { PositionSummary } from './RecordDialogs';

export const positionArt = (tokenId: string) =>
  `${import.meta.env.BASE_URL}artwork-${Number(BigInt(tokenId) % 6n)}.svg`;

type MarketProps = {
  market: Market;
  items: Listing[];
  loading: boolean;
  canCreate: boolean;
  nextCursor: string | null;
  searchRef: RefObject<HTMLInputElement | null>;
  onLoadMore: () => void;
  onReview: (listing: Listing) => void;
  onCreate: () => void;
};

export function ConnectedMarket({
  market,
  items,
  loading,
  canCreate,
  nextCursor,
  searchRef,
  onLoadMore,
  onReview,
  onCreate,
}: MarketProps) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('newest');
  const results = useMemo(
    () =>
      items
        .filter((listing) =>
          `${listing.tokenId} ${listing.owner}`
            .toLowerCase()
            .includes(query.trim().toLowerCase()),
        )
        .sort((a, b) =>
          sort === 'newest'
            ? Date.parse(b.createdAt) - Date.parse(a.createdAt)
            : BigInt(a.priceMicros) === BigInt(b.priceMicros)
              ? 0
              : (BigInt(a.priceMicros) < BigInt(b.priceMicros) ? -1 : 1) *
                (sort === 'low' ? 1 : -1),
        ),
    [items, query, sort],
  );
  const floor = items.reduce<Listing | null>(
    (lowest, listing) =>
      !lowest || BigInt(listing.priceMicros) < BigInt(lowest.priceMicros)
        ? listing
        : lowest,
    null,
  );
  const locked = items.reduce(
    (sum, listing) => sum + BigInt(listing.position.lockedAmountRaw),
    0n,
  );
  const owners = new Set(items.map((listing) => listing.owner.toLowerCase()))
    .size;

  return (
    <>
      <PageHead
        eyebrow={`${market.name} · ${market.chain}`}
        title={`${market.positionSymbol} marketplace`}
        lede="Ownership-verified listings for veKITTEN positions. Purchases await contract settlement."
        actions={
          <button
            type="button"
            className="button primary"
            disabled={!canCreate}
            onClick={onCreate}
          >
            <Tag size={16} aria-hidden="true" /> Create listing
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
              {market.name} · {market.chain} · off-chain listings
            </p>
          </div>
        </div>
        <dl className="collection-stats">
          <div>
            <dt>Lowest ask</dt>
            <dd>{floor ? usdc(floor.priceMicros) : '—'}</dd>
          </div>
          <div>
            <dt>Listings loaded</dt>
            <dd>{items.length}</dd>
          </div>
          <div>
            <dt>Sellers</dt>
            <dd>{owners}</dd>
          </div>
          <div>
            <dt>KITTEN listed</dt>
            <dd>
              {items.length
                ? decimalAmount(locked.toString(), 18).split('.')[0]
                : '—'}
            </dd>
          </div>
        </dl>
      </section>
      <section className="listings-card" aria-label="Listings">
        <div className="tabpanel listings-panel">
          <div className="listings-toolbar">
            <div className="toolbar-row">
              <div className="search-field">
                <Search size={17} aria-hidden="true" />
                <label className="sr-only" htmlFor="live-search">
                  Search loaded listings by token ID or owner
                </label>
                <input
                  ref={searchRef}
                  id="live-search"
                  type="search"
                  placeholder="Search token ID or owner"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
                <kbd className="search-kbd" aria-hidden="true">
                  /
                </kbd>
              </div>
              <label className="select-field">
                <span className="sr-only">Sort listings</span>
                <select
                  className="input-control compact"
                  value={sort}
                  onChange={(event) => setSort(event.target.value)}
                >
                  <option value="newest">Newest listings</option>
                  <option value="low">Ask: low to high</option>
                  <option value="high">Ask: high to low</option>
                </select>
              </label>
            </div>
          </div>
          <p className="results-count" role="status">
            {results.length} {results.length === 1 ? 'listing' : 'listings'} ·
            search and sorting apply to the loaded listings
          </p>
          {results.length ? (
            <div className="table-scroll">
              <table className="data-table listings-table">
                <caption className="sr-only">
                  Off-chain {market.positionSymbol} listings with verified lock
                  data
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Position</th>
                    <th scope="col" className="numeric">
                      Locked
                    </th>
                    <th scope="col" className="numeric">
                      Unlocks
                    </th>
                    <th scope="col" className="numeric">
                      Expires
                    </th>
                    <th scope="col" className="numeric">
                      Ask
                    </th>
                    <th scope="col" className="numeric">
                      <span className="sr-only">Action</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((listing, index) => (
                    <tr
                      key={listing.id}
                      className="connected-listing"
                      style={{ '--i': Math.min(index, 12) } as CSSProperties}
                    >
                      <td data-label="Position">
                        <button
                          type="button"
                          className="position-cell"
                          aria-label={`Review veKITTEN #${listing.tokenId}`}
                          onClick={() => onReview(listing)}
                        >
                          <img
                            className="thumb"
                            src={positionArt(listing.tokenId)}
                            alt=""
                            width="40"
                            height="40"
                            loading="lazy"
                          />
                          <span>
                            <strong className="asset-title">
                              veKITTEN #{listing.tokenId}
                            </strong>
                            <small>
                              {shortAddress(listing.owner)}
                              <span className="pill accent">Verified read</span>
                            </small>
                          </span>
                        </button>
                      </td>
                      <td data-label="Locked" className="numeric">
                        {kitten(listing.position.lockedAmountRaw)}
                      </td>
                      <td data-label="Unlocks" className="numeric">
                        {dateLabel(listing.position.lockedUntil)}
                      </td>
                      <td data-label="Expires" className="numeric text-muted">
                        {dateLabel(listing.expiresAt)}
                      </td>
                      <td data-label="Ask" className="numeric">
                        <strong>{usdc(listing.priceMicros)}</strong>
                      </td>
                      <td className="numeric action-cell">
                        <button
                          type="button"
                          className="button secondary small"
                          onClick={() => onReview(listing)}
                        >
                          Review
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              icon={Store}
              title={
                loading
                  ? 'Loading listings…'
                  : query
                    ? 'No matching listings.'
                    : 'No active listings.'
              }
            >
              {query
                ? 'Try another token ID or owner address.'
                : 'Create an off-chain listing from a position you own.'}
            </EmptyState>
          )}
          {nextCursor && (
            <div className="dialog-actions">
              <button
                type="button"
                className="button secondary"
                disabled={loading}
                onClick={onLoadMore}
              >
                {loading ? 'Loading…' : 'Load more'}
              </button>
            </div>
          )}
        </div>
      </section>
    </>
  );
}

type AccountProps = {
  account: Account | null;
  loading: boolean;
  onClose: () => void;
  onRefresh: () => void;
  onMore: () => void;
  onList: (position: Position) => void;
  onCancel: (
    kind: 'listing' | 'request' | 'offer',
    record: Listing | LoanRequest | Offer,
  ) => void;
  onSignOut: () => void;
};

type AccountTab = 'positions' | 'listings' | 'archive';

export function ConnectedAccount({
  account,
  loading,
  onClose,
  onRefresh,
  onMore,
  onList,
  onCancel,
  onSignOut,
}: AccountProps) {
  const [tab, setTab] = useState<AccountTab>('positions');
  const archive = account
    ? [...account.loanRequests, ...account.offers, ...account.receivedOffers]
    : [];
  const records = tab === 'listings' ? (account?.listings ?? []) : archive;
  return (
    <Dialog
      title="Your account"
      kicker="HYPEREVM · CONNECTED"
      onClose={onClose}
      wide
    >
      <div className="dialog-body connected-account">
        <p className="form-hint">
          Verified ownership reads and durable off-chain records. No funded
          loans or settlement balances.
        </p>
        {account?.positionsUnavailable && (
          <div className="notice" role="status">
            <p>
              Chain verification is unavailable. Owned positions cannot be
              displayed. Off-chain history remains available, and you can cancel
              your own records. Position metadata in history reflects its last
              observed block.
            </p>
          </div>
        )}
        {account?.historyTruncated && (
          <p className="form-hint" role="status">
            This account view shows the latest 500 records of each type. Earlier
            history is retained by the service. Manage all active listings in
            Marketplace → My listings.
          </p>
        )}
        <Tabs<AccountTab>
          idBase="connected-account"
          label="Account view"
          active={tab}
          onChange={setTab}
          variant="pill"
          items={[
            {
              id: 'positions',
              label: 'Positions',
              count: account?.positions.length,
            },
            {
              id: 'listings',
              label: 'Listings',
              count: account?.listings.length,
            },
            ...(archive.length
              ? [{ id: 'archive' as const, label: 'Previous records' }]
              : []),
          ]}
        />
        <TabPanel idBase="connected-account" id={tab}>
          {!account ? (
            <EmptyState
              icon={Store}
              compact
              title={loading ? 'Loading your account…' : 'Account unavailable.'}
              action={
                <button
                  type="button"
                  className="button secondary"
                  onClick={onRefresh}
                >
                  Retry
                </button>
              }
            >
              Your verified positions and records appear here.
            </EmptyState>
          ) : tab === 'positions' ? (
            <>
              <div className="row-list">
                {account.positions.map((position) => (
                  <article
                    key={position.id}
                    className="portfolio-item connected-position"
                  >
                    <div className="block-head">
                      <h3>veKITTEN #{position.tokenId}</h3>
                      <button
                        type="button"
                        className="button secondary small"
                        onClick={() => onList(position)}
                      >
                        Create listing
                      </button>
                    </div>
                    <PositionSummary position={position} />
                  </article>
                ))}
              </div>
              {!account.positions.length && (
                <EmptyState
                  icon={Store}
                  compact
                  title={
                    account.positionsUnavailable
                      ? 'Position data unavailable.'
                      : 'No positions found.'
                  }
                >
                  {account.positionsUnavailable
                    ? 'Refresh your account when chain access returns. Your off-chain records remain in the other account views.'
                    : 'You can verify a token ID from Create listing.'}
                </EmptyState>
              )}
              {account.nextPositionsCursor && (
                <button
                  type="button"
                  className="button secondary"
                  disabled={loading}
                  onClick={onMore}
                >
                  {loading ? 'Loading…' : 'Load more positions'}
                </button>
              )}
            </>
          ) : (
            <div className="row-list">
              {tab === 'archive' && (
                <p className="form-hint">
                  These are records from an earlier lending design. They were
                  never funded and are retained only for reference and
                  cancellation. They are not vault balances or credit lines.
                </p>
              )}
              {records.map((record) => {
                const active =
                  record.status === 'active' || record.status === 'proposed';
                const mine =
                  ('owner' in record
                    ? record.owner
                    : record.lender
                  ).toLowerCase() === account.address.toLowerCase();
                return (
                  <article
                    className="portfolio-item record-row"
                    key={record.id}
                  >
                    <div className="list-row-main">
                      <h3>
                        {'tokenId' in record
                          ? `veKITTEN #${record.tokenId}`
                          : 'Previous unfunded offer'}
                      </h3>
                      <p className="text-muted">
                        {usdc(
                          'priceMicros' in record
                            ? record.priceMicros
                            : record.principalMicros,
                        )}{' '}
                        · expires {dateLabel(record.expiresAt)}
                        {'aprBps' in record &&
                          ` · ${record.aprBps / 100}% APR · ${record.durationDays} days`}
                      </p>
                    </div>
                    <span
                      className={`pill status-badge ${active ? 'accent' : 'muted'}`}
                    >
                      {record.status}
                    </span>
                    {active && mine && (
                      <button
                        type="button"
                        className="button ghost small"
                        onClick={() =>
                          onCancel(
                            'priceMicros' in record
                              ? 'listing'
                              : 'tokenId' in record
                                ? 'request'
                                : 'offer',
                            record,
                          )
                        }
                      >
                        Cancel record
                      </button>
                    )}
                  </article>
                );
              })}
              {!records.length && (
                <EmptyState icon={Tag} compact title="No records yet.">
                  Saved records and their status will appear here.
                </EmptyState>
              )}
            </div>
          )}
        </TabPanel>
      </div>
      <div className="dialog-footer">
        <button
          type="button"
          className="button secondary"
          disabled={loading}
          onClick={onRefresh}
        >
          Refresh account
        </button>
        <button type="button" className="button secondary" onClick={onSignOut}>
          Sign out
        </button>
      </div>
    </Dialog>
  );
}
