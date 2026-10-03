import {
  BarChart3,
  BookOpen,
  Calculator,
  ChevronDown,
  CircleHelp,
  Clock3,
  Code2,
  FileText,
  Keyboard,
  Menu,
  Moon,
  Sun,
} from 'lucide-react';
import {
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { flushSync } from 'react-dom';
import { useMinuteClock } from '../../app/clock';
import { scrollBehavior, withLocalTransition } from '../../app/motion';
import {
  PAGE_LABELS,
  PRIMARY_PAGES,
  type Page,
  type Route,
} from '../../app/router';
import { SHORTCUTS } from '../../app/shortcuts';
import { useTheme } from '../../app/theme';
import {
  describeCountdown,
  epochAt,
  formatCountdown,
  formatFlip,
} from '../../epoch';
import type { Market } from '../../markets';
import Dialog from '../Dialog';
import MarketSelector from '../MarketSelector';
import PortalMark from '../PortalMark';
import { Meter } from '../ui/Meter';
import Popover from '../ui/Popover';
import { ReleaseList, WhatsNew } from './WhatsNew';

export const SOURCE_URL = 'https://github.com/ael-dev3/Riftwell';
export const DOCS_URL = `${SOURCE_URL}/tree/main/docs`;

type ShellProps = {
  route: Route;
  onNavigate: (page: Page) => void;
  market: Market;
  onMarketChange: (market: Market) => void;
  /** Account or sign-in control rendered in the header. */
  account: ReactNode;
  mode: 'preview' | 'connected';
  onAbout: () => void;
  onShortcuts: () => void;
  notices?: ReactNode;
  children: ReactNode;
};

function linkHandler(page: Page, onNavigate: (page: Page) => void) {
  return (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button)
      return;
    event.preventDefault();
    onNavigate(page);
  };
}

function ThemeToggle({ className = 'icon-button ghost' }) {
  const { theme, toggle } = useTheme();
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      className={className}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme (T)`}
      onClick={toggle}
    >
      {theme === 'dark' ? (
        <Sun size={18} aria-hidden="true" />
      ) : (
        <Moon size={18} aria-hidden="true" />
      )}
    </button>
  );
}

function PrimaryNav({
  route,
  onNavigate,
}: Pick<ShellProps, 'route' | 'onNavigate'>) {
  const navRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const nav = navRef.current;
    const active = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav) return;
    nav.dataset.indicator = active ? 'on' : 'off';
    if (!active) return;
    nav.style.setProperty('--indicator-x', `${active.offsetLeft}px`);
    nav.style.setProperty('--indicator-w', `${active.offsetWidth}px`);
  }, [route.page]);
  return (
    <nav className="primary-nav" aria-label="Main navigation" ref={navRef}>
      {PRIMARY_PAGES.map((page) => (
        <a
          key={page}
          className="nav-link"
          href={`#${page}`}
          aria-current={route.page === page ? 'page' : undefined}
          onClick={linkHandler(page, onNavigate)}
        >
          {PAGE_LABELS[page]}
        </a>
      ))}
      <span className="nav-indicator" aria-hidden="true" />
    </nav>
  );
}

function ResourcesMenu({
  onNavigate,
  onAbout,
  onShortcuts,
  mode,
}: Pick<ShellProps, 'onNavigate' | 'onAbout' | 'onShortcuts' | 'mode'>) {
  const items = [
    {
      icon: Calculator,
      label: 'Repayment simulator',
      text: 'Model credit and payoff time',
      page: 'simulator' as const,
    },
    {
      icon: BarChart3,
      label: 'Statistics',
      text: 'Vault, reward and market totals',
      page: 'stats' as const,
    },
    {
      icon: CircleHelp,
      label: 'FAQ',
      text: 'How credit, rewards and fees work',
      page: 'faq' as const,
    },
  ];
  return (
    <Popover
      trigger={
        <>
          Resources <ChevronDown size={15} aria-hidden="true" />
        </>
      }
      className="resources"
      triggerClassName="button ghost resources-trigger"
    >
      {(close) => (
        <ul className="menu-list">
          {items.map(({ icon: Icon, label, text, page }) => (
            <li key={page}>
              <a
                href={`#${page}`}
                className="menu-item"
                onClick={(event) => {
                  linkHandler(page, onNavigate)(event);
                  close();
                }}
              >
                <Icon size={18} aria-hidden="true" />
                <span>
                  <strong>{label}</strong>
                  <small>{text}</small>
                </span>
              </a>
            </li>
          ))}
          <li>
            <button
              type="button"
              className="menu-item"
              onClick={() => {
                close();
                onShortcuts();
              }}
            >
              <Keyboard size={18} aria-hidden="true" />
              <span>
                <strong>Keyboard shortcuts</strong>
                <small>Move faster with single keys</small>
              </span>
            </button>
          </li>
          <li>
            <button
              type="button"
              className="menu-item"
              onClick={() => {
                close();
                onAbout();
              }}
            >
              <BookOpen size={18} aria-hidden="true" />
              <span>
                <strong>
                  {mode === 'preview' ? 'About this preview' : 'Service status'}
                </strong>
                <small>
                  {mode === 'preview'
                    ? 'What is simulated and what is not'
                    : 'Launch status and data sources'}
                </small>
              </span>
            </button>
          </li>
          <li>
            <a
              className="menu-item"
              href={DOCS_URL}
              target="_blank"
              rel="noreferrer"
            >
              <FileText size={18} aria-hidden="true" />
              <span>
                <strong>Docs</strong>
                <small>
                  Lending model, API and operations
                  <span className="sr-only"> (opens in a new tab)</span>
                </small>
              </span>
            </a>
          </li>
          <li>
            <a
              className="menu-item"
              href={SOURCE_URL}
              target="_blank"
              rel="noreferrer"
            >
              <Code2 size={18} aria-hidden="true" />
              <span>
                <strong>Source code</strong>
                <small>
                  Contracts, docs and validation
                  <span className="sr-only"> (opens in a new tab)</span>
                </small>
              </span>
            </a>
          </li>
        </ul>
      )}
    </Popover>
  );
}

