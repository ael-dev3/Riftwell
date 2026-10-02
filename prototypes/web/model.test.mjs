import test from 'node:test';
import assert from 'node:assert/strict';
import { id } from 'ethers';
import { createDemo, parseUSDC, platformFee, marketQuote, loanQuote, currentDebt,
  buyDemo, listDemo, cancelDemoListing, startDemoLoan, repayDemo, withdrawDemoCollateral, availableAssets, SCALE } from './model.js';
import { readKitten, SELECTORS, validateTokenId, rpc } from './kitten-reader.js';
import { KITTEN } from './config.js';
import { validateIndexSnapshot, indexHealth, formatAtomic } from './index-source.js';

test('decimal amounts remain exact and ambiguous or precision-losing input is rejected', () => {
  assert.equal(parseUSDC('0.000001'), 1n);
  assert.equal(parseUSDC('1000.123456'), 1_000_123_456n);
  for (const input of ['1e3', '-1', '1.0000001', '', 'Infinity', 'NaN', '.5']) assert.throws(() => parseUSDC(input));
});

test('market fee is once on seller proceeds; buyer amount and cash conservation agree', () => {
  const q = marketQuote('1000');
  assert.equal(q.buyerPays, 1000n * SCALE);
  assert.equal(q.platformFee, 5n * SCALE);
  assert.equal(q.sellerReceives, 995n * SCALE);
  assert.equal(q.sellerReceives + q.platformFee, q.buyerPays);
  assert.equal(platformFee(199n), 0n); // micros, floor exactly as the proposed Solidity rule
  assert.throws(() => marketQuote('0'));
});

test('origination and lender interest are separate, and maturity quote is deterministic', () => {
  const q = loanQuote('1000', '12', '90');
  assert.equal(q.platformFee, 5n * SCALE);
  assert.equal(q.borrowerReceives, 995n * SCALE);
  assert.equal(q.maturityInterest, 29_589_041n);
  assert.equal(q.maturityRepayment, 1_029_589_041n);
  for (const [p, apr, days] of [['0', '12', '90'], ['1', '101', '30'], ['1', '12', '0'], ['1', '12', '366'], ['1', '12', '1.2']]) assert.throws(() => loanQuote(p, apr, days));
});

test('a purchase settles only in a connected local demo and cannot be repeated', () => {
  const s = createDemo(); assert.throws(() => buyDemo(s, 'DEMO-001'));
  s.connected = true; buyDemo(s, 'DEMO-001');
  assert.equal(s.balance, 3620n * SCALE);
  assert.ok(s.assets.some(a => a.id === 'DEMO-001'));
  assert.ok(!s.listings.some(l => l.id === 'DEMO-001'));
  assert.throws(() => buyDemo(s, 'DEMO-001'));
  assert.equal(s.events.length, 1);
});

test('listing and borrowing the same collateral simultaneously is rejected', () => {
  const s = createDemo(); s.connected = true;
  listDemo(s, 'DEMO-007', '2000');
  assert.throws(() => startDemoLoan(s, 'DEMO-007', loanQuote('1000', '12', '90')));
  cancelDemoListing(s, 'DEMO-007');
  const loan = startDemoLoan(s, 'DEMO-007', loanQuote('1000', '12', '90'));
  assert.equal(s.balance, 5995n * SCALE);
  assert.throws(() => listDemo(s, 'DEMO-007', '1000'));
  assert.throws(() => startDemoLoan(s, 'DEMO-007', loanQuote('1000', '12', '90')));
  assert.ok(!availableAssets(s).some(a => a.id === loan.assetId));
});

test('partial repayment pays interest first, reduces principal, and incurs no second fee', () => {
  const s = createDemo(); s.connected = true;
  const loan = startDemoLoan(s, 'DEMO-007', loanQuote('1000', '12', '90'));
  s.day = 7;
  const before = currentDebt(s, loan);
  assert.equal(before.interest, 2_301_369n);
  repayDemo(s, loan.id, '500');
  assert.equal(loan.principal, 502_301_369n);
  assert.equal(loan.interest, 0n);
  assert.equal(s.balance, 5495n * SCALE);
  s.day = 14;
  assert.ok(currentDebt(s, loan).interest < before.interest);
  assert.equal(loan.closed, false);
});

