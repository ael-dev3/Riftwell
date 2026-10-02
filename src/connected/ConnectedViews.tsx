import { useMemo, useState } from 'react';
import { ArrowUpRight, Search } from 'lucide-react';
import type { Account, Listing, LoanRequest, Offer, Position } from './api';
import { dateLabel, kitten, shortAddress, usdc } from './amounts';
import Dialog from '../components/Dialog';
import { PositionSummary } from './RecordDialogs';

export const positionArt = (tokenId: string) =>
  `${import.meta.env.BASE_URL}artwork-${Number(BigInt(tokenId) % 6n)}.svg`;

export function PublicListings({
  items,
  loading,
  onReview,
}: {
  items: Listing[];
  loading: boolean;
  onReview: (listing: Listing) => void;
}) {
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
  return (
    <>
      <div className="market-toolbar">
        <div className="search-field">
          <Search size={18} aria-hidden="true" />
          <label className="sr-only" htmlFor="live-search">
            Search loaded listings by token ID or owner
          </label>
          <input
            id="live-search"
            type="search"
            placeholder="Search token ID or owner"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="filter-field">
          <label className="sr-only" htmlFor="live-sort">
            Sort listings
          </label>
          <select
            id="live-sort"
            className="filter-control"
            value={sort}
            onChange={(event) => setSort(event.target.value)}
          >
            <option value="newest">Newest listings</option>
            <option value="low">Ask: low to high</option>
            <option value="high">Ask: high to low</option>
          </select>
        </div>
      </div>
      <p className="form-hint">
        Search and sorting apply to the loaded listings.
      </p>
      {results.length ? (
        <div className="asset-grid">
          {results.map((listing) => (
            <article className="asset-card" key={listing.id}>
              <button
                className="asset-image"
                aria-label={`Review veKITTEN #${listing.tokenId}`}
                onClick={() => onReview(listing)}
              >
                <img
                  src={positionArt(listing.tokenId)}
                  width={640}
                  height={640}
                  loading="lazy"
                  alt={`Decorative portal illustration for veKITTEN #${listing.tokenId}`}
                />
                <span className="asset-image-overlay">
                  <span className="asset-kind">Off-chain listing</span>
                  <ArrowUpRight size={19} aria-hidden="true" />
                </span>
              </button>
              <div className="asset-info">
                <p className="asset-collection">
                  KittenSwap<span className="asset-edition">VERIFIED READ</span>
                </p>
                <h3 className="asset-title">
                  <button onClick={() => onReview(listing)}>
                    veKITTEN #{listing.tokenId}
                  </button>
                </h3>
                <div className="position-meta">
                  <div className="position-stat">
                    <span>Locked balance</span>
                    <strong>{kitten(listing.position.lockedAmountRaw)}</strong>
                  </div>
                  <div className="position-stat">
                    <span>Unlocks</span>
                    <strong>{dateLabel(listing.position.lockedUntil)}</strong>
                  </div>
                </div>
                <div className="asset-meta">
                  <div className="asset-price">
                    <span>Ask price</span>
                    <strong>{usdc(listing.priceMicros)}</strong>
                  </div>
                  <button
                    className="button secondary"
                    onClick={() => onReview(listing)}
                  >
                    Review <ArrowUpRight size={14} aria-hidden="true" />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <h3>
            {loading
              ? 'Loading listings…'
              : query
                ? 'No matching listings.'
                : 'No active listings.'}
          </h3>
          <p>
            {query
              ? 'Try another token ID or owner address.'
              : 'Create an off-chain listing from a position you own.'}
          </p>
        </div>
      )}
    </>
  );
}

export function PublicRequests({
  items,
  address,
  loading,
  onOffer,
}: {
  items: LoanRequest[];
  address?: string;
  loading: boolean;
  onOffer: (request: LoanRequest) => void;
}) {
  return (
    <div className="lending-table-wrap">
      <table className="lending-table">
        <caption className="sr-only">
          Active unfunded borrowing requests
        </caption>
        <thead>
          <tr>
            <th scope="col">Position</th>
            <th scope="col">Requested amount</th>
            <th scope="col">Duration</th>
            <th scope="col">APR</th>
            <th scope="col">
              <span className="sr-only">Action</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((request) => (
            <tr key={request.id}>
              <td>
                <div className="row-asset">
                  <img
                    className="row-thumb"
                    src={positionArt(request.tokenId)}
                    width={52}
                    height={52}
                    alt=""
                  />
                  <div>
                    <strong>veKITTEN #{request.tokenId}</strong>
                    <span>Unfunded request</span>
                  </div>
                </div>
              </td>
              <td>
                <span className="mobile-label">Requested</span>
                {usdc(request.principalMicros)}
              </td>
              <td>
                <span className="mobile-label">Duration</span>
                {request.durationDays} days
              </td>
              <td>
                <span className="rate-pill">{request.aprBps / 100}%</span>
              </td>
              <td className="table-actions">
                <button
                  className="button secondary"
                  disabled={
                    address?.toLowerCase() === request.owner.toLowerCase()
                  }
                  onClick={() => onOffer(request)}
                >
                  {address?.toLowerCase() === request.owner.toLowerCase()
                    ? 'Your request'
                    : 'Make offer'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!items.length && (
        <div className="empty-state">
          <h3>{loading ? 'Loading requests…' : 'No active requests.'}</h3>
          <p>Borrowing requests and lending offers remain unfunded.</p>
        </div>
      )}
    </div>
  );
}

type AccountProps = {
  account: Account | null;
  loading: boolean;
  onClose: () => void;
  onRefresh: () => void;
  onMore: () => void;
  onList: (position: Position) => void;
  onBorrow: (position: Position) => void;
  onCancel: (
    kind: 'listing' | 'request' | 'offer',
    record: Listing | LoanRequest | Offer,
  ) => void;
  onSignOut: () => void;
  onReviewOffer: (offer: Offer, request?: LoanRequest) => void;
};

export function ConnectedAccount({
  account,
  loading,
  onClose,
  onRefresh,
  onMore,
  onList,
  onBorrow,
  onCancel,
  onSignOut,
  onReviewOffer,
}: AccountProps) {
  const [tab, setTab] = useState<
    'positions' | 'listings' | 'loanRequests' | 'offers' | 'receivedOffers'
  >('positions');
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
            history is retained by the service.
          </p>
        )}
        <div
          className="segmented-control portfolio-tabs"
          aria-label="Account view"
        >
          {(
            [
              'positions',
              'listings',
              'loanRequests',
              'offers',
              'receivedOffers',
            ] as const
          ).map((value) => (
            <button
              key={value}
              className={tab === value ? 'active' : ''}
              aria-pressed={tab === value}
              onClick={() => setTab(value)}
            >
              {value === 'loanRequests'
                ? 'Requests'
                : value === 'offers'
                  ? 'Sent offers'
                  : value === 'receivedOffers'
                    ? 'Received offers'
                    : value[0].toUpperCase() + value.slice(1)}
            </button>
          ))}
        </div>
        {!account ? (
          <div className="empty-state">
            <h3>
              {loading ? 'Loading your account…' : 'Account unavailable.'}
            </h3>
            <button className="button secondary" onClick={onRefresh}>
              Retry
            </button>
          </div>
        ) : tab === 'positions' ? (
          <>
            <div className="portfolio-list">
              {account.positions.map((position) => (
                <article
                  key={position.id}
                  className="portfolio-item connected-position"
                >
                  <h3>veKITTEN #{position.tokenId}</h3>
                  <PositionSummary position={position} />
                  <div className="asset-actions">
                    <button
                      className="button secondary"
                      onClick={() => onList(position)}
                    >
                      Create listing
                    </button>
                    <button
                      className="button secondary"
                      onClick={() => onBorrow(position)}
                    >
                      Request loan
                    </button>
                  </div>
                </article>
              ))}
            </div>
            {!account.positions.length && (
              <div className="empty-state">
                <h3>
                  {account.positionsUnavailable
                    ? 'Position data unavailable.'
                    : 'No positions found.'}
                </h3>
                <p>
                  {account.positionsUnavailable
                    ? 'Refresh your account when chain access returns. Your off-chain records remain in the other account views.'
                    : 'You can verify a token ID from Create listing or Borrowing request.'}
                </p>
              </div>
            )}
            {account.nextPositionsCursor && (
              <button
                className="button secondary"
                disabled={loading}
                onClick={onMore}
              >
                {loading ? 'Loading…' : 'Load more positions'}
              </button>
            )}
          </>
        ) : (
          <div className="portfolio-list">
            {account[tab].map((record) => (
              <article className="portfolio-item" key={record.id}>
                <div className="portfolio-item-main">
                  <div className="portfolio-item-copy">
                    <h3>
                      {'tokenId' in record
                        ? `veKITTEN #${record.tokenId}`
                        : 'Unfunded lending offer'}
                    </h3>
                    <p className="text-muted">
                      {usdc(
                        'priceMicros' in record
                          ? record.priceMicros
                          : record.principalMicros,
                      )}
                    </p>
                    <span
                      className={`status-pill${record.status !== 'active' && record.status !== 'proposed' ? ' muted' : ''}`}
                    >
                      {record.status}
                    </span>
                    {tab === 'receivedOffers' && 'lender' in record && (
                      <p className="text-muted">
                        From {shortAddress(record.lender)} ·{' '}
                        {account.loanRequests.find(
                          (request) => request.id === record.requestId,
                        )?.tokenId
                          ? `veKITTEN #${account.loanRequests.find((request) => request.id === record.requestId)!.tokenId}`
                          : `Request ${record.requestId.slice(0, 8)}`}
                      </p>
                    )}
                  </div>
                  <div className="portfolio-item-value">
                    <span className="text-muted">
                      Expires {dateLabel(record.expiresAt)}
                    </span>
                    {'aprBps' in record && (
                      <span>
                        {record.aprBps / 100}% APR · {record.durationDays} days
                      </span>
                    )}
                  </div>
                </div>
                {tab === 'receivedOffers' && 'lender' in record && (
                  <button
                    className="inline-link cancellation-link"
                    onClick={() =>
                      onReviewOffer(
                        record,
                        account.loanRequests.find(
                          (request) => request.id === record.requestId,
                        ),
                      )
                    }
                  >
                    Review offer
                  </button>
                )}
                {tab !== 'receivedOffers' &&
                  (record.status === 'active' ||
                    record.status === 'proposed') && (
                    <button
                      className="inline-link cancellation-link"
                      onClick={() =>
                        onCancel(
                          tab === 'listings'
                            ? 'listing'
                            : tab === 'loanRequests'
                              ? 'request'
                              : 'offer',
                          record,
                        )
                      }
                    >
                      Cancel{' '}
                      {tab === 'listings'
                        ? 'listing'
                        : tab === 'loanRequests'
                          ? 'request'
                          : 'offer'}
                    </button>
                  )}
              </article>
            ))}
            {!account[tab].length && (
              <div className="empty-state">
                <h3>No records yet.</h3>
                <p>Saved records and their status will appear here.</p>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="dialog-footer">
        <button
          className="button secondary"
          disabled={loading}
          onClick={onRefresh}
        >
          Refresh account
        </button>
        <button className="button secondary" onClick={onSignOut}>
          Sign out
        </button>
      </div>
    </Dialog>
  );
}
