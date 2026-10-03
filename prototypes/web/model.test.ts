import test from 'node:test';
import assert from 'node:assert/strict';
import { id } from 'ethers';
import {
  createDemo,
  parseUSDC,
  platformFee,
  marketQuote,
  loanQuote,
  currentDebt,
  buyDemo,
  listDemo,
  cancelDemoListing,
  startDemoLoan,
  repayDemo,
  withdrawDemoCollateral,
  availableAssets,
  SCALE,
} from './model.ts';
import {
  readKitten,
  SELECTORS,
  validateTokenId,
  rpc,
  type RpcReader,
} from './kitten-reader.ts';
import { KITTEN } from './config.ts';
import {
  validateIndexSnapshot,
  indexHealth,
  formatAtomic,
} from './index-source.ts';
import type {
  IndexSnapshot,
  IndexSource,
  IndexSync,
  BlockIdentity,
  FinancedSource,
  IndexLoan,
  IndexCreditAccount,
} from './index-types.ts';

test('decimal amounts remain exact and ambiguous or precision-losing input is rejected', () => {
  assert.equal(parseUSDC('0.000001'), 1n);
  assert.equal(parseUSDC('1000.123456'), 1_000_123_456n);
  for (const input of ['1e3', '-1', '1.0000001', '', 'Infinity', 'NaN', '.5'])
    assert.throws(() => parseUSDC(input));
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
  for (const [p, apr, days] of [
    ['0', '12', '90'],
    ['1', '101', '30'],
    ['1', '12', '0'],
    ['1', '12', '366'],
    ['1', '12', '1.2'],
  ])
    assert.throws(() => loanQuote(p, apr, days));
});

test('a purchase settles only in a connected local demo and cannot be repeated', () => {
  const s = createDemo();
  assert.throws(() => buyDemo(s, 'DEMO-001'));
  s.connected = true;
  buyDemo(s, 'DEMO-001');
  assert.equal(s.balance, 3620n * SCALE);
  assert.ok(s.assets.some((a) => a.id === 'DEMO-001'));
  assert.ok(!s.listings.some((l) => l.id === 'DEMO-001'));
  assert.throws(() => buyDemo(s, 'DEMO-001'));
  assert.equal(s.events.length, 1);
});

test('listing and borrowing the same collateral simultaneously is rejected', () => {
  const s = createDemo();
  s.connected = true;
  listDemo(s, 'DEMO-007', '2000');
  assert.throws(() =>
    startDemoLoan(s, 'DEMO-007', loanQuote('1000', '12', '90')),
  );
  cancelDemoListing(s, 'DEMO-007');
  const loan = startDemoLoan(s, 'DEMO-007', loanQuote('1000', '12', '90'));
  assert.equal(s.balance, 5995n * SCALE);
  assert.throws(() => listDemo(s, 'DEMO-007', '1000'));
  assert.throws(() =>
    startDemoLoan(s, 'DEMO-007', loanQuote('1000', '12', '90')),
  );
  assert.ok(!availableAssets(s).some((a) => a.id === loan.assetId));
});

test('partial repayment pays interest first, reduces principal, and incurs no second fee', () => {
  const s = createDemo();
  s.connected = true;
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
  const s = createDemo();
  s.connected = true;
  const loan = startDemoLoan(s, 'DEMO-007', loanQuote('1000', '12', '90'));
  s.day = 90;
  const capped = currentDebt(s, loan);
  s.day = 500;
  assert.equal(currentDebt(s, loan).total, capped.total);
  assert.equal(loan.closed, false);
  repayDemo(s, loan.id, capped.total);
  assert.equal(loan.closed, true);
  assert.ok(!availableAssets(s).some((a) => a.id === 'DEMO-007'));
  assert.throws(() => listDemo(s, 'DEMO-007', '1000'));
  withdrawDemoCollateral(s, loan.id);
  assert.ok(availableAssets(s).some((a) => a.id === 'DEMO-007'));
  assert.equal(currentDebt(s, loan).total, 0n);
  assert.throws(() => repayDemo(s, loan.id, '1'));
  assert.throws(() => withdrawDemoCollateral(s, loan.id));
});

