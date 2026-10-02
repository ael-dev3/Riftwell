import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient, type Session, type Status } from './api';

const origin = 'https://riftwell-api.example.test';
const tokenA = 'a'.repeat(64);
const tokenB = 'b'.repeat(64);
const session: Session = {
  address: '0x' + 'a'.repeat(40),
  chainId: 999,
  csrfToken: 'c'.repeat(64),
  expiresAt: '2026-10-03T12:00:00.000Z',
};
const status: Status = {
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

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-02T12:00:00.000Z'));
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((fulfill) => {
    resolve = fulfill;
  });
  return { promise, resolve };
}

function bearerClient() {
  const fetcher = vi
    .fn<typeof globalThis.fetch>()
    .mockImplementation(async () => Response.json(status));
  const client = new ApiClient({
    baseUrl: origin,
    sessionTransport: 'bearer',
    fetch: fetcher,
  });
  return { client, fetcher };
}

async function signIn(
  setup: ReturnType<typeof bearerClient>,
  accessToken = tokenA,
  expiresAt = session.expiresAt,
) {
  setup.fetcher.mockResolvedValueOnce(
    Response.json({ ...session, expiresAt, accessToken }),
  );
  return setup.client.verify('challenge-id', 'signed-challenge');
}

function lastRequest(fetcher: ReturnType<typeof bearerClient>['fetcher']) {
  const call = fetcher.mock.calls.at(-1);
  if (!call) throw new Error('Expected a service request');
  return {
    url: String(call[0]),
    init: call[1],
    headers: new Headers(call[1]?.headers),
  };
}

