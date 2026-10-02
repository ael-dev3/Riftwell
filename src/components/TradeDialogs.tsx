import { ArrowRight, Check, Info, Layers3 } from 'lucide-react';
import type { ReactNode } from 'react';
import {
  formatAmount,
  formatBalance,
  formatDate,
  marketplaceFee,
  marketplaceProceeds,
  type Asset,
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
  return (
    <Dialog
      title="Preview purchase saved"
      kicker="LOCAL RECEIPT"
      onClose={onClose}
    >
      <div className="dialog-body success-panel">
        <span className="success-icon">
          <Check size={28} aria-hidden="true" />
        </span>
        <p>{asset.name} has been added to your sample account.</p>
        <div className="receipt-card">
          <div className="breakdown-row">
            <span>Illustrative ask</span>
            <strong>{formatAmount(receipt.price)}</strong>
          </div>
          <div className="breakdown-row">
            <span>Status</span>
            <span className="status-pill">Preview purchase</span>
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
