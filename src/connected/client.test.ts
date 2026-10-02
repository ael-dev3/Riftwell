function fixtureAt<T>(items: readonly T[], index: number): T {
  const value = items[index];
  if (value === undefined) throw new Error(`Missing fixture element ${index}`);
  return value;
}
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiClient,
  ApiError,
  type Account,
  type Challenge,
  type Listing,
  type LendingStatus,
  type LoanRequest,
  type Offer,
  type Position,
  type Session,
  type Status,
} from './api';
import { DEFAULT_MARKET } from '../markets';
import {
  connectWallet,
  getWalletProvider,
  signChallenge,
  subscribeWallet,
  walletErrorMessage,
  type WalletProvider,
} from './wallet';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function mockApi(value: unknown = { ok: true }, status = 200) {
  const fetcher = vi
    .fn<typeof globalThis.fetch>()
    .mockImplementation(async () => Response.json(value, { status }));
  return { client: new ApiClient({ fetch: fetcher }), fetcher };
}

const fixtureAddress = '0x' + 'a'.repeat(40);
const createdAt = '2026-10-02T12:00:00.000Z';
const expiresAt = '2026-10-03T12:00:00.000Z';
const positionRecord: Position = {
  id: 'kittenswap-42',
  tokenId: '42',
  marketId: 'kittenswap',
  owner: fixtureAddress,
  lockedAmountRaw: '900719925474099300000000',
  lockedUntil: '2028-10-01T12:00:00.000Z',
  votingPowerRaw: '500000000000000000000000',
  blockNumber: 123456,
  blockHash: '0x' + 'b'.repeat(64),
  observedAt: createdAt,
};
const listingRecord: Listing = {
  kind: 'fixed',
  startPriceMicros: '1000001',
  endPriceMicros: '1000001',
  startsAt: createdAt,
  auctionEndsAt: null,
  recipient: null,
  revision: 1,
  updatedAt: createdAt,
  id: '2c7c2284-d3a3-4785-8c5a-a49aa4f5d6d0',
  marketId: 'kittenswap',
  tokenId: '42',
  owner: fixtureAddress,
  priceMicros: '1000001',
  status: 'active',
  expiresAt,
  createdAt,
  position: positionRecord,
};
const requestRecord: LoanRequest = {
  id: 'c163b77d-937a-45f7-9144-4dde7dff3f4c',
  marketId: 'kittenswap',
  tokenId: '42',
  owner: fixtureAddress,
  principalMicros: '1000001',
  aprBps: 1234,
  durationDays: 7,
  status: 'active',
  expiresAt,
  createdAt,
  position: positionRecord,
};
const offerRecord: Offer = {
  id: '8552ac1b-1d7e-4dc4-8ff0-0b93bfdd1ad3',
  requestId: requestRecord.id,
  lender: fixtureAddress,
  principalMicros: '1000001',
  aprBps: 1234,
  durationDays: 7,
  status: 'proposed',
  expiresAt,
  createdAt,
};
const sessionRecord: Session = {
  address: fixtureAddress,
  chainId: 999,
  csrfToken: 'c'.repeat(64),
  expiresAt,
};
const challengeRecord: Challenge = {
  challengeId: '6b234ff6-34eb-4e27-8c17-fef74be8ff09',
  message: 'Exact server sign-in challenge.\n',
  expiresAt,
};
const statusRecord: Status = {
  mode: 'connected',
  chainId: 999,
  marketId: 'kittenswap',
  settlementEnabled: false,
  capabilities: {
    walletSignIn: true,
    marketplace: true,
    lending: false,
    settlement: false,
  },
};
const lendingRecord: LendingStatus = {
  model: 'pooled-revenue',
  state: 'not-deployed',
  marketId: 'kittenswap',
  asset: 'USDC',
  chainId: 999,
  vaultAddress: null,
  portfolioAddress: null,
  accounting: null,
  terms: null,
  executionEnabled: false,
};
const accountRecord: Account = {
  address: fixtureAddress,
  positions: [positionRecord],
  positionsUnavailable: false,
  nextPositionsCursor: null,
  listings: [listingRecord],
  loanRequests: [requestRecord],
  offers: [offerRecord],
  receivedOffers: [{ ...offerRecord, lender: '0x' + 'd'.repeat(40) }],
  historyTruncated: false,
};

