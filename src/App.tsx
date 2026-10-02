import { ArrowRight, ArrowUpRight, CircleUserRound, Info } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  ASSETS,
  ALL_MARKET_ASSETS,
  OWNED_MARKET_ASSETS,
  COLLATERAL_LIMITS,
} from './data';
import { DEFAULT_MARKET, type Market } from './markets';
import MarketSelector from './components/MarketSelector';
import PortalMark from './components/PortalMark';
import { parsePortfolio, STORAGE_KEY, LEGACY_STORAGE_KEY } from './domain';
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
import Marketplace, { type MarketplaceAction } from './components/Marketplace';
import MarketplaceActionDialog, {
  type MarketplaceActionInput,
} from './components/MarketplaceDialogs';
import {
  createMarketplaceState,
  parseMarketplaceState,
  migrateMarketplacePurchases,
  listAsset,
  editListing,
  cancelListing,
  buyListings,
  MarketplaceError,
  MARKETPLACE_STORAGE_KEY,
  PREVIEW_ADDRESS,
  type MarketplaceState,
} from './marketplace';

type Section = 'lending' | 'marketplace';
type Modal =
  | { type: 'market-action'; action: MarketplaceAction }
  | { type: 'lending-action'; action: LendingAction }
  | { type: 'account'; tab?: AccountTab }
  | { type: 'reset' | 'about' }
  | null;

const LENDING_STORAGE_KEY = 'riftwell.pooled-lending-preview.v1';
function initialPortfolio(): {
  marketplace: MarketplaceState;
  lending: LendingState;
  readIssue: boolean;
  migrated: boolean;
} {
  try {
    const current = localStorage.getItem(STORAGE_KEY);
    const legacy =
      current === null ? localStorage.getItem(LEGACY_STORAGE_KEY) : null;
    const owned = OWNED_MARKET_ASSETS.map((asset) => asset.id);
    const savedMarket = localStorage.getItem(MARKETPLACE_STORAGE_KEY);
    const old = parsePortfolio(
      current ?? legacy,
      ASSETS.map((asset) => asset.id),
    );
    const marketplace =
      savedMarket === null
        ? migrateMarketplacePurchases(
            createMarketplaceState(ALL_MARKET_ASSETS, owned),
            old.receipts,
            ALL_MARKET_ASSETS,
          )
        : parseMarketplaceState(savedMarket, ALL_MARKET_ASSETS, owned);
    return {
      marketplace,
      lending: parseLendingState(
        localStorage.getItem(LENDING_STORAGE_KEY),
        COLLATERAL_LIMITS,
      ),
      readIssue: false,
      migrated: savedMarket === null && (current !== null || legacy !== null),
    };
  } catch {
    return {
      marketplace: createMarketplaceState(
        ALL_MARKET_ASSETS,
        OWNED_MARKET_ASSETS.map((asset) => asset.id),
      ),
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
  const [marketplace, setMarketplace] = useState<MarketplaceState>(
    initial.marketplace,
  );
  const marketplaceRef = useRef(marketplace);
  marketplaceRef.current = marketplace;
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
      localStorage.setItem(
        MARKETPLACE_STORAGE_KEY,
        JSON.stringify(marketplace),
      );
      localStorage.setItem(LENDING_STORAGE_KEY, JSON.stringify(lending));
      setStorageIssue(initial.readIssue);
    } catch {
      setStorageIssue(true);
    }
  }, [marketplace, lending, initial.readIssue]);

  const accountCount =
    Object.values(marketplace.ownerByAsset).filter(
      (owner) => owner.toLowerCase() === PREVIEW_ADDRESS.toLowerCase(),
    ).length +
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

  function applyMarketplaceAction(
    action: MarketplaceAction,
    input: MarketplaceActionInput,
  ): string | null {
    try {
      const current = marketplaceRef.current;
      let next = current;
      if (action.kind === 'list' && input.assetId && input.terms)
        next = listAsset(
          current,
          input.assetId,
          input.terms,
          ALL_MARKET_ASSETS,
        );
      else if (action.kind === 'edit' && input.terms)
        next = editListing(
          current,
          action.listing.id,
          action.listing.revision,
          input.terms,
          ALL_MARKET_ASSETS,
        );
      else if (action.kind === 'cancel')
        next = cancelListing(
          current,
          action.listing.id,
          action.listing.revision,
          ALL_MARKET_ASSETS,
        );
      else if (
        (action.kind === 'buy' || action.kind === 'sweep') &&
        input.quotes
      )
        next = buyListings(current, input.quotes, ALL_MARKET_ASSETS);
      else return 'Review the required listing details first.';
      marketplaceRef.current = next;
      setMarketplace(next);
      setAnnouncement(
        action.kind === 'buy' || action.kind === 'sweep'
          ? 'Preview purchase completed.'
          : 'Preview listing updated.',
      );
      closeModal();
      return null;
    } catch (error) {
      return error instanceof MarketplaceError
        ? error.message
        : 'This preview action could not be completed. Try again.';
    }
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
        Skip to workspace
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
              Your saved sample purchases were retained in the marketplace
              preview.
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
          {announcement && (
            <p className="pooled-feedback" role="status">
              {announcement}
            </p>
          )}
          {section === 'marketplace' ? (
            <Marketplace
              market={market}
              state={marketplace}
              onAction={(action) => setModal({ type: 'market-action', action })}
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
      {modal?.type === 'market-action' && (
        <MarketplaceActionDialog
          key={modal.action.kind}
          action={modal.action}
          state={marketplace}
          onClose={closeModal}
          onApply={(input) => applyMarketplaceAction(modal.action, input)}
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
      {modal?.type === 'account' && (
        <AccountDialog
          key="account"
          marketplace={marketplace}
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
                try {
                  localStorage.removeItem(STORAGE_KEY);
                } catch {
                  setStorageIssue(true);
                }
                const freshMarket = createMarketplaceState(
                  ALL_MARKET_ASSETS,
                  OWNED_MARKET_ASSETS.map((asset) => asset.id),
                );
                marketplaceRef.current = freshMarket;
                setMarketplace(freshMarket);
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
