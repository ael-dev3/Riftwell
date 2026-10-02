import { ArrowUpRight, HandCoins, Layers3 } from 'lucide-react';
import { COLLATERAL, LEND_REQUESTS } from '../data';
import type { Market } from '../markets';
import {
  formatAmount,
  maxBorrowAmount,
  type Asset,
  type Receipt,
} from '../domain';

export type LendingTab = 'borrow' | 'lend';
type Props = {
  market: Market;
  tab: LendingTab;
  onTab: (tab: LendingTab) => void;
  receipts: Receipt[];
  onBorrow: (asset: Asset) => void;
  onLend: (asset: Asset) => void;
};

export default function Lending({
  market,
  tab,
  onTab,
  receipts,
  onBorrow,
  onLend,
}: Props) {
  const isBorrow = tab === 'borrow';
  const assets = (isBorrow ? COLLATERAL : LEND_REQUESTS).filter(
    (asset) => asset.marketId === market.id,
  );
  return (
    <>
      <div className="section-heading">
        <div>
          <p className="section-eyebrow">{market.positionSymbol} LENDING</p>
          <h2 className="section-title">Borrow against your position.</h2>
          <p className="section-description">
            Review a sample USDC loan or propose lending terms.
          </p>
        </div>
        <div
          className="segmented-control lending-tabs"
          aria-label="Lending view"
        >
          <button
            className={isBorrow ? 'active' : ''}
            onClick={() => onTab('borrow')}
            aria-pressed={isBorrow}
          >
            Borrow
          </button>
          <button
            className={!isBorrow ? 'active' : ''}
            onClick={() => onTab('lend')}
            aria-pressed={!isBorrow}
          >
            Lend
          </button>
        </div>
      </div>
      <div className="lending-layout">
        <div className="lending-intro">
          <span className="lending-intro-icon">
            {isBorrow ? (
              <Layers3 size={24} aria-hidden="true" />
            ) : (
              <HandCoins size={24} aria-hidden="true" />
            )}
          </span>
          <div>
            <h3>
              {isBorrow
                ? 'Review your collateral.'
                : 'Set your proposal terms.'}
            </h3>
            <p>
              {isBorrow
                ? 'Choose a demo veKITTEN position from a separate sample account. Borrow up to 40% of its fixed illustrative reference value.'
                : 'Review fictional USDC requests and propose an amount, APR and duration. APR is capped at 40% in this preview.'}
            </p>
          </div>
        </div>
        <div className="lending-table-wrap">
          <table className="lending-table">
            <caption className="sr-only">
              {isBorrow
                ? 'Fictional NFT positions in a separate demo account, available for preview loans'
                : 'Fictional sample borrowing requests'}
            </caption>
            <thead>
              <tr>
                <th scope="col">
                  {isBorrow ? 'Demo collateral' : 'Borrowing request'}
                </th>
                <th scope="col">
                  {isBorrow ? 'Reference value' : 'Requested amount'}
                </th>
                <th scope="col">{isBorrow ? 'Max. loan' : 'Duration'}</th>
                <th scope="col">Illustrative APR</th>
                <th scope="col">
                  <span className="sr-only">Action</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {assets.map((asset) => {
                const used = receipts.some(
                  (receipt) =>
                    receipt.assetId === asset.id &&
                    (isBorrow
                      ? receipt.kind === 'borrow' && receipt.status === 'active'
                      : receipt.kind === 'lend' &&
                        receipt.status === 'proposed'),
                );
                return (
                  <tr key={asset.id}>
                    <td>
                      <div className="row-asset">
                        <img
                          className="row-thumb"
                          src={asset.artwork}
                          alt=""
                          width="52"
                          height="52"
                        />
                        <div>
                          <strong>{asset.name}</strong>
                          <span>{asset.lockTerm} lock · demo</span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className="mobile-label">
                        {isBorrow ? 'Reference value' : 'Requested amount'}
                      </span>
                      {formatAmount(
                        isBorrow
                          ? asset.referenceValue
                          : maxBorrowAmount(asset),
                      )}
                    </td>
                    <td>
                      <span className="mobile-label">
                        {isBorrow ? 'Max. loan' : 'Duration'}
                      </span>
                      {isBorrow
                        ? formatAmount(maxBorrowAmount(asset))
                        : '30 days'}
                    </td>
                    <td>
                      <span className="mobile-label">Illustrative APR</span>
                      <span className="rate-pill">{asset.apr}%</span>
                    </td>
                    <td className="table-actions">
                      <button
                        className="button secondary small"
                        disabled={used}
                        onClick={() =>
                          isBorrow ? onBorrow(asset) : onLend(asset)
                        }
                      >
                        {used
                          ? isBorrow
                            ? 'In preview loan'
                            : 'Proposal saved'
                          : isBorrow
                            ? 'Review loan'
                            : 'Make proposal'}
                        {!used && <ArrowUpRight size={15} aria-hidden="true" />}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <p className="workspace-note">
        Sample assets, rates and requests. Loans are simulations; there is no
        live liquidity or guaranteed return.
      </p>
    </>
  );
}
