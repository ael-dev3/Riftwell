import { ArrowRight, Check, Info, Layers3 } from 'lucide-react';
import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  calculateLoan,
  formatAmount,
  formatBalance,
  formatDate,
  LOAN_DURATIONS,
  marketplaceFee,
  marketplaceProceeds,
  maxBorrowAmount,
  MAX_APR,
  parseUSDCMicros,
  roundAmount,
  validateApr,
  validateLoan,
  type Asset,
  type BorrowReceipt,
  type LendReceipt,
  type LoanDuration,
  type PurchaseReceipt,
  type Receipt,
} from '../domain';
import Dialog from './Dialog';

const receiptIdentity = (asset: Asset) => ({
  id: crypto.randomUUID(),
  assetId: asset.id,
  createdAt: new Date().toISOString(),
});
type AssetDialogProps = { asset: Asset; onClose: () => void };

function PreviewNotice({ children }: { children?: ReactNode }) {
  return (
    <div className="notice">
      <Info size={17} aria-hidden="true" />
      <p>
        {children ??
          'Preview only. No wallet connection, signatures or real transactions.'}
      </p>
    </div>
  );
}

export function AssetDetails({
  asset,
  onClose,
  onPurchase,
}: AssetDialogProps & { onPurchase: () => void }) {
  return (
    <Dialog title={asset.name} kicker={asset.collection} onClose={onClose} wide>
      <div className="dialog-body detail-layout">
        <img
          className="detail-art"
          src={asset.artwork}
          alt={`Portal illustration for ${asset.name}`}
          width="640"
          height="640"
        />
        <div className="detail-copy">
          <span className="asset-kind">{asset.category}</span>
          <p>{asset.description}</p>
          <dl className="detail-stats">
            <div className="detail-stat">
              <dt>Position ID</dt>
              <dd>#{asset.positionId}</dd>
            </div>
            <div className="detail-stat">
              <dt>Locked balance</dt>
              <dd>
                {formatBalance(asset.underlyingBalance, asset.underlyingSymbol)}
              </dd>
            </div>
            <div className="detail-stat">
              <dt>Lock term</dt>
              <dd>{asset.lockTerm}</dd>
            </div>
            <div className="detail-stat">
              <dt>Unlock date</dt>
              <dd>{formatDate(asset.unlockDate)}</dd>
            </div>
            <div className="detail-stat">
              <dt>Illustrative ask</dt>
              <dd>{formatAmount(asset.price)}</dd>
            </div>
            <div className="detail-stat">
              <dt>Reference value</dt>
              <dd>{formatAmount(asset.referenceValue)}</dd>
            </div>
          </dl>
          <PreviewNotice>
            Demo veKITTEN position and sample KITTEN units. No live balance,
            lock verification or yield data.
          </PreviewNotice>
        </div>
      </div>
      <div className="dialog-footer">
        <button className="button secondary" onClick={onClose}>
          Back to positions
        </button>
        <button className="button primary" onClick={onPurchase}>
          Review purchase <ArrowRight size={16} aria-hidden="true" />
        </button>
      </div>
    </Dialog>
  );
}

export function PurchaseDialog({
  asset,
  onClose,
  onSave,
}: AssetDialogProps & { onSave: (receipt: PurchaseReceipt) => void }) {
  const fee = marketplaceFee(asset.price);
  return (
    <Dialog title="Review purchase" kicker="USDC · PREVIEW" onClose={onClose}>
      <div className="dialog-body">
        <div className="review-asset">
          <img
            className="dialog-image"
            src={asset.artwork}
            alt=""
            width="84"
            height="84"
          />
          <div>
            <p className="asset-collection">{asset.collection}</p>
            <h3>{asset.name}</h3>
            <span className="text-muted">
              {formatBalance(asset.underlyingBalance, asset.underlyingSymbol)} ·{' '}
              {asset.lockTerm} lock
            </span>
          </div>
        </div>
        <div className="cost-breakdown">
          <div className="breakdown-row">
            <span>Ask price</span>
            <strong>{formatAmount(asset.price)}</strong>
          </div>
          <div className="breakdown-row">
            <span>
              Seller fee <small>0.5%, paid by seller</small>
            </span>
            <span>{formatAmount(fee)}</span>
          </div>
          <div className="breakdown-row">
            <span>Seller receives</span>
            <span>{formatAmount(marketplaceProceeds(asset.price))}</span>
          </div>
          <div className="breakdown-row total">
            <span>Your preview total</span>
            <strong>{formatAmount(asset.price)}</strong>
          </div>
        </div>
        <PreviewNotice>
          Save a sample receipt to this browser. No funds move and no NFT
          changes ownership.
        </PreviewNotice>
      </div>
      <div className="dialog-footer">
        <button className="button secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          className="button primary"
          onClick={() =>
            onSave({
              ...receiptIdentity(asset),
              kind: 'purchase',
              price: asset.price,
              sellerFee: fee,
            })
          }
        >
          Save preview purchase <ArrowRight size={16} aria-hidden="true" />
        </button>
      </div>
    </Dialog>
  );
}

