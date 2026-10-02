import type { Market, MarketId } from '../markets';

export type Page<T> = { items: T[]; nextCursor: string | null };
export type Status = {
  mode: 'connected';
  chainId: 999;
  marketId: MarketId;
  settlementEnabled: false;
  capabilities: {
    walletSignIn: boolean;
    marketplace: boolean;
    lending: boolean;
    settlement: false;
  };
};
export type Session = {
  address: string;
  chainId: 999;
  csrfToken: string;
  expiresAt: string;
};
export type Challenge = {
  challengeId: string;
  message: string;
  expiresAt: string;
};
export type Position = {
  id: string;
  tokenId: string;
  marketId: MarketId;
  owner: string;
  lockedAmountRaw: string;
  lockedUntil: string;
  votingPowerRaw: string;
  blockNumber: number;
  blockHash: string;
  observedAt: string;
};
export type OrderStatus = 'active' | 'cancelled' | 'expired' | 'invalidated';
export type Listing = {
  kind: 'fixed' | 'dutch';
  startPriceMicros: string;
  endPriceMicros: string;
  startsAt: string;
  auctionEndsAt: string | null;
  recipient: string | null;
  revision: number;
  updatedAt: string;
  id: string;
  marketId: MarketId;
  tokenId: string;
  owner: string;
  priceMicros: string;
  status: OrderStatus;
  expiresAt: string;
  createdAt: string;
  position: Position;
};
export type LoanRequest = {
  id: string;
  marketId: MarketId;
  tokenId: string;
  owner: string;
  principalMicros: string;
  aprBps: number;
  durationDays: number;
  status: OrderStatus;
  expiresAt: string;
  createdAt: string;
  position: Position;
};
export type Offer = {
  id: string;
  requestId: string;
  lender: string;
  principalMicros: string;
  aprBps: number;
  durationDays: number;
  status: 'proposed' | 'cancelled' | 'expired' | 'invalidated';
  expiresAt: string;
  createdAt: string;
};
export type Account = {
  address: string;
  positions: Position[];
  positionsUnavailable: boolean;
  nextPositionsCursor: string | null;
  listings: Listing[];
  loanRequests: LoanRequest[];
  offers: Offer[];
  receivedOffers: Offer[];
  historyTruncated?: boolean;
};
export type ListingTermsInput = {
  kind?: 'fixed' | 'dutch';
  endPriceMicros?: string;
  auctionEndsAt?: string | null;
  recipient?: string | null;
};
export type CreateListingInput = ListingTermsInput & {
  tokenId: string;
  priceMicros: string;
  expiresAt: string;
  idempotencyKey: string;
};
export type LendingStatus = {
  model: 'pooled-revenue';
  state: 'not-deployed';
  marketId: MarketId;
  asset: 'USDC';
  chainId: 999;
  vaultAddress: null;
  portfolioAddress: null;
  accounting: null;
  terms: null;
  executionEnabled: false;
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  readonly requestId: string | undefined;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: unknown,
    requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }
}

export type ApiClientOptions = {
  baseUrl?: string;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
};
type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  csrf?: string;
  signal?: AbortSignal | undefined;
};

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

type Validator<T> = (value: unknown) => value is T;
const UINT256_MAX = (1n << 256n) - 1n;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ADDRESS = /^0x[0-9a-f]{40}$/i;
const ORDER_STATUSES = ['active', 'cancelled', 'expired', 'invalidated'];
const OFFER_STATUSES = ['proposed', 'cancelled', 'expired', 'invalidated'];

function fields(
  value: unknown,
  names: readonly string[],
): value is Record<string, unknown> {
  return (
    object(value) &&
    Object.keys(value).length === names.length &&
    names.every((name) => Object.hasOwn(value, name))
  );
}

function text(value: unknown, maximum: number): value is string {
  return (
    typeof value === 'string' && value.length > 0 && value.length <= maximum
  );
}

function uuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

function address(value: unknown): value is string {
  return typeof value === 'string' && ADDRESS.test(value);
}

function rawUint256(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^(0|[1-9][0-9]{0,77})$/.test(value) &&
    BigInt(value) <= UINT256_MAX
  );
}

