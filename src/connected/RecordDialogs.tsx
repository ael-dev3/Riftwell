import { useRef, useState, type FormEvent } from 'react';
import { Info } from 'lucide-react';
import Dialog from '../components/Dialog';
import {
  api,
  type Listing,
  type LoanRequest,
  type Offer,
  type Position,
  type Session,
} from './api';
import {
  dateLabel,
  feeMicros,
  interestMicros,
  kitten,
  parseAmount,
  parseApr,
  shortAddress,
  usdc,
  validateOfferTerms,
} from './amounts';
import { apiMessage } from './usePages';

export function PositionSummary({ position }: { position: Position }) {
  return (
    <dl className="details-list">
      <div>
        <dt>Position</dt>
        <dd>veKITTEN #{position.tokenId}</dd>
      </div>
      <div>
        <dt>Locked balance</dt>
        <dd>{kitten(position.lockedAmountRaw)}</dd>
      </div>
      <div>
        <dt>Unlocks</dt>
        <dd>{dateLabel(position.lockedUntil)}</dd>
      </div>
      <div>
        <dt>Owner</dt>
        <dd title={position.owner}>{shortAddress(position.owner)}</dd>
      </div>
      <div>
        <dt>Observed block</dt>
        <dd>{position.blockNumber}</dd>
      </div>
      <div>
        <dt>Last verified</dt>
        <dd>{dateLabel(position.observedAt)}</dd>
      </div>
    </dl>
  );
}

function Notice({ children }: { children: string }) {
  return (
    <div className="notice">
      <Info size={17} aria-hidden="true" />
      <p>{children}</p>
    </div>
  );
}

type FormProps = {
  kind: 'listing' | 'request' | 'offer';
  session: Session;
  position?: Position;
  request?: LoanRequest;
  onClose: () => void;
  onSaved: (message: string) => void;
  onError: (error: unknown) => void;
};

