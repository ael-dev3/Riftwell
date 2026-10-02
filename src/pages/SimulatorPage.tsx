import { RotateCcw } from 'lucide-react';
import { useId, useMemo, useState, type CSSProperties } from 'react';
import { useMinuteClock } from '../app/clock';
import { Notice } from '../components/ui/Bits';
import { PageHead } from '../components/page';
import { AreaChart } from '../components/ui/Charts';
import CountUp from '../components/ui/CountUp';
import { ASSETS, SAMPLE_CREDIT_EPOCHS, SAMPLE_REWARD_MICROS } from '../data';
import {
  formatBalance,
  formatDate,
  formatMicros,
  parseUSDCMicros,
  roundAmount,
} from '../domain';
import { epochAt, epochStartMs } from '../epoch';
import { usd } from '../format';
import type { Market } from '../markets';
import { simulateRepayment, thinSchedule } from '../simulator';

type Range = {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  display: string;
  hint?: string;
};

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  display,
  hint,
}: Range) {
  const id = useId();
  const progress = ((value - min) / (max - min)) * 100;
  return (
    <div className="form-field">
      <div className="field-label">
        <label htmlFor={id}>{label}</label>
        <output htmlFor={id} className="slider-value">
          {display}
        </output>
      </div>
      <input
        id={id}
        className="range"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={display}
        style={{ '--fill': `${progress}%` } as CSSProperties}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      {hint && <p className="form-hint">{hint}</p>}
    </div>
  );
}

const DEFAULTS = {
  source: 'rift-018',
  reward: '80',
  epochs: SAMPLE_CREDIT_EPOCHS,
  borrowPct: 50,
  share: 100,
  change: 0,
};

