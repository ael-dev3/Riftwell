import { PageHead } from '../components/page';
import { AreaChart, BarChart } from '../components/ui/Charts';
import { Meter } from '../components/ui/Meter';
import StatCard from '../components/ui/StatCard';
import { formatMicros, roundAmount } from '../domain';
import { usd } from '../format';
import type { Market } from '../markets';

export type StatsModel = {
  mode: 'preview' | 'connected';
  vault: {
    assetsMicros: bigint;
    outstandingMicros: bigint;
    cashMicros: bigint;
    utilizationBps: number;
  } | null;
  /** Rewards processed in simulated epochs (preview only). */
  rewards: { micros: bigint; epochs: number } | null;
  sales: { count: number; volumeMicros: bigint } | null;
  volumeSeries: { labels: string[]; values: number[] } | null;
  /** Positions behind the market charts: locked balance and unlock time. */
  positions: readonly { balance: number; unlockMs: number }[];
  listed: number;
};

const QUARTER_MS = 91.3125 * 86_400_000;
const compact = (value: number) =>
  new Intl.NumberFormat('en-GB', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);

function quarterLabel(ms: number) {
  const date = new Date(ms);
  return `Q${Math.floor(date.getUTCMonth() / 3) + 1} ${date.getUTCFullYear()}`;
}

