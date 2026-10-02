import {
  ArrowRight,
  Check,
  Copy,
  Layers3,
  RefreshCcw,
  Tag,
  Wallet,
} from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { assetLink, copyText } from '../app/links';
import { useToast } from '../app/toast';
import {
  COLLATERAL_LIMITS,
  SAMPLE_CREDIT_EPOCHS,
  SAMPLE_REWARD_MICROS,
} from '../data';
import {
  discountBps,
  formatAmount,
  formatBalance,
  formatBps,
  formatDate,
  formatLockRemaining,
  formatMicros,
  lockDaysRemaining,
  marketplaceFee,
  marketplaceProceeds,
  microsToDecimal,
  parseUSDCMicros,
  priceMicros,
  type Asset,
  type PurchaseDestination,
  type PurchaseReceipt,
} from '../domain';
import { getLendingMetrics, type LendingState } from '../lending';
import {
  buyerError,
  LISTING_EXPIRY_DAYS,
  listingPriceError,
  type PreviewListing,
} from '../listings';
import Dialog from './Dialog';
import { AmountField, AssetSummary, Breakdown, Notice } from './ui/Bits';

const min = (a: bigint, b: bigint) => (a < b ? a : b);
const max = (a: bigint, b: bigint) => (a > b ? a : b);

export function AssetDetails({
  asset,
  listing,
  now,
  onClose,
  onBuy,
  onCancelListing,
}: {
  asset: Asset;
  listing?: PreviewListing;
  now: number;
  onClose: () => void;
  onBuy?: () => void;
  onCancelListing?: () => void;
}) {
  const toast = useToast();
  const days = lockDaysRemaining(asset.unlockDate, now);
  const price = listing ? Number(listing.priceMicros) / 1e6 : asset.price;
  return (
    <Dialog title={asset.name} kicker={asset.collection} onClose={onClose} wide>
      <div className="dialog-body detail-layout">
        <div className="detail-art-wrap">
          <img
            className="detail-art"
            src={asset.artwork}
            alt={`Portal illustration for ${asset.name}`}
            width="640"
            height="640"
          />
          <span className="pill accent detail-badge">{asset.category}</span>
        </div>
        <div className="detail-copy">
          <p>{asset.description}</p>
          <dl className="detail-stats">
            <div>
              <dt>Position ID</dt>
              <dd>#{asset.positionId}</dd>
            </div>
            <div>
              <dt>Locked balance</dt>
              <dd>
                {formatBalance(asset.underlyingBalance, asset.underlyingSymbol)}
              </dd>
            </div>
            <div>
              <dt>Unlock date</dt>
              <dd>{formatDate(asset.unlockDate)}</dd>
            </div>
            <div>
              <dt>Lock remaining</dt>
              <dd>{formatLockRemaining(days)}</dd>
            </div>
            <div>
              <dt>{listing ? 'Your ask' : 'Illustrative ask'}</dt>
              <dd>{formatAmount(price)}</dd>
            </div>
            <div>
              <dt>Reference value</dt>
              <dd>{formatAmount(asset.referenceValue)}</dd>
            </div>
            <div>
              <dt>Discount</dt>
              <dd className="accent-text">
                {formatBps(discountBps({ ...asset, price }))}
              </dd>
            </div>
            <div>
              <dt>Example reward / epoch</dt>
              <dd>{formatMicros(SAMPLE_REWARD_MICROS[asset.id])}</dd>
            </div>
          </dl>
          <Notice>
            Demo veKITTEN position and sample KITTEN units. No live balance,
            lock verification or yield data.
          </Notice>
        </div>
      </div>
      <div className="dialog-footer">
        <button
          type="button"
          className="button ghost"
          onClick={() =>
            void copyText(assetLink(asset)).then((copied) =>
              copied
                ? toast('Listing link copied.', 'info')
                : toast(
                    'Copy failed. The link is in the address bar.',
                    'warning',
                  ),
            )
          }
        >
          <Copy size={15} aria-hidden="true" /> Copy link
        </button>
        <span className="footer-spacer" />
        <button className="button secondary" onClick={onClose}>
          Back to listings
        </button>
        {onBuy && (
          <button className="button primary" onClick={onBuy}>
            Review purchase <ArrowRight size={16} aria-hidden="true" />
          </button>
        )}
        {onCancelListing && (
          <button className="button primary" onClick={onCancelListing}>
            Cancel listing
          </button>
        )}
      </div>
    </Dialog>
  );
}

