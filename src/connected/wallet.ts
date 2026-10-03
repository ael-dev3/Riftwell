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
    await wallet.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: HYPEREVM_CHAIN_ID }],
    });
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