function money(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[1-9][0-9]{0,12}$/.test(value) &&
    BigInt(value) >= 1_000_000n &&
    BigInt(value) <= 1_000_000_000_000n
  );
}

function isoDate(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
  )
    return false;
  const time = Date.parse(value);
  return (
    Number.isFinite(time) &&
    new Date(time).toISOString().replace('.000Z', 'Z') ===
      value.replace('.000Z', 'Z')
  );
}

function cursor(value: unknown): value is string | null {
  return value === null || text(value, 512);
}

function array<T>(
  value: unknown,
  validate: Validator<T>,
  maximum: number,
): value is T[] {
  return (
    Array.isArray(value) && value.length <= maximum && value.every(validate)
  );
}

function position(value: unknown): value is Position {
  return (
    fields(value, [
      'id',
      'tokenId',
      'marketId',
      'owner',
      'lockedAmountRaw',
      'lockedUntil',
      'votingPowerRaw',
      'blockNumber',
      'blockHash',
      'observedAt',
    ]) &&
    value.marketId === 'kittenswap' &&
    rawUint256(value.tokenId) &&
    value.id === `kittenswap-${value.tokenId}` &&
    address(value.owner) &&
    rawUint256(value.lockedAmountRaw) &&
    isoDate(value.lockedUntil) &&
    rawUint256(value.votingPowerRaw) &&
    typeof value.blockNumber === 'number' &&
    Number.isSafeInteger(value.blockNumber) &&
    value.blockNumber >= 0 &&
    typeof value.blockHash === 'string' &&
    /^0x[0-9a-f]{64}$/i.test(value.blockHash) &&
    isoDate(value.observedAt)
  );
}

function order(value: Record<string, unknown>): boolean {
  return (
    uuid(value.id) &&
    value.marketId === 'kittenswap' &&
    rawUint256(value.tokenId) &&
    address(value.owner) &&
    typeof value.status === 'string' &&
    ORDER_STATUSES.includes(value.status) &&
    isoDate(value.expiresAt) &&
    isoDate(value.createdAt) &&
    Date.parse(value.expiresAt) > Date.parse(value.createdAt) &&
    position(value.position) &&
    value.position.tokenId === value.tokenId &&
    value.position.marketId === value.marketId &&
    (value.status !== 'active' ||
      value.position.owner.toLowerCase() === value.owner.toLowerCase())
  );
}

function listing(value: unknown): value is Listing {
  return (
    fields(value, [
      'kind',
      'startPriceMicros',
      'endPriceMicros',
      'startsAt',
      'auctionEndsAt',
      'recipient',
      'revision',
      'updatedAt',
      'id',
      'marketId',
      'tokenId',
      'owner',
      'priceMicros',
      'status',
      'expiresAt',
      'createdAt',
      'position',
    ]) &&
    order(value) &&
    typeof value.revision === 'number' &&
    Number.isSafeInteger(value.revision) &&
    value.revision > 0 &&
    isoDate(value.updatedAt) &&
    Date.parse(value.updatedAt) >= Date.parse(value.createdAt as string) &&
    money(value.priceMicros) &&
    money(value.startPriceMicros) &&
    money(value.endPriceMicros) &&
    BigInt(value.endPriceMicros) <= BigInt(value.priceMicros) &&
    BigInt(value.priceMicros) <= BigInt(value.startPriceMicros) &&
    isoDate(value.startsAt) &&
    Date.parse(value.startsAt) >= Date.parse(value.createdAt as string) &&
    Date.parse(value.startsAt) < Date.parse(value.expiresAt as string) &&
    (value.recipient === null ||
      (address(value.recipient) &&
        !/^0x0{40}$/i.test(value.recipient) &&
        value.recipient.toLowerCase() !== String(value.owner).toLowerCase())) &&
    (value.kind === 'fixed'
      ? value.auctionEndsAt === null &&
        value.startPriceMicros === value.endPriceMicros
      : value.kind === 'dutch' &&
        isoDate(value.auctionEndsAt) &&
        Date.parse(value.auctionEndsAt) > Date.parse(value.startsAt) &&
        Date.parse(value.auctionEndsAt) <=
          Date.parse(value.expiresAt as string))
  );
}

