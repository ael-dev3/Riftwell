import { Store, Tag } from 'lucide-react';
import { useState } from 'react';
import Dialog from '../components/Dialog';
import { EmptyState } from '../components/page';
import { TabPanel, Tabs } from '../components/ui/Tabs';
import type { Account, Listing, LoanRequest, Offer, Position } from './api';
import { dateLabel, usdc } from './amounts';
import { PositionSummary } from './RecordDialogs';

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
