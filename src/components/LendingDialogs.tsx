import { ArrowRight } from 'lucide-react';
import { useRef, useState, type CSSProperties, type FormEvent } from 'react';
import {
  assetById,
  collateralLimits,
  creditMicros,
  positionView,
  rewardMicros as exampleReward,
  SAMPLE_CREDIT_EPOCHS,
} from '../data';
import {
  formatBalance,
  formatDate,
  formatMicros,
  microsToDecimal,
  parseUSDCMicros,
  type Asset,
} from '../domain';
import { formatShares, relayerStrategyLabel } from '../format';
import {
  getLendingMetrics,
  MAX_EPOCH_INPUT_MICROS,
  type LendingState,
} from '../lending';
import type { LendingAction } from '../preview/actions';
import Dialog from './Dialog';
import { AmountField, AssetSummary, Breakdown, Notice } from './ui/Bits';
import { Meter } from './ui/Meter';

export type LendingActionInput = {
  amountMicros?: string;
  collateralRewardMicros?: string;
  poolYieldMicros?: string;
  relayerRewardMicros?: string;
  mergeSourceId?: string;
  lockUnits?: string;
  repayBps?: string;
};
type Props = {
  action: LendingAction;
  state: LendingState;
  /** Idle wallet positions, which can be merged into collateral. */
  wallet: readonly Asset[];
  onClose: () => void;
  onApply: (input: LendingActionInput) => string | null;
};
const titles: Readonly<Record<LendingAction['kind'], string>> = {
  'deposit-collateral': 'Deposit collateral',
  'remove-collateral': 'Remove collateral',
  borrow: 'Borrow USDC',
  repay: 'Repay your balance',
  supply: 'Supply USDC',
  withdraw: 'Withdraw USDC',
  epoch: 'Simulate a reward epoch',
  how: 'How pooled lending works',
  'relayer-deposit': 'Add to the reward relayer',
  'relayer-withdraw': 'Remove from the reward relayer',
  'relayer-strategy': 'Relayer reward strategy',
  merge: 'Merge into collateral',
  'increase-lock': 'Increase lock',
};
const min = (a: bigint, b: bigint) => (a < b ? a : b);
const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;
/** Whole token units; separators are allowed while typing. */
const parseUnits = (value: string) => {
  const plain = value.replace(/[\s,]/g, '');
  return /^[1-9][0-9]{0,8}$/.test(plain) ? BigInt(plain) : null;
};

