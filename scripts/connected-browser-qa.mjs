import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { createQAService } from './qa-service.mjs';

const serverRequire = createRequire(
  new URL('../server/package.json', import.meta.url),
);
const { getBytes } = serverRequire('ethers');
const require = createRequire(import.meta.url);
const service = await createQAService();
const { base, alice, bob } = service;
const output = new URL('../docs/qa/', import.meta.url);
await mkdir(output, { recursive: true });
let browser;
const checks = [];
const accessibility = [];
const errors = [];
const walletMethods = [];
const apiMutations = [];
const externalRequests = [];
const selectedMarketAccent = '#bff4aa';
let status = 'failed';
const check = (name, condition) => {
  assert.ok(condition, name);
  checks.push(name);
};
async function actor(wallet) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  await context.exposeBinding(
    'fixtureWalletRequest',
    async (_source, request) => {
      walletMethods.push(request.method);
      if (['eth_accounts', 'eth_requestAccounts'].includes(request.method))
        return [wallet.address];
      if (request.method === 'eth_chainId') return '0x3e7';
      if (request.method === 'personal_sign') {
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
    const listeners = new Map();
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
      url.origin !== base &&
      !['data:', 'blob:', 'about:'].includes(url.protocol)
    )
      externalRequests.push(request.url());
  });
  await page.goto(base, { waitUntil: 'networkidle' });
  return { context, page };
}
const dialog = (page) => page.getByRole('dialog');
async function close(page) {
  await page.keyboard.press('Escape');
  await dialog(page).waitFor({ state: 'hidden' });
}
async function signin(page) {
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page
    .getByRole('button', { name: 'Sign in with wallet', exact: true })
    .click();
  await page
    .getByRole('heading', { name: 'Your account', exact: true })
    .waitFor();
  await dialog(page)
    .getByRole('button', { name: 'Refresh account' })
    .waitFor({ state: 'visible' });
  await page.waitForFunction(
    () =>
      !document
        .querySelector('[role="dialog"]')
        ?.textContent.includes('Loading your account'),
  );
}
async function account(page) {
  await page.locator('.account-button').click();
  await page
    .getByRole('heading', { name: 'Your account', exact: true })
    .waitFor();
  await page.waitForFunction(
    () =>
      !document
        .querySelector('[role="dialog"]')
        ?.textContent.includes('Loading your account'),
  );
}
async function audit(page, name) {
  await page.evaluate(async () => {
    await Promise.all(
      document
        .getAnimations()
        .filter(
          (animation) => animation.effect?.getTiming().iterations !== Infinity,
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
      live.headers.get('content-security-policy').includes("script-src 'self'"),
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
      value: item.value,
      label: item.textContent.trim(),
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
        (image) =>
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
  const lendingState = await lendingResponse.json();
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
  const statusState = await (await fetch(`${base}/api/v1/status`)).json();
  check(
    'Connected lending and settlement capabilities are disabled',
    statusState.capabilities.lending === false &&
      statusState.capabilities.settlement === false,
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
      () => document.documentElement.scrollWidth === innerWidth,
    ),
  );
  await audit(page, 'connected account mobile');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await close(page);
  await page
    .getByRole('button', { name: 'Create listing', exact: true })
    .click();
  await page.getByLabel('Your veKITTEN token ID').fill('999');
  await page.getByRole('button', { name: 'Verify ownership' }).click();
  await dialog(page)
    .getByRole('alert')
    .filter({ hasText: 'not found' })
    .waitFor();
  check(
    'Nonexistent NFT rejected',
    await dialog(page).getByRole('alert').textContent(),
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
    (await dialog(page).getByRole('alert').textContent()).includes(
      'six decimal',
    ) && !apiMutations.some(({ path }) => path === '/api/v1/listings'),
  );
  await page.getByLabel('Ask price', { exact: true }).fill('100.000001');
  await audit(page, 'verified listing form');
  await page.getByRole('button', { name: 'Save listing', exact: true }).click();
  await dialog(page).waitFor({ state: 'hidden' });
  await page.locator('.asset-card').waitFor();
  check(
    'Exact listing price retained',
    (await page.locator('.asset-card').textContent()).includes(
      '100.000001 USDC',
    ),
  );
  await page
    .getByRole('button', { name: 'Review veKITTEN #101', exact: true })
    .click();
  check(
    'Purchase cannot settle or transfer assets',
    await page
      .getByRole('button', { name: 'Settlement unavailable' })
      .isDisabled(),
  );
  check(
    'Marketplace review retains the exact seller-paid 0.5% fee',
    (await dialog(page).textContent()).includes('0.5 USDC') &&
      (await dialog(page).textContent()).includes('paid by seller'),
  );
  await audit(page, 'purchase blocked review');
  await close(page);
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('button', { name: 'Lending', exact: true })
    .click();
  await page
    .getByRole('heading', { name: 'Let your position work.', exact: true })
    .waitFor();
  check(
    'Borrowing credit, debt and available cash remain unknown before launch',
    (await page
      .getByText('Lending has not launched yet.', { exact: false })
      .isVisible()) &&
      (await page.locator('main .pooled-summary dd').count()) === 3 &&
      (await page.locator('main .pooled-summary dd').allTextContents()).every(
        (text) => text.trim() === '—',
      ) &&
      (await page
        .getByRole('button', { name: 'Borrow USDC', exact: true })
        .isDisabled()) &&
      (await page
        .getByRole('button', { name: 'Repay', exact: true })
        .isDisabled()),
  );
  check(
    'Wallet ownership is shown without claiming collateral was deposited',
    (await page.locator('main .pooled-position').count()) === 2 &&
      (await page
        .getByText('In your wallet · not deposited', { exact: true })
        .count()) === 2,
  );
  await page
    .getByRole('button', { name: 'View collateral', exact: true })
    .first()
    .click();
  check(
    'Collateral review cannot deposit or transfer the NFT',
    (await dialog(page)
      .getByRole('button', { name: 'Add collateral unavailable', exact: true })
      .isDisabled()) &&
      (await dialog(page).textContent()).includes(
        'does not deposit or transfer',
      ),
  );
  await audit(page, 'connected collateral review');
  await close(page);
  await page.getByRole('button', { name: 'Lend', exact: true }).click();
  await page
    .getByRole('heading', { name: 'Supply the shared vault.', exact: true })
    .waitFor();
  check(
    'Connected vault has no fabricated liquidity, shares, withdrawals or APR',
    (await page.getByText('Not launched', { exact: true }).isVisible()) &&
      (await page.locator('main .pooled-summary dd').count()) === 6 &&
      (await page.locator('main .pooled-summary dd').allTextContents()).every(
        (text) => text.trim() === '—',
      ) &&
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
  check(
    'Connected undeployed vault fits at 320px',
    await page.evaluate(
      () => document.documentElement.scrollWidth === innerWidth,
    ),
  );
  await audit(page, 'connected vault mobile');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await account(page);
  await dialog(page)
    .getByRole('button', { name: 'Previous records', exact: true })
    .click();
  check(
    'Legacy records remain clearly separated from pool balances and credit lines',
    (await dialog(page).textContent()).includes('never funded') &&
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
  const lender = await actor(bob);
  await signin(lender.page);
  check(
    'A lender account does not inherit borrower collateral ownership',
    await dialog(lender.page)
      .getByRole('heading', { name: 'No positions found.', exact: true })
      .isVisible(),
  );
  await dialog(lender.page)
    .getByRole('button', { name: 'Previous records', exact: true })
    .click();
  check(
    'The original lender retains a cancellation control for their historical unfunded offer',
    (await dialog(lender.page).locator('.portfolio-item').count()) === 1 &&
      (await dialog(lender.page)
        .getByRole('button', { name: 'Cancel record', exact: true })
        .isEnabled()),
  );
  await close(lender.page);
  await service.restart();
  await page.reload({ waitUntil: 'networkidle' });
  await account(page);
  await dialog(page)
    .getByRole('button', { name: 'Listings', exact: true })
    .click();
  check(
    'Session and listing persist across service restart',
    (await dialog(page).textContent()).includes('100.000001 USDC'),
  );
  await close(page);
  service.setUnavailable(true);
  await page.reload({ waitUntil: 'networkidle' });
  check(
    'RPC outage never substitutes demo data',
    (await page.locator('.asset-card').count()) === 0 &&
      (await page.locator('main').textContent()).includes(
        'sample data has not been substituted',
      ),
  );
  await account(page);
  await dialog(page)
    .getByRole('button', { name: 'Listings', exact: true })
    .click();
  await dialog(page)
    .getByRole('button', { name: 'Cancel record', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Confirm cancellation', exact: true })
    .click();
  await page
    .getByRole('heading', { name: 'Your account', exact: true })
    .waitFor();
  await dialog(page)
    .getByRole('button', { name: 'Listings', exact: true })
    .click();
  await dialog(page).getByText('cancelled', { exact: true }).waitFor();
  check(
    'Creator can cancel off-chain intent during RPC outage',
    service.app.store
      .prepare('SELECT status FROM listings WHERE token_id = ?')
      .get('101').status === 'cancelled',
  );
  await dialog(page)
    .getByRole('button', { name: 'Previous records', exact: true })
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
    .getByRole('button', { name: 'Previous records', exact: true })
    .click();
  check(
    'Declining cancellation keeps the legacy request active',
    service.app.store
      .prepare('SELECT status FROM loan_requests WHERE id = ?')
      .get(service.legacy.requestId).status === 'active',
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
    .getByRole('button', { name: 'Previous records', exact: true })
    .click();
  await dialog(page).getByText('cancelled', { exact: true }).waitFor();
  check(
    'Legacy request cancellation remains available during RPC outage and invalidates its old offer',
    service.app.store
      .prepare('SELECT status FROM loan_requests WHERE id = ?')
      .get(service.legacy.requestId).status === 'cancelled' &&
      service.app.store
        .prepare('SELECT status FROM offers WHERE id = ?')
        .get(service.legacy.offerId).status === 'invalidated',
  );
  await close(page);
  service.setUnavailable(false);
  await page.reload({ waitUntil: 'networkidle' });
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('button', { name: 'Marketplace', exact: true })
    .click();
  for (const width of [320, 390, 768, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    check(
      `No horizontal overflow at ${width}px`,
      await page.evaluate(
        () => document.documentElement.scrollWidth === innerWidth,
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
    (await page.locator('.asset-card').count()) === 0 &&
      service.app.store
        .prepare('SELECT status FROM listings WHERE token_id = ?')
        .get('101').status === 'cancelled',
  );
  await account(page);
  await dialog(page)
    .getByRole('button', { name: 'Previous records', exact: true })
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
        suiteVersion: 'pooled-lending-v1',
        scope:
          'Built connected frontend + real HTTP/SQLite, simulated read-only chain and ephemeral EOA providers; no real funds, wallets or transactions',
        checks,
        accessibility,
        errors,
        apiMutations,
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