test('collateral cannot be withdrawn before the debt is cleared', () => {
  const s = createDemo();
  s.connected = true;
  const loan = startDemoLoan(s, 'DEMO-007', loanQuote('1000', '12', '90'));
  assert.throws(() => withdrawDemoCollateral(s, loan.id));
  assert.equal(loan.withdrawn, false);
});

test('fractional interest is preserved across repayments rather than reset', () => {
  const s = createDemo();
  s.connected = true;
  const loan = startDemoLoan(s, 'DEMO-007', loanQuote('0.001', '12', '90'));
  s.day = 1;
  repayDemo(s, loan.id, '0.000001');
  assert.ok(loan.interestRemainder > 0n);
  s.day = 4;
  assert.ok(currentDebt(s, loan).interest > 0n);
});

test('zero, excessive and unaffordable repayment leave balances and debt unchanged', () => {
  const s = createDemo();
  s.connected = true;
  const loan = startDemoLoan(s, 'DEMO-007', loanQuote('1000', '12', '90'));
  const balance = s.balance;
  assert.throws(() => repayDemo(s, loan.id, '0'));
  assert.throws(() => repayDemo(s, loan.id, '1001'));
  s.balance = 0n;
  assert.throws(() => repayDemo(s, loan.id, '1'));
  s.balance = balance;
  assert.equal(loan.principal, 1000n * SCALE);
  assert.equal(loan.closed, false);
});

function callData(params: readonly unknown[]): string {
  const call = params[0];
  assert.ok(
    call !== null &&
      typeof call === 'object' &&
      'data' in call &&
      typeof call.data === 'string',
    'ABI fixture requires an encoded call',
  );
  return call.data;
}
function writePath(
  root: unknown,
  path: readonly (string | number)[],
  value: unknown,
): void {
  assert.ok(path.length > 0);
  let current = root;
  for (const key of path.slice(0, -1)) {
    assert.ok(
      current !== null && typeof current === 'object',
      'Corruption path must name an existing object',
    );
    current = (current as Record<string | number, unknown>)[key];
  }
  assert.ok(
    current !== null && typeof current === 'object',
    'Corruption target must exist',
  );
  const key = path.at(-1);
  assert.ok(key !== undefined);
  (current as Record<string | number, unknown>)[key] = value;
}

const word = (n: bigint | number) => BigInt(n).toString(16).padStart(64, '0');
const block = {
  number: '0x123',
  timestamp: '0x68ee5555',
  hash: `0x${'ab'.repeat(32)}`,
};
function readerFixture(failSelector: string | null = null) {
  const calls: [string, readonly unknown[]][] = [];
  const fn: RpcReader = async (method, params) => {
    calls.push([method, params]);
    if (method === 'eth_chainId') return '0x3e7';
    if (method === 'eth_getBlockByNumber') return block;
    const data = callData(params),
      selector = data.slice(0, 10);
    if (selector === failSelector) throw new Error('Unavailable field');
    if (selector === SELECTORS.ownerOf)
      return `0x${'0'.repeat(24)}${'11'.repeat(20)}`;
    if (selector === SELECTORS.locked)
      return `0x${word(1000n * 10n ** 18n)}${word(1850000000)}`;
    if (selector === SELECTORS.balanceOfNFT)
      return `0x${word(900n * 10n ** 18n)}`;
    if (selector === SELECTORS.getCurrentPeriod) return `0x${word(2961)}`;
    if (selector === SELECTORS.checkPeriodVoted) return `0x${word(1)}`;
    return `0x${word(0)}`;
  };
  return { calls, fn };
}

test('read-only selectors match exact ABI signatures including period then token ID', () => {
  const signatures = {
    ownerOf: 'ownerOf(uint256)',
    locked: 'locked(uint256)',
    balanceOfNFT: 'balanceOfNFT(uint256)',
    voted: 'voted(uint256)',
    getApproved: 'getApproved(uint256)',
    getCurrentPeriod: 'getCurrentPeriod()',
    checkPeriodVoted: 'checkPeriodVoted(uint256,uint256)',
  };
  for (const [key, signature] of Object.entries(signatures))
    assert.equal(
      SELECTORS[key as keyof typeof SELECTORS],
      id(signature).slice(0, 10),
    );
});

