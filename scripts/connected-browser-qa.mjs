import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { chromium } from 'playwright';
import { createApp } from '../server/app.mjs';
import { loadConfig } from '../server/config.mjs';

const serverRequire = createRequire(
  new URL('../server/package.json', import.meta.url),
);
const { Wallet, getBytes } = serverRequire('ethers');
const require = createRequire(import.meta.url);
const alice = Wallet.createRandom();
const bob = Wallet.createRandom();
const work = await mkdtemp(join(tmpdir(), 'riftwell-browser-'));
const output = new URL('../docs/qa/', import.meta.url);
const port = Number(process.env.RIFTWELL_QA_PORT ?? 5194);
const base = `http://127.0.0.1:${port}`;
const config = loadConfig({
  NODE_ENV: 'test',
  APP_ORIGIN: base,
  PORT: String(port),
  DB_PATH: join(work, 'application.sqlite'),
  SESSION_SECRET: randomBytes(32).toString('hex'),
  DIST_PATH: resolve(
    process.env.RIFTWELL_CONNECTED_DIST ?? '/tmp/riftwell-connected-qa',
  ),
});
let unavailable = false;
const position = (id) => ({
  id: `kittenswap-${id}`,
  tokenId: id,
  marketId: 'kittenswap',
  owner: alice.address,
  lockedAmountRaw: '123456789012345678901234',
  lockedUntil: new Date(Date.now() + 365 * 86400000).toISOString(),
  votingPowerRaw: '98765432109876543210987',
  blockNumber: 47000000,
  blockHash: `0x${'ab'.repeat(32)}`,
  observedAt: new Date().toISOString(),
});
const checkChain = () => {
  if (unavailable)
    throw Object.assign(new Error('fixture outage'), {
      code: 'CHAIN_UNAVAILABLE',
    });
};
const chain = {
  async health() {
    checkChain();
    return { ready: true, available: true, chainId: 999 };
  },
  async getPosition(id) {
    checkChain();
    if (!['101', '102'].includes(id))
      throw Object.assign(new Error('missing'), { code: 'POSITION_NOT_FOUND' });
    return position(id);
  },
  async getPositions(ids) {
    checkChain();
    return ids.map((id) => (['101', '102'].includes(id) ? position(id) : null));
  },
  async getOwnedPositions(address) {
    checkChain();
    return {
      items:
        address.toLowerCase() === alice.address.toLowerCase()
          ? [position('101'), position('102')]
          : [],
      nextCursor: null,
    };
  },
};
let app;
let browser;
const checks = [];
const accessibility = [];
const errors = [];
const walletMethods = [];
let status = 'failed';
const check = (name, condition) => {
  assert.ok(condition, name);
  checks.push(name);
};
async function start() {
  app = await createApp({ config, chain });
  await app.listen({ host: '127.0.0.1', port });
}
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
      if (request.method === 'personal_sign')
        return wallet.signMessage(getBytes(request.params[0]));
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
  await start();
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
  check(
    'KittenSwap remains sole selected market',
    (await page
      .getByLabel('Select market', { exact: true })
      .locator('option')
      .count()) === 1,
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
  await audit(page, 'purchase blocked review');
  await close(page);
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('button', { name: 'Lending', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Request a loan', exact: true })
    .click();
  await page.getByLabel('Your veKITTEN token ID').fill('102');
  await page.getByRole('button', { name: 'Verify ownership' }).click();
  await dialog(page)
    .getByText(/123,456.*KITTEN/)
    .waitFor();
  await page.getByLabel('Requested amount', { exact: true }).fill('1e3');
  await page.getByRole('button', { name: 'Save borrowing request' }).click();
  check(
    'Malformed money rejected before mutation',
    (await dialog(page).getByRole('alert').textContent()).includes(
      'six decimal',
    ),
  );
  await page.getByLabel('Requested amount', { exact: true }).fill('500');
  await page.getByLabel('Annual rate (%)').fill('12');
  await page.getByLabel('Loan duration').selectOption('14');
  await audit(page, 'borrowing request form');
  await page.getByRole('button', { name: 'Save borrowing request' }).click();
  await dialog(page).waitFor({ state: 'hidden' });
  const lender = await actor(bob);
  await signin(lender.page);
  check(
    'Empty lender ownership state',
    await dialog(lender.page)
      .getByRole('heading', { name: 'No positions found.' })
      .isVisible(),
  );
  await close(lender.page);
  await lender.page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('button', { name: 'Lending', exact: true })
    .click();
  await lender.page.getByRole('button', { name: 'Lend', exact: true }).click();
  await lender.page
    .getByRole('button', { name: 'Make offer', exact: true })
    .click();
  await lender.page.getByLabel('Annual rate (%)').fill('10.25');
  check(
    'Lender cannot change requested principal or duration',
    (await lender.page.getByLabel('Offer amount').getAttribute('readonly')) !==
      null &&
      (await lender.page
        .getByLabel('Loan duration')
        .getAttribute('readonly')) !== null,
  );
  await audit(lender.page, 'lender offer form');
  await lender.page
    .getByRole('button', { name: 'Save unfunded offer' })
    .click();
  await dialog(lender.page).waitFor({ state: 'hidden' });
  await account(page);
  await dialog(page)
    .getByRole('button', { name: 'Received offers', exact: true })
    .click();
  await dialog(page).getByText('10.25% APR', { exact: false }).waitFor();
  check(
    'Borrower receives lender offer with agreed terms',
    (await dialog(page).textContent()).includes('500 USDC') &&
      (await dialog(page).textContent()).includes('14 days'),
  );
  check(
    'Borrower cannot cancel another lender offer',
    (await dialog(page)
      .getByRole('button', { name: 'Cancel offer', exact: true })
      .count()) === 0,
  );
  await audit(page, 'received lending offers');
  await dialog(page)
    .getByRole('button', { name: 'Review offer', exact: true })
    .click();
  check(
    'Offer acceptance remains disabled',
    await page
      .getByRole('button', { name: 'Acceptance unavailable', exact: true })
      .isDisabled(),
  );
  await audit(page, 'borrower offer review');
  await page
    .getByRole('button', { name: 'Back to account', exact: true })
    .click();
  await close(page);
  await app.close();
  await start();
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
  unavailable = true;
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
    .getByRole('button', { name: 'Cancel listing', exact: true })
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
  check('Creator can cancel off-chain intent during RPC outage', true);
  await close(page);
  unavailable = false;
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
  await page.evaluate(() => window.fixtureWalletDisconnect());
  await page.getByRole('button', { name: 'Sign in', exact: true }).waitFor();
  check('Wallet disconnect clears authenticated UI', true);
  check(
    'Only account reads and personal sign reached test wallet',
    walletMethods.every((method) =>
      [
        'eth_accounts',
        'eth_requestAccounts',
        'eth_chainId',
        'personal_sign',
      ].includes(method),
    ),
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
        scope:
          'Built connected frontend + real HTTP/SQLite, simulated read-only chain and ephemeral EOA providers; no real funds, wallets or transactions',
        checks,
        accessibility,
        errors,
      },
      null,
      2,
    ) + '\n',
  );
  await browser?.close();
  await app?.close();
  await rm(work, { recursive: true, force: true });
}
console.log(
  `${checks.length} connected browser checks passed; ${accessibility.length} views audited.`,
);
