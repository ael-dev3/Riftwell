import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium, type Page, type Locator } from 'playwright';
import { decodeLendingFixture, type AuditReport } from './qa-types.ts';
import type { LendingState, LendingActivity } from '../src/lending.ts';
import type { PurchaseReceipt } from '../src/domain.ts';

const require = createRequire(import.meta.url);
const previewURL = new URL(
  process.env.RIFTWELL_PREVIEW_URL ?? 'http://127.0.0.1:5191',
);
previewURL.hash = '';
previewURL.search = '';
const base = previewURL.href.replace(/\/+$/, '');
const output = new URL('../docs/qa/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: 'reduce',
});
await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
  origin: new URL(base).origin,
});
const page = await context.newPage();
const errors: string[] = [];
const externalRequests: string[] = [];
const checks: string[] = [];
const accessibility: AuditReport[] = [];
const screenshots: string[] = [];
const selectedMarketAccent = '#bff4aa';
const marketplaceStorageKey = 'riftwell.marketplace-preview.v3';
const lendingStorageKey = 'riftwell.pooled-lending-preview.v1';
const listingsStorageKey = 'riftwell.preview-listings.v1';
const votesStorageKey = 'riftwell.vote-plan.v1';
const themeStorageKey = 'riftwell.theme';
const legacyStorageKey = 'riftwell.positions-preview.v2';
const epochMs = 604_800_000;
const seedLedger: LendingState = {
  version: 1,
  walletMicros: '25000000000',
  poolCashMicros: '200000000000',
  poolOutstandingMicros: '80000000000',
  totalSharesRaw: '280000000000',
  shareBalanceRaw: '0',
  debtMicros: '0',
  platformFeesMicros: '0',
  collateralIds: [],
  relayerIds: [],
  relayerRepayBps: 0,
  tokenUnits: '20000',
  lockIncreases: {},
  mergedInto: {},
  epoch: 0,
  activity: [],
};
const defaultVotes = {
  version: 1,
  mode: 'optimizer',
  weights: { 'kitten-whype': 4500, 'kitten-usdt0': 3500, 'whype-usdt0': 2000 },
};
const moneyFields = [
  'walletMicros',
  'poolCashMicros',
  'poolOutstandingMicros',
  'totalSharesRaw',
  'shareBalanceRaw',
  'debtMicros',
  'platformFeesMicros',
] as const;
let status = 'failed';
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
page.on('request', (request) => {
  if (!request.url().startsWith(base) && !request.url().startsWith('data:'))
    externalRequests.push(request.url());
});

const check = (name: string, condition: unknown) => {
  assert.ok(condition, name);
  checks.push(name);
};
const dialog = () => page.getByRole('dialog');
const heading = (name: string) => page.getByRole('heading', { level: 1, name });
// page.url() can lag behind history.replaceState, so read the live hash.
const hash = () => page.evaluate(() => location.hash);
const button = (name: string, scope: Page | Locator = page) =>
  scope.getByRole('button', { name, exact: true });
const read = (key: string) =>
  page.evaluate((storageKey) => {
    const value = localStorage.getItem(storageKey);
    return value === null ? null : JSON.parse(value);
  }, key);
const ledger = async (): Promise<LendingState> => {
  const value: unknown = await read(lendingStorageKey);
  decodeLendingFixture(value);
  return value as LendingState;
};
const focused = (locator: Locator) =>
  locator.evaluate((node) => document.activeElement === node);
// Route changes render inside a view transition, so wait briefly for content.
const visible = (locator: Locator) =>
  locator.waitFor({ timeout: 5000 }).then(
    () => true,
    () => false,
  );

/** Wait for short entrance animations; endless or paused ones are ignored. */
async function settle() {
  await page.evaluate(async () => {
    const running = document.getAnimations().filter((animation) => {
      const timing = animation.effect?.getTiming();
      return (
        animation.playState === 'running' &&
        timing?.iterations !== Infinity &&
        Number(timing?.duration) <= 1500
      );
    });
    await Promise.all(
      running.map((animation) => animation.finished.catch(() => {})),
    );
  });
  // Count-up values animate for 700 ms with requestAnimationFrame.
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.count-up')].every(
      (node) => node.getAttribute('data-settled') === 'true',
    ),
  );
}

async function clearToasts() {
  const dismiss = page.getByRole('button', { name: 'Dismiss notification' });
  while ((await dismiss.count()) > 0) await dismiss.first().click();
}

async function audit(name: string) {
  await settle();
  if ((await dialog().count()) > 0) {
    const theme = await dialog().evaluate((node) => {
      const kicker = node.querySelector('.dialog-kicker');
      const probe = document.createElement('span');
      probe.style.color = 'var(--brand-ink)';
      node.append(probe);
      const brandInk = getComputedStyle(probe).color;
      probe.remove();
      return {
        bodyPortal:
          node.parentElement?.parentElement === document.body &&
          node.closest('.app') === null,
        accent: getComputedStyle(node).getPropertyValue('--accent').trim(),
        kickerColor: kicker ? getComputedStyle(kicker).color : null,
        brandInk,
      };
    });
    check(`Dialog mounts in body: ${name}`, theme.bodyPortal);
    check(
      `Market accent and Riftwell identity reach dialog: ${name}`,
      theme.accent === selectedMarketAccent &&
        theme.kickerColor === theme.brandInk,
    );
  }
  if (!(await page.evaluate(() => 'axe' in window)))
    await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
  const result = await page.evaluate(async () =>
    window.axe.run(document, {
      runOnly: {
        type: 'tag',
        values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
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
    passes: result.passes.length,
  });
  check(`Accessibility: ${name}`, result.violations.length === 0);
}

async function fits(name: string) {
  const sizes = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  check(`No horizontal overflow: ${name}`, sizes.scrollWidth <= sizes.width);
}

async function capture(
  file: string,
  options: import('playwright').PageScreenshotOptions = {},
) {
  if ((await dialog().count()) === 0) {
    await clearToasts();
    // Keep documentation captures free of transient focus rings.
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement)
        document.activeElement.blur();
      window.scrollTo(0, 0);
    });
  }
  await settle();
  await page.screenshot({
    path: fileURLToPath(new URL(file, output)),
    animations: 'disabled',
    ...(file.endsWith('.jpg') ? { quality: 82 } : {}),
    ...options,
  });
  screenshots.push(file);
}

async function visit(route: string) {
  await page.goto(`${base}/#${route}`, { waitUntil: 'networkidle' });
  await page.locator('.page-body').waitFor();
}

function baseline(
  name: string,
  state: LendingState,
  expectedWealth: string | null = null,
) {
  check(
    `Other borrowers and suppliers retain their baseline: ${name}`,
    BigInt(state.poolOutstandingMicros) - BigInt(state.debtMicros) ===
      80000000000n &&
      BigInt(state.totalSharesRaw) - BigInt(state.shareBalanceRaw) ===
        280000000000n,
  );
  if (expectedWealth !== null)
    check(
      `Balances conserve funds including debt and fees: ${name}`,
      BigInt(state.walletMicros) +
        BigInt(state.poolCashMicros) +
        BigInt(state.poolOutstandingMicros) +
        BigInt(state.platformFeesMicros) -
        BigInt(state.debtMicros) ===
        BigInt(expectedWealth),
    );
}

const sameMoney = (left: LendingState, right: LendingState) =>
  moneyFields.every((key) => left[key] === right[key]);

async function changedLedger(
  name: string,
  before: LendingState,
  kinds: LendingActivity['kind'] | LendingActivity['kind'][],
  fields: Partial<LendingState>,
  wealth: string | null,
) {
  const added = Array.isArray(kinds) ? kinds : [kinds];
  await page
    .waitForFunction(
      ({ key, count }) =>
        JSON.parse(localStorage.getItem(key) ?? 'null')?.activity.length ===
        count,
      { key: lendingStorageKey, count: before.activity.length + added.length },
      { timeout: 5000 },
    )
    .catch(() => {});
  const state = await ledger();
  check(
    name,
    isDeepStrictEqual(
      state.activity.slice(-added.length).map((entry) => entry.kind),
      added,
    ) &&
      state.activity.length === before.activity.length + added.length &&
      Object.entries(fields).every(
        ([field, value]) => state[field as keyof LendingState] === value,
      ),
  );
  baseline(name, state, wealth);
  return state;
}

async function apply(name: string) {
  await button(name, dialog()).click();
  await dialog().waitFor({ state: 'hidden' });
}

async function epoch(repayment: string, revenue: string) {
  await button('Simulate an epoch').click();
  await dialog()
    .getByLabel('Net rewards for repayment', { exact: true })
    .fill(repayment);
  await dialog()
    .getByLabel('Net lender revenue', { exact: true })
    .fill(revenue);
  await apply('Apply example rewards');
}

async function close() {
  await page.keyboard.press('Escape');
  await dialog().waitFor({ state: 'hidden' });
}

const rows = () => page.locator('.listings-table tbody tr');
const rowTitles = () => rows().locator('.asset-title').allTextContents();
const amount = (text: string) => Number(text.replace(/[^0-9.]/g, ''));