export default function LendingActionDialog({
  action,
  state,
  wallet,
  onClose,
  onApply,
}: Props) {
  const metrics = getLendingMetrics(state, collateralLimits(state));
  const rewardOf = (ids: readonly string[]) =>
    ids.reduce((sum, id) => {
      const asset = assetById(id);
      return sum + (asset ? exampleReward(positionView(asset, state)) : 0n);
    }, 0n);
  const maximum =
    action.kind === 'borrow'
      ? BigInt(metrics.availableCreditMicros)
      : action.kind === 'repay'
        ? min(BigInt(state.debtMicros), BigInt(state.walletMicros))
        : action.kind === 'supply'
          ? BigInt(state.walletMicros)
          : action.kind === 'withdraw'
            ? BigInt(metrics.maxWithdrawMicros)
            : 0n;
  const [amount, setAmount] = useState(
    microsToDecimal(
      action.kind === 'supply' ? min(maximum, 1000_000000n) : maximum,
    ),
  );
  const sampleReward = rewardOf(state.collateralIds);
  const [reward, setReward] = useState(
    microsToDecimal(
      action.kind === 'epoch' && action.rewardMicros
        ? BigInt(action.rewardMicros)
        : sampleReward,
    ),
  );
  const relayerSample = rewardOf(state.relayerIds);
  const [relayerReward, setRelayerReward] = useState(
    microsToDecimal(relayerSample),
  );
  const [poolYield, setPoolYield] = useState('200');
  const [sourceId, setSourceId] = useState(wallet[0]?.id ?? '');
  const tokens = BigInt(state.tokenUnits);
  const [units, setUnits] = useState(tokens.toString());
  const [repayShare, setRepayShare] = useState(state.relayerRepayBps / 100);
  const [error, setError] = useState('');
  const amountRef = useRef<HTMLInputElement>(null);
  const rewardRef = useRef<HTMLInputElement>(null);
  const relayerRef = useRef<HTMLInputElement>(null);
  const poolYieldRef = useRef<HTMLInputElement>(null);
  const unitsRef = useRef<HTMLInputElement>(null);
  const source = wallet.find((asset) => asset.id === sourceId);
  const unitsParsed = parseUnits(units);
  const unitsValid =
    unitsParsed !== null && unitsParsed <= tokens ? unitsParsed : 0n;
  const parsed = parseUSDCMicros(amount);
  const amountMicros = parsed !== null && parsed <= maximum ? parsed : 0n;
  const fee = (amountMicros * 5n) / 1000n;
  const rewardParsed = parseUSDCMicros(reward);
  const poolParsed = parseUSDCMicros(poolYield);
  const relayerParsed = parseUSDCMicros(relayerReward);
  const relayerMicros =
    state.relayerIds.length &&
    relayerParsed !== null &&
    relayerParsed <= BigInt(MAX_EPOCH_INPUT_MICROS)
      ? relayerParsed
      : 0n;
  const rewardMicros =
    state.collateralIds.length &&
    rewardParsed !== null &&
    rewardParsed <= BigInt(MAX_EPOCH_INPUT_MICROS)
      ? rewardParsed
      : 0n;
  const poolMicros =
    poolParsed !== null && poolParsed <= BigInt(MAX_EPOCH_INPUT_MICROS)
      ? poolParsed
      : 0n;
  const repaidReward = min(rewardMicros, BigInt(state.debtMicros));
  const relayerRepay = min(
    (relayerMicros * BigInt(state.relayerRepayBps)) / 10_000n,
    BigInt(state.debtMicros) - repaidReward,
  );
  // The strategy example uses this epoch's example relayer rewards, or 100 USDC.
  const strategyBase = relayerSample > 0n ? relayerSample : 100_000000n;
  const strategyRepay = min(
    (strategyBase * BigInt(repayShare)) / 100n,
    BigInt(state.debtMicros),
  );
  const shares = BigInt(state.totalSharesRaw);
  const assets = BigInt(metrics.totalAssetsMicros);
  const quotedShares =
    action.kind === 'withdraw'
      ? (amountMicros * shares + assets - 1n) / assets
      : (amountMicros * shares) / assets;
  const isCollateral =
    action.kind === 'deposit-collateral' || action.kind === 'remove-collateral';
  const isRelayer =
    action.kind === 'relayer-deposit' || action.kind === 'relayer-withdraw';
  const isAmount = ['borrow', 'repay', 'supply', 'withdraw'].includes(
    action.kind,
  );
  const credit = BigInt(metrics.totalCreditMicros);
  const debtAfterBorrow = BigInt(state.debtMicros) + amountMicros;
  const symbol = 'asset' in action ? action.asset.underlyingSymbol : '';
  const growth =
    action.kind === 'merge'
      ? (source?.underlyingBalance ?? 0)
      : action.kind === 'increase-lock'
        ? Number(unitsValid)
        : 0;
  const grown =
    'asset' in action
      ? {
          ...action.asset,
          underlyingBalance: action.asset.underlyingBalance + growth,
        }
      : null;
  const blocked =
    (action.kind === 'merge' && !wallet.length) ||
    (action.kind === 'increase-lock' && tokens === 0n);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    let input: LendingActionInput = {};
    if (isAmount) {
      if (parsed === null || parsed <= 0n || parsed > maximum) {
        setError(
          parsed === null
            ? 'Use a plain decimal amount with up to six decimal places.'
            : `Enter an amount above zero and up to ${formatMicros(maximum)}.`,
        );
        amountRef.current?.focus();
        return;
      }
      input = { amountMicros: parsed.toString() };
    } else if (action.kind === 'epoch') {
      if (
        rewardParsed === null ||
        rewardParsed > BigInt(MAX_EPOCH_INPUT_MICROS)
      ) {
        setError(
          'Enter a collateral reward from 0 to 1,000 USDC, with up to six decimal places.',
        );
        rewardRef.current?.focus();
        return;
      }
      if (
        state.relayerIds.length &&
        (relayerParsed === null ||
          relayerParsed > BigInt(MAX_EPOCH_INPUT_MICROS))
      ) {
        setError(
          'Enter a relayer reward from 0 to 1,000 USDC, with up to six decimal places.',
        );
        relayerRef.current?.focus();
        return;
      }
      if (poolParsed === null || poolParsed > BigInt(MAX_EPOCH_INPUT_MICROS)) {
        setError(
          'Enter a pool reward from 0 to 1,000 USDC, with up to six decimal places.',
        );
        poolYieldRef.current?.focus();
        return;
      }
      input = {
        collateralRewardMicros: rewardParsed.toString(),
        poolYieldMicros: poolParsed.toString(),
        relayerRewardMicros: (relayerParsed ?? 0n).toString(),
      };
    } else if (action.kind === 'relayer-strategy') {
      input = { repayBps: String(repayShare * 100) };
    } else if (action.kind === 'merge') {
      if (!source) {
        setError('Choose a wallet position to merge.');
        return;
      }
      input = { mergeSourceId: source.id };
    } else if (action.kind === 'increase-lock') {
      if (unitsParsed === null || unitsParsed > tokens) {
        setError(
          `Enter a whole number of ${symbol} from 1 to ${formatBalance(Number(tokens), symbol)}.`,
        );
        unitsRef.current?.focus();
        return;
      }
      input = { lockUnits: unitsParsed.toString() };
    }
    const issue = onApply(input);
    if (issue) setError(issue);
  }

  if (action.kind === 'how')
    return (
      <Dialog
        title={titles.how}
        kicker="POOLED USDC · PREVIEW"
        onClose={onClose}
      >
        <div className="dialog-body">
          <ol className="steps">
            <li>
              <strong>Supply &amp; shares</strong>
              <p>
                Supplying USDC adds liquid funds to a shared vault and gives you
                shares. Your share value includes both cash and outstanding loan
                principal.
              </p>
            </li>
            <li>
              <strong>Borrowing</strong>
              <p>
                Deposited collateral creates a portfolio credit limit based on
                an example net reward history. Drawing USDC creates debt; net
                collateral rewards can reduce it over variable time.
              </p>
            </li>
            <li>
              <strong>Variable rewards</strong>
              <p>
                Net revenue received by the pool can increase share value. No
                historical yield rate or forecast is provided; future returns
                may vary or be zero.
              </p>
            </li>
            <li>
              <strong>Withdrawals</strong>
              <p>
                Redeeming burns shares and returns available USDC. Your
                withdrawal is bounded by your share value and the vault’s liquid
                funds. At full utilization, repayment or new supply must restore
                liquidity.
              </p>
            </li>
          </ol>
          <Notice>
            Everything here is a local simulation. The displayed vault and
            collateral policy are not live or verified on-chain.
          </Notice>
        </div>
        <div className="dialog-footer">
          <button className="button primary" onClick={onClose}>
            Got it <ArrowRight size={16} aria-hidden="true" />
          </button>
        </div>
      </Dialog>
    );

  const amountLabel =
    action.kind === 'borrow'
      ? 'Borrow amount'
      : action.kind === 'repay'
        ? 'Repayment amount'
        : action.kind === 'supply'
          ? 'Supply amount'
          : 'Withdrawal amount';

  return (
    <Dialog
      title={titles[action.kind]}
      kicker={`${'asset' in action ? 'POSITION' : 'USDC'} · LOCAL PREVIEW`}
      onClose={onClose}
    >
      <form onSubmit={submit} noValidate>
        <div className="dialog-body">
          {'asset' in action && (
            <AssetSummary
              asset={action.asset}
              kicker={
                action.kind === 'remove-collateral' ||
                action.kind === 'merge' ||
                action.kind === 'increase-lock'
                  ? 'Deposited collateral'
                  : action.kind === 'relayer-withdraw'
                    ? 'In the reward relayer'
                    : 'From your demo wallet'
              }
            />
          )}
          {isAmount && (
            <AmountField
              id="pooled-amount"
              label={amountLabel}
              value={amount}
              onChange={(value) => {
                setAmount(value);
                setError('');
              }}
              maximum={maximum}
              hint={`Maximum ${formatMicros(maximum)}${
                action.kind === 'withdraw'
                  ? ' · bounded by your shares and liquid USDC'
                  : action.kind === 'borrow'
                    ? ' · credit and vault liquidity'
                    : ''
              }`}
              error={Boolean(error)}
              inputRef={amountRef}
              describedBy="pooled-amount-hint pooled-action-error"
            />
          )}
          {action.kind === 'epoch' && (
            <>
              <p className="dialog-lede">
                Choose net amounts for one example 7-day period, after any
                reward fee deductions. Zero repayment rewards leave debt
                unchanged. These inputs do not predict the next real epoch or
                calculate a live reward fee schedule.
              </p>
              <div className="form-grid">
                <div className="form-field">
                  <label className="field-label" htmlFor="collateral-reward">
                    Net rewards for repayment
                  </label>
                  <div className="amount-input">
                    <input
                      ref={rewardRef}
                      id="collateral-reward"
                      className="input-control"
                      inputMode="decimal"
                      type="text"
                      maxLength={24}
                      disabled={!state.collateralIds.length}
                      value={reward}
                      onChange={(event) => {
                        setReward(event.target.value);
                        setError('');
                      }}
                      aria-describedby="epoch-reward-hint pooled-action-error"
                    />
                    <span className="amount-unit">USDC</span>
                  </div>
                  <p className="form-hint" id="epoch-reward-hint">
                    {state.collateralIds.length
                      ? 'Debt is repaid first; any surplus goes to your demo balance.'
                      : 'Deposit collateral to simulate your rewards.'}
                  </p>
                </div>
                {state.relayerIds.length > 0 && (
                  <div className="form-field">
                    <label className="field-label" htmlFor="relayer-reward">
                      Net relayer rewards
                    </label>
                    <div className="amount-input">
                      <input
                        ref={relayerRef}
                        id="relayer-reward"
                        className="input-control"
                        inputMode="decimal"
                        type="text"
                        maxLength={24}
                        value={relayerReward}
                        onChange={(event) => {
                          setRelayerReward(event.target.value);
                          setError('');
                        }}
                        aria-describedby="relayer-reward-hint pooled-action-error"
                      />
                      <span className="amount-unit">USDC</span>
                    </div>
                    <p className="form-hint" id="relayer-reward-hint">
                      Collected for {state.relayerIds.length} relayer{' '}
                      {state.relayerIds.length === 1 ? 'position' : 'positions'}
                      .{' '}
                      {state.relayerRepayBps === 0
                        ? 'Paid to your demo balance.'
                        : `${state.relayerRepayBps / 100}% repays remaining debt; the rest goes to your demo balance.`}
                    </p>
                  </div>
                )}
                <div className="form-field">
                  <label className="field-label" htmlFor="pool-reward">
                    Net lender revenue
                  </label>
                  <div className="amount-input">
                    <input
                      ref={poolYieldRef}
                      id="pool-reward"
                      className="input-control"
                      inputMode="decimal"
                      type="text"
                      maxLength={24}
                      value={poolYield}
                      onChange={(event) => {
                        setPoolYield(event.target.value);
                        setError('');
                      }}
                      aria-describedby="pool-reward-hint pooled-action-error"
                    />
                    <span className="amount-unit">USDC</span>
                  </div>
                  <p className="form-hint" id="pool-reward-hint">
                    Separate net revenue from other example pool positions,
                    after any deductions. Not the same repayment funds.
                  </p>
                </div>
              </div>
            </>
          )}
          {isCollateral && (
            <Breakdown
              rows={[
                {
                  label: 'Example net reward history',
                  hint: 'Per 7-day epoch · not a forecast',
                  value: formatMicros(exampleReward(action.asset)),
                  strong: true,
                },
                {
                  label: 'Illustrative credit policy',
                  value: `Reward × ${SAMPLE_CREDIT_EPOCHS} epochs`,
                },
                {
                  label: `Portfolio credit after ${
                    action.kind === 'deposit-collateral' ? 'deposit' : 'removal'
                  }`,
                  value: formatMicros(
                    credit +
                      (action.kind === 'deposit-collateral' ? 1n : -1n) *
                        creditMicros(action.asset),
                  ),
                  strong: true,
                },
                {
                  label: 'Existing debt',
                  value: formatMicros(state.debtMicros),
                  total: true,
                },
              ]}
            />
          )}
          {isRelayer && (
            <Breakdown
              rows={[
                {
                  label: 'Example net reward history',
                  hint: 'Per 7-day epoch · not a forecast',
                  value: formatMicros(exampleReward(action.asset)),
                  strong: true,
                },
                { label: 'Credit from this position', value: 'None' },
                {
                  label: 'Relayer positions after this change',
                  value: String(
                    state.relayerIds.length +
                      (action.kind === 'relayer-deposit' ? 1 : -1),
                  ),
                },
                {
                  label: 'Rewards paid to',
                  value: 'Your demo balance',
                  total: true,
                },
              ]}
            />
          )}
          {action.kind === 'relayer-strategy' && (
            <>
              <p className="dialog-lede">
                Choose how the relayer uses the rewards it collects. Collateral
                rewards repay your debt first each epoch; this share of relayer
                rewards then repays what remains, and the rest is paid to your
                demo balance.
              </p>
              <div className="form-field">
                <div className="field-label">
                  <label htmlFor="relayer-share">Share that repays debt</label>
                  <span className="quick-picks">
                    {[
                      [0, 'Pay out'],
                      [50, 'Half'],
                      [100, 'Repay debt'],
                    ].map(([share, label]) => (
                      <button
                        key={share}
                        type="button"
                        className="chip-button"
                        aria-pressed={repayShare === share}
                        onClick={() => setRepayShare(Number(share))}
                      >
                        {label}
                      </button>
                    ))}
                  </span>
                </div>
                <div className="share-range">
                  <input
                    id="relayer-share"
                    className="range"
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={repayShare}
                    aria-valuetext={`${repayShare}% repays debt, ${100 - repayShare}% paid out`}
                    aria-describedby="relayer-share-hint"
                    style={{ '--fill': `${repayShare}%` } as CSSProperties}
                    onChange={(event) =>
                      setRepayShare(Number(event.target.value))
                    }
                  />
                  <output htmlFor="relayer-share">{repayShare}%</output>
                </div>
                <p className="form-hint" id="relayer-share-hint">
                  {relayerStrategyLabel(repayShare * 100)} · applies from the
                  next simulated epoch
                  {BigInt(state.debtMicros) === 0n &&
                    ' · with no debt, rewards are paid out until you borrow'}
                </p>
              </div>
              <Breakdown
                rows={[
                  {
                    label: 'Example relayer rewards',
                    hint:
                      relayerSample > 0n
                        ? 'Your relayer positions, per epoch'
                        : 'For every 100 USDC collected',
                    value: formatMicros(strategyBase),
                  },
                  {
                    label: 'Toward your debt',
                    hint: 'Never more than the debt left',
                    value: formatMicros(strategyRepay),
                    strong: true,
                  },
                  {
                    label: 'Paid to your demo balance',
                    value: formatMicros(strategyBase - strategyRepay),
                    strong: true,
                  },
                  {
                    label: 'Debt now',
                    value: formatMicros(state.debtMicros),
                    total: true,
                  },
                ]}
              />
              <p className="form-hint">
                Simulated relayer amounts are net of any automation charge,
                which is set at launch. Swapping rewards into locked tokens is
                not simulated.
              </p>
            </>
          )}
          {action.kind === 'merge' &&
            (wallet.length ? (
              <>
                <div className="form-field">
                  <label className="field-label" htmlFor="merge-source">
                    Wallet position to merge
                  </label>
                  <select
                    id="merge-source"
                    className="input-control"
                    value={sourceId}
                    onChange={(event) => {
                      setSourceId(event.target.value);
                      setError('');
                    }}
                    aria-describedby="merge-source-hint pooled-action-error"
                  >
                    {wallet.map((asset) => (
                      <option key={asset.id} value={asset.id}>
                        {asset.name} ·{' '}
                        {formatBalance(
                          asset.underlyingBalance,
                          asset.underlyingSymbol,
                        )}
                      </option>
                    ))}
                  </select>
                  <p className="form-hint" id="merge-source-hint">
                    It joins {action.asset.name} and stops existing as a
                    separate position.
                  </p>
                </div>
                {source && grown && (
                  <Breakdown
                    rows={[
                      {
                        label: 'Locked after merge',
                        value: formatBalance(grown.underlyingBalance, symbol),
                        strong: true,
                      },
                      {
                        label: 'Unlocks',
                        hint: 'The later of the two dates',
                        value: formatDate(
                          source.unlockDate > action.asset.unlockDate
                            ? source.unlockDate
                            : action.asset.unlockDate,
                        ),
                      },
                      {
                        label: 'Example net reward after merge',
                        hint: 'Per 7-day epoch · not a forecast',
                        value: formatMicros(exampleReward(grown)),
                      },
                      {
                        label: 'Portfolio credit after merge',
                        value: formatMicros(credit + creditMicros(source)),
                        strong: true,
                      },
                      {
                        label: 'Existing debt',
                        hint: 'Unchanged',
                        value: formatMicros(state.debtMicros),
                        total: true,
                      },
                    ]}
                  />
                )}
              </>
            ) : (
              <Notice>
                No positions are idle in your demo wallet. Buy one in the
                marketplace, or take one out of the relayer or a listing, to
                merge it here.
              </Notice>
            ))}
          {action.kind === 'increase-lock' &&
            (tokens > 0n ? (
              <>
                <AmountField
                  id="lock-units"
                  label={`${symbol} to add`}
                  value={units}
                  onChange={(value) => {
                    setUnits(value);
                    setError('');
                  }}
                  maximum={tokens}
                  toText={(value) => value.toString()}
                  unit={symbol}
                  hint={`Demo balance ${formatBalance(Number(tokens), symbol)} · whole units`}
                  error={Boolean(error)}
                  inputRef={unitsRef}
                  describedBy="lock-units-hint pooled-action-error"
                />
                {grown && (
                  <Breakdown
                    rows={[
                      {
                        label: 'Locked after increase',
                        value: formatBalance(grown.underlyingBalance, symbol),
                        strong: true,
                      },
                      {
                        label: 'Unlocks',
                        hint: 'Unchanged',
                        value: formatDate(action.asset.unlockDate),
                      },
                      {
                        label: 'Example net reward after increase',
                        hint: 'Per 7-day epoch · not a forecast',
                        value: formatMicros(exampleReward(grown)),
                      },
                      {
                        label: 'Portfolio credit after increase',
                        value: formatMicros(
                          credit +
                            creditMicros(grown) -
                            creditMicros(action.asset),
                        ),
                        strong: true,
                      },
                      {
                        label: `Demo ${symbol} left`,
                        value: formatBalance(
                          Number(tokens - unitsValid),
                          symbol,
                        ),
                        total: true,
                      },
                    ]}
                  />
                )}
              </>
            ) : (
              <Notice>
                All of your demo {symbol} is already locked. Reset the preview
                to start over with a fresh balance.
              </Notice>
            ))}
          {action.kind === 'borrow' && (
            <>
              <Breakdown
                rows={[
                  {
                    label: 'Principal drawn',
                    value: formatMicros(amountMicros),
                    strong: true,
                  },
                  {
                    label: 'Origination fee',
                    hint: 'One-time 0.5% of principal',
                    value: formatMicros(fee),
                  },
                  {
                    label: 'Added to demo balance',
                    value: formatMicros(amountMicros - fee),
                    strong: true,
                  },
                  {
                    label: 'Total debt after borrowing',
                    value: formatMicros(debtAfterBorrow),
                    total: true,
                  },
                ]}
              />
              <div className="credit-after">
                <div className="credit-after-head">
                  <span>Credit used after borrowing</span>
                  <strong>
                    {credit > 0n
                      ? `${(Number((debtAfterBorrow * 10_000n) / credit) / 100).toFixed(2)}%`
                      : '—'}
                  </strong>
                </div>
                <Meter
                  value={
                    credit > 0n
                      ? Number((debtAfterBorrow * 10_000n) / credit) / 100
                      : 0
                  }
                  label="Credit used after borrowing"
                  tone={
                    credit > 0n && debtAfterBorrow * 100n >= credit * 85n
                      ? 'warning'
                      : 'accent'
                  }
                />
                {sampleReward > 0n && debtAfterBorrow > 0n && (
                  <p className="form-hint">
                    At the example reward of {formatMicros(sampleReward)} per
                    epoch, this balance would clear in about{' '}
                    {ceilDiv(debtAfterBorrow, sampleReward).toString()} epochs.
                    Real rewards vary.
                  </p>
                )}
              </div>
            </>
          )}
          {action.kind === 'repay' && (
            <Breakdown
              rows={[
                {
                  label: 'Paid from demo balance',
                  value: formatMicros(amountMicros),
                  strong: true,
                },
                {
                  label: 'Debt remaining',
                  value: formatMicros(BigInt(state.debtMicros) - amountMicros),
                  total: true,
                },
              ]}
            />
          )}
          {(action.kind === 'supply' || action.kind === 'withdraw') && (
            <Breakdown
              rows={[
                {
                  label: `Shares ${action.kind === 'supply' ? 'received' : 'burned'}`,
                  value: formatShares(quotedShares),
                  strong: true,
                },
                {
                  label: 'Demo balance after action',
                  value: formatMicros(
                    BigInt(state.walletMicros) +
                      (action.kind === 'supply' ? -amountMicros : amountMicros),
                  ),
                },
                {
                  label:
                    action.kind === 'supply'
                      ? 'Supply to vault'
                      : 'Receive from vault',
                  value: formatMicros(amountMicros),
                  total: true,
                },
              ]}
            />
          )}
          {action.kind === 'epoch' && (
            <Breakdown
              rows={[
                {
                  label: 'Debt repaid by net rewards',
                  value: formatMicros(repaidReward),
                  strong: true,
                },
                {
                  label: 'Net surplus to demo balance',
                  value: formatMicros(rewardMicros - repaidReward),
                  strong: true,
                },
                ...(state.relayerIds.length
                  ? [
                      {
                        label: 'Relayer rewards to demo balance',
                        value: formatMicros(relayerMicros - relayerRepay),
                        strong: true,
                      },
                      ...(state.relayerRepayBps > 0
                        ? [
                            {
                              label: 'Relayer rewards repaying debt',
                              hint: relayerStrategyLabel(state.relayerRepayBps),
                              value: formatMicros(relayerRepay),
                            },
                          ]
                        : []),
                    ]
                  : []),
                {
                  label: 'Net lender revenue added to pool',
                  value: formatMicros(poolMicros),
                },
                {
                  label: 'Debt after epoch',
                  value: formatMicros(
                    BigInt(state.debtMicros) - repaidReward - relayerRepay,
                  ),
                  total: true,
                },
              ]}
            />
          )}
          {action.kind === 'borrow' && (
            <p className="form-hint">
              The fee is deducted from proceeds and rounded down to six USDC
              decimal places. Rewards may repay debt over variable time; there
              is no fixed APR or maturity in this example.
            </p>
          )}
          {action.kind === 'deposit-collateral' && (
            <p className="form-hint">
              This opens an illustrative credit limit without drawing USDC.
              Collateral can be removed if the remaining portfolio credit covers
              all debt.
            </p>
          )}
          {action.kind === 'remove-collateral' && (
            <p className="form-hint">
              The remaining collateral must still cover your borrowed balance.
              No real NFT is transferred.
            </p>
          )}
          {action.kind === 'relayer-deposit' && (
            <p className="form-hint">
              The relayer collects this position’s rewards every epoch and pays
              them to your demo balance, with no borrowing. While it is in the
              relayer it cannot back a loan or be listed. Simulated amounts are
              net of any automation charge, which is set at launch.
            </p>
          )}
          {action.kind === 'relayer-withdraw' && (
            <p className="form-hint">
              The position returns to your demo wallet, where you can deposit it
              as collateral or list it. No real NFT is transferred.
            </p>
          )}
          {action.kind === 'merge' && wallet.length > 0 && (
            <p className="form-hint">
              Merging adds the locked balances together and keeps the later
              unlock date. It raises this position’s example credit and does not
              change your debt. It cannot be undone. No real NFT is merged.
            </p>
          )}
          {action.kind === 'increase-lock' && tokens > 0n && (
            <p className="form-hint">
              Adds demo {symbol} from your wallet to this lock, raising its
              example reward and credit without changing your debt or unlock
              date. No real tokens are locked.
            </p>
          )}
          <p className="form-error" id="pooled-action-error" role="alert">
            {error}
          </p>
          <Notice>
            Local simulation only. No wallet, real funds or collateral custody.
            Example rewards are not guaranteed.
          </Notice>
        </div>
        <div className="dialog-footer">
          <button className="button secondary" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" type="submit" disabled={blocked}>
            {action.kind === 'epoch'
              ? 'Apply example rewards'
              : action.kind === 'relayer-strategy'
                ? 'Save strategy'
                : action.kind === 'merge'
                  ? 'Merge in preview'
                  : action.kind === 'increase-lock'
                    ? 'Increase lock in preview'
                    : action.kind === 'deposit-collateral'
                      ? 'Deposit in preview'
                      : action.kind === 'relayer-deposit'
                        ? 'Add to relayer in preview'
                        : action.kind === 'relayer-withdraw'
                          ? 'Remove from relayer in preview'
                          : action.kind === 'remove-collateral'
                            ? 'Remove in preview'
                            : action.kind === 'borrow'
                              ? 'Borrow in preview'
                              : action.kind === 'repay'
                                ? 'Repay in preview'
                                : action.kind === 'supply'
                                  ? 'Supply in preview'
                                  : 'Withdraw in preview'}
            <ArrowRight size={16} aria-hidden="true" />
          </button>
        </div>
      </form>
    </Dialog>
  );
}
