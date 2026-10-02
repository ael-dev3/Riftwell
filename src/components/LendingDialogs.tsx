import { ArrowRight, Info, Layers3 } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import {
  COLLATERAL_LIMITS,
  SAMPLE_CREDIT_EPOCHS,
  SAMPLE_REWARD_MICROS,
} from '../data';
import {
  formatBalance,
  formatMicros,
  microsToDecimal,
  parseUSDCMicros,
} from '../domain';
import {
  getLendingMetrics,
  MAX_EPOCH_INPUT_MICROS,
  type LendingState,
} from '../lending';
import Dialog from './Dialog';
import type { LendingAction } from './Lending';

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
  borrow: 'Review borrowing',
  repay: 'Repay your balance',
  supply: 'Supply USDC',
  withdraw: 'Withdraw USDC',
  epoch: 'Simulate a reward epoch',
  how: 'How pooled lending works',
};
const min = (a: bigint, b: bigint) => (a < b ? a : b);

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
  const initialReward = state.collateralIds.reduce(
    (sum, id) => sum + BigInt(SAMPLE_REWARD_MICROS[id] ?? '0'),
    0n,
  );
  const [reward, setReward] = useState(microsToDecimal(initialReward));
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
          <dl className="details-list">
            <div>
              <dt>Supply &amp; shares</dt>
              <dd>
                Supplying USDC adds liquid funds to a shared vault and gives you
                shares. Your share value includes both cash and outstanding loan
                principal.
              </dd>
            </div>
            <div>
              <dt>Variable rewards</dt>
              <dd>
                Net revenue received by the pool can increase share value. No
                historical yield rate or forecast is provided; future returns
                may vary or be zero.
              </dd>
            </div>
            <div>
              <dt>Withdrawals</dt>
              <dd>
                Redeeming burns shares and returns available USDC. Your
                withdrawal is bounded by your share value and the vault’s liquid
                funds. At full utilization, repayment or new supply must restore
                liquidity.
              </dd>
            </div>
            <div>
              <dt>Borrowing</dt>
              <dd>
                Deposited collateral creates a portfolio credit limit based on
                an example net reward history. Drawing USDC creates debt; net
                collateral rewards can reduce it over variable time.
              </dd>
            </div>
          </dl>
          <div className="notice">
            <Info size={17} aria-hidden="true" />
            <p>
              Everything here is a local simulation. The displayed vault and
              collateral policy are not live or verified on-chain.
            </p>
          </div>
        </div>
        <div className="dialog-footer">
          <button className="button primary" onClick={onClose}>
            Got it <ArrowRight size={16} aria-hidden="true" />
          </button>
        </div>
      </Dialog>
    );

  return (
    <Dialog
      title={titles[action.kind]}
      kicker="USDC · LOCAL PREVIEW"
      onClose={onClose}
    >
      <form onSubmit={submit} noValidate>
        <div className="dialog-body">
          {isCollateral && (
            <div className="review-asset">
              <img
                className="dialog-image"
                src={action.asset.artwork}
                alt=""
                width="72"
                height="72"
              />
              <div>
                <p className="asset-collection">Separate demo account</p>
                <h3>{action.asset.name}</h3>
                <span className="text-muted">
                  {formatBalance(
                    action.asset.underlyingBalance,
                    action.asset.underlyingSymbol,
                  )}{' '}
                  · {action.asset.lockTerm} lock
                </span>
              </div>
            </div>
          )}
          {isAmount && (
            <div className="form-field">
              <div className="field-label">
                <label htmlFor="pooled-amount">
                  {action.kind === 'borrow'
                    ? 'Borrow amount'
                    : action.kind === 'repay'
                      ? 'Repayment amount'
                      : action.kind === 'supply'
                        ? 'Supply amount'
                        : 'Withdrawal amount'}
                </label>
                <button
                  type="button"
                  className="inline-link"
                  onClick={() => {
                    setAmount(microsToDecimal(maximum));
                    setError('');
                  }}
                >
                  Use max.
                </button>
              </div>
              <div className="amount-input">
                <input
                  ref={amountRef}
                  id="pooled-amount"
                  className="input-control"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  maxLength={24}
                  value={amount}
                  onChange={(event) => {
                    setAmount(event.target.value);
                    setError('');
                  }}
                  aria-invalid={Boolean(error)}
                  aria-describedby="pooled-amount-hint pooled-action-error"
                />
                <span>USDC</span>
              </div>
              <p className="form-hint" id="pooled-amount-hint">
                Maximum {formatMicros(maximum)}
                {action.kind === 'withdraw'
                  ? ' · bounded by your shares and liquid USDC'
                  : action.kind === 'borrow'
                    ? ' · credit and vault liquidity'
                    : ''}
              </p>
            </div>
          )}
          {action.kind === 'epoch' && (
            <>
              <p>
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
                    <span>USDC</span>
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
                    <span>USDC</span>
                  </div>
                  <p className="form-hint" id="pool-reward-hint">
                    Separate net revenue from other example pool positions,
                    after any deductions. Not the same repayment funds.
                  </p>
                </div>
              </div>
            </>
          )}
          <div className="cost-breakdown">
            {isCollateral && (
              <>
                <div className="breakdown-row">
                  <span>
                    Example net reward history
                    <small>Per 7-day epoch · not a forecast</small>
                  </span>
                  <strong>
                    {formatMicros(SAMPLE_REWARD_MICROS[action.asset.id])}
                  </strong>
                </div>
                <div className="breakdown-row">
                  <span>Illustrative credit policy</span>
                  <span>Reward × {SAMPLE_CREDIT_EPOCHS} epochs</span>
                </div>
                <div className="breakdown-row">
                  <span>
                    Portfolio credit after{' '}
                    {action.kind === 'deposit-collateral'
                      ? 'deposit'
                      : 'removal'}
                  </span>
                  <strong>
                    {formatMicros(
                      BigInt(metrics.totalCreditMicros) +
                        (action.kind === 'deposit-collateral' ? 1n : -1n) *
                          BigInt(COLLATERAL_LIMITS[action.asset.id]),
                    )}
                  </strong>
                </div>
                <div className="breakdown-row total">
                  <span>Existing debt</span>
                  <strong>{formatMicros(state.debtMicros)}</strong>
                </div>
              </>
            )}
            {action.kind === 'borrow' && (
              <>
                <div className="breakdown-row">
                  <span>Principal drawn</span>
                  <strong>{formatMicros(amountMicros)}</strong>
                </div>
                <div className="breakdown-row">
                  <span>
                    Origination fee<small>One-time 0.5% of principal</small>
                  </span>
                  <span>{formatMicros(fee)}</span>
                </div>
                <div className="breakdown-row">
                  <span>Added to demo balance</span>
                  <strong>{formatMicros(amountMicros - fee)}</strong>
                </div>
                <div className="breakdown-row total">
                  <span>Total debt after borrowing</span>
                  <strong>
                    {formatMicros(BigInt(state.debtMicros) + amountMicros)}
                  </strong>
                </div>
              </>
            )}
            {action.kind === 'repay' && (
              <>
                <div className="breakdown-row">
                  <span>Paid from demo balance</span>
                  <strong>{formatMicros(amountMicros)}</strong>
                </div>
                <div className="breakdown-row total">
                  <span>Debt remaining</span>
                  <strong>
                    {formatMicros(BigInt(state.debtMicros) - amountMicros)}
                  </strong>
                </div>
              </>
            )}
            {(action.kind === 'supply' || action.kind === 'withdraw') && (
              <>
                <div className="breakdown-row">
                  <span>
                    Shares {action.kind === 'supply' ? 'received' : 'burned'}
                  </span>
                  <strong>{microsToDecimal(quotedShares)}</strong>
                </div>
                <div className="breakdown-row">
                  <span>Demo balance after action</span>
                  <span>
                    {formatMicros(
                      BigInt(state.walletMicros) +
                        (action.kind === 'supply'
                          ? -amountMicros
                          : amountMicros),
                    )}
                  </span>
                </div>
                <div className="breakdown-row total">
                  <span>
                    {action.kind === 'supply'
                      ? 'Supply to vault'
                      : 'Receive from vault'}
                  </span>
                  <strong>{formatMicros(amountMicros)}</strong>
                </div>
              </>
            )}
            {action.kind === 'epoch' && (
              <>
                <div className="breakdown-row">
                  <span>Debt repaid by net rewards</span>
                  <strong>{formatMicros(repaidReward)}</strong>
                </div>
                <div className="breakdown-row">
                  <span>Net surplus to demo balance</span>
                  <strong>{formatMicros(rewardMicros - repaidReward)}</strong>
                </div>
                <div className="breakdown-row">
                  <span>Net lender revenue added to pool</span>
                  <span>{formatMicros(poolMicros)}</span>
                </div>
                <div className="breakdown-row total">
                  <span>Debt after epoch</span>
                  <strong>
                    {formatMicros(BigInt(state.debtMicros) - repaidReward)}
                  </strong>
                </div>
              </>
            )}
          </div>
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
          <div className="notice">
            <Info size={17} aria-hidden="true" />
            <p>
              Local simulation only. No wallet, real funds or collateral
              custody. Example rewards are not guaranteed.
            </p>
          </div>
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
        <p className="sr-only">
          <Layers3 aria-hidden="true" /> Saved locally to this browser.
        </p>
      </form>
    </Dialog>
  );
}
