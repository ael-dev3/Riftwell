import { Clock3, Layers3, RotateCcw, Save } from 'lucide-react';
import { useState } from 'react';
import { Notice } from '../components/ui/Bits';
import { EmptyState } from '../components/page';
import { Meter } from '../components/ui/Meter';
import { formatMicros, type Asset } from '../domain';
import { epochAt, formatFlip } from '../epoch';
import {
  evenWeights,
  EXAMPLE_POOLS,
  OPTIMIZER_WEIGHTS,
  projectedRewardMicros,
  votingPower,
  weightTotal,
  type VotePlan,
} from '../vote';

type Props = {
  collateral: readonly Asset[];
  plan: VotePlan;
  now: number;
  sampleRewardMicros: bigint;
  onSave: (plan: VotePlan) => void;
  onSimulate: (rewardMicros: bigint) => void;
  onPositions: () => void;
};

const percent = (bps: number) => `${(bps / 100).toFixed(bps % 100 ? 2 : 0)}%`;

export default function VotePlanner({
  collateral,
  plan,
  now,
  sampleRewardMicros,
  onSave,
  onSimulate,
  onPositions,
}: Props) {
  const [mode, setMode] = useState(plan.mode);
  const [weights, setWeights] = useState<Record<string, number>>(() =>
    plan.mode === 'manual' ? { ...plan.weights } : evenWeights(),
  );
  const power = collateral.reduce(
    (sum, asset) =>
      sum + votingPower(asset.underlyingBalance, asset.unlockDate, now),
    0,
  );
  const active = mode === 'optimizer' ? OPTIMIZER_WEIGHTS : weights;
  const draft: VotePlan = { version: 1, mode, weights: { ...active } };
  const projected = projectedRewardMicros(draft, power);
  const total = weightTotal(active);
  const changed =
    mode !== plan.mode ||
    (mode === 'manual' &&
      JSON.stringify(weights) !== JSON.stringify(plan.weights));
  const clock = epochAt(now);

  if (!collateral.length)
    return (
      <EmptyState
        icon={Layers3}
        title="Deposit collateral to plan votes."
        action={
          <button
            type="button"
            className="button secondary"
            onClick={onPositions}
          >
            Go to positions
          </button>
        }
      >
        Deposited positions vote each epoch. Their rewards pay down your credit
        line.
      </EmptyState>
    );

  return (
    <div className="vote-planner">
      <dl className="mini-stats">
        <div>
          <dt>Voting power</dt>
          <dd>{power.toLocaleString('en-GB')}</dd>
        </div>
        <div>
          <dt>Example reward / epoch</dt>
          <dd className="accent-text">{formatMicros(projected)}</dd>
        </div>
        <div>
          <dt>Sample reward history</dt>
          <dd>{formatMicros(sampleRewardMicros)}</dd>
        </div>
        <div>
          <dt>Next flip</dt>
          <dd>{formatFlip(clock.endMs)}</dd>
        </div>
      </dl>
      <fieldset className="segmented">
        <legend className="sr-only">Voting strategy</legend>
        {(
          [
            [
              'optimizer',
              'Reward optimizer',
              'Follows the strongest example pools',
            ],
            ['manual', 'Manual weights', 'Split votes yourself'],
          ] as const
        ).map(([value, label, text]) => (
          <label key={value} className="segment">
            <input
              type="radio"
              name="vote-mode"
              value={value}
              checked={mode === value}
              onChange={() => setMode(value)}
            />
            <span>
              <strong>{label}</strong>
              <small>{text}</small>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="table-scroll">
        <table className="data-table vote-table">
          <caption className="sr-only">
            Example pools, example reward rates and your planned weights
          </caption>
          <thead>
            <tr>
              <th scope="col">Pool</th>
              <th scope="col" className="numeric">
                Example reward / 1k votes
              </th>
              <th scope="col" className="numeric">
                Weight
              </th>
              <th scope="col" className="numeric">
                Example reward / epoch
              </th>
            </tr>
          </thead>
          <tbody>
            {EXAMPLE_POOLS.map((pool) => {
              const weight = active[pool.id] ?? 0;
              const reward =
                (BigInt(power) *
                  BigInt(weight) *
                  pool.rewardPerThousandMicros) /
                10_000_000n;
              return (
                <tr key={pool.id}>
                  <td data-label="Pool">
                    <span className="pool-name">
                      <span
                        className={`pool-dot ${pool.kind.toLowerCase()}`}
                        aria-hidden="true"
                      />
                      <strong>{pool.pair}</strong>
                      <span className="pill muted">{pool.kind}</span>
                    </span>
                  </td>
                  <td
                    data-label="Example reward / 1k votes"
                    className="numeric"
                  >
                    {formatMicros(pool.rewardPerThousandMicros)}
                  </td>
                  <td data-label="Weight" className="numeric">
                    {mode === 'manual' ? (
                      <span className="weight-input">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step={5}
                          inputMode="numeric"
                          aria-label={`Weight for ${pool.pair}, percent`}
                          value={weight / 100}
                          onChange={(event) => {
                            const value = Math.round(
                              Math.min(
                                100,
                                Math.max(0, Number(event.target.value) || 0),
                              ) * 100,
                            );
                            setWeights((current) => ({
                              ...current,
                              [pool.id]: value,
                            }));
                          }}
                        />
                        <span aria-hidden="true">%</span>
                      </span>
                    ) : (
                      percent(weight)
                    )}
                  </td>
                  <td data-label="Example reward / epoch" className="numeric">
                    {formatMicros(reward)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {mode === 'manual' && (
        <div className={`weight-total${total === 10_000 ? '' : ' invalid'}`}>
          <span>
            Total weight <strong>{percent(total)}</strong>
            {total !== 10_000 && ' · weights must add up to 100%'}
          </span>
          <Meter
            value={total / 100}
            label="Total planned weight"
            tone={total > 10_000 ? 'danger' : 'accent'}
            size="thin"
          />
        </div>
      )}
      <div className="vote-actions">
        {mode === 'manual' && (
          <button
            type="button"
            className="button ghost"
            onClick={() => setWeights(evenWeights())}
          >
            <RotateCcw size={15} aria-hidden="true" /> Even split
          </button>
        )}
        <button
          type="button"
          className="button secondary"
          onClick={() => onSimulate(projected)}
        >
          <Clock3 size={15} aria-hidden="true" /> Simulate an epoch with this
          plan
        </button>
        <button
          type="button"
          className="button primary"
          disabled={!changed || (mode === 'manual' && total !== 10_000)}
          onClick={() => onSave(draft)}
        >
          <Save size={15} aria-hidden="true" /> Save plan
        </button>
      </div>
      <Notice>
        Example pools and reward rates for planning only. A saved plan stays in
        this browser and never casts a vote. Voting power scales with the time
        left on each lock.
      </Notice>
    </div>
  );
}
