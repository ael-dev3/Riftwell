import {
  ArrowRight,
  ArrowUpRight,
  CircleUserRound,
  Info,
  MoveUpRight,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ASSETS } from './data';
import {
  emptyPortfolio,
  parsePortfolio,
  STORAGE_KEY,
  type Asset,
  type BorrowReceipt,
  type LendReceipt,
  type Portfolio,
  type Receipt,
} from './domain';
import AccountDialog, { type AccountTab } from './components/AccountDialog';
import Dialog from './components/Dialog';
import Lending, { type LendingTab } from './components/Lending';
import Marketplace from './components/Marketplace';
import {
  AssetDetails,
  LoanDialog,
  PurchaseDialog,
  SuccessDialog,
} from './components/TradeDialogs';

type Section = 'lending' | 'marketplace';
type Modal =
  | { type: 'details' | 'purchase' | 'borrow' | 'lend'; asset: Asset }
  | { type: 'account'; tab?: AccountTab }
  | { type: 'reset' | 'about' }
  | { type: 'cancel'; receipt: BorrowReceipt | LendReceipt }
  | { type: 'success'; receipt: Receipt; asset: Asset }
  | null;

function initialPortfolio(): { portfolio: Portfolio; readIssue: boolean } {
  try {
    return {
      portfolio: parsePortfolio(
        localStorage.getItem(STORAGE_KEY),
        ASSETS.map((asset) => asset.id),
      ),
      readIssue: false,
    };
  } catch {
    return { portfolio: emptyPortfolio(), readIssue: true };
  }
}

