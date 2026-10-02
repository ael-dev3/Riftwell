import { ArrowRight } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import {
  COLLATERAL_LIMITS,
  SAMPLE_CREDIT_EPOCHS,
  SAMPLE_REWARD_MICROS,
} from '../data';
import { formatMicros, microsToDecimal, parseUSDCMicros } from '../domain';
import { formatShares } from '../format';
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
};
type Props = {
  action: LendingAction;
  state: LendingState;
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
};
const min = (a: bigint, b: bigint) => (a < b ? a : b);
const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

export default function LendingActionDialog({
  action,
  state,
  onClose,
  onApply,
}: Props) {
  const metrics = getLendingMetrics(state, COLLATERAL_LIMITS);
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
  const sampleReward = state.collateralIds.reduce(
    (sum, id) => sum + BigInt(SAMPLE_REWARD_MICROS[id] ?? '0'),
    0n,
  );
  const [reward, setReward] = useState(
    microsToDecimal(
      action.kind === 'epoch' && action.rewardMicros
        ? BigInt(action.rewardMicros)
        : sampleReward,
    ),
  );
  const [poolYield, setPoolYield] = useState('200');
  const [error, setError] = useState('');
  const amountRef = useRef<HTMLInputElement>(null);
  const rewardRef = useRef<HTMLInputElement>(null);
  const poolYieldRef = useRef<HTMLInputElement>(null);
  const parsed = parseUSDCMicros(amount);
  const amountMicros = parsed !== null && parsed <= maximum ? parsed : 0n;
  const fee = (amountMicros * 5n) / 1000n;
  const rewardParsed = parseUSDCMicros(reward);
  const poolParsed = parseUSDCMicros(poolYield);
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
  const shares = BigInt(state.totalSharesRaw);
  const assets = BigInt(metrics.totalAssetsMicros);
  const quotedShares =
    action.kind === 'withdraw'
      ? (amountMicros * shares + assets - 1n) / assets
      : (amountMicros * shares) / assets;
  const isCollateral = 'asset' in action;
  const isAmount = ['borrow', 'repay', 'supply', 'withdraw'].includes(
    action.kind,
  );
  const credit = BigInt(metrics.totalCreditMicros);
  const debtAfterBorrow = BigInt(state.debtMicros) + amountMicros;

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
      };
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
      kicker="USDC · LOCAL PREVIEW"
      onClose={onClose}
    >
      <form onSubmit={submit} noValidate>
        <div className="dialog-body">
          {isCollateral && (
            <AssetSummary
              asset={action.asset}
              kicker={
                action.kind === 'deposit-collateral'
                  ? 'From your demo wallet'
                  : 'Deposited collateral'
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
                  value: formatMicros(SAMPLE_REWARD_MICROS[action.asset.id]),
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
                        BigInt(COLLATERAL_LIMITS[action.asset.id]),
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
                {
                  label: 'Net lender revenue added to pool',
                  value: formatMicros(poolMicros),
                },
                {
                  label: 'Debt after epoch',
                  value: formatMicros(BigInt(state.debtMicros) - repaidReward),
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
          <button className="button primary" type="submit">
            {action.kind === 'epoch'
              ? 'Apply example rewards'
              : action.kind === 'deposit-collateral'
                ? 'Deposit in preview'
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
