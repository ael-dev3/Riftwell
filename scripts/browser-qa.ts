import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import {
  decodeLendingFixture,
  decodeMarketFixture,
  lendingMoneyFields,
  type AuditReport,
  type LendingFixture,
  type LendingActivityKind,
  type LendingMoneyFields,
  type MarketFixture,
  type MarketEventKind,
} from './qa-types.ts';

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
});
const page = await context.newPage();
const errors: string[] = [];
const externalRequests: string[] = [];
const checks: string[] = [];
const accessibility: AuditReport[] = [];
const selectedMarketAccent = '#bff4aa';
const marketplaceStorageKey = 'riftwell.marketplace-ledger.v1';
const oldMarketplaceStorageKey = 'riftwell.marketplace-preview.v3';
const lendingStorageKey = 'riftwell.pooled-lending-preview.v1';
const legacyStorageKey = 'riftwell.positions-preview.v2';
const seedLedger: LendingFixture = {
  version: 1,
  walletMicros: '25000000000',
  poolCashMicros: '200000000000',
  poolOutstandingMicros: '80000000000',
  totalSharesRaw: '280000000000',
  shareBalanceRaw: '0',
  debtMicros: '0',
  platformFeesMicros: '0',
  collateralIds: [],
  epoch: 0,
  activity: [],
};
const moneyFields = lendingMoneyFields;
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
async function audit(name: string) {
  // Audit the settled view, not a frame during the dialog's entrance fade.
  await page.evaluate(async () => {
    const animations = document
      .getAnimations()
      .filter(
        (animation) => animation.effect?.getTiming().iterations !== Infinity,
      );
    await Promise.all(
      animations.map((animation) => animation.finished.catch(() => {})),
    );
  });
  if ((await dialog().count()) > 0) {
    const theme = await dialog().evaluate((node) => {
      const kicker = node.querySelector('.dialog-kicker');
      return {
        bodyPortal:
          node.parentElement?.parentElement === document.body &&
          node.closest('.app-shell') === null,
        accent: getComputedStyle(node).getPropertyValue('--accent').trim(),
        kickerColor: kicker ? getComputedStyle(kicker).color : null,
      };
    });
    check(`Dialog mounts in body: ${name}`, theme.bodyPortal);
    check(
      `Selected market accent reaches dialog: ${name}`,
      theme.accent === selectedMarketAccent &&
        theme.kickerColor === 'rgb(191, 244, 170)',
    );
  }
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
    width: innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  check(`No horizontal overflow: ${name}`, sizes.scrollWidth === sizes.width);
}
async function ledger(): Promise<LendingFixture> {
  const saved = await page.evaluate(
    (key) => localStorage.getItem(key),
    lendingStorageKey,
  );
  assert.ok(saved !== null, 'Lending state must be persisted');
  const value: unknown = JSON.parse(saved);
  return decodeLendingFixture(value);
}
async function marketplaceLedger(): Promise<MarketFixture> {
  const saved = await page.evaluate(
    (key) => localStorage.getItem(key),
    marketplaceStorageKey,
  );
  assert.ok(saved !== null, 'Marketplace state must be persisted');
  const value: unknown = JSON.parse(saved);
  return decodeMarketFixture(value);
}
function marketCash(state: MarketFixture) {
  return (
    BigInt(state.balanceMicros) +
    BigInt(state.platformFeesMicros) +
    Object.values(state.sellerProceedsMicros).reduce(
      (sum, amount) => sum + BigInt(amount),
      0n,
    )
  );
}
function marketBaseline(name: string, state: MarketFixture) {
  check(
    `Marketplace funds conserve buyer cash, seller proceeds and fees: ${name}`,
    marketCash(state) === 25000000000n,
  );
}
const marketRow = (id: string) =>
  page
    .locator('.market-table tbody tr')
    .filter({ has: page.getByRole('button', { name: `#${id}`, exact: true }) });
