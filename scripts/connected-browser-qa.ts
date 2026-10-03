import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { chromium, type Browser, type Page, type Locator } from 'playwright';
import type { HDNodeWallet } from 'ethers';
import {
  readListing,
  readListings,
  readCapabilities,
  readError,
  expectedRevision,
  type AuditReport,
  type WalletRequest,
  type WalletListener,
} from './qa-types.ts';
import { createQAService } from './qa-service.ts';

const serverRequire = createRequire(
  new URL('../server/package.json', import.meta.url),
);
const { getBytes }: typeof import('ethers') = serverRequire('ethers');
const require = createRequire(import.meta.url);
const service = await createQAService();
const { base, alice, bob } = service;
const output = new URL('../docs/qa/', import.meta.url);
await mkdir(output, { recursive: true });
let browser: Browser | undefined;
const checks: string[] = [];
const accessibility: AuditReport[] = [];
const errors: string[] = [];
const walletMethods: string[] = [];
const apiMutations: { method: string; path: string }[] = [];
const apiReads: { actor: string; path: string }[] = [];
const externalRequests: string[] = [];
const selectedMarketAccent = '#bff4aa';
let status = 'failed';
const check = (name: string, condition: unknown) => {
  assert.ok(condition, name);
  checks.push(name);
};
async function actor(wallet: HDNodeWallet) {
  assert.ok(browser, 'QA browser must be initialized before creating an actor');
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
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
          'Signing fixture requires a hex message and address',
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
      on: (event, fn) => {
        const list = listeners.get(event) ?? [];
        list.push(fn);
        listeners.set(event, list);
      },
      removeListener: (event, fn) =>
        listeners.set(
          event,
          (listeners.get(event) ?? []).filter((item) => item !== fn),
        ),
    };
    window.fixtureWalletDisconnect = () =>
      (listeners.get('disconnect') ?? []).forEach((fn) => fn());
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (
      url.origin === base &&
      !['GET', 'HEAD'].includes(request.method()) &&
      url.pathname.startsWith('/api/')
    )
      apiMutations.push({ method: request.method(), path: url.pathname });
    if (
      url.origin === base &&
      request.method() === 'GET' &&
      url.pathname.startsWith('/api/')
    )
      apiReads.push({ actor: wallet.address, path: url.pathname });
    if (
      url.origin !== base &&
      !['data:', 'blob:', 'about:'].includes(url.protocol)
    )
      externalRequests.push(request.url());
  });
  await page.goto(`${base}/#marketplace`, { waitUntil: 'networkidle' });
  return { context, page };
}
const dialog = (page: Page) => page.getByRole('dialog');
const marketRows = (page: Page) => page.locator('main .market-table tbody tr');
const marketRow = (page: Page, tokenId: string) =>
  marketRows(page).filter({
    has: page.getByText(`#${tokenId}`, { exact: true }),
  });
const apiResponse = (page: Page, method: string, path: string) =>
  page.waitForResponse(
    (response) =>
      response.request().method() === method &&
      new URL(response.url()).origin === base &&
      new URL(response.url()).pathname === path,
  );
const formatUSDC = (raw: string | bigint) => {
  const value = BigInt(raw);
  const fraction = (value % 1_000_000n)
    .toString()
    .padStart(6, '0')
    .replace(/0+$/, '');
  return `${(value / 1_000_000n).toLocaleString('en-GB')}${fraction ? `.${fraction}` : ''} USDC`;
};
async function askMicros(row: Locator) {
  const text = (await row.locator('strong').first().innerText()).trim();
  assert.match(text, /^\d[\d,]*(?:\.\d{1,6})? USDC$/);
  const [whole, fraction = ''] = text.replace(' USDC', '').split('.');
  return (
    BigInt(whole.replaceAll(',', '')) * 1_000_000n +
    BigInt(fraction.padEnd(6, '0'))
  );
}

async function go(page: Page, name: string, title: string) {
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name, exact: true })
    .click();
  await page
    .getByRole('heading', { level: 1, name: title, exact: true })
    .waitFor();
}
const heading = (page: Page, name: string) =>
  page.getByRole('heading', { level: 1, name, exact: true });
const fits = (page: Page) =>
  page.evaluate(
    () =>
      document.documentElement.scrollWidth <=
      document.documentElement.clientWidth,
  );
const dashes = async (locator: Locator) =>
  (await locator.allTextContents()).every((text) => text.trim() === '—');