function terms(value: Record<string, unknown>): boolean {
  return (
    money(value.principalMicros) &&
    typeof value.aprBps === 'number' &&
    Number.isSafeInteger(value.aprBps) &&
    value.aprBps >= 100 &&
    value.aprBps <= 4000 &&
    typeof value.durationDays === 'number' &&
    [7, 14, 30].includes(value.durationDays)
  );
}

function loanRequest(value: unknown): value is LoanRequest {
  return (
    fields(value, [
      'id',
      'marketId',
      'tokenId',
      'owner',
      'principalMicros',
      'aprBps',
      'durationDays',
      'status',
      'expiresAt',
      'createdAt',
      'position',
    ]) &&
    order(value) &&
    terms(value)
  );
}

function offer(value: unknown): value is Offer {
  return (
    fields(value, [
      'id',
      'requestId',
      'lender',
      'principalMicros',
      'aprBps',
      'durationDays',
      'status',
      'expiresAt',
      'createdAt',
    ]) &&
    uuid(value.id) &&
    uuid(value.requestId) &&
    address(value.lender) &&
    terms(value) &&
    typeof value.status === 'string' &&
    OFFER_STATUSES.includes(value.status) &&
    isoDate(value.expiresAt) &&
    isoDate(value.createdAt) &&
    Date.parse(value.expiresAt) > Date.parse(value.createdAt)
  );
}

function page<T>(validate: Validator<T>): Validator<Page<T>> {
  return (value): value is Page<T> =>
    fields(value, ['items', 'nextCursor']) &&
    array(value.items, validate, 50) &&
    cursor(value.nextCursor);
}

function session(value: unknown): value is Session {
  return (
    fields(value, ['address', 'chainId', 'csrfToken', 'expiresAt']) &&
    address(value.address) &&
    value.chainId === 999 &&
    typeof value.csrfToken === 'string' &&
    /^[0-9a-f]{64}$/i.test(value.csrfToken) &&
    isoDate(value.expiresAt)
  );
}

function challenge(value: unknown): value is Challenge {
  return (
    fields(value, ['challengeId', 'message', 'expiresAt']) &&
    uuid(value.challengeId) &&
    text(value.message, 8192) &&
    isoDate(value.expiresAt)
  );
}

function status(value: unknown): value is Status {
  return (
    fields(value, [
      'mode',
      'chainId',
      'marketId',
      'settlementEnabled',
      'capabilities',
    ]) &&
    value.mode === 'connected' &&
    value.chainId === 999 &&
    value.marketId === 'kittenswap' &&
    value.settlementEnabled === false &&
    fields(value.capabilities, [
      'walletSignIn',
      'marketplace',
      'lending',
      'settlement',
    ]) &&
    typeof value.capabilities.walletSignIn === 'boolean' &&
    typeof value.capabilities.marketplace === 'boolean' &&
    value.capabilities.lending === false &&
    value.capabilities.settlement === false
  );
}

function lendingStatus(value: unknown): value is LendingStatus {
  return (
    fields(value, [
      'model',
      'state',
      'marketId',
      'asset',
      'chainId',
      'vaultAddress',
      'portfolioAddress',
      'accounting',
      'terms',
      'executionEnabled',
    ]) &&
    value.model === 'pooled-revenue' &&
    value.state === 'not-deployed' &&
    value.marketId === 'kittenswap' &&
    value.asset === 'USDC' &&
    value.chainId === 999 &&
    value.vaultAddress === null &&
    value.portfolioAddress === null &&
    value.accounting === null &&
    value.terms === null &&
    value.executionEnabled === false
  );
}

function market(value: unknown): value is Market {
  return (
    fields(value, [
      'id',
      'name',
      'shortName',
      'chain',
      'tokenSymbol',
      'positionSymbol',
      'accentColor',
      'logoPath',
    ]) &&
    value.id === 'kittenswap' &&
    value.name === 'KittenSwap' &&
    value.shortName === 'Kitten' &&
    value.chain === 'HyperEVM' &&
    value.tokenSymbol === 'KITTEN' &&
    value.positionSymbol === 'veKITTEN' &&
    typeof value.accentColor === 'string' &&
    /^#[0-9a-f]{6}$/i.test(value.accentColor) &&
    typeof value.logoPath === 'string' &&
    /^markets\/[a-z0-9_-]+\.(?:png|svg)$/i.test(value.logoPath)
  );
}