export function RecordForm({
  kind,
  session,
  position: suppliedPosition,
  request,
  onClose,
  onSaved,
  onError,
}: FormProps) {
  const isListing = kind === 'listing';
  const isOffer = kind === 'offer';
  const [tokenId, setTokenId] = useState(suppliedPosition?.tokenId ?? '');
  const [position, setPosition] = useState<Position | null>(
    suppliedPosition ?? request?.position ?? null,
  );
  const [amount, setAmount] = useState(
    request
      ? usdc(request.principalMicros).replace(' USDC', '').replaceAll(',', '')
      : '',
  );
  const [apr, setApr] = useState(request ? String(request.aprBps / 100) : '12');
  const [duration, setDuration] = useState(request?.durationDays ?? 30);
  const [expiryDays, setExpiryDays] = useState(7);
  const [busy, setBusy] = useState(false);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [error, setError] = useState('');
  const startedAt = useRef(Date.now());
  const identity = useRef({ body: '', key: '' });
  const errorRef = useRef<HTMLParagraphElement>(null);
  const micros = parseAmount(amount);
  const aprBps = parseApr(apr);
  const interest =
    micros && aprBps ? interestMicros(micros, aprBps, duration) : '0';

  async function lookup() {
    if (
      !/^(0|[1-9]\d{0,77})$/.test(tokenId) ||
      BigInt(tokenId) > (1n << 256n) - 1n
    ) {
      setError('Enter a decimal NFT token ID.');
      return;
    }
    setLookupBusy(true);
    setError('');
    setPosition(null);
    try {
      const found = await api.position(tokenId);
      if (found.owner.toLowerCase() !== session.address.toLowerCase())
        throw new Error(
          'This position is not owned by your signed-in account.',
        );
      setPosition(found);
    } catch (failure) {
      setError(apiMessage(failure));
      onError(failure);
    } finally {
      setLookupBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    let validation = '';
    if (!position)
      validation = 'Look up a position owned by your signed-in account first.';
    else if (
      !micros ||
      BigInt(micros) < 1_000_000n ||
      BigInt(micros) > 1_000_000_000_000n
    )
      validation =
        'Enter an amount from 1 to 1,000,000 USDC, with up to six decimal places.';
    else if (!isListing && aprBps === null)
      validation =
        'Enter an APR from 1% to 40%, with up to two decimal places.';
    else if (isOffer && !request)
      validation = 'The borrowing request is unavailable.';
    else if (isOffer && request)
      validation =
        validateOfferTerms(micros!, aprBps!, duration, request) ?? '';
    if (validation) {
      setError(validation);
      requestAnimationFrame(() => errorRef.current?.focus());
      return;
    }
    const requestedExpiry = startedAt.current + expiryDays * 86_400_000;
    const expiresAt = new Date(
      isOffer && request
        ? Math.min(requestedExpiry, Date.parse(request.expiresAt))
        : requestedExpiry,
    ).toISOString();
    if (Date.parse(expiresAt) <= Date.now()) {
      setError(
        'The record would already be expired. Reopen this form to continue.',
      );
      return;
    }
    const values = isListing
      ? { tokenId: position!.tokenId, priceMicros: micros!, expiresAt }
      : {
          ...(isOffer
            ? { requestId: request!.id }
            : { tokenId: position!.tokenId }),
          principalMicros: micros!,
          aprBps: aprBps!,
          durationDays: duration,
          expiresAt,
        };
    const body = JSON.stringify(values);
    if (identity.current.body !== body)
      identity.current = { body, key: crypto.randomUUID() };
    setBusy(true);
    setError('');
    try {
      if (isListing)
        await api.createListing(
          {
            tokenId: position!.tokenId,
            priceMicros: micros!,
            expiresAt,
            idempotencyKey: identity.current.key,
          },
          session.csrfToken,
        );
      else if (isOffer)
        await api.createOffer(
          {
            requestId: request!.id,
            principalMicros: micros!,
            aprBps: aprBps!,
            durationDays: duration,
            expiresAt,
            idempotencyKey: identity.current.key,
          },
          session.csrfToken,
        );
      else
        await api.createLoanRequest(
          {
            tokenId: position!.tokenId,
            principalMicros: micros!,
            aprBps: aprBps!,
            durationDays: duration,
            expiresAt,
            idempotencyKey: identity.current.key,
          },
          session.csrfToken,
        );
      onSaved(
        isListing
          ? 'Listing saved to your account.'
          : isOffer
            ? 'Unfunded lending offer saved.'
            : 'Borrowing request saved. No loan has been funded.',
      );
    } catch (failure) {
      setError(apiMessage(failure));
      onError(failure);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={
        isListing
          ? 'Create listing'
          : isOffer
            ? 'Lending offer'
            : 'Borrowing request'
      }
      kicker="DURABLE OFF-CHAIN RECORD"
      onClose={onClose}
    >
      <form onSubmit={submit} noValidate>
        <div className="dialog-body">
          {!suppliedPosition && !isOffer && (
            <div className="form-field">
              <label className="field-label" htmlFor="owned-token">
                Your veKITTEN token ID
              </label>
              <div className="connected-inline-field">
                <input
                  id="owned-token"
                  className="input-control"
                  inputMode="numeric"
                  maxLength={78}
                  value={tokenId}
                  onChange={(event) => {
                    setTokenId(event.target.value);
                    setPosition(null);
                    setError('');
                  }}
                />
                <button
                  className="button secondary"
                  type="button"
                  disabled={lookupBusy || busy}
                  onClick={() => void lookup()}
                >
                  {lookupBusy ? 'Checking…' : 'Verify ownership'}
                </button>
              </div>
              <p className="form-hint">
                Ownership and lock data are checked through the server’s
                HyperEVM connection.
              </p>
            </div>
          )}
          {position && <PositionSummary position={position} />}
          <div className="form-grid">
            <div className="form-field">
              <label className="field-label" htmlFor="record-amount">
                {isListing
                  ? 'Ask price'
                  : isOffer
                    ? 'Offer amount'
                    : 'Requested amount'}
              </label>
              <div className="amount-input">
                <input
                  className="input-control"
                  id="record-amount"
                  inputMode="decimal"
                  autoComplete="off"
                  maxLength={32}
                  value={amount}
                  readOnly={isOffer}
                  aria-describedby={isOffer ? 'offer-terms-hint' : undefined}
                  onChange={(event) => {
                    setAmount(event.target.value);
                    setError('');
                  }}
                />
                <span>USDC</span>
              </div>
            </div>
            {!isListing && (
              <>
                <div className="form-field">
                  <label className="field-label" htmlFor="record-apr">
                    Annual rate (%)
                  </label>
                  <input
                    className="input-control"
                    id="record-apr"
                    inputMode="decimal"
                    maxLength={6}
                    value={apr}
                    aria-describedby={isOffer ? 'offer-apr-hint' : undefined}
                    onChange={(event) => {
                      setApr(event.target.value);
                      setError('');
                    }}
                  />
                  {isOffer && request && (
                    <p className="form-hint" id="offer-apr-hint">
                      Request maximum: {request.aprBps / 100}% APR. A lower rate
                      is allowed.
                    </p>
                  )}
                </div>
                <div className="form-field">
                  <label className="field-label" htmlFor="record-duration">
                    Loan duration
                  </label>
                  {isOffer ? (
                    <input
                      className="input-control"
                      id="record-duration"
                      value={`${duration} days`}
                      readOnly
                      aria-describedby="offer-terms-hint"
                    />
                  ) : (
                    <select
                      className="input-control"
                      id="record-duration"
                      value={duration}
                      onChange={(event) =>
                        setDuration(Number(event.target.value))
                      }
                    >
                      {[7, 14, 30].map((days) => (
                        <option key={days} value={days}>
                          {days} days
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </>
            )}
            <div className="form-field">
              <label className="field-label" htmlFor="record-expiry">
                Record expires in
              </label>
              <select
                className="input-control"
                id="record-expiry"
                value={expiryDays}
                onChange={(event) => setExpiryDays(Number(event.target.value))}
              >
                {[1, 7, 30].map((days) => (
                  <option key={days} value={days}>
                    {days} days
                  </option>
                ))}
              </select>
            </div>
          </div>
          {isOffer && request && (
            <p className="form-hint" id="offer-terms-hint">
              Amount and duration match the borrowing request. The offer expires
              no later than the request on {dateLabel(request.expiresAt)}.
            </p>
          )}
          {micros && (
            <div className="cost-breakdown">
              <div className="breakdown-row">
                <span>
                  {isListing
                    ? 'Seller fee at settlement'
                    : 'Borrower origination fee if funded'}
                  <small>One-time 0.5% · nothing charged now</small>
                </span>
                <span>{usdc(feeMicros(micros))}</span>
              </div>
              {!isListing && (
                <div className="breakdown-row">
                  <span>
                    Lender interest if funded
                    <small>{duration} days · simple interest</small>
                  </span>
                  <span>{usdc(interest)}</span>
                </div>
              )}
            </div>
          )}
          <p className="form-error" role="alert" ref={errorRef} tabIndex={-1}>
            {error}
          </p>
          <Notice>
            {isListing
              ? 'Saving a listing does not transfer, escrow or approve your NFT. Purchases remain unavailable until contract settlement launches.'
              : 'Saving this record does not fund a loan or lock collateral. Acceptance, repayment and liquidation remain unavailable until contract settlement launches.'}
          </Notice>
        </div>
        <div className="dialog-footer">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={busy || lookupBusy}>
            {busy
              ? 'Saving…'
              : isListing
                ? 'Save listing'
                : isOffer
                  ? 'Save unfunded offer'
                  : 'Save borrowing request'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function ListingReview({
  listing,
  onClose,
}: {
  listing: Listing;
  onClose: () => void;
}) {
  return (
    <Dialog
      title={`veKITTEN #${listing.tokenId}`}
      kicker="PURCHASE REVIEW"
      onClose={onClose}
    >
      <div className="dialog-body">
        <PositionSummary position={listing.position} />
        <div className="cost-breakdown">
          <div className="breakdown-row">
            <span>Ask price</span>
            <strong>{usdc(listing.priceMicros)}</strong>
          </div>
          <div className="breakdown-row">
            <span>
              Seller fee at settlement<small>0.5%, paid by seller</small>
            </span>
            <span>{usdc(feeMicros(listing.priceMicros))}</span>
          </div>
          <div className="breakdown-row">
            <span>Listing expires</span>
            <span>{dateLabel(listing.expiresAt)}</span>
          </div>
        </div>
        <Notice>
          Contract settlement is pending launch. This listing is an off-chain
          expression of interest. No purchase, payment or NFT transfer can be
          completed here.
        </Notice>
      </div>
      <div className="dialog-footer">
        <button className="button secondary" onClick={onClose}>
          Back to positions
        </button>
        <button className="button primary" disabled>
          Settlement unavailable
        </button>
      </div>
    </Dialog>
  );
}

export function OfferReview({
  offer,
  request,
  onClose,
}: {
  offer: Offer;
  request?: LoanRequest;
  onClose: () => void;
}) {
  return (
    <Dialog
      title="Review lending offer"
      kicker="UNFUNDED PROPOSAL"
      onClose={onClose}
    >
      <div className="dialog-body">
        {request && (
          <>
            <p className="form-hint">
              Position metadata reflects the request’s last observed block. It
              does not establish current ownership or collateral eligibility.
            </p>
            <PositionSummary position={request.position} />
          </>
        )}
        <dl className="details-list">
          <div>
            <dt>Lender</dt>
            <dd title={offer.lender}>{shortAddress(offer.lender)}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>{offer.status}</dd>
          </div>
          <div>
            <dt>Terms</dt>
            <dd>
              {offer.aprBps / 100}% APR · {offer.durationDays} days
            </dd>
          </div>
          <div>
            <dt>Expires</dt>
            <dd>{dateLabel(offer.expiresAt)}</dd>
          </div>
        </dl>
        <div className="cost-breakdown">
          <div className="breakdown-row">
            <span>Proposed principal</span>
            <strong>{usdc(offer.principalMicros)}</strong>
          </div>
          <div className="breakdown-row">
            <span>
              Borrower fee if funded
              <small>One-time 0.5% · nothing charged now</small>
            </span>
            <span>{usdc(feeMicros(offer.principalMicros))}</span>
          </div>
          <div className="breakdown-row">
            <span>
              Lender interest if funded
              <small>Simple interest over the proposed term</small>
            </span>
            <span>
              {usdc(
                interestMicros(
                  offer.principalMicros,
                  offer.aprBps,
                  offer.durationDays,
                ),
              )}
            </span>
          </div>
        </div>
        <Notice>
          This proposal is unfunded. Acceptance and loan funding are pending
          contract settlement launch. Reviewing it does not accept terms, lock
          collateral or move funds.
        </Notice>
      </div>
      <div className="dialog-footer">
        <button className="button secondary" onClick={onClose}>
          Back to account
        </button>
        <button className="button primary" disabled>
          Acceptance unavailable
        </button>
      </div>
    </Dialog>
  );
}

export function CancellationDialog({
  label,
  onClose,
  onConfirm,
}: {
  label: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <Dialog
      title={`Cancel ${label}?`}
      kicker="OFF-CHAIN RECORD"
      onClose={onClose}
    >
      <div className="dialog-body">
        <p>
          The record will be marked cancelled on the server. Its history remains
          in your account. No funds or NFTs move.
        </p>
        <p className="form-error" role="alert">
          {error}
        </p>
      </div>
      <div className="dialog-footer">
        <button className="button secondary" onClick={onClose}>
          Keep record
        </button>
        <button
          className="button primary"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void onConfirm()
              .catch((failure: unknown) => setError(apiMessage(failure)))
              .finally(() => setBusy(false));
          }}
        >
          {busy ? 'Cancelling…' : 'Confirm cancellation'}
        </button>
      </div>
    </Dialog>
  );
}
