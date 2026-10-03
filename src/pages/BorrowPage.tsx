import {
  ArrowDownLeft,
  ArrowUpRight,
  Clock3,
  Landmark,
  Layers3,
  LockKeyhole,
  Merge,
  Plus,
  RefreshCcw,
  SlidersHorizontal,
  Store,
  Tag,
  Vote,
  Wallet,
} from 'lucide-react';
import { useState, type CSSProperties } from 'react';
import type { Page } from '../app/router';
import { ActivityTable, EmptyState, PageHead } from '../components/page';
import CountUp from '../components/ui/CountUp';
import { Ring } from '../components/ui/Meter';
import { TabPanel, Tabs } from '../components/ui/Tabs';
import {
  collateralLimits,
  creditMicros,
  rewardMicros,
  SAMPLE_CREDIT_EPOCHS,
} from '../data';
import {
  formatBalance,
  formatDate,
  formatLockRemaining,
  formatMicros,
  lockDaysRemaining,
  roundAmount,
  type Asset,
} from '../domain';
import { epochAt, epochStartMs } from '../epoch';
import { getLendingMetrics, type LendingState } from '../lending';
import { relayerStrategyLabel, usd } from '../format';
import type { Market } from '../markets';
import { BORROW_KINDS, type LendingAction } from '../preview/actions';
import type { Holdings } from '../preview/store';
import VotePlanner from './VotePlanner';
import type { VotePlan } from '../vote';

type Tab = 'positions' | 'vote' | 'activity';
type Props = {
  market: Market;
  lending: LendingState;
  holdings: Holdings;
  votes: VotePlan;
  now: number;
  onAction: (action: LendingAction) => void;
  onVotes: (plan: VotePlan) => void;
  onNavigate: (page: Page) => void;
  onSell: (asset: Asset) => void;
};

const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

/** Exact USDC at rest; counts between values when it changes. */
function Money({ micros }: { micros: bigint }) {
  return (
    <CountUp
      value={roundAmount(micros)}
      format={(value) => `${usd(value)} USDC`}
      exact={formatMicros(micros)}
    />
  );
}