test('maturity stops interest; settlement and collateral withdrawal are separate steps', () => {
  const s = createDemo(); s.connected = true;
  const loan = startDemoLoan(s, 'DEMO-007', loanQuote('1000', '12', '90'));
  s.day = 90; const capped = currentDebt(s, loan);
  s.day = 500; assert.equal(currentDebt(s, loan).total, capped.total);
  assert.equal(loan.closed, false);
  repayDemo(s, loan.id, capped.total);
  assert.equal(loan.closed, true);
  assert.ok(!availableAssets(s).some(a => a.id === 'DEMO-007'));
  assert.throws(() => listDemo(s, 'DEMO-007', '1000'));
  withdrawDemoCollateral(s, loan.id);
  assert.ok(availableAssets(s).some(a => a.id === 'DEMO-007'));
  assert.equal(currentDebt(s, loan).total, 0n);
  assert.throws(() => repayDemo(s, loan.id, '1'));
  assert.throws(() => withdrawDemoCollateral(s, loan.id));
});

test('collateral cannot be withdrawn before the debt is cleared', () => {
  const s = createDemo(); s.connected = true;
  const loan = startDemoLoan(s, 'DEMO-007', loanQuote('1000', '12', '90'));
  assert.throws(() => withdrawDemoCollateral(s, loan.id));
  assert.equal(loan.withdrawn, false);
});

test('fractional interest is preserved across repayments rather than reset', () => {
  const s = createDemo(); s.connected = true;
  const loan = startDemoLoan(s, 'DEMO-007', loanQuote('0.001', '12', '90'));
  s.day = 1; repayDemo(s, loan.id, '0.000001');
  assert.ok(loan.interestRemainder > 0n);
  s.day = 4; assert.ok(currentDebt(s, loan).interest > 0n);
});

test('zero, excessive and unaffordable repayment leave balances and debt unchanged', () => {
  const s = createDemo(); s.connected = true;
  const loan = startDemoLoan(s, 'DEMO-007', loanQuote('1000', '12', '90'));
  const balance = s.balance;
  assert.throws(() => repayDemo(s, loan.id, '0'));
  assert.throws(() => repayDemo(s, loan.id, '1001'));
  s.balance = 0n; assert.throws(() => repayDemo(s, loan.id, '1'));
  s.balance = balance;
  assert.equal(loan.principal, 1000n * SCALE);
  assert.equal(loan.closed, false);
});

const word = n => BigInt(n).toString(16).padStart(64, '0');
const block = { number: '0x123', timestamp: '0x68ee5555', hash: `0x${'ab'.repeat(32)}` };
function readerFixture(failSelector = null) {
  const calls = [];
  const fn = async (method, params) => {
    calls.push([method, params]);
    if (method === 'eth_chainId') return '0x3e7';
    if (method === 'eth_getBlockByNumber') return block;
    const data = params[0].data, selector = data.slice(0, 10);
    if (selector === failSelector) throw new Error('Unavailable field');
    if (selector === SELECTORS.ownerOf) return `0x${'0'.repeat(24)}${'11'.repeat(20)}`;
    if (selector === SELECTORS.locked) return `0x${word(1000n * 10n ** 18n)}${word(1850000000)}`;
    if (selector === SELECTORS.balanceOfNFT) return `0x${word(900n * 10n ** 18n)}`;
    if (selector === SELECTORS.getCurrentPeriod) return `0x${word(2961)}`;
    if (selector === SELECTORS.checkPeriodVoted) return `0x${word(1)}`;
    return `0x${word(0)}`;
  };
  return { calls, fn };
}

test('read-only selectors match exact ABI signatures including period then token ID', () => {
  const signatures = { ownerOf: 'ownerOf(uint256)', locked: 'locked(uint256)', balanceOfNFT: 'balanceOfNFT(uint256)', voted: 'voted(uint256)', getApproved: 'getApproved(uint256)', getCurrentPeriod: 'getCurrentPeriod()', checkPeriodVoted: 'checkPeriodVoted(uint256,uint256)' };
  for (const [key, signature] of Object.entries(signatures)) assert.equal(SELECTORS[key], id(signature).slice(0, 10));
});

test('public inspector pins one block and preserves disagreement between vote observations', async () => {
  const f = readerFixture(); const s = await readKitten('5174', f.fn);
  assert.equal(s.owner, `0x${'11'.repeat(20)}`);
  assert.equal(s.nftVoted, false); assert.equal(s.periodVoted, true);
  assert.equal(s.amount, (1000n * 10n ** 18n).toString());
  assert.equal(s.block, '291');
  for (const [method, params] of f.calls.filter(([m]) => m === 'eth_call')) assert.equal(params[1], '0x123');
  const vote = f.calls.find(([, p]) => p[0]?.data?.startsWith(SELECTORS.checkPeriodVoted));
  assert.equal(vote[1][0].data, SELECTORS.checkPeriodVoted + word(2961) + word(5174));
});