function markets(value: unknown): value is { markets: Market[] } {
  return (
    fields(value, ['markets']) &&
    array(value.markets, market, 1) &&
    value.markets.length === 1
  );
}

function account(value: unknown): value is Account {
  const names = [
    'address',
    'positions',
    'positionsUnavailable',
    'nextPositionsCursor',
    'listings',
    'loanRequests',
    'offers',
    'receivedOffers',
  ];
  if (!(
    (fields(value, names) || fields(value, [...names, 'historyTruncated'])) &&
    (!Object.hasOwn(value, 'historyTruncated') ||
      typeof value.historyTruncated === 'boolean') &&
    address(value.address) &&
    array(value.positions, position, 50) &&
    typeof value.positionsUnavailable === 'boolean' &&
    cursor(value.nextPositionsCursor) &&
    (!value.positionsUnavailable ||
      (value.positions.length === 0 && value.nextPositionsCursor === null)) &&
    array(value.listings, listing, 500) &&
    array(value.loanRequests, loanRequest, 500) &&
    array(value.offers, offer, 500) &&
    array(value.receivedOffers, offer, 500)
  ))
    return false;
  const owner = value.address.toLowerCase();
  return value.positions.every((item) => item.owner.toLowerCase() === owner);
}

function loggedOut(value: unknown): value is { ok: true } {
  return fields(value, ['ok']) && value.ok === true;
}

