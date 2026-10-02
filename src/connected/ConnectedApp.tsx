import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, CircleUserRound, Info } from 'lucide-react';
import { DEFAULT_MARKET, type Market } from '../markets';
import MarketSelector from '../components/MarketSelector';
import PortalMark from '../components/PortalMark';
import Dialog from '../components/Dialog';
import {
  api,
  ApiError,
  type Account,
  type Listing,
  type LoanRequest,
  type Offer,
  type Position,
  type Session,
  type Status,
} from './api';
import {
  connectWallet,
  getWalletProvider,
  signChallenge,
  subscribeWallet,
  walletErrorMessage,
  type WalletProvider,
} from './wallet';
import { shortAddress } from './amounts';
import { apiMessage, usePages } from './usePages';
import {
  CancellationDialog,
  ListingReview,
  OfferReview,
  RecordForm,
} from './RecordDialogs';
import {
  ConnectedAccount,
  PublicListings,
  PublicRequests,
} from './ConnectedViews';

type Section = 'marketplace' | 'lending';
type Intent = {
  type: 'form';
  kind: 'listing' | 'request' | 'offer';
  position?: Position;
  request?: LoanRequest;
};
type Modal =
  | Intent
  | { type: 'signin' | 'account' }
  | { type: 'review'; listing: Listing }
  | { type: 'offer-review'; offer: Offer; request?: LoanRequest }
  | {
      type: 'cancel';
      kind: 'listing' | 'request' | 'offer';
      record: Listing | LoanRequest | Offer;
    }
  | null;

