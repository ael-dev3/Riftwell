import { ArrowRight, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { ASSETS } from '../data';
import {
  calculateLoan,
  formatDate,
  formatAmount,
  type BorrowReceipt,
  type LendReceipt,
  type Receipt,
} from '../domain';
import Dialog from './Dialog';

type Props = {
  receipts: Receipt[];
  onClose: () => void;
  onReset: () => void;
  onCancel: (receipt: BorrowReceipt | LendReceipt) => void;
  onExplore: (
    section: 'marketplace' | 'lending',
    lendingTab?: 'borrow' | 'lend',
  ) => void;
  initialTab?: AccountTab;
};
export type AccountTab = 'purchase' | 'borrow' | 'lend';

export default function AccountDialog({
  receipts,
  onClose,
  onReset,
  onCancel,
  onExplore,
  initialTab = 'purchase',
}: Props) {
  const [tab, setTab] = useState<AccountTab>(initialTab);
  const purchases = receipts.filter(
    (receipt) => receipt.kind === 'purchase',
  ).length;
  const activeLoans = receipts.filter(
    (receipt) => receipt.kind === 'borrow' && receipt.status === 'active',
  ).length;
  const proposals = receipts.filter(
    (receipt) => receipt.kind === 'lend' && receipt.status === 'proposed',
  ).length;
  const entries = receipts
    .filter((receipt) => receipt.kind === tab)
    .slice()
    .reverse();
  return (
    <Dialog
      title="Preview account"
      kicker="YOUR PREVIEW ACCOUNT"
      onClose={onClose}
      wide
    >
      <div className="dialog-body">
        <div className="portfolio-summary">
          <div>
            <strong>{purchases.toString().padStart(2, '0')}</strong>
            <span>Sample positions</span>
          </div>
          <div>
            <strong>{activeLoans.toString().padStart(2, '0')}</strong>
            <span>Preview loans</span>
          </div>
          <div>
            <strong>{proposals.toString().padStart(2, '0')}</strong>
            <span>Open proposals</span>
          </div>
        </div>
        <p className="form-hint">
          A sample portfolio, saved to this browser. Nothing here represents
          ownership or a funded loan.
        </p>
        <div
          className="segmented-control portfolio-tabs"
          aria-label="Account view"
        >
          <button
            className={tab === 'purchase' ? 'active' : ''}
            onClick={() => setTab('purchase')}
            aria-pressed={tab === 'purchase'}
          >
            Positions
          </button>
          <button
            className={tab === 'borrow' ? 'active' : ''}
            onClick={() => setTab('borrow')}
            aria-pressed={tab === 'borrow'}
          >
            Loans
          </button>
          <button
            className={tab === 'lend' ? 'active' : ''}
            onClick={() => setTab('lend')}
            aria-pressed={tab === 'lend'}
          >
            Proposals
          </button>
        </div>
        {entries.length > 0 ? (
          <div className="portfolio-list">
            {entries.map((receipt) => {
              const asset = ASSETS.find((item) => item.id === receipt.assetId);
              if (!asset) return null;
              const isPurchase = receipt.kind === 'purchase';
              return (
                <article className="portfolio-item" key={receipt.id}>
                  <div className="portfolio-item-main">
                    <img
                      className="row-thumb"
                      src={asset.artwork}
                      alt=""
                      width="64"
                      height="64"
                    />
                    <div className="portfolio-item-copy">
                      <p className="asset-collection">{asset.collection}</p>
                      <h3>{asset.name}</h3>
                      <span className="text-muted">
                        {formatDate(receipt.createdAt)}
                      </span>
                    </div>
                    <div className="portfolio-item-value">
                      <strong>
                        {formatAmount(
                          isPurchase ? receipt.price : receipt.principal,
                        )}
                      </strong>
                      <span
                        className={`status-pill${!isPurchase && receipt.status === 'cancelled' ? ' muted' : ''}`}
                      >
                        {isPurchase
                          ? 'Preview purchase'
                          : receipt.status === 'cancelled'
                            ? 'Cancelled'
                            : receipt.kind === 'borrow'
                              ? 'Simulated loan'
                              : 'Proposal only'}
                      </span>
                    </div>
                  </div>
                  <details className="receipt-details">
                    <summary>Receipt breakdown</summary>
                    <dl className="details-list">
                      <div>
                        <dt>Reference</dt>
                        <dd className="receipt-reference">
                          RW-{receipt.id.slice(0, 8).toUpperCase()}
                        </dd>
                      </div>
                      {isPurchase ? (
                        <>
                          <div>
                            <dt>Price paid in preview</dt>
                            <dd>{formatAmount(receipt.price)}</dd>
                          </div>
                          <div>
                            <dt>Seller fee (0.5%)</dt>
                            <dd>{formatAmount(receipt.sellerFee)}</dd>
                          </div>
                        </>
                      ) : (
                        <>
                          <div>
                            <dt>Duration / illustrative APR</dt>
                            <dd>
                              {receipt.duration} days / {receipt.apr}%
                            </dd>
                          </div>
                          <div>
                            <dt>Lender interest over term</dt>
                            <dd>{formatAmount(receipt.interest)}</dd>
                          </div>
                          {receipt.kind === 'borrow' && (
                            <>
                              <div>
                                <dt>Origination fee (0.5%)</dt>
                                <dd>{formatAmount(receipt.originationFee)}</dd>
                              </div>
                              <div>
                                <dt>Amount received in preview</dt>
                                <dd>
                                  {formatAmount(
                                    calculateLoan(
                                      receipt.principal,
                                      receipt.apr,
                                      receipt.duration,
                                    ).netProceeds,
                                  )}
                                </dd>
                              </div>
                              <div>
                                <dt>Repayment at term</dt>
                                <dd>
                                  {formatAmount(
                                    calculateLoan(
                                      receipt.principal,
                                      receipt.apr,
                                      receipt.duration,
                                    ).repayment,
                                  )}
                                </dd>
                              </div>
                            </>
                          )}
                        </>
                      )}
                    </dl>
                  </details>
                  {!isPurchase && receipt.status !== 'cancelled' && (
                    <button
                      className="inline-link cancellation-link"
                      onClick={() => onCancel(receipt)}
                    >
                      Cancel{' '}
                      {receipt.kind === 'borrow' ? 'preview loan' : 'proposal'}
                    </button>
                  )}
                </article>
              );
            })}
          </div>
        ) : (
          <div className="empty-state">
            <h3>
              {tab === 'purchase'
                ? 'No sample purchases yet.'
                : tab === 'borrow'
                  ? 'No preview loans yet.'
                  : 'No proposals yet.'}
            </h3>
            <p>
              {tab === 'purchase'
                ? 'Review a purchase to add a sample position here.'
                : tab === 'borrow'
                  ? 'Review a sample loan to try the borrowing flow.'
                  : 'Make a sample lending proposal to explore the terms.'}
            </p>
            <button
              className="button secondary"
              onClick={() =>
                onExplore(
                  tab === 'purchase' ? 'marketplace' : 'lending',
                  tab === 'lend' ? 'lend' : 'borrow',
                )
              }
            >
              {tab === 'purchase' ? 'Explore positions' : 'Explore lending'}
              <ArrowRight size={16} aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
      <div className="dialog-footer">
        <button
          className="button ghost"
          disabled={receipts.length === 0}
          onClick={onReset}
        >
          <RotateCcw size={15} aria-hidden="true" />
          Reset preview
        </button>
        <button className="button secondary" onClick={onClose}>
          Done
        </button>
      </div>
    </Dialog>
  );
}