describe('application API transport', () => {
  it('uses the configured origin, opaque encoded cursors and session cookies', async () => {
    const { fetcher } = mockApi({ items: [], nextCursor: 'next' });
    const client = new ApiClient({
      baseUrl: 'https://application.example/',
      fetch: fetcher,
    });
    expect(await client.listings('kittenswap', 'a&market=other')).toEqual({
      items: [],
      nextCursor: 'next',
    });
    const [url, request] = fixtureAt(fetcher.mock.calls, 0);
    const parsed = new URL(String(url));
    expect(parsed.origin).toBe('https://application.example');
    expect(parsed.pathname).toBe('/api/v1/listings');
    expect(parsed.searchParams.get('market')).toBe('kittenswap');
    expect(parsed.searchParams.get('limit')).toBe('24');
    expect(parsed.searchParams.get('cursor')).toBe('a&market=other');
    expect(request?.credentials).toBe('include');
    expect(new Headers(request?.headers).get('Accept')).toBe(
      'application/json',
    );
  });

  it('preserves server error codes, details, messages and request IDs', async () => {
    const error = {
      code: 'SMART_CONTRACTS_DISABLED',
      message: 'Settlement has not been enabled.',
      details: { settlementEnabled: false },
      requestId: 'request-1',
    };
    const { client } = mockApi({ error }, 503);
    await expect(client.status()).rejects.toMatchObject({
      name: 'ApiError',
      status: 503,
      ...error,
    });
  });

  it('does not display a proxy HTML error or convert it into successful data', async () => {
    const fetcher = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response('<html>upstream secret</html>', { status: 502 }),
      );
    const client = new ApiClient({ fetch: fetcher });
    try {
      await client.status();
      throw new Error('Expected API rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ status: 502, code: 'HTTP_ERROR' });
      expect((error as Error).message).not.toContain('upstream secret');
    }
  });

  it('accepts coherent Dutch terms and rejects impossible floor, decay and reservation data', async () => {
    const dutch = {
      ...listingRecord,
      kind: 'dutch',
      startPriceMicros: '900000000',
      priceMicros: '200000000',
      endPriceMicros: '100000000',
      auctionEndsAt: '2026-10-02T13:00:00.000Z',
    };
    await expect(
      mockApi(dutch).client.listing(listingRecord.id),
    ).resolves.toEqual(dutch);
    for (const value of [
      { ...dutch, endPriceMicros: '300000000' },
      { ...dutch, auctionEndsAt: createdAt },
      { ...dutch, recipient: listingRecord.owner },
      { ...dutch, recipient: '0x' + '0'.repeat(40) },
    ])
      await expect(
        mockApi(value).client.listing(listingRecord.id),
      ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('requests fresh listing details and submits revision-bound edits with CSRF', async () => {
    const { client, fetcher } = mockApi(listingRecord);
    await client.listing('listing/1');
    const body = {
      priceMicros: '2000001',
      expiresAt: '2026-10-03T12:00:00.000Z',
      expectedRevision: 1,
      idempotencyKey: '88304e45-4b1a-4131-a59b-e5b2d8a33074',
    };
    await client.updateListing('listing/1', body, 'csrf-token');
    expect(fixtureAt(fetcher.mock.calls, 0)[0]).toBe(
      '/api/v1/listings/listing%2F1',
    );
    expect(fixtureAt(fetcher.mock.calls, 1)[1]).toMatchObject({
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    expect(
      new Headers(fixtureAt(fetcher.mock.calls, 1)[1]?.headers).get(
        'X-CSRF-Token',
      ),
    ).toBe('csrf-token');
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid listing revision %s',
    async (revision) => {
      await expect(
        mockApi({ ...listingRecord, revision }).client.listing(
          listingRecord.id,
        ),
      ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    },
  );

  it('binds listing filters to the paginated query without numeric conversion', async () => {
    const { client, fetcher } = mockApi({ items: [], nextCursor: null });
    await client.listings('kittenswap', 'opaque', undefined, {
      seller: positionRecord.owner,
      tokenId: '42',
      minPriceMicros: '1000001',
      maxPriceMicros: '1000000000000',
    });
    const url = new URL(
      String(fixtureAt(fetcher.mock.calls, 0)[0]),
      'http://localhost',
    );
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      cursor: 'opaque',
      seller: positionRecord.owner,
      tokenId: '42',
      minPriceMicros: '1000001',
      maxPriceMicros: '1000000000000',
    });
  });

  it('sends the raw money strings and CSRF token on every authenticated mutation', async () => {
    const { client, fetcher } = mockApi();
    for (const record of [
      listingRecord,
      { ...listingRecord, status: 'cancelled' },
      { ...requestRecord, status: 'cancelled' },
      { ...offerRecord, status: 'cancelled' },
      { ok: true },
    ])
      fetcher.mockResolvedValueOnce(Response.json(record));
    const common = {
      expiresAt: '2026-10-03T12:00:00.000Z',
      idempotencyKey: '88304e45-4b1a-4131-a59b-e5b2d8a33074',
    };
    const listing = {
      ...common,
      tokenId: '42',
      priceMicros: '1000001',
    };
    await client.createListing(listing, 'csrf-token');
    await client.cancelListing('listing/1', 'csrf-token');
    await client.cancelLoanRequest('request/1', 'csrf-token');
    await client.cancelOffer('offer/1', 'csrf-token');
    await client.logout('csrf-token');
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      '/api/v1/listings',
      '/api/v1/listings/listing%2F1',
      '/api/v1/loan-requests/request%2F1',
      '/api/v1/offers/offer%2F1',
      '/api/v1/auth/logout',
    ]);
    for (const [, init] of fetcher.mock.calls) {
      expect(init?.credentials).toBe('include');
      expect(new Headers(init?.headers).get('X-CSRF-Token')).toBe('csrf-token');
      expect(['POST', 'DELETE']).toContain(init?.method);
    }
    expect(
      JSON.parse(String(fixtureAt(fetcher.mock.calls, 0)[1]?.body)),
    ).toEqual(listing);
    expect(
      new Headers(fixtureAt(fetcher.mock.calls, 0)[1]?.headers).get(
        'Content-Type',
      ),
    ).toBe('application/json');
    await expect(client.cancelListing('listing-1', '')).rejects.toMatchObject({
      code: 'CSRF_REQUIRED',
    });
    expect(fetcher).toHaveBeenCalledTimes(5);
  });

  it('uses chain 999 in authentication and sends the exact returned signature', async () => {
    const { client, fetcher } = mockApi();
    fetcher.mockResolvedValueOnce(Response.json(challengeRecord));
    fetcher.mockResolvedValueOnce(Response.json(sessionRecord));
    await client.challenge('0x' + 'a'.repeat(40));
    await client.verify('challenge-1', '0xdeadbeef');
    expect(fixtureAt(fetcher.mock.calls, 0)[0]).toBe('/api/v1/auth/challenge');
    expect(
      JSON.parse(String(fixtureAt(fetcher.mock.calls, 0)[1]?.body)),
    ).toEqual({
      address: '0x' + 'a'.repeat(40),
      chainId: 999,
    });
    expect(fixtureAt(fetcher.mock.calls, 1)[0]).toBe('/api/v1/auth/verify');
    expect(
      JSON.parse(String(fixtureAt(fetcher.mock.calls, 1)[1]?.body)),
    ).toEqual({
      challengeId: 'challenge-1',
      signature: '0xdeadbeef',
    });
    expect(
      new Headers(fixtureAt(fetcher.mock.calls, 0)[1]?.headers).has(
        'X-CSRF-Token',
      ),
    ).toBe(false);
  });

  it('aborts timed-out reads and distinguishes them from user cancellation', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof globalThis.fetch>().mockImplementation(
      async (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          );
        }),
    );
    const client = new ApiClient({ fetch: fetcher, timeoutMs: 50 });
    const timeout = expect(client.status()).rejects.toMatchObject({
      code: 'REQUEST_TIMEOUT',
      status: 0,
    });
    await vi.advanceTimersByTimeAsync(50);
    await timeout;
    expect(fixtureAt(fetcher.mock.calls, 0)[1]?.signal?.aborted).toBe(true);
    const controller = new AbortController();
    const cancelled = expect(
      client.status(controller.signal),
    ).rejects.toMatchObject({
      code: 'REQUEST_ABORTED',
      status: 0,
    });
    controller.abort();
    await cancelled;
    await expect(client.status(controller.signal)).rejects.toMatchObject({
      code: 'REQUEST_ABORTED',
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports network failures without falling back to preview records', async () => {
    const fetcher = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(
      new ApiClient({ fetch: fetcher }).lending(),
    ).rejects.toMatchObject({ code: 'API_UNAVAILABLE', status: 0 });
  });
});

describe('successful API response validation', () => {
  it('accepts historical account activity when current positions are unavailable', async () => {
    const unavailable = {
      ...accountRecord,
      positions: [],
      positionsUnavailable: true,
      nextPositionsCursor: null,
    };
    expect(await mockApi(unavailable).client.account()).toEqual(unavailable);
  });

  it('accepts valid records on every read endpoint without converting raw unit strings', async () => {
    const { client, fetcher } = mockApi();
    const responses = [
      statusRecord,
      { markets: [DEFAULT_MARKET] },
      { items: [listingRecord], nextCursor: 'opaque-next' },
      lendingRecord,
      sessionRecord,
      accountRecord,
      positionRecord,
    ];
    for (const response of responses)
      fetcher.mockResolvedValueOnce(Response.json(response));
    expect(await client.status()).toEqual(statusRecord);
    expect(await client.markets()).toEqual({ markets: [DEFAULT_MARKET] });
    expect(await client.listings('kittenswap')).toEqual(responses[2]);
    expect(await client.lending()).toEqual(lendingRecord);
    expect(await client.session()).toEqual(sessionRecord);
    expect(await client.account()).toEqual(accountRecord);
    expect(await client.position('42')).toEqual(positionRecord);
  });

  it('allows zero balances, the uint256 limit, and historical UTC dates', async () => {
    const tokenId = ((1n << 256n) - 1n).toString();
    const unlocked = {
      ...positionRecord,
      id: `kittenswap-${tokenId}`,
      tokenId,
      lockedAmountRaw: '0',
      votingPowerRaw: '0',
      lockedUntil: '1970-01-01T00:00:00Z',
    };
    expect(await mockApi(unlocked).client.position(tokenId)).toEqual(unlocked);
    const maximum = {
      ...listingRecord,
      priceMicros: '1000000000000',
      startPriceMicros: '1000000000000',
      endPriceMicros: '1000000000000',
    };
    expect(
      await mockApi(maximum).client.createListing(
        {
          tokenId: maximum.tokenId,
          priceMicros: maximum.priceMicros,
          expiresAt: maximum.expiresAt,
          idempotencyKey: maximum.id,
        },
        'csrf',
      ),
    ).toEqual(maximum);
  });

  it('accepts only an explicitly undeployed pooled model and rejects invented live balances or enabled capabilities', async () => {
    expect(await mockApi(lendingRecord).client.lending()).toEqual(
      lendingRecord,
    );
    for (const altered of [
      { ...lendingRecord, accounting: { totalAssetsMicros: '0' } },
      { ...lendingRecord, vaultAddress: fixtureAddress },
      { ...lendingRecord, terms: { originationBps: 50 } },
      { ...lendingRecord, executionEnabled: true },
      { ...lendingRecord, state: 'active' },
      { ...lendingRecord, model: 'peer-to-peer' },
      { ...lendingRecord, asset: 'USDT' },
      { ...lendingRecord, chainId: 1 },
    ])
      await expect(mockApi(altered).client.lending()).rejects.toMatchObject({
        code: 'INVALID_RESPONSE',
      });
    await expect(
      mockApi({
        ...statusRecord,
        capabilities: { ...statusRecord.capabilities, lending: true },
      }).client.status(),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  const malformed: {
    name: string;
    response: unknown;
    read: (client: ApiClient) => Promise<unknown>;
  }[] = [
    {
      name: 'missing page collection',
      response: {},
      read: (client) => client.listings('kittenswap'),
    },
    {
      name: 'null page collection',
      response: { items: null, nextCursor: null },
      read: (client) => client.listings('kittenswap'),
    },
    {
      name: 'oversized page',
      response: { items: Array(51).fill(listingRecord), nextCursor: null },
      read: (client) => client.listings('kittenswap'),
    },
    {
      name: 'oversized cursor',
      response: { items: [], nextCursor: 'a'.repeat(513) },
      read: (client) => client.listings('kittenswap'),
    },
    {
      name: 'numeric money',
      response: { ...listingRecord, priceMicros: 1000001 },
      read: (client) =>
        client.createListing(
          {
            tokenId: '42',
            priceMicros: '1000001',
            expiresAt,
            idempotencyKey: listingRecord.id,
          },
          'csrf',
        ),
    },
    {
      name: 'fractional money',
      response: {
        items: [{ ...listingRecord, priceMicros: '1000000.1' }],
        nextCursor: null,
      },
      read: (client) => client.listings('kittenswap'),
    },
    {
      name: 'money below minimum',
      response: {
        items: [{ ...listingRecord, priceMicros: '999999' }],
        nextCursor: null,
      },
      read: (client) => client.listings('kittenswap'),
    },
    {
      name: 'money above maximum',
      response: { ...offerRecord, principalMicros: '1000000000001' },
      read: (client) => client.cancelOffer(offerRecord.id, 'csrf'),
    },
    {
      name: 'noncanonical token ID',
      response: { ...positionRecord, tokenId: '042', id: 'kittenswap-042' },
      read: (client) => client.position('42'),
    },
    {
      name: 'overflowed token ID',
      response: {
        ...positionRecord,
        tokenId: (1n << 256n).toString(),
        id: `kittenswap-${1n << 256n}`,
      },
      read: (client) => client.position('42'),
    },
    {
      name: 'negative token balance',
      response: { ...positionRecord, lockedAmountRaw: '-1' },
      read: (client) => client.position('42'),
    },
    {
      name: 'overflowed voting power',
      response: { ...positionRecord, votingPowerRaw: (1n << 256n).toString() },
      read: (client) => client.position('42'),
    },
    {
      name: 'missing nested position',
      response: {
        items: [{ ...listingRecord, position: null }],
        nextCursor: null,
      },
      read: (client) => client.listings('kittenswap'),
    },
    {
      name: 'wrong nested token',
      response: {
        items: [
          {
            ...listingRecord,
            position: { ...positionRecord, tokenId: '43', id: 'kittenswap-43' },
          },
        ],
        nextCursor: null,
      },
      read: (client) => client.listings('kittenswap'),
    },
    {
      name: 'different active owner',
      response: {
        items: [
          {
            ...listingRecord,
            position: { ...positionRecord, owner: '0x' + 'd'.repeat(40) },
          },
        ],
        nextCursor: null,
      },
      read: (client) => client.listings('kittenswap'),
    },
    {
      name: 'unsafe block number',
      response: { ...positionRecord, blockNumber: Number.MAX_SAFE_INTEGER + 1 },
      read: (client) => client.position('42'),
    },
    {
      name: 'invalid block hash',
      response: { ...positionRecord, blockHash: '0x1234' },
      read: (client) => client.position('42'),
    },
    {
      name: 'invalid address',
      response: { ...positionRecord, owner: '0xabc' },
      read: (client) => client.position('42'),
    },
    {
      name: 'impossible ISO date',
      response: { ...positionRecord, lockedUntil: '2026-02-31T12:00:00Z' },
      read: (client) => client.position('42'),
    },
    {
      name: 'offset date',
      response: { ...positionRecord, observedAt: '2026-10-02T12:00:00+00:00' },
      read: (client) => client.position('42'),
    },
    {
      name: 'unknown order status',
      response: {
        ...accountRecord,
        loanRequests: [{ ...requestRecord, status: 'funded' }],
      },
      read: (client) => client.account(),
    },
    {
      name: 'invalid APR',
      response: { ...requestRecord, aprBps: 4001 },
      read: (client) => client.cancelLoanRequest(requestRecord.id, 'csrf'),
    },
    {
      name: 'unsupported duration',
      response: { ...offerRecord, durationDays: 365 },
      read: (client) => client.cancelOffer(offerRecord.id, 'csrf'),
    },
    {
      name: 'non-UUID record ID',
      response: { ...listingRecord, id: 'fake-id' },
      read: (client) => client.cancelListing(listingRecord.id, 'csrf'),
    },
    {
      name: 'wrong session chain',
      response: { ...sessionRecord, chainId: 1 },
      read: (client) => client.session(),
    },
    {
      name: 'invalid CSRF token',
      response: { ...sessionRecord, csrfToken: '' },
      read: (client) =>
        client.verify(challengeRecord.challengeId, '0xdeadbeef'),
    },
    {
      name: 'missing challenge message',
      response: { ...challengeRecord, message: '' },
      read: (client) => client.challenge(fixtureAddress),
    },
    {
      name: 'oversized challenge message',
      response: { ...challengeRecord, message: 'a'.repeat(8193) },
      read: (client) => client.challenge(fixtureAddress),
    },
    {
      name: 'enabled settlement capability',
      response: { ...statusRecord, settlementEnabled: true },
      read: (client) => client.status(),
    },
    {
      name: 'string capability flag',
      response: {
        ...statusRecord,
        capabilities: { ...statusRecord.capabilities, walletSignIn: 'true' },
      },
      read: (client) => client.status(),
    },
    {
      name: 'unsupported market',
      response: { markets: [{ ...DEFAULT_MARKET, id: 'unverified' }] },
      read: (client) => client.markets(),
    },
    {
      name: 'duplicate markets',
      response: { markets: [DEFAULT_MARKET, DEFAULT_MARKET] },
      read: (client) => client.markets(),
    },
    {
      name: 'invalid accent',
      response: {
        markets: [{ ...DEFAULT_MARKET, accentColor: 'url(remote)' }],
      },
      read: (client) => client.markets(),
    },
    {
      name: 'missing account pagination cursor',
      response: { ...accountRecord, nextPositionsCursor: undefined },
      read: (client) => client.account(),
    },
    {
      name: 'missing position availability flag',
      response: { ...accountRecord, positionsUnavailable: undefined },
      read: (client) => client.account(),
    },
    {
      name: 'unavailable positions with nonempty ownership',
      response: { ...accountRecord, positionsUnavailable: true },
      read: (client) => client.account(),
    },
    {
      name: 'unavailable positions with pagination cursor',
      response: {
        ...accountRecord,
        positions: [],
        positionsUnavailable: true,
        nextPositionsCursor: 'opaque-next',
      },
      read: (client) => client.account(),
    },
    {
      name: 'oversized account history',
      response: { ...accountRecord, offers: Array(501).fill(offerRecord) },
      read: (client) => client.account(),
    },
    {
      name: 'missing received offers',
      response: { ...accountRecord, receivedOffers: undefined },
      read: (client) => client.account(),
    },
    {
      name: 'oversized received offers',
      response: {
        ...accountRecord,
        receivedOffers: Array(501).fill(offerRecord),
      },
      read: (client) => client.account(),
    },
    {
      name: 'invalid received offer terms',
      response: {
        ...accountRecord,
        receivedOffers: [{ ...offerRecord, principalMicros: '0' }],
      },
      read: (client) => client.account(),
    },
    {
      name: 'non-boolean account history flag',
      response: { ...accountRecord, historyTruncated: 'false' },
      read: (client) => client.account(),
    },
    {
      name: 'different account position owner',
      response: { ...accountRecord, address: '0x' + 'd'.repeat(40) },
      read: (client) => client.account(),
    },
    {
      name: 'false logout receipt',
      response: { ok: false },
      read: (client) => client.logout('csrf'),
    },
  ];

  it.each(malformed)(
    'rejects $name as INVALID_RESPONSE',
    async ({ response, read }) => {
      await expect(read(mockApi(response).client)).rejects.toMatchObject({
        name: 'ApiError',
        code: 'INVALID_RESPONSE',
        status: 200,
      });
    },
  );
});

describe('wallet sign-in boundary', () => {
  const address = '0x' + 'a'.repeat(40);

  function mockWallet(initialChain = '0x3e7') {
    let chain = initialChain;
    const request = vi
      .fn<WalletProvider['request']>()
      .mockImplementation(async (args) => {
        switch (args.method) {
          case 'eth_requestAccounts':
          case 'eth_accounts':
            return [address];
          case 'eth_chainId':
            return chain;
          case 'wallet_switchEthereumChain':
            chain = '0x3e7';
            return null;
          case 'personal_sign':
            return '0x' + 'b'.repeat(130);
          default:
            throw new Error(`Unexpected wallet method: ${args.method}`);
        }
      });
    return { provider: { request } satisfies WalletProvider, request };
  }

  it('requests chain 999 and signs the exact UTF-8 challenge without a transaction', async () => {
    const { provider, request } = mockWallet('0x1');
    expect(await connectWallet(provider)).toBe(address);
    expect(await signChallenge(provider, address, ' Sign π\n🐈 ')).toBe(
      '0x' + 'b'.repeat(130),
    );
    expect(
      request.mock.calls.find(
        ([args]) => args.method === 'wallet_switchEthereumChain',
      ),
    ).toEqual([
      { method: 'wallet_switchEthereumChain', params: [{ chainId: '0x3e7' }] },
    ]);
    expect(
      request.mock.calls.find(([args]) => args.method === 'personal_sign'),
    ).toEqual([
      {
        method: 'personal_sign',
        params: ['0x205369676e20cf800af09f908820', address],
      },
    ]);
    const allowed = new Set([
      'eth_requestAccounts',
      'eth_accounts',
      'eth_chainId',
      'wallet_switchEthereumChain',
      'personal_sign',
    ]);
    for (const [args] of request.mock.calls)
      expect(allowed.has(args.method)).toBe(true);
  });

  it('rejects signing after an account or chain change before requesting a signature', async () => {
    const { provider, request } = mockWallet();
    await expect(
      signChallenge(provider, '0x' + 'c'.repeat(40), 'Challenge'),
    ).rejects.toMatchObject({ code: 'ACCOUNT_CHANGED' });
    const otherChain = mockWallet('0x1');
    await expect(
      signChallenge(otherChain.provider, address, 'Challenge'),
    ).rejects.toMatchObject({ code: 'WRONG_CHAIN' });
    expect(
      request.mock.calls.some(([args]) => args.method === 'personal_sign'),
    ).toBe(false);
    expect(
      otherChain.request.mock.calls.some(
        ([args]) => args.method === 'personal_sign',
      ),
    ).toBe(false);
  });

  it('detects missing wallets and gives useful rejection and missing-chain messages', async () => {
    expect(getWalletProvider()).toBeNull();
    vi.stubGlobal('window', { ethereum: {} });
    expect(getWalletProvider()).toBeNull();
    const { provider } = mockWallet();
    vi.stubGlobal('window', { ethereum: provider });
    expect(getWalletProvider()).toBe(provider);
    const rejected = { request: vi.fn().mockRejectedValue({ code: 4001 }) };
    await expect(connectWallet(rejected)).rejects.toEqual({ code: 4001 });
    expect(walletErrorMessage({ code: 4001 })).toContain('cancelled');
    expect(walletErrorMessage({ code: 4902 })).toContain('chain 999');
    expect(
      walletErrorMessage({ message: 'Untrusted provider text' }),
    ).not.toContain('Untrusted provider text');
  });

  it('subscribes to account, chain and disconnect events and removes all listeners', () => {
    const listeners = new Map<string, (...args: unknown[]) => void>();
    const provider: WalletProvider = {
      request: vi.fn(),
      on: (event, listener) => listeners.set(event, listener),
      removeListener: (event, listener) => {
        expect(listeners.get(event)).toBe(listener);
        listeners.delete(event);
      },
    };
    const changed = vi.fn();
    const stop = subscribeWallet(provider, changed);
    listeners.get('accountsChanged')?.([
      address.toUpperCase().replace('0X', '0x'),
    ]);
    listeners.get('chainChanged')?.('0x1');
    listeners.get('disconnect')?.();
    expect(changed.mock.calls.map(([change]) => change)).toEqual([
      { type: 'accountsChanged', accounts: [address] },
      { type: 'chainChanged', chainId: '0x1' },
      { type: 'disconnect' },
    ]);
    stop();
    expect(listeners.size).toBe(0);
  });
});