test('missing fields stay unavailable; an owner read never manufactures voting power', async () => {
  const f = readerFixture(SELECTORS.balanceOfNFT); const s = await readKitten('5174', f.fn);
  assert.equal(s.power, undefined); assert.equal(s.errors.power, 'Unavailable field');
  assert.equal(s.nftVoted, false); assert.equal(s.periodVoted, true);
});

test('wrong chain, invalid IDs, and write RPC methods are rejected', async () => {
  const f = readerFixture();
  await assert.rejects(() => readKitten('5174', async (method, params) => method === 'eth_chainId' ? '0x1' : f.fn(method, params)));
  for (const value of ['0', '-1', '1e5', 'abc', (2n ** 256n).toString()]) assert.throws(() => validateTokenId(value));
  await assert.rejects(() => rpc('eth_sendTransaction', [], () => { throw new Error('Never called'); }));
  assert.equal(KITTEN.riftwellDeployment, null);
});

function indexedFixture(now = Date.now()) {
  const hash = `0x${'12'.repeat(32)}`;
  return { schemaVersion: 1,
    source: { kind: 'riftwell-market-events', chainId: 999, market: `0x${'11'.repeat(20)}`, collection: KITTEN.escrow, paymentToken: KITTEN.usdc,
      paymentDecimals: 6, deploymentBlock: 1, deploymentBlockHash: hash, expectedMarketCodeHash: hash, abiHash: hash, confirmations: 2 },
    sync: { status: 'synced', stale: false, lastSuccessfulSyncAt: new Date(now).toISOString(), staleAfterSeconds: 90, lagBlocks: 0, rolledBackBlocks: 0,
      observedHead: { number: 102, hash, timestamp: Math.floor(now / 1000) }, indexedThrough: { number: 100, hash, timestamp: Math.floor(now / 1000) - 4 } },
    listings: [{ listingId: '1', tokenId: '42', priceAtomic: '1234567', expiry: '1890000000', seller: `0x${'44'.repeat(20)}`,
      orderState: 'active', observation: { status: 'ownership_and_approval_observed', transactionSimulation: 'not_performed' } }], transactionSimulation: 'not_performed' };
}

test('configured index snapshots keep atomic amounts and age independently in the browser', () => {
  const now = Date.parse('2026-10-02T14:00:00Z');
  const snapshot = validateIndexSnapshot(indexedFixture(now));
  assert.equal(formatAtomic(snapshot.listings[0].priceAtomic, 6), '1.234567');
  assert.equal(formatAtomic('1', 6), '0.000001');
  assert.equal(indexHealth(snapshot, now).stale, false);
  assert.equal(indexHealth(snapshot, now + 91_000).stale, true);
  assert.equal(indexHealth(snapshot, now - 60_000).clockSkew, true);
  snapshot.sync.status = 'error'; assert.equal(indexHealth(snapshot, now).label, 'Index sync failed');
  const unconfigured = validateIndexSnapshot({ schemaVersion: 1, source: null, listings: [], sync: { status: 'unconfigured' } });
  assert.equal(indexHealth(unconfigured, now).configured, false);
});

test('malformed or injected index metadata is rejected before it reaches the interface', () => {
  for (const mutate of [
    s => s.sync.observedHead.number = '<img src=x onerror=alert(1)>',
    s => s.sync.rolledBackBlocks = '<script>',
    s => s.listings[0].priceAtomic = '1.5',
    s => s.listings.push(s.listings[0]),
    s => s.source.market = 'javascript:alert(1)',
    s => s.listings[0].observation.status = 'transferable',
    s => s.transactionSimulation = 'success',
  ]) { const snapshot = indexedFixture(); mutate(snapshot); assert.throws(() => validateIndexSnapshot(snapshot)); }
  assert.throws(() => validateIndexSnapshot({ schemaVersion: 1, listings: [{}], sync: { status: 'unconfigured' } }));
});

