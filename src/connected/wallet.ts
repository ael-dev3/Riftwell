export interface WalletProvider {
  request(args: {
    method: string;
    params?: readonly unknown[] | object;
  }): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): unknown;
  removeListener?(
    event: string,
    listener: (...args: unknown[]) => void,
  ): unknown;
}

export type WalletChange =
  | { type: 'accountsChanged'; accounts: string[] }
  | { type: 'chainChanged'; chainId: string }
  | { type: 'disconnect' };

export const HYPEREVM_CHAIN_ID = '0x3e7';
const ADDRESS = /^0x[0-9a-f]{40}$/i;

export interface WalletOption {
  id: string;
  name: string;
  provider: WalletProvider;
}

export function discoverWallets(
  listener: (options: readonly WalletOption[]) => void,
): { request(): void; stop(): void } {
  const options: WalletOption[] = [];
  let legacyCount = 0;
  const legacyProviders = new WeakSet<WalletProvider>();
  const addLegacy = (provider: WalletProvider) => {
    legacyCount++;
    legacyProviders.add(provider);
    options.push({
      id:
        legacyCount === 1 ? 'browser-wallet' : `browser-wallet-${legacyCount}`,
      name:
        legacyCount === 1 ? 'Browser wallet' : `Browser wallet ${legacyCount}`,
      provider,
    });
  };
  const legacy = getWalletProvider();
  if (legacy) addLegacy(legacy);
  let active = true;
  const emit = () => listener(options.map((option) => ({ ...option })));
  const announce = (event: Event) => {
    if (!active || options.length >= 16) return;
    let option: WalletOption;
    try {
      const detail: unknown = (event as CustomEvent<unknown>).detail;
      if (!detail || typeof detail !== 'object') return;
      const { info, provider } = detail as {
        info?: unknown;
        provider?: unknown;
      };
      if (!info || typeof info !== 'object') return;
      const { uuid, name } = info as { uuid?: unknown; name?: unknown };
      if (
        typeof uuid !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          uuid,
        ) ||
        typeof name !== 'string' ||
        !name.trim() ||
        name.length > 80 ||
        /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(name) ||
        !provider ||
        typeof provider !== 'object' ||
        typeof (provider as WalletProvider).request !== 'function'
      )
        return;
      option = {
        id: uuid.toLowerCase(),
        name: name.trim(),
        provider: provider as WalletProvider,
      };
    } catch {
      // Announcement metadata and provider accessors are untrusted.
      return;
    }
    if (options.some((item) => item.id === option.id)) return;
    const existing = options.findIndex(
      (item) => item.provider === option.provider,
    );
    if (existing >= 0) {
      if (!legacyProviders.has(option.provider)) return;
      legacyProviders.delete(option.provider);
      options[existing] = option;
    } else options.push(option);
    // Display names are self-reported, not an endorsement. Icons/URLs are never loaded.
    emit();
  };
  if (typeof window !== 'undefined')
    window.addEventListener('eip6963:announceProvider', announce);
  emit();
  return {
    request() {
      if (active && typeof window !== 'undefined') {
        const currentLegacy = getWalletProvider();
        if (
          currentLegacy &&
          options.length < 16 &&
          !options.some((option) => option.provider === currentLegacy)
        ) {
          // Keep old provider identity and explicit choices intact when a
          // different extension later replaces the legacy global.
          addLegacy(currentLegacy);
          emit();
        }
        window.dispatchEvent(new Event('eip6963:requestProvider'));
      }
    },
    stop() {
      active = false;
      if (typeof window !== 'undefined')
        window.removeEventListener('eip6963:announceProvider', announce);
    },
  };
}

export class WalletError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'WalletError';
    this.code = code;
  }
}

export function getWalletProvider(): WalletProvider | null {
  if (typeof window === 'undefined') return null;
  try {
    const candidate = (window as Window & { ethereum?: unknown }).ethereum;
    if (
      candidate &&
      typeof candidate === 'object' &&
      'request' in candidate &&
      typeof candidate.request === 'function'
    )
      return candidate as WalletProvider;
  } catch {
    // Injected accessors are outside the application's control.
  }
  return null;
}

function unsupportedProvider() {
  return new WalletError(
    'UNSUPPORTED_PROVIDER',
    'This wallet cannot report account or network changes reliably. Use a compatible Ethereum wallet browser or extension.',
  );
}

function lifecycleMethods(provider: WalletProvider) {
  let on: WalletProvider['on'];
  let removeListener: WalletProvider['removeListener'];
  try {
    on = provider.on;
    removeListener = provider.removeListener;
  } catch {
    throw unsupportedProvider();
  }
  if (typeof on !== 'function' || typeof removeListener !== 'function')
    throw unsupportedProvider();
  return { on, removeListener };
}

function requireProvider(provider: WalletProvider | null | undefined) {
  let request: WalletProvider['request'] | undefined;
  try {
    request = provider?.request;
  } catch {
    throw unsupportedProvider();
  }
  if (!provider || typeof request !== 'function') {
    throw new WalletError(
      'NO_PROVIDER',
      'Open Riftwell in a browser with an Ethereum wallet installed.',
    );
  }
  lifecycleMethods(provider);
  return provider;
}

function addressFromAccounts(accounts: unknown): string {
  if (
    !Array.isArray(accounts) ||
    typeof accounts[0] !== 'string' ||
    !ADDRESS.test(accounts[0])
  ) {
    throw new WalletError(
      'NO_ACCOUNT',
      'Your wallet did not provide an account.',
    );
  }
  return accounts[0].toLowerCase();
}

