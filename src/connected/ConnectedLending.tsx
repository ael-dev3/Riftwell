import {
  ArrowUpRight,
  ChevronDown,
  CircleHelp,
  Clock3,
  Layers3,
  RefreshCcw,
  Vote,
  Wallet,
} from 'lucide-react';
import { useState } from 'react';
import { useMinuteClock } from '../app/clock';
import Dialog from '../components/Dialog';
import { EmptyState, PageHead } from '../components/page';
import { Notice } from '../components/ui/Bits';
import StatCard from '../components/ui/StatCard';
import { TabPanel, Tabs } from '../components/ui/Tabs';
import { epochAt, formatFlip } from '../epoch';
import type { Market } from '../markets';
import type { Account, LendingStatus, Position } from './api';
import { dateLabel, kitten } from './amounts';
import { PositionSummary } from './RecordDialogs';

type Tab = 'positions' | 'vote' | 'activity';

function LaunchNotice({ status }: { status: LendingStatus | null }) {
  return (
    <div className="notice" role="status">
      <p>
        {status
          ? 'Lending has not launched yet.'
          : 'Lending status unavailable. Refresh to retry.'}
      </p>
    </div>
  );
}

type BorrowProps = {
  market: Market;
  status: LendingStatus | null;
  account: Account | null;
  signedIn: boolean;
  loading: boolean;
  onAccount: () => void;
  onInspect: (position: Position) => void;
};

