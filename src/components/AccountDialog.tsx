import { ArrowRight, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import type { Page } from '../app/router';
import { collateralLimits, STARTING_POSITION_IDS } from '../data';
import {
  formatAmount,
  formatBalance,
  formatDate,
  formatMicros,
  type Asset,
  type PurchaseReceipt,
} from '../domain';
import { formatShares } from '../format';
import { getLendingMetrics, type LendingState } from '../lending';
import { DEFAULT_MARKET } from '../markets';
import type { LendingAction } from '../preview/actions';
import type { Holdings } from '../preview/store';
import Dialog from './Dialog';
import { TabPanel, Tabs } from './ui/Tabs';

export type AccountTab = 'positions' | 'borrow' | 'lend';
type Props = {
  receipts: readonly PurchaseReceipt[];
  lending: LendingState;
  holdings: Holdings;
  /** Whether anything differs from the starting preview. */
  canReset: boolean;
  onClose: () => void;
  onReset: () => void;
  onAction: (action: LendingAction) => void;
  onExplore: (page: Page) => void;
  initialTab?: AccountTab | undefined;
};

function status(asset: Asset, holdings: Holdings) {
  if (holdings.collateral.some((item) => item.id === asset.id))
    return { label: 'Collateral', tone: 'accent' };
  if (holdings.relayer.some((item) => item.id === asset.id))
    return { label: 'Relayer', tone: 'violet' };
  if (holdings.listed.some((item) => item.asset.id === asset.id))
    return { label: 'Listed', tone: 'warning' };
  return { label: 'In wallet', tone: 'muted' };
}

export default function AccountDialog({
  receipts,
  lending,
  holdings,
  canReset,
  onClose,
  onReset,
  onAction,
  onExplore,
  initialTab = 'positions',
}: Props) {
  const [tab, setTab] = useState<AccountTab>(initialTab);
  const metrics = getLendingMetrics(lending, collateralLimits(lending));
  return (
    <Dialog
      title="Preview account"
      kicker="SAVED IN THIS BROWSER"
      onClose={onClose}
      wide
    >
      <div className="dialog-body account">
        <dl className="mini-stats">
          <div>
            <dt>Demo USDC</dt>
            <dd>{formatMicros(lending.walletMicros)}</dd>
          </div>
          <div>
            <dt>Positions owned</dt>
            <dd>{holdings.owned.length}</dd>
          </div>
          <div>
            <dt>Collateral</dt>
            <dd>{holdings.collateral.length}</dd>
          </div>
          <div>
            <dt>Vault shares</dt>
            <dd>{formatShares(lending.shareBalanceRaw)}</dd>
          </div>
        </dl>
        <Tabs<AccountTab>
          idBase="account"
          label="Account view"
          active={tab}
          onChange={setTab}
          variant="pill"
          items={[
            { id: 'positions', label: 'Positions' },
            { id: 'borrow', label: 'Borrowing' },
            { id: 'lend', label: 'Vault' },
          ]}
        />
        {tab === 'positions' && (
          <TabPanel idBase="account" id="positions">
            <ul className="row-list">
              {holdings.owned.map((asset) => {
                const receipt = receipts.find(
                  (item) => item.assetId === asset.id,
                );
                const state = status(asset, holdings);
                return (
                  <li className="list-row" key={asset.id}>
                    <img
                      className="thumb"
                      src={asset.artwork}
                      alt=""
                      width="40"
                      height="40"
                    />
                    <span className="list-row-main">
                      <strong>{asset.name}</strong>
                      <small>
                        {formatBalance(
                          asset.underlyingBalance,
                          asset.underlyingSymbol,
                        )}{' '}
                        ·{' '}
                        {receipt
                          ? `bought ${formatDate(receipt.createdAt)} for ${formatAmount(receipt.price)}`
                          : STARTING_POSITION_IDS.includes(asset.id)
                            ? 'starting demo position'
                            : 'sample position'}
                      </small>
                    </span>
                    <span className={`pill ${state.tone}`}>{state.label}</span>
                  </li>
                );
              })}
            </ul>
            <div className="dialog-actions">
              <button
                type="button"
                className="button secondary"
                onClick={() => onExplore('marketplace')}
              >
                Explore positions <ArrowRight size={16} aria-hidden="true" />
              </button>
            </div>
          </TabPanel>
        )}
        {tab === 'borrow' && (
          <TabPanel idBase="account" id="borrow">
            <dl className="mini-stats">
              <div>
                <dt>Borrowed</dt>
                <dd>{formatMicros(lending.debtMicros)}</dd>
              </div>
              <div>
                <dt>Credit limit</dt>
                <dd>{formatMicros(metrics.totalCreditMicros)}</dd>
              </div>
              <div>
                <dt>Available credit</dt>
                <dd>{formatMicros(metrics.availableCreditMicros)}</dd>
              </div>
              <div>
                <dt>Demo {DEFAULT_MARKET.tokenSymbol}</dt>
                <dd>
                  {formatBalance(
                    Number(lending.tokenUnits),
                    DEFAULT_MARKET.tokenSymbol,
                  )}
                </dd>
              </div>
            </dl>
            <div className="dialog-actions">
              <button
                type="button"
                className="button secondary"
                onClick={() => onExplore('borrow')}
              >
                Manage collateral
              </button>
              <button
                type="button"
                className="button primary"
                disabled={
                  BigInt(lending.debtMicros) === 0n ||
                  BigInt(lending.walletMicros) === 0n
                }
                onClick={() => onAction({ kind: 'repay' })}
              >
                Repay in preview
              </button>
            </div>
          </TabPanel>
        )}
        {tab === 'lend' && (
          <TabPanel idBase="account" id="lend">
            <dl className="mini-stats three">
              <div>
                <dt>Supplied value</dt>
                <dd>{formatMicros(metrics.suppliedAssetsMicros)}</dd>
              </div>
              <div>
                <dt>Vault shares</dt>
                <dd>{formatShares(lending.shareBalanceRaw)}</dd>
              </div>
              <div>
                <dt>Available withdrawal</dt>
                <dd>{formatMicros(metrics.maxWithdrawMicros)}</dd>
              </div>
            </dl>
            <p className="form-hint">
              A share of the illustrative pooled USDC vault. Available
              withdrawals depend on liquid funds; rewards can vary or be zero.
            </p>
            <div className="dialog-actions">
              <button
                type="button"
                className="button secondary"
                disabled={BigInt(metrics.maxWithdrawMicros) === 0n}
                onClick={() => onAction({ kind: 'withdraw' })}
              >
                Withdraw in preview
              </button>
              <button
                type="button"
                className="button primary"
                onClick={() => onExplore('earn')}
              >
                Open vault <ArrowRight size={16} aria-hidden="true" />
              </button>
            </div>
          </TabPanel>
        )}
        <p className="form-hint">
          Local simulations, not real ownership, custody or funds.
        </p>
      </div>
      <div className="dialog-footer">
        <button
          type="button"
          className="button ghost"
          disabled={!canReset}
          onClick={onReset}
        >
          <RotateCcw size={15} aria-hidden="true" /> Reset preview
        </button>
        <span className="footer-spacer" />
        <button type="button" className="button secondary" onClick={onClose}>
          Done
        </button>
      </div>
    </Dialog>
  );
}