try {
  // ---------- First visit, shell and market ----------
  await page.goto(`${base}/`, { waitUntil: 'networkidle' });
  check('Default route is Borrow', (await hash()) === '#borrow');
  check(
    'Borrow page heading',
    await visible(heading('Borrow against veKITTEN')),
  );
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  check(
    'Three primary sections',
    isDeepStrictEqual(await nav.getByRole('link').allTextContents(), [
      'Borrow',
      'Earn',
      'Marketplace',
    ]),
  );
  check(
    'Current section is marked for assistive technology',
    (await nav
      .getByRole('link', { name: 'Borrow' })
      .getAttribute('aria-current')) === 'page',
  );
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to content' });
  await settle();
  check(
    'Skip link is the first stop and becomes visible on focus',
    (await focused(skip)) &&
      (await skip.evaluate((node) => getComputedStyle(node).opacity)) === '1',
  );
  await page.keyboard.press('Enter');
  check(
    'Skip link moves focus to the main content',
    await page.evaluate(() => document.activeElement?.id === 'main'),
  );
  const marketSelect = page.getByLabel('Select market', { exact: true });
  check(
    'KittenSwap is the selected market',
    (await marketSelect.inputValue()) === 'kittenswap',
  );
  const marketOptions = await marketSelect
    .locator('option')
    .evaluateAll((options) =>
      options.map((option) => {
        if (!(option instanceof HTMLOptionElement))
          throw new Error('Expected market option');
        return { value: option.value, label: option.textContent.trim() };
      }),
    );
  check(
    'KittenSwap is the only available market',
    marketOptions.length === 1 &&
      marketOptions[0]?.value === 'kittenswap' &&
      marketOptions[0]?.label === 'KittenSwap',
  );
  const marketLogo = await page
    .locator('.market-selector .market-logo')
    .evaluate((image) => {
      if (!(image instanceof HTMLImageElement))
        throw new Error('Expected market image');
      return {
        src: image.currentSrc,
        loaded:
          image.complete && image.naturalWidth > 0 && image.naturalHeight > 0,
      };
    });
  check(
    'Supplied KittenSwap logo loads',
    marketLogo.loaded &&
      marketLogo.src === new URL('markets/kittenswap.png', `${base}/`).href,
  );
  check(
    'Selected market accent is applied to the document root',
    (await page.evaluate(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue('--accent')
        .trim(),
    )) === selectedMarketAccent,
  );
  check(
    'Epoch countdown follows weekly UTC periods',
    (await page
      .locator('.epoch-name')
      .textContent()
      .then((text) => text ?? '')) ===
      `Epoch ${Math.floor(Date.now() / epochMs)}`,
  );
  let state = await ledger();
  check(
    'Pooled preview starts with explicit example balances and no user position',
    isDeepStrictEqual(state, seedLedger),
  );
  baseline('initial examples', state, '305000000000');
  check(
    'Three starting demo positions wait in the wallet',
    (await page
      .getByRole('button', { name: /^Deposit Demo veKITTEN #\d+$/ })
      .count()) === 3,
  );
  check(
    'Borrowing waits for collateral',
    await button('Borrow USDC').isDisabled(),
  );
  const assetDetails = page.getByRole('button', {
    name: /vault assets details$/i,
  });
  await assetDetails.click();
  const assetRegion = page.getByRole('region', { name: 'Vault assets' });
  check(
    'Stat details disclose exact example balances',
    (await visible(assetRegion)) &&
      (await assetDetails.getAttribute('aria-expanded')) === 'true' &&
      (await assetRegion.textContent().then((text) => text ?? '')).includes(
        '200,000 USDC',
      ) &&
      (await assetRegion.textContent().then((text) => text ?? '')).includes(
        '80,000 USDC',
      ),
  );
  check(
    'Stat details paint above the workspace below',
    await assetRegion.evaluate((node) => {
      const box = node.getBoundingClientRect();
      const hit = document.elementFromPoint(
        box.left + box.width / 2,
        box.bottom - 12,
      );
      return node.contains(hit);
    }),
  );
  await audit('borrow stat details');
  await page.keyboard.press('Escape');
  check(
    'Escape closes stat details and returns focus',
    (await assetRegion.isHidden()) && (await focused(assetDetails)),
  );
  await audit('borrow desktop');
  await capture('borrow-desktop.jpg', { fullPage: true });

  // ---------- Layout at every width ----------
  for (const route of [
    'borrow',
    'earn',
    'marketplace',
    'simulator',
    'faq',
    'stats',
    'brand',
    'privacy',
  ]) {
    await visit(route);
    for (const width of [320, 390, 768, 1440, 1920]) {
      await page.setViewportSize({ width, height: 1000 });
      await fits(`${route} ${width}`);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await visit('borrow');
  await audit('borrow mobile');
  await capture('borrow-mobile.jpg', { fullPage: true });
  await button('Open menu').click();
  await dialog().getByRole('link', { name: 'Earn' }).waitFor();
  await audit('mobile menu');
  await dialog().getByRole('link', { name: 'Earn' }).click();
  await dialog().waitFor({ state: 'hidden' });
  check(
    'Mobile menu navigates and closes',
    (await hash()) === '#earn' &&
      (await visible(heading('Earn from collateral revenue'))),
  );
  await visit('marketplace');
  await page.setViewportSize({ width: 320, height: 900 });
  await audit('marketplace mobile 320');
  await page.setViewportSize({ width: 390, height: 844 });
  await capture('market-mobile.jpg', { fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });

  // ---------- Marketplace discovery ----------
  check('Marketplace route', (await hash()) === '#marketplace');
  check(
    'Twelve sample listings from other sellers',
    (await rows().count()) === 12,
  );
  await audit('marketplace desktop');
  await capture('market-desktop.jpg', { fullPage: true });
  const search = page.getByLabel('Search positions', { exact: true });
  await search.fill('nonexistent');
  check(
    'Search empty state',
    await visible(page.getByRole('heading', { name: 'No positions found.' })),
  );
  await button('Clear filters').click();
  check('Clearing filters restores listings', (await rows().count()) === 12);
  await search.fill('  #027 ');
  check(
    'Search matches a position number',
    isDeepStrictEqual(await rowTitles(), ['Demo veKITTEN #027']),
  );
  await search.fill('');
  await button('Max lock').click();
  const maxLock = await rows()
    .locator('.position-cell small')
    .allTextContents();
  check(
    'Lock filter keeps only matching listings',
    maxLock.length === 3 &&
      maxLock.every((text) => text.startsWith('Max lock')),
  );
  await button('All locks').click();
  await page.getByLabel('Sort positions').selectOption('price-asc');
  const asks = (
    await rows().locator('td[data-label="Ask USDC"] strong').allTextContents()
  ).map(amount);
  check(
    'Ask sorting runs from the lowest ask',
    asks.length === 12 && asks.every((ask, i) => i === 0 || ask >= asks[i - 1]),
  );
  const discountHeader = page
    .locator('.listings-table thead th')
    .filter({ hasText: 'Discount' });
  await discountHeader.getByRole('button').click();
  check(
    'Column sorting reports its direction',
    (await discountHeader.getAttribute('aria-sort')) === 'descending' &&
      (await rowTitles())[0] === 'Demo veKITTEN #062',
  );
  await page.getByLabel('Sort positions').selectOption('curated');
  // The switch input sits under its styled track; people click the label.
  const hideSmall = page.locator('label.switch', { hasText: 'Hide small' });
  await hideSmall.click();
  check(
    'Small positions can be hidden',
    (await page.getByRole('switch', { name: 'Hide small' }).isChecked()) &&
      (await rows().count()) === 10 &&
      !(await rowTitles()).includes('Demo veKITTEN #095'),
  );
  await hideSmall.click();
  await page.getByLabel('Select all visible listings').check();
  check(
    'Select all picks every visible listing',
    (
      await page
        .getByRole('region', { name: 'Selected listings' })
        .textContent()
        .then((text) => text ?? '')
    )
      .replace(/\s+/g, ' ')
      .trim()
      .startsWith('12 selected'),
  );
  await button('Clear').click();
  check(
    'Clearing the selection hides the sweep bar',
    (await page.getByRole('region', { name: 'Selected listings' }).count()) ===
      0,
  );
  await page.getByRole('slider', { name: 'Sweep' }).fill('3');
  check(
    'The sweep slider selects the first listings in view',
    (
      await page
        .getByRole('region', { name: 'Selected listings' })
        .textContent()
        .then((text) => text ?? '')
    )
      .replace(/\s+/g, ' ')
      .trim()
      .startsWith('3 selected') &&
      (await rows().locator('input[type="checkbox"]:checked').count()) === 3,
  );
  await button('Clear').click();
  await button('Copy link to Demo veKITTEN #062').click();
  await page.getByText('Link to Demo veKITTEN #062 copied.').waitFor();
  check(
    'Each listing row copies its deep link',
    (await page.evaluate(() => navigator.clipboard.readText())) ===
      `${base}/#marketplace/062`,
  );
  const metrics = page.getByRole('group', { name: 'Metric' });
  const ranges = page.getByRole('group', { name: 'Range' });
  await metrics.getByRole('button', { name: 'Volume' }).click();
  await ranges.getByRole('button', { name: 'All' }).click();
  check(
    'Market stats switch metric and range',
    (await metrics
      .getByRole('button', { name: 'Volume' })
      .getAttribute('aria-pressed')) === 'true' &&
      (
        await page
          .locator('.stat-headline')
          .textContent()
          .then((text) => text ?? '')
      ).includes('USDC') &&
      (await page.locator('.market-side .chart').count()) === 1,
  );
  await metrics.getByRole('button', { name: 'Discount' }).click();
  await ranges.getByRole('button', { name: '30D' }).click();

  // Details, focus containment and deep links.
  const detailTrigger = button('View Demo veKITTEN #027');
  await detailTrigger.click();
  await dialog().waitFor();
  check(
    'Details open as a shareable link',
    (await hash()) === '#marketplace/027',
  );
  check(
    'Position lock and reference value shown',
    (
      await dialog()
        .textContent()
        .then((text) => text ?? '')
    ).includes('6,500 USDC') &&
      (
        await dialog()
          .textContent()
          .then((text) => text ?? '')
      ).includes('2 Apr 2028'),
  );
  await audit('position details');
  await page.keyboard.press('Shift+Tab');
  check(
    'Backward focus stays in dialog',
    await dialog().evaluate((node) => node.contains(document.activeElement)),
  );
  for (let i = 0; i < 12; i++) await page.keyboard.press('Tab');
  check(
    'Forward focus stays in dialog',
    await dialog().evaluate((node) => node.contains(document.activeElement)),
  );
  await button('Copy link', dialog()).click();
  await page.getByText('Listing link copied.').waitFor();
  check(
    'Copy link shares the deep link',
    (await page.evaluate(() => navigator.clipboard.readText())) ===
      `${base}/#marketplace/027`,
  );
  await close();
  check(
    'Closing details restores the route and focus',
    (await hash()) === '#marketplace' && (await focused(detailTrigger)),
  );
  await visit('marketplace/104');
  check(
    'A deep link opens that listing',
    await visible(
      dialog().getByRole('heading', { name: 'Demo veKITTEN #104' }),
    ),
  );
  await button('Review purchase', dialog()).click();
  check(
    'Details lead into the purchase review',
    await visible(
      dialog().getByRole('heading', { name: 'Buy Demo veKITTEN #104' }),
    ),
  );
  await close();

  // ---------- Earn: supply and withdraw ----------
  await nav.getByRole('link', { name: 'Earn' }).click();
  check(
    'Earn route',
    (await hash()) === '#earn' &&
      (await visible(heading('Earn from collateral revenue'))),
  );
  check(
    'Withdraw is disabled before supplying',
    await button('Withdraw').isDisabled(),
  );
  await button('Supply USDC').first().click();
  await dialog().getByLabel('Supply amount', { exact: true }).fill('1000');
  await audit('vault supply review');
  state = await ledger();
  let before = state;
  await apply('Supply in preview');
  state = await changedLedger(
    'Supply exchanges exact USDC for vault shares',
    before,
    'supply',
    {
      walletMicros: '24000000000',
      poolCashMicros: '201000000000',
      shareBalanceRaw: '1000000000',
      totalSharesRaw: '281000000000',
      debtMicros: '0',
      platformFeesMicros: '0',
    },
    '305000000000',
  );
  check(
    'Supply records minted shares',
    state.activity.at(-1)?.sharesRaw === '1000000000',
  );
  await button('Withdraw').click();
  await dialog().getByLabel('Withdrawal amount', { exact: true }).fill('250');
  await audit('vault withdrawal review');
  before = state;
  await apply('Withdraw in preview');
  state = await changedLedger(
    'Withdraw returns liquid USDC and burns shares',
    before,
    'withdraw',
    {
      walletMicros: '24250000000',
      poolCashMicros: '200750000000',
      shareBalanceRaw: '750000000',
      totalSharesRaw: '280750000000',
    },
    '305000000000',
  );
  check(
    'Earn shows the share position and vault activity',
    (
      await page
        .locator('.vault-metrics')
        .textContent()
        .then((text) => text ?? '')
    ).includes('750 shares') &&
      (await page
        .getByRole('table', { name: 'Vault activity in this browser' })
        .locator('tbody tr')
        .count()) === 2,
  );
  await button('How it works').click();
  await dialog().waitFor();
  await audit('vault details');
  await close();
  await audit('earn desktop');
  await capture('earn-desktop.jpg', { fullPage: true });

  // ---------- Borrow: collateral, credit and rewards ----------
  await nav.getByRole('link', { name: 'Borrow' }).click();
  check('Main navigation links Earn to Borrow', (await hash()) === '#borrow');
  await button('Deposit Demo veKITTEN #041').click();
  await dialog().waitFor();
  await page.setViewportSize({ width: 320, height: 900 });
  await fits('collateral deposit dialog mobile');
  await audit('collateral deposit mobile');
  await page.setViewportSize({ width: 1440, height: 1000 });
  before = state;
  await apply('Deposit in preview');
  state = await changedLedger(
    'Collateral deposit opens a credit line without moving USDC',
    before,
    'deposit-collateral',
    {},
    '305000000000',
  );
  check(
    'Only the selected position is deposited',
    isDeepStrictEqual(state.collateralIds, ['rift-041']) &&
      sameMoney(state, before),
  );
  check(
    'Credit line shows the example limit',
    (
      await page
        .locator('.credit-metrics')
        .textContent()
        .then((text) => text ?? '')
    ).includes('2,000 USDC'),
  );

  // Vote planning for the deposited position.
  await page.getByRole('tab', { name: 'Vote' }).click();
  const planner = page.locator('.vote-planner');
  check(
    'Optimizer plan follows the example weights',
    (await planner.locator('tbody tr').count()) === 5 &&
      (await planner.textContent().then((text) => text ?? '')).includes(
        '45%',
      ) &&
      (await button('Save plan').isDisabled()),
  );
  await page.getByRole('radio', { name: /Manual weights/ }).check();
  await button('Even split').click();
  await page
    .getByLabel('Weight for KITTEN / WHYPE, percent', { exact: true })
    .fill('50');
  check(
    'Manual weights must total 100%',
    (await planner.textContent().then((text) => text ?? '')).includes(
      'weights must add up to 100%',
    ) && (await button('Save plan').isDisabled()),
  );
  await button('Even split').click();
  await audit('vote planner');
  await button('Save plan').click();
  await page.getByText('Vote plan saved in this browser.').waitFor();
  const savedVotes = await read(votesStorageKey);
  check(
    'Vote plan saves locally without changing balances',
    savedVotes.mode === 'manual' &&
      Object.values(savedVotes.weights).reduce<number>((a, b) => {
        assert.equal(typeof b, 'number');
        return a + (b as number);
      }, 0) === 10000 &&
      sameMoney(await ledger(), state),
  );
  const projected = (
    await planner
      .locator('.mini-stats dd')
      .nth(1)
      .textContent()
      .then((text) => text ?? '')
  ).replace(/[^0-9.]/g, '');
  await button('Simulate an epoch with this plan').click();
  check(
    'The plan prefills an epoch with its example reward',
    (await dialog()
      .getByLabel('Net rewards for repayment', { exact: true })
      .inputValue()) === projected,
  );
  await close();
  await page.getByRole('tab', { name: 'Positions' }).click();

  await button('Borrow USDC').click();
  const borrowAmount = dialog().getByLabel('Borrow amount', { exact: true });
  const rejectedBefore = await ledger();
  for (const invalid of ['999999', '1e3', '0x10', '1.0000001', '0']) {
    await borrowAmount.fill(invalid);
    await button('Borrow in preview', dialog()).click();
    check(
      `Reject invalid borrow amount ${invalid} without changing balances`,
      (await borrowAmount.getAttribute('aria-invalid')) === 'true' &&
        (
          await dialog()
            .getByRole('alert')
            .textContent()
            .then((text) => text ?? '')
        ).trim().length > 0 &&
        (await focused(borrowAmount)) &&
        isDeepStrictEqual(await ledger(), rejectedBefore),
    );
  }
  await borrowAmount.fill('1000');
  const borrowText = await dialog()
    .textContent()
    .then((text) => text ?? '');
  check(
    'Draw fee, net wallet proceeds and gross debt are separate',
    borrowText.includes('5 USDC') &&
      borrowText.includes('995 USDC') &&
      borrowText.includes('1,000 USDC'),
  );
  await audit('pooled borrowing review');
  before = state;
  await apply('Borrow in preview');
  state = await changedLedger(
    'Borrow moves gross principal from vault cash into debt',
    before,
    'borrow',
    {
      walletMicros: '25245000000',
      poolCashMicros: '199750000000',
      poolOutstandingMicros: '81000000000',
      debtMicros: '1000000000',
      platformFeesMicros: '5000000',
    },
    '305000000000',
  );
  check(
    'Borrow records the exact one-time 0.5% origination fee',
    state.activity.at(-1)?.feeMicros === '5000000',
  );
  check(
    'Credit line estimates repayment from the example reward',
    (
      await page
        .locator('.credit-foot')
        .textContent()
        .then((text) => text ?? '')
    ).includes('About 20 epochs to repay'),
  );
  check(
    'Debt prevents removing the only collateral position',
    await button('Remove Demo veKITTEN #041').isDisabled(),
  );
  await capture('preview.png', { fullPage: false });
  before = state;
  await epoch('0', '0');
  state = await changedLedger(
    'A zero-reward epoch does not invent interest or repayment',
    before,
    'epoch',
    { epoch: 1 },
    '305000000000',
  );
  check(
    'Zero epoch preserves every financial balance',
    sameMoney(state, before),
  );
  await button('Simulate an epoch').click();
  await dialog()
    .getByLabel('Net rewards for repayment', { exact: true })
    .fill('25');
  const poolReward = dialog().getByLabel('Net lender revenue', { exact: true });
  await poolReward.fill('1000.000001');
  await button('Apply example rewards', dialog()).click();
  check(
    'Out-of-range epoch revenue is rejected without a partial repayment',
    (
      await dialog()
        .getByRole('alert')
        .textContent()
        .then((text) => text ?? '')
    ).includes('1,000 USDC') &&
      (await focused(poolReward)) &&
      isDeepStrictEqual(await ledger(), state),
  );
  await poolReward.fill('100');
  await audit('variable reward epoch');
  before = state;
  await apply('Apply example rewards');
  state = await changedLedger(
    'Variable net rewards repay debt while separate revenue increases vault value',
    before,
    'epoch',
    {
      epoch: 2,
      walletMicros: '25245000000',
      poolCashMicros: '199875000000',
      poolOutstandingMicros: '80975000000',
      debtMicros: '975000000',
      shareBalanceRaw: '750000000',
      totalSharesRaw: '280750000000',
    },
    '305125000000',
  );
  check(
    'Reward repayment is not counted twice as lender yield',
    state.activity.at(-1)?.rewardRepaidMicros === '25000000' &&
      state.activity.at(-1)?.poolYieldMicros === '100000000' &&
      BigInt(state.poolCashMicros) +
        BigInt(state.poolOutstandingMicros) -
        BigInt(before.poolCashMicros) -
        BigInt(before.poolOutstandingMicros) ===
        100000000n,
  );
  await button('Repay').click();
  const repayment = dialog().getByLabel('Repayment amount', { exact: true });
  await repayment.fill('976');
  await button('Repay in preview', dialog()).click();
  check(
    'Manual repayment cannot exceed the outstanding debt',
    (await repayment.getAttribute('aria-invalid')) === 'true' &&
      isDeepStrictEqual(await ledger(), state),
  );
  await repayment.fill('175');
  await audit('manual repayment');
  before = state;
  await apply('Repay in preview');
  state = await changedLedger(
    'Manual repayment returns wallet cash to the vault and reduces debt',
    before,
    'repay',
    {
      walletMicros: '25070000000',
      poolCashMicros: '200050000000',
      poolOutstandingMicros: '80800000000',
      debtMicros: '800000000',
    },
    '305125000000',
  );
  before = state;
  await epoch('900', '0');
  state = await changedLedger(
    'Rewards clear remaining debt and route only the surplus to the wallet',
    before,
    'epoch',
    {
      epoch: 3,
      walletMicros: '25170000000',
      poolCashMicros: '200850000000',
      poolOutstandingMicros: '80000000000',
      debtMicros: '0',
    },
    '306025000000',
  );
  check(
    'Repayment and surplus are independently recorded',
    state.activity.at(-1)?.rewardRepaidMicros === '800000000' &&
      state.activity.at(-1)?.rewardSurplusMicros === '100000000',
  );
  await button('Remove Demo veKITTEN #041').click();
  before = state;
  await apply('Remove in preview');
  state = await changedLedger(
    'Repaid collateral can be removed without erasing accounting',
    before,
    'remove-collateral',
    {},
    '306025000000',
  );
  check(
    'Removed collateral returns to the wallet list',
    state.collateralIds.length === 0 &&
      sameMoney(state, before) &&
      (await button('Deposit Demo veKITTEN #041').isEnabled()),
  );
  await page.getByRole('tab', { name: 'Activity' }).click();
  const activityRows = page
    .getByRole('table', { name: 'Borrowing activity in this browser' })
    .locator('tbody tr');
  check(
    'Activity lists every borrowing event',
    (await activityRows.count()) === 7,
  );
  await button('Epochs').click();
  check(
    'Activity filters by event type',
    (await activityRows.count()) === 3 &&
      (
        await activityRows
          .first()
          .textContent()
          .then((text) => text ?? '')
      ).includes('Reward epoch'),
  );
  await audit('borrow activity');
  await page.getByRole('tab', { name: 'Positions' }).click();

  // ---------- Reward relayer: rewards without borrowing ----------
  await button('Add Demo veKITTEN #012 to the relayer').click();
  await dialog().waitFor();
  const relayerReview = await dialog()
    .textContent()
    .then((text) => text ?? '');
  check(
    'Relayer review shows the example reward and no credit',
    relayerReview.includes('Credit from this position') &&
      relayerReview.includes('100 USDC'),
  );
  await audit('relayer review');
  before = state;
  await apply('Add to relayer in preview');
  state = await changedLedger(
    'Adding a position to the relayer moves no funds and opens no credit',
    before,
    'relayer-deposit',
    {},
    '306025000000',
  );
  check(
    'The relayer holds the position apart from collateral and the wallet',
    isDeepStrictEqual(state.relayerIds, ['rift-012']) &&
      state.collateralIds.length === 0 &&
      sameMoney(state, before) &&
      (await button('Deposit Demo veKITTEN #012').count()) === 0 &&
      (await visible(button('Remove Demo veKITTEN #012 from the relayer'))),
  );
  await button('Simulate an epoch').click();
  const relayerReward = dialog().getByLabel('Net relayer rewards', {
    exact: true,
  });
  check(
    'An epoch prefills relayer rewards, which cannot repay debt',
    (await relayerReward.inputValue()) === '100' &&
      (await dialog()
        .getByLabel('Net rewards for repayment', { exact: true })
        .isDisabled()),
  );
  await relayerReward.fill('1000.000001');
  await button('Apply example rewards', dialog()).click();
  check(
    'Out-of-range relayer rewards are rejected without changes',
    (
      await dialog()
        .getByRole('alert')
        .textContent()
        .then((text) => text ?? '')
    ).includes('relayer reward') &&
      (await focused(relayerReward)) &&
      isDeepStrictEqual(await ledger(), state),
  );
  await relayerReward.fill('100');
  await dialog().getByLabel('Net lender revenue', { exact: true }).fill('0');
  await audit('relayer epoch');
  before = state;
  await apply('Apply example rewards');
  state = await changedLedger(
    'Relayer rewards are paid to the wallet without touching the vault',
    before,
    'epoch',
    {
      epoch: 4,
      walletMicros: '25270000000',
      poolCashMicros: '200850000000',
      poolOutstandingMicros: '80000000000',
      debtMicros: '0',
    },
    '306125000000',
  );
  check(
    'The epoch records relayer rewards separately from repayment',
    state.activity.at(-1)?.relayerRewardMicros === '100000000' &&
      state.activity.at(-1)?.rewardRepaidMicros === '0',
  );
  await button('Remove Demo veKITTEN #012 from the relayer').click();
  before = state;
  await apply('Remove from relayer in preview');
  state = await changedLedger(
    'Removing a position from the relayer keeps the accounting',
    before,
    'relayer-withdraw',
    {},
    '306125000000',
  );
  check(
    'A removed relayer position can be deposited again',
    state.relayerIds.length === 0 &&
      (await button('Deposit Demo veKITTEN #012').isEnabled()),
  );
  await nav.getByRole('link', { name: 'Earn' }).click();
  await button('How it works').click();
  const spans = dialog().getByRole('group', { name: 'Epochs shown' });
  await spans.getByRole('button', { name: '4 epochs' }).click();
  check(
    'Vault history switches between epoch ranges',
    (await spans.getByRole('button').count()) === 3 &&
      (await spans
        .getByRole('button', { name: '4 epochs' })
        .getAttribute('aria-pressed')) === 'true' &&
      (await dialog().locator('.chart').count()) === 1,
  );
  await audit('vault history ranges');
  await close();

  // ---------- Merge and increase lock, from a fresh preview ----------
  // Run apart from the main ledger, then restore it for the remaining checks.
  const savedStorage = await page.evaluate(() =>
    Object.fromEntries(Object.entries(localStorage)),
  );
  // A hash-only navigation keeps the running app, so reload it explicitly.
  await visit('borrow');
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('.page-body').waitFor();
  await page.waitForFunction(
    (key) => localStorage.getItem(key) !== null,
    lendingStorageKey,
  );
  let merging = await ledger();
  check(
    'A fresh preview starts with demo KITTEN to lock and no merges',
    merging.tokenUnits === '20000' &&
      isDeepStrictEqual(merging.lockIncreases, {}) &&
      isDeepStrictEqual(merging.mergedInto, {}),
  );
  await button('Deposit Demo veKITTEN #012').click();
  let previous = merging;
  await apply('Deposit in preview');
  merging = await changedLedger(
    'A position is deposited before merging',
    previous,
    'deposit-collateral',
    {},
    '305000000000',
  );
  await button('Merge a wallet position into Demo veKITTEN #012').click();
  const mergeSource = dialog().getByLabel('Wallet position to merge', {
    exact: true,
  });
  const firstMerge = await dialog()
    .textContent()
    .then((text) => text ?? '');
  check(
    'The merge review starts with the first wallet position',
    (await mergeSource.inputValue()) === 'rift-041' &&
      firstMerge.includes('150,000 KITTEN') &&
      firstMerge.includes('6,000 USDC'),
  );
  await mergeSource.selectOption('rift-018');
  const mergeReview = await dialog()
    .textContent()
    .then((text) => text ?? '');
  check(
    'The merge review shows the combined lock, later unlock and credit',
    mergeReview.includes('180,000 KITTEN') &&
      mergeReview.includes('1 Oct 2028') &&
      mergeReview.includes('180 USDC') &&
      mergeReview.includes('7,200 USDC'),
  );
  await audit('merge review');
  await capture('merge-review.jpg');
  previous = merging;
  await apply('Merge in preview');
  merging = await changedLedger(
    'Merging records the merge and moves no USDC',
    previous,
    'merge',
    { debtMicros: '0', walletMicros: '25000000000' },
    '305000000000',
  );
  const collateralBlock = page.locator('[aria-labelledby="collateral-title"]');
  check(
    'The merged position joins the collateral and leaves the wallet',
    isDeepStrictEqual(merging.mergedInto, { 'rift-018': 'rift-012' }) &&
      isDeepStrictEqual(merging.collateralIds, ['rift-012']) &&
      sameMoney(merging, previous) &&
      (await button('Deposit Demo veKITTEN #018').count()) === 0 &&
      (await collateralBlock.textContent().then((text) => text ?? '')).includes(
        '180,000 KITTEN',
      ) &&
      (
        await page
          .locator('.credit-metrics')
          .textContent()
          .then((text) => text ?? '')
      ).includes('7,200 USDC'),
  );
  await button('Increase the lock of Demo veKITTEN #012').click();
  const lockUnits = dialog().getByLabel('KITTEN to add', { exact: true });
  check(
    'A lock increase starts from the whole demo KITTEN balance',
    (await lockUnits.inputValue()) === '20000',
  );
  await lockUnits.fill('25000');
  await button('Increase lock in preview', dialog()).click();
  check(
    'Lock increases above the demo balance are rejected without changes',
    (
      await dialog()
        .getByRole('alert')
        .textContent()
        .then((text) => text ?? '')
    ).includes('from 1 to 20,000 KITTEN') &&
      (await focused(lockUnits)) &&
      isDeepStrictEqual(await ledger(), merging),
  );
  await lockUnits.fill('5,000');
  const increaseReview = await dialog()
    .textContent()
    .then((text) => text ?? '');
  check(
    'The lock increase review shows the new lock, credit and balance',
    increaseReview.includes('185,000 KITTEN') &&
      increaseReview.includes('7,400 USDC') &&
      increaseReview.includes('15,000 KITTEN'),
  );
  await audit('lock increase review');
  previous = merging;
  await apply('Increase lock in preview');
  merging = await changedLedger(
    'A lock increase moves demo KITTEN, not USDC',
    previous,
    'increase-lock',
    { tokenUnits: '15000' },
    '305000000000',
  );
  check(
    'The increased lock raises credit',
    isDeepStrictEqual(merging.lockIncreases, { 'rift-012': '5000' }) &&
      sameMoney(merging, previous) &&
      (await collateralBlock.textContent().then((text) => text ?? '')).includes(
        '185,000 KITTEN',
      ) &&
      (
        await page
          .locator('.credit-metrics')
          .textContent()
          .then((text) => text ?? '')
      ).includes('7,400 USDC'),
  );
  await button('Borrow USDC').click();
  await dialog().getByLabel('Borrow amount', { exact: true }).fill('7000');
  previous = merging;
  await apply('Borrow in preview');
  merging = await changedLedger(
    'Credit from merged and added units can be borrowed',
    previous,
    'borrow',
    { debtMicros: '7000000000', walletMicros: '31965000000' },
    '305000000000',
  );
  check(
    'Collateral backing that debt cannot be removed',
    await button('Remove Demo veKITTEN #012').isDisabled(),
  );
  await button('Add Demo veKITTEN #041 to the relayer').click();
  previous = merging;
  await apply('Add to relayer in preview');
  merging = await changedLedger(
    'A wallet position joins the relayer beside merged collateral',
    previous,
    'relayer-deposit',
    {},
    '305000000000',
  );
  await button('Relayer strategy: Rewards paid out').click();
  await dialog()
    .getByLabel('Share that repays debt', { exact: true })
    .fill('50');
  const strategyReview = await dialog()
    .textContent()
    .then((text) => text ?? '');
  check(
    'The relayer strategy previews how its rewards are split',
    strategyReview.includes('50% repays debt') &&
      strategyReview.includes('25 USDC') &&
      strategyReview.includes('7,000 USDC'),
  );
  await audit('relayer strategy');
  previous = merging;
  await apply('Save strategy');
  await page.waitForFunction(
    (key) =>
      JSON.parse(localStorage.getItem(key) ?? 'null')?.relayerRepayBps === 5000,
    lendingStorageKey,
  );
  merging = await ledger();
  check(
    'Saving a relayer strategy changes only its repayment share',
    merging.activity.length === previous.activity.length &&
      sameMoney(merging, previous) &&
      (await visible(button('Relayer strategy: 50% repays debt'))),
  );
  await button('Simulate an epoch').click();
  await dialog()
    .getByLabel('Net rewards for repayment', { exact: true })
    .fill('0');
  check(
    'The epoch prefills the relayer position’s example rewards',
    (await dialog()
      .getByLabel('Net relayer rewards', { exact: true })
      .inputValue()) === '50',
  );
  await dialog().getByLabel('Net lender revenue', { exact: true }).fill('0');
  const splitReview = await dialog()
    .textContent()
    .then((text) => text ?? '');
  check(
    'The epoch review splits relayer rewards between debt and balance',
    splitReview.includes('Relayer rewards repaying debt') &&
      splitReview.includes('6,975 USDC'),
  );
  previous = merging;
  await apply('Apply example rewards');
  merging = await changedLedger(
    'Half of the relayer rewards repays debt and half is paid out',
    previous,
    'epoch',
    { debtMicros: '6975000000', walletMicros: '31990000000' },
    '305050000000',
  );
  check(
    'The epoch records the relayer repayment',
    merging.activity.at(-1)?.relayerRewardMicros === '50000000' &&
      merging.activity.at(-1)?.relayerRepaidMicros === '25000000',
  );
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('.page-body').waitFor();
  check(
    'Merges, increases and the debt they support survive a reload',
    isDeepStrictEqual(await ledger(), merging) &&
      (
        await page
          .locator('.credit-metrics')
          .textContent()
          .then((text) => text ?? '')
      ).includes('7,400 USDC'),
  );
  await page.getByRole('tab', { name: 'Activity' }).click();
  const mergeActivity = await page
    .locator('.activity-table')
    .textContent()
    .then((text) => text ?? '');
  check(
    'Activity lists the merge, the lock increase and relayer repayment',
    mergeActivity.includes('Positions merged') &&
      mergeActivity.includes('Demo veKITTEN #018 into Demo veKITTEN #012') &&
      mergeActivity.includes('Lock increased') &&
      mergeActivity.includes('+5,000 KITTEN') &&
      mergeActivity.includes('(25 USDC to debt)'),
  );
  await page.getByRole('tab', { name: 'Positions' }).click();
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await fits(`merged collateral at ${width}px`);
  }
  await audit('merged collateral mobile');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate((saved) => {
    localStorage.clear();
    for (const [key, value] of Object.entries(saved))
      localStorage.setItem(key, value);
  }, savedStorage);
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('.page-body').waitFor();
  check(
    'The main preview is restored after the merge checks',
    isDeepStrictEqual(await ledger(), state),
  );

  // ---------- Marketplace: buy, buy into relayer and credit, sweep, list ----------
  await nav.getByRole('link', { name: 'Marketplace' }).click();
  await button('Buy Demo veKITTEN #009').click();
  const walletBuy = await dialog()
    .textContent()
    .then((text) => text ?? '');
  check(
    'Purchase review defaults to the wallet when the balance covers the ask',
    (await dialog()
      .getByRole('radio', { name: /Demo wallet/ })
      .isChecked()) &&
      walletBuy.includes('15.5 USDC') &&
      walletBuy.includes('22,170 USDC'),
  );
  await audit('purchase review');
  before = state;
  await button('Buy in preview', dialog()).click();
  await dialog().getByRole('heading', { name: 'Purchase saved' }).waitFor();
  check(
    'Purchase receipt confirms the wallet destination',
    (
      await dialog()
        .textContent()
        .then((text) => text ?? '')
    ).includes('is now in your demo wallet'),
  );
  await audit('purchase receipt');
  await button('Continue browsing', dialog()).click();
  state = await changedLedger(
    'A wallet purchase spends demo USDC and records the seller fee',
    before,
    'purchase',
    { walletMicros: '22170000000', platformFeesMicros: '20500000' },
    '303040500000',
  );
  check(
    'Bought listing leaves the market',
    !(await rowTitles()).includes('Demo veKITTEN #009'),
  );
  await button('Buy Demo veKITTEN #073').click();
  await dialog()
    .getByRole('radio', { name: /Reward relayer/ })
    .check();
  const relayerBuy = await dialog()
    .textContent()
    .then((text) => text ?? '');
  check(
    'Buying into the relayer lists its steps and needs no borrowing',
    relayerBuy.includes('Add to relayer') &&
      relayerBuy.includes('Pay seller') &&
      relayerBuy.includes('21,150 USDC') &&
      (await dialog()
        .getByLabel('Borrow against this purchase', { exact: true })
        .count()) === 0,
  );
  await audit('purchase into relayer');
  before = state;
  await button('Buy into relayer in preview', dialog()).click();
  await dialog().getByRole('heading', { name: 'Purchase saved' }).waitFor();
  check(
    'Receipt confirms the relayer destination',
    (
      await dialog()
        .textContent()
        .then((text) => text ?? '')
    ).includes('in the reward relayer'),
  );
  await button('Continue browsing', dialog()).click();
  state = await changedLedger(
    'Buying into the relayer deposits the position there and pays the seller',
    before,
    ['relayer-deposit', 'purchase'],
    { walletMicros: '21150000000', platformFeesMicros: '25600000' },
    '302025600000',
  );
  check(
    'The bought position collects rewards in the relayer',
    isDeepStrictEqual(state.relayerIds, ['rift-073']),
  );
  await button('Buy Demo veKITTEN #156').click();
  const creditLine = dialog().getByRole('radio', { name: /Credit line/ });
  check(
    'A purchase the wallet cannot cover defaults to the credit line',
    (await creditLine.isChecked()) &&
      (await dialog()
        .getByLabel('Borrow against this purchase', { exact: true })
        .inputValue()) === '5226.130654',
  );
  await dialog()
    .getByRole('radio', { name: /Demo wallet/ })
    .check();
  await button('Buy in preview', dialog()).click();
  check(
    'A wallet purchase above the balance is rejected',
    (
      await dialog()
        .getByRole('alert')
        .textContent()
        .then((text) => text ?? '')
    ).includes('does not cover the ask') &&
      isDeepStrictEqual(await ledger(), state),
  );
  await creditLine.check();
  const buyBorrow = dialog().getByLabel('Borrow against this purchase', {
    exact: true,
  });
  await buyBorrow.fill('12400.000001');
  await button('Buy & deposit in preview', dialog()).click();
  check(
    'Borrowing beyond the new credit is rejected',
    (await buyBorrow.getAttribute('aria-invalid')) === 'true' &&
      (
        await dialog()
          .getByRole('alert')
          .textContent()
          .then((text) => text ?? '')
      ).includes('12,400 USDC') &&
      isDeepStrictEqual(await ledger(), state),
  );
  await buyBorrow.fill('6000');
  const creditBuy = await dialog()
    .textContent()
    .then((text) => text ?? '');
  check(
    'Buying into credit shows net borrowing, wallet share and balance after',
    creditBuy.includes('5,970 USDC') &&
      creditBuy.includes('20,380 USDC') &&
      creditBuy.includes('770 USDC'),
  );
  await audit('purchase into credit line');
  await capture('buy-review.jpg');
  before = state;
  await button('Buy & deposit in preview', dialog()).click();
  await dialog().getByRole('heading', { name: 'Purchase saved' }).waitFor();
  check(
    'Receipt confirms the position is collateral',
    (
      await dialog()
        .textContent()
        .then((text) => text ?? '')
    ).includes('deposited as collateral'),
  );
  await button('Continue browsing', dialog()).click();
  state = await changedLedger(
    'Buying into credit deposits, borrows and pays in one step',
    before,
    ['deposit-collateral', 'borrow', 'purchase'],
    {
      walletMicros: '770000000',
      poolCashMicros: '194850000000',
      poolOutstandingMicros: '86000000000',
      debtMicros: '6000000000',
      platformFeesMicros: '187350000',
    },
    '275807350000',
  );
  check(
    'The purchased position backs the credit line',
    isDeepStrictEqual(state.collateralIds, ['rift-156']),
  );
  await page.getByLabel('Select Demo veKITTEN #095').check();
  await page.getByLabel('Select Demo veKITTEN #133').check();
  await page.getByLabel('Select Demo veKITTEN #062').check();
  const sweepBar = page.getByRole('region', { name: 'Selected listings' });
  check(
    'Sweep bar warns when the selection exceeds the balance',
    (await sweepBar.textContent().then((text) => text ?? '')).includes(
      'Exceeds demo balance',
    ),
  );
  await button('Buy selected').click();
  check(
    'An unaffordable sweep cannot be confirmed',
    await button('Buy 3 positions in preview', dialog()).isDisabled(),
  );
  await close();
  await page.getByLabel('Select Demo veKITTEN #062').uncheck();
  await button('Buy selected').click();
  const sweepText = await dialog()
    .textContent()
    .then((text) => text ?? '');
  check(
    'Sweep review totals asks and seller fees',
    sweepText.includes('320 USDC') &&
      sweepText.includes('1.6 USDC') &&
      sweepText.includes('450 USDC'),
  );
  await audit('sweep review');
  before = state;
  await button('Buy 2 positions in preview', dialog()).click();
  await dialog().getByRole('heading', { name: '2 purchases saved' }).waitFor();
  await button('Continue browsing', dialog()).click();
  state = await changedLedger(
    'A sweep buys each selected listing into the wallet',
    before,
    ['purchase', 'purchase'],
    { walletMicros: '450000000', platformFeesMicros: '188950000' },
    '275488950000',
  );
  const receipts = (await read(marketplaceStorageKey)).receipts;
  check(
    'Receipts record each purchase and its destination',
    isDeepStrictEqual(
      receipts.map((receipt: PurchaseReceipt) => [
        receipt.assetId,
        receipt.destination,
      ]),
      [
        ['rift-009', 'wallet'],
        ['rift-073', 'relayer'],
        ['rift-156', 'collateral'],
        ['rift-095', 'wallet'],
        ['rift-133', 'wallet'],
      ],
    ),
  );
  check(
    'Selection clears after the sweep',
    (await page.getByRole('region', { name: 'Selected listings' }).count()) ===
      0,
  );

  await button('List a position').click();
  await dialog()
    .getByLabel('Position', { exact: true })
    .selectOption('rift-018');
  const askPrice = dialog().getByLabel('Ask price', { exact: true });
  for (const invalid of ['0.5', '1e3', '1000000.000001']) {
    await askPrice.fill(invalid);
    await button('List in preview', dialog()).click();
    check(
      `Reject invalid ask ${invalid}`,
      (await askPrice.getAttribute('aria-invalid')) === 'true' &&
        (await read(listingsStorageKey)).listings.length === 0,
    );
  }
  await askPrice.fill('7000');
  const sellText = await dialog()
    .textContent()
    .then((text) => text ?? '');
  check(
    'Listing review shows the seller fee charged only at settlement',
    sellText.includes('35 USDC') && sellText.includes('6,965 USDC'),
  );
  await audit('listing review');
  await apply('List in preview');
  const book = await read(listingsStorageKey);
  const listing = book.listings[0];
  check(
    'Listing saves a seven-day public ask without moving funds',
    book.listings.length === 1 &&
      listing.assetId === 'rift-018' &&
      listing.priceMicros === '7000000000' &&
      listing.status === 'active' &&
      listing.buyer === null &&
      Date.parse(listing.expiresAt) - Date.parse(listing.createdAt) ===
        7 * 86_400_000 &&
      sameMoney(await ledger(), state),
  );
  check(
    'Your listing appears in the market with a cancel action',
    await visible(button('Cancel listing for Demo veKITTEN #018')),
  );
  await page.getByRole('tab', { name: 'Your listings' }).click();
  check(
    'Your listings tab shows the active ask',
    (
      await page
        .getByRole('tabpanel')
        .textContent()
        .then((text) => text ?? '')
    ).includes('7,000 USDC'),
  );
  await audit('your listings');
  await nav.getByRole('link', { name: 'Borrow' }).click();
  check(
    'A listed position is reserved, not depositable',
    (await page
      .getByRole('button', { name: 'Deposit Demo veKITTEN #018' })
      .count()) === 0 &&
      (await visible(page.getByText('1 listed position is reserved for sale'))),
  );
  await nav.getByRole('link', { name: 'Marketplace' }).click();
  await button('Cancel listing for Demo veKITTEN #018').click();
  await audit('cancel listing');
  await button('Cancel listing', dialog()).click();
  await dialog().waitFor({ state: 'hidden' });
  check(
    'Cancelling returns the position and keeps history',
    (await read(listingsStorageKey)).listings[0].status === 'cancelled' &&
      (await page
        .getByRole('button', { name: 'Cancel listing for Demo veKITTEN #018' })
        .count()) === 0,
  );
  await page.getByRole('tab', { name: 'Your listings' }).click();
  const ended = await page
    .getByRole('tabpanel')
    .textContent()
    .then((text) => text ?? '');
  check(
    'Ended listings keep the cancelled ask',
    ended.includes('Ended listings') && ended.includes('Cancelled'),
  );

  // Private (OTC) listings stay off the public table.
  await page.getByRole('tab', { name: /^OTC/ }).click();
  await audit('otc tab');
  await button('Create private listing').click();
  await dialog()
    .getByLabel('Position', { exact: true })
    .selectOption('rift-041');
  check(
    'Creating from the OTC tab preselects a private listing',
    await dialog()
      .getByRole('radio', { name: /Private \(OTC\)/ })
      .isChecked(),
  );
  const buyerField = dialog().getByLabel('Buyer address', { exact: true });
  await buyerField.fill('0x123');
  await button('List in preview', dialog()).click();
  check(
    'A malformed buyer address is rejected',
    (
      await dialog()
        .getByRole('alert')
        .textContent()
        .then((text) => text ?? '')
    ).includes('40 hexadecimal') &&
      (await read(listingsStorageKey)).listings.length === 1,
  );
  await buyerField.fill('0x1234567890ABCDEF1234567890abcdef12345678');
  await audit('private listing review');
  await apply('List in preview');
  const otcBook = (await read(listingsStorageKey)).listings;
  check(
    'A private listing is reserved for one normalized address',
    otcBook.length === 2 &&
      otcBook[1].assetId === 'rift-041' &&
      otcBook[1].buyer === '0x1234567890abcdef1234567890abcdef12345678' &&
      sameMoney(await ledger(), state),
  );
  check(
    'The OTC tab shows the reserved buyer',
    (
      await page
        .getByRole('tabpanel')
        .textContent()
        .then((text) => text ?? '')
    ).includes('Private · 0x1234…5678'),
  );
  await page.getByRole('tab', { name: /^All listings/ }).click();
  check(
    'Private listings stay off the public listings',
    !(await rowTitles()).includes('Demo veKITTEN #041'),
  );
  await page.getByRole('tab', { name: /^OTC/ }).click();
  await button('Cancel listing for Demo veKITTEN #041').click();
  await button('Cancel listing', dialog()).click();
  await dialog().waitFor({ state: 'hidden' });
  check(
    'A private listing can be cancelled',
    (await read(listingsStorageKey)).listings[1].status === 'cancelled',
  );

  // Market-wide sales history: sample sales plus purchases from this browser.
  await page.getByRole('tab', { name: 'History' }).click();
  const salesRows = page.locator('.sales-table tbody tr');
  check(
    'History lists sample sales and your purchases, newest first',
    (await salesRows.count()) === 10 &&
      (
        await salesRows
          .first()
          .textContent()
          .then((text) => text ?? '')
      ).includes('Yours') &&
      (
        await page
          .getByRole('tabpanel')
          .textContent()
          .then((text) => text ?? '')
      ).includes('Demo veKITTEN #156') &&
      (
        await page
          .locator('.pager')
          .textContent()
          .then((text) => text ?? '')
      ).includes('Page 1 of 6'),
  );
  await button('Next page').click();
  check(
    'History pages through older sales',
    (
      await page
        .locator('.pager')
        .textContent()
        .then((text) => text ?? '')
    ).includes('Page 2 of 6') &&
      (
        await salesRows
          .first()
          .textContent()
          .then((text) => text ?? '')
      ).includes('Sample'),
  );
  await audit('sales history');
  await visit('marketplace/009');
  await page.getByText('That listing is no longer available.').waitFor();
  check(
    'A deep link to a sold listing explains and falls back',
    (await hash()) === '#marketplace' && (await dialog().count()) === 0,
  );

  // ---------- Account, persistence and reset ----------
  await page.locator('.account-button').click();
  await dialog().getByRole('heading', { name: 'Preview account' }).waitFor();
  const positions = dialog().locator('.list-row');
  check(
    'Account lists owned positions with their status',
    (await positions.count()) === 8 &&
      (
        await positions
          .filter({ hasText: 'Demo veKITTEN #156' })
          .textContent()
          .then((text) => text ?? '')
      ).includes('Collateral') &&
      (
        await positions
          .filter({ hasText: 'Demo veKITTEN #073' })
          .textContent()
          .then((text) => text ?? '')
      ).includes('Relayer'),
  );
  await audit('preview account');
  await dialog().getByRole('tab', { name: 'Vault' }).click();
  check(
    'Account vault view shows the existing share position',
    (
      await dialog()
        .textContent()
        .then((text) => text ?? '')
    ).includes('750') &&
      (await button('Withdraw in preview', dialog()).isEnabled()),
  );
  await close();
  await page.reload({ waitUntil: 'networkidle' });
  check(
    'Balances, receipts, listings and votes persist after reload',
    isDeepStrictEqual(await ledger(), state) &&
      (await read(marketplaceStorageKey)).receipts.length === 5 &&
      (await read(listingsStorageKey)).listings.length === 2 &&
      (await read(votesStorageKey)).mode === 'manual',
  );
  await page.locator('.account-button').click();
  await button('Reset preview', dialog()).click();
  await audit('reset confirmation');
  await button('Keep my preview', dialog()).click();
  check(
    'Declining reset preserves the preview',
    isDeepStrictEqual(await ledger(), state) &&
      (await read(marketplaceStorageKey)).receipts.length === 5,
  );
  await page.evaluate(
    (key) => localStorage.setItem(key, '{legacy fixture}'),
    legacyStorageKey,
  );
  await button('Reset preview', dialog()).click();
  await button('Reset preview', dialog()).click();
  await page.waitForFunction(
    (key) =>
      JSON.parse(localStorage.getItem(key) ?? 'null').activity.length === 0,
    lendingStorageKey,
  );
  check(
    'Confirmed reset clears purchases, listings, votes, collateral, relayer, shares, debt and fees',
    isDeepStrictEqual(await ledger(), seedLedger) &&
      (await read(marketplaceStorageKey)).receipts.length === 0 &&
      (await read(listingsStorageKey)).listings.length === 0 &&
      isDeepStrictEqual(await read(votesStorageKey), defaultVotes) &&
      (await read(legacyStorageKey)) === null,
  );
  check(
    'Nothing is left to reset',
    await button('Reset preview', dialog()).isDisabled(),
  );
  await close();

  // A deliberately synthetic valid snapshot exercises cash-limited withdrawals.
  // These values are local examples and do not represent a live vault.
  const liquidityFixture = {
    ...seedLedger,
    poolCashMicros: '100000000',
    totalSharesRaw: '285000000000',
    shareBalanceRaw: '5000000000',
  };
  await page.evaluate(
    ({ key, value }) => localStorage.setItem(key, JSON.stringify(value)),
    { key: lendingStorageKey, value: liquidityFixture },
  );
  await visit('earn');
  await page.reload({ waitUntil: 'networkidle' });
  await button('Withdraw').click();
  const withdrawal = dialog().getByLabel('Withdrawal amount', { exact: true });
  await withdrawal.fill('100.000001');
  await button('Withdraw in preview', dialog()).click();
  check(
    'A share position cannot withdraw more cash than the vault holds',
    (await withdrawal.getAttribute('aria-invalid')) === 'true' &&
      isDeepStrictEqual(await ledger(), liquidityFixture),
  );
  await button('Use max.', dialog()).click();
  check(
    'Use max is bounded by 100 liquid USDC rather than total share value',
    (await withdrawal.inputValue()) === '100',
  );
  await apply('Withdraw in preview');
  state = await changedLedger(
    'Cash-limited withdrawal cannot make vault cash negative',
    liquidityFixture,
    'withdraw',
    { walletMicros: '25100000000', poolCashMicros: '0' },
    '105100000000',
  );
  check(
    'Remaining illiquid shares persist while withdrawals are disabled',
    BigInt(state.shareBalanceRaw) > 0n &&
      (await button('Withdraw').isDisabled()),
  );
  await page.locator('.account-button').click();
  await button('Reset preview', dialog()).click();
  await button('Reset preview', dialog()).click();
  await close();

  // ---------- Theme, shortcuts and resources ----------
  await visit('marketplace');
  await button('Switch to light theme').click();
  check(
    'Theme toggle switches to light and remembers it',
    (await page.evaluate(() => document.documentElement.dataset.theme)) ===
      'light' &&
      (await page.evaluate(
        (key) => localStorage.getItem(key),
        themeStorageKey,
      )) === 'light',
  );
  await page.reload({ waitUntil: 'networkidle' });
  check(
    'Saved theme applies before the app renders',
    (await page.evaluate(() => document.documentElement.dataset.theme)) ===
      'light',
  );
  await audit('marketplace light');
  await capture('market-light.jpg');
  await button('View Demo veKITTEN #027').click();
  await dialog().waitFor();
  await audit('position details light');
  await close();
  await visit('borrow');
  await audit('borrow light');
  await visit('earn');
  await audit('earn light');
  await button('Switch to dark theme').click();
  check(
    'Theme toggle returns to dark',
    (await page.evaluate(() => document.documentElement.dataset.theme)) ===
      'dark',
  );
  await visit('borrow');
  await page.keyboard.press('g');
  await page.keyboard.press('m');
  await page.waitForFunction(() => location.hash === '#marketplace');
  check(
    'Shortcut g then m opens the marketplace',
    (await hash()) === '#marketplace',
  );
  await page.keyboard.press('/');
  check(
    'Slash focuses listing search',
    await page
      .waitForFunction(
        () => document.activeElement?.id === 'asset-search',
        null,
        {
          timeout: 3000,
        },
      )
      .then(
        () => true,
        () => false,
      ),
  );
  await page.evaluate(
    () =>
      document.activeElement instanceof HTMLElement &&
      document.activeElement.blur(),
  );
  await page.keyboard.press('?');
  await dialog().getByRole('heading', { name: 'Keyboard shortcuts' }).waitFor();
  await audit('keyboard shortcuts');
  await close();
  await page.keyboard.press('t');
  check(
    'Shortcut t switches theme',
    (await page.evaluate(() => document.documentElement.dataset.theme)) ===
      'light',
  );
  await page.keyboard.press('t');
  await page.getByRole('button', { name: 'Resources' }).click();
  await audit('resources menu');
  await page.getByRole('link', { name: /Repayment simulator/ }).click();
  check(
    'Resources open the repayment simulator',
    (await hash()) === '#simulator' &&
      (await visible(heading('See how rewards repay credit'))),
  );
  const projection = page.locator('.sim-results');
  const simulated = await projection.textContent().then((text) => text ?? '');
  check(
    'Simulator starts from the sample position defaults',
    simulated.includes('3,200 USDC') &&
      simulated.includes('1,592 USDC') &&
      simulated.includes('About 20'),
  );
  await page.getByLabel('Borrow', { exact: true }).fill('100');
  check(
    'Borrowing the full credit lengthens the projection',
    await visible(projection.getByText('About 40', { exact: true })),
  );
  await page.getByLabel('Net reward per epoch', { exact: true }).fill('abc');
  check(
    'Simulator rejects an invalid reward',
    (await page
      .getByLabel('Net reward per epoch', { exact: true })
      .getAttribute('aria-invalid')) === 'true',
  );
  check(
    'The simulator splits each weekly reward',
    (
      await projection
        .locator('.reward-split')
        .textContent()
        .then((text) => text ?? '')
    ).includes('Repays debt'),
  );
  await button('Reset inputs').click();
  await audit('simulator');
  await capture('simulator-desktop.jpg', { fullPage: true });
  await page
    .getByRole('navigation', { name: 'Footer' })
    .getByRole('link', { name: 'FAQ' })
    .click();
  check('Footer opens the FAQ', (await hash()) === '#faq');
  const faqItems = page.locator('.faq-item');
  await faqItems.nth(1).locator('summary').click();
  check(
    'FAQ answers expand',
    (await faqItems.count()) >= 14 &&
      (await faqItems
        .nth(1)
        .evaluate((node) => node instanceof HTMLDetailsElement && node.open)),
  );
  await audit('faq');
  await page.getByRole('button', { name: 'Preview data' }).click();
  await dialog().getByRole('heading', { name: 'Room to explore.' }).waitFor();
  await audit('about this preview');
  await close();

  // ---------- What's new, statistics, brand kit, privacy, not found ----------
  await visit('borrow');
  await page.getByRole('button', { name: 'What’s new' }).click();
  const updates = page.getByRole('region', { name: 'What’s new' });
  check(
    'What’s new lists the release notes',
    (await updates.locator('li').count()) === 4,
  );
  await audit('whats new');
  await page.keyboard.press('Escape');
  check(
    'Borrowing controls occupy the first viewport without introductory blocks',
    await page
      .locator('.workspace-card')
      .evaluate((node) => node.getBoundingClientRect().top < 280),
  );
  await visit('stats');
  check('Statistics page', await visible(heading('Statistics')));
  const statsText = await page
    .locator('main')
    .textContent()
    .then((text) => text ?? '');
  check(
    'Statistics summarize the vault, rewards and market',
    statsText.includes('Vault assets') &&
      statsText.includes('Rewards processed') &&
      statsText.includes('Market volume') &&
      statsText.includes('Unlock schedule') &&
      (await page.locator('main .chart').count()) === 1,
  );
  await audit('statistics');
  await capture('stats-desktop.jpg', { fullPage: true });
  await visit('brand');
  check('Brand kit page', await visible(heading('Brand kit')));
  const marks = await page.locator('a[download]').evaluateAll((links) =>
    links.map((link) => {
      if (!(link instanceof HTMLAnchorElement))
        throw new Error('Expected download link');
      return link.href;
    }),
  );
  const served = await Promise.all(
    marks.map((href) =>
      fetch(href).then(
        (response) =>
          response.ok &&
          (response.headers.get('content-type') ?? '').includes('svg'),
      ),
    ),
  );
  check(
    'Brand marks download as SVG files',
    marks.length === 2 && served.every(Boolean),
  );
  await page
    .getByRole('button', { name: 'Copy Market accent #BFF4AA' })
    .click();
  await page.getByText('#BFF4AA copied.').waitFor();
  check(
    'Brand colors copy their values',
    (await page.evaluate(() => navigator.clipboard.readText())) === '#BFF4AA',
  );
  await audit('brand kit');
  await visit('privacy');
  const privacyText = await page
    .locator('main')
    .textContent()
    .then((text) => text ?? '');
  check(
    'Privacy page lists every preview storage key',
    [
      marketplaceStorageKey,
      lendingStorageKey,
      listingsStorageKey,
      votesStorageKey,
      themeStorageKey,
    ].every((key) => privacyText.includes(key)),
  );
  await audit('privacy');
  await visit('nowhere');
  check(
    'Unknown routes show a not-found page',
    (await visible(heading('This page slipped through the rift.'))) &&
      (await hash()) === '#nowhere',
  );
  await audit('not found');
  await button('Go to Borrow').click();
  check(
    'The not-found page leads back',
    (await visible(heading('Borrow against veKITTEN'))) &&
      (await hash()) === '#borrow',
  );

  // ---------- Routes, motion and storage resilience ----------
  await page.goto(`${base}/#lending`, { waitUntil: 'networkidle' });
  check(
    'The former lending route opens Borrow',
    (await hash()) === '#borrow' &&
      (await visible(heading('Borrow against veKITTEN'))),
  );
  await nav.getByRole('link', { name: 'Marketplace' }).click();
  await page.goBack();
  check(
    'Browser back updates route',
    await visible(heading('Borrow against veKITTEN')),
  );
  await page.goForward();
  check(
    'Browser forward updates route',
    await visible(heading('veKITTEN marketplace')),
  );
  await page.emulateMedia({ reducedMotion: 'reduce' });
  check(
    'Reduced motion stops ambient and entrance animation',
    await page.evaluate(() => {
      const glowElement = document.querySelector('.backdrop-glow');
      const bodyElement = document.querySelector('.page-body');
      if (!glowElement || !bodyElement)
        throw new Error('Expected animated shell');
      const glow = getComputedStyle(glowElement);
      const body = getComputedStyle(bodyElement);
      return (
        glow.animationName === 'none' &&
        parseFloat(body.animationDuration) <= 0.00001
      );
    }),
  );
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(
    (keys) => keys.forEach((key) => localStorage.setItem(key, '{corrupt')),
    [
      marketplaceStorageKey,
      lendingStorageKey,
      listingsStorageKey,
      votesStorageKey,
    ],
  );
  await page.reload({ waitUntil: 'networkidle' });
  check(
    'Corrupt preview storage safely recovers',
    (await rows().count()) === 12 &&
      isDeepStrictEqual(await ledger(), seedLedger) &&
      (await read(listingsStorageKey)).listings.length === 0 &&
      isDeepStrictEqual(await read(votesStorageKey), defaultVotes),
  );
  await page.evaluate(
    ({ key, seed }) =>
      localStorage.setItem(key, JSON.stringify({ ...seed, debtMicros: '1' })),
    { key: lendingStorageKey, seed: seedLedger },
  );
  await page.reload({ waitUntil: 'networkidle' });
  check(
    'A stored ledger that breaks the other-borrower baseline safely resets',
    isDeepStrictEqual(await ledger(), seedLedger),
  );
  check('No runtime or console errors', errors.length === 0);
  check('No remote requests or wallet services', externalRequests.length === 0);

  const restrictedContext = await browser.newContext();
  await restrictedContext.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new Error('Storage denied for test');
      },
    });
  });
  const restrictedPage = await restrictedContext.newPage();
  const restrictedErrors = [];
  restrictedPage.on('pageerror', (error) =>
    restrictedErrors.push(error.message),
  );
  await restrictedPage.goto(`${base}/`, { waitUntil: 'networkidle' });
  check(
    'Storage unavailable notice',
    await visible(restrictedPage.locator('.storage-notice')),
  );
  check(
    'Storage unavailable keeps interface usable',
    (await restrictedPage
      .getByRole('button', { name: /^Deposit Demo veKITTEN #\d+$/ })
      .count()) === 3 && restrictedErrors.length === 0,
  );
  await restrictedContext.close();
  status = 'passed';
} finally {
  await writeFile(
    new URL('browser-report.json', output),
    JSON.stringify(
      {
        status,
        baseURL: base,
        browser: 'isolated headless Chrome',
        suiteVersion: 'interface-v2',
        scope:
          'Local preview of Borrow, Earn, Marketplace, Simulator, Statistics, FAQ, brand kit and privacy pages with sample positions, sample sales and synthetic pooled balances; no live liquidity, wallet or settlement',
        checkedAt: new Date().toISOString(),
        checks,
        errors,
        externalRequests,
        accessibility,
        screenshots,
      },
      null,
      2,
    ) + '\n',
  );
  await browser.close();
}
console.log(
  `${checks.length} browser checks passed; ${accessibility.length} views passed automated accessibility checks.`,
);