function PositionRow({
  asset,
  mode,
  removable = true,
  now,
  onAction,
  onSell,
}: {
  asset: Asset;
  mode: 'collateral' | 'relayer' | 'wallet';
  removable?: boolean;
  now: number;
  onAction: (action: LendingAction) => void;
  onSell: (asset: Asset) => void;
}) {
  const days = lockDaysRemaining(asset.unlockDate, now);
  return (
    <article
      className="position-row"
      // A position keeps its identity as it moves between sections, so a
      // deposit or withdrawal glides it to its new place (see pages.css).
      style={{ '--vt-name': `position-${asset.id}` } as CSSProperties}
    >
      <div className="position-main">
        <img
          className="thumb"
          src={asset.artwork}
          alt=""
          width="44"
          height="44"
          loading="lazy"
        />
        <div>
          <h4>{asset.name}</h4>
          <p>
            {formatBalance(asset.underlyingBalance, asset.underlyingSymbol)} ·{' '}
            <span title={`Unlocks ${formatDate(asset.unlockDate)}`}>
              {formatLockRemaining(days)} lock
            </span>
          </p>
        </div>
      </div>
      <dl className="position-data">
        <div>
          <dt>Example reward</dt>
          <dd>{formatMicros(rewardMicros(asset))}</dd>
        </div>
        <div>
          <dt>Credit</dt>
          <dd>
            {mode === 'relayer' ? 'None' : formatMicros(creditMicros(asset))}
          </dd>
        </div>
      </dl>
      <div className="position-actions">
        {mode === 'collateral' && (
          <>
            <span className="pill accent">Deposited</span>
            <button
              type="button"
              className="button ghost small"
              aria-label={`Increase the lock of ${asset.name}`}
              onClick={() => onAction({ kind: 'increase-lock', asset })}
            >
              <LockKeyhole size={14} aria-hidden="true" /> Increase
            </button>
            <button
              type="button"
              className="button ghost small"
              aria-label={`Merge a wallet position into ${asset.name}`}
              onClick={() => onAction({ kind: 'merge', asset })}
            >
              <Merge size={14} aria-hidden="true" /> Merge
            </button>
            <button
              type="button"
              className="button secondary small"
              disabled={!removable}
              aria-describedby={
                removable ? undefined : `remove-hint-${asset.id}`
              }
              aria-label={`Remove ${asset.name}`}
              onClick={() => onAction({ kind: 'remove-collateral', asset })}
            >
              Remove <ArrowUpRight size={14} aria-hidden="true" />
            </button>
            {!removable && (
              <span className="form-hint" id={`remove-hint-${asset.id}`}>
                Repay debt to remove.
              </span>
            )}
          </>
        )}
        {mode === 'relayer' && (
          <>
            <span className="pill violet">Auto-collect</span>
            <button
              type="button"
              className="button secondary small"
              aria-label={`Remove ${asset.name} from the relayer`}
              onClick={() => onAction({ kind: 'relayer-withdraw', asset })}
            >
              Remove <ArrowUpRight size={14} aria-hidden="true" />
            </button>
          </>
        )}
        {mode === 'wallet' && (
          <>
            <button
              type="button"
              className="button ghost small"
              aria-label={`List ${asset.name} for sale`}
              onClick={() => onSell(asset)}
            >
              <Tag size={14} aria-hidden="true" /> List
            </button>
            <button
              type="button"
              className="button secondary small"
              aria-label={`Add ${asset.name} to the relayer`}
              onClick={() => onAction({ kind: 'relayer-deposit', asset })}
            >
              <RefreshCcw size={14} aria-hidden="true" /> Relayer
            </button>
            <button
              type="button"
              className="button primary small"
              aria-label={`Deposit ${asset.name}`}
              onClick={() => onAction({ kind: 'deposit-collateral', asset })}
            >
              Deposit <Plus size={14} aria-hidden="true" />
            </button>
          </>
        )}
      </div>
    </article>
  );
}