export function ConnectedBorrow({
  market,
  status,
  account,
  signedIn,
  loading,
  onAccount,
  onInspect,
}: BorrowProps) {
  const [tab, setTab] = useState<Tab>('positions');
  const now = useMinuteClock();
  const clock = epochAt(now);
  return (
    <>
      <PageHead compact title={`Borrow against ${market.positionSymbol}`} />
      <LaunchNotice status={status} />
      <section className="stat-grid null-stats" aria-label="Vault overview">
        <StatCard
          index={0}
          label="Collateral credit limit"
          value="—"
          sub="Published at launch"
        />
        <StatCard
          index={1}
          tone="violet"
          label="Outstanding debt"
          value="—"
          sub="No funded loans"
        />
        <StatCard
          index={2}
          tone="sky"
          label="Available to borrow"
          value="—"
          sub="Vault not deployed"
        />
      </section>
      <section className="workspace-card" aria-label="Borrowing workspace">
        <Tabs<Tab>
          idBase="borrow"
          label="Borrowing views"
          active={tab}
          onChange={setTab}
          items={[
            {
              id: 'positions',
              label: 'Positions',
              count: account?.positions.length,
            },
            { id: 'vote', label: 'Vote' },
            { id: 'activity', label: 'Activity' },
          ]}
        />
        {tab === 'positions' && (
          <TabPanel idBase="borrow" id="positions">
            <section className="credit-card" aria-labelledby="credit-title">
              <header className="credit-head">
                <span className="token-badge" aria-hidden="true">
                  $
                </span>
                <div>
                  <h2 id="credit-title">USDC credit line</h2>
                  <p>Pooled {market.name} vault · terms published at launch</p>
                </div>
                <span className="pill muted">Not launched</span>
              </header>
              <dl className="credit-metrics">
                <div>
                  <dt>Credit limit</dt>
                  <dd>—</dd>
                </div>
                <div>
                  <dt>Borrowed</dt>
                  <dd>—</dd>
                </div>
                <div>
                  <dt>Available to borrow</dt>
                  <dd>—</dd>
                </div>
                <div>
                  <dt>Vault liquidity</dt>
                  <dd>—</dd>
                </div>
              </dl>
              <div className="credit-actions">
                <button type="button" className="button primary" disabled>
                  Borrow USDC
                </button>
                <button type="button" className="button secondary" disabled>
                  Repay
                </button>
              </div>
            </section>
            <section className="positions-block" aria-labelledby="wallet-title">
              <div className="block-head">
                <h3 id="wallet-title">
                  <Wallet size={17} aria-hidden="true" /> Your positions
                </h3>
                <button
                  type="button"
                  className="button secondary small"
                  onClick={onAccount}
                >
                  {signedIn
                    ? 'View your positions'
                    : 'Sign in to view positions'}
                  <ArrowUpRight size={14} aria-hidden="true" />
                </button>
              </div>
              {account?.positionsUnavailable ? (
                <p className="form-hint">
                  Confirmed position data is unavailable. Refresh your account
                  when the chain connection returns.
                </p>
              ) : account?.positions.length ? (
                <div className="position-list">
                  {account.positions.map((position) => (
                    <article
                      className="position-row wallet-position"
                      key={position.id}
                    >
                      <div className="position-main">
                        <div>
                          <h4>veKITTEN #{position.tokenId}</h4>
                          <p>
                            {kitten(position.lockedAmountRaw)} · unlocks{' '}
                            {dateLabel(position.lockedUntil)}
                          </p>
                        </div>
                      </div>
                      <p className="text-muted">
                        In your wallet · not deposited
                      </p>
                      <div className="position-actions">
                        <button
                          type="button"
                          className="button secondary small"
                          onClick={() => onInspect(position)}
                        >
                          View collateral
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <EmptyState
                  icon={Layers3}
                  compact
                  title={
                    loading
                      ? 'Loading positions…'
                      : signedIn
                        ? 'No wallet positions loaded.'
                        : 'Your positions belong here.'
                  }
                >
                  Sign in to inspect wallet ownership. A wallet position is not
                  deposited collateral or an approved credit limit.
                </EmptyState>
              )}
            </section>
            <section
              className="positions-block"
              aria-labelledby="relayer-title"
            >
              <div className="block-head">
                <h3 id="relayer-title">
                  <RefreshCcw size={17} aria-hidden="true" /> Reward relayer
                </h3>
                <span className="pill muted">Not launched</span>
              </div>
              <EmptyState
                icon={RefreshCcw}
                title="Automated reward collection, no borrowing."
                compact
              >
                The relayer launches with the lending contracts. Positions added
                to it will have their rewards collected each epoch and paid to
                you, without opening a credit line. Merging positions and
                increasing locks open at the same time.
              </EmptyState>
            </section>
            <details className="faq-item">
              <summary>
                <span>How pooled lending works</span>
                <ChevronDown size={18} aria-hidden="true" />
              </summary>
              <div className="faq-answer">
                <p>
                  Borrowers deposit eligible revenue-generating collateral and
                  draw USDC from the shared vault. The credit limit depends on
                  verified reward history and the protocol’s configured policy.
                  Available borrowing also depends on existing debt and vault
                  headroom.
                </p>
                <p>
                  Collateral rewards are processed each epoch. A portion can
                  repay debt, with configured revenue shares for lenders and the
                  protocol. Borrowers can also repay manually. The epoch is a
                  reward cycle; there is no negotiated loan APR or fixed
                  maturity.
                </p>
              </div>
            </details>
          </TabPanel>
        )}
        {tab === 'vote' && (
          <TabPanel idBase="borrow" id="vote">
            <EmptyState
              icon={Vote}
              title="Voting arrives with the lending launch."
            >
              Deposited collateral will vote each epoch to earn the rewards that
              repay credit. Epoch {clock.period} flips {formatFlip(clock.endMs)}
              .
            </EmptyState>
          </TabPanel>
        )}
        {tab === 'activity' && (
          <TabPanel idBase="borrow" id="activity">
            <EmptyState icon={Clock3} title="No lending activity yet.">
              Funded draws, repayments and reward processing appear here after
              launch. Earlier unfunded records stay in your account history.
            </EmptyState>
          </TabPanel>
        )}
      </section>
    </>
  );
}

export function ConnectedEarn({
  market,
  status,
  onDetails,
}: {
  market: Market;
  status: LendingStatus | null;
  onDetails: () => void;
}) {
  return (
    <>
      <PageHead compact title="Earn from collateral revenue" />
      <LaunchNotice status={status} />
      <section className="vault-card" aria-labelledby="vault-title">
        <header className="vault-head">
          <span className="token-badge" aria-hidden="true">
            $
          </span>
          <div className="vault-name">
            <h2 id="vault-title">{market.name} USDC vault</h2>
            <p>
              <span className="badge-inline">
                <span className="chain-dot" aria-hidden="true" />
                {market.chain} · shared liquidity · variable yield
              </span>
            </p>
          </div>
          <div className="vault-yield">
            <span className="pill muted">Not launched</span>
          </div>
        </header>
        <dl className="vault-metrics">
          <div>
            <dt>Historical lender APR</dt>
            <dd>—</dd>
          </div>
          <div>
            <dt>Vault assets</dt>
            <dd>—</dd>
          </div>
          <div>
            <dt>Your share value</dt>
            <dd>—</dd>
          </div>
          <div>
            <dt>Withdrawable now</dt>
            <dd>—</dd>
          </div>
        </dl>
        <footer className="vault-foot">
          <button
            type="button"
            className="button ghost small"
            onClick={onDetails}
          >
            <CircleHelp size={15} aria-hidden="true" /> How it works
          </button>
          <span className="vault-foot-actions">
            <button type="button" className="button secondary" disabled>
              Withdraw
            </button>
            <button type="button" className="button primary" disabled>
              Supply USDC
            </button>
          </span>
        </footer>
      </section>
    </>
  );
}

export function CollateralReview({
  position,
  onClose,
}: {
  position: Position;
  onClose: () => void;
}) {
  return (
    <Dialog
      title={`veKITTEN #${position.tokenId}`}
      kicker="COLLATERAL REVIEW"
      onClose={onClose}
    >
      <div className="dialog-body">
        <PositionSummary position={position} />
        <p className="panel-text">
          Ownership is verified at the displayed block. Reward history,
          collateral eligibility and available credit must be verified by the
          lending protocol before this position can back a loan.
        </p>
        <Notice>
          The lending contracts have not launched. This review does not deposit
          or transfer your NFT.
        </Notice>
      </div>
      <div className="dialog-footer">
        <button className="button secondary" onClick={onClose}>
          Back to lending
        </button>
        <button className="button primary" disabled>
          Add collateral unavailable
        </button>
      </div>
    </Dialog>
  );
}