function EpochStatus() {
  const now = useMinuteClock();
  const clock = epochAt(now);
  return (
    <div
      className="epoch"
      role="group"
      aria-label="KittenSwap epoch"
      title={`Flips ${formatFlip(clock.endMs)}`}
    >
      <Clock3 size={15} aria-hidden="true" />
      <span className="epoch-name" aria-hidden="true">
        Epoch {clock.period}
      </span>
      <span className="epoch-time" aria-hidden="true">
        {formatCountdown(clock.remainingMs)}
      </span>
      <Meter
        value={clock.progress * 100}
        label={`Epoch ${clock.period} progress`}
        size="thin"
      />
      <span className="sr-only">
        Epoch {clock.period}. Next flip in{' '}
        {describeCountdown(clock.remainingMs)}, on {formatFlip(clock.endMs)}.
      </span>
    </div>
  );
}

function MobileMenu({
  route,
  onNavigate,
  onAbout,
  onShortcuts,
  onClose,
  mode,
}: Pick<
  ShellProps,
  'route' | 'onNavigate' | 'onAbout' | 'onShortcuts' | 'mode'
> & { onClose: () => void }) {
  const go = (page: Page) => (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    onClose();
    onNavigate(page);
  };
  return (
    <Dialog title="Menu" kicker="RIFTWELL" onClose={onClose} sheet>
      <nav className="dialog-body sheet-nav" aria-label="Mobile navigation">
        {(
          [
            'borrow',
            'earn',
            'marketplace',
            'simulator',
            'stats',
            'faq',
          ] as const
        ).map((page) => (
          <a
            key={page}
            href={`#${page}`}
            className="sheet-link"
            aria-current={route.page === page ? 'page' : undefined}
            onClick={go(page)}
          >
            {PAGE_LABELS[page]}
          </a>
        ))}
        <hr />
        <button
          type="button"
          className="sheet-link"
          onClick={() => {
            onClose();
            onAbout();
          }}
        >
          {mode === 'preview' ? 'About this preview' : 'Service status'}
        </button>
        <button
          type="button"
          className="sheet-link"
          onClick={() => {
            onClose();
            onShortcuts();
          }}
        >
          Keyboard shortcuts
        </button>
        <div className="sheet-row">
          <span>Theme</span>
          <ThemeToggle className="button secondary small" />
        </div>
        <hr />
        <section className="sheet-updates" aria-labelledby="sheet-updates">
          <h3 id="sheet-updates" className="subhead">
            What’s new
          </h3>
          <ReleaseList />
        </section>
      </nav>
    </Dialog>
  );
}

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="Keyboard shortcuts" kicker="MOVE FASTER" onClose={onClose}>
      <div className="dialog-body">
        <dl className="shortcut-list">
          {SHORTCUTS.map((shortcut) => (
            <div key={shortcut.label}>
              <dt>
                {shortcut.keys.map((key, index) => (
                  <span key={key}>
                    {index > 0 && <span className="text-muted"> then </span>}
                    <kbd>{key}</kbd>
                  </span>
                ))}
              </dt>
              <dd>{shortcut.label}</dd>
            </div>
          ))}
        </dl>
        <p className="form-hint">
          Shortcuts pause while you type in a field or a dialog is open.
        </p>
      </div>
      <div className="dialog-footer">
        <button className="button primary" onClick={onClose}>
          Done
        </button>
      </div>
    </Dialog>
  );
}