function responseError(status: number, value: unknown): ApiError {
  if (
    object(value) &&
    object(value.error) &&
    typeof value.error.code === 'string' &&
    typeof value.error.message === 'string'
  ) {
    return new ApiError(
      status,
      value.error.code,
      value.error.message,
      value.error.details,
      typeof value.error.requestId === 'string'
        ? value.error.requestId
        : undefined,
    );
  }
  return new ApiError(
    status,
    'HTTP_ERROR',
    `The service could not complete the request (HTTP ${status}).`,
  );
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetcher: typeof globalThis.fetch;

  constructor(options: ApiClientOptions = {}) {
    this.baseUrl = (
      options.baseUrl ??
      import.meta.env.VITE_API_BASE ??
      ''
    ).replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? 30_000;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new RangeError('API timeout must be a positive number.');
    }
    this.fetcher = options.fetch ?? ((...args) => globalThis.fetch(...args));
  }

  private async request<T>(
    path: string,
    validate: Validator<T>,
    options: RequestOptions = {},
  ): Promise<T> {
    if (options.signal?.aborted) {
      throw new ApiError(0, 'REQUEST_ABORTED', 'The request was cancelled.');
    }
    const controller = new AbortController();
    let timedOut = false;
    const cancel = () => controller.abort();
    options.signal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(() => {
      if (!controller.signal.aborted) {
        timedOut = true;
        controller.abort();
      }
    }, this.timeoutMs);
    const headers = new Headers({ Accept: 'application/json' });
    if (options.body !== undefined)
      headers.set('Content-Type', 'application/json');
    if (options.csrf) headers.set('X-CSRF-Token', options.csrf);
    try {
      const response = await this.fetcher(`${this.baseUrl}/api/v1${path}`, {
        method: options.method ?? 'GET',
        credentials: 'include',
        headers,
        ...(options.body === undefined
          ? {}
          : { body: JSON.stringify(options.body) }),
        signal: controller.signal,
      });
      let value: unknown;
      try {
        value = await response.json();
      } catch (error) {
        if (controller.signal.aborted) throw error;
        if (!response.ok) throw responseError(response.status, undefined);
        throw new ApiError(
          response.status,
          'INVALID_RESPONSE',
          'The service returned an unreadable response.',
        );
      }
      if (controller.signal.aborted) {
        throw new ApiError(0, 'REQUEST_ABORTED', 'The request was cancelled.');
      }
      if (!response.ok) throw responseError(response.status, value);
      if (!validate(value)) {
        throw new ApiError(
          response.status,
          'INVALID_RESPONSE',
          'The service returned invalid application data.',
        );
      }
      return value;
    } catch (error) {
      if (controller.signal.aborted) {
        throw timedOut
          ? new ApiError(
              0,
              'REQUEST_TIMEOUT',
              'The service took too long to respond. Please try again.',
            )
          : new ApiError(0, 'REQUEST_ABORTED', 'The request was cancelled.');
      }
      if (error instanceof ApiError) throw error;
      throw new ApiError(
        0,
        'API_UNAVAILABLE',
        'The application service is unavailable. Please try again.',
      );
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', cancel);
    }
  }

  private mutate<T>(
    path: string,
    method: 'POST' | 'PATCH' | 'DELETE',
    csrf: string,
    validate: Validator<T>,
    body?: unknown,
  ): Promise<T> {
    if (!csrf) {
      return Promise.reject(
        new ApiError(0, 'CSRF_REQUIRED', 'Sign in again to continue.'),
      );
    }
    return this.request<T>(path, validate, { method, body, csrf });
  }

  status(signal?: AbortSignal) {
    return this.request<Status>('/status', status, { signal });
  }

  markets(signal?: AbortSignal) {
    return this.request<{ markets: Market[] }>('/markets', markets, { signal });
  }

  listings(
    market: MarketId,
    cursor?: string | null,
    signal?: AbortSignal,
    filters: {
      seller?: string;
      tokenId?: string;
      minPriceMicros?: string;
      maxPriceMicros?: string;
    } = {},
  ) {
    const query = new URLSearchParams({ market, limit: '24', ...filters });
    if (cursor) query.set('cursor', cursor);
    return this.request<Page<Listing>>(`/listings?${query}`, page(listing), {
      signal,
    });
  }

  lending(signal?: AbortSignal) {
    return this.request<LendingStatus>('/lending', lendingStatus, { signal });
  }

  session(signal?: AbortSignal) {
    return this.request<Session>('/auth/session', session, { signal });
  }

  account(signal?: AbortSignal, positionsCursor?: string | null) {
    const query = new URLSearchParams({ limit: '24' });
    if (positionsCursor) query.set('positionsCursor', positionsCursor);
    return this.request<Account>(`/account?${query}`, account, { signal });
  }

  position(tokenId: string, signal?: AbortSignal) {
    return this.request<Position>(
      `/positions/${encodeURIComponent(tokenId)}`,
      position,
      {
        signal,
      },
    );
  }

  challenge(address: string) {
    return this.request<Challenge>('/auth/challenge', challenge, {
      method: 'POST',
      body: { address, chainId: 999 },
    });
  }

  verify(challengeId: string, signature: string) {
    return this.request<Session>('/auth/verify', session, {
      method: 'POST',
      body: { challengeId, signature },
    });
  }

  logout(csrf: string) {
    return this.mutate<{ ok: true }>('/auth/logout', 'POST', csrf, loggedOut);
  }

  createListing(body: CreateListingInput, csrf: string) {
    return this.mutate<Listing>('/listings', 'POST', csrf, listing, body);
  }

  listing(id: string, signal?: AbortSignal) {
    return this.request<Listing>(
      `/listings/${encodeURIComponent(id)}`,
      listing,
      { signal },
    );
  }

  updateListing(
    id: string,
    body: ListingTermsInput & {
      priceMicros: string;
      expiresAt: string;
      expectedRevision: number;
      idempotencyKey: string;
    },
    csrf: string,
  ) {
    return this.mutate<Listing>(
      `/listings/${encodeURIComponent(id)}`,
      'PATCH',
      csrf,
      listing,
      body,
    );
  }

  cancelListing(id: string, csrf: string) {
    return this.mutate<Listing>(
      `/listings/${encodeURIComponent(id)}`,
      'DELETE',
      csrf,
      listing,
    );
  }

  cancelLoanRequest(id: string, csrf: string) {
    return this.mutate<LoanRequest>(
      `/loan-requests/${encodeURIComponent(id)}`,
      'DELETE',
      csrf,
      loanRequest,
    );
  }

  cancelOffer(id: string, csrf: string) {
    return this.mutate<Offer>(
      `/offers/${encodeURIComponent(id)}`,
      'DELETE',
      csrf,
      offer,
    );
  }
}

export const api = new ApiClient();
