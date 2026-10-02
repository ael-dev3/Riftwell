import { ArrowRight, ArrowUpRight, CircleUserRound, Info } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ASSETS, COLLATERAL_LIMITS } from './data';
import { DEFAULT_MARKET, type Market } from './markets';
import MarketSelector from './components/MarketSelector';
import PortalMark from './components/PortalMark';
import {
  emptyPortfolio,
  parsePortfolio,
  STORAGE_KEY,
  LEGACY_STORAGE_KEY,
  type Asset,
  type Portfolio,
  type Receipt,
} from './domain';
import AccountDialog, { type AccountTab } from './components/AccountDialog';
import Dialog from './components/Dialog';
import Lending, {
  activityLabel,
  type LendingAction,
  type LendingTab,
} from './components/Lending';
import LendingActionDialog, {
  type LendingActionInput,
} from './components/LendingDialogs';
import {
  advanceEpoch,
  borrow,
  createLendingState,
  depositCollateral,
  LendingError,
  parseLendingState,
  removeCollateral,
  repay,
  supply,
  withdraw,
  type LendingState,
} from './lending';
import Marketplace from './components/Marketplace';
import {
  AssetDetails,
  PurchaseDialog,
  SuccessDialog,
} from './components/TradeDialogs';

type Section = 'lending' | 'marketplace';
type Modal =
  | { type: 'details' | 'purchase'; asset: Asset }
  | { type: 'lending-action'; action: LendingAction }
  | { type: 'account'; tab?: AccountTab }
  | { type: 'reset' | 'about' }
  | { type: 'success'; receipt: Receipt; asset: Asset }
  | null;

const LENDING_STORAGE_KEY = 'riftwell.pooled-lending-preview.v1';
function initialPortfolio(): {
  portfolio: Portfolio;
  lending: LendingState;
  readIssue: boolean;
  migrated: boolean;
} {
  try {
    const current = localStorage.getItem(STORAGE_KEY);
    const legacy =
      current === null ? localStorage.getItem(LEGACY_STORAGE_KEY) : null;
    return {
      portfolio: parsePortfolio(
        current ?? legacy,
        ASSETS.map((asset) => asset.id),
      ),
      lending: parseLendingState(
        localStorage.getItem(LENDING_STORAGE_KEY),
        COLLATERAL_LIMITS,
      ),
      readIssue: false,
      migrated: legacy !== null,
    };
  } catch {
    return {
      portfolio: emptyPortfolio(),
      lending: createLendingState(),
      readIssue: true,
      migrated: false,
    };
  }
}

