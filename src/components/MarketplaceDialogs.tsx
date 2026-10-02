import { ArrowRight, Info } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { ALL_MARKET_ASSETS } from '../data';
import {
  formatBalance,
  formatDate,
  formatMicros,
  microsToDecimal,
  parseUSDCMicros,
} from '../domain';
import {
  currentAskMicros,
  isListingActive,
  PREVIEW_ADDRESS,
  type ListingTerms,
  type MarketplaceState,
  type PreviewListing,
  type PurchaseQuote,
} from '../marketplace';
import Dialog from './Dialog';
import type { MarketplaceAction } from './Marketplace';

export type MarketplaceActionInput = {
  assetId?: string;
  terms?: ListingTerms;
  quotes?: PurchaseQuote[];
};
type Props = {
  action: MarketplaceAction;
  state: MarketplaceState;
  onClose: () => void;
  onApply: (input: MarketplaceActionInput) => string | null;
};
const same = (left: string | undefined, right: string) =>
  left?.toLowerCase() === right.toLowerCase();
const DAY = 86_400_000;
function PreviewNotice() {
  return (
    <div className="notice">
      <Info size={17} aria-hidden="true" />
      <p>
        Local preview only. No wallet, approval, transaction or real ownership
        transfer.
      </p>
    </div>
  );
}
function ListingFacts({ listing }: { listing: PreviewListing }) {
  const asset = ALL_MARKET_ASSETS.find(
    (entry) => entry.id === listing.assetId,
  )!;
  return (
    <dl className="details-list">
      <div>
        <dt>Token ID</dt>
        <dd>#{asset.positionId}</dd>
      </div>
      <div>
        <dt>Locked balance</dt>
        <dd>
          {formatBalance(asset.underlyingBalance, asset.underlyingSymbol)}
        </dd>
      </div>
      <div>
        <dt>Unlocks</dt>
        <dd>{formatDate(asset.unlockDate)}</dd>
      </div>
      <div>
        <dt>Current ask</dt>
        <dd>{formatMicros(currentAskMicros(listing))}</dd>
      </div>
      <div>
        <dt>Listing type</dt>
        <dd>
          {listing.kind === 'dutch'
            ? 'Dutch · cubic price decay'
            : 'Fixed price'}
        </dd>
      </div>
      {listing.kind === 'dutch' && (
        <>
          <div>
            <dt>Floor price</dt>
            <dd>{formatMicros(listing.endPriceMicros)}</dd>
          </div>
          <div>
            <dt>Floor reached</dt>
            <dd>{new Date(listing.auctionEndsAt!).toLocaleString('en-GB')}</dd>
          </div>
        </>
      )}
      <div>
        <dt>Listing expires</dt>
        <dd>{new Date(listing.expiresAt).toLocaleString('en-GB')}</dd>
      </div>
      <div>
        <dt>Seller</dt>
        <dd className="market-address">
          {same(listing.seller, PREVIEW_ADDRESS)
            ? 'Your preview account'
            : 'Sample seller'}
        </dd>
      </div>
      {listing.recipient && (
        <div>
          <dt>Reserved buyer · preview</dt>
          <dd className="market-address">{listing.recipient}</dd>
        </div>
      )}
    </dl>
  );
}