test('public inspector pins one block and preserves disagreement between vote observations', async () => {
  const f = readerFixture();
  const s = await readKitten('5174', f.fn);
  assert.equal(s.owner, `0x${'11'.repeat(20)}`);
  assert.equal(s.nftVoted, false);
  assert.equal(s.periodVoted, true);
  assert.equal(s.amount, (1000n * 10n ** 18n).toString());
  assert.equal(s.block, '291');
  for (const [method, params] of f.calls.filter(([m]) => m === 'eth_call'))
    assert.equal(params[1], '0x123');
  const vote = f.calls.find(
    ([method, params]) =>
      method === 'eth_call' &&
      callData(params).startsWith(SELECTORS.checkPeriodVoted),
  );
  assert.ok(vote, 'Period vote read must exist');
  assert.equal(
    callData(vote[1]),
    SELECTORS.checkPeriodVoted + word(2961) + word(5174),
  );
});

test('missing fields stay unavailable; an owner read never manufactures voting power', async () => {
  const f = readerFixture(SELECTORS.balanceOfNFT);
  const s = await readKitten('5174', f.fn);
  assert.equal(s.power, undefined);
  assert.equal(s.errors.power, 'Unavailable field');
  assert.equal(s.nftVoted, false);
  assert.equal(s.periodVoted, true);
});

test('wrong chain, invalid IDs, and write RPC methods are rejected', async () => {
  const f = readerFixture();
  await assert.rejects(() =>
    readKitten('5174', async (method, params) =>
      method === 'eth_chainId' ? '0x1' : f.fn(method, params),
    ),
  );
  for (const value of ['0', '-1', '1e5', 'abc', (2n ** 256n).toString()])
    assert.throws(() => validateTokenId(value));
  await assert.rejects(() =>
    rpc('eth_sendTransaction', [], () => {
      throw new Error('Never called');
    }),
  );
  assert.equal(KITTEN.riftwellDeployment, null);
});

type ConfiguredFixture = IndexSnapshot & {
  source: IndexSource;
  sync: IndexSync & {
    indexedThrough: BlockIdentity;
    observedHead: BlockIdentity;
  };
};
function indexedFixture(now = Date.now()): ConfiguredFixture {
  const hash = `0x${'12'.repeat(32)}`;
  return {
    schemaVersion: 1,
    source: {
      kind: 'riftwell-market-events',
      chainId: 999,
      market: `0x${'11'.repeat(20)}`,
      collection: KITTEN.escrow,
      paymentToken: KITTEN.usdc,
      paymentDecimals: 6,
      deploymentBlock: 1,
      deploymentBlockHash: hash,
      expectedMarketCodeHash: hash,
      abiHash: hash,
      confirmations: 2,
    },
    sync: {
      status: 'synced',
      stale: false,
      lastSuccessfulSyncAt: new Date(now).toISOString(),
      staleAfterSeconds: 90,
      lagBlocks: 0,
      rolledBackBlocks: 0,
      observedHead: { number: 102, hash, timestamp: Math.floor(now / 1000) },
      indexedThrough: {
        number: 100,
        hash,
        timestamp: Math.floor(now / 1000) - 4,
      },
    },
    listings: [
      {
        listingId: '1',
        tokenId: '42',
        priceAtomic: '1234567',
        expiry: '1890000000',
        seller: `0x${'44'.repeat(20)}`,
        orderState: 'active',
        observation: {
          status: 'ownership_and_approval_observed',
          transactionSimulation: 'not_performed',
        },
      },
    ],
    transactionSimulation: 'not_performed',
  };
}

test('configured index snapshots keep atomic amounts and age independently in the browser', () => {
  const now = Date.parse('2026-10-02T14:00:00Z');
  const snapshot = validateIndexSnapshot(indexedFixture(now));
  assert.equal(formatAtomic(snapshot.listings[0].priceAtomic, 6), '1.234567');
  assert.equal(formatAtomic('1', 6), '0.000001');
  assert.equal(indexHealth(snapshot, now).stale, false);
  assert.equal(indexHealth(snapshot, now + 91_000).stale, true);
  assert.equal(indexHealth(snapshot, now - 60_000).clockSkew, true);
  snapshot.sync.status = 'error';
  assert.equal(indexHealth(snapshot, now).label, 'Index sync failed');
  const unconfigured = validateIndexSnapshot({
    schemaVersion: 1,
    source: null,
    listings: [],
    sync: { status: 'unconfigured' },
  });
  assert.equal(indexHealth(unconfigured, now).configured, false);
});