async function listYours() {
  await page
    .locator('.market-table-heading')
    .getByRole('button', { name: 'List yours', exact: true })
    .click();
}
async function changeMarket(
  name: string,
  before: MarketFixture,
  kind: MarketEventKind,
) {
  await page.waitForFunction(
    ({ key, count }) => {
      const saved: unknown = JSON.parse(localStorage.getItem(key) ?? 'null');
      return (
        saved !== null &&
        typeof saved === 'object' &&
        'history' in saved &&
        Array.isArray(saved.history) &&
        saved.history.length === count
      );
    },
    { key: marketplaceStorageKey, count: before.history.length + 1 },
  );
  const state = await marketplaceLedger();
  check(name, state.history.at(-1)?.kind === kind);
  marketBaseline(name, state);
  return state;
}
function baseline(
  name: string,
  state: LendingFixture,
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
function sameMoney(left: LendingFixture, right: LendingFixture) {
  return moneyFields.every((key) => left[key] === right[key]);
}
async function changedLedger(
  name: string,
  before: LendingFixture,
  kind: LendingActivityKind,
  fields: LendingMoneyFields,
  wealth?: string,
) {
  await page.waitForFunction(
    ({ key, fields, activityCount }) => {
      const saved: unknown = JSON.parse(localStorage.getItem(key) ?? 'null');
      if (
        saved === null ||
        typeof saved !== 'object' ||
        !('activity' in saved) ||
        !Array.isArray(saved.activity)
      )
        return false;
      const values = saved as Record<string, unknown>;
      return (
        saved.activity.length === activityCount &&
        Object.entries(fields).every(
          ([field, value]) => values[field] === value,
        )
      );
    },
    {
      key: lendingStorageKey,
      fields,
      activityCount: before.activity.length + 1,
    },
  );
  const state = await ledger();
  check(
    name,
    state.activity.at(-1)?.kind === kind &&
      Object.entries(fields).every(
        ([field, value]) =>
          field in state && state[field as keyof LendingFixture] === value,
      ),
  );
  baseline(name, state, wealth ?? null);
  return state;
}
async function apply(name: string) {
  await dialog().getByRole('button', { name, exact: true }).click();
  await dialog().waitFor({ state: 'hidden' });
}
async function epoch(repayment: string, revenue: string) {
  await page
    .getByRole('button', { name: 'Simulate an epoch', exact: true })
    .click();
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
try {
  await page.goto(`${base}/`, { waitUntil: 'networkidle' });
  check(
    'Six sample seller listings in a table',
    (await page.locator('.market-table tbody tr').count()) === 6,
  );
  check(
    'Exactly two primary sections',
    (await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('button')
      .count()) === 2,
  );
  check('Initial hash route', new URL(page.url()).hash === '#marketplace');
  const marketSelect = page.getByLabel('Select market', { exact: true });
  check(
    'KittenSwap is the selected market',
    (await marketSelect.inputValue()) === 'kittenswap',
  );
  const marketOptions = await marketSelect
    .locator('option')
    .evaluateAll((options) =>
      options.map((option) => ({
        value: (option as HTMLOptionElement).value,
        label: (option.textContent ?? '').trim(),
      })),
    );
  check(
    'KittenSwap is the only available market',
    marketOptions.length === 1 &&
      marketOptions[0].value === 'kittenswap' &&
      marketOptions[0].label === 'KittenSwap',
  );
  const marketLogo = await page
    .locator('.market-selector .market-logo')
    .evaluate((image: HTMLImageElement) => ({
      src: image.currentSrc,
      loaded:
        image.complete && image.naturalWidth > 0 && image.naturalHeight > 0,
    }));
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
    'Marketplace has no promotional hero',
    (await page.locator('.hero').count()) === 0,
  );
  let marketplaceState = await marketplaceLedger();
  const initialMarketplaceState = marketplaceState;
  marketBaseline('initial marketplace', marketplaceState);
  check(
    'Owned marketplace positions are separate from seller listings',
    Object.entries(marketplaceState.ownerByAsset).filter(
      ([id, owner]) =>
        id.startsWith('market-owned-') &&
        owner === marketplaceState.ownerByAsset['market-owned-101'],
    ).length === 3 &&
      marketplaceState.listings.every(
        (listing) => !listing.assetId.startsWith('market-owned-'),
      ),
  );
  await audit('marketplace desktop');
  await page.screenshot({
    path: new URL('market-desktop.png', output).pathname,
    fullPage: true,
    animations: 'disabled',
  });
  await page.screenshot({
    path: new URL('preview.png', output).pathname,
    animations: 'disabled',
  });
  for (const width of [320, 390, 768, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    await fits(`marketplace ${width}`);
  }
  await page.setViewportSize({ width: 320, height: 900 });
  await audit('marketplace mobile');
  await page.screenshot({
    path: new URL('market-mobile-320.png', output).pathname,
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByLabel('Search positions', { exact: true })
    .fill('nonexistent');
  check(
    'Search empty state',
    await page.getByRole('heading', { name: 'No listings found.' }).isVisible(),
  );
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await page.getByLabel('Lock category').selectOption('Max lock');
  check(
    'Lock filter',
    (await page.locator('.market-table tbody tr').count()) === 1,
  );
  await page.getByLabel('Lock category').selectOption('All');
  await page.getByLabel('Sort listings').selectOption('price-asc');
  check(
    'Ask sorting',
    (await page.locator('.market-token-link').first().innerText()).includes(
      '#062',
    ),
  );
  await page.getByLabel('Sort listings').selectOption('position');
  const detailTrigger = page.getByRole('button', { name: '#041', exact: true });
  await detailTrigger.click();
  await audit('listing details');
  check(
    'Position lock, balance and ask shown',
    (await dialog().innerText()).includes('50,000 KITTEN') &&
      (await dialog().innerText()).includes('2 Oct 2027') &&
      (await dialog().innerText()).includes('4,200 USDC'),
  );
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
  await close();
  check(
    'Focus returns to listing trigger',
    await detailTrigger.evaluate((node) => document.activeElement === node),
  );
  await marketRow('041')
    .getByRole('button', { name: 'Buy', exact: true })
    .click();
  await audit('purchase review');
  check(
    'Seller pays exact 0.5% fee and buyer pays full ask',
    (await dialog().innerText()).includes('21 USDC') &&
      (await dialog().innerText()).includes('4,179 USDC') &&
      (await dialog().innerText()).includes('4,200 USDC'),
  );
  const beforePurchase = marketplaceState;
  await apply('Confirm preview buy');
  marketplaceState = await changeMarket(
    'Single purchase updates ownership and history',
    beforePurchase,
    'purchase',
  );
  check(
    'Purchase debits exact buyer cash and transfers ownership',
    marketplaceState.balanceMicros === '20800000000' &&
      marketplaceState.platformFeesMicros === '21000000' &&
      marketplaceState.ownerByAsset['rift-041'] ===
        marketplaceState.ownerByAsset['market-owned-101'],
  );
  check(
    'Purchased listing cannot be bought a second time',
    (await marketRow('041').count()) === 0 &&
      marketplaceState.listings.find(
        (listing) => listing.assetId === 'rift-041',
      )?.status === 'sold',
  );
  await page.locator('.account-button').click();
  check(
    'Bought position joins the separate owned marketplace portfolio',
    (await dialog().innerText()).includes('veKITTEN #041'),
  );
  await audit('marketplace account');
  await close();
  await page.reload({ waitUntil: 'networkidle' });
  check(
    'Marketplace ownership, balances and receipts persist after reload',
    isDeepStrictEqual(await marketplaceLedger(), marketplaceState) &&
      (await page.locator('.market-table tbody tr').count()) === 5,
  );

  // Fixed listing, optional reservation and exact address validation.
  await listYours();
  await dialog()
    .getByLabel('Your position', { exact: true })
    .selectOption('market-owned-101');
  const ask = dialog().getByLabel('Ask price', { exact: true });
  for (const invalid of ['1e3', '0.0000001', '0']) {
    await ask.fill(invalid);
    await dialog()
      .getByRole('button', { name: 'Review listing', exact: true })
      .click();
    check(
      `Invalid ask ${invalid} is rejected without a listing`,
      (await dialog().getByRole('alert').innerText()).trim().length > 0 &&
        (await ask.evaluate((node) => document.activeElement === node)) &&
        isDeepStrictEqual(await marketplaceLedger(), marketplaceState),
    );
  }
  await ask.fill('1234.000199');
  await dialog().getByText('Reserve for a buyer', { exact: true }).click();
  const recipient = dialog().getByLabel('Buyer address · optional', {
    exact: true,
  });
  for (const invalid of [
    '0x0',
    '0x0000000000000000000000000000000000000000',
    marketplaceState.ownerByAsset['market-owned-101'],
  ]) {
    await recipient.fill(invalid);
    await dialog()
      .getByRole('button', { name: 'Review listing', exact: true })
      .click();
    check(
      `Invalid reserved buyer ${invalid} is rejected`,
      (await recipient.evaluate((node) => document.activeElement === node)) &&
        isDeepStrictEqual(await marketplaceLedger(), marketplaceState),
    );
  }
  const reservedBuyer = `0x${'b099'.padStart(40, '0')}`;
  await recipient.fill(reservedBuyer);
  await page.setViewportSize({ width: 320, height: 900 });
  await fits('fixed listing form mobile');
  await audit('fixed listing form mobile');
  await dialog()
    .getByRole('button', { name: 'Review listing', exact: true })
    .click();
  await fits('reserved listing review mobile');
  await audit('reserved listing review mobile');
  check(
    'Reserved listing review shows exact recipient and seller fee',
    (await dialog().innerText()).includes(reservedBuyer) &&
      (await dialog().innerText()).includes('6.17 USDC'),
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  const beforeFixed = marketplaceState;
  await apply('List in preview');
  marketplaceState = await changeMarket(
    'Owned position gets a fixed reserved listing',
    beforeFixed,
    'list',
  );
  check(
    'Listing alone does not transfer ownership or spend funds',
    marketplaceState.balanceMicros === beforeFixed.balanceMicros &&
      marketplaceState.ownerByAsset['market-owned-101'] ===
        beforeFixed.ownerByAsset['market-owned-101'],
  );
  check(
    'Own listing cannot be selected or bought',
    (await marketRow('101')
      .getByRole('button', { name: 'Buy', exact: true })
      .count()) === 0 &&
      (await marketRow('101').getByRole('checkbox').isDisabled()) &&
      (await marketRow('101').innerText()).includes('Reserved'),
  );
  await page.getByRole('button', { name: 'My listings', exact: true }).click();
  await marketRow('101')
    .getByRole('button', { name: 'Edit', exact: true })
    .click();
  await dialog().getByLabel('Ask price', { exact: true }).fill('1800');
  await dialog().getByText('Reserve for a buyer', { exact: true }).click();
  await dialog()
    .getByLabel('Buyer address · optional', { exact: true })
    .fill('');
  await dialog()
    .getByRole('button', { name: 'Review listing', exact: true })
    .click();
  const beforeEdit = marketplaceState;
  await apply('Save changes');
  marketplaceState = await changeMarket(
    'Review updates price, recipient and revision',
    beforeEdit,
    'edit',
  );
  const edited = marketplaceState.listings.find(
    (listing) =>
      listing.assetId === 'market-owned-101' && listing.status === 'active',
  );
  assert.ok(edited, 'Edited listing must exist');
  check(
    'Edited fixed listing uses the new ask and is public',
    edited.startPriceMicros === '1800000000' &&
      edited.endPriceMicros === '1800000000' &&
      edited.recipient === null &&
      edited.revision === 2,
  );
  await marketRow('101')
    .getByRole('button', { name: 'Cancel', exact: true })
    .click();
  await apply('Keep listing');
  check(
    'Declining cancellation preserves the active listing',
    isDeepStrictEqual(await marketplaceLedger(), marketplaceState),
  );
  await marketRow('101')
    .getByRole('button', { name: 'Cancel', exact: true })
    .click();
  const beforeCancel = marketplaceState;
  await apply('Cancel listing');
  marketplaceState = await changeMarket(
    'Confirmed cancellation retains position ownership',
    beforeCancel,
    'cancel',
  );
  check(
    'Cancelled listing is terminal and funds stay unchanged',
    marketplaceState.listings.find((listing) => listing.id === edited.id)
      ?.status === 'cancelled' &&
      marketplaceState.balanceMicros === beforeCancel.balanceMicros,
  );

  // Dutch cubic decay duration is distinct from listing expiry/floor hold.
  await listYours();
  await dialog()
    .getByLabel('Your position', { exact: true })
    .selectOption('market-owned-202');
  await dialog().getByLabel('Sale type', { exact: true }).selectOption('dutch');
  await dialog().getByLabel('Starting ask', { exact: true }).fill('2000');
  await dialog().getByLabel('Floor ask', { exact: true }).fill('2001');
  await dialog()
    .getByRole('button', { name: 'Review listing', exact: true })
    .click();
  check(
    'Dutch floor cannot exceed starting ask',
    (await dialog().getByRole('alert').innerText()).includes('no higher') &&
      isDeepStrictEqual(await marketplaceLedger(), marketplaceState),
  );
  await dialog().getByLabel('Floor ask', { exact: true }).fill('1000');
  await dialog()
    .getByLabel('Price duration', { exact: true })
    .selectOption('72');
  await dialog()
    .getByLabel('Listing expiry', { exact: true })
    .selectOption('1');
  await dialog()
    .getByRole('button', { name: 'Review listing', exact: true })
    .click();
  check(
    'Dutch decay cannot outlast listing expiry',
    (await dialog().getByRole('alert').innerText()).includes('before') &&
      isDeepStrictEqual(await marketplaceLedger(), marketplaceState),
  );
  await dialog()
    .getByLabel('Price duration', { exact: true })
    .selectOption('1');
  await dialog()
    .getByLabel('Listing expiry', { exact: true })
    .selectOption('7');
  await dialog()
    .getByRole('button', { name: 'Review listing', exact: true })
    .click();
  await audit('Dutch listing review');
  check(
    'Dutch review declares cubic decay and separate floor hold',
    (await dialog().innerText()).includes('Cubic decay') &&
      (await dialog().innerText()).includes('1 hours'),
  );
  const beforeDutch = marketplaceState;
  await apply('List in preview');
  marketplaceState = await changeMarket(
    'Dutch listing persists its decay and separate expiry',
    beforeDutch,
    'list',
  );
  const dutch = marketplaceState.listings.find(
    (listing) =>
      listing.assetId === 'market-owned-202' && listing.status === 'active',
  );
  assert.ok(
    dutch && dutch.auctionEndsAt !== null,
    'Dutch fixture must have an auction end',
  );
  check(
    'Dutch floor hold is possible before expiry',
    dutch.kind === 'dutch' &&
      dutch.endPriceMicros === '1000000000' &&
      Date.parse(dutch.auctionEndsAt) < Date.parse(dutch.expiresAt),
  );

  await page.getByRole('button', { name: 'All listings', exact: true }).click();
  await marketRow('018').getByRole('checkbox').check();
  await marketRow('009').getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Review sweep', exact: true }).click();
  await audit('atomic preview sweep review');
  check(
    'Sweep review identifies every selected position and consent ceiling',
    (await dialog().innerText()).includes('#018') &&
      (await dialog().innerText()).includes('#009') &&
      (await dialog().innerText()).includes('Maximum total'),
  );
  const beforeSweep = marketplaceState;
  await apply('Confirm preview sweep');
  marketplaceState = await changeMarket(
    'Sweep buys all selected positions atomically',
    beforeSweep,
    'sweep',
  );
  const sweep = marketplaceState.history.at(-1);
  assert.ok(sweep, 'Sweep event must be saved');
  const sweepTotal = sweep.items.reduce(
    (sum, item) => sum + BigInt(item.priceMicros),
    0n,
  );
  check(
    'Sweep cash and per-seller fees use exact final asks',
    sweep.items.length === 2 &&
      BigInt(beforeSweep.balanceMicros) -
        BigInt(marketplaceState.balanceMicros) ===
        sweepTotal &&
      sweep.items.every(
        (item) =>
          BigInt(item.feeMicros) === (BigInt(item.priceMicros) * 5n) / 1000n &&
          BigInt(item.sellerProceedsMicros) + BigInt(item.feeMicros) ===
            BigInt(item.priceMicros),
      ),
  );
  check(
    'Sweep removes all purchased listings together',
    (await marketRow('018').count()) === 0 &&
      (await marketRow('009').count()) === 0,
  );
  await page.getByRole('button', { name: 'History', exact: true }).click();
  check(
    'History includes purchases, listing edits and cancellation',
    (await page.locator('.market-history-table').innerText()).includes(
      'Sweep bought',
    ) &&
      (await page.locator('.market-history-table').innerText()).includes(
        'Edited',
      ) &&
      (await page.locator('.market-history-table').innerText()).includes(
        'Cancelled',
      ),
  );
  await audit('marketplace history');
  await page.reload({ waitUntil: 'networkidle' });
  check(
    'All marketplace lifecycle state persists together',
    isDeepStrictEqual(await marketplaceLedger(), marketplaceState),
  );
  await page
    .getByRole('navigation')
    .getByRole('button', { name: 'Lending', exact: true })
    .click();
  check('Lending hash route', new URL(page.url()).hash === '#lending');
  await audit('lending desktop');
  await page.screenshot({
    path: new URL('lending-desktop.png', output).pathname,
    fullPage: true,
    animations: 'disabled',
  });
  for (const width of [320, 390, 768, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    await fits(`lending ${width}`);
  }
  await page.setViewportSize({ width: 320, height: 900 });
  await audit('lending mobile');
  await page.screenshot({
    path: new URL('lending-mobile-320.png', output).pathname,
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  check(
    'Pooled lending has no negotiated rate, duration or proposal form',
    (await page
      .getByLabel(/annual rate|loan duration|proposed amount/i)
      .count()) === 0 &&
      (await page
        .getByRole('button', {
          name: /Review loan|Make proposal|Request a loan/i,
        })
        .count()) === 0,
  );
  let state = await ledger();
  check(
    'Pooled preview starts with explicit example balances and no user position',
    isDeepStrictEqual(state, seedLedger),
  );
  baseline('initial examples', state, '305000000000');
  await page.getByRole('button', { name: 'Lend', exact: true }).click();
  check(
    'Withdraw is disabled before supplying',
    await page
      .getByRole('button', { name: 'Withdraw', exact: true })
      .isDisabled(),
  );
  await page.getByRole('button', { name: 'Supply USDC', exact: true }).click();
  await dialog().getByLabel('Supply amount', { exact: true }).fill('1000');
  await audit('vault supply review');
  const beforeSupply = state;
  await apply('Supply in preview');
  state = await changedLedger(
    'Supply exchanges exact USDC for vault shares',
    beforeSupply,
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
  await page.getByRole('button', { name: 'Withdraw', exact: true }).click();
  await dialog().getByLabel('Withdrawal amount', { exact: true }).fill('250');
  await audit('vault withdrawal review');
  const beforeWithdraw = state;
  await apply('Withdraw in preview');
  state = await changedLedger(
    'Withdraw returns liquid USDC and burns shares',
    beforeWithdraw,
    'withdraw',
    {
      walletMicros: '24250000000',
      poolCashMicros: '200750000000',
      shareBalanceRaw: '750000000',
      totalSharesRaw: '280750000000',
    },
    '305000000000',
  );
  await page.getByRole('button', { name: 'Borrow', exact: true }).click();
  const collateral = () =>
    page.locator('.pooled-position').filter({ hasText: 'Demo veKITTEN #041' });
  await collateral()
    .getByRole('button', { name: 'Deposit', exact: true })
    .click();
  await page.setViewportSize({ width: 320, height: 900 });
  await fits('collateral deposit dialog mobile');
  await audit('collateral deposit mobile');
  await page.setViewportSize({ width: 1440, height: 1000 });
  const beforeDeposit = state;
  await apply('Deposit in preview');
  state = await changedLedger(
    'Collateral deposit opens a credit line without moving USDC',
    beforeDeposit,
    'deposit-collateral',
    {},
    '305000000000',
  );
  check(
    'Only the selected position is deposited',
    JSON.stringify(state.collateralIds) === JSON.stringify(['rift-041']) &&
      sameMoney(state, beforeDeposit),
  );
  await page.getByRole('button', { name: 'Borrow USDC', exact: true }).click();
  const amount = dialog().getByLabel('Borrow amount', { exact: true });
  const rejectedBefore = await ledger();
  for (const invalid of ['999999', '1e3', '0x10', '1.0000001', '0']) {
    await amount.fill(invalid);
    await dialog()
      .getByRole('button', { name: 'Borrow in preview', exact: true })
      .click();
    check(
      `Reject invalid borrow amount ${invalid} without changing balances`,
      (await amount.getAttribute('aria-invalid')) === 'true' &&
        (await dialog().getByRole('alert').innerText()).trim().length > 0 &&
        (await amount.evaluate((node) => document.activeElement === node)) &&
        isDeepStrictEqual(await ledger(), rejectedBefore),
    );
  }
  await amount.fill('1000');
  check(
    'Draw fee, net wallet proceeds and gross debt are separate',
    (await dialog().innerText()).includes('5 USDC') &&
      (await dialog().innerText()).includes('995 USDC') &&
      (await dialog().innerText()).includes('1,000 USDC'),
  );
  await audit('pooled borrowing review');
  await page.screenshot({
    path: new URL('borrow-review.png', output).pathname,
    animations: 'disabled',
  });
  const beforeBorrow = state;
  await apply('Borrow in preview');
  state = await changedLedger(
    'Borrow moves gross principal from vault cash into debt',
    beforeBorrow,
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
    'Debt prevents removing the only collateral position',
    await collateral()
      .getByRole('button', { name: 'Remove', exact: true })
      .isDisabled(),
  );
  const beforeZero = state;
  await epoch('0', '0');
  state = await changedLedger(
    'A zero-reward epoch does not invent interest or repayment',
    beforeZero,
    'epoch',
    { epoch: 1 },
    '305000000000',
  );
  check(
    'Zero epoch preserves every financial balance',
    sameMoney(state, beforeZero),
  );
  await page
    .getByRole('button', { name: 'Simulate an epoch', exact: true })
    .click();
  await dialog()
    .getByLabel('Net rewards for repayment', { exact: true })
    .fill('25');
  const poolReward = dialog().getByLabel('Net lender revenue', { exact: true });
  await poolReward.fill('1000.000001');
  await dialog()
    .getByRole('button', { name: 'Apply example rewards', exact: true })
    .click();
  check(
    'Out-of-range epoch revenue is rejected without a partial repayment',
    (await dialog().getByRole('alert').innerText()).includes('1,000 USDC') &&
      (await poolReward.evaluate((node) => document.activeElement === node)) &&
      isDeepStrictEqual(await ledger(), state),
  );
  await poolReward.fill('100');
  await audit('variable reward epoch');
  const beforeReward = state;
  await apply('Apply example rewards');
  state = await changedLedger(
    'Variable net rewards repay debt while separate revenue increases vault value',
    beforeReward,
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
        BigInt(beforeReward.poolCashMicros) -
        BigInt(beforeReward.poolOutstandingMicros) ===
        100000000n,
  );
  await page.getByRole('button', { name: 'Repay', exact: true }).click();
  const repayment = dialog().getByLabel('Repayment amount', { exact: true });
  await repayment.fill('976');
  await dialog()
    .getByRole('button', { name: 'Repay in preview', exact: true })
    .click();
  check(
    'Manual repayment cannot exceed the outstanding debt',
    (await repayment.getAttribute('aria-invalid')) === 'true' &&
      isDeepStrictEqual(await ledger(), state),
  );
  await repayment.fill('175');
  await audit('manual repayment');
  const beforeRepay = state;
  await apply('Repay in preview');
  state = await changedLedger(
    'Manual repayment returns wallet cash to the vault and reduces debt',
    beforeRepay,
    'repay',
    {
      walletMicros: '25070000000',
      poolCashMicros: '200050000000',
      poolOutstandingMicros: '80800000000',
      debtMicros: '800000000',
    },
    '305125000000',
  );
  const beforeSurplus = state;
  await epoch('900', '0');
  state = await changedLedger(
    'Rewards clear remaining debt and route only the surplus to the wallet',
    beforeSurplus,
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
  await collateral()
    .getByRole('button', { name: 'Remove', exact: true })
    .click();
  const beforeRemove = state;
  await apply('Remove in preview');
  state = await changedLedger(
    'Repaid collateral can be removed without erasing accounting',
    beforeRemove,
    'remove-collateral',
    {},
    '306025000000',
  );
  check(
    'Removed collateral returns to the deposit list',
    state.collateralIds.length === 0 &&
      sameMoney(state, beforeRemove) &&
      (await collateral()
        .getByRole('button', { name: 'Deposit', exact: true })
        .isEnabled()),
  );
  await page.reload({ waitUntil: 'networkidle' });
  check(
    'Vault shares, debt, fees and activity persist after reload',
    isDeepStrictEqual(await ledger(), state),
  );
  await page.locator('.account-button').click();
  await dialog().getByRole('button', { name: 'Vault', exact: true }).click();
  check(
    'Account vault view shows the existing share position',
    (await dialog().innerText()).includes('750') &&
      (await dialog()
        .getByRole('button', { name: 'Withdraw in preview', exact: true })
        .isEnabled()),
  );
  await audit('pooled preview account');
  await dialog()
    .getByRole('button', { name: 'Reset preview', exact: true })
    .click();
  await dialog()
    .getByRole('button', { name: 'Keep my preview', exact: true })
    .click();
  check(
    'Declining reset preserves both purchases and pooled balances',
    isDeepStrictEqual(await ledger(), state) &&
      isDeepStrictEqual(await marketplaceLedger(), marketplaceState),
  );
  await page.evaluate(
    (key) => localStorage.setItem(key, '{legacy fixture}'),
    legacyStorageKey,
  );
  await dialog()
    .getByRole('button', { name: 'Reset preview', exact: true })
    .click();
  await dialog()
    .getByRole('button', { name: 'Reset preview', exact: true })
    .click();
  await page.waitForFunction((key) => {
    const saved: unknown = JSON.parse(localStorage.getItem(key) ?? 'null');
    return (
      saved !== null &&
      typeof saved === 'object' &&
      'activity' in saved &&
      Array.isArray(saved.activity) &&
      saved.activity.length === 0
    );
  }, lendingStorageKey);
  check(
    'Confirmed reset clears purchases, collateral, shares, debt, fees and activity',
    isDeepStrictEqual(await ledger(), seedLedger) &&
      (await marketplaceLedger()).history.length === 0 &&
      (await marketplaceLedger()).balanceMicros ===
        initialMarketplaceState.balanceMicros &&
      (await page.evaluate(
        (key) => localStorage.getItem(key),
        legacyStorageKey,
      )) === null,
  );
  await close();
  // A deliberately synthetic valid preview snapshot exercises cash-limited withdrawals.
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
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Lend', exact: true }).click();
  await page.getByRole('button', { name: 'Withdraw', exact: true }).click();
  const withdrawal = dialog().getByLabel('Withdrawal amount', { exact: true });
  await withdrawal.fill('100.000001');
  await dialog()
    .getByRole('button', { name: 'Withdraw in preview', exact: true })
    .click();
  check(
    'A share position cannot withdraw more cash than the vault holds',
    (await withdrawal.getAttribute('aria-invalid')) === 'true' &&
      isDeepStrictEqual(await ledger(), liquidityFixture),
  );
  await dialog().getByRole('button', { name: 'Use max.', exact: true }).click();
  check(
    'Use max is bounded by 100 liquid USDC rather than total share value',
    (await withdrawal.inputValue()) === '100',
  );
  await apply('Withdraw in preview');
  state = await changedLedger(
    'Cash-limited withdrawal cannot make vault cash negative',
    liquidityFixture,
    'withdraw',
    {
      walletMicros: '25100000000',
      poolCashMicros: '0',
    },
    '105100000000',
  );
  check(
    'Remaining illiquid shares persist while withdrawals are disabled',
    BigInt(state.shareBalanceRaw) > 0n &&
      (await page
        .getByRole('button', { name: 'Withdraw', exact: true })
        .isDisabled()),
  );
  await page.locator('.account-button').click();
  await dialog()
    .getByRole('button', { name: 'Reset preview', exact: true })
    .click();
  await dialog()
    .getByRole('button', { name: 'Reset preview', exact: true })
    .click();
  await close();
  await page.goto(`${base}/#lending`, { waitUntil: 'networkidle' });
  check(
    'Direct lending route loads',
    await page
      .getByRole('heading', { name: 'Borrow against your positions.' })
      .isVisible(),
  );
  await page
    .getByRole('navigation')
    .getByRole('button', { name: 'Marketplace', exact: true })
    .click();
  await page.goBack();
  check(
    'Browser back updates route',
    await page
      .getByRole('heading', { name: 'Borrow against your positions.' })
      .isVisible(),
  );
  await page.goForward();
  check(
    'Browser forward updates route',
    await page
      .getByRole('heading', { name: 'veKITTEN marketplace' })
      .isVisible(),
  );
  await page.emulateMedia({ reducedMotion: 'reduce' });
  check(
    'Reduced motion disables interface transitions',
    await page
      .locator('.button.primary')
      .first()
      .evaluate(
        (node) => parseFloat(getComputedStyle(node).transitionDuration) === 0,
      ),
  );
  await page.evaluate(
    ({ marketplaceKey, lendingKey }) => {
      localStorage.setItem(marketplaceKey, '{corrupt');
      localStorage.setItem(lendingKey, '{corrupt');
    },
    { marketplaceKey: marketplaceStorageKey, lendingKey: lendingStorageKey },
  );
  await page.reload({ waitUntil: 'networkidle' });
  check(
    'Corrupt marketplace and lending storage safely recover',
    (await page.locator('.market-table tbody tr').count()) === 6 &&
      isDeepStrictEqual(await ledger(), seedLedger),
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
  // Expiry removes a listing from actionable rows without manufacturing a sale.
  const beforeExpiry = await marketplaceLedger();
  await page.evaluate(
    ({ key, state }) => {
      const now = Date.now();
      const expired = {
        ...state,
        listings: state.listings.map((listing) =>
          listing.assetId === 'rift-041'
            ? {
                ...listing,
                startsAt: new Date(now - 86400000).toISOString(),
                expiresAt: new Date(now - 1).toISOString(),
              }
            : listing,
        ),
      };
      localStorage.setItem(key, JSON.stringify(expired));
    },
    { key: marketplaceStorageKey, state: beforeExpiry },
  );
  await page.reload({ waitUntil: 'networkidle' });
  check(
    'Expired listings cannot be selected or bought',
    (await marketRow('041').count()) === 0 &&
      (await marketplaceLedger()).history.length ===
        beforeExpiry.history.length &&
      (await marketplaceLedger()).balanceMicros === beforeExpiry.balanceMicros,
  );
  // Old v3 purchase receipts migrate into owned positions without charging the fresh marketplace balance.
  await page.evaluate(
    ({ key, oldKey, legacyKey }) => {
      localStorage.removeItem(key);
      localStorage.removeItem(legacyKey);
      localStorage.setItem(
        oldKey,
        JSON.stringify({
          version: 3,
          receipts: [
            {
              id: 'migration-fixture',
              kind: 'purchase',
              assetId: 'rift-041',
              createdAt: '2026-10-02T12:00:00.000Z',
              price: 4200,
              sellerFee: 21,
            },
          ],
        }),
      );
    },
    {
      key: marketplaceStorageKey,
      oldKey: oldMarketplaceStorageKey,
      legacyKey: legacyStorageKey,
    },
  );
  await page.reload({ waitUntil: 'networkidle' });
  const migratedMarketplace = await marketplaceLedger();
  check(
    'Prior purchases migrate without duplicate payment',
    migratedMarketplace.ownerByAsset['rift-041'] ===
      migratedMarketplace.ownerByAsset['market-owned-101'] &&
      migratedMarketplace.balanceMicros === '25000000000' &&
      migratedMarketplace.history.at(-1)?.kind === 'migrate' &&
      migratedMarketplace.listings.find(
        (listing) => listing.assetId === 'rift-041',
      )?.status === 'sold',
  );
  await page.reload({ waitUntil: 'networkidle' });
  check(
    'Marketplace migration is idempotent after reload',
    isDeepStrictEqual(await marketplaceLedger(), migratedMarketplace),
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
  await restrictedPage.goto(`${base}/`, { waitUntil: 'networkidle' });
  check(
    'Storage unavailable notice',
    await restrictedPage.locator('.storage-notice').isVisible(),
  );
  check(
    'Storage unavailable keeps interface usable',
    (await restrictedPage.locator('.market-table tbody tr').count()) === 6,
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
        suiteVersion: 'table-marketplace-pooled-lending-v2',
        scope:
          'Local table marketplace listing/purchase/sweep lifecycle and synthetic pooled lending balances; no live ownership, liquidity, wallet or settlement',
        checkedAt: new Date().toISOString(),
        checks,
        errors,
        externalRequests,
        accessibility,
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
