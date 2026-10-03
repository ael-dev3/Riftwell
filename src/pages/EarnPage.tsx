import {
  ArrowDownLeft,
  ArrowUpRight,
  Clock3,
  CircleHelp,
  HandCoins,
} from 'lucide-react';
import { Notice } from '../components/ui/Bits';
import { ActivityTable, EmptyState, PageHead } from '../components/page';
import { Sparkline } from '../components/ui/Charts';
import CountUp from '../components/ui/CountUp';
import { Meter } from '../components/ui/Meter';
import { collateralLimits } from '../data';
import { formatMicros, roundAmount } from '../domain';
import { getLendingMetrics, type LendingState } from '../lending';
import type { Market } from '../markets';
import { VAULT_KINDS, type LendingAction } from '../preview/actions';
import { formatShares } from '../format';

type Props = {
  market: Market;
  lending: LendingState;
  onAction: (action: LendingAction) => void;
  onDetails: () => void;
};

/** Annualized lender revenue from the user's own simulated epochs, if any. */
export function simulatedYield(lending: LendingState) {
  const epochs = lending.activity
    .filter((entry) => entry.kind === 'epoch')
    .slice(-13);
  const assets =
    BigInt(lending.poolCashMicros) + BigInt(lending.poolOutstandingMicros);
  if (!epochs.length || assets === 0n) return null;
  const revenue = epochs.reduce(
    (sum, entry) => sum + BigInt(entry.poolYieldMicros),
    0n,
  );
  const bps = Number(
    (revenue * 52n * 10_000n) / (BigInt(epochs.length) * assets),
  );
  return {
    bps,
    epochs: epochs.length,
    series: epochs.map((entry) => roundAmount(BigInt(entry.poolYieldMicros))),
  };
}