function isHyperEvm(chainId: unknown): boolean {
  return (
    typeof chainId === 'string' &&
    /^0x[0-9a-f]+$/i.test(chainId) &&
    BigInt(chainId) === 999n
  );
}

export async function connectWallet(provider: WalletProvider): Promise<string> {
  const wallet = requireProvider(provider);
  await wallet.request({ method: 'eth_requestAccounts' });
  if (!isHyperEvm(await wallet.request({ method: 'eth_chainId' }))) {
    const switchChain = () =>
      wallet.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: HYPEREVM_CHAIN_ID }],
      });
    try {
      await switchChain();
    } catch (error) {
      let code: unknown;
      try {
        if (error && typeof error === 'object' && 'code' in error)
          code = error.code;
      } catch {}
      if (code !== 4902 && code !== '4902') throw error;
      await wallet.request({
        method: 'wallet_addEthereumChain',
        params: [
          {
            chainId: HYPEREVM_CHAIN_ID,
            chainName: 'HyperEVM',
            nativeCurrency: { name: 'HYPE', symbol: 'HYPE', decimals: 18 },
            rpcUrls: ['https://rpc.hyperliquid.xyz/evm'],
            blockExplorerUrls: ['https://hyperevmscan.io'],
          },
        ],
      });
      // Adding a network does not imply it became the selected network.
      await switchChain();
    }
    if (!isHyperEvm(await wallet.request({ method: 'eth_chainId' }))) {
      throw new WalletError('WRONG_CHAIN', 'Switch your wallet to HyperEVM.');
    }
  }
  // A chain switch can also change the selected wallet account.
  return addressFromAccounts(await wallet.request({ method: 'eth_accounts' }));
}

export async function signChallenge(
  provider: WalletProvider,
  address: string,
  message: string,
): Promise<string> {
  const wallet = requireProvider(provider);
  if (!ADDRESS.test(address) || !message) {
    throw new WalletError(
      'INVALID_CHALLENGE',
      'The sign-in challenge is invalid.',
    );
  }
  if (!isHyperEvm(await wallet.request({ method: 'eth_chainId' }))) {
    throw new WalletError('WRONG_CHAIN', 'Switch your wallet to HyperEVM.');
  }
  const selected = addressFromAccounts(
    await wallet.request({ method: 'eth_accounts' }),
  );
  if (selected !== address.toLowerCase()) {
    throw new WalletError(
      'ACCOUNT_CHANGED',
      'Your selected wallet account changed. Connect again to sign in.',
    );
  }
  // Preserve the server's exact message, including whitespace and UTF-8 bytes.
  const hex = Array.from(new TextEncoder().encode(message), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  const signature = await wallet.request({
    method: 'personal_sign',
    params: [`0x${hex}`, address],
  });
  if (typeof signature !== 'string' || !/^0x[0-9a-f]+$/i.test(signature)) {
    throw new WalletError(
      'INVALID_SIGNATURE',
      'Your wallet returned an invalid signature.',
    );
  }
  return signature;
}

export function subscribeWallet(
  provider: WalletProvider,
  listener: (change: WalletChange) => void,
): () => void {
  const wallet = requireProvider(provider);
  const { on, removeListener } = lifecycleMethods(wallet);
  let active = true;
  let applicationFailure: { error: unknown } | undefined;
  const emit = (change: WalletChange) => {
    if (!active) return;
    try {
      listener(change);
    } catch (error) {
      applicationFailure = { error };
      throw error;
    }
  };
  const accountsChanged = (accounts: unknown) => {
    emit({
      type: 'accountsChanged',
      accounts: Array.isArray(accounts)
        ? accounts
            .filter(
              (account): account is string =>
                typeof account === 'string' && ADDRESS.test(account),
            )
            .map((account) => account.toLowerCase())
        : [],
    });
  };
  const chainChanged = (chainId: unknown) => {
    emit({
      type: 'chainChanged',
      chainId: typeof chainId === 'string' ? chainId : '',
    });
  };
  const disconnected = () => emit({ type: 'disconnect' });
  const attempted: [string, (...args: unknown[]) => void][] = [];
  const stop = () => {
    if (!active) return;
    active = false;
    for (const [event, callback] of attempted) {
      try {
        removeListener.call(wallet, event, callback);
      } catch {
        // Disabled wrappers remain inert even if the provider cannot remove them.
      }
    }
  };
  try {
    for (const [event, callback] of [
      ['accountsChanged', accountsChanged],
      ['chainChanged', chainChanged],
      ['disconnect', disconnected],
    ] as const) {
      // A provider may register a callback before throwing, so include the attempt.
      attempted.push([event, callback]);
      on.call(wallet, event, callback);
    }
  } catch (error) {
    stop();
    if (applicationFailure && applicationFailure.error === error) throw error;
    throw unsupportedProvider();
  }
  return stop;
}

export function walletErrorMessage(error: unknown): string {
  if (error instanceof WalletError) return error.message;
  const code =
    error && typeof error === 'object' && 'code' in error
      ? error.code
      : undefined;
  switch (code) {
    case 4001:
    case '4001':
      return 'The wallet request was cancelled. You can try again.';
    case 4100:
    case '4100':
      return 'Allow this site to access your selected wallet account.';
    case 4902:
    case '4902':
      return 'Add HyperEVM (chain 999) to your wallet, then connect again.';
    case 4900:
    case 4901:
    case '4900':
    case '4901':
      return 'Your wallet is disconnected. Open it and reconnect to HyperEVM.';
    case -32002:
    case '-32002':
      return 'A wallet request is already open. Complete it in your wallet.';
    default:
      return 'The wallet request failed. Check your wallet and try again.';
  }
}
