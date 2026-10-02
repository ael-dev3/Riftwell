import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';

const require = createRequire(import.meta.url);
const base = process.env.RIFTWELL_PREVIEW_URL ?? 'http://127.0.0.1:5191';
const output = new URL('../docs/qa/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
const errors = [];
const externalRequests = [];
const checks = [];
const accessibility = [];
let status = 'failed';
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
page.on('request', (request) => {
  if (!request.url().startsWith(base) && !request.url().startsWith('data:'))
    externalRequests.push(request.url());
});
const check = (name, condition) => {
  assert.ok(condition, name);
  checks.push(name);
};
const dialog = () => page.getByRole('dialog');
async function audit(name) {
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
async function fits(name) {
  const sizes = await page.evaluate(() => ({
    width: innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  check(`No horizontal overflow: ${name}`, sizes.scrollWidth === sizes.width);
}
async function close() {
  await page.keyboard.press('Escape');
  await dialog().waitFor({ state: 'hidden' });
}
try {
  await page.goto(base, { waitUntil: 'networkidle' });
  check(
    'Six sample NFT positions',
    (await page.locator('.asset-card').count()) === 6,
  );
  check(
    'Exactly two primary sections',
    (await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('button')
      .count()) === 2,
  );
  check('Initial hash route', new URL(page.url()).hash === '#marketplace');
  check(
    'Local artwork loads',
    await page
      .locator('.asset-card img')
      .evaluateAll((images) =>
        images.every((img) => img.complete && img.naturalWidth > 0),
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
    await page
      .getByRole('heading', { name: 'No positions found.' })
      .isVisible(),
  );
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await page.getByLabel('Lock category').selectOption('Max lock');
  check('Lock filter', (await page.locator('.asset-card').count()) === 1);
  await page.getByLabel('Lock category').selectOption('All');
  await page.getByLabel('Sort positions').selectOption('price-asc');
  check(
    'Ask sorting',
    (await page.locator('.asset-title').first().textContent()).includes('#062'),
  );
  await page.getByLabel('Sort positions').selectOption('curated');
  const detailTrigger = page.getByRole('button', {
    name: 'View Rift Position #041',
    exact: true,
  });
  await detailTrigger.click();
  await audit('position details');
  check(
    'Position lock and reference value shown',
    (await dialog().textContent()).includes('5,000 USDC') &&
      (await dialog().textContent()).includes('2 Oct 2027'),
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
    'Focus returns to details trigger',
    await detailTrigger.evaluate((node) => document.activeElement === node),
  );
  await page
    .getByRole('button', { name: 'Review purchase of Rift Position #041' })
    .click();
  await audit('purchase review');
  check(
    'Seller pays exact 0.5% fee',
    (await dialog().textContent()).includes('21 USDC') &&
      (await dialog().textContent()).includes('4,179 USDC'),
  );
  await page.getByRole('button', { name: 'Save preview purchase' }).click();
  await page.getByRole('button', { name: 'View preview account' }).click();
  check(
    'Purchase receipt saved',
    await dialog()
      .getByRole('heading', { name: 'Rift Position #041' })
      .isVisible(),
  );
  await audit('preview account');
  await close();
  check(
    'Purchased preview removed from marketplace',
    (await page.locator('.asset-card').count()) === 5,
  );
  await page.reload({ waitUntil: 'networkidle' });
  check(
    'Purchase persists after reload',
    (await page.locator('.asset-card').count()) === 5,
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
  await page
    .getByRole('button', { name: 'Review loan', exact: true })
    .first()
    .click();
  await fits('loan dialog mobile');
  await audit('loan mobile');
  await page.setViewportSize({ width: 1440, height: 1000 });
  const amount = page.getByLabel('Borrow amount');
  for (const invalid of ['999999', '1e3', '0x10', '1.0000001']) {
    await amount.fill(invalid);
    await page.getByRole('button', { name: 'Save preview loan' }).click();
    check(
      `Reject invalid amount ${invalid}`,
      (await amount.getAttribute('aria-invalid')) === 'true' &&
        (await page.getByRole('alert').textContent()).length > 0,
    );
  }
  await amount.fill('1000');
  await page.getByLabel('Duration', { exact: true }).selectOption('7');
  check(
    'Borrow proceeds and interest separated',
    (await dialog().textContent()).includes('5 USDC') &&
      (await dialog().textContent()).includes('995 USDC') &&
      (await dialog().textContent()).includes('2.301369 USDC'),
  );
  await audit('loan desktop');
  await page.screenshot({
    path: new URL('loan-review.png', output).pathname,
    animations: 'disabled',
  });
  await page.getByRole('button', { name: 'Save preview loan' }).click();
  await page.getByRole('button', { name: 'View preview account' }).click();
  check(
    'Loan saved in matching account tab',
    (await page
      .getByRole('button', { name: 'Loans', exact: true })
      .getAttribute('aria-pressed')) === 'true',
  );
  await page.getByText('Receipt breakdown', { exact: true }).click();
  check(
    'Account loan accounting visible',
    (await dialog().textContent()).includes('1,002.301369 USDC'),
  );
  await page
    .getByRole('button', { name: 'Cancel preview loan', exact: true })
    .click();
  await page.getByRole('button', { name: 'Go back', exact: true }).click();
  check(
    'Cancellation can be declined',
    await page
      .getByRole('button', { name: 'Cancel preview loan', exact: true })
      .isVisible(),
  );
  await page
    .getByRole('button', { name: 'Cancel preview loan', exact: true })
    .click();
  await page.getByRole('button', { name: 'Confirm cancellation' }).click();
  check(
    'Cancellation retains receipt',
    (await dialog().textContent()).includes('Cancelled'),
  );
  await close();
  check(
    'Cancelled collateral available again',
    (await page
      .getByRole('button', { name: 'Review loan', exact: true })
      .count()) === 3,
  );
  await page.getByRole('button', { name: 'Lend', exact: true }).click();
  await page
    .getByRole('button', { name: 'Make proposal', exact: true })
    .first()
    .click();
  await page.getByLabel('Proposed amount').fill('1000');
  const apr = page.getByLabel('Proposed annual rate (%)');
  await apr.fill('41');
  await page
    .getByRole('button', { name: 'Save proposal', exact: true })
    .click();
  check(
    'APR cap validation',
    (await apr.getAttribute('aria-invalid')) === 'true',
  );
  await apr.fill('10.25');
  await audit('lending proposal');
  await page
    .getByRole('button', { name: 'Save proposal', exact: true })
    .click();
  await page.getByRole('button', { name: 'View preview account' }).click();
  check(
    'Proposal saved in matching account tab',
    (await page
      .getByRole('button', { name: 'Proposals', exact: true })
      .getAttribute('aria-pressed')) === 'true',
  );
  await page
    .getByRole('button', { name: 'Cancel proposal', exact: true })
    .click();
  await page.getByRole('button', { name: 'Confirm cancellation' }).click();
  check(
    'Proposal cancellation',
    (await dialog().textContent()).includes('Cancelled'),
  );
  await page
    .getByRole('button', { name: 'Reset preview', exact: true })
    .click();
  await page.getByRole('button', { name: 'Keep my preview' }).click();
  check(
    'Reset confirmation can be declined',
    await dialog()
      .getByRole('button', { name: 'Reset preview', exact: true })
      .isEnabled(),
  );
  await page
    .getByRole('button', { name: 'Reset preview', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Reset preview', exact: true })
    .click();
  check(
    'Reset clears all receipts',
    (await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem('riftwell.positions-preview.v2'))
          .receipts.length,
    )) === 0,
  );
  await close();
  await page.goto(`${base}/#lending`, { waitUntil: 'networkidle' });
  check(
    'Direct lending route loads',
    await page
      .getByRole('heading', { name: 'Borrow against your position.' })
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
      .getByRole('heading', { name: 'Borrow against your position.' })
      .isVisible(),
  );
  await page.goForward();
  check(
    'Browser forward updates route',
    await page
      .getByRole('heading', { name: 'Trade NFT positions.' })
      .isVisible(),
  );
  await page.emulateMedia({ reducedMotion: 'reduce' });
  check(
    'Reduced motion suppresses portal animation',
    await page
      .locator('.portal-orbit')
      .first()
      .evaluate(
        (node) =>
          ['none', '0.01ms', '1e-05s'].includes(
            getComputedStyle(node).animationName,
          ) || parseFloat(getComputedStyle(node).animationDuration) <= 0.00001,
      ),
  );
  await page.evaluate(() =>
    localStorage.setItem('riftwell.positions-preview.v2', '{corrupt'),
  );
  await page.reload({ waitUntil: 'networkidle' });
  check(
    'Corrupt storage safely recovers',
    (await page.locator('.asset-card').count()) === 6,
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
  await restrictedPage.goto(base, { waitUntil: 'networkidle' });
  check(
    'Storage unavailable notice',
    await restrictedPage.locator('.storage-notice').isVisible(),
  );
  check(
    'Storage unavailable keeps interface usable',
    (await restrictedPage.locator('.asset-card').count()) === 6,
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
