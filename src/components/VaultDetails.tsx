import { ArrowRight } from 'lucide-react';
import { useState } from 'react';
import { COLLATERAL_LIMITS } from '../data';
import { formatMicros, roundAmount } from '../domain';
import { usd } from '../format';
import { getLendingMetrics, type LendingState } from '../lending';
import type { Market } from '../markets';
import Dialog from './Dialog';
import { Notice } from './ui/Bits';
import { AreaChart } from './ui/Charts';
import { Meter } from './ui/Meter';

type Props = {
  market: Market;
  /** Null when the vault has not launched, as in connected mode. */
  lending: LendingState | null;
  onClose: () => void;
};

export default function VaultDetails({ market, lending, onClose }: Props) {
  const metrics = lending
    ? getLendingMetrics(lending, COLLATERAL_LIMITS)
    : null;
  const [span, setSpan] = useState<4 | 13 | 0>(13);
  const allEpochs = lending
    ? lending.activity.filter((entry) => entry.kind === 'epoch')
    : [];
  const epochs = span ? allEpochs.slice(-span) : allEpochs;
  const utilization = metrics ? metrics.utilizationBps / 100 : null;
  const lastRepaid = epochs.length
    ? BigInt(epochs[epochs.length - 1].rewardRepaidMicros)
    : 0n;
  const debt = lending ? BigInt(lending.debtMicros) : 0n;

  return (
    <Dialog
      title="USDC Vault"
      kicker={`${market.name.toUpperCase()} USDC · ${market.chain.toUpperCase()}`}
      onClose={onClose}
      wide
    >
      <div className="dialog-body vault-details">
        <dl className="mini-stats">
          <div>
            <dt>Vault assets</dt>
            <dd>{metrics ? formatMicros(metrics.totalAssetsMicros) : '—'}</dd>
          </div>
          <div>
            <dt>Active loans</dt>
            <dd>
              {lending ? formatMicros(lending.poolOutstandingMicros) : '—'}
            </dd>
          </div>
          <div>
            <dt>Available to withdraw</dt>
            <dd>{lending ? formatMicros(lending.poolCashMicros) : '—'}</dd>
          </div>
          <div>
            <dt>Utilization</dt>
            <dd>{utilization === null ? '—' : `${utilization.toFixed(2)}%`}</dd>
          </div>
        </dl>
        <section className="detail-section" aria-labelledby="revenue-history">
          <div className="block-head">
            <h3 id="revenue-history">
              {lending ? 'Simulated revenue history' : 'Revenue history'}
            </h3>
            {allEpochs.length > 1 && (
              <div
                className="mini-toggle"
                role="group"
                aria-label="Epochs shown"
              >
                {(
                  [
                    [4, '4 epochs'],
                    [13, '13 epochs'],
                    [0, 'All'],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={label}
                    type="button"
                    aria-pressed={span === value}
                    onClick={() => setSpan(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
          {epochs.length > 1 ? (
            <AreaChart
              ariaLabel={`Simulated lender revenue and reward repayments over your last ${epochs.length} epochs`}
              labels={epochs.map(
                (_, index) =>
                  `Epoch ${allEpochs.length - epochs.length + index + 1}`,
              )}
              format={(value) => `${usd(value)} USDC`}
              series={[
                {
                  label: 'Lender revenue',
                  values: epochs.map((entry) =>
                    roundAmount(BigInt(entry.poolYieldMicros)),
                  ),
                },
                {
                  label: 'Rewards repaid',
                  tone: 'violet',
                  values: epochs.map((entry) =>
                    roundAmount(BigInt(entry.rewardRepaidMicros)),
                  ),
                },
              ]}
            />
          ) : (
            <p className="panel-text">
              {lending
                ? 'Simulate at least two epochs to chart lender revenue and reward repayments. Only your own scenario inputs are shown.'
                : 'History appears after the vault launches. No historical rate is shown before then.'}
            </p>
          )}
        </section>
        <section className="detail-section" aria-labelledby="vault-what">
          <h3 id="vault-what">What this vault is</h3>
          <p className="panel-text">
            You supply USDC to a shared {market.name} lending pool. Borrowers
            draw credit lines against deposited {market.positionSymbol}; the
            rewards their collateral earns repay their debt, and configured
            lender revenue grows the value of every vault share.
          </p>
        </section>
        <section className="detail-section" aria-labelledby="vault-risk">
          <h3 id="vault-risk">Risk, withdrawals and key facts</h3>
          {utilization !== null && (
            <div className="credit-after">
              <div className="credit-after-head">
                <span>Utilization</span>
                <strong>{utilization.toFixed(2)}%</strong>
              </div>
              <Meter
                value={utilization}
                label="Vault utilization"
                tone={utilization >= 80 ? 'warning' : 'accent'}
              />
            </div>
          )}
          <p className="panel-text">
            Withdrawals draw from idle, un-borrowed USDC. At full utilization
            there may be nothing to withdraw until borrowers repay or new
            suppliers deposit. Lower or halted rewards slow both debt recovery
            and lender revenue.
          </p>
          <dl className="facts">
            <div>
              <dt>Chain</dt>
              <dd>{market.chain}</dd>
            </div>
            <div>
              <dt>Market</dt>
              <dd>{market.name}</dd>
            </div>
            <div>
              <dt>Asset</dt>
              <dd>USDC</dd>
            </div>
            <div>
              <dt>Vault contract</dt>
              <dd>Not deployed</dd>
            </div>
            {lending && debt > 0n && (
              <div>
                <dt>Your payoff at the last simulated reward</dt>
                <dd>
                  {lastRepaid > 0n
                    ? `About ${((debt + lastRepaid - 1n) / lastRepaid).toString()} epochs`
                    : 'No repayment in the last epoch'}
                </dd>
              </div>
            )}
          </dl>
        </section>
        <Notice>
          {lending
            ? 'Preview figures come from this browser. Other suppliers and borrowers are fixed examples.'
            : 'The vault has not launched. Balances, terms and history appear after deployment.'}
        </Notice>
      </div>
      <div className="dialog-footer">
        <button className="button primary" onClick={onClose}>
          Back to the vault <ArrowRight size={16} aria-hidden="true" />
        </button>
      </div>
    </Dialog>
  );
}