async function close(page: Page) {
  await page.keyboard.press('Escape');
  await dialog(page).waitFor({ state: 'hidden' });
}
async function signin(page: Page) {
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page
    .getByRole('button', { name: 'Sign in with wallet', exact: true })
    .click();
  try {
    await page
      .getByRole('heading', { name: 'Your account', exact: true })
      .waitFor();
  } catch (error) {
    await page.screenshot({
      path: new URL('connected-failure.png', output).pathname,
    });
    throw new Error(`Sign-in failed: ${await dialog(page).innerText()}`, {
      cause: error,
    });
  }
  await dialog(page)
    .getByRole('button', { name: 'Refresh account' })
    .waitFor({ state: 'visible' });
  await page.waitForFunction(
    () =>
      !document
        .querySelector('[role="dialog"]')
        ?.textContent?.includes('Loading your account'),
  );
}
async function account(page: Page) {
  await page.locator('.account-button').click();
  await page
    .getByRole('heading', { name: 'Your account', exact: true })
    .waitFor();
  await page.waitForFunction(
    () =>
      !document
        .querySelector('[role="dialog"]')
        ?.textContent?.includes('Loading your account'),
  );
}
async function audit(page: Page, name: string) {
  await page.evaluate(async () => {
    await Promise.all(
      document
        .getAnimations()
        .filter(
          (animation) =>
            animation.playState === 'running' &&
            animation.effect?.getTiming().iterations !== Infinity &&
            Number(animation.effect?.getTiming().duration) <= 1500,
        )
        .map((animation) => animation.finished.catch(() => {})),
    );
  });
  if ((await dialog(page).count()) > 0) {
    const theme = await dialog(page).evaluate((node) => ({
      bodyPortal:
        node.parentElement?.parentElement === document.body &&
        node.closest('.app-shell') === null,
      accent: getComputedStyle(node).getPropertyValue('--accent').trim(),
    }));
    check(
      `Dialog mounts in body with selected market accent: ${name}`,
      theme.bodyPortal && theme.accent === selectedMarketAccent,
    );
  }
  await page.evaluate(
    await readFile(require.resolve('axe-core/axe.min.js'), 'utf8'),
  );
  const result = await page.evaluate(() =>
    window.axe.run(document, {
      runOnly: {
        type: 'tag',
        values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'],
      },
    }),
  );
  accessibility.push({
    view: name,
    violations: result.violations.map(({ id, impact, nodes }) => ({
      id,
      impact,
      nodes: nodes.map(({ target, failureSummary }) => ({
        target,
        failureSummary,
      })),
    })),
  });
  check(`Accessibility: ${name}`, result.violations.length === 0);
}
try {
  const live = await fetch(`${base}/health/live`);
  check(
    'Liveness and security headers',
    live.ok &&
      live.headers
        .get('content-security-policy')
        ?.includes("script-src 'self'"),
  );
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const holder = await actor(alice);
  const page = holder.page;
  check(
    'Connected mode without demo records',
    (await page.locator('[data-mode="connected"]').count()) === 1 &&
      (await page.locator('.asset-card').count()) === 0,
  );
  const marketSelect = page.getByLabel('Select market', { exact: true });
  const options = await marketSelect.locator('option').evaluateAll((items) =>
    items.map((item) => ({
      value: (item as HTMLOptionElement).value,
      label: (item.textContent ?? '').trim(),
    })),
  );
  check(
    'KittenSwap remains the sole selected market',
    (await marketSelect.inputValue()) === 'kittenswap' &&
      options.length === 1 &&
      options[0].value === 'kittenswap' &&
      options[0].label === 'KittenSwap',
  );
  check(
    'Supplied market logo and root accent are applied',
    (await page
      .locator('.market-logo')
      .evaluate(
        (image: HTMLImageElement) =>
          image.complete &&
          image.naturalWidth > 0 &&
          new URL(image.currentSrc).pathname.endsWith(
            '/markets/kittenswap.png',
          ),
      )) &&
      (await page.evaluate(() =>
        getComputedStyle(document.documentElement)
          .getPropertyValue('--accent')
          .trim(),
      )) === selectedMarketAccent,
  );
  const lendingResponse = await fetch(`${base}/api/v1/lending`);
  const lendingState: unknown = await lendingResponse.json();
  check(
    'Lending API reports an undeployed pool without invented accounting or terms',
    lendingResponse.ok &&
      isDeepStrictEqual(lendingState, {
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
      }),
  );
  const statusState = await readCapabilities(
    await fetch(`${base}/api/v1/status`),
  );
  check(
    'Connected lending and settlement capabilities are disabled',
    statusState.lending === false && statusState.settlement === false,
  );
  await audit(page, 'connected marketplace empty');
  await signin(page);
  await page
    .getByRole('heading', { name: 'veKITTEN #101', exact: true })
    .waitFor();
  check(
    'Confirmed ownership positions',
    (await dialog(page).locator('.connected-position').count()) === 2,
  );
  check(
    'Session secret stays HttpOnly',
    !(await page.evaluate(() => document.cookie)).includes('riftwell_session'),
  );
  await audit(page, 'connected account positions');
  await page.setViewportSize({ width: 320, height: 900 });
  check(
    'Owned-position dialog fits at 320px',
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  );
  await audit(page, 'connected account mobile');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await close(page);
  await page.getByRole('button', { name: 'List yours', exact: true }).click();
  await dialog(page)
    .getByRole('heading', { name: 'Choose a veKITTEN to list', exact: true })
    .waitFor();
  check(
    'Listing picker shows verified unlisted NFTs',
    (await dialog(page)
      .getByRole('button', { name: 'Select #101', exact: true })
      .isVisible()) &&
      (await dialog(page)
        .getByRole('button', { name: 'Select #102', exact: true })
        .isVisible()),
  );
  await dialog(page)
    .getByRole('button', { name: 'Enter token ID', exact: true })
    .click();
  await dialog(page)
    .getByRole('heading', { name: 'List your veKITTEN', exact: true })
    .waitFor();
  await page.getByLabel('Your veKITTEN token ID').fill('999');
  await page.getByRole('button', { name: 'Verify ownership' }).click();
  await dialog(page)
    .getByRole('alert')
    .filter({ hasText: 'not found' })
    .waitFor();
  check(
    'Nonexistent NFT rejected',
    await dialog(page).getByRole('alert').innerText(),
  );
  await page.getByLabel('Your veKITTEN token ID').fill('101');
  await page.getByRole('button', { name: 'Verify ownership' }).click();
  await dialog(page)
    .getByText(/123,456.*KITTEN/)
    .waitFor();
  await page.getByLabel('Ask price', { exact: true }).fill('1e3');
  await dialog(page)
    .getByRole('button', { name: 'Save listing', exact: true })
    .click();
  check(
    'Malformed marketplace money is rejected before a server mutation',
    (await dialog(page).getByRole('alert').innerText()).includes(
      'six decimal',
    ) && !apiMutations.some(({ path }) => path === '/api/v1/listings'),
  );
  await page.getByLabel('Ask price', { exact: true }).fill('100.000001');
  await audit(page, 'verified listing form');
  const fixedResponse = apiResponse(page, 'POST', '/api/v1/listings');
  await page.getByRole('button', { name: 'Save listing', exact: true }).click();
  const fixedCreatedResponse = await fixedResponse;
  const fixedListing = await readListing(fixedCreatedResponse);
  check(
    'Fixed listing stores exact integer price and explicit public fixed terms',
    fixedCreatedResponse.ok() &&
      fixedListing.priceMicros === '100000001' &&
      fixedListing.startPriceMicros === '100000001' &&
      fixedListing.endPriceMicros === '100000001' &&
      fixedListing.kind === 'fixed' &&
      fixedListing.auctionEndsAt === null &&
      fixedListing.recipient === null &&
      fixedListing.revision === 1,
  );
  await dialog(page).waitFor({ state: 'hidden' });
  await marketRow(page, '101').waitFor();
  check(
    'Listing-first marketplace retains the exact ask and shows owner controls',
    (await askMicros(marketRow(page, '101'))) === 100000001n &&
      (await marketRow(page, '101')
        .getByRole('button', { name: 'Edit', exact: true })
        .isVisible()) &&
      (await marketRow(page, '101')
        .getByRole('button', { name: 'Cancel', exact: true })
        .isVisible()) &&
      (await marketRow(page, '101')
        .getByRole('button', { name: 'Buy', exact: true })
        .count()) === 0 &&
      (await marketRow(page, '101').getByRole('checkbox').isDisabled()) &&
      (await page.locator('.asset-card').count()) === 0,
  );

  await page.getByRole('button', { name: 'List yours', exact: true }).click();
  await dialog(page)
    .getByRole('button', { name: 'Select #102', exact: true })
    .waitFor();
  await dialog(page)
    .getByRole('button', { name: 'Select #101', exact: true })
    .waitFor({ state: 'hidden' });
  check(
    'Picker excludes an already active listing',
    (await dialog(page)
      .getByRole('button', { name: 'Select #101', exact: true })
      .count()) === 0,
  );
  await dialog(page)
    .getByRole('button', { name: 'Select #102', exact: true })
    .click();
  await page.getByLabel('Listing type', { exact: true }).selectOption('dutch');
  await page.getByLabel('Start price', { exact: true }).fill('200.000002');
  await page.getByLabel('Floor price · USDC', { exact: true }).fill('300');
  const listingPostsBefore = apiMutations.filter(
    ({ method, path }) => method === 'POST' && path === '/api/v1/listings',
  ).length;
  await dialog(page)
    .getByRole('button', { name: 'Save listing', exact: true })
    .click();
  check(
    'Dutch floor above its start is rejected before an API mutation',
    (await dialog(page).getByRole('alert').innerText()).includes(
      'Set a floor',
    ) &&
      apiMutations.filter(
        ({ method, path }) => method === 'POST' && path === '/api/v1/listings',
      ).length === listingPostsBefore,
  );
  await page
    .getByLabel('Floor price · USDC', { exact: true })
    .fill('150.000003');
  await page.getByLabel('Reach floor in', { exact: true }).selectOption('1');
  await dialog(page)
    .locator('summary')
    .filter({ hasText: 'Reserve for a buyer' })
    .click();
  await page
    .getByLabel('Buyer address (optional)', { exact: true })
    .fill(alice.address);
  await dialog(page)
    .getByRole('button', { name: 'Save listing', exact: true })
    .click();
  check(
    'A seller cannot reserve their listing for their own address',
    (await dialog(page).getByRole('alert').innerText()).includes(
      'different from your own',
    ) &&
      apiMutations.filter(
        ({ method, path }) => method === 'POST' && path === '/api/v1/listings',
      ).length === listingPostsBefore,
  );
  await page
    .getByLabel('Buyer address (optional)', { exact: true })
    .fill(bob.address);
  await audit(page, 'reserved Dutch listing form');
  const dutchResponse = apiResponse(page, 'POST', '/api/v1/listings');
  await dialog(page)
    .getByRole('button', { name: 'Save listing', exact: true })
    .click();
  const dutchCreatedResponse = await dutchResponse;
  const dutchListing = await readListing(dutchCreatedResponse);
  assert.ok(
    dutchListing.recipient !== null && dutchListing.auctionEndsAt !== null,
    'Reserved Dutch fixture must contain recipient and decay end',
  );
  check(
    'Reserved Dutch creation stores exact start/floor, time bounds and recipient',
    dutchCreatedResponse.ok() &&
      dutchListing.kind === 'dutch' &&
      dutchListing.startPriceMicros === '200000002' &&
      dutchListing.endPriceMicros === '150000003' &&
      dutchListing.recipient.toLowerCase() === bob.address.toLowerCase() &&
      Date.parse(dutchListing.startsAt) <
        Date.parse(dutchListing.auctionEndsAt) &&
      Date.parse(dutchListing.auctionEndsAt) <=
        Date.parse(dutchListing.expiresAt),
  );
  await dialog(page).waitFor({ state: 'hidden' });
  await marketRow(page, '102').waitFor();
  check(
    'Table shows Dutch and reserved terms without invented reference prices',
    (await marketRow(page, '102').innerText()).includes(
      'Dutch · Reserved · Yours',
    ) &&
      (await page
        .getByRole('columnheader', { name: /discount|reference/i })
        .count()) === 0,
  );
  await page
    .getByLabel('Search loaded listings by token ID or seller', { exact: true })
    .fill('101');
  check(
    'Token search filters only the loaded listing records',
    (await marketRows(page).count()) === 1 &&
      (await marketRow(page, '101').count()) === 1,
  );
  await page.getByRole('button', { name: 'Clear search', exact: true }).click();
  await page
    .getByLabel('Sort loaded listings', { exact: true })
    .selectOption('price-desc');
  check(
    'Exact ask sorting applies to the loaded rows',
    (await marketRows(page).first().innerText()).includes('#102'),
  );
  await page
    .getByLabel('Sort loaded listings', { exact: true })
    .selectOption('unit-asc');
  check(
    'USDC per locked KITTEN sorting uses the actual balance',
    (await marketRows(page).first().innerText()).includes('#101'),
  );
  await audit(page, 'connected listing table with fixed and Dutch rows');
  await page.setViewportSize({ width: 320, height: 900 });
  check(
    'Loaded marketplace rows fit at 320px',
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  );
  await audit(page, 'connected loaded marketplace mobile');
  await page.setViewportSize({ width: 1440, height: 1000 });

  const lender = await actor(bob);
  await marketRow(lender.page, '102').waitFor();
  check(
    'An unsigned visitor cannot select or buy a reserved listing',
    (await marketRow(lender.page, '102').getByRole('checkbox').isDisabled()) &&
      (await marketRow(lender.page, '102')
        .getByRole('button', { name: 'Buy', exact: true })
        .isDisabled()),
  );
  const originalReviewResponse = apiResponse(
    lender.page,
    'GET',
    `/api/v1/listings/${fixedListing.id}`,
  );
  await marketRow(lender.page, '101')
    .getByRole('button', { name: 'Buy', exact: true })
    .click();
  const originalReview = await readListing(await originalReviewResponse);
  await dialog(lender.page)
    .getByRole('heading', { name: 'Buy veKITTEN #101', exact: true })
    .waitFor();
  await dialog(lender.page)
    .getByText('100.000001 USDC', { exact: true })
    .waitFor();
  check(
    'Purchase review fetches authoritative terms and cannot settle or transfer assets',
    originalReview.id === fixedListing.id &&
      originalReview.priceMicros === '100000001' &&
      (await dialog(lender.page)
        .getByText('100.000001 USDC', { exact: true })
        .isVisible()) &&
      (await dialog(lender.page)
        .getByRole('button', {
          name: 'Buy · contracts not deployed',
          exact: true,
        })
        .isDisabled()),
  );
  check(
    'Marketplace review retains the exact seller-paid 0.5% fee',
    (await dialog(lender.page)
      .getByText('0.5 USDC', { exact: true })
      .isVisible()) &&
      (await dialog(lender.page).innerText()).includes('paid by seller'),
  );
  await audit(lender.page, 'purchase blocked review');
  await close(lender.page);
  await signin(lender.page);
  check(
    'A lender account does not inherit borrower collateral ownership',
    await dialog(lender.page)
      .getByRole('heading', { name: 'No positions found.', exact: true })
      .isVisible(),
  );
  await dialog(lender.page)
    .getByRole('tab', { name: /^Previous records/ })
    .click();
  check(
    'The original lender retains a cancellation control for their historical unfunded offer',
    (await dialog(lender.page).locator('.portfolio-item').count()) === 1 &&
      (await dialog(lender.page)
        .getByRole('button', { name: 'Cancel record', exact: true })
        .isEnabled()),
  );
  await close(lender.page);
  check(
    'The authenticated named recipient can select the reserved Dutch listing',
    (await marketRow(lender.page, '102').getByRole('checkbox').isEnabled()) &&
      (await marketRow(lender.page, '102')
        .getByRole('button', { name: 'Buy', exact: true })
        .isEnabled()),
  );

  // Freeze only this context's list response to reproduce a stale table. The
  // individual review endpoint still uses the real fixture HTTP/SQLite service.
  const stalePage = await readListings(
    await fetch(`${base}/api/v1/listings?market=kittenswap&limit=24`),
  );
  const listRoute = (url: URL) =>
    url.origin === base && url.pathname === '/api/v1/listings';
  await lender.page.route(listRoute, (route) =>
    route.fulfill({ json: stalePage }),
  );
  await marketRow(lender.page, '101').getByRole('checkbox').check();
  await page.getByRole('button', { name: 'My listings', exact: true }).click();
  check(
    'My listings contains the authenticated creator records and no Buy controls',
    (await marketRows(page).count()) === 2 &&
      (await marketRows(page)
        .getByRole('button', { name: 'Buy', exact: true })
        .count()) === 0,
  );
  await marketRow(page, '101')
    .getByRole('button', { name: 'Edit', exact: true })
    .click();
  await dialog(page)
    .getByRole('heading', { name: 'Edit listing', exact: true })
    .waitFor();
  await page.getByLabel('Ask price', { exact: true }).fill('125.000007');
  const repriceResponse = apiResponse(
    page,
    'PATCH',
    `/api/v1/listings/${fixedListing.id}`,
  );
  await dialog(page)
    .getByRole('button', { name: 'Save changes', exact: true })
    .click();
  const reprice = await repriceResponse;
  const updatedListing = await readListing(reprice);
  check(
    'Owner repricing checks the prior revision and retains exact money',
    reprice.ok() &&
      expectedRevision(reprice.request().postData()) ===
        fixedListing.revision &&
      updatedListing.priceMicros === '125000007' &&
      updatedListing.revision === fixedListing.revision + 1,
  );
  await dialog(page).waitFor({ state: 'hidden' });
  await marketRow(page, '101')
    .getByText('125.000007 USDC', { exact: true })
    .waitFor();
  const changedReviewResponse = apiResponse(
    lender.page,
    'GET',
    `/api/v1/listings/${fixedListing.id}`,
  );
  check(
    'Buyer still has the deliberately stale ask before review',
    (await askMicros(marketRow(lender.page, '101'))) === 100000001n,
  );
  await marketRow(lender.page, '101')
    .getByRole('button', { name: 'Buy', exact: true })
    .click();
  const changedReview = await readListing(await changedReviewResponse);
  await dialog(lender.page)
    .getByText('The listing changed. Current terms are shown below.', {
      exact: true,
    })
    .waitFor();
  check(
    'Stale review reads the new revision, ask and seller fee without execution',
    changedReview.revision === updatedListing.revision &&
      changedReview.priceMicros === '125000007' &&
      (await dialog(lender.page)
        .getByText('125.000007 USDC', { exact: true })
        .isVisible()) &&
      (await dialog(lender.page)
        .getByText('0.625 USDC', { exact: true })
        .isVisible()) &&
      (await dialog(lender.page)
        .getByRole('button', {
          name: 'Buy · contracts not deployed',
          exact: true,
        })
        .isDisabled()),
  );
  await audit(lender.page, 'changed authoritative purchase review');
  await close(lender.page);
  await lender.page.unroute(listRoute);
  const refreshedResponse = apiResponse(lender.page, 'GET', '/api/v1/listings');
  await lender.page
    .getByRole('button', { name: 'Refresh', exact: true })
    .click();
  await refreshedResponse;
  await marketRow(lender.page, '101')
    .getByText('125.000007 USDC', { exact: true })
    .waitFor();
  check(
    'Refreshing a changed revision clears the stale sweep selection',
    !(await marketRow(lender.page, '101').getByRole('checkbox').isChecked()) &&
      (await lender.page.locator('.market-sweep-bar').count()) === 0,
  );

  const initialDutchAsk = await askMicros(marketRow(lender.page, '102'));
  const initialDutchUnit = await marketRow(lender.page, '102')
    .locator('td')
    .nth(6)
    .innerText();
  const listReadCount = () =>
    apiReads.filter(
      ({ actor, path }) => actor === bob.address && path === '/api/v1/listings',
    ).length;
  const beforeClockReads = listReadCount();
  // Date is fixed but timers still run, so the one-second table clock updates
  // without advancing the 30-second server polling interval.
  const midpoint = Math.floor(
    (Date.parse(dutchListing.startsAt) +
      Date.parse(dutchListing.auctionEndsAt)) /
      2,
  );
  await lender.page.clock.setFixedTime(midpoint);
  await lender.page.waitForFunction(
    ({ start, floor }) => {
      const row = [
        ...document.querySelectorAll('main .market-table tbody tr'),
      ].find(
        (node) =>
          node.querySelector('.market-token-link')?.textContent?.trim() ===
          '#102',
      );
      const text = row
        ?.querySelector('strong')
        ?.textContent?.replace(' USDC', '')
        .replaceAll(',', '')
        .trim();
      if (!text) return false;
      const [whole, fraction = ''] = text.split('.');
      const value = BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, '0'));
      return value < BigInt(start) && value > BigInt(floor);
    },
    { start: initialDutchAsk.toString(), floor: dutchListing.endPriceMicros },
  );
  check(
    'Dutch table ask decreases during its price window without a list refetch',
    listReadCount() === beforeClockReads &&
      (await askMicros(marketRow(lender.page, '102'))) < initialDutchAsk,
  );
  await lender.page.clock.setFixedTime(
    Date.parse(dutchListing.auctionEndsAt) + 1000,
  );
  await marketRow(lender.page, '102')
    .getByText('150.000003 USDC', { exact: true })
    .waitFor();
  check(
    'Dutch ask reaches the exact floor and updates USDC per locked token without polling',
    listReadCount() === beforeClockReads &&
      (await askMicros(marketRow(lender.page, '102'))) === 150000003n &&
      (await marketRow(lender.page, '102').locator('td').nth(6).innerText()) !==
        initialDutchUnit,
  );
  await lender.page
    .getByLabel('Select up to 20 available listings', { exact: true })
    .check();
  const sweepTotal = (125000007n + 150000003n).toString();
  check(
    'Sweep selection sums exact current fixed and reserved Dutch asks',
    (await lender.page.locator('.market-sweep-bar').innerText()).includes(
      '2 selected',
    ) &&
      (await lender.page
        .locator('.market-sweep-bar')
        .getByText(formatUSDC(sweepTotal), { exact: true })
        .isVisible()),
  );
  const sweepFixedResponse = apiResponse(
    lender.page,
    'GET',
    `/api/v1/listings/${fixedListing.id}`,
  );
  const sweepDutchResponse = apiResponse(
    lender.page,
    'GET',
    `/api/v1/listings/${dutchListing.id}`,
  );
  await lender.page
    .getByRole('button', { name: 'Review sweep', exact: true })
    .click();
  const sweepFixed = await readListing(await sweepFixedResponse);
  const sweepDutch = await readListing(await sweepDutchResponse);
  assert.ok(
    sweepDutch.recipient !== null,
    'Reserved sweep listing must retain its recipient',
  );
  await dialog(lender.page)
    .getByRole('heading', { name: 'Sweep 2 positions', exact: true })
    .waitFor();
  await dialog(lender.page)
    .getByText(formatUSDC(sweepTotal), { exact: true })
    .waitFor();
  check(
    'Sweep revalidates each record, names the reservation and keeps payment disabled',
    sweepFixed.revision === updatedListing.revision &&
      sweepDutch.recipient.toLowerCase() === bob.address.toLowerCase() &&
      (await dialog(lender.page).locator('.market-table tbody tr').count()) ===
        2 &&
      (await dialog(lender.page).innerText()).includes(bob.address) &&
      (await dialog(lender.page)
        .getByText('1.375 USDC', { exact: true })
        .isVisible()) &&
      (await dialog(lender.page)
        .getByRole('button', {
          name: 'Buy · contracts not deployed',
          exact: true,
        })
        .isDisabled()),
  );
  await audit(lender.page, 'blocked fixed and reserved Dutch sweep');
  await close(lender.page);
  await lender.page.clock.setFixedTime(Date.now());
  await lender.page.getByRole('button', { name: 'Clear', exact: true }).click();
  await marketRow(lender.page, '102').getByRole('checkbox').check();
  const preCancellationPage = await readListings(
    await fetch(`${base}/api/v1/listings?market=kittenswap&limit=24`),
  );
  await lender.page.route(listRoute, (route) =>
    route.fulfill({ json: preCancellationPage }),
  );
  const cancelDutchResponse = apiResponse(
    page,
    'DELETE',
    `/api/v1/listings/${dutchListing.id}`,
  );
  await marketRow(page, '102')
    .getByRole('button', { name: 'Cancel', exact: true })
    .click();
  await dialog(page)
    .getByRole('button', { name: 'Confirm cancellation', exact: true })
    .click();
  check(
    'Owner cancels their reserved Dutch intent without moving assets',
    (await cancelDutchResponse).ok(),
  );
  await dialog(page)
    .getByRole('heading', { name: 'Your account', exact: true })
    .waitFor();
  await close(page);
  await marketRow(page, '102').waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await marketRow(page, '102')
    .getByText('cancelled', { exact: true })
    .waitFor();
  check(
    'Cancelled Dutch terms remain in creator history without actionable controls',
    (await marketRow(page, '102').innerText()).includes('Dutch · Reserved') &&
      (await marketRow(page, '102').getByRole('button').count()) === 0,
  );
  await page.getByRole('button', { name: 'All listings', exact: true }).click();
  const inactiveReviewResponse = apiResponse(
    lender.page,
    'GET',
    `/api/v1/listings/${dutchListing.id}`,
  );
  await marketRow(lender.page, '102')
    .getByRole('button', { name: 'Buy', exact: true })
    .click();
  const inactiveReview = await inactiveReviewResponse;
  const inactiveError = await readError(inactiveReview);
  await dialog(lender.page)
    .getByRole('alert')
    .filter({ hasText: 'no longer active' })
    .waitFor();
  check(
    'A stale cancelled listing fails authoritative review without retaining a payable quote',
    inactiveReview.status() === 409 &&
      inactiveError.error.code === 'ORDER_INACTIVE' &&
      (await dialog(lender.page).locator('.cost-breakdown').count()) === 0 &&
      (await dialog(lender.page)
        .getByRole('button', {
          name: 'Buy · contracts not deployed',
          exact: true,
        })
        .isDisabled()),
  );
  await close(lender.page);
  await lender.page.unroute(listRoute);
  const cancelledRefresh = apiResponse(lender.page, 'GET', '/api/v1/listings');
  await lender.page
    .getByRole('button', { name: 'Refresh', exact: true })
    .click();
  await cancelledRefresh;
  await marketRow(lender.page, '102').waitFor({ state: 'hidden' });
  check(
    'Cancellation removes the public row and stale sweep selection',
    (await lender.page.locator('.market-sweep-bar').count()) === 0 &&
      service.app.store
        .prepare<[string], { status: string }>(
          'SELECT status FROM listings WHERE id = ?',
        )
        .get(dutchListing.id)?.status === 'cancelled',
  );
  await go(page, 'Borrow', 'Borrow against veKITTEN');
  await page.locator('main .wallet-position').first().waitFor();
  check(
    'Borrowing credit, debt and available cash remain unknown before launch',
    (await page
      .getByText('Lending has not launched yet.', { exact: false })
      .isVisible()) &&
      (await page.locator('main .stat-grid .stat-value').count()) === 3 &&
      (await dashes(page.locator('main .stat-grid .stat-value'))) &&
      (await page.locator('main .credit-metrics dd').count()) === 4 &&
      (await dashes(page.locator('main .credit-metrics dd'))) &&
      (await page
        .getByRole('button', { name: 'Borrow USDC', exact: true })
        .isDisabled()) &&
      (await page
        .getByRole('button', { name: 'Repay', exact: true })
        .isDisabled()),
  );
  check(
    'Wallet ownership is shown without claiming collateral was deposited',
    (await page.locator('main .wallet-position').count()) === 2 &&
      (await page
        .getByText('In your wallet · not deposited', { exact: true })
        .count()) === 2,
  );
  check(
    'The reward relayer waits for the lending launch',
    (await page.getByRole('heading', { name: 'Reward relayer' }).isVisible()) &&
      (await page.locator('main').innerText()).includes(
        'The relayer launches with the lending contracts',
      ),
  );
  await audit(page, 'connected borrow positions');
  await page
    .getByRole('button', { name: 'View collateral', exact: true })
    .first()
    .click();
  check(
    'Collateral review cannot deposit or transfer the NFT',
    (await dialog(page)
      .getByRole('button', { name: 'Add collateral unavailable', exact: true })
      .isDisabled()) &&
      (await dialog(page).innerText()).includes('does not deposit or transfer'),
  );
  await audit(page, 'connected collateral review');
  await close(page);
  await page.getByRole('tab', { name: 'Vote' }).click();
  check(
    'Voting waits for the lending launch',
    await page
      .getByRole('heading', { name: 'Voting arrives with the lending launch.' })
      .isVisible(),
  );
  await page.getByRole('tab', { name: 'Positions' }).click();
  await go(page, 'Earn', 'Earn from collateral revenue');
  check(
    'Connected vault has no fabricated liquidity, shares, withdrawals or APR',
    (await page.getByText('Not launched', { exact: true }).isVisible()) &&
      (await page.locator('main .vault-metrics dd').count()) === 4 &&
      (await dashes(page.locator('main .vault-metrics dd'))) &&
      (await page
        .getByRole('button', { name: 'Supply USDC', exact: true })
        .isDisabled()) &&
      (await page
        .getByRole('button', { name: 'Withdraw', exact: true })
        .isDisabled()),
  );
  check(
    'Lending has no APR, maturity, proposal or execution form',
    (await page.getByRole('textbox').count()) === 0 &&
      (await page
        .getByLabel(/annual rate|loan duration|offer amount|requested amount/i)
        .count()) === 0 &&
      (await page
        .getByRole('button', {
          name: /Make offer|Request a loan|Accept offer/i,
        })
        .count()) === 0,
  );
  await audit(page, 'connected vault not launched');
  await page.setViewportSize({ width: 320, height: 900 });
  check('Connected undeployed vault fits at 320px', await fits(page));
  await audit(page, 'connected vault mobile');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'Settlement off' }).click();
  await dialog(page)
    .getByRole('heading', { name: 'Service status', exact: true })
    .waitFor();
  check(
    'Service status states that lending and settlement are off',
    (await dialog(page).innerText()).includes('Not launched') &&
      (await dialog(page).innerText()).includes('Disabled'),
  );
  await audit(page, 'connected service status');
  await close(page);
  await page.goto(`${base}/#faq`, { waitUntil: 'networkidle' });
  await heading(page, 'Questions, answered').waitFor();
  await audit(page, 'connected faq');
  await page.getByRole('button', { name: 'What’s new' }).click();
  check(
    'What’s new lists the release notes in connected mode',
    (await page
      .getByRole('region', { name: 'What’s new' })
      .locator('li')
      .count()) === 4,
  );
  await page.keyboard.press('Escape');
  await page.goto(`${base}/#stats`, { waitUntil: 'networkidle' });
  await heading(page, 'Statistics').waitFor();
  check(
    'Connected statistics show no vault, reward or sales totals before launch',
    (await page.locator('main .stat-grid .stat-value').count()) === 4 &&
      (await dashes(page.locator('main .stat-grid .stat-value'))) &&
      (await page.locator('main').innerText()).includes('1 active listing'),
  );
  await audit(page, 'connected statistics');
  await page.goto(`${base}/#privacy`, { waitUntil: 'networkidle' });
  await heading(page, 'What Riftwell stores').waitFor();
  check(
    'Connected privacy notes describe cookie and memory-only session hosting',
    (await page.locator('main').innerText()).includes(
      'HttpOnly session cookie',
    ) &&
      (await page.locator('main').innerText()).includes(
        'only in browser memory',
      ),
  );
  await audit(page, 'connected privacy');
  await page.goto(`${base}/#brand`, { waitUntil: 'networkidle' });
  await heading(page, 'Brand kit').waitFor();
  await audit(page, 'connected brand kit');
  await page.goto(`${base}/#missing-page`, { waitUntil: 'networkidle' });
  await heading(page, 'This page slipped through the rift.').waitFor();
  check(
    'Unknown connected routes show the not-found page',
    (await page.evaluate(() => location.hash)) === '#missing-page',
  );
  await audit(page, 'connected not found');
  await account(page);
  await dialog(page)
    .getByRole('tab', { name: /^Previous records/ })
    .click();
  check(
    'Legacy records remain clearly separated from pool balances and credit lines',
    (await dialog(page).innerText()).includes('never funded') &&
      (await dialog(page).locator('.portfolio-item').count()) === 2 &&
      (await dialog(page)
        .getByRole('button', { name: 'Cancel record', exact: true })
        .count()) === 1,
  );
  check(
    'Borrower can cancel their request but cannot cancel the received offer',
    (await dialog(page)
      .locator('.portfolio-item')
      .filter({
        has: page.getByRole('heading', { name: 'veKITTEN #102', exact: true }),
      })
      .getByRole('button', { name: 'Cancel record', exact: true })
      .isVisible()) &&
      (await dialog(page)
        .locator('.portfolio-item')
        .filter({ hasText: 'Previous unfunded offer' })
        .getByRole('button', { name: 'Cancel record', exact: true })
        .count()) === 0,
  );
  await audit(page, 'legacy lending history');
  await close(page);
  await service.restart();
  await page.reload({ waitUntil: 'networkidle' });
  await account(page);
  await dialog(page)
    .getByRole('tab', { name: /^Listings/ })
    .click();
  const persistedDutch = service.app.store
    .prepare<
      [string],
      { status: string; kind: string; recipient: string | null }
    >('SELECT status,kind,recipient FROM listings WHERE id = ?')
    .get(dutchListing.id);
  assert.ok(
    persistedDutch && persistedDutch.recipient !== null,
    'Restarted service must retain reserved listing metadata',
  );
  check(
    'Session and listing persist across service restart',
    (await dialog(page).innerText()).includes('125.000007 USDC') &&
      service.app.store
        .prepare<[string], { revision: number }>(
          'SELECT revision FROM listings WHERE id = ?',
        )
        .get(fixedListing.id)?.revision === updatedListing.revision &&
      persistedDutch.status === 'cancelled' &&
      persistedDutch.kind === 'dutch' &&
      persistedDutch.recipient.toLowerCase() === bob.address.toLowerCase(),
  );
  await close(page);
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Marketplace', exact: true })
    .click();
  service.setUnavailable(true);
  await page.reload({ waitUntil: 'networkidle' });
  check(
    'RPC outage never substitutes demo data',
    (await marketRows(page).count()) === 0 &&
      (await page.locator('.asset-card').count()) === 0 &&
      (await page.locator('main').innerText()).includes(
        'sample data has not been substituted',
      ),
  );
  await account(page);
  await dialog(page)
    .getByRole('tab', { name: /^Listings/ })
    .click();
  await dialog(page)
    .locator('.portfolio-item')
    .filter({
      has: page.getByRole('heading', { name: 'veKITTEN #101', exact: true }),
    })
    .getByRole('button', { name: 'Cancel record', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Confirm cancellation', exact: true })
    .click();
  await dialog(page)
    .getByRole('heading', { name: 'Your account', exact: true })
    .waitFor();
  await dialog(page)
    .getByRole('tab', { name: /^Listings/ })
    .click();
  await dialog(page)
    .locator('.portfolio-item')
    .filter({
      has: page.getByRole('heading', { name: 'veKITTEN #101', exact: true }),
    })
    .getByText('cancelled', { exact: true })
    .waitFor();
  check(
    'Creator can cancel off-chain intent during RPC outage',
    service.app.store
      .prepare<[string], { status: string }>(
        'SELECT status FROM listings WHERE token_id = ?',
      )
      .get('101')?.status === 'cancelled',
  );
  await dialog(page)
    .getByRole('tab', { name: /^Previous records/ })
    .click();
  await dialog(page)
    .locator('.portfolio-item')
    .filter({
      has: page.getByRole('heading', { name: 'veKITTEN #102', exact: true }),
    })
    .getByRole('button', { name: 'Cancel record', exact: true })
    .click();
  await dialog(page)
    .getByRole('button', { name: 'Keep record', exact: true })
    .click();
  await dialog(page)
    .getByRole('tab', { name: /^Previous records/ })
    .click();
  check(
    'Declining cancellation keeps the legacy request active',
    service.app.store
      .prepare<[string], { status: string }>(
        'SELECT status FROM loan_requests WHERE id = ?',
      )
      .get(service.legacy.requestId)?.status === 'active',
  );
  await dialog(page)
    .locator('.portfolio-item')
    .filter({
      has: page.getByRole('heading', { name: 'veKITTEN #102', exact: true }),
    })
    .getByRole('button', { name: 'Cancel record', exact: true })
    .click();
  await dialog(page)
    .getByRole('button', { name: 'Confirm cancellation', exact: true })
    .click();
  await dialog(page)
    .getByRole('heading', { name: 'Your account', exact: true })
    .waitFor();
  await dialog(page)
    .getByRole('tab', { name: /^Previous records/ })
    .click();
  await dialog(page).getByText('cancelled', { exact: true }).waitFor();
  check(
    'Legacy request cancellation remains available during RPC outage and invalidates its old offer',
    service.app.store
      .prepare<[string], { status: string }>(
        'SELECT status FROM loan_requests WHERE id = ?',
      )
      .get(service.legacy.requestId)?.status === 'cancelled' &&
      service.app.store
        .prepare<[string], { status: string }>(
          'SELECT status FROM offers WHERE id = ?',
        )
        .get(service.legacy.offerId)?.status === 'invalidated',
  );
  await close(page);
  service.setUnavailable(false);
  await page.reload({ waitUntil: 'networkidle' });
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Marketplace', exact: true })
    .click();
  for (const width of [320, 390, 768, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForFunction(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
      undefined,
      { timeout: 3000 },
    );
    check(
      `No horizontal overflow at ${width}px`,
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    );
  }
  await page.setViewportSize({ width: 320, height: 900 });
  await audit(page, 'connected mobile marketplace');
  await page.screenshot({
    path: new URL('connected-mobile-320.png', output).pathname,
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: new URL('connected-desktop.png', output).pathname,
    fullPage: true,
    animations: 'disabled',
  });
  await service.restart();
  await page.reload({ waitUntil: 'networkidle' });
  check(
    'Cancelled marketplace listing stays absent after a second service restart',
    (await marketRows(page).count()) === 0 &&
      (await page.locator('.asset-card').count()) === 0 &&
      service.app.store
        .prepare<[string], { status: string }>(
          'SELECT status FROM listings WHERE token_id = ?',
        )
        .get('101')?.status === 'cancelled',
  );
  await account(page);
  await dialog(page)
    .getByRole('tab', { name: /^Previous records/ })
    .click();
  check(
    'Cancelled legacy history persists without becoming a pool position',
    (await dialog(page).getByText('cancelled', { exact: true }).isVisible()) &&
      (await dialog(page)
        .getByText('invalidated', { exact: true })
        .isVisible()) &&
      (await dialog(page)
        .getByRole('button', { name: 'Cancel record', exact: true })
        .count()) === 0,
  );
  await close(page);
  await page.evaluate(() => window.fixtureWalletDisconnect());
  await page.getByRole('button', { name: 'Sign in', exact: true }).waitFor();
  check(
    'Wallet disconnect clears authenticated UI',
    (await page
      .getByRole('button', { name: 'Sign in', exact: true })
      .isVisible()) &&
      (await page
        .getByRole('heading', { name: 'Your account', exact: true })
        .count()) === 0,
  );
  check(
    'Only account reads and personal sign reached test wallet',
    walletMethods.includes('personal_sign') &&
      walletMethods.includes('eth_chainId') &&
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
    'No retired lending creation or financial execution endpoint was requested',
    !apiMutations.some(
      ({ method, path }) =>
        method === 'POST' &&
        [
          '/api/v1/loan-requests',
          '/api/v1/offers',
          '/api/v1/lending/actions',
          '/api/v1/settlement',
        ].some((route) => path === route || path.startsWith(`${route}/`)),
    ),
  );
  check(
    'No external service or chain RPC reached the browser',
    externalRequests.length === 0,
  );
  check('No browser runtime exceptions', errors.length === 0);
  status = 'passed';
} finally {
  await writeFile(
    new URL('connected-browser-report.json', output),
    JSON.stringify(
      {
        status,
        checkedAt: new Date().toISOString(),
        browser: 'isolated headless Chrome',
        suiteVersion: 'redesign-integrated-authoritative-marketplace-v3',
        scope:
          'Built connected frontend + real HTTP/SQLite, simulated read-only chain and ephemeral EOA providers; no real funds, wallets or transactions',
        checks,
        accessibility,
        errors,
        apiMutations,
        apiReads,
        externalRequests,
      },
      null,
      2,
    ) + '\n',
  );
  await browser?.close();
  await service.close();
}
console.log(
  `${checks.length} connected browser checks passed; ${accessibility.length} views audited.`,
);
