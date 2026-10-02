import { useState } from 'react';
import type { Account, Listing, LoanRequest, Offer, Position } from './api';
import { dateLabel, usdc } from './amounts';
import Dialog from '../components/Dialog';
import { PositionSummary } from './RecordDialogs';

export const positionArt = (tokenId: string) =>
  `${import.meta.env.BASE_URL}artwork-${Number(BigInt(tokenId) % 6n)}.svg`;

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
  const [tab, setTab] = useState<'positions' | 'listings' | 'archive'>(
    'positions',
  );
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
        <div
          className="segmented-control portfolio-tabs"
          aria-label="Account view"
        >
          {(['positions', 'listings', 'archive'] as const)
            .filter(
              (value) =>
                value !== 'archive' ||
                (!!account &&
                  account.loanRequests.length +
                    account.offers.length +
                    account.receivedOffers.length >
                    0),
            )
            .map((value) => (
              <button
                key={value}
                className={tab === value ? 'active' : ''}
                aria-pressed={tab === value}
                onClick={() => setTab(value)}
              >
                {value === 'archive'
                  ? 'Previous records'
                  : value.charAt(0).toUpperCase() + value.slice(1)}
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
                    : 'You can verify a token ID from Create listing.'}
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
            {tab === 'archive' && (
              <p className="form-hint">
                These are records from an earlier lending design. They were
                never funded and are retained only for reference and
                cancellation. They are not vault balances or credit lines.
              </p>
            )}
            {(tab === 'listings'
              ? account.listings
              : [
                  ...account.loanRequests,
                  ...account.offers,
                  ...account.receivedOffers,
                ]
            ).map((record) => (
              <article className="portfolio-item" key={record.id}>
                <div className="portfolio-item-main">
                  <div className="portfolio-item-copy">
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
                      )}
                    </p>
                    <span
                      className={`status-pill${record.status !== 'active' && record.status !== 'proposed' ? ' muted' : ''}`}
                    >
                      {record.status}
                    </span>
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
                {record.status === 'active' || record.status === 'proposed'
                  ? ('owner' in record
                      ? record.owner
                      : record.lender
                    ).toLowerCase() === account.address.toLowerCase() && (
                      <button
                        className="inline-link cancellation-link"
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
                    )
                  : null}
              </article>
            ))}
            {!(
              tab === 'listings'
                ? account.listings
                : [
                    ...account.loanRequests,
                    ...account.offers,
                    ...account.receivedOffers,
                  ]
            ).length && (
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