export default function App() {
  const [section, setSection] = useState<Section>(() =>
    window.location.hash === '#lending' ? 'lending' : 'marketplace',
  );
  const [lendingTab, setLendingTab] = useState<LendingTab>('borrow');
  const [initial] = useState(initialPortfolio);
  const [portfolio, setPortfolio] = useState<Portfolio>(initial.portfolio);
  const [modal, setModal] = useState<Modal>(null);
  const [storageIssue, setStorageIssue] = useState(initial.readIssue);
  const [announcement, setAnnouncement] = useState('');
  const workspaceRef = useRef<HTMLElement>(null);
  const accountButtonRef = useRef<HTMLButtonElement>(null);

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
      setStorageIssue(initial.readIssue);
    } catch {
      setStorageIssue(true);
    }
  }, [portfolio, initial.readIssue]);

  const purchasedIds = new Set(
    portfolio.receipts
      .filter((receipt) => receipt.kind === 'purchase')
      .map((receipt) => receipt.assetId),
  );
  const availableAssets = ASSETS.filter((asset) => !purchasedIds.has(asset.id));
  const accountCount = portfolio.receipts.filter(
    (receipt) => receipt.kind === 'purchase' || receipt.status !== 'cancelled',
  ).length;

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
          (item.kind === 'purchase' || item.status !== 'cancelled'),
      );
      return duplicate
        ? current
        : { ...current, receipts: [...current.receipts, receipt] };
    });
    const asset = ASSETS.find((item) => item.id === receipt.assetId);
    if (asset) setModal({ type: 'success', receipt, asset });
    setAnnouncement('Your preview receipt has been saved.');
  }

  function cancelReceipt(receipt: BorrowReceipt | LendReceipt) {
    setPortfolio((current) => ({
      ...current,
      receipts: current.receipts.map((item) =>
        item.id === receipt.id && item.kind !== 'purchase'
          ? { ...item, status: 'cancelled' }
          : item,
      ),
    }));
    setModal({ type: 'account', tab: receipt.kind });
    setAnnouncement(
      'The preview has been cancelled. Your receipt remains in the account.',
    );
  }

  return (
    <div className="app-shell">
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
            <img src="/riftwell.svg" alt="" width="37" height="37" />
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
              <span className="eyebrow-dot" />A NEW POINT OF VIEW
            </p>
            <h1 className="hero-title" id="hero-title">
              A new orbit
              <br />
              for your <span className="accent-text">assets.</span>
            </h1>
            <p className="hero-description">
              Trade locked NFT positions. Borrow against them. Explore both in
              one simple space, with USDC settlement.
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
                DIGITAL ASSETS, REIMAGINED
              </div>
              <div className="portal-coordinate top">RW / 001</div>
              <div className="portal-coordinate bottom">
                A NEW POINT OF VIEW
              </div>
            </div>
          </div>
        </section>
        <div className="summary-strip" aria-label="Preview features and fees">
          <div className="summary-item">
            <span className="summary-label">Two ways to explore</span>
            <strong className="summary-value">
              Trade &amp; borrow
              <MoveUpRight size={19} aria-hidden="true" />
            </strong>
          </div>
          <div className="summary-item">
            <span className="summary-label">Marketplace seller fee</span>
            <strong className="summary-value">
              0.5%<small>per sale</small>
            </strong>
          </div>
          <div className="summary-item">
            <span className="summary-label">Borrow origination fee</span>
            <strong className="summary-value">
              0.5%<small>one time</small>
            </strong>
          </div>
        </div>
        {storageIssue && (
          <div className="notice storage-notice" role="status">
            <Info size={18} aria-hidden="true" />
            <p>
              This browser could not restore or save preview receipts. Your
              preview works, but receipts may not persist after you refresh.
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
          {section === 'marketplace' ? (
            <Marketplace
              assets={availableAssets}
              onDetails={(asset) => setModal({ type: 'details', asset })}
              onPurchase={(asset) => setModal({ type: 'purchase', asset })}
            />
          ) : (
            <Lending
              tab={lendingTab}
              onTab={setLendingTab}
              receipts={portfolio.receipts}
              onBorrow={(asset) => setModal({ type: 'borrow', asset })}
              onLend={(asset) => setModal({ type: 'lend', asset })}
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
            <img src="/riftwell.svg" alt="" width="24" height="24" />
          </span>
          <span className="brand-name">riftwell.</span>
        </a>
        <p>NFT positions. USDC settlement. An interactive preview.</p>
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
      {(modal?.type === 'borrow' || modal?.type === 'lend') && (
        <LoanDialog
          key={modal.type}
          asset={modal.asset}
          kind={modal.type}
          onClose={closeModal}
          onSave={saveReceipt}
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
          initialTab={modal.tab}
          onClose={closeModal}
          onReset={() => setModal({ type: 'reset' })}
          onCancel={(receipt) => setModal({ type: 'cancel', receipt })}
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
              This will remove all Riftwell preview purchases, loans and
              proposals saved in this browser.
            </p>
            <p className="text-muted">
              You can create new sample purchases, loans and proposals after
              resetting.
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
                setPortfolio(emptyPortfolio());
                setModal({ type: 'account' });
                setAnnouncement('Your preview account has been reset.');
              }}
            >
              Reset preview
            </button>
          </div>
        </Dialog>
      )}
      {modal?.type === 'cancel' && (
        <Dialog
          key="cancel"
          title={
            modal.receipt.kind === 'borrow'
              ? 'Cancel this preview loan?'
              : 'Cancel this proposal?'
          }
          kicker="PREVIEW ONLY"
          onClose={closeModal}
        >
          <div className="dialog-body confirmation-copy">
            <p>
              {modal.receipt.kind === 'borrow'
                ? 'The simulated loan will be marked as cancelled and its sample collateral will become available again.'
                : 'The sample proposal will be marked as cancelled. You can create another proposal whenever you like.'}
            </p>
            <p className="text-muted">
              The receipt stays in your preview account. No real funds or assets
              are involved.
            </p>
          </div>
          <div className="dialog-footer">
            <button
              className="button secondary"
              onClick={() =>
                setModal({ type: 'account', tab: modal.receipt.kind })
              }
            >
              Go back
            </button>
            <button
              className="button primary"
              onClick={() => cancelReceipt(modal.receipt)}
            >
              Confirm cancellation
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
              Riftwell combines a marketplace for locked NFT positions with
              NFT-backed lending in USDC.
            </p>
            <dl className="details-list">
              <div>
                <dt>Positions &amp; prices</dt>
                <dd>
                  Fictional Rift Positions and sample RIFT units. Locked
                  balances, dates and USDC values are illustrative.
                </dd>
              </div>
              <div>
                <dt>Purchases &amp; loans</dt>
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
              <div>
                <dt>Marketplace fee</dt>
                <dd>Seller pays 0.5% of the sale price.</dd>
              </div>
              <div>
                <dt>Borrowing fee</dt>
                <dd>
                  One-time 0.5% of principal. Lender interest is calculated
                  separately.
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
