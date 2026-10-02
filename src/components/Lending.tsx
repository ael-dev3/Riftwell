import {
  ArrowDownLeft,
  ArrowUpRight,
  Clock3,
  Info,
  Layers3,
  Plus,
  Wallet,
} from 'lucide-react';
import {
  COLLATERAL,
  COLLATERAL_LIMITS,
  SAMPLE_CREDIT_EPOCHS,
  SAMPLE_REWARD_MICROS,
} from '../data';
import {
  formatBalance,
  formatDate,
  formatMicros,
  microsToDecimal,
  type Asset,
} from '../domain';
import { getLendingMetrics, type LendingState } from '../lending';
import type { Market } from '../markets';

export type LendingTab = 'borrow' | 'lend';
export type LendingAction =
  | { kind: 'deposit-collateral' | 'remove-collateral'; asset: Asset }
  | { kind: 'borrow' | 'repay' | 'supply' | 'withdraw' | 'epoch' | 'how' };

type Props = {
  market: Market;
  tab: LendingTab;
  onTab: (tab: LendingTab) => void;
  state: LendingState;
  onAction: (action: LendingAction) => void;
};

export const activityLabel: Readonly<Record<string, string>> = {
  'deposit-collateral': 'Collateral deposited',
  'remove-collateral': 'Collateral removed',
  borrow: 'USDC borrowed',
  repay: 'Debt repaid',
  supply: 'USDC supplied',
  withdraw: 'USDC withdrawn',
  redeem: 'Shares redeemed',
  epoch: 'Reward epoch simulated',
};