export default function App() {
  const [market, setMarket] = useState<Market>(DEFAULT_MARKET);
  const [section, setSection] = useState<Section>(() =>
    window.location.hash === '#lending' ? 'lending' : 'marketplace',
  );
  const [lendingTab, setLendingTab] = useState<LendingTab>('borrow');
  const [initial] = useState(initialPortfolio);
  const [portfolio, setPortfolio] = useState<Portfolio>(initial.portfolio);
  const [lending, setLending] = useState<LendingState>(initial.lending);
  const lendingRef = useRef(lending);
  lendingRef.current = lending;
  const [modal, setModal] = useState<Modal>(null);
  const [storageIssue, setStorageIssue] = useState(initial.readIssue);
  const [announcement, setAnnouncement] = useState('');
  const workspaceRef = useRef<HTMLElement>(null);
  const accountButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    document.documentElement.style.setProperty('--accent', market.accentColor);
  }, [market]);

  useEffect(() => {
    if (!['#marketplace', '#lending'].includes(window.location.hash))
      window.history.replaceState(null, '', '#marketplace');
    const syncRoute = () => {
      if (
        window.location.hash !== '#marketplace' &&
        window.location.hash !== '#lending'
      )
        return;
      setSection(
        window.location.hash === '#lending' ? 'lending' : 'marketplace',
      );
      closeModal();
    };
    window.addEventListener('hashchange', syncRoute);
    window.addEventListener('popstate', syncRoute);
    return () => {
      window.removeEventListener('hashchange', syncRoute);
      window.removeEventListener('popstate', syncRoute);
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(portfolio));
      localStorage.setItem(LENDING_STORAGE_KEY, JSON.stringify(lending));
      setStorageIssue(initial.readIssue);
    } catch {
      setStorageIssue(true);
    }
  }, [portfolio, lending, initial.readIssue]);

  const purchasedIds = new Set(
    portfolio.receipts
      .filter((receipt) => receipt.kind === 'purchase')
      .map((receipt) => receipt.assetId),
  );
  const availableAssets = ASSETS.filter(
    (asset) => asset.marketId === market.id && !purchasedIds.has(asset.id),
  );
  const accountCount =
    portfolio.receipts.length +
    lending.collateralIds.length +
    (BigInt(lending.shareBalanceRaw) > 0n ? 1 : 0);

  function selectSection(next: Section, scroll = false) {
    setSection(next);
    if (window.location.hash !== `#${next}`)
      window.history.pushState(null, '', `#${next}`);
    if (scroll)
      requestAnimationFrame(() => {
        workspaceRef.current?.focus({ preventScroll: true });
        workspaceRef.current?.scrollIntoView({
          behavior: window.matchMedia('(prefers-reduced-motion: reduce)')
            .matches
            ? 'instant'
            : 'smooth',
          block: 'start',
        });
      });
  }

  function closeModal() {
    setModal(null);
    requestAnimationFrame(() => {
      if (document.activeElement === document.body)
        accountButtonRef.current?.focus();
    });
  }

  function saveReceipt(receipt: Receipt) {
    setPortfolio((current) => {
      const duplicate = current.receipts.some(
        (item) =>
          item.kind === receipt.kind &&
          item.assetId === receipt.assetId &&
          item.kind === 'purchase',
      );
      return duplicate
        ? current
        : { ...current, receipts: [...current.receipts, receipt] };
    });
    const asset = ASSETS.find((item) => item.id === receipt.assetId);
    if (asset) setModal({ type: 'success', receipt, asset });
    setAnnouncement('Your preview receipt has been saved.');
  }

  function applyLendingAction(
    action: LendingAction,
    input: LendingActionInput,
  ): string | null {
    try {
      const current = lendingRef.current;
      let next = current;
      switch (action.kind) {
        case 'deposit-collateral':
          next = depositCollateral(current, action.asset.id, COLLATERAL_LIMITS);
          break;
        case 'remove-collateral':
          next = removeCollateral(current, action.asset.id, COLLATERAL_LIMITS);
          break;
        case 'borrow':
          next = borrow(current, input.amountMicros ?? '0', COLLATERAL_LIMITS);
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
          );
          break;
        case 'how':
          return null;
      }
      lendingRef.current = next;
      setLending(next);
      setAnnouncement(`${activityLabel[action.kind]} in your local preview.`);
      closeModal();
      return null;
    } catch (error) {
      return error instanceof LendingError
        ? error.message
        : 'This preview action could not be completed. Try again.';
    }
  }

  return (
    <div className="app-shell" data-market={market.id}>
      <a
        className="skip-link"
        href="#workspace"
        onClick={(event) => {
          event.preventDefault();
          selectSection(section, true);
        }}
      >
        Skip to explore
      </a>
      <header className="site-header">
        <a
          className="brand"
          href="#"
          aria-label="Riftwell home"
          onClick={(event) => {
            event.preventDefault();
            selectSection('marketplace');
            window.scrollTo({
              top: 0,
              behavior: window.matchMedia('(prefers-reduced-motion: reduce)')
                .matches
                ? 'instant'
                : 'smooth',
            });
          }}
        >
          <span className="brand-mark">
            <PortalMark />
          </span>
          <span className="brand-name">
            riftwell<span className="brand-period">.</span>
          </span>
        </a>
        <nav className="desktop-nav" aria-label="Main navigation">
          <button
            className={`nav-item${section === 'lending' ? ' active' : ''}`}
            aria-current={section === 'lending' ? 'page' : undefined}
            onClick={() => selectSection('lending')}
          >
            Lending
          </button>
          <button
            className={`nav-item${section === 'marketplace' ? ' active' : ''}`}
            aria-current={section === 'marketplace' ? 'page' : undefined}
            onClick={() => selectSection('marketplace')}
          >
            Marketplace
          </button>
        </nav>
        <div className="header-actions">
          <MarketSelector
            market={market}
            onChange={(selected) => {
              setMarket(selected);
              closeModal();
            }}
          />
          <span className="preview-badge">
            <span />
            Preview
          </span>
          <button
            ref={accountButtonRef}
            className="button secondary account-button"
            onClick={() => setModal({ type: 'account' })}
          >
            <CircleUserRound size={17} aria-hidden="true" />
            <span>Preview account</span>
            {accountCount > 0 && (
              <span className="account-count">{accountCount}</span>
            )}
          </button>
        </div>
      </header>
      <main className="page-main">
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="eyebrow">
              <span className="eyebrow-dot" />
              {market.name} · {market.chain}
            </p>
            <h1 className="hero-title" id="hero-title">
              A new orbit
              <br />
              for your <span className="accent-text">assets.</span>
            </h1>
            <p className="hero-description">
              Trade {market.positionSymbol} positions. Borrow against collateral
              or supply USDC to a pooled lending vault. Explore the{' '}
              {market.name}
              market in one simple space.
            </p>
            <div className="hero-actions">
              <button
                className="button primary"
                onClick={() => selectSection('marketplace', true)}
              >
                Explore positions <ArrowUpRight size={18} aria-hidden="true" />
              </button>
              <button
                className="button ghost"
                onClick={() => selectSection('lending', true)}
              >
                Try lending <ArrowRight size={16} aria-hidden="true" />
              </button>
            </div>
            <p className="hero-note">
              <span />
              An interactive preview. No wallet required.
            </p>
          </div>
          <div className="hero-visual" aria-hidden="true">
            <div className="portal-scene">
              <div className="portal-aura" />
              <div className="portal-orbit orbit-one" />
              <div className="portal-orbit orbit-two" />
              <div className="portal-orbit orbit-three" />
              <div className="portal-core" />
              <div className="portal-plinth" />
              <div className="portal-caption">
                <span className="portal-caption-dot" />
                {market.name.toUpperCase()} / {market.chain.toUpperCase()}
              </div>
              <div className="portal-coordinate top">
                {market.positionSymbol} / RW
              </div>
              <div className="portal-coordinate bottom">
                {market.tokenSymbol} POSITIONS
              </div>
            </div>
          </div>
        </section>
        {storageIssue && (
          <div className="notice storage-notice" role="status">
            <Info size={18} aria-hidden="true" />
            <p>
              This browser could not restore or save your preview account. You
              can explore, but changes may not persist after you refresh.
            </p>
          </div>
        )}
        {initial.migrated && (
          <div className="notice storage-notice" role="status">
            <Info size={18} aria-hidden="true" />
            <p>
              Your sample purchases were retained. Lending now uses a fresh
              pooled-vault preview; older unfunded proposals were not converted
              into balances.
            </p>
          </div>
        )}
        <section
          ref={workspaceRef}
          className="workspace"
          id="workspace"
          aria-label={
            section === 'marketplace'
              ? 'NFT marketplace preview'
              : 'NFT lending preview'
          }
          tabIndex={-1}
        >
          {announcement && section === 'lending' && (
            <p className="pooled-feedback" role="status">
              {announcement}
            </p>
          )}
          {section === 'marketplace' ? (
            <Marketplace
              market={market}
              assets={availableAssets}
              onDetails={(asset) => setModal({ type: 'details', asset })}
              onPurchase={(asset) => setModal({ type: 'purchase', asset })}
            />
          ) : (
            <Lending
              market={market}
              tab={lendingTab}
              onTab={setLendingTab}
              state={lending}
              onAction={(action) =>
                setModal({ type: 'lending-action', action })
              }
            />
          )}
        </section>
      </main>
      <footer className="site-footer">
        <a
          className="brand footer-brand"
          href="#marketplace"
          onClick={(event) => {
            event.preventDefault();
            selectSection('marketplace');
            window.scrollTo({
              top: 0,
              behavior: window.matchMedia('(prefers-reduced-motion: reduce)')
                .matches
                ? 'instant'
                : 'smooth',
            });
          }}
        >
          <span className="brand-mark">
            <PortalMark size={24} />
          </span>
          <span className="brand-name">riftwell.</span>
        </a>
        <p>
          {market.positionSymbol} positions. USDC settlement. An interactive
          preview.
        </p>
        <div className="footer-links">
          <button
            className="inline-link"
            onClick={() => setModal({ type: 'about' })}
          >
            About this preview
          </button>
          <a
            href="https://github.com/ael-dev3/Riftwell"
            target="_blank"
            rel="noreferrer"
          >
            Source code <ArrowUpRight size={13} aria-hidden="true" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        </div>
      </footer>
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>
      {modal?.type === 'details' && (
        <AssetDetails
          key="details"
          asset={modal.asset}
          onClose={closeModal}
          onPurchase={() => setModal({ type: 'purchase', asset: modal.asset })}
        />
      )}
      {modal?.type === 'purchase' && (
        <PurchaseDialog
          key="purchase"
          asset={modal.asset}
          onClose={closeModal}
          onSave={saveReceipt}
        />
      )}
      {modal?.type === 'lending-action' && (
        <LendingActionDialog
          key={modal.action.kind}
          action={modal.action}
          state={lending}
          onClose={closeModal}
          onApply={(input) => applyLendingAction(modal.action, input)}
        />
      )}
      {modal?.type === 'success' && (
        <SuccessDialog
          key="success"
          receipt={modal.receipt}
          asset={modal.asset}
          onClose={closeModal}
          onAccount={() =>
            setModal({ type: 'account', tab: modal.receipt.kind })
          }
        />
      )}
      {modal?.type === 'account' && (
        <AccountDialog
          key="account"
          receipts={portfolio.receipts}
          lending={lending}
          initialTab={modal.tab}
          onClose={closeModal}
          onReset={() => setModal({ type: 'reset' })}
          onAction={(action) => setModal({ type: 'lending-action', action })}
          onExplore={(next, nextTab) => {
            if (nextTab) setLendingTab(nextTab);
            closeModal();
            selectSection(next, true);
          }}
        />
      )}
      {modal?.type === 'reset' && (
        <Dialog
          key="reset"
          title="Reset preview account?"
          kicker="RESET PREVIEW"
          onClose={closeModal}
        >
          <div className="dialog-body confirmation-copy">
            <p>
              This will clear saved purchases, collateral, debt, vault shares
              and activity, then restore the starting demo balances.
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
                try {
                  localStorage.removeItem(LEGACY_STORAGE_KEY);
                } catch {
                  setStorageIssue(true);
                }
                setPortfolio(emptyPortfolio());
                const freshLending = createLendingState();
                lendingRef.current = freshLending;
                setLending(freshLending);
                setModal({ type: 'account' });
                setAnnouncement('Your preview account has been reset.');
              }}
            >
              Reset preview
            </button>
          </div>
        </Dialog>
      )}
      {modal?.type === 'about' && (
        <Dialog
          key="about"
          title="Room to explore."
          kicker="ABOUT THIS PREVIEW"
          onClose={closeModal}
        >
          <div className="dialog-body">
            <p>
              Riftwell combines a marketplace for {market.positionSymbol}{' '}
              positions with collateral-backed borrowing and pooled USDC
              lending. The selected market is {market.name}.
            </p>
            <dl className="details-list">
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
                <dt>Your preview account</dt>
                <dd>
                  Saved to this browser’s local storage. Use Reset preview to
                  clear it.
                </dd>
              </div>
            </dl>
            <div className="notice">
              <Info size={17} aria-hidden="true" />
              <p>
                No live liquidity, on-chain ownership or lock checks, or
                guaranteed returns.
              </p>
            </div>
          </div>
          <div className="dialog-footer">
            <button className="button primary" onClick={closeModal}>
              Back to exploring <ArrowRight size={16} aria-hidden="true" />
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
