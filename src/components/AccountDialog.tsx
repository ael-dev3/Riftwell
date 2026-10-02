import { ArrowRight, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import {
  ALL_MARKET_ASSETS,
  COLLATERAL,
  COLLATERAL_LIMITS,
  collateralLimitMicros,
} from '../data';
import { formatDate, formatMicros, microsToDecimal } from '../domain';
import { getLendingMetrics, type LendingState } from '../lending';
import Dialog from './Dialog';
import { PREVIEW_ADDRESS, type MarketplaceState } from '../marketplace';
import { activityLabel, type LendingAction, type LendingTab } from './Lending';

export type AccountTab = 'purchase' | 'borrow' | 'lend';
type Props = {
  marketplace: MarketplaceState;
  lending: LendingState;
  onClose: () => void;
  onReset: () => void;
  onAction: (action: LendingAction) => void;
  onExplore: (
    section: 'marketplace' | 'lending',
    lendingTab?: LendingTab,
  ) => void;
  initialTab?: AccountTab | undefined;
};

export default function AccountDialog({
  marketplace,
  lending,
  onClose,
  onReset,
  onAction,
  onExplore,
  initialTab = 'purchase',
}: Props) {
  const [tab, setTab] = useState<AccountTab>(initialTab);
  const metrics = getLendingMetrics(lending, COLLATERAL_LIMITS);
  const owned = ALL_MARKET_ASSETS.filter(
    (asset) =>
      marketplace.ownerByAsset[asset.id]?.toLowerCase() ===
      PREVIEW_ADDRESS.toLowerCase(),
  );
  return (
    <Dialog
      title="Preview account"
      kicker="SAVED IN THIS BROWSER"
      onClose={onClose}
      wide
    >
      <div className="dialog-body pooled-account">
        <div className="portfolio-summary">
          <div>
            <strong>{owned.length.toString().padStart(2, '0')}</strong>
            <span>Marketplace positions</span>
          </div>
          <div>
            <strong>
              {lending.collateralIds.length.toString().padStart(2, '0')}
            </strong>
            <span>Collateral positions</span>
          </div>
          <div>
            <strong>
              {BigInt(lending.shareBalanceRaw) > 0n ? '01' : '00'}
            </strong>
            <span>Vault positions</span>
          </div>
        </div>
        <p className="form-hint">
          Local simulations, not real ownership, custody or funds. Marketplace
          balance: {formatMicros(marketplace.balanceMicros)}. Lending balance:{' '}
          {formatMicros(lending.walletMicros)}.
        </p>
        <div
          className="segmented-control portfolio-tabs"
          aria-label="Account view"
        >
          {(['purchase', 'borrow', 'lend'] as const).map((view) => (
            <button
              key={view}
              className={tab === view ? 'active' : ''}
              onClick={() => setTab(view)}
              aria-pressed={tab === view}
            >
              {view === 'purchase'
                ? 'Positions'
                : view === 'borrow'
                  ? 'Borrowing'
                  : 'Vault'}
            </button>
          ))}
        </div>
        {tab === 'purchase' && (
          <div className="portfolio-list">
            {owned.map((asset) => (
              <article className="portfolio-item" key={asset.id}>
                <div className="portfolio-item-main">
                  <div>
                    <strong>veKITTEN #{asset.positionId}</strong>
                    <span>
                      {asset.underlyingBalance.toLocaleString('en-GB')} KITTEN ·
                      unlocks {formatDate(asset.unlockDate)}
                    </span>
                  </div>
                </div>
                <span className="status-pill">Preview owned</span>
              </article>
            ))}
            <button
              className="button secondary"
              onClick={() => onExplore('marketplace')}
            >
              Manage marketplace <ArrowRight size={16} aria-hidden="true" />
            </button>
          </div>
        )}
        {tab === 'borrow' && (
          <>
            <div className="pooled-summary pooled-account-metrics">
              <div>
                <span>Borrowed</span>
                <strong>{formatMicros(lending.debtMicros)}</strong>
              </div>
              <div>
                <span>Credit limit</span>
                <strong>{formatMicros(metrics.totalCreditMicros)}</strong>
              </div>
              <div>
                <span>Available credit</span>
                <strong>{formatMicros(metrics.availableCreditMicros)}</strong>
              </div>
            </div>
            {lending.collateralIds.length ? (
              <div className="portfolio-list">
                {COLLATERAL.filter((asset) =>
                  lending.collateralIds.includes(asset.id),
                ).map((asset) => (
                  <article className="portfolio-item" key={asset.id}>
                    <div className="portfolio-item-main">
                      <img
                        className="row-thumb"
                        src={asset.artwork}
                        alt=""
                        width="52"
                        height="52"
                      />
                      <div>
                        <strong>{asset.name}</strong>
                        <span>Demo collateral · {asset.lockTerm} lock</span>
                      </div>
                    </div>
                    <div className="portfolio-item-value">
                      <strong>
                        {formatMicros(collateralLimitMicros(asset.id))}
                      </strong>
                      <span>Example credit</span>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <h3>No collateral deposited.</h3>
                <p>Deposit a sample position before drawing USDC.</p>
              </div>
            )}
            <div className="pooled-actions">
              <button
                className="button secondary"
                onClick={() => onExplore('lending', 'borrow')}
              >
                Manage collateral
              </button>
              <button
                className="button primary"
                disabled={
                  BigInt(lending.debtMicros) === 0n ||
                  BigInt(lending.walletMicros) === 0n
                }
                onClick={() => onAction({ kind: 'repay' })}
              >
                Repay in preview
              </button>
            </div>
          </>
        )}
        {tab === 'lend' && (
          <>
            <div className="pooled-summary pooled-account-metrics">
              <div>
                <span>Supplied value</span>
                <strong>{formatMicros(metrics.suppliedAssetsMicros)}</strong>
              </div>
              <div>
                <span>Vault shares</span>
                <strong>{microsToDecimal(lending.shareBalanceRaw)}</strong>
              </div>
              <div>
                <span>Available withdrawal</span>
                <strong>{formatMicros(metrics.maxWithdrawMicros)}</strong>
              </div>
            </div>
            <p className="form-hint">
              A share of the illustrative pooled USDC vault. Available
              withdrawals depend on liquid funds; rewards can vary or be zero.
            </p>
            <div className="pooled-actions">
              <button
                className="button secondary"
                disabled={BigInt(metrics.maxWithdrawMicros) === 0n}
                onClick={() => onAction({ kind: 'withdraw' })}
              >
                Withdraw in preview
              </button>
              <button
                className="button primary"
                onClick={() => onExplore('lending', 'lend')}
              >
                Open vault <ArrowRight size={16} aria-hidden="true" />
              </button>
            </div>
          </>
        )}
        {tab !== 'purchase' && lending.activity.length > 0 && (
          <section
            className="pooled-activity"
            aria-labelledby="account-activity-title"
          >
            <h3 id="account-activity-title">Recent lending activity</h3>
            {lending.activity
              .slice(-5)
              .reverse()
              .map((entry) => (
                <div className="pooled-activity-row" key={entry.id}>
                  <div>
                    <strong>{activityLabel[entry.kind]}</strong>
                    <span>{formatDate(entry.createdAt)}</span>
                  </div>
                  <strong>
                    {entry.kind === 'epoch'
                      ? `Epoch reward applied`
                      : BigInt(entry.amountMicros) > 0n
                        ? formatMicros(entry.amountMicros)
                        : 'Preview only'}
                  </strong>
                </div>
              ))}
          </section>
        )}
      </div>
      <div className="dialog-footer">
        <button
          className="button ghost"
          disabled={
            marketplace.history.length === 0 && lending.activity.length === 0
          }
          onClick={onReset}
        >
          <RotateCcw size={15} aria-hidden="true" /> Reset preview
        </button>
        <button className="button secondary" onClick={onClose}>
          Done
        </button>
      </div>
    </Dialog>
  );
}
