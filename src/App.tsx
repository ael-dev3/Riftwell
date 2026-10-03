import { ArrowRight, CircleUserRound, Info } from 'lucide-react';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useMinuteClock } from './app/clock';
import { preloadable, preloadWhenIdle } from './app/preloadable';
import { useHashRoute, type Page } from './app/router';
import { useShortcuts } from './app/shortcuts';
import { applyTheme, readTheme } from './app/theme';
import { ToastProvider, useToast } from './app/toast';
import AppShell, { ShortcutsDialog } from './components/shell/AppShell';
import Dialog from './components/Dialog';
import PageFallback from './components/PageFallback';
import { Notice } from './components/ui/Bits';
import type { AccountTab } from './components/AccountDialog';
import type { LendingActionInput } from './components/LendingDialogs';
import { collateralLimits } from './data';
import {
  marketplaceFee,
  priceMicros,
  type Asset,
  type PurchaseDestination,
  type PurchaseReceipt,
} from './domain';
import {
  advanceEpoch,
  borrow,
  depositCollateral,
  depositToRelayer,
  getLendingMetrics,
  increaseLock,
  LendingError,
  mergePositions,
  purchase,
  purchaseIntoCollateral,
  purchaseIntoRelayer,
  removeCollateral,
  repay,
  setRelayerRepayShare,
  supply,
  withdraw,
  withdrawFromRelayer,
} from './lending';
import {
  cancelListing,
  createListing,
  ListingError,
  type PreviewListing,
} from './listings';
import { marketSales, marketSeries, summarize } from './market';
import { DEFAULT_MARKET, type Market } from './markets';
import { activityLabel, type LendingAction } from './preview/actions';
import { useHoldings, usePreviewStore } from './preview/store';
import { isDefaultVotePlan, type VotePlan } from './vote';
import BorrowPage from './pages/BorrowPage';
import EarnPage from './pages/EarnPage';
import MarketPage from './pages/MarketPage';
import NotFoundPage from './pages/NotFoundPage';
import type { StatsModel } from './pages/StatsPage';

const SimulatorPage = preloadable(() => import('./pages/SimulatorPage'));
const FaqPage = preloadable(() => import('./pages/FaqPage'));
const StatsPage = preloadable(() => import('./pages/StatsPage'));
const BrandPage = preloadable(() => import('./pages/BrandPage'));
const PrivacyPage = preloadable(() => import('./pages/PrivacyPage'));
const AccountDialog = preloadable(() => import('./components/AccountDialog'));
const LendingActionDialog = preloadable(
  () => import('./components/LendingDialogs'),
);
const VaultDetails = preloadable(() => import('./components/VaultDetails'));
const trade = () => import('./components/TradeDialogs');
const AssetDetails = preloadable(() =>
  trade().then((m) => ({ default: m.AssetDetails })),
);
const BuyDialog = preloadable(() =>
  trade().then((m) => ({ default: m.BuyDialog })),
);
const SweepDialog = preloadable(() =>
  trade().then((m) => ({ default: m.SweepDialog })),
);
const SellDialog = preloadable(() =>
  trade().then((m) => ({ default: m.SellDialog })),
);
const CancelListingDialog = preloadable(() =>
  trade().then((m) => ({ default: m.CancelListingDialog })),
);
const SuccessDialog = preloadable(() =>
  trade().then((m) => ({ default: m.SuccessDialog })),
);
const DEFERRED = [
  SimulatorPage,
  FaqPage,
  StatsPage,
  BrandPage,
  PrivacyPage,
  AccountDialog,
  LendingActionDialog,
  VaultDetails,
  AssetDetails,
  BuyDialog,
  SweepDialog,
  SellDialog,
  CancelListingDialog,
  SuccessDialog,
];

