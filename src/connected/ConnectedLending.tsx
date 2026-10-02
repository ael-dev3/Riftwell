import { ArrowUpRight, Layers3, Vault } from 'lucide-react';
import type { Account, LendingStatus, Position } from './api';
import { kitten, dateLabel } from './amounts';
import Dialog from '../components/Dialog';
import { PositionSummary } from './RecordDialogs';

type Props = {
  status: LendingStatus | null;
  tab: 'borrow' | 'lend';
  onTab: (tab: 'borrow' | 'lend') => void;
  account: Account | null;
  signedIn: boolean;
  loading: boolean;
  onAccount: () => void;
  onInspect: (position: Position) => void;
};

export function ConnectedLending({
  status,
  tab,
  onTab,
  account,
  signedIn,
  loading,
  onAccount,
  onInspect,
}: Props) {
  const borrowing = tab === 'borrow';
  return (
    <>
      <div className="section-heading">
        <div>
          <p className="section-eyebrow">veKITTEN LENDING</p>
          <h1 className="section-title">
            {borrowing ? 'Let your position work.' : 'Supply the shared vault.'}
          </h1>
          <p className="section-description">
            {borrowing
              ? 'Collateral earns rewards. Rewards help repay your USDC credit line.'
              : 'Supply USDC, receive vault shares and earn a variable share of collateral revenue.'}
          </p>
        </div>
        <div
          className="segmented-control lending-tabs"
          aria-label="Lending view"
        >
          <button
            className={borrowing ? 'active' : ''}
            aria-pressed={borrowing}
            onClick={() => onTab('borrow')}
          >
            Borrow
          </button>
          <button
            className={!borrowing ? 'active' : ''}
            aria-pressed={!borrowing}
            onClick={() => onTab('lend')}
          >
            Lend
          </button>
        </div>
      </div>
      <div className="notice" role="status">
        <p>
          {status
            ? 'Lending has not launched yet. Vault balances, borrowing limits and reward terms will appear after the contracts are deployed.'
            : 'Lending status is unavailable. Refresh the service to check launch availability.'}
        </p>
      </div>
      <dl className="pooled-summary">
        {(borrowing
          ? [
              'Collateral credit limit',
              'Outstanding debt',
              'Available to borrow',
            ]
          : ['Vault assets', 'Active loans', 'Available liquidity']
        ).map((label) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>—</dd>
          </div>
        ))}
      </dl>
      {borrowing ? (
        <div className="pooled-panel">
          <div className="pooled-panel-header">
            <div>
              <h3>
                <Layers3 size={20} aria-hidden="true" /> Your collateral
              </h3>
              <p>
                Add eligible veKITTEN positions to a portfolio. Borrowing is a
                separate action.
              </p>
            </div>
            <button className="button secondary" onClick={onAccount}>
              {signedIn ? 'View your positions' : 'Sign in to view positions'}
              <ArrowUpRight size={15} aria-hidden="true" />
            </button>
          </div>
          <div className="pooled-actions">
            <button className="button primary" disabled>
              Borrow USDC
            </button>
            <button className="button secondary" disabled>
              Repay
            </button>
          </div>
          {account?.positionsUnavailable ? (
            <p className="form-hint">
              Confirmed position data is unavailable. Refresh your account when
              the chain connection returns.
            </p>
          ) : account?.positions.length ? (
            <div className="pooled-collateral-list">
              {account.positions.map((position) => (
                <article className="pooled-position" key={position.id}>
                  <div className="pooled-position-data">
                    <h4>veKITTEN #{position.tokenId}</h4>
                    <p>
                      {kitten(position.lockedAmountRaw)} · unlocks{' '}
                      {dateLabel(position.lockedUntil)}
                    </p>
                    <span className="text-muted">
                      In your wallet · not deposited
                    </span>
                  </div>
                  <button
                    className="button secondary small"
                    onClick={() => onInspect(position)}
                  >
                    View collateral
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <h3>
                {loading
                  ? 'Loading positions…'
                  : signedIn
                    ? 'No wallet positions loaded.'
                    : 'Your positions belong here.'}
              </h3>
              <p>
                Sign in to inspect wallet ownership. A wallet position is not
                deposited collateral or an approved credit limit.
              </p>
            </div>
          )}
        </div>
      ) : (
        <div className="pooled-panel pooled-vault">
          <div className="pooled-panel-header">
            <div>
              <h3>
                <Vault size={20} aria-hidden="true" /> KittenSwap USDC vault
              </h3>
              <p>HyperEVM · shared liquidity · variable yield</p>
            </div>
            <span className="status-pill muted">Not launched</span>
          </div>
          <dl className="pooled-summary">
            <div>
              <dt>Historical lender APR</dt>
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
          <div className="pooled-actions">
            <button className="button primary" disabled>
              Supply USDC
            </button>
            <button className="button secondary" disabled>
              Withdraw
            </button>
          </div>
          <p className="form-hint">
            Vault shares represent your share of cash and outstanding loans.
            Withdrawal is limited by available cash, and may require waiting for
            repayments. No fixed yield is promised.
          </p>
        </div>
      )}
      <details className="pooled-explainer">
        <summary>How pooled lending works</summary>
        <div>
          <p>
            Borrowers deposit eligible revenue-generating collateral and draw
            USDC from the shared vault. The credit limit depends on verified
            reward history and the protocol’s configured policy. Available
            borrowing also depends on existing debt and vault headroom.
          </p>
          <p>
            Collateral rewards are processed each epoch. A portion can repay
            debt, with configured revenue shares for lenders and the protocol.
            Borrowers can also repay manually. The epoch is a reward cycle;
            there is no negotiated loan APR or fixed maturity.
          </p>
          <p>
            Suppliers receive vault shares. Their value changes with realized
            lender revenue. A share’s value can exceed the cash available to
            withdraw immediately. Lower or halted rewards can delay both debt
            recovery and lender withdrawals.
          </p>
        </div>
      </details>
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
        <p>
          Ownership is verified at the displayed block. Reward history,
          collateral eligibility and available credit must be verified by the
          lending protocol before this position can back a loan.
        </p>
        <div className="notice">
          <p>
            The lending contracts have not launched. This review does not
            deposit or transfer your NFT.
          </p>
        </div>
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