test('malformed or injected index metadata is rejected before it reaches the interface', () => {
  const changes: [readonly (string | number)[], unknown][] = [
    [['sync', 'observedHead', 'number'], '<img src=x onerror=alert(1)>'],
    [['sync', 'rolledBackBlocks'], '<script>'],
    [['listings', 0, 'priceAtomic'], '1.5'],
    [['source', 'market'], 'javascript:alert(1)'],
    [['listings', 0, 'observation', 'status'], 'transferable'],
    [['transactionSimulation'], 'success'],
  ];
  for (const [path, value] of changes) {
    const snapshot = indexedFixture();
    writePath(snapshot, path, value);
    assert.throws(() => validateIndexSnapshot(snapshot));
  }
  const duplicate = indexedFixture();
  duplicate.listings.push(duplicate.listings[0]);
  assert.throws(() => validateIndexSnapshot(duplicate));
  assert.throws(() =>
    validateIndexSnapshot({
      schemaVersion: 1,
      listings: [{}],
      sync: { status: 'unconfigured' },
    }),
  );
});

function financedSnapshot(
  now = Date.parse('2026-10-02T14:00:00Z'),
): ConfiguredFixture & {
  financedSource: FinancedSource;
  loans: IndexLoan[];
  creditAccounts: IndexCreditAccount[];
} {
  const snapshot = indexedFixture(now),
    s = snapshot.source,
    sync = snapshot.sync,
    hash = sync.indexedThrough.hash;
  const lender = `0x${'55'.repeat(20)}`,
    borrower = snapshot.listings[0].seller,
    vault = `0x${'77'.repeat(20)}`;
  const pin = { atBlock: sync.indexedThrough.number, blockHash: hash },
    debt = {
      principalAtomic: '9007199254741993',
      interestAtomic: '99',
      totalAtomic: '9007199254742092',
      ...pin,
    };
  snapshot.listings[0].sourceKind = 'market';
  snapshot.listings[0].orderKey = 'market:1';
  snapshot.financedSource = {
    kind: 'riftwell-loans-events',
    chainId: s.chainId,
    loans: `0x${'66'.repeat(20)}`,
    collection: s.collection,
    paymentToken: s.paymentToken,
    paymentDecimals: s.paymentDecimals,
    confirmations: s.confirmations,
    deploymentBlock: 2,
    deploymentBlockHash: hash,
    expectedCodeHash: hash,
    abiHash: hash,
    voter: `0x${'88'.repeat(20)}`,
    treasury: `0x${'99'.repeat(20)}`,
    guardian: `0x${'aa'.repeat(20)}`,
    claimsVerified: true,
    creditCoverage: 'complete_manager_events',
  };
  const price = '10000000000000000',
    fee = (BigInt(price) * 50n) / 10000n,
    net = BigInt(price) - fee;
  snapshot.listings.push({
    sourceKind: 'financed',
    orderKey: 'financed:1',
    listingId: '1',
    loanId: '1',
    tokenId: '7',
    seller: borrower,
    priceAtomic: price,
    expiry: '1890000000',
    orderState: 'active',
    loanState: 'active',
    collateralState: 'custody',
    observation: {
      status: 'custody_and_debt_observed',
      ...pin,
      transactionSimulation: 'not_performed',
    },
    debt,
    coverage: {
      saleFeeAtomic: fee.toString(),
      netSaleAtomic: net.toString(),
      debtAtomic: debt.totalAtomic,
      coversDebt: true,
      borrowerResidualAtomic: (net - BigInt(debt.totalAtomic)).toString(),
      ...pin,
    },
  });
  snapshot.loans = [
    {
      loanId: '1',
      offerId: '1',
      tokenId: '7',
      lender,
      borrower,
      vault,
      principalAtomic: debt.principalAtomic,
      aprBps: '1200',
      maturity: '1890000000',
      lastAccrued: '1790930000',
      accruedInterestAtomic: '0',
      interestRemainder: '99',
      activeListingId: '1',
      loanState: 'active',
      collateralState: 'custody',
      debt,
      observation: {
        status: 'loan_and_custody_observed',
        ...pin,
        transactionSimulation: 'not_performed',
      },
    },
  ];
  snapshot.creditAccounts = [
    {
      account: lender,
      lenderCreditAtomic: '9007199254742993',
      borrowerCreditAtomic: '0',
      observation: {
        status: 'credits_observed',
        ...pin,
        transactionSimulation: 'not_performed',
      },
    },
  ];
  assert.ok(
    snapshot.financedSource && snapshot.loans && snapshot.creditAccounts,
  );
  return {
    ...snapshot,
    financedSource: snapshot.financedSource,
    loans: snapshot.loans,
    creditAccounts: snapshot.creditAccounts,
  };
}