function financedSnapshot(now = Date.parse('2026-10-02T14:00:00Z')) {
  const snapshot = indexedFixture(now), s = snapshot.source, sync = snapshot.sync, hash = sync.indexedThrough.hash;
  const lender = `0x${'55'.repeat(20)}`, borrower = snapshot.listings[0].seller, vault = `0x${'77'.repeat(20)}`;
  const pin = { atBlock: sync.indexedThrough.number, blockHash: hash }, debt = { principalAtomic: '9007199254741993', interestAtomic: '99', totalAtomic: '9007199254742092', ...pin };
  snapshot.listings[0].sourceKind = 'market'; snapshot.listings[0].orderKey = 'market:1';
  snapshot.financedSource = { kind: 'riftwell-loans-events', chainId: s.chainId, loans: `0x${'66'.repeat(20)}`, collection: s.collection, paymentToken: s.paymentToken,
    paymentDecimals: s.paymentDecimals, confirmations: s.confirmations, deploymentBlock: 2, deploymentBlockHash: hash, expectedCodeHash: hash, abiHash: hash,
    voter: `0x${'88'.repeat(20)}`, treasury: `0x${'99'.repeat(20)}`, guardian: `0x${'aa'.repeat(20)}`, claimsVerified: true, creditCoverage: 'complete_manager_events' };
  const price = '10000000000000000', fee = BigInt(price) * 50n / 10000n, net = BigInt(price) - fee;
  snapshot.listings.push({ sourceKind: 'financed', orderKey: 'financed:1', listingId: '1', loanId: '1', tokenId: '7', seller: borrower, priceAtomic: price, expiry: '1890000000',
    orderState: 'active', loanState: 'active', collateralState: 'custody', observation: { status: 'custody_and_debt_observed', ...pin, transactionSimulation: 'not_performed' }, debt,
    coverage: { saleFeeAtomic: fee.toString(), netSaleAtomic: net.toString(), debtAtomic: debt.totalAtomic, coversDebt: true, borrowerResidualAtomic: (net - BigInt(debt.totalAtomic)).toString(), ...pin } });
  snapshot.loans = [{ loanId: '1', offerId: '1', tokenId: '7', lender, borrower, vault, principalAtomic: debt.principalAtomic, aprBps: '1200', maturity: '1890000000',
    lastAccrued: '1790930000', accruedInterestAtomic: '0', interestRemainder: '99', activeListingId: '1', loanState: 'active', collateralState: 'custody', debt,
    observation: { status: 'loan_and_custody_observed', ...pin, transactionSimulation: 'not_performed' } }];
  snapshot.creditAccounts = [{ account: lender, lenderCreditAtomic: '9007199254742993', borrowerCreditAtomic: '0', observation: { status: 'credits_observed', ...pin, transactionSimulation: 'not_performed' } }];
  return snapshot;
}

test('mixed source IDs, exact financed debt and account credits survive schema validation and aging', () => {
  const now = Date.parse('2026-10-02T14:00:00Z'), snapshot = validateIndexSnapshot(financedSnapshot(now));
  assert.deepEqual(snapshot.listings.map(order => order.orderKey), ['market:1', 'financed:1']);
  assert.equal(snapshot.listings[1].debt.totalAtomic, '9007199254742092');
  assert.equal(formatAtomic(snapshot.creditAccounts[0].lenderCreditAtomic, 6), '9,007,199,254.742993');
  assert.equal(indexHealth(snapshot, now).stale, false);
  assert.equal(indexHealth(snapshot, now + 91_000).stale, true);
});

test('financed source mismatch, wrong block, debt arithmetic, coverage and account duplication fail closed', () => {
  for (const mutate of [
    s => s.financedSource.chainId++,
    s => s.financedSource.collection = s.financedSource.loans,
    s => s.financedSource.creditCoverage = 'guessed',
    s => s.financedSource.claimsVerified = 'true',
    s => s.listings[1].sourceKind = 'market',
    s => s.listings[1].orderKey = 'market:1',
    s => s.listings[1].debt.atBlock++,
    s => s.listings[1].debt.totalAtomic = '123',
    s => s.listings[1].coverage.saleFeeAtomic = '1',
    s => s.listings[1].coverage.coversDebt = false,
    s => s.listings[1].coverage.borrowerResidualAtomic = '1',
    s => s.listings[1].loanId = '99',
    s => s.loans[0].borrower = s.loans[0].lender,
    s => s.loans[0].observation.transactionSimulation = 'passed',
    s => s.creditAccounts[0].lenderCreditAtomic = 9007199254742993,
    s => s.creditAccounts[0].observation.blockHash = `0x${'ff'.repeat(32)}`,
    s => s.creditAccounts.push(s.creditAccounts[0]),
  ]) { const snapshot = financedSnapshot(); mutate(snapshot); assert.throws(() => validateIndexSnapshot(snapshot)); }
});