type BuyProps = {
  asset: Asset;
  lending: LendingState;
  onClose: () => void;
  onBuy: (input: {
    destination: PurchaseDestination;
    borrowMicros: string;
  }) => string | null;
};

export function BuyDialog({ asset, lending, onClose, onBuy }: BuyProps) {
  const price = priceMicros(asset.price);
  const fee = priceMicros(marketplaceFee(asset.price));
  const wallet = BigInt(lending.walletMicros);
  const metrics = getLendingMetrics(lending, COLLATERAL_LIMITS);
  const positionCredit = BigInt(COLLATERAL_LIMITS[asset.id]);
  const remainingCredit =
    BigInt(metrics.totalCreditMicros) +
    positionCredit -
    BigInt(lending.debtMicros);
  const borrowCap = max(
    0n,
    min(remainingCredit, BigInt(lending.poolCashMicros)),
  );
  const shortfall = price > wallet ? price - wallet : 0n;
  // Cover the shortfall after the 0.5% origination fee when credit allows.
  const neededGross = shortfall === 0n ? 0n : (shortfall * 1000n + 994n) / 995n;
  const [destination, setDestination] = useState<PurchaseDestination>(
    shortfall > 0n && neededGross <= borrowCap ? 'collateral' : 'wallet',
  );
  const [borrow, setBorrow] = useState(
    microsToDecimal(min(neededGross, borrowCap)),
  );
  const [error, setError] = useState('');
  const borrowRef = useRef<HTMLInputElement>(null);
  const parsed = parseUSDCMicros(borrow);
  const borrowMicros =
    destination === 'collateral' && parsed !== null && parsed <= borrowCap
      ? parsed
      : 0n;
  const originationFee = (borrowMicros * 5n) / 1000n;
  const netBorrow = borrowMicros - originationFee;
  const fromWallet = price > netBorrow ? price - netBorrow : 0n;
  const walletAfter = wallet + netBorrow - price;
  const days = lockDaysRemaining(asset.unlockDate, Date.now());

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      destination === 'collateral' &&
      (parsed === null || parsed > borrowCap)
    ) {
      setError(
        parsed === null
          ? 'Use a plain decimal amount with up to six decimal places.'
          : `Borrow up to ${formatMicros(borrowCap)} against this purchase.`,
      );
      borrowRef.current?.focus();
      return;
    }
    if (walletAfter < 0n) {
      setError(
        destination === 'collateral'
          ? 'Your demo balance plus the borrowed USDC does not cover the ask. Borrow more or choose another position.'
          : 'Your demo balance does not cover the ask. Buy into your credit line to borrow against it.',
      );
      return;
    }
    const issue = onBuy({
      destination,
      borrowMicros: borrowMicros.toString(),
    });
    if (issue) setError(issue);
  }

  return (
    <Dialog
      title={`Buy ${asset.name}`}
      kicker="PURCHASE · LOCAL PREVIEW"
      onClose={onClose}
    >
      <form onSubmit={submit} noValidate>
        <div className="dialog-body">
          <AssetSummary
            asset={asset}
            kicker={`${asset.collection} · ${asset.category}`}
          />
          <dl className="fact-row">
            <div>
              <dt>Discount</dt>
              <dd className="accent-text">{formatBps(discountBps(asset))}</dd>
            </div>
            <div>
              <dt>Reference value</dt>
              <dd>{formatAmount(asset.referenceValue)}</dd>
            </div>
            <div>
              <dt>Lock remaining</dt>
              <dd>{formatLockRemaining(days)}</dd>
            </div>
          </dl>
          <fieldset className="destination">
            <legend className="field-label">Send to</legend>
            <label className="destination-option">
              <input
                type="radio"
                name="destination"
                value="wallet"
                checked={destination === 'wallet'}
                onChange={() => {
                  setDestination('wallet');
                  setError('');
                }}
              />
              <span className="destination-icon" aria-hidden="true">
                <Wallet size={17} />
              </span>
              <span>
                <strong>Demo wallet</strong>
                <small>Keep it idle to deposit or list later</small>
              </span>
            </label>
            <label className="destination-option">
              <input
                type="radio"
                name="destination"
                value="collateral"
                checked={destination === 'collateral'}
                onChange={() => {
                  setDestination('collateral');
                  setError('');
                }}
              />
              <span className="destination-icon" aria-hidden="true">
                <Layers3 size={17} />
              </span>
              <span>
                <strong>Credit line</strong>
                <small>
                  Deposit as collateral · adds {formatMicros(positionCredit)} of
                  credit
                </small>
              </span>
            </label>
            <label className="destination-option">
              <input
                type="radio"
                name="destination"
                value="relayer"
                checked={destination === 'relayer'}
                onChange={() => {
                  setDestination('relayer');
                  setError('');
                }}
              />
              <span className="destination-icon" aria-hidden="true">
                <RefreshCcw size={17} />
              </span>
              <span>
                <strong>Reward relayer</strong>
                <small>
                  Automated reward collection · about{' '}
                  {formatMicros(SAMPLE_REWARD_MICROS[asset.id])} per epoch, no
                  borrowing
                </small>
              </span>
            </label>
          </fieldset>
          {destination === 'collateral' && (
            <ol className="stepper" aria-label="Purchase steps">
              <li>Deposit</li>
              <li>Borrow{borrowMicros === 0n ? ' (none)' : ''}</li>
              <li>Pay seller</li>
            </ol>
          )}
          {destination === 'relayer' && (
            <ol className="stepper" aria-label="Purchase steps">
              <li>Add to relayer</li>
              <li>Pay seller</li>
            </ol>
          )}
          {destination === 'collateral' && (
            <AmountField
              id="buy-borrow"
              label="Borrow against this purchase"
              value={borrow}
              onChange={(value) => {
                setBorrow(value);
                setError('');
              }}
              maximum={borrowCap}
              hint={`Up to ${formatMicros(borrowCap)} · example reward ${formatMicros(SAMPLE_REWARD_MICROS[asset.id])} × ${SAMPLE_CREDIT_EPOCHS} epochs`}
              error={Boolean(error)}
              inputRef={borrowRef}
              describedBy="buy-borrow-hint buy-error"
            />
          )}
          <Breakdown
            rows={[
              { label: 'Ask price', value: formatMicros(price), strong: true },
              {
                label: 'Seller fee',
                hint: '0.5%, paid by the seller',
                value: formatMicros(fee),
              },
              ...(destination === 'collateral'
                ? [
                    {
                      label: 'Borrowed, after 0.5% origination fee',
                      value: formatMicros(netBorrow),
                    },
                  ]
                : []),
              {
                label: 'Paid from demo balance',
                value: formatMicros(fromWallet),
              },
              {
                label: 'Demo balance after purchase',
                value:
                  walletAfter < 0n ? 'Insufficient' : formatMicros(walletAfter),
                total: true,
              },
            ]}
          />
          <p className="form-error" id="buy-error" role="alert">
            {error}
          </p>
          <Notice>
            Local simulation. Your demo USDC pays the ask; no NFT changes
            ownership and no funds move.
          </Notice>
        </div>
        <div className="dialog-footer">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" type="submit">
            {destination === 'collateral'
              ? 'Buy & deposit in preview'
              : destination === 'relayer'
                ? 'Buy into relayer in preview'
                : 'Buy in preview'}
            <ArrowRight size={16} aria-hidden="true" />
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function SweepDialog({
  assets,
  lending,
  onClose,
  onBuy,
}: {
  assets: readonly Asset[];
  lending: LendingState;
  onClose: () => void;
  onBuy: () => string | null;
}) {
  const [error, setError] = useState('');
  const total = assets.reduce(
    (sum, asset) => sum + priceMicros(asset.price),
    0n,
  );
  const fees = assets.reduce(
    (sum, asset) => sum + priceMicros(marketplaceFee(asset.price)),
    0n,
  );
  const wallet = BigInt(lending.walletMicros);
  return (
    <Dialog
      title={`Buy ${assets.length} positions`}
      kicker="SWEEP · LOCAL PREVIEW"
      onClose={onClose}
    >
      <div className="dialog-body">
        <ul className="sweep-list">
          {assets.map((asset) => (
            <li key={asset.id}>
              <img
                src={asset.artwork}
                alt=""
                width="36"
                height="36"
                className="thumb"
              />
              <span>
                <strong>{asset.name}</strong>
                <small>
                  {formatBalance(
                    asset.underlyingBalance,
                    asset.underlyingSymbol,
                  )}{' '}
                  · {formatBps(discountBps(asset))} discount
                </small>
              </span>
              <strong>{formatAmount(asset.price)}</strong>
            </li>
          ))}
        </ul>
        <Breakdown
          rows={[
            { label: 'Total asks', value: formatMicros(total), strong: true },
            {
              label: 'Seller fees',
              hint: '0.5% each, paid by sellers',
              value: formatMicros(fees),
            },
            {
              label: 'Demo balance after purchase',
              value:
                total > wallet ? 'Insufficient' : formatMicros(wallet - total),
              total: true,
            },
          ]}
        />
        {total > wallet && (
          <Notice tone="warning">
            Your demo balance covers {formatMicros(wallet)}. Remove positions
            from the selection or buy one into your credit line.
          </Notice>
        )}
        <p className="form-error" role="alert">
          {error}
        </p>
        <Notice>
          Each position lands in your demo wallet. Everything stays in this
          browser.
        </Notice>
      </div>
      <div className="dialog-footer">
        <button type="button" className="button secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="button primary"
          disabled={total > wallet}
          onClick={() => {
            const issue = onBuy();
            if (issue) setError(issue);
          }}
        >
          Buy {assets.length} positions in preview{' '}
          <ArrowRight size={16} aria-hidden="true" />
        </button>
      </div>
    </Dialog>
  );
}

export function SellDialog({
  positions,
  initialId,
  initialVisibility = 'public',
  onClose,
  onList,
}: {
  positions: readonly Asset[];
  initialId?: string;
  initialVisibility?: 'public' | 'private';
  onClose: () => void;
  onList: (draft: {
    assetId: string;
    price: string;
    expiryDays: number;
    buyer?: string;
  }) => string | null;
}) {
  const [assetId, setAssetId] = useState(initialId ?? positions[0]?.id ?? '');
  const [visibility, setVisibility] = useState(initialVisibility);
  const [buyer, setBuyer] = useState('');
  const buyerRef = useRef<HTMLInputElement>(null);
  const selected = positions.find((asset) => asset.id === assetId);
  const [price, setPrice] = useState(() =>
    selected ? String(selected.price) : '',
  );
  const [expiryDays, setExpiryDays] = useState<number>(7);
  const [error, setError] = useState('');
  const priceRef = useRef<HTMLInputElement>(null);
  const micros = parseUSDCMicros(price);
  const fee = micros === null ? 0n : (micros * 5n) / 1000n;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const issue = selected
      ? listingPriceError(price)
      : 'Choose a position to list.';
    if (issue) {
      setError(issue);
      priceRef.current?.focus();
      return;
    }
    if (visibility === 'private') {
      const buyerIssue = buyer.trim()
        ? buyerError(buyer)
        : 'Enter the buyer’s 0x address for a private listing.';
      if (buyerIssue) {
        setError(buyerIssue);
        buyerRef.current?.focus();
        return;
      }
    }
    const result = onList({
      assetId,
      price,
      expiryDays,
      buyer: visibility === 'private' ? buyer : undefined,
    });
    if (result) setError(result);
  }

  return (
    <Dialog
      title="List a position"
      kicker="SELL · LOCAL PREVIEW"
      onClose={onClose}
    >
      <form onSubmit={submit} noValidate>
        <div className="dialog-body">
          {positions.length ? (
            <>
              <div className="form-field">
                <label className="field-label" htmlFor="sell-position">
                  Position
                </label>
                <select
                  id="sell-position"
                  className="input-control"
                  value={assetId}
                  onChange={(event) => {
                    const next = positions.find(
                      (asset) => asset.id === event.target.value,
                    );
                    setAssetId(event.target.value);
                    if (next) setPrice(String(next.price));
                    setError('');
                  }}
                >
                  {positions.map((asset) => (
                    <option key={asset.id} value={asset.id}>
                      {asset.name} ·{' '}
                      {formatBalance(
                        asset.underlyingBalance,
                        asset.underlyingSymbol,
                      )}
                    </option>
                  ))}
                </select>
              </div>
              {selected && (
                <AssetSummary asset={selected} kicker="From your demo wallet" />
              )}
              <div className="form-grid">
                <div className="form-field">
                  <label className="field-label" htmlFor="sell-price">
                    Ask price
                  </label>
                  <div className={`amount-input${error ? ' invalid' : ''}`}>
                    <input
                      ref={priceRef}
                      id="sell-price"
                      className="input-control"
                      inputMode="decimal"
                      autoComplete="off"
                      maxLength={24}
                      value={price}
                      aria-invalid={Boolean(error)}
                      aria-describedby="sell-price-hint sell-error"
                      onChange={(event) => {
                        setPrice(event.target.value);
                        setError('');
                      }}
                    />
                    <span className="amount-unit">USDC</span>
                  </div>
                  <p className="form-hint" id="sell-price-hint">
                    {selected
                      ? `Reference value ${formatAmount(selected.referenceValue)} · ${
                          micros !== null && listingPriceError(price) === null
                            ? `${formatBps(discountBps({ price: Number(price), referenceValue: selected.referenceValue }))} discount`
                            : 'enter an ask from 1 to 1,000,000 USDC'
                        }`
                      : ''}
                  </p>
                </div>
                <div className="form-field">
                  <label className="field-label" htmlFor="sell-expiry">
                    Listing expires in
                  </label>
                  <select
                    id="sell-expiry"
                    className="input-control"
                    value={expiryDays}
                    onChange={(event) =>
                      setExpiryDays(Number(event.target.value))
                    }
                  >
                    {LISTING_EXPIRY_DAYS.map((days) => (
                      <option key={days} value={days}>
                        {days} {days === 1 ? 'day' : 'days'}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <fieldset className="segmented compact">
                <legend className="field-label">Visibility</legend>
                {(
                  [
                    ['public', 'Public', 'Anyone can buy it'],
                    ['private', 'Private (OTC)', 'Reserved for one buyer'],
                  ] as const
                ).map(([value, label, text]) => (
                  <label key={value} className="segment">
                    <input
                      type="radio"
                      name="listing-visibility"
                      value={value}
                      checked={visibility === value}
                      onChange={() => {
                        setVisibility(value);
                        setError('');
                      }}
                    />
                    <span>
                      <strong>{label}</strong>
                      <small>{text}</small>
                    </span>
                  </label>
                ))}
              </fieldset>
              {visibility === 'private' && (
                <div className="form-field">
                  <label className="field-label" htmlFor="sell-buyer">
                    Buyer address
                  </label>
                  <input
                    ref={buyerRef}
                    id="sell-buyer"
                    className="input-control mono"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="0x…"
                    maxLength={42}
                    value={buyer}
                    aria-describedby="sell-buyer-hint sell-error"
                    onChange={(event) => {
                      setBuyer(event.target.value);
                      setError('');
                    }}
                  />
                  <p className="form-hint" id="sell-buyer-hint">
                    Only this address will see the listing in its OTC tab. It
                    stays off the public listings.
                  </p>
                </div>
              )}
              <Breakdown
                rows={[
                  {
                    label: 'Ask price',
                    value: micros === null ? '—' : formatMicros(micros),
                    strong: true,
                  },
                  {
                    label: 'Seller fee at settlement',
                    hint: 'One-time 0.5% · nothing charged now',
                    value: micros === null ? '—' : formatMicros(fee),
                  },
                  {
                    label: 'You would receive',
                    value: micros === null ? '—' : formatMicros(micros - fee),
                    total: true,
                  },
                ]}
              />
            </>
          ) : (
            <p className="panel-text">
              Every position you own is deposited or already listed. Remove
              collateral or cancel a listing to sell it.
            </p>
          )}
          <p className="form-error" id="sell-error" role="alert">
            {error}
          </p>
          <Notice>
            Saving a listing does not transfer, escrow or approve anything. It
            stays in this browser until you cancel it or it expires.
          </Notice>
        </div>
        <div className="dialog-footer">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="button primary"
            type="submit"
            disabled={!positions.length}
          >
            <Tag size={15} aria-hidden="true" /> List in preview
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function CancelListingDialog({
  asset,
  listing,
  onClose,
  onConfirm,
}: {
  asset: Asset;
  listing: PreviewListing;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      title="Cancel this listing?"
      kicker="SELL · LOCAL PREVIEW"
      onClose={onClose}
    >
      <div className="dialog-body">
        <AssetSummary
          asset={asset}
          kicker={`Listed for ${formatMicros(listing.priceMicros)}`}
        />
        <p className="panel-text">
          The position returns to your demo wallet, where you can deposit it as
          collateral or list it again. The cancelled listing stays in your
          history.
        </p>
      </div>
      <div className="dialog-footer">
        <button type="button" className="button secondary" onClick={onClose}>
          Keep listing
        </button>
        <button type="button" className="button primary" onClick={onConfirm}>
          Cancel listing
        </button>
      </div>
    </Dialog>
  );
}

export function SuccessDialog({
  receipts,
  assets,
  onClose,
  onBorrow,
}: {
  receipts: readonly PurchaseReceipt[];
  assets: readonly Asset[];
  onClose: () => void;
  onBorrow: () => void;
}) {
  const collateral = receipts.some(
    (receipt) => receipt.destination === 'collateral',
  );
  const relayer = receipts.some((receipt) => receipt.destination === 'relayer');
  const total = receipts.reduce(
    (sum, receipt) => sum + priceMicros(receipt.price),
    0n,
  );
  return (
    <Dialog
      title={
        receipts.length > 1
          ? `${receipts.length} purchases saved`
          : 'Purchase saved'
      }
      kicker="LOCAL RECEIPT"
      onClose={onClose}
    >
      <div className="dialog-body success-panel">
        <span className="success-icon">
          <Check size={28} aria-hidden="true" />
        </span>
        <p>
          {assets.length === 1
            ? `${assets[0].name} is now ${collateral ? 'deposited as collateral' : relayer ? 'in the reward relayer' : 'in your demo wallet'}.`
            : `${assets.length} positions are now in your demo wallet.`}
        </p>
        <div className="receipt-card">
          <Breakdown
            rows={[
              { label: 'Paid', value: formatMicros(total), strong: true },
              ...receipts.map((receipt) => ({
                label: `Receipt RW-${receipt.id.slice(0, 8).toUpperCase()}`,
                value: formatAmount(receipt.price),
              })),
              {
                label: 'Seller proceeds',
                hint: 'After the 0.5% seller fee',
                value: formatAmount(
                  receipts.reduce(
                    (sum, receipt) => sum + marketplaceProceeds(receipt.price),
                    0,
                  ),
                ),
              },
            ]}
          />
        </div>
        <p className="form-hint">
          <Layers3 size={14} aria-hidden="true" /> Stored in this browser. No
          wallet or funds involved.
        </p>
      </div>
      <div className="dialog-footer">
        <button className="button secondary" onClick={onClose}>
          Continue browsing
        </button>
        <button className="button primary" onClick={onBorrow}>
          {collateral
            ? 'View credit line'
            : relayer
              ? 'View relayer'
              : 'Deposit as collateral'}{' '}
          <ArrowRight size={16} aria-hidden="true" />
        </button>
      </div>
    </Dialog>
  );
}