export default function EarnPage({
  market,
  lending,
  onAction,
  onDetails,
}: Props) {
  const metrics = getLendingMetrics(lending, collateralLimits(lending));
  const assets = BigInt(metrics.totalAssetsMicros);
  const cash = BigInt(lending.poolCashMicros);
  const outstanding = BigInt(lending.poolOutstandingMicros);
  const supplied = BigInt(metrics.suppliedAssetsMicros);
  const shares = BigInt(lending.shareBalanceRaw);
  const withdrawable = BigInt(metrics.maxWithdrawMicros);
  const wallet = BigInt(lending.walletMicros);
  const utilization = metrics.utilizationBps / 100;
  const yieldInfo = simulatedYield(lending);
  const vaultActivity = lending.activity.filter((entry) =>
    (VAULT_KINDS as readonly string[]).includes(entry.kind),
  );

  return (
    <>
      <PageHead compact title="Earn from collateral revenue" />

      <section className="vault-card" aria-labelledby="vault-title">
        <header className="vault-head">
          <span className="token-badge" aria-hidden="true">
            $
          </span>
          <div className="vault-name">
            <h2 id="vault-title">USDC Vault</h2>
            <p>
              <span className="badge-inline">
                <img
                  src={`${import.meta.env.BASE_URL}${market.logoPath}`}
                  alt=""
                  width="14"
                  height="14"
                />
                {market.name}
              </span>
              <span className="badge-inline">
                <span className="chain-dot" aria-hidden="true" />
                {market.chain}
              </span>
            </p>
          </div>
          <div className="vault-yield">
            {yieldInfo ? (
              <>
                <strong>
                  <CountUp
                    value={yieldInfo.bps / 100}
                    format={(value) => `${value.toFixed(2)}%`}
                  />
                </strong>
                <span>
                  simulated · last {yieldInfo.epochs} epoch
                  {yieldInfo.epochs === 1 ? '' : 's'}
                </span>
              </>
            ) : (
              <>
                <strong>Variable</strong>
                <span>yield · scenario only</span>
              </>
            )}
          </div>
        </header>
        <dl className="vault-metrics">
          <div>
            <dt>Vault assets</dt>
            <dd>
              {formatMicros(assets)}
              <small>Idle USDC plus loans</small>
            </dd>
          </div>
          <div>
            <dt>Active loans</dt>
            <dd>
              {formatMicros(outstanding)}
              <small>Includes example borrowers</small>
            </dd>
          </div>
          <div>
            <dt>Utilization</dt>
            <dd>
              {utilization.toFixed(2)}%
              <Meter
                value={utilization}
                label="Illustrative vault utilization"
                tone={utilization >= 80 ? 'warning' : 'accent'}
                size="thin"
              />
              <small>{formatMicros(cash)} available</small>
            </dd>
          </div>
          <div>
            <dt>Your position</dt>
            <dd>
              {shares > 0n ? formatMicros(supplied) : '—'}
              <small>
                {shares > 0n
                  ? `${formatShares(shares)} shares`
                  : 'No shares yet'}
              </small>
            </dd>
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
          {yieldInfo && yieldInfo.series.length > 1 && (
            <Sparkline
              values={yieldInfo.series}
              label="Simulated lender revenue per epoch"
            />
          )}
          <span className="vault-foot-actions">
            <button
              type="button"
              className="button secondary"
              disabled={withdrawable === 0n}
              onClick={() => onAction({ kind: 'withdraw' })}
            >
              <ArrowDownLeft size={16} aria-hidden="true" /> Withdraw
            </button>
            <button
              type="button"
              className="button primary"
              disabled={wallet === 0n}
              onClick={() => onAction({ kind: 'supply' })}
            >
              Supply USDC <ArrowUpRight size={16} aria-hidden="true" />
            </button>
          </span>
        </footer>
      </section>

      <div className="earn-grid">
        <section className="panel" aria-labelledby="supply-position-title">
          <div className="block-head">
            <h2 id="supply-position-title">Your position</h2>
            <span className="text-muted">Share value includes loans</span>
          </div>
          <dl className="mini-stats two">
            <div>
              <dt>Supplied value</dt>
              <dd>{formatMicros(supplied)}</dd>
            </div>
            <div>
              <dt>Vault shares</dt>
              <dd>{formatShares(shares)}</dd>
            </div>
            <div>
              <dt>Withdrawable now</dt>
              <dd className="accent-text">{formatMicros(withdrawable)}</dd>
            </div>
            <div>
              <dt>Demo wallet</dt>
              <dd>{formatMicros(wallet)}</dd>
            </div>
          </dl>
          <Notice>Withdrawals depend on available liquidity.</Notice>
        </section>
        <section className="panel" aria-labelledby="revenue-title">
          <div className="block-head">
            <h2 id="revenue-title">Variable rewards</h2>
            <span className="text-muted">Scenario you choose</span>
          </div>
          <p className="panel-text">
            Choose example revenue for the next epoch.
          </p>
          <button
            type="button"
            className="button secondary"
            onClick={() => onAction({ kind: 'epoch' })}
          >
            <Clock3 size={16} aria-hidden="true" /> Simulate an epoch
          </button>
        </section>
      </div>

      <section className="panel" aria-labelledby="vault-activity-title">
        <div className="block-head">
          <h2 id="vault-activity-title">Vault activity</h2>
          <span className="text-muted">Local simulation</span>
        </div>
        <ActivityTable
          entries={vaultActivity}
          caption="Vault activity in this browser"
          filters={[
            { id: 'all', label: 'All', kinds: VAULT_KINDS },
            { id: 'supply', label: 'Supply', kinds: ['supply'] },
            {
              id: 'withdraw',
              label: 'Withdrawals',
              kinds: ['withdraw', 'redeem'],
            },
            { id: 'epochs', label: 'Epochs', kinds: ['epoch'] },
          ]}
          empty={
            <EmptyState icon={HandCoins} title="No vault activity yet." compact>
              Supplies, withdrawals and simulated revenue appear here.
            </EmptyState>
          }
        />
      </section>
    </>
  );
}