describe('bearer session boundary', () => {
  it('keeps a validated token inside one client and returns only the normal Session fields', async () => {
    const persistentAccess = vi.fn(() => {
      throw new Error('Persistent session storage must not be used');
    });
    const storage = {
      getItem: persistentAccess,
      setItem: persistentAccess,
      removeItem: persistentAccess,
    };
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('sessionStorage', storage);
    vi.stubGlobal('indexedDB', { open: persistentAccess });
    vi.stubGlobal(
      'document',
      Object.defineProperty({}, 'cookie', {
        get: persistentAccess,
        set: persistentAccess,
      }),
    );
    const setup = bearerClient();
    expect(await signIn(setup)).toEqual(session);
    expect(JSON.stringify(setup.client)).not.toContain(tokenA);
    await setup.client.status();
    expect(lastRequest(setup.fetcher).headers.get('Authorization')).toBe(
      `Bearer ${tokenA}`,
    );
    const reloadedClient = new ApiClient({
      baseUrl: origin,
      sessionTransport: 'bearer',
      fetch: setup.fetcher,
    });
    expect(await reloadedClient.status()).toEqual(status);
    expect(lastRequest(setup.fetcher).headers.has('Authorization')).toBe(false);
    expect(persistentAccess).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'missing token', response: session },
    {
      name: 'uppercase token',
      response: { ...session, accessToken: 'A'.repeat(64) },
    },
    {
      name: 'short token',
      response: { ...session, accessToken: 'a'.repeat(63) },
    },
    {
      name: 'long token',
      response: { ...session, accessToken: 'a'.repeat(65) },
    },
    {
      name: 'nonhex token',
      response: { ...session, accessToken: 'z'.repeat(64) },
    },
    { name: 'token array', response: { ...session, accessToken: [tokenA] } },
    { name: 'null token', response: { ...session, accessToken: null } },
    {
      name: 'extra fields',
      response: { ...session, accessToken: tokenA, unexpected: true },
    },
    {
      name: 'invalid address',
      response: { ...session, address: 'not-an-address', accessToken: tokenA },
    },
    {
      name: 'wrong chain',
      response: { ...session, chainId: 1, accessToken: tokenA },
    },
    {
      name: 'invalid CSRF',
      response: { ...session, csrfToken: 'invalid', accessToken: tokenA },
    },
    {
      name: 'expired session',
      response: {
        ...session,
        expiresAt: '2026-10-02T11:59:59.000Z',
        accessToken: tokenA,
      },
    },
  ])(
    'rejects a verification response with $name without retaining a token',
    async ({ response }) => {
      const setup = bearerClient();
      setup.fetcher.mockResolvedValueOnce(Response.json(response));
      await expect(
        setup.client.verify('challenge-id', 'signature'),
      ).rejects.toMatchObject({
        code: 'INVALID_RESPONSE',
        status: 200,
      });
      await setup.client.status();
      expect(lastRequest(setup.fetcher).headers.has('Authorization')).toBe(
        false,
      );
    },
  );

  it('accepts the four-field session read and refuses token acquisition from that route', async () => {
    const setup = bearerClient();
    await signIn(setup);
    setup.fetcher.mockResolvedValueOnce(Response.json(session));
    expect(await setup.client.session()).toEqual(session);
    setup.fetcher.mockResolvedValueOnce(
      Response.json({ ...session, accessToken: tokenB }),
    );
    await expect(setup.client.session()).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
    await setup.client.status();
    expect(lastRequest(setup.fetcher).headers.get('Authorization')).toBe(
      `Bearer ${tokenA}`,
    );
  });

  it('omits cookies, rejects redirects and binds bearer/CSRF headers to the configured origin', async () => {
    const setup = bearerClient();
    await signIn(setup);
    setup.fetcher.mockResolvedValueOnce(
      Response.json(
        { error: { code: 'NOT_FOUND', message: 'No listing.' } },
        { status: 404 },
      ),
    );
    await expect(
      setup.client.cancelListing('listing/1', session.csrfToken),
    ).rejects.toMatchObject({ status: 404 });
    const request = lastRequest(setup.fetcher);
    expect(request.url).toBe(`${origin}/api/v1/listings/listing%2F1`);
    expect(request.init).toMatchObject({
      credentials: 'omit',
      redirect: 'error',
      method: 'DELETE',
    });
    expect(request.headers.get('Authorization')).toBe(`Bearer ${tokenA}`);
    expect(request.headers.get('X-CSRF-Token')).toBe(session.csrfToken);
    for (const [, init] of setup.fetcher.mock.calls)
      expect(init).toMatchObject({ credentials: 'omit', redirect: 'error' });
    setup.fetcher.mockResolvedValueOnce(
      Response.redirect('https://untrusted.example.test', 302),
    );
    await expect(setup.client.status()).rejects.toMatchObject({
      code: 'HTTP_ERROR',
      status: 302,
    });
    expect(setup.fetcher).toHaveBeenCalledTimes(3);
  });

  it('clears immediately on logout while revoking the previous token, even if the server fails', async () => {
    const setup = bearerClient();
    await signIn(setup);
    const logoutReply = deferred<Response>();
    setup.fetcher.mockReturnValueOnce(logoutReply.promise);
    const logout = setup.client.logout(session.csrfToken);
    const logoutRequest = lastRequest(setup.fetcher);
    expect(logoutRequest.headers.get('Authorization')).toBe(`Bearer ${tokenA}`);
    expect(logoutRequest.headers.get('X-CSRF-Token')).toBe(session.csrfToken);
    await setup.client.status();
    expect(lastRequest(setup.fetcher).headers.has('Authorization')).toBe(false);
    const rejection = expect(logout).rejects.toMatchObject({ status: 503 });
    logoutReply.resolve(
      Response.json(
        { error: { code: 'UNAVAILABLE', message: 'Try again.' } },
        { status: 503 },
      ),
    );
    await rejection;
    await setup.client.status();
    expect(lastRequest(setup.fetcher).headers.has('Authorization')).toBe(false);
  });

  it('does not reinstall a token when wallet invalidation cancels pending verification', async () => {
    const setup = bearerClient();
    const reply = deferred<Response>();
    setup.fetcher.mockReturnValueOnce(reply.promise);
    const verifying = setup.client.verify('challenge-id', 'signature');
    setup.client.clearSession();
    const rejection = expect(verifying).rejects.toMatchObject({
      code: 'AUTH_CHANGED',
    });
    reply.resolve(Response.json({ ...session, accessToken: tokenA }));
    await rejection;
    await setup.client.status();
    expect(lastRequest(setup.fetcher).headers.has('Authorization')).toBe(false);
  });

  it('clears an established session on wallet invalidation without blocking public reads', async () => {
    const setup = bearerClient();
    await signIn(setup);
    setup.client.clearSession();
    expect(await setup.client.status()).toEqual(status);
    expect(lastRequest(setup.fetcher).headers.has('Authorization')).toBe(false);
  });

  it('lets the newer verification win when two sign-in replies arrive in reverse order', async () => {
    const setup = bearerClient();
    const oldReply = deferred<Response>();
    const newReply = deferred<Response>();
    setup.fetcher
      .mockReturnValueOnce(oldReply.promise)
      .mockReturnValueOnce(newReply.promise);
    const oldVerification = setup.client.verify(
      'old-challenge',
      'old-signature',
    );
    const newVerification = setup.client.verify(
      'new-challenge',
      'new-signature',
    );
    newReply.resolve(Response.json({ ...session, accessToken: tokenB }));
    expect(await newVerification).toEqual(session);
    const rejection = expect(oldVerification).rejects.toMatchObject({
      code: 'AUTH_CHANGED',
    });
    oldReply.resolve(Response.json({ ...session, accessToken: tokenA }));
    await rejection;
    await setup.client.status();
    expect(lastRequest(setup.fetcher).headers.get('Authorization')).toBe(
      `Bearer ${tokenB}`,
    );
  });

  it('clears the current session after its 401 but does not apply that error to a later login', async () => {
    const setup = bearerClient();
    await signIn(setup);
    setup.fetcher.mockResolvedValueOnce(
      Response.json(
        { error: { code: 'AUTH_REQUIRED', message: 'Sign in.' } },
        { status: 401 },
      ),
    );
    const failure = await setup.client
      .session()
      .catch((error: unknown) => error);
    expect(setup.client.isCurrentSessionError(failure)).toBe(true);
    await setup.client.status();
    expect(lastRequest(setup.fetcher).headers.has('Authorization')).toBe(false);
    await signIn(setup, tokenB);
    expect(setup.client.isCurrentSessionError(failure)).toBe(false);
    await setup.client.status();
    expect(lastRequest(setup.fetcher).headers.get('Authorization')).toBe(
      `Bearer ${tokenB}`,
    );
  });

  it.each([false, true])(
    'ignores a stale 401 from a request that had an old token: %s',
    async (hadOldToken) => {
      const setup = bearerClient();
      if (hadOldToken) await signIn(setup);
      const oldReply = deferred<Response>();
      setup.fetcher.mockReturnValueOnce(oldReply.promise);
      const oldRequest = setup.client.session();
      await signIn(setup, tokenB);
      oldReply.resolve(
        Response.json(
          { error: { code: 'AUTH_REQUIRED', message: 'Sign in.' } },
          { status: 401 },
        ),
      );
      const failure = await oldRequest.catch((error: unknown) => error);
      expect(setup.client.isCurrentSessionError(failure)).toBe(false);
      await setup.client.status();
      expect(lastRequest(setup.fetcher).headers.get('Authorization')).toBe(
        `Bearer ${tokenB}`,
      );
    },
  );

  it('does not clear a new login when an older logout finishes with a 401', async () => {
    const setup = bearerClient();
    await signIn(setup);
    const oldReply = deferred<Response>();
    setup.fetcher.mockReturnValueOnce(oldReply.promise);
    const oldLogout = setup.client.logout(session.csrfToken);
    await signIn(setup, tokenB);
    oldReply.resolve(
      Response.json(
        { error: { code: 'AUTH_REQUIRED', message: 'Already signed out.' } },
        { status: 401 },
      ),
    );
    const failure = await oldLogout.catch((error: unknown) => error);
    expect(setup.client.isCurrentSessionError(failure)).toBe(false);
    await setup.client.status();
    expect(lastRequest(setup.fetcher).headers.get('Authorization')).toBe(
      `Bearer ${tokenB}`,
    );
  });

  it('expires tokens and prevents an old expiry timer from signing out a newer session', async () => {
    const setup = bearerClient();
    await signIn(setup, tokenA, '2026-10-02T12:00:00.500Z');
    await vi.advanceTimersByTimeAsync(200);
    await signIn(setup, tokenB, '2026-10-02T12:00:02.000Z');
    await vi.advanceTimersByTimeAsync(500);
    await setup.client.status();
    expect(lastRequest(setup.fetcher).headers.get('Authorization')).toBe(
      `Bearer ${tokenB}`,
    );
    await vi.advanceTimersByTimeAsync(1300);
    expect(await setup.client.status()).toEqual(status);
    expect(lastRequest(setup.fetcher).headers.has('Authorization')).toBe(false);
  });
});

