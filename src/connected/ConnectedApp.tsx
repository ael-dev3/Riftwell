import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { CircleUserRound, Info } from 'lucide-react';
import { preloadable, preloadWhenIdle } from '../app/preloadable';
import { useHashRoute, type Page } from '../app/router';
import { useShortcuts } from '../app/shortcuts';
import { applyTheme, readTheme } from '../app/theme';
import { ToastProvider, useToast } from '../app/toast';
import PageFallback from '../components/PageFallback';
import AppShell, { ShortcutsDialog } from '../components/shell/AppShell';
import { DEFAULT_MARKET, type Market } from '../markets';
import Dialog from '../components/Dialog';
import { Notice } from '../components/ui/Bits';
import {
  api,
  ApiError,
  type Account,
  type Listing,
  type LendingStatus,
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
import {
  CollateralReview,
  ConnectedBorrow,
  ConnectedEarn,
} from './ConnectedLending';
import { apiMessage, usePages } from './usePages';
import {
  CancellationDialog,
  ListingReview,
  RecordForm,
  SweepReview,
  ListingPicker,
} from './RecordDialogs';
import { ConnectedAccount } from './ConnectedViews';
import ConnectedMarketplace from './ConnectedMarketplace';
import NotFoundPage from '../pages/NotFoundPage';
import { useMinuteClock } from '../app/clock';

const SimulatorPage = preloadable(() => import('../pages/SimulatorPage'));
const FaqPage = preloadable(() => import('../pages/FaqPage'));
const StatsPage = preloadable(() => import('../pages/StatsPage'));
const BrandPage = preloadable(() => import('../pages/BrandPage'));
const PrivacyPage = preloadable(() => import('../pages/PrivacyPage'));
const VaultDetails = preloadable(() => import('../components/VaultDetails'));

type Intent =
  | { type: 'picker' }
  | {
      type: 'form';
      kind: 'listing';
      position?: Position;
    };
type Modal =
  | Intent
  | { type: 'signin' | 'account' | 'about' | 'shortcuts' | 'vault' }
  | { type: 'review'; listing: Listing }
  | { type: 'sweep'; listings: Listing[] }
  | { type: 'edit'; listing: Listing }
  | { type: 'collateral'; position: Position }
  | {
      type: 'cancel';
      kind: 'listing' | 'request' | 'offer';
      record: Listing | LoanRequest | Offer;
    }
  | null;

function ConnectedShell() {
  const { route, navigate } = useHashRoute('borrow');
  const now = useMinuteClock();
  const [market, setMarket] = useState<Market>(DEFAULT_MARKET);
  const toast = useToast();
  const searchRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [lending, setLending] = useState<LendingStatus | null>(null);
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
  const accountButtonRef = useRef<HTMLButtonElement>(null);
  const lists = usePages(
    (cursor, signal) => api.listings(market.id, cursor, signal),
    market.id,
  );

  function closeModal() {
    intent.current = null;
    if (signingRef.current) {
      authEpoch.current++;
      signInAttempt.current++;
      api.clearSession();
      if (api.sessionTransport === 'bearer') {
        walletConnecting.current = false;
        signInAddress.current = null;
        setSigning(false);
      }
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

  useEffect(
    () =>
      preloadWhenIdle([
        SimulatorPage,
        FaqPage,
        StatsPage,
        BrandPage,
        PrivacyPage,
        VaultDetails,
      ]),
    [],
  );

  useEffect(() => {
    closeModal();
    // Route changes close any open dialog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.page]);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      api.status(controller.signal),
      api.markets(controller.signal),
      api.lending(controller.signal),
    ])
      .then(([health, available, lendingState]) => {
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
        setLending(lendingState);
        setServiceError('');
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) {
          setStatus(null);
          setLending(null);
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
      else api.clearSession();
    });
  }, [provider]);

  const handleError = useCallback((failure: unknown) => {
    if (api.isCurrentSessionError(failure)) {
      authEpoch.current++;
      api.clearSession();
      setSession(null);
      setAccount(null);
      setModal({ type: 'signin' });
      setSignError('Your session expired. Sign in again.');
    }
  }, []);

  const ownLists = usePages(
    async (cursor, signal) => {
      if (!session) return { items: [], nextCursor: null };
      const epoch = authEpoch.current;
      try {
        return await api.ownListings(
          market.id,
          session.address,
          cursor,
          signal,
        );
      } catch (failure) {
        if (
          !signal.aborted &&
          epoch === authEpoch.current &&
          sessionRef.current?.csrfToken === session.csrfToken
        )
          handleError(failure);
        throw failure;
      }
    },
    `${market.id}:${session?.csrfToken ?? 'signed-out'}`,
  );

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
          more &&
          previous &&
          !previous.positionsUnavailable &&
          !loaded.positionsUnavailable
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
        api.clearSession();
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

  const go = useCallback(
    (page: Page) => navigate({ page, item: null }),
    [navigate],
  );

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
    api.clearSession();
    walletConnecting.current = true;
    try {
      const address = await connectWallet(wallet);
      if (attempt !== signInAttempt.current || epoch !== authEpoch.current)
        return;
      walletConnecting.current = false;
      signInAddress.current = address;
      const challenge = await api.challenge(address);
      if (attempt !== signInAttempt.current || epoch !== authEpoch.current)
        return;
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
      toast('Signed in. Your records are saved by the application service.');
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
      if (
        attempt === signInAttempt.current ||
        api.sessionTransport === 'cookie'
      ) {
        walletConnecting.current = false;
        signInAddress.current = null;
        setSigning(false);
      }
    }
  }

  async function signOut() {
    const current = sessionRef.current;
    if (!current) return;
    const epoch = ++authEpoch.current;
    const request = api.logout(current.csrfToken);
    if (api.sessionTransport === 'bearer') {
      setSession(null);
      setAccount(null);
      closeModal();
    }
    try {
      await request;
      if (epoch !== authEpoch.current) return;
      setSession(null);
      setAccount(null);
      closeModal();
      toast('Signed out. Your off-chain records remain on the server.', 'info');
    } catch (failure) {
      if (epoch !== authEpoch.current) return;
      setMessage(
        api.sessionTransport === 'bearer'
          ? `Signed out of this page. ${apiMessage(failure)}`
          : apiMessage(failure),
      );
      handleError(failure);
    }
  }

  function saved(text: string) {
    closeModal();
    toast(text);
    lists.refresh();
    ownLists.refresh();
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
      ownLists.refresh();
      await refreshAccount();
      setModal({ type: 'account' });
      toast('The off-chain record was cancelled.', 'info');
    } catch (failure) {
      handleError(failure);
      throw failure;
    }
  }

  const publicError = route.page === 'marketplace' ? lists.error : '';
  const retry = () => {
    setServiceRevision((value) => value + 1);
    lists.refresh();
    ownLists.refresh();
    void refreshAccount();
  };

  const notices = (serviceError || publicError || accountError || message) && (
    <div className="notices">
      {(serviceError || publicError || accountError) && (
        <div className="notice storage-notice service-banner" role="alert">
          <Info size={18} aria-hidden="true" />
          <p>
            {serviceError || publicError || accountError} Current data is
            unavailable; sample data has not been substituted.
          </p>
          <button className="button secondary small" onClick={retry}>
            Retry service
          </button>
        </div>
      )}
      {message && (
        <div className="notice storage-notice service-banner" role="status">
          <Info size={18} aria-hidden="true" />
          <p>{message}</p>
          <button className="button ghost small" onClick={() => setMessage('')}>
            Dismiss
          </button>
        </div>
      )}
    </div>
  );

  let page;
  switch (route.page) {
    case 'borrow':
      page = (
        <ConnectedBorrow
          market={market}
          status={lending}
          account={account}
          signedIn={!!session}
          loading={accountBusy}
          onAccount={() => {
            setModal({ type: session ? 'account' : 'signin' });
            if (session) void refreshAccount();
          }}
          onInspect={(position) => setModal({ type: 'collateral', position })}
        />
      );
      break;
    case 'earn':
      page = (
        <ConnectedEarn
          market={market}
          status={lending}
          onDetails={() => setModal({ type: 'vault' })}
        />
      );
      break;
    case 'marketplace':
      page = (
        <ConnectedMarketplace
          searchRef={searchRef}
          market={market}
          items={lists.items}
          loading={lists.loading}
          error={publicError}
          ownItems={ownLists.items}
          ownLoading={ownLists.loading}
          ownError={ownLists.error}
          ownHasMore={!!ownLists.nextCursor}
          onOwnMore={ownLists.loadMore}
          account={account}
          signedIn={!!session}
          signedAddress={session?.address ?? null}
          accountLoading={accountBusy}
          hasMore={!!lists.nextCursor}
          onMore={lists.loadMore}
          onRefresh={retry}
          onList={() => openIntent({ type: 'picker' })}
          onAccount={() => {
            setModal({ type: session ? 'account' : 'signin' });
            if (session) void refreshAccount();
          }}
          onReview={(listing) => setModal({ type: 'review', listing })}
          onSweep={(listings) => setModal({ type: 'sweep', listings })}
          onEdit={(listing) => setModal({ type: 'edit', listing })}
          onCancel={(listing) =>
            setModal({ type: 'cancel', kind: 'listing', record: listing })
          }
        />
      );
      break;
    case 'simulator':
      page = <SimulatorPage market={market} />;
      break;
    case 'faq':
      page = <FaqPage market={market} mode="connected" />;
      break;
    case 'stats':
      page = (
        <StatsPage
          market={market}
          now={now}
          model={{
            mode: 'connected',
            vault: null,
            rewards: null,
            sales: null,
            volumeSeries: null,
            positions: lists.items.map((listing) => ({
              balance: Number(
                BigInt(listing.position.lockedAmountRaw) / 10n ** 18n,
              ),
              unlockMs: Date.parse(listing.position.lockedUntil),
            })),
            listed: lists.items.length,
          }}
        />
      );
      break;
    case 'brand':
      page = <BrandPage market={market} />;
      break;
    case 'privacy':
      page = <PrivacyPage mode="connected" />;
      break;
    case 'not-found':
      page = <NotFoundPage path={route.item} onNavigate={go} />;
      break;
  }

  return (
    <AppShell
      route={route}
      onNavigate={go}
      market={market}
      onMarketChange={(next) => {
        setMarket(next);
        closeModal();
      }}
      mode="connected"
      onAbout={() => setModal({ type: 'about' })}
      onShortcuts={() => setModal({ type: 'shortcuts' })}
      notices={notices}
      account={
        <button
          ref={accountButtonRef}
          type="button"
          className="button secondary account-button"
          aria-label={
            session ? `Account ${shortAddress(session.address)}` : 'Sign in'
          }
          disabled={signing}
          onClick={() => {
            setSignError('');
            setModal({ type: session ? 'account' : 'signin' });
            if (session) void refreshAccount();
          }}
        >
          <CircleUserRound size={17} aria-hidden="true" />
          <span className="account-label">
            {session ? shortAddress(session.address) : 'Sign in'}
          </span>
        </button>
      }
    >
      <Suspense fallback={<PageFallback />}>
        <div className="page-body" key={route.page}>
          {page}
        </div>
      </Suspense>
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
            <p className="panel-text">
              Connect your browser wallet and sign the server’s sign-in message
              to manage your off-chain records.
            </p>
            {api.sessionTransport === 'bearer' && (
              <p>Reloading this page signs you out.</p>
            )}
            <Notice>
              This signature authenticates your account. It does not approve
              tokens, transfer NFTs or send a transaction.
            </Notice>
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
      {modal?.type === 'sweep' && (
        <SweepReview listings={modal.listings} onClose={closeModal} />
      )}
      {modal?.type === 'picker' && session && (
        <ListingPicker
          account={account}
          loading={accountBusy}
          onClose={closeModal}
          onChoose={(position) =>
            setModal({ type: 'form', kind: 'listing', position })
          }
          onMore={() => void refreshAccount(true)}
          onManual={() => setModal({ type: 'form', kind: 'listing' })}
        />
      )}
      {modal?.type === 'edit' && session && (
        <RecordForm
          key={modal.listing.id}
          listing={modal.listing}
          position={modal.listing.position}
          session={session}
          onClose={closeModal}
          onSaved={saved}
          onError={handleError}
        />
      )}
      {modal?.type === 'collateral' && (
        <CollateralReview position={modal.position} onClose={closeModal} />
      )}
      {modal?.type === 'form' && session && (
        <RecordForm
          key={modal.position?.id ?? 'new'}
          position={modal.position}
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
          onCancel={(kind, record) =>
            setModal({ type: 'cancel', kind, record })
          }
          onSignOut={() => void signOut()}
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
      {modal?.type === 'vault' && (
        <Suspense fallback={null}>
          <VaultDetails market={market} lending={null} onClose={closeModal} />
        </Suspense>
      )}
      {modal?.type === 'shortcuts' && <ShortcutsDialog onClose={closeModal} />}
      {modal?.type === 'about' && (
        <Dialog
          title="Service status"
          kicker="CONNECTED MODE"
          onClose={closeModal}
        >
          <div className="dialog-body">
            <dl className="facts">
              <div>
                <dt>Application service</dt>
                <dd>{status ? 'Available' : 'Unavailable'}</dd>
              </div>
              <div>
                <dt>Network</dt>
                <dd>HyperEVM · chain 999</dd>
              </div>
              <div>
                <dt>Ownership reads</dt>
                <dd>Verified at a pinned block</dd>
              </div>
              <div>
                <dt>Listings</dt>
                <dd>Durable off-chain records</dd>
              </div>
              <div>
                <dt>Lending and vault</dt>
                <dd>Not launched</dd>
              </div>
              <div>
                <dt>Purchase settlement</dt>
                <dd>Disabled</dd>
              </div>
            </dl>
            <Notice>
              Signing in authenticates your account only. Nothing here approves
              tokens, transfers NFTs or moves funds.
            </Notice>
          </div>
          <div className="dialog-footer">
            <button className="button primary" onClick={closeModal}>
              Done
            </button>
          </div>
        </Dialog>
      )}
    </AppShell>
  );
}

export default function ConnectedApp() {
  return (
    <ToastProvider>
      <ConnectedShell />
    </ToastProvider>
  );
}