export default function BorrowPage({
  market,
  lending,
  holdings,
  votes,
  now,
  onAction,
  onVotes,
  onNavigate,
  onSell,
}: Props) {
  const [tab, setTab] = useState<Tab>('positions');
  const metrics = getLendingMetrics(lending, collateralLimits(lending));
  const debt = BigInt(lending.debtMicros);
  const credit = BigInt(metrics.totalCreditMicros);
  const available = BigInt(metrics.availableCreditMicros);
  const wallet = BigInt(lending.walletMicros);
  const cash = BigInt(lending.poolCashMicros);
  const utilization = metrics.utilizationBps / 100;
  const creditUsed = credit > 0n ? Number((debt * 10_000n) / credit) / 100 : 0;
  const sampleReward = holdings.collateral.reduce(
    (sum, asset) => sum + rewardMicros(asset),
    0n,
  );
  // The chosen share of relayer rewards also repays debt.
  const relayerRepayment =
    (holdings.relayer.reduce((sum, asset) => sum + rewardMicros(asset), 0n) *
      BigInt(lending.relayerRepayBps)) /
    10_000n;
  const repayment = sampleReward + relayerRepayment;
  const payoffEpochs =
    debt > 0n && repayment > 0n ? ceilDiv(debt, repayment) : null;
  const strategy = relayerStrategyLabel(lending.relayerRepayBps);
  const clock = epochAt(now);
  const borrowActivity = lending.activity.filter((entry) =>
    (BORROW_KINDS as readonly string[]).includes(entry.kind),
  );
  const canBorrow = available > 0n && cash > 0n;

  return (
    <>
      <PageHead compact title={`Borrow against ${market.positionSymbol}`} />
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
              count: lending.collateralIds.length,
            },
            { id: 'vote', label: 'Vote' },
            { id: 'activity', label: 'Activity', count: borrowActivity.length },
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
                  <p>Credit = example reward × {SAMPLE_CREDIT_EPOCHS} epochs</p>
                </div>
                {utilization >= 80 && (
                  <span className="pill warning">
                    Vault {utilization.toFixed(1)}% utilized
                  </span>
                )}
              </header>
              <div className="credit-body">
                <Ring
                  value={creditUsed}
                  label="Credit used"
                  caption="credit used"
                />
                <dl className="credit-metrics">
                  <div>
                    <dt>Credit limit</dt>
                    <dd>
                      <Money micros={credit} />
                    </dd>
                  </div>
                  <div>
                    <dt>Borrowed</dt>
                    <dd>
                      <Money micros={debt} />
                    </dd>
                  </div>
                  <div>
                    <dt>Available to borrow</dt>
                    <dd className="accent-text">
                      <Money micros={available} />
                    </dd>
                  </div>
                  <div>
                    <dt>
                      <Wallet size={13} aria-hidden="true" /> Demo balance
                    </dt>
                    <dd>
                      <Money micros={wallet} />
                    </dd>
                  </div>
                </dl>
              </div>
              <div className="credit-actions">
                <button
                  type="button"
                  className="button primary"
                  disabled={!canBorrow}
                  onClick={() => onAction({ kind: 'borrow' })}
                >
                  Borrow USDC <ArrowUpRight size={16} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="button secondary"
                  disabled={debt === 0n || wallet === 0n}
                  onClick={() => onAction({ kind: 'repay' })}
                >
                  <ArrowDownLeft size={16} aria-hidden="true" /> Repay
                </button>
                <button
                  type="button"
                  className="button ghost"
                  disabled={
                    !lending.collateralIds.length && !lending.relayerIds.length
                  }
                  onClick={() => onAction({ kind: 'epoch' })}
                >
                  <Clock3 size={16} aria-hidden="true" /> Simulate an epoch
                </button>
              </div>
              <div className="credit-foot">
                {payoffEpochs !== null ? (
                  <p>
                    <strong>
                      About {payoffEpochs.toString()} epoch
                      {payoffEpochs === 1n ? '' : 's'} to repay
                    </strong>{' '}
                    at example rewards of {formatMicros(repayment)} per epoch,
                    around{' '}
                    {formatDate(
                      new Date(
                        epochStartMs(clock.period + Number(payoffEpochs)),
                      ).toISOString(),
                    )}
                    . Rewards vary, so this is not a schedule.
                  </p>
                ) : (
                  <p>
                    {lending.collateralIds.length
                      ? 'Rewards repay debt first each epoch; any surplus returns to your demo balance.'
                      : 'Deposit a position to open credit. Depositing alone never creates debt.'}
                  </p>
                )}
                <p className="credit-vault">
                  <Landmark size={14} aria-hidden="true" /> {formatMicros(cash)}{' '}
                  idle in the USDC vault · {utilization.toFixed(1)}% utilized
                </p>
              </div>
            </section>

            <section
              className="positions-block"
              aria-labelledby="collateral-title"
            >
              <div className="block-head">
                <h3 id="collateral-title">
                  <Layers3 size={17} aria-hidden="true" /> Deposited collateral
                </h3>
                <span className="text-muted">
                  {holdings.collateral.length} of {holdings.owned.length}{' '}
                  positions
                </span>
              </div>
              {holdings.collateral.length ? (
                <div className="position-list">
                  {holdings.collateral.map((asset) => (
                    <PositionRow
                      key={asset.id}
                      asset={asset}
                      mode="collateral"
                      removable={credit - creditMicros(asset) >= debt}
                      now={now}
                      onAction={onAction}
                      onSell={onSell}
                    />
                  ))}
                </div>
              ) : (
                <EmptyState icon={Layers3} title="No collateral yet." inline>
                  Deposit a position from your wallet below to open credit.
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
                <span className="block-tools">
                  <span className="text-muted">Rewards without borrowing</span>
                  <button
                    type="button"
                    className="button ghost small"
                    aria-label={`Relayer strategy: ${strategy}`}
                    onClick={() => onAction({ kind: 'relayer-strategy' })}
                  >
                    <SlidersHorizontal size={14} aria-hidden="true" />{' '}
                    {strategy}
                  </button>
                </span>
              </div>
              {holdings.relayer.length ? (
                <div className="position-list">
                  {holdings.relayer.map((asset) => (
                    <PositionRow
                      key={asset.id}
                      asset={asset}
                      mode="relayer"
                      now={now}
                      onAction={onAction}
                      onSell={onSell}
                    />
                  ))}
                </div>
              ) : (
                <EmptyState
                  icon={RefreshCcw}
                  title="Nothing in the relayer."
                  inline
                >
                  Add a wallet position to collect its rewards each epoch. You
                  can take it back at any time.
                </EmptyState>
              )}
            </section>

            <section className="positions-block" aria-labelledby="wallet-title">
              <div className="block-head">
                <h3 id="wallet-title">
                  <Wallet size={17} aria-hidden="true" /> In your demo wallet
                </h3>
                <button
                  type="button"
                  className="button ghost small"
                  onClick={() => onNavigate('marketplace')}
                >
                  <Store size={14} aria-hidden="true" /> Buy positions
                </button>
              </div>
              {holdings.wallet.length ? (
                <div className="position-list">
                  {holdings.wallet.map((asset) => (
                    <PositionRow
                      key={asset.id}
                      asset={asset}
                      mode="wallet"
                      now={now}
                      onAction={onAction}
                      onSell={onSell}
                    />
                  ))}
                </div>
              ) : (
                <EmptyState
                  icon={Wallet}
                  title="Nothing idle in your wallet."
                  inline
                >
                  Every position is deposited, in the relayer or listed. Buy
                  another in the marketplace to grow your credit.
                </EmptyState>
              )}
              {holdings.listed.length > 0 && (
                <p className="form-hint">
                  {holdings.listed.length} listed position
                  {holdings.listed.length === 1 ? ' is' : 's are'} reserved for
                  sale. Cancel the listing in the marketplace to deposit it.
                </p>
              )}
            </section>
          </TabPanel>
        )}
        {tab === 'vote' && (
          <TabPanel idBase="borrow" id="vote">
            <VotePlanner
              collateral={holdings.collateral}
              plan={votes}
              now={now}
              sampleRewardMicros={sampleReward}
              onSave={onVotes}
              onSimulate={(rewardMicros) =>
                onAction({
                  kind: 'epoch',
                  rewardMicros: rewardMicros.toString(),
                })
              }
              onPositions={() => setTab('positions')}
            />
          </TabPanel>
        )}
        {tab === 'activity' && (
          <TabPanel idBase="borrow" id="activity">
            <ActivityTable
              entries={borrowActivity}
              caption="Borrowing activity in this browser"
              filters={[
                { id: 'all', label: 'All', kinds: BORROW_KINDS },
                {
                  id: 'loans',
                  label: 'Borrow & repay',
                  kinds: ['borrow', 'repay'],
                },
                {
                  id: 'collateral',
                  label: 'Collateral',
                  kinds: [
                    'deposit-collateral',
                    'remove-collateral',
                    'merge',
                    'increase-lock',
                  ],
                },
                { id: 'epochs', label: 'Epochs', kinds: ['epoch'] },
                {
                  id: 'relayer',
                  label: 'Relayer',
                  kinds: ['relayer-deposit', 'relayer-withdraw'],
                },
                { id: 'purchases', label: 'Purchases', kinds: ['purchase'] },
              ]}
              empty={
                <EmptyState icon={Vote} title="No activity yet." compact>
                  Deposits, merges, draws, repayments, purchases and simulated
                  epochs appear here.
                </EmptyState>
              }
            />
          </TabPanel>
        )}
      </section>
    </>
  );
}