export default function AppShell({
  route,
  onNavigate,
  market,
  onMarketChange,
  account,
  mode,
  onAbout,
  onShortcuts,
  notices,
  children,
}: ShellProps) {
  const [menu, setMenu] = useState(false);
  return (
    <div className="app" data-market={market.id} data-mode={mode}>
      <a
        className="skip-link"
        href="#main"
        onClick={(event) => {
          event.preventDefault();
          const main = document.getElementById('main');
          main?.focus({ preventScroll: true });
          main?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
        }}
      >
        Skip to content
      </a>
      <div className="backdrop-glow" aria-hidden="true" />
      <header className="site-header">
        <div className="header-inner">
          <a
            className="brand"
            href="#borrow"
            aria-label="Riftwell home"
            onClick={linkHandler('borrow', onNavigate)}
          >
            <span className="brand-mark">
              <PortalMark size={32} />
            </span>
            <span className="brand-name">
              riftwell<span className="brand-period">.</span>
            </span>
          </a>
          <PrimaryNav route={route} onNavigate={onNavigate} />
          <div className="header-tools">
            <ResourcesMenu
              onNavigate={onNavigate}
              onAbout={onAbout}
              onShortcuts={onShortcuts}
              mode={mode}
            />
            <WhatsNew />
            <ThemeToggle />
            {account}
            <button
              type="button"
              className="icon-button ghost menu-button"
              aria-label="Open menu"
              onClick={() => setMenu(true)}
            >
              <Menu size={20} aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>
      <div className="context-bar">
        <div className="context-inner">
          <div className="crumbs" role="group" aria-label="Market">
            <span className="chain-chip">
              <span className="chain-dot" aria-hidden="true" />
              {market.chain}
            </span>
            <span className="crumb-sep" aria-hidden="true">
              /
            </span>
            <MarketSelector market={market} onChange={onMarketChange} />
          </div>
          <EpochStatus />
          <button type="button" className="status-pill" onClick={onAbout}>
            <span className="status-dot" aria-hidden="true" />
            {mode === 'preview' ? 'Preview data' : 'Settlement off'}
          </button>
        </div>
      </div>
      <main className="page" id="main" tabIndex={-1}>
        {notices}
        {children}
      </main>
      <footer className="site-footer">
        <div className="footer-inner">
          <div className="footer-brand">
            <a
              className="brand"
              href="#borrow"
              onClick={linkHandler('borrow', onNavigate)}
            >
              <span className="brand-mark">
                <PortalMark size={26} />
              </span>
              <span className="brand-name">
                riftwell<span className="brand-period">.</span>
              </span>
            </a>
            <p>
              Credit lines, pooled USDC and a marketplace for{' '}
              {market.positionSymbol} positions on {market.chain}.
            </p>
          </div>
          <nav className="footer-links" aria-label="Footer">
            <div>
              <h2>Product</h2>
              {PRIMARY_PAGES.map((page) => (
                <a
                  key={page}
                  href={`#${page}`}
                  onClick={linkHandler(page, onNavigate)}
                >
                  {PAGE_LABELS[page]}
                </a>
              ))}
            </div>
            <div>
              <h2>Resources</h2>
              <a
                href="#simulator"
                onClick={linkHandler('simulator', onNavigate)}
              >
                Simulator
              </a>
              <a href="#stats" onClick={linkHandler('stats', onNavigate)}>
                Statistics
              </a>
              <a href="#faq" onClick={linkHandler('faq', onNavigate)}>
                FAQ
              </a>
              <a href={DOCS_URL} target="_blank" rel="noreferrer">
                Docs
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
              <button
                type="button"
                className="footer-button"
                onClick={onShortcuts}
              >
                Shortcuts
              </button>
              <a href={SOURCE_URL} target="_blank" rel="noreferrer">
                Source code
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </div>
            <div>
              <h2>About</h2>
              <a href="#brand" onClick={linkHandler('brand', onNavigate)}>
                Brand kit
              </a>
              <a href="#privacy" onClick={linkHandler('privacy', onNavigate)}>
                Privacy
              </a>
            </div>
          </nav>
        </div>
        <p className="footer-note">
          {mode === 'preview'
            ? 'Interactive preview. Positions, balances and rewards are illustrative; nothing here moves funds.'
            : 'Off-chain records with verified ownership reads. Funded lending and settlement are not launched.'}
        </p>
      </footer>
      {menu && (
        <MobileMenu
          route={route}
          onNavigate={onNavigate}
          onAbout={onAbout}
          onShortcuts={onShortcuts}
          onClose={() =>
            withLocalTransition(() => flushSync(() => setMenu(false)))
          }
          mode={mode}
        />
      )}
    </div>
  );
}