test('mixed source IDs, exact financed debt and account credits survive schema validation and aging', () => {
  const now = Date.parse('2026-10-02T14:00:00Z'),
    snapshot = validateIndexSnapshot(financedSnapshot(now));
  assert.deepEqual(
    snapshot.listings.map((order) => order.orderKey),
    ['market:1', 'financed:1'],
  );
  assert.ok(snapshot.listings[1].debt && snapshot.creditAccounts);
  assert.equal(snapshot.listings[1].debt.totalAtomic, '9007199254742092');
  assert.equal(
    formatAtomic(snapshot.creditAccounts[0].lenderCreditAtomic, 6),
    '9,007,199,254.742993',
  );
  assert.equal(indexHealth(snapshot, now).stale, false);
  assert.equal(indexHealth(snapshot, now + 91_000).stale, true);
});

test('financed source mismatch, wrong block, debt arithmetic, coverage and account duplication fail closed', () => {
  const changes: [readonly (string | number)[], unknown][] = [
    [['financedSource', 'chainId'], 1],
    [['financedSource', 'collection'], `0x${'66'.repeat(20)}`],
    [['financedSource', 'creditCoverage'], 'guessed'],
    [['financedSource', 'claimsVerified'], 'true'],
    [['listings', 1, 'sourceKind'], 'market'],
    [['listings', 1, 'orderKey'], 'market:1'],
    [['listings', 1, 'debt', 'atBlock'], 101],
    [['listings', 1, 'debt', 'totalAtomic'], '123'],
    [['listings', 1, 'coverage', 'saleFeeAtomic'], '1'],
    [['listings', 1, 'coverage', 'coversDebt'], false],
    [['listings', 1, 'coverage', 'borrowerResidualAtomic'], '1'],
    [['listings', 1, 'loanId'], '99'],
    [['loans', 0, 'borrower'], `0x${'55'.repeat(20)}`],
    [['loans', 0, 'observation', 'transactionSimulation'], 'passed'],
    [['creditAccounts', 0, 'lenderCreditAtomic'], 9007199254742993],
    [['creditAccounts', 0, 'observation', 'blockHash'], `0x${'ff'.repeat(32)}`],
  ];
  for (const [path, value] of changes) {
    const snapshot = financedSnapshot();
    writePath(snapshot, path, value);
    assert.throws(() => validateIndexSnapshot(snapshot));
  }
  const duplicate = financedSnapshot();
  duplicate.creditAccounts.push(duplicate.creditAccounts[0]);
  assert.throws(() => validateIndexSnapshot(duplicate));
});

test('malformed RPC envelopes and block identity fail before unverified fields are returned', async () => {
  for (const body of [
    null,
    [],
    { result: null },
    { result: '0x1', error: { message: 'RPC rejected' } },
  ]) {
    const fetcher: typeof fetch = async () =>
      new Response(JSON.stringify(body), { status: 200 });
    await assert.rejects(() => rpc('eth_chainId', [], fetcher));
  }
  const f = readerFixture();
  await assert.rejects(() =>
    readKitten('5174', async (method, params) =>
      method === 'eth_getBlockByNumber'
        ? { ...block, hash: '<script>' }
        : f.fn(method, params),
    ),
  );
  assert.throws(() => validateTokenId(Number.MAX_SAFE_INTEGER + 1));
});