export default function SimulatorPage({ market }: { market: Market }) {
  const now = useMinuteClock();
  const [source, setSource] = useState(DEFAULTS.source);
  const [reward, setReward] = useState(DEFAULTS.reward);
  const [epochs, setEpochs] = useState(DEFAULTS.epochs);
  const [borrowPct, setBorrowPct] = useState(DEFAULTS.borrowPct);
  const [share, setShare] = useState(DEFAULTS.share);
  const [change, setChange] = useState(DEFAULTS.change);
  const rewardMicros = parseUSDCMicros(reward);
  const rewardValid =
    rewardMicros !== null && rewardMicros <= 1_000_000_000_000n;
  const credit = rewardValid ? rewardMicros * BigInt(epochs) : 0n;
  const borrowMicros = (credit * BigInt(borrowPct)) / 100n;
  const result = useMemo(
    () =>
      simulateRepayment({
        rewardMicros: rewardValid ? rewardMicros : 0n,
        creditEpochs: epochs,
        borrowMicros,
        repaymentShareBps: share * 100,
        rewardChangeBps: change * 100,
      }),
    [rewardValid, rewardMicros, epochs, borrowMicros, share, change],
  );
  const weeklyReward = rewardValid ? rewardMicros : 0n;
  const appliedReward = (weeklyReward * BigInt(share)) / 100n;
  const clock = epochAt(now);
  const points = thinSchedule(result.schedule, 60);
  const payoff =
    result.epochsToRepay !== null && result.epochsToRepay > 0
      ? formatDate(
          new Date(
            epochStartMs(clock.period + result.epochsToRepay),
          ).toISOString(),
        )
      : null;

  function reset() {
    setSource(DEFAULTS.source);
    setReward(DEFAULTS.reward);
    setEpochs(DEFAULTS.epochs);
    setBorrowPct(DEFAULTS.borrowPct);
    setShare(DEFAULTS.share);
    setChange(DEFAULTS.change);
  }

  return (
    <>
      <PageHead
        eyebrow="REPAYMENT SIMULATOR"
        title="See how rewards repay credit"
        lede="Set a weekly reward, a credit policy and stress assumptions. The projection is arithmetic on your inputs, not a loan quote."
        actions={
          <button type="button" className="button ghost" onClick={reset}>
            <RotateCcw size={15} aria-hidden="true" /> Reset inputs
          </button>
        }
      />
      <div className="sim-layout">
        <section
          className="panel sim-inputs"
          aria-labelledby="sim-inputs-title"
        >
          <h2 id="sim-inputs-title" className="panel-title">
            Assumptions
          </h2>
          <div className="form-field">
            <label className="field-label" htmlFor="sim-source">
              Start from
            </label>
            <select
              id="sim-source"
              className="input-control"
              value={source}
              onChange={(event) => {
                setSource(event.target.value);
                const asset = ASSETS.find(
                  (item) => item.id === event.target.value,
                );
                if (asset)
                  setReward(
                    String(roundAmount(BigInt(SAMPLE_REWARD_MICROS[asset.id]))),
                  );
              }}
            >
              {ASSETS.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.name} ·{' '}
                  {formatBalance(
                    asset.underlyingBalance,
                    asset.underlyingSymbol,
                  )}
                </option>
              ))}
              <option value="custom">Custom reward</option>
            </select>
          </div>
          <div className="form-field">
            <label className="field-label" htmlFor="sim-reward">
              Net reward per epoch
            </label>
            <div className={`amount-input${rewardValid ? '' : ' invalid'}`}>
              <input
                id="sim-reward"
                className="input-control"
                inputMode="decimal"
                autoComplete="off"
                maxLength={20}
                value={reward}
                aria-invalid={!rewardValid}
                aria-describedby="sim-reward-hint"
                onChange={(event) => {
                  setReward(event.target.value);
                  setSource('custom');
                }}
              />
              <span className="amount-unit">USDC</span>
            </div>
            <p
              className={rewardValid ? 'form-hint' : 'form-error'}
              id="sim-reward-hint"
            >
              {rewardValid
                ? `Sample positions earn one USDC per 1,000 ${market.tokenSymbol} per epoch.`
                : 'Enter a plain decimal from 0 to 1,000,000 USDC.'}
            </p>
          </div>
          <Slider
            label="Credit policy"
            value={epochs}
            min={4}
            max={52}
            step={1}
            onChange={setEpochs}
            display={`${epochs} epochs`}
            hint={`Credit = reward × epochs. The preview uses ${SAMPLE_CREDIT_EPOCHS}.`}
          />
          <Slider
            label="Borrow"
            value={borrowPct}
            min={0}
            max={100}
            step={5}
            onChange={setBorrowPct}
            display={`${borrowPct}% of credit`}
          />
          <Slider
            label="Rewards applied to debt"
            value={share}
            min={0}
            max={100}
            step={5}
            onChange={setShare}
            display={`${share}%`}
            hint="Final lender and protocol revenue shares are set by the deployed contracts."
          />
          <Slider
            label="Reward change each epoch"
            value={change}
            min={-10}
            max={10}
            step={1}
            onChange={setChange}
            display={`${change > 0 ? '+' : ''}${change}%`}
            hint="Stress-test falling or rising rewards."
          />
        </section>
        <section
          className="panel sim-results"
          aria-labelledby="sim-results-title"
        >
          <h2 id="sim-results-title" className="panel-title">
            Projection
          </h2>
          <p className="sr-only" aria-live="polite">
            {`Credit ${formatMicros(result.creditMicros)}. You receive ${formatMicros(result.netMicros)}. ${
              result.principalMicros === 0n
                ? 'Nothing borrowed.'
                : result.epochsToRepay === null
                  ? 'Not repaid within ten years.'
                  : `About ${result.epochsToRepay} epochs to repay.`
            }`}
          </p>
          <dl className="sim-figures">
            <div>
              <dt>Credit limit</dt>
              <dd>
                <CountUp
                  value={roundAmount(result.creditMicros)}
                  format={(value) => `${usd(value)} USDC`}
                  exact={formatMicros(result.creditMicros)}
                />
              </dd>
            </div>
            <div className="featured">
              <dt>You receive</dt>
              <dd>
                <CountUp
                  value={roundAmount(result.netMicros)}
                  format={(value) => `${usd(value)} USDC`}
                  exact={formatMicros(result.netMicros)}
                />
              </dd>
            </div>
            <div>
              <dt>Origination fee</dt>
              <dd>{formatMicros(result.feeMicros)}</dd>
            </div>
            <div>
              <dt>Epochs to repay</dt>
              <dd>
                {result.principalMicros === 0n
                  ? 'Nothing borrowed'
                  : result.epochsToRepay === null
                    ? 'Not within 10 years'
                    : `About ${result.epochsToRepay}`}
              </dd>
            </div>
            <div>
              <dt>Clears around</dt>
              <dd>{payoff ?? '—'}</dd>
            </div>
            <div>
              <dt>Rewards applied</dt>
              <dd>{formatMicros(result.totalRepaidMicros)}</dd>
            </div>
          </dl>
          <section className="reward-split" aria-labelledby="split-title">
            <div className="split-head">
              <h3 id="split-title">Weekly reward split</h3>
              <strong>{formatMicros(weeklyReward)}</strong>
            </div>
            <div className="split-bar" aria-hidden="true">
              <span className="debt" style={{ width: `${share}%` }} />
              <span className="other" style={{ width: `${100 - share}%` }} />
            </div>
            <dl className="split-legend">
              <div>
                <dt>
                  <i className="debt" aria-hidden="true" /> Repays debt
                </dt>
                <dd>{formatMicros(appliedReward)}</dd>
              </div>
              <div>
                <dt>
                  <i className="other" aria-hidden="true" /> Lender and protocol
                  shares
                </dt>
                <dd>{formatMicros(weeklyReward - appliedReward)}</dd>
              </div>
            </dl>
            <p className="form-hint">
              First epoch at your assumptions. Final revenue shares are set by
              the deployed contracts.
            </p>
          </section>
          {result.principalMicros > 0n ? (
            <AreaChart
              ariaLabel={`Projected debt falling from ${formatMicros(result.principalMicros)} ${
                result.epochsToRepay === null
                  ? 'without clearing in ten years'
                  : `to zero after about ${result.epochsToRepay} epochs`
              }`}
              labels={points.map((point) => `Epoch ${point.epoch}`)}
              format={(value) => `${usd(value)} USDC`}
              series={[
                {
                  label: 'Debt remaining',
                  values: points.map((point) => roundAmount(point.debtMicros)),
                },
              ]}
            />
          ) : (
            <p className="panel-text">
              Move the borrow slider to project a balance.
            </p>
          )}
          <Notice>
            Illustrative arithmetic on your assumptions. Actual credit policy,
            revenue shares and rewards are set at launch and can change every
            epoch. Repayment is not guaranteed.
          </Notice>
        </section>
      </div>
    </>
  );
}