export default function Lending({
  market,
  tab,
  onTab,
  state,
  onAction,
}: Props) {
  const isBorrow = tab === 'borrow';
  const metrics = getLendingMetrics(state, COLLATERAL_LIMITS);
  const deposited = COLLATERAL.filter((asset) =>
    state.collateralIds.includes(asset.id),
  );
  const available = COLLATERAL.filter(
    (asset) => !state.collateralIds.includes(asset.id),
  );
  const canBorrow =
    BigInt(metrics.availableCreditMicros) > 0n &&
    BigInt(state.poolCashMicros) > 0n;
  const utilization = metrics.utilizationBps / 100;
  const currentActivity = state.activity
    .filter((entry) =>
      isBorrow
        ? [
            'borrow',
            'repay',
            'deposit-collateral',
            'remove-collateral',
            'epoch',
          ].includes(entry.kind)
        : ['supply', 'withdraw', 'redeem', 'epoch'].includes(entry.kind),
    )
    .slice(-5)
    .reverse();

  function position(asset: Asset, isDeposited: boolean) {
    const remainingCredit =
      BigInt(metrics.totalCreditMicros) - BigInt(COLLATERAL_LIMITS[asset.id]);
    const canRemove = remainingCredit >= BigInt(state.debtMicros);
    return (
      <article className="pooled-position" key={asset.id}>
        <div className="row-asset">
          <img
            className="row-thumb"
            src={asset.artwork}
            alt=""
            width="52"
            height="52"
          />
          <div>
            <strong>{asset.name}</strong>
            <span>
              {formatBalance(asset.underlyingBalance, asset.underlyingSymbol)} ·{' '}
              {asset.lockTerm} lock
            </span>
          </div>
        </div>
        <div className="pooled-position-data">
          <div>
            <span>Example net reward / epoch</span>
            <strong>{formatMicros(SAMPLE_REWARD_MICROS[asset.id])}</strong>
          </div>
          <div>
            <span>Example credit limit</span>
            <strong>{formatMicros(COLLATERAL_LIMITS[asset.id])}</strong>
          </div>
        </div>
        <div className="pooled-position-action">
          <button
            className="button secondary small"
            disabled={isDeposited && !canRemove}
            aria-describedby={
              isDeposited && !canRemove ? `remove-hint-${asset.id}` : undefined
            }
            onClick={() =>
              onAction({
                kind: isDeposited ? 'remove-collateral' : 'deposit-collateral',
                asset,
              })
            }
          >
            {isDeposited ? 'Remove' : 'Deposit'}
            {isDeposited ? (
              <ArrowUpRight size={14} aria-hidden="true" />
            ) : (
              <Plus size={14} aria-hidden="true" />
            )}
          </button>
          {isDeposited && !canRemove && (
            <span className="form-hint" id={`remove-hint-${asset.id}`}>
              Repay debt to remove.
            </span>
          )}
        </div>
      </article>
    );
  }

  return (
    <>
      <div className="section-heading">
        <div>
          <p className="section-eyebrow">
            {market.positionSymbol} LENDING · PREVIEW
          </p>
          <h2 className="section-title">
            {isBorrow
              ? 'Borrow against your positions.'
              : 'Supply to the USDC vault.'}
          </h2>
          <p className="section-description">
            {isBorrow
              ? 'Deposit collateral, access credit and let example rewards reduce your debt.'
              : 'Pool USDC with other lenders. Your shares track a portion of the vault.'}
          </p>
        </div>
        <div
          className="segmented-control lending-tabs"
          aria-label="Lending view"
        >
          <button
            className={isBorrow ? 'active' : ''}
            onClick={() => onTab('borrow')}
            aria-pressed={isBorrow}
          >
            Borrow
          </button>
          <button
            className={!isBorrow ? 'active' : ''}
            onClick={() => onTab('lend')}
            aria-pressed={!isBorrow}
          >
            Lend
          </button>
        </div>
      </div>
      {isBorrow ? (
        <>
          <div className="pooled-summary" aria-label="Borrowing overview">
            <div>
              <span>Collateral deposited</span>
              <strong>
                {deposited.length} <small>positions</small>
              </strong>
            </div>
            <div>
              <span>Borrowed</span>
              <strong>{formatMicros(state.debtMicros)}</strong>
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
          <div className="pooled-toolbar">
            <p>
              <Wallet size={15} aria-hidden="true" /> Demo balance{' '}
              <strong>{formatMicros(state.walletMicros)}</strong>
            </p>
            <div className="pooled-actions">
              <button
                className="button secondary"
                disabled={
                  BigInt(state.debtMicros) === 0n ||
                  BigInt(state.walletMicros) === 0n
                }
                onClick={() => onAction({ kind: 'repay' })}
              >
                Repay
              </button>
              <button
                className="button primary"
                disabled={!canBorrow}
                onClick={() => onAction({ kind: 'borrow' })}
              >
                Borrow USDC <ArrowUpRight size={16} aria-hidden="true" />
              </button>
            </div>
          </div>
          <section className="pooled-panel" aria-labelledby="collateral-title">
            <div className="pooled-panel-header">
              <div>
                <h3 id="collateral-title">Your collateral</h3>
                <p>Depositing opens credit. It does not create debt.</p>
              </div>
              <Layers3 size={20} aria-hidden="true" />
            </div>
            {deposited.length ? (
              deposited.map((asset) => position(asset, true))
            ) : (
              <div className="pooled-empty">
                <Layers3 size={25} aria-hidden="true" />
                <h3>Start with a position.</h3>
                <p>
                  Deposit a demo position below to open your illustrative credit
                  limit.
                </p>
              </div>
            )}
          </section>
          {available.length > 0 && (
            <section className="pooled-panel" aria-labelledby="available-title">
              <div className="pooled-panel-header">
                <div>
                  <h3 id="available-title">Available to deposit</h3>
                  <p>A separate fictional collateral account.</p>
                </div>
              </div>
              {available.map((asset) => position(asset, false))}
            </section>
          )}
          <div className="pooled-explanation">
            <Info size={17} aria-hidden="true" />
            <p>
              Example credit uses a sample net reward history ×{' '}
              {SAMPLE_CREDIT_EPOCHS} epochs. Borrowing is also limited by
              available vault liquidity. This sample policy is not a live
              valuation.
            </p>
          </div>
          <section
            className="pooled-panel pooled-rewards"
            aria-labelledby="reward-title"
          >
            <div>
              <span className="section-eyebrow">
                REWARD EPOCH {state.epoch}
              </span>
              <h3 id="reward-title">Rewards can repay your balance.</h3>
              <p>
                A 7-day epoch is a reward period, not a repayment deadline. Net
                rewards available for repayment reduce debt first; rewards and
                the time needed to repay can vary.
              </p>
            </div>
            <button
              className="button secondary"
              disabled={!deposited.length}
              onClick={() => onAction({ kind: 'epoch' })}
            >
              <Clock3 size={16} aria-hidden="true" /> Simulate an epoch
            </button>
          </section>
        </>
      ) : (
        <>
          <section
            className="pooled-panel pooled-vault"
            aria-labelledby="vault-title"
          >
            <div className="pooled-panel-header">
              <div className="pooled-vault-name">
                <span className="pooled-token">$</span>
                <div>
                  <h3 id="vault-title">{market.name} USDC vault</h3>
                  <p>Pooled lending · illustrative balances</p>
                </div>
              </div>
              <button
                className="inline-link"
                onClick={() => onAction({ kind: 'how' })}
              >
                How it works <Info size={14} aria-hidden="true" />
              </button>
            </div>
            <div className="pooled-summary pooled-vault-stats">
              <div>
                <span>Total supplied</span>
                <strong>{formatMicros(metrics.totalAssetsMicros)}</strong>
              </div>
              <div>
                <span>Total borrowed</span>
                <strong>{formatMicros(state.poolOutstandingMicros)}</strong>
              </div>
              <div>
                <span>Liquid USDC</span>
                <strong>{formatMicros(state.poolCashMicros)}</strong>
              </div>
              <div>
                <span>Variable yield</span>
                <strong>Scenario only</strong>
              </div>
            </div>
            <div className="pooled-utilization">
              <div>
                <span>Utilization</span>
                <strong>{utilization.toFixed(2)}%</strong>
              </div>
              <div
                className="pooled-progress"
                role="progressbar"
                aria-label="Illustrative vault utilization"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={utilization}
              >
                <span style={{ width: `${Math.min(utilization, 100)}%` }} />
              </div>
            </div>
            <p className="form-hint">
              Yield depends on net revenue received by the vault. No historical
              rate or forecast is provided; returns can vary or be zero.
            </p>
          </section>
          <section
            className="pooled-panel pooled-supply-position"
            aria-labelledby="supply-position-title"
          >
            <div className="pooled-panel-header">
              <div>
                <h3 id="supply-position-title">Your position</h3>
                <p>
                  Share value includes outstanding loan principal. Withdrawals
                  use liquid USDC.
                </p>
              </div>
              <Wallet size={20} aria-hidden="true" />
            </div>
            <div className="pooled-summary">
              <div>
                <span>Supplied value</span>
                <strong>{formatMicros(metrics.suppliedAssetsMicros)}</strong>
              </div>
              <div>
                <span>Vault shares</span>
                <strong>{microsToDecimal(state.shareBalanceRaw)}</strong>
              </div>
              <div>
                <span>Available to withdraw</span>
                <strong>{formatMicros(metrics.maxWithdrawMicros)}</strong>
              </div>
              <div>
                <span>Demo wallet</span>
                <strong>{formatMicros(state.walletMicros)}</strong>
              </div>
            </div>
            <div className="pooled-actions">
              <button
                className="button secondary"
                disabled={BigInt(metrics.maxWithdrawMicros) === 0n}
                onClick={() => onAction({ kind: 'withdraw' })}
              >
                <ArrowDownLeft size={16} aria-hidden="true" /> Withdraw
              </button>
              <button
                className="button primary"
                disabled={BigInt(state.walletMicros) === 0n}
                onClick={() => onAction({ kind: 'supply' })}
              >
                Supply USDC <ArrowUpRight size={16} aria-hidden="true" />
              </button>
            </div>
          </section>
          <div className="pooled-explanation">
            <Info size={17} aria-hidden="true" />
            <p>
              Withdraw up to your share value and available liquidity. If the
              vault is fully utilized, withdrawals wait for repayment or new
              supply. There is no withdrawal queue in this preview.
            </p>
          </div>
          <section className="pooled-panel pooled-rewards">
            <div>
              <span className="section-eyebrow">VARIABLE REWARDS</span>
              <h3>Explore how share value changes.</h3>
              <p>
                Apply example net lender revenue to the next epoch. The amount
                is a scenario you choose, not an expected return.
              </p>
            </div>
            <button
              className="button secondary"
              onClick={() => onAction({ kind: 'epoch' })}
            >
              <Clock3 size={16} aria-hidden="true" /> Simulate an epoch
            </button>
          </section>
        </>
      )}
      {currentActivity.length > 0 && (
        <section
          className="pooled-panel pooled-activity"
          aria-labelledby="lending-activity-title"
        >
          <div className="pooled-panel-header">
            <h3 id="lending-activity-title">Recent activity</h3>
            <span className="text-muted">Local simulation</span>
          </div>
          {currentActivity.map((entry) => (
            <div className="pooled-activity-row" key={entry.id}>
              <div>
                <strong>{activityLabel[entry.kind]}</strong>
                <span>
                  {formatDate(entry.createdAt)}
                  {entry.collateralId
                    ? ` · ${COLLATERAL.find((asset) => asset.id === entry.collateralId)?.name ?? 'Demo collateral'}`
                    : ''}
                </span>
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
      <p className="workspace-note">
        Local simulations with fictional collateral and vault balances. No
        wallet, custody, live liquidity or guaranteed returns.
      </p>
    </>
  );
}