type LoanDialogProps = AssetDialogProps & {
  kind: 'borrow' | 'lend';
  onSave: (receipt: BorrowReceipt | LendReceipt) => void;
};
type FormError = { field: 'amount' | 'apr'; message: string };

export function LoanDialog({ asset, kind, onClose, onSave }: LoanDialogProps) {
  const isBorrow = kind === 'borrow';
  const maximum = maxBorrowAmount(asset);
  const [amount, setAmount] = useState(String(maximum));
  const [duration, setDuration] = useState<LoanDuration>(30);
  const [apr, setApr] = useState(String(asset.apr));
  const [error, setError] = useState<FormError | null>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const aprRef = useRef<HTMLInputElement>(null);
  const amountMicros = parseUSDCMicros(amount);
  const safeAmount =
    amountMicros !== null && amountMicros <= parseUSDCMicros(String(maximum))!
      ? roundAmount(amountMicros)
      : 0;
  const safeApr = isBorrow
    ? asset.apr
    : validateApr(apr) === null
      ? Number(apr)
      : 0;
  const costs = calculateLoan(safeAmount, safeApr, duration);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amountError = validateLoan(amount, duration, maximum);
    if (amountError) {
      setError({ field: 'amount', message: amountError });
      amountRef.current?.focus();
      return;
    }
    const aprError = isBorrow ? null : validateApr(apr);
    if (aprError) {
      setError({ field: 'apr', message: aprError });
      aprRef.current?.focus();
      return;
    }
    const common = {
      ...receiptIdentity(asset),
      principal: safeAmount,
      apr: safeApr,
      duration,
      interest: costs.interest,
    };
    onSave(
      isBorrow
        ? {
            ...common,
            kind: 'borrow',
            originationFee: costs.originationFee,
            status: 'active',
          }
        : { ...common, kind: 'lend', status: 'proposed' },
    );
  }

  return (
    <Dialog
      title={isBorrow ? 'Review loan' : 'Lending proposal'}
      kicker="USDC · PREVIEW"
      onClose={onClose}
    >
      <form onSubmit={submit} noValidate>
        <div className="dialog-body">
          <div className="review-asset">
            <img
              className="dialog-image"
              src={asset.artwork}
              alt=""
              width="72"
              height="72"
            />
            <div>
              <p className="asset-collection">{asset.collection}</p>
              <h3>{asset.name}</h3>
              <span className="text-muted">
                {asset.lockTerm} lock ·{' '}
                {isBorrow ? 'separate demo account' : 'fictional request'}
              </span>
            </div>
          </div>
          <div className="form-grid">
            <div className="form-field">
              <div className="field-label">
                <label htmlFor="loan-amount">
                  {isBorrow ? 'Borrow amount' : 'Proposed amount'}
                </label>
                <button
                  type="button"
                  className="inline-link"
                  onClick={() => {
                    setAmount(String(maximum));
                    setError(null);
                  }}
                >
                  Use max.
                </button>
              </div>
              <div className="amount-input">
                <input
                  ref={amountRef}
                  className="input-control"
                  id="loan-amount"
                  inputMode="decimal"
                  type="text"
                  autoComplete="off"
                  maxLength={18}
                  value={amount}
                  onChange={(event) => {
                    setAmount(event.target.value);
                    setError(null);
                  }}
                  aria-invalid={error?.field === 'amount'}
                  aria-describedby={`loan-amount-hint${error?.field === 'amount' ? ' loan-error' : ''}`}
                />
                <span>USDC</span>
              </div>
              <p className="form-hint" id="loan-amount-hint">
                {isBorrow ? 'Maximum: ' : 'Requested: '}
                {formatAmount(maximum)} · 40% of reference value
              </p>
            </div>
            <div className="form-field">
              <label className="field-label" htmlFor="loan-duration">
                Duration
              </label>
              <select
                className="input-control"
                id="loan-duration"
                value={duration}
                onChange={(event) => {
                  setDuration(Number(event.target.value) as LoanDuration);
                  setError(null);
                }}
              >
                {LOAN_DURATIONS.map((days) => (
                  <option key={days} value={days}>
                    {days} days
                  </option>
                ))}
              </select>
            </div>
            {!isBorrow && (
              <div className="form-field">
                <label className="field-label" htmlFor="loan-apr">
                  Proposed annual rate (%)
                </label>
                <input
                  ref={aprRef}
                  className="input-control"
                  id="loan-apr"
                  inputMode="decimal"
                  type="text"
                  autoComplete="off"
                  maxLength={6}
                  value={apr}
                  onChange={(event) => {
                    setApr(event.target.value);
                    setError(null);
                  }}
                  aria-invalid={error?.field === 'apr'}
                  aria-describedby={`loan-apr-hint${error?.field === 'apr' ? ' loan-error' : ''}`}
                />
                <p className="form-hint" id="loan-apr-hint">
                  Sample request: {asset.apr}% APR. Preview cap: {MAX_APR}%.
                </p>
              </div>
            )}
          </div>
          <div className="cost-breakdown">
            <div className="breakdown-row">
              <span>{isBorrow ? 'Illustrative APR' : 'Proposed APR'}</span>
              <strong>{safeApr}%</strong>
            </div>
            <div className="breakdown-row">
              <span>
                {isBorrow ? 'Origination fee' : 'Borrower origination fee'}
                <small>One-time 0.5% of principal</small>
              </span>
              <span>{formatAmount(costs.originationFee)}</span>
            </div>
            <div className="breakdown-row">
              <span>
                {isBorrow ? 'Lender interest' : 'Illustrative lender interest'}
                <small>{duration} days · simple interest</small>
              </span>
              <span>{formatAmount(costs.interest)}</span>
            </div>
            {isBorrow && (
              <div className="breakdown-row">
                <span>
                  Amount received<small>Principal minus origination fee</small>
                </span>
                <span>{formatAmount(costs.netProceeds)}</span>
              </div>
            )}
            <div className="breakdown-row total">
              <span>
                {isBorrow ? 'Repayment at term' : 'Proposed principal'}
                {isBorrow && <small>Principal + lender interest</small>}
              </span>
              <strong>
                {formatAmount(isBorrow ? costs.repayment : safeAmount)}
              </strong>
            </div>
          </div>
          <p className="form-hint">
            Fees and interest are rounded down to six USDC decimal places.
          </p>
          <p className="form-error" role="alert" id="loan-error">
            {error?.message}
          </p>
          <PreviewNotice>
            {isBorrow
              ? 'This simulates a loan and locks no collateral. Repayment and default rules for a live loan would depend on its final terms.'
              : 'This saves an unaccepted, unfunded proposal. Interest is illustrative; no return is promised.'}
          </PreviewNotice>
        </div>
        <div className="dialog-footer">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" type="submit">
            {isBorrow ? 'Save preview loan' : 'Save proposal'}{' '}
            <ArrowRight size={16} aria-hidden="true" />
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function SuccessDialog({
  receipt,
  asset,
  onClose,
  onAccount,
}: {
  receipt: Receipt;
  asset: Asset;
  onClose: () => void;
  onAccount: () => void;
}) {
  const purchased = receipt.kind === 'purchase';
  const borrowed = receipt.kind === 'borrow';
  return (
    <Dialog
      title={
        purchased
          ? 'Preview purchase saved'
          : borrowed
            ? 'Preview loan saved'
            : 'Lending proposal saved'
      }
      kicker="LOCAL RECEIPT"
      onClose={onClose}
    >
      <div className="dialog-body success-panel">
        <span className="success-icon">
          <Check size={28} aria-hidden="true" />
        </span>
        <p>
          {asset.name}{' '}
          {purchased
            ? 'has been added to your sample account.'
            : borrowed
              ? 'is recorded as demo collateral.'
              : 'has a sample lending proposal.'}
        </p>
        <div className="receipt-card">
          <div className="breakdown-row">
            <span>{purchased ? 'Illustrative ask' : 'Principal'}</span>
            <strong>
              {formatAmount(purchased ? receipt.price : receipt.principal)}
            </strong>
          </div>
          <div className="breakdown-row">
            <span>Status</span>
            <span className="status-pill">
              {purchased
                ? 'Preview purchase'
                : borrowed
                  ? 'Simulated loan'
                  : 'Proposal only'}
            </span>
          </div>
        </div>
        <p className="form-hint">
          <Layers3 size={14} aria-hidden="true" /> Stored in this browser. No
          wallet or funds involved.
        </p>
      </div>
      <div className="dialog-footer">
        <button className="button secondary" onClick={onClose}>
          Continue
        </button>
        <button className="button primary" onClick={onAccount}>
          View preview account <ArrowRight size={16} aria-hidden="true" />
        </button>
      </div>
    </Dialog>
  );
}