type Modal =
  | { type: 'buy'; asset: Asset }
  | { type: 'sweep'; assets: Asset[] }
  | { type: 'sell'; assetId?: string; private?: boolean }
  | { type: 'cancel-listing'; listing: PreviewListing }
  | { type: 'lending'; action: LendingAction }
  | { type: 'vault' }
  | { type: 'account'; tab?: AccountTab }
  | { type: 'reset' | 'about' | 'shortcuts' }
  | { type: 'success'; receipts: PurchaseReceipt[]; assets: Asset[] }
  | null;

function PreviewApp() {
  const { route, navigate } = useHashRoute('borrow');
  const [market, setMarket] = useState<Market>(DEFAULT_MARKET);
  const store = usePreviewStore();
  const now = useMinuteClock();
  const holdings = useHoldings(
    store.portfolio,
    store.lending,
    store.listings,
    now,
  );
  const [modal, setModal] = useState<Modal>(null);
  const toast = useToast();
  const searchRef = useRef<HTMLInputElement>(null);
  const accountRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    document.documentElement.style.setProperty('--accent', market.accentColor);
  }, [market]);
  useEffect(() => preloadWhenIdle(DEFERRED), []);
  useEffect(() => setModal(null), [route.page]);

  const go = useCallback(
    (page: Page) => navigate({ page, item: null }),
    [navigate],
  );

  // Deep links: #marketplace/<position id> opens that listing's details.
  const detailItem = route.page === 'marketplace' ? route.item : null;
  const detailListing = detailItem
    ? holdings.listed.find((entry) => entry.asset.positionId === detailItem)
    : undefined;
  const detailAsset = detailItem
    ? (detailListing?.asset ??
      holdings.market.find((asset) => asset.positionId === detailItem))
    : undefined;
  useEffect(() => {
    if (detailItem && !detailAsset) {
      toast('That listing is no longer available.', 'info');
      navigate({ page: 'marketplace', item: null }, 'replace');
    }
  }, [detailItem, detailAsset, navigate, toast]);
  const closeDetails = () =>
    navigate({ page: 'marketplace', item: null }, 'replace');

  useShortcuts({
    onNavigate: go,
    onSearch: () => {
      if (route.page !== 'marketplace') go('marketplace');
      const focus = (attempt = 0) => {
        if (searchRef.current) searchRef.current.focus();
        // The page may still be rendering inside a view transition.
        else if (attempt < 60) requestAnimationFrame(() => focus(attempt + 1));
      };
      requestAnimationFrame(() => focus());
    },
    onTheme: () => applyTheme(readTheme() === 'dark' ? 'light' : 'dark'),
    onHelp: () => setModal({ type: 'shortcuts' }),
  });

  function closeModal() {
    setModal(null);
    requestAnimationFrame(() => {
      if (document.activeElement === document.body) accountRef.current?.focus();
    });
  }

  function applyLendingAction(
    action: LendingAction,
    input: LendingActionInput,
  ): string | null {
    try {
      const current = store.lendingRef.current;
      const limits = collateralLimits(current);
      let next = current;
      switch (action.kind) {
        case 'deposit-collateral':
          if (!holdings.wallet.some((asset) => asset.id === action.asset.id))
            return 'This position is no longer in your demo wallet.';
          next = depositCollateral(current, action.asset.id, limits);
          break;
        case 'remove-collateral':
          next = removeCollateral(current, action.asset.id, limits);
          break;
        case 'relayer-deposit':
          if (!holdings.wallet.some((asset) => asset.id === action.asset.id))
            return 'This position is no longer in your demo wallet.';
          next = depositToRelayer(current, action.asset.id, limits);
          break;
        case 'merge': {
          const sourceId = input.mergeSourceId ?? '';
          if (!holdings.wallet.some((asset) => asset.id === sourceId))
            return 'Choose a position that is still in your demo wallet.';
          next = mergePositions(current, sourceId, action.asset.id, limits);
          break;
        }
        case 'increase-lock':
          next = increaseLock(
            current,
            action.asset.id,
            input.lockUnits ?? '0',
            limits,
          );
          break;
        case 'relayer-withdraw':
          next = withdrawFromRelayer(current, action.asset.id);
          break;
        case 'borrow':
          next = borrow(current, input.amountMicros ?? '0', limits);
          break;
        case 'repay':
          next = repay(current, input.amountMicros ?? '0');
          break;
        case 'supply':
          next = supply(current, input.amountMicros ?? '0');
          break;
        case 'withdraw':
          next = withdraw(current, input.amountMicros ?? '0');
          break;
        case 'epoch':
          next = advanceEpoch(
            current,
            input.collateralRewardMicros ?? '0',
            input.poolYieldMicros ?? '0',
            input.relayerRewardMicros ?? '0',
          );
          break;
        case 'relayer-strategy':
          next = setRelayerRepayShare(current, Number(input.repayBps ?? '0'));
          break;
        case 'how':
          return null;
      }
      store.setLending(next);
      toast(`${activityLabel[action.kind]} in your local preview.`);
      closeModal();
      return null;
    } catch (error) {
      return error instanceof LendingError
        ? error.message
        : 'This preview action could not be completed. Try again.';
    }
  }

  function receiptFor(
    asset: Asset,
    destination: PurchaseDestination,
  ): PurchaseReceipt {
    return {
      id: crypto.randomUUID(),
      assetId: asset.id,
      createdAt: new Date().toISOString(),
      kind: 'purchase',
      price: asset.price,
      sellerFee: marketplaceFee(asset.price),
      destination,
    };
  }

  function buy(
    asset: Asset,
    {
      destination,
      borrowMicros,
    }: { destination: PurchaseDestination; borrowMicros: string },
  ): string | null {
    if (!holdings.market.some((item) => item.id === asset.id))
      return 'This listing is no longer available.';
    try {
      const price = priceMicros(asset.price).toString();
      const current = store.lendingRef.current;
      const limits = collateralLimits(current);
      const next =
        destination === 'collateral'
          ? purchaseIntoCollateral(
              current,
              asset.id,
              price,
              borrowMicros,
              limits,
            )
          : destination === 'relayer'
            ? purchaseIntoRelayer(current, asset.id, price, limits)
            : purchase(current, asset.id, price);
      const receipt = receiptFor(asset, destination);
      store.setLending(next);
      store.setPortfolio((portfolio) => ({
        ...portfolio,
        receipts: [...portfolio.receipts, receipt],
      }));
      setModal({ type: 'success', receipts: [receipt], assets: [asset] });
      toast(
        destination === 'collateral'
          ? `${asset.name} bought and deposited in your preview.`
          : destination === 'relayer'
            ? `${asset.name} bought into the relayer in your preview.`
            : `${asset.name} bought in your preview.`,
      );
      return null;
    } catch (error) {
      return error instanceof LendingError
        ? error.message
        : 'This preview purchase could not be completed. Try again.';
    }
  }

  function sweep(assets: readonly Asset[]): string | null {
    if (
      assets.some(
        (asset) => !holdings.market.some((item) => item.id === asset.id),
      )
    )
      return 'One of these listings is no longer available.';
    try {
      let next = store.lendingRef.current;
      for (const asset of assets)
        next = purchase(next, asset.id, priceMicros(asset.price).toString());
      const receipts = assets.map((asset) => receiptFor(asset, 'wallet'));
      store.setLending(next);
      store.setPortfolio((portfolio) => ({
        ...portfolio,
        receipts: [...portfolio.receipts, ...receipts],
      }));
      setModal({ type: 'success', receipts, assets: [...assets] });
      toast(`${assets.length} positions bought in your preview.`);
      return null;
    } catch (error) {
      return error instanceof LendingError
        ? error.message
        : 'These preview purchases could not be completed. Try again.';
    }
  }

  function list(draft: {
    assetId: string;
    price: string;
    expiryDays: number;
    buyer?: string;
  }): string | null {
    try {
      store.setListings(
        createListing(
          store.listings,
          draft,
          holdings.wallet.map((asset) => asset.id),
        ),
      );
      toast(
        draft.buyer
          ? 'Private listing saved in your preview.'
          : 'Listing saved in your preview.',
      );
      closeModal();
      return null;
    } catch (error) {
      return error instanceof ListingError
        ? error.message
        : 'This listing could not be saved.';
    }
  }

  function cancel(listing: PreviewListing) {
    try {
      store.setListings(cancelListing(store.listings, listing.id));
      toast('Listing cancelled. The position is back in your wallet.', 'info');
    } catch (error) {
      toast(
        error instanceof ListingError
          ? error.message
          : 'This listing could not be cancelled.',
        'warning',
      );
    }
    if (detailItem) closeDetails();
    closeModal();
  }

  function saveVotes(plan: VotePlan) {
    store.setVotes(plan);
    toast('Vote plan saved in this browser.');
  }

  const accountCount =
    store.portfolio.receipts.length +
    store.lending.collateralIds.length +
    store.lending.relayerIds.length +
    (BigInt(store.lending.shareBalanceRaw) > 0n ? 1 : 0) +
    holdings.listed.length;
  const canReset =
    store.portfolio.receipts.length > 0 ||
    store.lending.activity.length > 0 ||
    store.listings.listings.length > 0 ||
    store.lending.relayerRepayBps !== 0 ||
    !isDefaultVotePlan(store.votes);

  const notices = store.storageIssue && (
    <div className="notices">
      {store.storageIssue && (
        <div className="notice storage-notice" role="status">
          <Info size={18} aria-hidden="true" />
          <p>Preview changes won’t be saved in this browser.</p>
        </div>
      )}
    </div>
  );

  function statsModel(): StatsModel {
    const lending = store.lending;
    const metrics = getLendingMetrics(lending, collateralLimits(lending));
    const epochs = lending.activity.filter((entry) => entry.kind === 'epoch');
    const sales = marketSales(store.portfolio.receipts);
    const totals = summarize(sales);
    return {
      mode: 'preview',
      vault: {
        assetsMicros: BigInt(metrics.totalAssetsMicros),
        outstandingMicros: BigInt(lending.poolOutstandingMicros),
        cashMicros: BigInt(lending.poolCashMicros),
        utilizationBps: metrics.utilizationBps,
      },
      rewards: {
        micros: epochs.reduce(
          (sum, entry) =>
            sum +
            BigInt(entry.rewardRepaidMicros) +
            BigInt(entry.rewardSurplusMicros) +
            BigInt(entry.relayerRewardMicros) +
            BigInt(entry.poolYieldMicros),
          0n,
        ),
        epochs: epochs.length,
      },
      sales: { count: totals.count, volumeMicros: totals.volumeMicros },
      volumeSeries: marketSeries(sales, 'all', 'volume', now),
      positions: [...holdings.market, ...holdings.owned].map((asset) => ({
        balance: asset.underlyingBalance,
        unlockMs: Date.parse(asset.unlockDate),
      })),
      listed: holdings.market.length + holdings.listed.length,
    };
  }

  let page;
  switch (route.page) {
    case 'borrow':
      page = (
        <BorrowPage
          market={market}
          lending={store.lending}
          holdings={holdings}
          votes={store.votes}
          now={now}
          onAction={(action) => setModal({ type: 'lending', action })}
          onVotes={saveVotes}
          onNavigate={go}
          onSell={(asset) => setModal({ type: 'sell', assetId: asset.id })}
        />
      );
      break;
    case 'earn':
      page = (
        <EarnPage
          market={market}
          lending={store.lending}
          onAction={(action) => setModal({ type: 'lending', action })}
          onDetails={() => setModal({ type: 'vault' })}
        />
      );
      break;
    case 'marketplace':
      page = (
        <MarketPage
          market={market}
          holdings={holdings}
          receipts={store.portfolio.receipts}
          listings={store.listings}
          walletMicros={store.lending.walletMicros}
          now={now}
          searchRef={searchRef}
          onDetails={(asset) =>
            navigate({ page: 'marketplace', item: asset.positionId }, 'replace')
          }
          onBuy={(asset) => setModal({ type: 'buy', asset })}
          onSweep={(assets) => setModal({ type: 'sweep', assets })}
          onSell={(asset, options) =>
            setModal({
              type: 'sell',
              ...(asset ? { assetId: asset.id } : {}),
              ...(options?.private === undefined
                ? {}
                : { private: options.private }),
            })
          }
          onCancel={(listing) => setModal({ type: 'cancel-listing', listing })}
        />
      );
      break;
    case 'simulator':
      page = <SimulatorPage market={market} />;
      break;
    case 'faq':
      page = <FaqPage market={market} mode="preview" />;
      break;
    case 'stats':
      page = <StatsPage market={market} model={statsModel()} now={now} />;
      break;
    case 'brand':
      page = <BrandPage market={market} />;
      break;
    case 'privacy':
      page = <PrivacyPage mode="preview" />;
      break;
    case 'not-found':
      page = <NotFoundPage path={route.item} onNavigate={go} />;
      break;
  }

  const cancelTarget =
    modal?.type === 'cancel-listing'
      ? holdings.listed.find((entry) => entry.listing.id === modal.listing.id)
      : undefined;

  return (
    <AppShell
      route={route}
      onNavigate={go}
      market={market}
      onMarketChange={(selected) => {
        setMarket(selected);
        closeModal();
      }}
      mode="preview"
      onAbout={() => setModal({ type: 'about' })}
      onShortcuts={() => setModal({ type: 'shortcuts' })}
      notices={notices}
      account={
        <button
          ref={accountRef}
          type="button"
          className="button secondary account-button"
          aria-label={
            accountCount > 0
              ? `Preview account, ${accountCount} ${accountCount === 1 ? 'item' : 'items'}`
              : 'Preview account'
          }
          onClick={() => setModal({ type: 'account' })}
        >
          <CircleUserRound size={17} aria-hidden="true" />
          <span className="account-label">Preview account</span>
          {accountCount > 0 && (
            <span className="account-count">{accountCount}</span>
          )}
        </button>
      }
    >
      <Suspense fallback={<PageFallback />}>
        <div className="page-body" key={route.page}>
          {page}
        </div>
      </Suspense>
      <Suspense fallback={null}>
        {detailAsset && !modal && (
          <AssetDetails
            asset={detailAsset}
            now={now}
            onClose={closeDetails}
            {...(detailListing
              ? {
                  listing: detailListing.listing,
                  onCancelListing: () =>
                    setModal({
                      type: 'cancel-listing',
                      listing: detailListing.listing,
                    }),
                }
              : {
                  onBuy: () => {
                    closeDetails();
                    setModal({ type: 'buy', asset: detailAsset });
                  },
                })}
          />
        )}
        {modal?.type === 'buy' && (
          <BuyDialog
            asset={modal.asset}
            lending={store.lending}
            onClose={closeModal}
            onBuy={(input) => buy(modal.asset, input)}
          />
        )}
        {modal?.type === 'sweep' && (
          <SweepDialog
            assets={modal.assets}
            lending={store.lending}
            onClose={closeModal}
            onBuy={() => sweep(modal.assets)}
          />
        )}
        {modal?.type === 'sell' && (
          <SellDialog
            positions={holdings.wallet}
            {...(modal.assetId === undefined
              ? {}
              : { initialId: modal.assetId })}
            initialVisibility={modal.private ? 'private' : 'public'}
            onClose={closeModal}
            onList={list}
          />
        )}
        {modal?.type === 'cancel-listing' && cancelTarget && (
          <CancelListingDialog
            asset={cancelTarget.asset}
            listing={cancelTarget.listing}
            onClose={closeModal}
            onConfirm={() => cancel(cancelTarget.listing)}
          />
        )}
        {modal?.type === 'success' && (
          <SuccessDialog
            receipts={modal.receipts}
            assets={modal.assets}
            onClose={closeModal}
            onBorrow={() => go('borrow')}
          />
        )}
        {modal?.type === 'lending' && (
          <LendingActionDialog
            key={modal.action.kind}
            action={modal.action}
            state={store.lending}
            wallet={holdings.wallet}
            onClose={closeModal}
            onApply={(input) => applyLendingAction(modal.action, input)}
          />
        )}
        {modal?.type === 'vault' && (
          <VaultDetails
            market={market}
            lending={store.lending}
            onClose={closeModal}
          />
        )}
        {modal?.type === 'account' && (
          <AccountDialog
            receipts={store.portfolio.receipts}
            lending={store.lending}
            holdings={holdings}
            canReset={canReset}
            {...(modal.tab === undefined ? {} : { initialTab: modal.tab })}
            onClose={closeModal}
            onReset={() => setModal({ type: 'reset' })}
            onAction={(action) => setModal({ type: 'lending', action })}
            onExplore={(next) => {
              closeModal();
              go(next);
            }}
          />
        )}
      </Suspense>
      {modal?.type === 'shortcuts' && <ShortcutsDialog onClose={closeModal} />}
      {modal?.type === 'reset' && (
        <Dialog
          title="Reset preview account?"
          kicker="RESET PREVIEW"
          onClose={closeModal}
        >
          <div className="dialog-body">
            <p>
              This will clear saved purchases, listings, collateral, merges,
              debt, vault shares, vote plans and activity, then restore the
              starting demo balances.
            </p>
            <p className="text-muted">
              No real assets or funds are affected. You can explore every
              preview flow again after resetting.
            </p>
          </div>
          <div className="dialog-footer">
            <button
              className="button secondary"
              onClick={() => setModal({ type: 'account' })}
            >
              Keep my preview
            </button>
            <button
              className="button primary"
              onClick={() => {
                store.reset();
                setModal({ type: 'account' });
                toast('Your preview account has been reset.', 'info');
              }}
            >
              Reset preview
            </button>
          </div>
        </Dialog>
      )}
      {modal?.type === 'about' && (
        <Dialog
          title="Room to explore."
          kicker="ABOUT THIS PREVIEW"
          onClose={closeModal}
        >
          <div className="dialog-body">
            <p>
              Riftwell combines credit lines against {market.positionSymbol}{' '}
              positions, a pooled USDC vault and a marketplace. The selected
              market is {market.name}.
            </p>
            <dl className="facts">
              <div>
                <dt>Positions &amp; prices</dt>
                <dd>
                  Demo {market.positionSymbol} positions and sample{' '}
                  {market.tokenSymbol} units. Locked balances, dates and USDC
                  values are illustrative.
                </dd>
              </div>
              <div>
                <dt>Purchases &amp; lending</dt>
                <dd>
                  Local simulations. No wallet, signatures, approvals or real
                  transactions.
                </dd>
              </div>
              <div>
                <dt>Epoch countdown</dt>
                <dd>
                  Clock arithmetic for {market.name}’s weekly periods. No chain
                  data is read.
                </dd>
              </div>
              <div>
                <dt>Your preview account</dt>
                <dd>
                  Saved to this browser’s local storage. Use Reset preview to
                  clear it.
                </dd>
              </div>
            </dl>
            <Notice>
              No live liquidity, on-chain ownership or lock checks, or
              guaranteed returns.
            </Notice>
          </div>
          <div className="dialog-footer">
            <button className="button primary" onClick={closeModal}>
              Back to exploring <ArrowRight size={16} aria-hidden="true" />
            </button>
          </div>
        </Dialog>
      )}
    </AppShell>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <PreviewApp />
    </ToastProvider>
  );
}
