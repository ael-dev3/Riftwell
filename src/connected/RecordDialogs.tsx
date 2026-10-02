import { useRef, useState, type FormEvent } from 'react';
import Dialog from '../components/Dialog';
import { Breakdown, Notice } from '../components/ui/Bits';
import { api, type Listing, type Position, type Session } from './api';
import {
  dateLabel,
  feeMicros,
  kitten,
  parseAmount,
  shortAddress,
  usdc,
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

type FormProps = {
  session: Session;
  position?: Position;
  onClose: () => void;
  onSaved: (message: string) => void;
  onError: (error: unknown) => void;
};

export function RecordForm({
  session,
  position: suppliedPosition,
  onClose,
  onSaved,
  onError,
}: FormProps) {
  const [tokenId, setTokenId] = useState(suppliedPosition?.tokenId ?? '');
  const [position, setPosition] = useState<Position | null>(
    suppliedPosition ?? null,
  );
  const [amount, setAmount] = useState('');
  const [expiryDays, setExpiryDays] = useState(7);
  const [busy, setBusy] = useState(false);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [error, setError] = useState('');
  const startedAt = useRef(Date.now());
  const identity = useRef({ body: '', key: '' });
  const errorRef = useRef<HTMLParagraphElement>(null);
  const micros = parseAmount(amount);

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
    if (validation) {
      setError(validation);
      requestAnimationFrame(() => errorRef.current?.focus());
      return;
    }
    const expiresAt = new Date(
      startedAt.current + expiryDays * 86_400_000,
    ).toISOString();
    if (Date.parse(expiresAt) <= Date.now()) {
      setError(
        'The listing would already be expired. Reopen this form to continue.',
      );
      return;
    }
    const values = {
      tokenId: position!.tokenId,
      priceMicros: micros!,
      expiresAt,
    };
    const body = JSON.stringify(values);
    if (identity.current.body !== body)
      identity.current = { body, key: crypto.randomUUID() };
    setBusy(true);
    setError('');
    try {
      await api.createListing(
        { ...values, idempotencyKey: identity.current.key },
        session.csrfToken,
      );
      onSaved('Listing saved to your account.');
    } catch (failure) {
      setError(apiMessage(failure));
      onError(failure);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      title="Create listing"
      kicker="DURABLE OFF-CHAIN RECORD"
      onClose={onClose}
    >
      <form onSubmit={submit} noValidate>
        <div className="dialog-body">
          {!suppliedPosition && (
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
                Ask price
              </label>
              <div className="amount-input">
                <input
                  className="input-control"
                  id="record-amount"
                  inputMode="decimal"
                  autoComplete="off"
                  maxLength={32}
                  value={amount}
                  onChange={(event) => {
                    setAmount(event.target.value);
                    setError('');
                  }}
                />
                <span className="amount-unit">USDC</span>
              </div>
            </div>
            <div className="form-field">
              <label className="field-label" htmlFor="record-expiry">
                Listing expires in
              </label>
              <select
                className="input-control"
                id="record-expiry"
                value={expiryDays}
                onChange={(event) => setExpiryDays(Number(event.target.value))}
              >
                {[1, 7, 30].map((days) => (
                  <option key={days} value={days}>
                    {days} {days === 1 ? 'day' : 'days'}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {micros && (
            <Breakdown
              rows={[
                {
                  label: 'Seller fee at settlement',
                  hint: 'One-time 0.5% · nothing charged now',
                  value: usdc(feeMicros(micros)),
                },
              ]}
            />
          )}
          <p className="form-error" role="alert" ref={errorRef} tabIndex={-1}>
            {error}
          </p>
          <Notice>
            Saving a listing does not transfer, escrow or approve your NFT.
            Purchases remain unavailable until contract settlement launches.
          </Notice>
        </div>
        <div className="dialog-footer">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={busy || lookupBusy}>
            {busy ? 'Saving…' : 'Save listing'}
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
        <Breakdown
          rows={[
            {
              label: 'Ask price',
              value: usdc(listing.priceMicros),
              strong: true,
            },
            {
              label: 'Seller fee at settlement',
              hint: '0.5%, paid by seller',
              value: usdc(feeMicros(listing.priceMicros)),
            },
            { label: 'Listing expires', value: dateLabel(listing.expiresAt) },
          ]}
        />
        <Notice>
          Contract settlement is pending launch. This listing is an off-chain
          expression of interest. No purchase, payment or NFT transfer can be
          completed here.
        </Notice>
      </div>
      <div className="dialog-footer">
        <button className="button secondary" onClick={onClose}>
          Back to listings
        </button>
        <button className="button primary" disabled>
          Settlement unavailable
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
        <p className="panel-text">
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