function ListingFormDialog({
  action,
  state,
  onClose,
  onApply,
}: Props & {
  action:
    | Extract<MarketplaceAction, { kind: 'list' }>
    | Extract<MarketplaceAction, { kind: 'edit' | 'cancel' | 'details' }>;
}) {
  const editing = action.kind === 'edit';
  const listing = editing && 'listing' in action ? action.listing : null;
  const available = ALL_MARKET_ASSETS.filter(
    (asset) =>
      same(state.ownerByAsset[asset.id], PREVIEW_ADDRESS) &&
      !state.listings.some(
        (entry) => entry.assetId === asset.id && isListingActive(entry),
      ),
  );
  const [assetId, setAssetId] = useState(
    listing?.assetId ??
      ('asset' in action ? action.asset?.id : undefined) ??
      available[0]?.id ??
      '',
  );
  const [kind, setKind] = useState<'fixed' | 'dutch'>(listing?.kind ?? 'fixed');
  const [price, setPrice] = useState(
    listing ? microsToDecimal(currentAskMicros(listing)) : '',
  );
  const [floor, setFloor] = useState(
    listing ? microsToDecimal(listing.endPriceMicros) : '',
  );
  const [durationHours, setDurationHours] = useState(24);
  const [expiryDays, setExpiryDays] = useState(7);
  const [recipient, setRecipient] = useState(listing?.recipient ?? '');
  const [review, setReview] = useState<ListingTerms | null>(null);
  const [error, setError] = useState('');
  const priceRef = useRef<HTMLInputElement>(null);
  const floorRef = useRef<HTMLInputElement>(null);
  const recipientRef = useRef<HTMLInputElement>(null);
  const asset = ALL_MARKET_ASSETS.find((entry) => entry.id === assetId);
  function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (review) {
      const issue = onApply({ assetId, terms: review });
      if (issue) setError(issue);
      return;
    }
    const start = parseUSDCMicros(price);
    const end = kind === 'fixed' ? start : parseUSDCMicros(floor);
    if (start === null || start <= 0n || start > 1_000_000_000_000n) {
      setError(
        'Enter a price above zero and up to 1,000,000 USDC, with up to six decimal places.',
      );
      priceRef.current?.focus();
      return;
    }
    if (end === null || end <= 0n || end > start) {
      setError(
        'Enter a positive floor price no higher than the starting price.',
      );
      floorRef.current?.focus();
      return;
    }
    if (
      !asset ||
      (!editing && !available.some((entry) => entry.id === asset.id))
    ) {
      setError('Choose an unlisted position in your preview account.');
      return;
    }
    if (kind === 'dutch' && durationHours * 3600000 > expiryDays * DAY) {
      setError('The Dutch price duration must end before the listing expires.');
      return;
    }
    if (
      recipient &&
      (!/^0x[0-9a-fA-F]{40}$/.test(recipient) ||
        /^0x0{40}$/i.test(recipient) ||
        same(recipient, PREVIEW_ADDRESS))
    ) {
      setError(
        'Use a different valid buyer address, or leave this field blank.',
      );
      recipientRef.current?.focus();
      return;
    }
    const now = Date.now();
    setReview({
      kind,
      startPriceMicros: start.toString(),
      endPriceMicros: end.toString(),
      auctionEndsAt:
        kind === 'dutch'
          ? new Date(now + durationHours * 3600000).toISOString()
          : null,
      expiresAt: new Date(now + expiryDays * DAY).toISOString(),
      recipient: recipient ? recipient.toLowerCase() : null,
    });
    setError('');
  }
  return (
    <Dialog
      title={
        review
          ? editing
            ? 'Review listing changes'
            : 'Review listing'
          : editing
            ? 'Edit listing'
            : 'List yours'
      }
      kicker="MARKETPLACE · PREVIEW"
      onClose={onClose}
    >
      <form onSubmit={prepare} noValidate>
        <div className="dialog-body">
          {review && asset ? (
            <>
              <div className="review-asset">
                <img
                  className="row-thumb"
                  src={asset.artwork}
                  alt=""
                  width="52"
                  height="52"
                />
                <div>
                  <h3>veKITTEN #{asset.positionId}</h3>
                  <span className="text-muted">
                    {formatBalance(
                      asset.underlyingBalance,
                      asset.underlyingSymbol,
                    )}
                  </span>
                </div>
              </div>
              <div className="cost-breakdown">
                <div className="breakdown-row">
                  <span>
                    {review.kind === 'dutch' ? 'Starting ask' : 'Ask price'}
                  </span>
                  <strong>{formatMicros(review.startPriceMicros)}</strong>
                </div>
                {review.kind === 'dutch' && (
                  <>
                    <div className="breakdown-row">
                      <span>Floor ask</span>
                      <strong>{formatMicros(review.endPriceMicros)}</strong>
                    </div>
                    <div className="breakdown-row">
                      <span>
                        Price duration
                        <small>
                          Cubic decay, then floor holds until expiry
                        </small>
                      </span>
                      <span>{durationHours} hours</span>
                    </div>
                  </>
                )}
                <div className="breakdown-row">
                  <span>
                    Seller fee on sale
                    <small>0.5% of the final sale price</small>
                  </span>
                  <span>
                    {review.kind === 'fixed'
                      ? formatMicros(
                          (BigInt(review.startPriceMicros) * 5n) / 1000n,
                        )
                      : `${formatMicros((BigInt(review.endPriceMicros) * 5n) / 1000n)} – ${formatMicros((BigInt(review.startPriceMicros) * 5n) / 1000n)}`}
                  </span>
                </div>
                <div className="breakdown-row">
                  <span>Seller receives on sale</span>
                  <span>
                    {formatMicros(
                      BigInt(review.startPriceMicros) -
                        (BigInt(review.startPriceMicros) * 5n) / 1000n,
                    )}
                    {review.kind === 'dutch' ? ' at starting ask' : ''}
                  </span>
                </div>
                <div className="breakdown-row">
                  <span>Expires</span>
                  <span>
                    {new Date(review.expiresAt).toLocaleString('en-GB')}
                  </span>
                </div>
                {review.recipient && (
                  <div className="breakdown-row">
                    <span>Reserved buyer</span>
                    <span className="market-address">{review.recipient}</span>
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              {!editing && (
                <div className="form-field">
                  <label className="field-label" htmlFor="listing-position">
                    Your position
                  </label>
                  <select
                    id="listing-position"
                    className="input-control"
                    value={assetId}
                    onChange={(event) => {
                      setAssetId(event.target.value);
                      setError('');
                    }}
                    disabled={!available.length}
                  >
                    {!available.length && (
                      <option value="">No unlisted positions</option>
                    )}
                    {available.map((entry) => (
                      <option value={entry.id} key={entry.id}>
                        #{entry.positionId} ·{' '}
                        {formatBalance(
                          entry.underlyingBalance,
                          entry.underlyingSymbol,
                        )}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {editing && asset && <h3>veKITTEN #{asset.positionId}</h3>}
              <div className="form-grid">
                <div className="form-field">
                  <label className="field-label" htmlFor="listing-type">
                    Sale type
                  </label>
                  <select
                    id="listing-type"
                    className="input-control"
                    value={kind}
                    onChange={(event) => {
                      setKind(event.target.value as 'fixed' | 'dutch');
                      setError('');
                    }}
                  >
                    <option value="fixed">Fixed price</option>
                    <option value="dutch">Dutch auction</option>
                  </select>
                </div>
                <div className="form-field">
                  <label className="field-label" htmlFor="listing-price">
                    {kind === 'dutch' ? 'Starting ask' : 'Ask price'}
                  </label>
                  <div className="amount-input">
                    <input
                      ref={priceRef}
                      id="listing-price"
                      className="input-control"
                      inputMode="decimal"
                      type="text"
                      maxLength={24}
                      value={price}
                      onChange={(event) => {
                        setPrice(event.target.value);
                        setError('');
                      }}
                      aria-describedby="market-form-error"
                    />
                    <span>USDC</span>
                  </div>
                </div>
                {kind === 'dutch' && (
                  <>
                    <div className="form-field">
                      <label className="field-label" htmlFor="listing-floor">
                        Floor ask
                      </label>
                      <div className="amount-input">
                        <input
                          ref={floorRef}
                          id="listing-floor"
                          className="input-control"
                          inputMode="decimal"
                          type="text"
                          maxLength={24}
                          value={floor}
                          onChange={(event) => {
                            setFloor(event.target.value);
                            setError('');
                          }}
                          aria-describedby="market-form-error"
                        />
                        <span>USDC</span>
                      </div>
                    </div>
                    <div className="form-field">
                      <label className="field-label" htmlFor="listing-duration">
                        Price duration
                      </label>
                      <select
                        id="listing-duration"
                        className="input-control"
                        value={durationHours}
                        onChange={(event) =>
                          setDurationHours(Number(event.target.value))
                        }
                      >
                        <option value={1}>1 hour</option>
                        <option value={24}>1 day</option>
                        <option value={72}>3 days</option>
                      </select>
                      <p className="form-hint">
                        Price falls cubically to the floor, then holds until
                        expiry.
                      </p>
                    </div>
                  </>
                )}
                <div className="form-field">
                  <label className="field-label" htmlFor="listing-expiry">
                    Listing expiry
                  </label>
                  <select
                    id="listing-expiry"
                    className="input-control"
                    value={expiryDays}
                    onChange={(event) =>
                      setExpiryDays(Number(event.target.value))
                    }
                  >
                    <option value={1}>1 day</option>
                    <option value={7}>7 days</option>
                    <option value={30}>30 days</option>
                  </select>
                </div>
              </div>
              <details className="market-advanced">
                <summary>Reserve for a buyer</summary>
                <div className="form-field">
                  <label className="field-label" htmlFor="listing-recipient">
                    Buyer address · optional
                  </label>
                  <input
                    ref={recipientRef}
                    id="listing-recipient"
                    className="input-control"
                    placeholder="0x…"
                    type="text"
                    maxLength={42}
                    value={recipient}
                    onChange={(event) => {
                      setRecipient(event.target.value);
                      setError('');
                    }}
                    aria-describedby="listing-recipient-hint market-form-error"
                  />
                  <p className="form-hint" id="listing-recipient-hint">
                    An address restriction in this local preview. No address is
                    contacted, and the listing is not confidential.
                  </p>
                </div>
              </details>
            </>
          )}
          <p className="form-error" id="market-form-error" role="alert">
            {error}
          </p>
          <PreviewNotice />
        </div>
        <div className="dialog-footer">
          <button
            className="button secondary"
            type="button"
            onClick={
              review
                ? () => {
                    setReview(null);
                    setError('');
                  }
                : onClose
            }
          >
            {review ? 'Back' : 'Cancel'}
          </button>
          <button className="button primary" type="submit" disabled={!asset}>
            {review
              ? editing
                ? 'Save changes'
                : 'List in preview'
              : 'Review listing'}
            <ArrowRight size={16} aria-hidden="true" />
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export default function MarketplaceActionDialog(props: Props) {
  const { action, state, onClose, onApply } = props;
  const [error, setError] = useState('');
  if (action.kind === 'list' || action.kind === 'edit')
    return <ListingFormDialog {...props} action={action} />;
  if (action.kind === 'details')
    return (
      <Dialog
        title={`veKITTEN #${ALL_MARKET_ASSETS.find((asset) => asset.id === action.listing.assetId)!.positionId}`}
        kicker="LISTING DETAILS · PREVIEW"
        onClose={onClose}
      >
        <div className="dialog-body">
          <ListingFacts listing={action.listing} />
          <PreviewNotice />
        </div>
        <div className="dialog-footer">
          <button className="button secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </Dialog>
    );
  if (action.kind === 'cancel')
    return (
      <Dialog
        title="Cancel listing?"
        kicker="MARKETPLACE · PREVIEW"
        onClose={onClose}
      >
        <div className="dialog-body">
          <ListingFacts listing={action.listing} />
          <p>
            The position stays in your preview account and can be listed again.
          </p>
          <p className="form-error" role="alert">
            {error}
          </p>
          <PreviewNotice />
        </div>
        <div className="dialog-footer">
          <button className="button secondary" onClick={onClose}>
            Keep listing
          </button>
          <button
            className="button primary"
            onClick={() => {
              const issue = onApply({});
              if (issue) setError(issue);
            }}
          >
            Cancel listing
          </button>
        </div>
      </Dialog>
    );
  const items = action.quotes
    .map((quote) => ({
      quote,
      listing: state.listings.find((entry) => entry.id === quote.id),
    }))
    .filter(
      (item): item is { quote: PurchaseQuote; listing: PreviewListing } =>
        !!item.listing,
    );
  const total = action.quotes.reduce(
    (sum, quote) => sum + BigInt(quote.maxPriceMicros),
    0n,
  );
  const totalFee = action.quotes.reduce(
    (sum, quote) => sum + (BigInt(quote.maxPriceMicros) * 5n) / 1000n,
    0n,
  );
  return (
    <Dialog
      title={action.kind === 'sweep' ? 'Review sweep' : 'Review purchase'}
      kicker="USDC · PREVIEW"
      onClose={onClose}
    >
      <div className="dialog-body">
        <div className="market-purchase-list">
          {items.map(({ quote, listing }) => {
            const asset = ALL_MARKET_ASSETS.find(
              (entry) => entry.id === listing.assetId,
            )!;
            return (
              <div className="breakdown-row" key={listing.id}>
                <span>
                  veKITTEN #{asset.positionId}
                  <small>
                    {formatBalance(
                      asset.underlyingBalance,
                      asset.underlyingSymbol,
                    )}{' '}
                    · {listing.kind === 'dutch' ? 'Dutch' : 'Fixed'}
                  </small>
                </span>
                <strong>{formatMicros(quote.maxPriceMicros)}</strong>
              </div>
            );
          })}
        </div>
        <div className="cost-breakdown">
          <div className="breakdown-row">
            <span>
              Seller fee<small>0.5% per position, paid by sellers</small>
            </span>
            <span>{formatMicros(totalFee)}</span>
          </div>
          <div className="breakdown-row">
            <span>Sellers receive</span>
            <span>{formatMicros(total - totalFee)}</span>
          </div>
          <div className="breakdown-row">
            <span>Marketplace demo balance</span>
            <span>{formatMicros(state.balanceMicros)}</span>
          </div>
          <div className="breakdown-row total">
            <span>Maximum total</span>
            <strong>{formatMicros(total)}</strong>
          </div>
        </div>
        <p className="form-hint">
          Final asks are checked together. A lower Dutch ask reduces your total;
          a changed, expired or unavailable listing cancels the entire preview
          purchase.
        </p>
        <p className="form-error" role="alert">
          {error}
        </p>
        <PreviewNotice />
      </div>
      <div className="dialog-footer">
        <button className="button secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          className="button primary"
          onClick={() => {
            const issue = onApply({ quotes: action.quotes });
            if (issue) setError(issue);
          }}
        >
          {action.kind === 'sweep'
            ? 'Confirm preview sweep'
            : 'Confirm preview buy'}
          <ArrowRight size={16} aria-hidden="true" />
        </button>
      </div>
    </Dialog>
  );
}