export default function StatsPage({
  market,
  model,
  now,
}: {
  market: Market;
  model: StatsModel;
  now: number;
}) {
  const quarters = Array.from({ length: 8 }, (_, index) => {
    const start = now + index * QUARTER_MS;
    return { start, end: start + QUARTER_MS, label: quarterLabel(start) };
  });
  const unlocks = quarters.map(({ start, end, label }, index) => {
    const amount = model.positions
      .filter(
        (position) =>
          (index === 0 || position.unlockMs >= start) &&
          position.unlockMs < end,
      )
      .reduce((sum, position) => sum + position.balance, 0);
    return { label, value: amount, display: amount ? compact(amount) : '0' };
  });
  const sizes = (
    [
      ['< 5K', 0, 5_000],
      ['5K–25K', 5_000, 25_000],
      ['25K–100K', 25_000, 100_000],
      ['100K+', 100_000, Infinity],
    ] as const
  ).map(([label, low, high]) => {
    const count = model.positions.filter(
      (position) => position.balance >= low && position.balance < high,
    ).length;
    return { label, value: count, display: String(count) };
  });
  const utilization = model.vault ? model.vault.utilizationBps / 100 : null;

  return (
    <>
      <PageHead
        title="Statistics"
        lede={
          model.mode === 'preview'
            ? 'Vault, reward and market totals from the sample market and the simulation in this browser, not on-chain metrics.'
            : 'Market totals from the off-chain listings this service has loaded. Vault and reward figures appear after lending launches.'
        }
      />
      <section className="stat-grid four" aria-label="Totals">
        <StatCard
          index={0}
          label="Vault assets"
          numeric={
            model.vault ? roundAmount(model.vault.assetsMicros) : undefined
          }
          format={usd}
          value={model.vault ? usd(roundAmount(model.vault.assetsMicros)) : '—'}
          unit={model.vault ? 'USDC' : undefined}
          sub={
            model.vault ? 'Idle USDC plus outstanding loans' : 'Not launched'
          }
        />
        <StatCard
          index={1}
          tone="violet"
          label="Borrowed"
          numeric={
            model.vault ? roundAmount(model.vault.outstandingMicros) : undefined
          }
          format={usd}
          value={
            model.vault ? usd(roundAmount(model.vault.outstandingMicros)) : '—'
          }
          unit={model.vault ? 'USDC' : undefined}
          sub={
            utilization === null
              ? 'No funded loans'
              : `${utilization.toFixed(2)}% utilized`
          }
        />
        <StatCard
          index={2}
          tone="sky"
          label="Rewards processed"
          numeric={
            model.rewards ? roundAmount(model.rewards.micros) : undefined
          }
          format={usd}
          value={model.rewards ? usd(roundAmount(model.rewards.micros)) : '—'}
          unit={model.rewards ? 'USDC' : undefined}
          sub={
            model.rewards
              ? `${model.rewards.epochs} simulated ${model.rewards.epochs === 1 ? 'epoch' : 'epochs'}`
              : 'Recorded after launch'
          }
        />
        <StatCard
          index={3}
          tone="amber"
          label="Market volume"
          numeric={
            model.sales ? roundAmount(model.sales.volumeMicros) : undefined
          }
          format={usd}
          value={model.sales ? usd(roundAmount(model.sales.volumeMicros)) : '—'}
          unit={model.sales ? 'USDC' : undefined}
          sub={
            model.sales
              ? `${model.sales.count} sample and preview sales`
              : `${model.listed} active ${model.listed === 1 ? 'listing' : 'listings'}`
          }
        />
      </section>
      <div className="stats-grid">
        <section className="panel" aria-labelledby="volume-title">
          <div className="block-head">
            <h2 id="volume-title">Market volume by epoch</h2>
            <span className="text-muted">USDC</span>
          </div>
          {model.volumeSeries && model.volumeSeries.values.some(Boolean) ? (
            <AreaChart
              height={190}
              ariaLabel="Market volume per KittenSwap epoch from sample sales and your preview purchases"
              labels={model.volumeSeries.labels}
              format={(value) => `${usd(value)} USDC`}
              series={[{ label: 'Volume', values: model.volumeSeries.values }]}
            />
          ) : (
            <p className="panel-text">
              No settled sales yet. Marketplace settlement is not launched.
            </p>
          )}
        </section>
        <section className="panel" aria-labelledby="utilization-title">
          <div className="block-head">
            <h2 id="utilization-title">Vault utilization</h2>
            <span className="text-muted">
              {utilization === null ? 'Not launched' : 'Now'}
            </span>
          </div>
          {model.vault && utilization !== null ? (
            <>
              <p className="stat-headline">
                <strong>{utilization.toFixed(2)}%</strong>
                <span>of vault assets on loan</span>
              </p>
              <Meter
                value={utilization}
                label="Vault utilization"
                tone={utilization >= 80 ? 'warning' : 'accent'}
              />
              <dl className="facts">
                <div>
                  <dt>Idle USDC</dt>
                  <dd>{formatMicros(model.vault.cashMicros)}</dd>
                </div>
                <div>
                  <dt>Outstanding loans</dt>
                  <dd>{formatMicros(model.vault.outstandingMicros)}</dd>
                </div>
              </dl>
            </>
          ) : (
            <p className="panel-text">
              Utilization appears once the vault is deployed and funded.
            </p>
          )}
        </section>
        <section className="panel" aria-labelledby="unlock-title">
          <div className="block-head">
            <h2 id="unlock-title">Unlock schedule</h2>
            <span className="text-muted">{market.tokenSymbol} by quarter</span>
          </div>
          {model.positions.length ? (
            <BarChart
              ariaLabel={`${market.tokenSymbol} unlocking by quarter: ${unlocks
                .map((bar) => `${bar.label} ${bar.display}`)
                .join(', ')}`}
              bars={unlocks}
            />
          ) : (
            <p className="panel-text">No positions to chart yet.</p>
          )}
          <p className="form-hint">
            {model.mode === 'preview'
              ? 'Sample listings and the positions in your preview account.'
              : 'Positions behind the listings this service has loaded.'}
          </p>
        </section>
        <section className="panel" aria-labelledby="sizes-title">
          <div className="block-head">
            <h2 id="sizes-title">Position sizes</h2>
            <span className="text-muted">Locked {market.tokenSymbol}</span>
          </div>
          {model.positions.length ? (
            <BarChart
              ariaLabel={`Positions by locked ${market.tokenSymbol}: ${sizes
                .map((bar) => `${bar.label} ${bar.display}`)
                .join(', ')}`}
              bars={sizes}
            />
          ) : (
            <p className="panel-text">No positions to chart yet.</p>
          )}
        </section>
      </div>
    </>
  );
}