describe('bearer API origin configuration', () => {
  it.each([
    '',
    '/api',
    '//untrusted.example.test',
    'http://api.example.test',
    'https://api.example.test/path',
    'https://api.example.test?query=secret',
    'https://api.example.test#fragment',
    'https://user:password@api.example.test',
    'https://trusted.example.test@untrusted.example.test',
    'file:///private/api',
    'javascript:fetch("secret")',
  ])(
    'rejects unsafe bearer API origin %s before making a request',
    (baseUrl) => {
      const fetcher = vi.fn<typeof globalThis.fetch>();
      expect(
        () =>
          new ApiClient({
            sessionTransport: 'bearer',
            baseUrl,
            fetch: fetcher,
          }),
      ).toThrow(RangeError);
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it('allows HTTP loopback only during development', () => {
    vi.stubEnv('DEV', true);
    expect(
      () =>
        new ApiClient({
          sessionTransport: 'bearer',
          baseUrl: 'http://localhost:8080',
        }),
    ).not.toThrow();
    expect(
      () =>
        new ApiClient({
          sessionTransport: 'bearer',
          baseUrl: 'http://127.0.0.1:8080',
        }),
    ).not.toThrow();
    expect(
      () =>
        new ApiClient({
          sessionTransport: 'bearer',
          baseUrl: 'http://[::1]:8080',
        }),
    ).not.toThrow();
    vi.stubEnv('DEV', false);
    expect(
      () =>
        new ApiClient({
          sessionTransport: 'bearer',
          baseUrl: 'http://localhost:8080',
        }),
    ).toThrow(RangeError);
  });

  it('reads bearer mode and the API origin from the build configuration', async () => {
    vi.stubEnv('VITE_SESSION_TRANSPORT', 'bearer');
    vi.stubEnv('VITE_API_BASE', `${origin}/`);
    const fetcher = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(Response.json(status));
    const client = new ApiClient({ fetch: fetcher });
    expect(await client.status()).toEqual(status);
    expect(lastRequest(fetcher).url).toBe(`${origin}/api/v1/status`);
    expect(lastRequest(fetcher).init).toMatchObject({
      credentials: 'omit',
      redirect: 'error',
    });
    vi.stubEnv('VITE_SESSION_TRANSPORT', 'unsupported');
    expect(() => new ApiClient({ fetch: fetcher })).toThrow(RangeError);
  });
});
