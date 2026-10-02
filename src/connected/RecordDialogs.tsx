import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Info } from 'lucide-react';
import Dialog from '../components/Dialog';
import { api, type Listing, type Position, type Session } from './api';
import {
  dateLabel,
  feeMicros,
  listingAskMicros,
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

function Notice({ children }: { children: string }) {
  return (
    <div className="notice">
      <Info size={17} aria-hidden="true" />
      <p>{children}</p>
    </div>
  );
}

type FormProps = {
  session: Session;
  position?: Position | undefined;
  listing?: Listing;
  onClose: () => void;
  onSaved: (message: string) => void;
  onError: (error: unknown) => void;
};

export function RecordForm({
  session,
  position: suppliedPosition,
  listing: suppliedListing,
  onClose,
  onSaved,
  onError,
}: FormProps) {
  const [tokenId, setTokenId] = useState(suppliedPosition?.tokenId ?? '');
  const [position, setPosition] = useState<Position | null>(
    suppliedPosition ?? null,
  );
  const [amount, setAmount] = useState(
    suppliedListing
      ? (BigInt(suppliedListing.startPriceMicros) / 1_000_000n).toString() +
          '.' +
          (BigInt(suppliedListing.startPriceMicros) % 1_000_000n)
            .toString()
            .padStart(6, '0')
      : '',
  );
  const [expiryDays, setExpiryDays] = useState(7);
  const [kind, setKind] = useState<'fixed' | 'dutch'>(
    suppliedListing?.kind ?? 'fixed',
  );
  const [floor, setFloor] = useState(
    suppliedListing
      ? (BigInt(suppliedListing.endPriceMicros) / 1_000_000n).toString() +
          '.' +
          (BigInt(suppliedListing.endPriceMicros) % 1_000_000n)
            .toString()
            .padStart(6, '0')
      : '',
  );
  const [decayHours, setDecayHours] = useState(24);
  const [recipient, setRecipient] = useState(suppliedListing?.recipient ?? '');
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
    const endPriceMicros = kind === 'fixed' ? micros : parseAmount(floor);
    const reserved = recipient.trim() || null;
    if (
      !validation &&
      kind === 'dutch' &&
      (!endPriceMicros ||
        BigInt(endPriceMicros) < 1_000_000n ||
        BigInt(endPriceMicros) > BigInt(micros!) ||
        decayHours > expiryDays * 24)
    )
      validation =
        'Set a floor from 1 USDC to the start price, and reach it before listing expiry.';
    if (
      !validation &&
      reserved &&
      (!/^0x[0-9a-f]{40}$/i.test(reserved) ||
        /^0x0{40}$/i.test(reserved) ||
        reserved.toLowerCase() === session.address.toLowerCase())
    )
      validation = 'Enter a valid buyer address different from your own.';
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
      kind,
      endPriceMicros: endPriceMicros!,
      auctionEndsAt:
        kind === 'dutch'
          ? new Date(startedAt.current + decayHours * 3600000).toISOString()
          : null,
      recipient: reserved,
    };
    const body = JSON.stringify(values);
    if (identity.current.body !== body)
      identity.current = { body, key: crypto.randomUUID() };
    setBusy(true);
    setError('');
    try {
      if (suppliedListing)
        await api.updateListing(
          suppliedListing.id,
          {
            priceMicros: values.priceMicros,
            expiresAt: values.expiresAt,
            kind: values.kind,
            endPriceMicros: values.endPriceMicros,
            auctionEndsAt: values.auctionEndsAt,
            recipient: values.recipient,
            expectedRevision: suppliedListing.revision,
            idempotencyKey: identity.current.key,
          },
          session.csrfToken,
        );
      else
        await api.createListing(
          { ...values, idempotencyKey: identity.current.key },
          session.csrfToken,
        );
      onSaved(
        suppliedListing ? 'Listing updated.' : 'Listing saved to your account.',
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
      title={suppliedListing ? 'Edit listing' : 'List your veKITTEN'}
      kicker="OFF-CHAIN LISTING"
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
          <div className="form-field">
            <label className="field-label" htmlFor="listing-type">
              Listing type
            </label>
            <select
              id="listing-type"
              className="input-control"
              value={kind}
              onChange={(event) =>
                setKind(event.target.value as 'fixed' | 'dutch')
              }
            >
              <option value="fixed">Fixed price</option>
              <option value="dutch">Dutch auction</option>
            </select>
          </div>
          <div className="form-grid">
            <div className="form-field">
              <label className="field-label" htmlFor="record-amount">
                {kind === 'dutch' ? 'Start price' : 'Ask price'}
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
                <span>USDC</span>
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
                    {days} days
                  </option>
                ))}
              </select>
            </div>
          </div>
          {kind === 'dutch' && (
            <div className="form-grid">
              <div className="form-field">
                <label className="field-label" htmlFor="listing-floor">
                  Floor price · USDC
                </label>
                <input
                  id="listing-floor"
                  className="input-control"
                  inputMode="decimal"
                  value={floor}
                  onChange={(event) => setFloor(event.target.value)}
                  maxLength={32}
                />
              </div>
              <div className="form-field">
                <label className="field-label" htmlFor="listing-decay">
                  Reach floor in
                </label>
                <select
                  id="listing-decay"
                  className="input-control"
                  value={decayHours}
                  onChange={(event) =>
                    setDecayHours(Number(event.target.value))
                  }
                >
                  {[1, 24, 72].map((hours) => (
                    <option key={hours} value={hours}>
                      {hours === 1 ? '1 hour' : `${hours / 24} days`}
                    </option>
                  ))}
                </select>
              </div>
              <p className="form-hint">
                The premium decays cubically, then holds at the floor until
                expiry.
              </p>
            </div>
          )}
          <details className="market-form-advanced">
            <summary>Reserve for a buyer</summary>
            <label className="field-label" htmlFor="listing-recipient">
              Buyer address (optional)
            </label>
            <input
              id="listing-recipient"
              className="input-control"
              value={recipient}
              onChange={(event) => setRecipient(event.target.value)}
              maxLength={42}
              autoComplete="off"
              placeholder="0x…"
            />
            <p className="form-hint">
              Public reservation intent. The buyer address is visible to
              everyone.
            </p>
          </details>
          {micros && (
            <div className="cost-breakdown">
              <div className="breakdown-row">
                <span>
                  Seller fee at settlement
                  <small>One-time 0.5% · nothing charged now</small>
                </span>
                <span>{usdc(feeMicros(micros))}</span>
              </div>
            </div>
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
            {busy
              ? 'Saving…'
              : suppliedListing
                ? 'Save changes'
                : 'Save listing'}
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
  return <SweepReview listings={[listing]} onClose={onClose} />;
}

export function SweepReview({
  listings,
  onClose,
}: {
  listings: Listing[];
  onClose: () => void;
}) {
  const [fresh, setFresh] = useState<Listing[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const key = listings.map((listing) => listing.id).join(',');
  useEffect(() => {
    const controller = new AbortController();
    setBusy(true);
    setError('');
    setFresh([]);
    const ids = key.split(',');
    if (ids.length > 20 || !ids.length || new Set(ids).size !== ids.length) {
      setBusy(false);
      setError('Select between one and twenty different listings.');
      return;
    }
    void Promise.all(ids.map((id) => api.listing(id, controller.signal)))
      .then((result) => {
        if (!controller.signal.aborted) setFresh(result);
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setError(apiMessage(failure));
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [key, revision]);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const total = fresh
    .reduce((sum, item) => sum + BigInt(listingAskMicros(item, now)), 0n)
    .toString();
  const changed = fresh.some((item) => {
    const previous = listings.find((entry) => entry.id === item.id);
    return (
      !previous ||
      previous.revision !== item.revision ||
      previous.priceMicros !== item.priceMicros
    );
  });
  return (
    <Dialog
      title={
        listings.length === 1 && listings[0]
          ? `Buy veKITTEN #${listings[0].tokenId}`
          : `Sweep ${listings.length} positions`
      }
      kicker="PURCHASE REVIEW"
      onClose={onClose}
      wide={listings.length > 1}
    >
      <div className="dialog-body">
        {busy && <p role="status">Checking current listings and ownership…</p>}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {changed && (
          <p className="form-hint" role="status">
            The listing changed. Current terms are shown below.
          </p>
        )}
        {!busy && !error && fresh.length === 1 && fresh[0] && (
          <PositionSummary position={fresh[0].position} />
        )}
        {!busy && !error && fresh.length > 1 && (
          <div className="market-table-wrap">
            <table className="market-table">
              <caption className="sr-only">Current sweep terms</caption>
              <thead>
                <tr>
                  <th scope="col">Token ID</th>
                  <th scope="col">Ask price</th>
                  <th scope="col">Revision</th>
                </tr>
              </thead>
              <tbody>
                {fresh.map((item) => (
                  <tr key={item.id}>
                    <td>#{item.tokenId}</td>
                    <td>{usdc(listingAskMicros(item, now))}</td>
                    <td>{item.revision}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {fresh.map(
          (item) =>
            item.recipient && (
              <p className="form-hint market-address" key={item.id}>
                #{item.tokenId} is reserved for {item.recipient}.
              </p>
            ),
        )}
        {fresh.some((item) => Date.parse(item.expiresAt) <= now) && (
          <p className="form-error" role="alert">
            A listing has expired. Refresh terms.
          </p>
        )}
        {!!fresh.length && (
          <div className="cost-breakdown">
            <div className="breakdown-row">
              <span>Total ask</span>
              <strong>{usdc(total)}</strong>
            </div>
            <div className="breakdown-row">
              <span>
                Seller fee at settlement<small>0.5%, paid by seller</small>
              </span>
              <span>
                {usdc(
                  fresh
                    .reduce(
                      (sum, item) =>
                        sum + BigInt(feeMicros(listingAskMicros(item, now))),
                      0n,
                    )
                    .toString(),
                )}
              </span>
            </div>
          </div>
        )}
        <Notice>
          Purchases are unavailable until marketplace contracts launch. No
          payment or NFT transfer occurs.
        </Notice>
      </div>
      <div className="dialog-footer">
        <button
          className="button secondary"
          onClick={() => setRevision((value) => value + 1)}
          disabled={busy}
        >
          Refresh terms
        </button>
        <button className="button primary" disabled>
          Buy · contracts not deployed
        </button>
      </div>
    </Dialog>
  );
}

export function ListingPicker({
  account,
  loading,
  onClose,
  onChoose,
  onMore,
  onManual,
}: {
  account: import('./api').Account | null;
  loading: boolean;
  onClose: () => void;
  onChoose: (position: Position) => void;
  onMore: () => void;
  onManual: () => void;
}) {
  const positions =
    account?.positions.filter(
      (position) =>
        !account.listings.some(
          (listing) =>
            listing.tokenId === position.tokenId &&
            listing.status === 'active' &&
            Date.parse(listing.expiresAt) > Date.now(),
        ),
    ) ?? [];
  return (
    <Dialog
      title="Choose a veKITTEN to list"
      kicker="YOUR POSITIONS"
      onClose={onClose}
      wide
    >
      <div className="dialog-body">
        {loading && <p role="status">Checking your positions…</p>}
        {account?.positionsUnavailable && (
          <p className="form-error" role="alert">
            Ownership checks are unavailable. Try again later.
          </p>
        )}
        {positions.length > 0 ? (
          <div className="market-table-wrap">
            <table className="market-table">
              <caption className="sr-only">Your available positions</caption>
              <thead>
                <tr>
                  <th scope="col">Token ID</th>
                  <th scope="col">Locked KITTEN</th>
                  <th scope="col">Unlocks</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((position) => (
                  <tr key={position.id}>
                    <td>#{position.tokenId}</td>
                    <td>{kitten(position.lockedAmountRaw)}</td>
                    <td>{dateLabel(position.lockedUntil)}</td>
                    <td>
                      <button
                        className="button secondary"
                        onClick={() => onChoose(position)}
                      >
                        Select #{position.tokenId}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          !loading && (
            <p className="form-hint">
              No available positions in the loaded wallet records.
            </p>
          )
        )}
        {account?.nextPositionsCursor && (
          <button
            className="button secondary"
            disabled={loading}
            onClick={onMore}
          >
            Load more positions
          </button>
        )}
      </div>
      <div className="dialog-footer">
        <button className="button secondary" onClick={onClose}>
          Cancel
        </button>
        <button className="button secondary" onClick={onManual}>
          Enter token ID
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
