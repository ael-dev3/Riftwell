import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createServer as createHttpsServer } from 'node:https';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { mkdir, writeFile, readFile, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { chromium, type Browser } from 'playwright';
import { createApp } from '../server/app.ts';
import { loadConfig } from '../server/config.ts';
import type { App, ChainAdapter, Position } from '../server/types.ts';
import {
  readListing,
  type WalletRequest,
  type WalletListener,
} from './qa-types.ts';

const serverRequire = createRequire(
  new URL('../server/package.json', import.meta.url),
);
const { Wallet, getBytes }: typeof import('ethers') = serverRequire('ethers');
const postgres = serverRequire('postgres') as (
  url: string,
  options: object,
) => {
  unsafe(query: string): Promise<unknown>;
  end(options: { timeout: number }): Promise<void>;
};
const databaseUrl = process.env.TEST_DATABASE_URL;
assert.ok(
  databaseUrl,
  'TEST_DATABASE_URL must name a disposable PostgreSQL database',
);
const frontend = 'http://127.0.0.1:5197';
const backend = 'https://127.0.0.1:5196';
const dist = resolve(
  process.env.RIFTWELL_BEARER_QA_DIST ?? join(tmpdir(), 'riftwell-bearer-qa'),
);
const output = resolve(
  process.env.RIFTWELL_BEARER_QA_OUTPUT ??
    join(tmpdir(), 'riftwell-bearer-qa-evidence'),
);
const schema = `riftwell_browser_${randomUUID().replaceAll('-', '')}`;
const admin = postgres(databaseUrl, { max: 1, onnotice: () => {} });
const wallet = Wallet.createRandom();
const checks: string[] = [];
const errors: string[] = [];
const walletMethods: string[] = [];
const authRequests: { path: string; bearer: boolean; csrf: boolean }[] = [];
let preflights = 0;
let app: App | undefined;
let browser: Browser | undefined;
let tlsProxy: ReturnType<typeof createHttpsServer> | undefined;
let tlsDirectory: string | undefined;
let schemaCreated = false;
let status = 'failed';
const check = (name: string, condition: unknown) => {
  assert.ok(condition, name);
  checks.push(name);
};
const preview = spawn(
  process.execPath,
  [
    'node_modules/vite/bin/vite.js',
    'preview',
    '--host',
    '127.0.0.1',
    '--port',
    '5197',
    '--strictPort',
    '--outDir',
    dist,
  ],
  {
    stdio: 'ignore',
    env: {
      ...process.env,
      TEST_DATABASE_URL: undefined,
      DATABASE_URL: undefined,
    },
  },
);
try {
  await mkdir(output, { recursive: true });
  await admin.unsafe(`CREATE SCHEMA "${schema}"`);
  schemaCreated = true;
  const scopedUrl = new URL(databaseUrl);
  scopedUrl.searchParams.set(
    'options',
    `${scopedUrl.searchParams.get('options') ?? ''} -c search_path=${schema}`.trim(),
  );
  const position: Position = {
    id: 'kittenswap-101',
    tokenId: '101',
    marketId: 'kittenswap',
    owner: wallet.address,
    lockedAmountRaw: '123456789012345678901234',
    lockedUntil: new Date(Date.now() + 365 * 86400000).toISOString(),
    votingPowerRaw: '98765432109876543210987',
    blockNumber: 47000000,
    blockHash: `0x${'ab'.repeat(32)}`,
    observedAt: new Date().toISOString(),
  };
  const chain: ChainAdapter = {
    async getPosition(id) {
      assert.equal(id, '101');
      return position;
    },
    async getPositions(ids) {
      return ids.map((id) => (id === '101' ? position : null));
    },
    async getOwnedPositions(account) {
      return {
        items: account === wallet.address ? [position] : [],
        nextCursor: null,
      };
    },
    async health() {
      return { ready: true, available: true, chainId: 999 };
    },
  };
  app = await createApp({
    config: loadConfig({
      NODE_ENV: 'test',
      APP_ORIGIN: frontend,
      DATABASE_URL: scopedUrl.toString(),
      PORT: '5196',
      SESSION_SECRET: randomBytes(32).toString('hex'),
      SESSION_TRANSPORT: 'bearer',
      API_ONLY: 'true',
    }),
    chain,
  });
  app.server.on('request', (request) => {
    if (request.method === 'OPTIONS' && request.headers.origin === frontend)
      preflights++;
  });
  await app.listen({ host: '127.0.0.1', port: 5198 });
  tlsDirectory = await mkdtemp(join(tmpdir(), 'riftwell-bearer-tls-'));
  const keyPath = join(tlsDirectory, 'key.pem');
  const certPath = join(tlsDirectory, 'cert.pem');
  const certificate = spawnSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      keyPath,
      '-out',
      certPath,
      '-subj',
      '/CN=127.0.0.1',
      '-days',
      '1',
    ],
    { stdio: 'ignore' },
  );
  assert.equal(
    certificate.status,
    0,
    'Test-only HTTPS certificate generation failed',
  );
  tlsProxy = createHttpsServer(
    { key: await readFile(keyPath), cert: await readFile(certPath) },
    (request, reply) => {
      const upstream = httpRequest(
        `http://127.0.0.1:5198${request.url ?? '/'}`,
        { method: request.method, headers: request.headers },
        (response) => {
          reply.writeHead(response.statusCode ?? 502, response.headers);
          response.pipe(reply);
        },
      );
      upstream.on('error', () => {
        reply.writeHead(502);
        reply.end();
      });
      request.pipe(upstream);
    },
  );
  await new Promise<void>((done, reject) => {
    tlsProxy!.once('error', reject);
    tlsProxy!.listen(5196, '127.0.0.1', done);
  });
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      if ((await fetch(frontend)).ok) break;
    } catch {
      /* Preview is starting. */
    }
    if (attempt === 99) throw new Error('Frontend preview failed to start');
    await new Promise((done) => setTimeout(done, 100));
  }
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    ignoreHTTPSErrors: true,
  });
  await context.exposeBinding(
    'fixtureWalletRequest',
    async (_source, request: WalletRequest) => {
      walletMethods.push(request.method);
      if (['eth_accounts', 'eth_requestAccounts'].includes(request.method))
        return [wallet.address];
      if (request.method === 'eth_chainId') return '0x3e7';
      if (request.method === 'personal_sign') {
        assert.ok(
          Array.isArray(request.params) &&
            typeof request.params[0] === 'string' &&
            typeof request.params[1] === 'string',
        );
        assert.equal(
          request.params[1].toLowerCase(),
          wallet.address.toLowerCase(),
        );
        return wallet.signMessage(getBytes(request.params[0]));
      }
      assert.fail(`Unexpected wallet method: ${request.method}`);
    },
  );
  await context.addInitScript(() => {
    const listeners = new Map<string, WalletListener[]>();
    window.ethereum = {
      request: (request) => window.fixtureWalletRequest(request),
      on: (event, listener) =>
        listeners.set(event, [...(listeners.get(event) ?? []), listener]),
      removeListener: (event, listener) =>
        listeners.set(
          event,
          (listeners.get(event) ?? []).filter((value) => value !== listener),
        ),
    };
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin === backend && url.pathname.startsWith('/api/')) {
      const headers = request.headers();
      authRequests.push({
        path: url.pathname,
        bearer: /^Bearer [0-9a-f]{64}$/.test(headers.authorization ?? ''),
        csrf: /^[0-9a-f]{64}$/.test(headers['x-csrf-token'] ?? ''),
      });
    }
    if (
      ![frontend, backend].includes(url.origin) &&
      !['data:', 'blob:', 'about:'].includes(url.protocol)
    )
      errors.push(`External request: ${url.origin}${url.pathname}`);
  });
  const response = (method: string, path: string) =>
    page.waitForResponse(
      (value) =>
        value.request().method() === method &&
        new URL(value.url()).origin === backend &&
        new URL(value.url()).pathname === path,
    );
  const signIn = async () => {
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    const verified = response('POST', '/api/v1/auth/verify');
    await page
      .getByRole('button', { name: 'Sign in with wallet', exact: true })
      .click();
    const result = await verified;
    assert.equal(result.status(), 200);
    const body = (await result.json()) as {
      accessToken: string;
      csrfToken: string;
    };
    await page
      .getByRole('heading', { name: 'Your account', exact: true })
      .waitFor();
    await page
      .getByRole('heading', { name: 'veKITTEN #101', exact: true })
      .waitFor();
    return { result, ...body };
  };
  const absentStoredToken = async (token: string) => {
    const storage = await page.evaluate(() => ({
      cookie: document.cookie,
      values: [
        ...Object.values(localStorage),
        ...Object.values(sessionStorage),
      ],
    }));
    return (
      !storage.cookie.includes(token) &&
      storage.values.every((value) => !String(value).includes(token)) &&
      (await context.cookies([frontend, backend])).every(
        (cookie) =>
          !cookie.name.includes('riftwell_session') && cookie.value !== token,
      )
    );
  };
  await page.goto(frontend, { waitUntil: 'networkidle' });
  check(
    'Built frontend loads in connected mode on a different origin from its API',
    new URL(frontend).origin !== new URL(backend).origin &&
      (await page.locator('[data-mode="connected"]').count()) === 1,
  );
  const signedIn = await signIn();
  check(
    'Browser accepts the API response through exact-origin CORS without cookies',
    signedIn.result.headers()['access-control-allow-origin'] === frontend &&
      !signedIn.result.headers()['set-cookie'] &&
      !signedIn.result.headers()['access-control-allow-credentials'],
  );
  check(
    'Cross-origin private account fetch carries the bearer credential',
    authRequests.some(
      (request) => request.path === '/api/v1/account' && request.bearer,
    ),
  );
  check(
    'Access token is absent from cookies, localStorage and sessionStorage',
    await absentStoredToken(signedIn.accessToken),
  );
  await page.screenshot({
    path: resolve(output, 'bearer-signed-in.png'),
    fullPage: true,
    animations: 'disabled',
  });
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'List yours', exact: true }).click();
  await page.getByRole('button', { name: 'Select #101', exact: true }).click();
  await page.getByLabel('Ask price', { exact: true }).fill('100.000001');
  const creation = response('POST', '/api/v1/listings');
  await page.getByRole('button', { name: 'Save listing', exact: true }).click();
  const saved = await creation;
  assert.equal(saved.status(), 200);
  const listing = await readListing(saved);
  check(
    'Browser creates one exact off-chain listing with matching CSRF and bearer headers',
    listing.priceMicros === '100000001' &&
      authRequests.some(
        (request) =>
          request.path === '/api/v1/listings' && request.bearer && request.csrf,
      ),
  );
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  const row = page
    .locator('main .market-table tbody tr')
    .filter({ has: page.getByText('#101', { exact: true }) });
  await row.waitFor();
  const cancellation = response('DELETE', `/api/v1/listings/${listing.id}`);
  await row.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page
    .getByRole('button', { name: 'Confirm cancellation', exact: true })
    .click();
  const cancelled = await cancellation;
  assert.equal(cancelled.status(), 200);
  check(
    'Browser cancellation persists without a transaction or custody transfer',
    (await readListing(cancelled)).status === 'cancelled' &&
      (
        await app.database.get<{ status: string }>(
          'SELECT status FROM listings WHERE id = ?',
          listing.id,
        )
      )?.status === 'cancelled',
  );
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.locator('.account-button').click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).waitFor();
  const logout = response('POST', '/api/v1/auth/logout');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  assert.equal((await logout).status(), 200);
  await page.getByRole('button', { name: 'Sign in', exact: true }).waitFor();
  check(
    'Browser logout revokes the durable session and clears its signed-in UI',
    (
      await app.database.get<{ n: number }>(
        'SELECT count(*) AS n FROM sessions',
      )
    )?.n === 0,
  );
  check(
    'Logged-out browser cannot read a private session without a bearer token',
    (await page.evaluate(
      async (api) =>
        (await fetch(`${api}/api/v1/auth/session`, { credentials: 'omit' }))
          .status,
      backend,
    )) === 401,
  );
  const second = await signIn();
  check(
    'Re-authentication also keeps the new token out of persistent browser storage',
    await absentStoredToken(second.accessToken),
  );
  const beforeReload = authRequests.length;
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Sign in', exact: true }).waitFor();
  check(
    'Reload signs out because the access token exists only in page memory',
    authRequests.slice(beforeReload).every((request) => !request.bearer) &&
      (await page.locator('.account-button').innerText()) === 'Sign in',
  );
  check(
    'Reloaded browser remains unable to read its private session',
    (await page.evaluate(
      async (api) =>
        (await fetch(`${api}/api/v1/auth/session`, { credentials: 'omit' }))
          .status,
      backend,
    )) === 401,
  );
  check(
    'Actual browser CORS preflights reached the separate backend',
    preflights > 0,
  );
  check(
    'Wallet operations contain no approvals or transaction submissions',
    walletMethods.every((method) =>
      [
        'eth_accounts',
        'eth_requestAccounts',
        'eth_chainId',
        'personal_sign',
      ].includes(method),
    ),
  );
  check(
    'Browser completed without page errors or external requests',
    errors.length === 0,
  );
  await page.screenshot({
    path: resolve(output, 'bearer-reloaded-signed-out.png'),
    fullPage: true,
    animations: 'disabled',
  });
  status = 'passed';
} finally {
  await writeFile(
    resolve(output, 'bearer-browser-report.json'),
    JSON.stringify(
      {
        status,
        capturedAt: new Date().toISOString(),
        evidence:
          'Real headless Chrome + two localhost origins + PostgreSQL; API uses scoped test HTTPS certificate; simulated read-only NFT data and ephemeral wallet, no funds or transactions',
        frontend,
        backend,
        checks,
        preflights,
        walletMethods,
        errors,
      },
      null,
      2,
    ),
  );
  await browser?.close();
  preview.kill('SIGTERM');
  if (tlsProxy)
    await new Promise<void>((done, reject) =>
      tlsProxy!.close((error) => (error ? reject(error) : done())),
    );
  if (tlsDirectory) await rm(tlsDirectory, { recursive: true, force: true });
  try {
    await app?.close();
  } finally {
    try {
      if (schemaCreated) await admin.unsafe(`DROP SCHEMA "${schema}" CASCADE`);
    } finally {
      await admin.end({ timeout: 5 });
    }
  }
}
console.log(
  `${checks.length} two-origin bearer browser checks passed; evidence: ${output}`,
);