export default function ConnectedApp() {
  const [market, setMarket] = useState<Market>(DEFAULT_MARKET);
  const [section, setSection] = useState<Section>(() =>
    location.hash === '#lending' ? 'lending' : 'marketplace',
  );
  const [lendingTab, setLendingTab] = useState<'borrow' | 'lend'>('borrow');
  const [status, setStatus] = useState<Status | null>(null);
  const [serviceError, setServiceError] = useState('');
  const [serviceRevision, setServiceRevision] = useState(0);
  const [session, setSession] = useState<Session | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountError, setAccountError] = useState('');
  const [modal, setModal] = useState<Modal>(null);
  const [message, setMessage] = useState('');
  const [signing, setSigning] = useState(false);
  const [signError, setSignError] = useState('');
  const [provider, setProvider] = useState<WalletProvider | null>(() =>
    getWalletProvider(),
  );
  const intent = useRef<Intent | null>(null);
  const sessionRef = useRef<Session | null>(null);
  sessionRef.current = session;
  const authEpoch = useRef(0);
  const signInAttempt = useRef(0);
  const signingRef = useRef(false);
  signingRef.current = signing;
  const walletConnecting = useRef(false);
  const signInAddress = useRef<string | null>(null);
  const accountRequest = useRef(0);
  const workspaceRef = useRef<HTMLElement>(null);
  const accountButtonRef = useRef<HTMLButtonElement>(null);
  const lists = usePages(
    (cursor, signal) => api.listings(market.id, cursor, signal),
    market.id,
  );
  const requests = usePages(
    (cursor, signal) => api.loanRequests(market.id, cursor, signal),
    market.id,
  );

  function closeModal() {
    intent.current = null;
    if (signingRef.current) {
      authEpoch.current++;
      signInAttempt.current++;
    }
    setModal(null);
    requestAnimationFrame(() => {
      if (!document.activeElement || document.activeElement === document.body)
        accountButtonRef.current?.focus();
    });
  }

  useEffect(() => {
    document.documentElement.style.setProperty('--accent', market.accentColor);
  }, [market]);

  useEffect(() => {
    if (!['#marketplace', '#lending'].includes(location.hash))
      history.replaceState(null, '', '#marketplace');
    const sync = () => {
      if (!['#marketplace', '#lending'].includes(location.hash)) return;
      setSection(location.hash === '#lending' ? 'lending' : 'marketplace');
      closeModal();
    };
    window.addEventListener('hashchange', sync);
    window.addEventListener('popstate', sync);
    return () => {
      window.removeEventListener('hashchange', sync);
      window.removeEventListener('popstate', sync);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      api.status(controller.signal),
      api.markets(controller.signal),
    ])
      .then(([health, available]) => {
        if (controller.signal.aborted) return;
        if (
          health.mode !== 'connected' ||
          health.chainId !== 999 ||
          health.marketId !== 'kittenswap' ||
          health.settlementEnabled !== false ||
          health.capabilities.settlement !== false ||
          available.markets.length !== 1 ||
          available.markets[0]?.id !== 'kittenswap'
        )
          throw new Error(
            'This service does not match the supported KittenSwap market configuration.',
          );
        setStatus(health);
        setServiceError('');
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) {
          setStatus(null);
          setServiceError(apiMessage(failure));
        }
      });
    return () => controller.abort();
  }, [serviceRevision]);

  useEffect(() => {
    const controller = new AbortController();
    const epoch = authEpoch.current;
    void api
      .session(controller.signal)
      .then((restored) => {
        if (!controller.signal.aborted && epoch === authEpoch.current)
          setSession(restored);
      })
      .catch((failure: unknown) => {
        if (
          controller.signal.aborted ||
          (failure instanceof ApiError && failure.status === 401)
        )
          return;
        setMessage(apiMessage(failure));
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!provider) return;
    return subscribeWallet(provider, (change) => {
      const active = sessionRef.current;
      const changed =
        change.type === 'disconnect' ||
        (change.type === 'chainChanged' &&
          (!/^0x[0-9a-f]+$/i.test(change.chainId) ||
            BigInt(change.chainId) !== 999n)) ||
        (change.type === 'accountsChanged' &&
          !(
            walletConnecting.current &&
            !active &&
            change.accounts.length > 0
          ) &&
          change.accounts[0]?.toLowerCase() !==
            (active?.address ?? signInAddress.current)?.toLowerCase());
      if (!changed) return;
      authEpoch.current++;
      setSession(null);
      setAccount(null);
      if (active) {
        setModal(null);
        intent.current = null;
      }
      setMessage('Your wallet changed. Sign in again to manage your records.');
      if (active) void api.logout(active.csrfToken).catch(() => {});
    });
  }, [provider]);

  const handleError = useCallback((failure: unknown) => {
    if (failure instanceof ApiError && failure.status === 401) {
      authEpoch.current++;
      setSession(null);
      setAccount(null);
      setModal({ type: 'signin' });
      setSignError('Your session expired. Sign in again.');
    }
  }, []);

  const refreshAccount = useCallback(
    async (more = false, signal?: AbortSignal) => {
      if (!sessionRef.current) return;
      const address = sessionRef.current.address;
      const epoch = authEpoch.current;
      const requestNumber = ++accountRequest.current;
      setAccountBusy(true);
      try {
        const loaded = await api.account(
          signal,
          more ? (account?.nextPositionsCursor ?? undefined) : undefined,
        );
        if (
          signal?.aborted ||
          epoch !== authEpoch.current ||
          requestNumber !== accountRequest.current ||
          sessionRef.current?.address !== address
        )
          return;
        setAccount((previous) =>
          more && previous
            ? {
                ...loaded,
                positions: [
                  ...previous.positions,
                  ...loaded.positions.filter(
                    (position) =>
                      !previous.positions.some(
                        (item) => item.id === position.id,
                      ),
                  ),
                ],
              }
            : loaded,
        );
        setAccountError('');
      } catch (failure) {
        if (
          !signal?.aborted &&
          epoch === authEpoch.current &&
          requestNumber === accountRequest.current
        ) {
          setAccount(null);
          setAccountError(apiMessage(failure));
          handleError(failure);
        }
      } finally {
        if (!signal?.aborted && requestNumber === accountRequest.current)
          setAccountBusy(false);
      }
    },
    [account?.nextPositionsCursor, handleError],
  );

  useEffect(() => {
    if (!session) {
      setAccount(null);
      return;
    }
    const controller = new AbortController();
    void refreshAccount(false, controller.signal);
    const expiresIn = Date.parse(session.expiresAt) - Date.now();
    const timer = window.setTimeout(
      () => {
        authEpoch.current++;
        setSession(null);
        setAccount(null);
        setModal(null);
        setMessage('Your session expired. Sign in again.');
      },
      Math.max(0, Math.min(expiresIn, 2_147_483_647)),
    );
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
    // Account pagination must not restart session restoration.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.address, session?.expiresAt]);

  function navigate(next: Section, scroll = false) {
    setSection(next);
    if (location.hash !== `#${next}`) history.pushState(null, '', `#${next}`);
    if (scroll)
      requestAnimationFrame(() => {
        workspaceRef.current?.scrollIntoView({
          behavior: window.matchMedia('(prefers-reduced-motion: reduce)')
            .matches
            ? 'instant'
            : 'smooth',
        });
        workspaceRef.current?.focus({ preventScroll: true });
      });
  }

  function openIntent(next: Intent) {
    if (!status) {
      setMessage('The application service is unavailable. Try refreshing it.');
      return;
    }
    if (!session) {
      intent.current = next;
      setSignError('');
      setModal({ type: 'signin' });
    } else setModal(next);
  }

  async function signIn() {
    const wallet = getWalletProvider();
    if (!wallet) {
      setSignError(
        'Open Riftwell in a browser with an Ethereum wallet installed.',
      );
      return;
    }
    setProvider(wallet);
    setSigning(true);
    setSignError('');
    const attempt = ++signInAttempt.current;
    const epoch = ++authEpoch.current;
    walletConnecting.current = true;
    try {
      const address = await connectWallet(wallet);
      walletConnecting.current = false;
      signInAddress.current = address;
      if (attempt !== signInAttempt.current || epoch !== authEpoch.current)
        return;
      const challenge = await api.challenge(address);
      const signature = await signChallenge(wallet, address, challenge.message);
      const [currentAccounts, currentChain] = await Promise.all([
        wallet.request({ method: 'eth_accounts' }),
        wallet.request({ method: 'eth_chainId' }),
      ]);
      if (attempt !== signInAttempt.current) return;
      if (
        epoch !== authEpoch.current ||
        !Array.isArray(currentAccounts) ||
        typeof currentAccounts[0] !== 'string' ||
        currentAccounts[0].toLowerCase() !== address ||
        typeof currentChain !== 'string' ||
        !/^0x[0-9a-f]+$/i.test(currentChain) ||
        BigInt(currentChain) !== 999n
      )
        throw new Error(
          'Your wallet changed during sign-in. Please try again.',
        );
      const verified = await api.verify(challenge.challengeId, signature);
      if (
        attempt !== signInAttempt.current ||
        epoch !== authEpoch.current ||
        verified.address.toLowerCase() !== address ||
        verified.chainId !== 999
      ) {
        await api.logout(verified.csrfToken);
        throw new Error(
          'Your wallet changed during sign-in. Please try again.',
        );
      }
      setSession(verified);
      setModal(intent.current ?? { type: 'account' });
      intent.current = null;
      setMessage(
        'Signed in. Your records are saved by the application service.',
      );
    } catch (failure) {
      if (attempt === signInAttempt.current)
        setSignError(
          failure instanceof ApiError ||
            (failure instanceof Error &&
              failure.message.includes('during sign-in'))
            ? apiMessage(failure)
            : walletErrorMessage(failure),
        );
    } finally {
      walletConnecting.current = false;
      signInAddress.current = null;
      setSigning(false);
    }
  }

  async function signOut() {
    const current = sessionRef.current;
    if (!current) return;
    try {
      await api.logout(current.csrfToken);
      authEpoch.current++;
      setSession(null);
      setAccount(null);
      closeModal();
      setMessage('Signed out. Your off-chain records remain on the server.');
    } catch (failure) {
      setMessage(apiMessage(failure));
      handleError(failure);
    }
  }

  function saved(text: string) {
    closeModal();
    setMessage(text);
    lists.refresh();
    requests.refresh();
    void refreshAccount();
  }

  async function cancelRecord(
    kind: 'listing' | 'request' | 'offer',
    record: Listing | LoanRequest | Offer,
  ) {
    if (!session) throw new Error('Sign in again to cancel this record.');
    try {
      if (kind === 'listing')
        await api.cancelListing(record.id, session.csrfToken);
      else if (kind === 'request')
        await api.cancelLoanRequest(record.id, session.csrfToken);
      else await api.cancelOffer(record.id, session.csrfToken);
      lists.refresh();
      requests.refresh();
      await refreshAccount();
      setModal({ type: 'account' });
      setMessage('The off-chain record was cancelled.');
    } catch (failure) {
      handleError(failure);
      throw failure;
    }
  }

  const publicError = section === 'marketplace' ? lists.error : requests.error;
  const publicLoading =
    section === 'marketplace' ? lists.loading : requests.loading;
  const retry = () => {
    setServiceRevision((value) => value + 1);
    lists.refresh();
    requests.refresh();
    void refreshAccount();
  };

  return (
    <div className="app-shell" data-market={market.id} data-mode="connected">
      <a
        className="skip-link"
        href="#workspace"
        onClick={(event) => {
          event.preventDefault();
          navigate(section, true);
        }}
      >
        Skip to explore
      </a>
      <header className="site-header">
        <a
          className="brand"
          href="#marketplace"
          aria-label="Riftwell home"
          onClick={(event) => {
            event.preventDefault();
            navigate('marketplace');
            window.scrollTo({ top: 0, behavior: 'instant' });
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
          {(['lending', 'marketplace'] as const).map((next) => (
            <button
              key={next}
              className={`nav-item${section === next ? ' active' : ''}`}
              aria-current={section === next ? 'page' : undefined}
              onClick={() => navigate(next)}
            >
              {next === 'lending' ? 'Lending' : 'Marketplace'}
            </button>
          ))}
        </nav>
        <div className="header-actions">
          <MarketSelector
            market={market}
            onChange={(next) => {
              setMarket(next);
              closeModal();
            }}
          />
          <span className="preview-badge">
            <span />
            Connected
          </span>
          <button
            ref={accountButtonRef}
            className="button secondary account-button"
            disabled={signing}
            onClick={() => {
              setSignError('');
              setModal({ type: session ? 'account' : 'signin' });
              if (session) void refreshAccount();
            }}
          >
            <CircleUserRound aria-hidden="true" />
            <span>{session ? shortAddress(session.address) : 'Sign in'}</span>
          </button>
        </div>
      </header>
      <main className="page-main">
        <section className="hero" aria-labelledby="connected-hero-title">
          <div className="hero-copy">
            <p className="eyebrow">
              <span className="eyebrow-dot" />
              {market.name} · {market.chain}
            </p>
            <h1 className="hero-title" id="connected-hero-title">
              A new orbit
              <br />
              for your <span className="accent-text">assets.</span>
            </h1>
            <p className="hero-description">
              List verified veKITTEN positions. Create borrowing requests and
              unfunded lending offers in one space.
            </p>
            <div className="hero-actions">
              <button
                className="button primary"
                onClick={() => navigate('marketplace', true)}
              >
                Explore positions <ArrowRight size={16} aria-hidden="true" />
              </button>
              <button
                className="button ghost"
                onClick={() => navigate('lending', true)}
              >
                Explore lending <ArrowRight size={16} aria-hidden="true" />
              </button>
            </div>
            <p className="hero-note">
              <span />
              Off-chain records. Contract settlement pending launch.
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
                KITTENSWAP / HYPEREVM
              </div>
              <div className="portal-coordinate top">veKITTEN / RW</div>
              <div className="portal-coordinate bottom">
                VERIFIED POSITION READS
              </div>
            </div>
          </div>
        </section>
        {(serviceError || publicError || accountError) && (
          <div className="notice storage-notice" role="alert">
            <Info size={18} aria-hidden="true" />
            <p>
              {serviceError || publicError || accountError} Current data is
              unavailable; sample data has not been substituted.
            </p>
            <button className="inline-link" onClick={retry}>
              Retry service
            </button>
          </div>
        )}
        {message && (
          <div className="notice storage-notice" role="status">
            <Info size={18} aria-hidden="true" />
            <p>{message}</p>
            <button className="inline-link" onClick={() => setMessage('')}>
              Dismiss
            </button>
          </div>
        )}
        <section
          ref={workspaceRef}
          className="workspace"
          id="workspace"
          tabIndex={-1}
          aria-label={
            section === 'marketplace'
              ? 'Connected NFT marketplace'
              : 'Connected NFT lending'
          }
        >
          <div className="section-heading">
            <div>
              <p className="section-eyebrow">
                KittenSwap{' '}
                {section === 'marketplace' ? 'MARKETPLACE' : 'LENDING'}
              </p>
              <h2 className="section-title">
                {section === 'marketplace'
                  ? 'List your NFT position.'
                  : 'Borrowing begins with a request.'}
              </h2>
              <p className="section-description">
                {section === 'marketplace'
                  ? 'Ownership-verified listings. Purchases await contract settlement.'
                  : 'Requests and offers are durable records. All remain unfunded.'}
              </p>
            </div>
            <button
              className="button primary"
              disabled={!status}
              onClick={() =>
                openIntent({
                  type: 'form',
                  kind: section === 'marketplace' ? 'listing' : 'request',
                })
              }
            >
              {section === 'marketplace' ? 'Create listing' : 'Request a loan'}
            </button>
          </div>
          {section === 'marketplace' ? (
            !publicError && (
              <PublicListings
                items={lists.items}
                loading={lists.loading}
                onReview={(listing) => setModal({ type: 'review', listing })}
              />
            )
          ) : (
            <>
              <div
                className="segmented-control lending-tabs connected-lending-tabs"
                aria-label="Lending view"
              >
                <button
                  className={lendingTab === 'borrow' ? 'active' : ''}
                  aria-pressed={lendingTab === 'borrow'}
                  onClick={() => setLendingTab('borrow')}
                >
                  Borrow
                </button>
                <button
                  className={lendingTab === 'lend' ? 'active' : ''}
                  aria-pressed={lendingTab === 'lend'}
                  onClick={() => setLendingTab('lend')}
                >
                  Lend
                </button>
              </div>
              {lendingTab === 'borrow' ? (
                <div className="lending-intro">
                  <span className="lending-intro-icon">
                    <Info size={24} aria-hidden="true" />
                  </span>
                  <div>
                    <h3>Start with a position you own.</h3>
                    <p>
                      Verify your veKITTEN token ID and set a USDC amount, APR
                      and duration. Ownership alone does not establish safe
                      borrowing capacity. Your account shows saved requests and
                      their status.
                    </p>
                    <button
                      className="inline-link"
                      onClick={() => {
                        setModal({ type: session ? 'account' : 'signin' });
                        if (session) void refreshAccount();
                      }}
                    >
                      View your account
                    </button>
                  </div>
                </div>
              ) : (
                !publicError && (
                  <PublicRequests
                    items={requests.items}
                    loading={requests.loading}
                    address={session?.address}
                    onOffer={(request) =>
                      openIntent({ type: 'form', kind: 'offer', request })
                    }
                  />
                )
              )}
            </>
          )}
          {!publicError &&
            (section === 'marketplace'
              ? lists.nextCursor
              : lendingTab === 'lend' && requests.nextCursor) && (
              <div className="connected-pagination">
                <button
                  className="button secondary"
                  disabled={publicLoading}
                  onClick={
                    section === 'marketplace'
                      ? lists.loadMore
                      : requests.loadMore
                  }
                >
                  {publicLoading ? 'Loading…' : 'Load more'}
                </button>
              </div>
            )}
        </section>
      </main>
      <footer className="site-footer">
        <a
          className="brand footer-brand"
          href="#marketplace"
          onClick={(event) => {
            event.preventDefault();
            navigate('marketplace');
          }}
        >
          <span className="brand-mark">
            <PortalMark size={24} />
          </span>
          <span className="brand-name">riftwell.</span>
        </a>
        <p>Durable off-chain records. No funded settlement.</p>
        <div className="footer-links">
          <a
            href="https://github.com/ael-dev3/Riftwell"
            target="_blank"
            rel="noreferrer"
          >
            Source code<span className="sr-only"> (opens in a new tab)</span>
          </a>
        </div>
      </footer>
      {modal?.type === 'signin' && (
        <Dialog
          title="Sign in with your wallet"
          kicker="HYPEREVM · CHAIN 999"
          onClose={() => {
            intent.current = null;
            closeModal();
          }}
        >
          <div className="dialog-body">
            <p>
              Connect your browser wallet and sign the server’s sign-in message
              to manage your off-chain records.
            </p>
            <div className="notice">
              <Info size={17} aria-hidden="true" />
              <p>
                This signature authenticates your account. It does not approve
                tokens, transfer NFTs or send a transaction.
              </p>
            </div>
            <p className="form-error" role="alert">
              {signError}
            </p>
          </div>
          <div className="dialog-footer">
            <button className="button secondary" onClick={closeModal}>
              Cancel
            </button>
            <button
              className="button primary"
              disabled={signing || !status?.capabilities.walletSignIn}
              onClick={() => void signIn()}
            >
              {signing ? 'Complete wallet sign-in…' : 'Sign in with wallet'}
            </button>
          </div>
        </Dialog>
      )}
      {modal?.type === 'review' && (
        <ListingReview listing={modal.listing} onClose={closeModal} />
      )}
      {modal?.type === 'offer-review' && (
        <OfferReview
          offer={modal.offer}
          request={modal.request}
          onClose={() => setModal({ type: 'account' })}
        />
      )}
      {modal?.type === 'form' && session && (
        <RecordForm
          key={`${modal.kind}-${modal.position?.id ?? modal.request?.id ?? 'new'}`}
          kind={modal.kind}
          position={modal.position}
          request={modal.request}
          session={session}
          onClose={closeModal}
          onSaved={saved}
          onError={handleError}
        />
      )}
      {modal?.type === 'account' && session && (
        <ConnectedAccount
          account={account}
          loading={accountBusy}
          onClose={closeModal}
          onRefresh={() => void refreshAccount()}
          onMore={() => void refreshAccount(true)}
          onList={(position) =>
            openIntent({ type: 'form', kind: 'listing', position })
          }
          onBorrow={(position) =>
            openIntent({ type: 'form', kind: 'request', position })
          }
          onCancel={(kind, record) =>
            setModal({ type: 'cancel', kind, record })
          }
          onSignOut={() => void signOut()}
          onReviewOffer={(offer, request) =>
            setModal({ type: 'offer-review', offer, request })
          }
        />
      )}
      {modal?.type === 'cancel' && (
        <CancellationDialog
          label={
            modal.kind === 'request'
              ? 'borrowing request'
              : modal.kind === 'offer'
                ? 'lending offer'
                : 'listing'
          }
          onClose={() => setModal({ type: 'account' })}
          onConfirm={() => cancelRecord(modal.kind, modal.record)}
        />
      )}
    </div>
  );
}
