import { Info } from 'lucide-react';
import type { ReactNode, RefObject } from 'react';
import {
  formatBalance,
  formatDate,
  microsToDecimal,
  type Asset,
} from '../../domain';

export function Notice({
  children,
  tone,
}: {
  children: ReactNode;
  tone?: 'warning';
}) {
  return (
    <div className={`notice${tone ? ` ${tone}` : ''}`}>
      <Info size={17} aria-hidden="true" />
      <p>{children}</p>
    </div>
  );
}

export function Breakdown({
  rows,
}: {
  rows: readonly {
    label: ReactNode;
    value: ReactNode;
    hint?: string;
    strong?: boolean;
    total?: boolean;
  }[];
}) {
  return (
    <div className="breakdown">
      {rows.map((row, index) => (
        <div
          className={`breakdown-row${row.total ? ' total' : ''}`}
          key={index}
        >
          <span>
            {row.label}
            {row.hint && <small>{row.hint}</small>}
          </span>
          {row.strong || row.total ? (
            <strong>{row.value}</strong>
          ) : (
            <span>{row.value}</span>
          )}
        </div>
      ))}
    </div>
  );
}

export function AssetSummary({
  asset,
  kicker,
}: {
  asset: Asset;
  kicker: string;
}) {
  return (
    <div className="asset-summary">
      <img
        className="asset-summary-art"
        src={asset.artwork}
        alt=""
        width="64"
        height="64"
      />
      <div>
        <p className="asset-summary-kicker">{kicker}</p>
        <h3>{asset.name}</h3>
        <span className="text-muted">
          {formatBalance(asset.underlyingBalance, asset.underlyingSymbol)} ·
          unlocks {formatDate(asset.unlockDate)}
        </span>
      </div>
    </div>
  );
}

type AmountFieldProps = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  maximum: bigint;
  hint: string;
  error: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  describedBy: string;
  /** Quick picks are USDC micros unless another conversion is given. */
  toText?: (value: bigint) => string;
  unit?: ReactNode;
};

/** Exact decimal entry with quick picks. The text field stays authoritative. */
export function AmountField({
  id,
  label,
  value,
  onChange,
  maximum,
  hint,
  error,
  inputRef,
  describedBy,
  toText = microsToDecimal,
  unit,
}: AmountFieldProps) {
  const pick = (share: bigint) => onChange(toText((maximum * share) / 100n));
  return (
    <div className="form-field">
      <div className="field-label">
        <label htmlFor={id}>{label}</label>
        <span className="quick-picks">
          {[25n, 50n, 75n].map((share) => (
            <button
              key={share.toString()}
              type="button"
              className="chip-button"
              disabled={maximum === 0n}
              onClick={() => pick(share)}
            >
              {share.toString()}%
            </button>
          ))}
          <button
            type="button"
            className="chip-button"
            aria-label="Use max."
            disabled={maximum === 0n}
            onClick={() => onChange(toText(maximum))}
          >
            Max
          </button>
        </span>
      </div>
      <div className={`amount-input${error ? ' invalid' : ''}`}>
        <input
          ref={inputRef}
          id={id}
          className="input-control"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          maxLength={24}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={error}
          aria-describedby={describedBy}
        />
        <span className="amount-unit">
          {unit ?? (
            <>
              <span className="usdc-glyph" aria-hidden="true">
                $
              </span>
              USDC
            </>
          )}
        </span>
      </div>
      <p className="form-hint" id={`${id}-hint`}>
        {hint}
      </p>
    </div>
  );
}
