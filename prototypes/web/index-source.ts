import type {
  BlockIdentity,
  CollateralState,
  Debt,
  DebtCoverage,
  FinancedSource,
  IndexCreditAccount,
  IndexHealth,
  IndexLoan,
  IndexOrder,
  IndexSnapshot,
  IndexSource,
  IndexSync,
  LoanState,
  Observation,
  ObservationStatus,
  OrderState,
} from './index-types.ts';
export type * from './index-types.ts';

const ADDRESS = /^0x[0-9a-f]{40}$/i;
const HASH = /^0x[0-9a-f]{64}$/i;
const UINT = /^\d+$/;
const ORDER_STATES = [
  'active',
  'cancelled',
  'sold',
  'invalidated',
  'superseded',
  'expired',
] as const satisfies readonly OrderState[];
const OBSERVATIONS = [
  'not_checked',
  'ownership_and_approval_observed',
  'owner_mismatch',
  'approval_missing',
  'unavailable',
  'custody_and_debt_observed',
  'loan_and_custody_observed',
  'custody_mismatch',
  'debt_not_covered',
  'credits_observed',
] as const satisfies readonly ObservationStatus[];
const LOAN_STATES = [
  'active',
  'repaid',
  'forgiven',
  'sold',
] as const satisfies readonly LoanState[];
const COLLATERAL_STATES = [
  'custody',
  'withdrawn',
] as const satisfies readonly CollateralState[];
const SYNC_STATES = [
  'synced',
  'catching_up',
  'partial_observations',
  'awaiting_confirmations',
  'error',
] as const;
const uint = (value: unknown): value is string =>
  typeof value === 'string' && UINT.test(value) && BigInt(value) < 2n ** 256n;
const safe = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const timestamp = (value: unknown): value is string =>
  typeof value === 'string' && Number.isFinite(Date.parse(value));
const validAddress = (value: unknown): value is string =>
  typeof value === 'string' && ADDRESS.test(value) && !/^0x0{40}$/i.test(value);
const sameAddress = (a: string, b: string) =>
  a.toLowerCase() === b.toLowerCase();
const pinned = (
  value: { atBlock?: number | null; blockHash?: string | null },
  sync: IndexSync,
) =>
  value.atBlock === sync.indexedThrough?.number &&
  value.blockHash === sync.indexedThrough?.hash;
const validDebt = (value: Debt, sync: IndexSync) =>
  pinned(value, sync) &&
  BigInt(value.totalAtomic) ===
    BigInt(value.principalAtomic) + BigInt(value.interestAtomic);
function record(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(message);
  return value as Record<string, unknown>;
}
function requireValue<T>(
  value: unknown,
  valid: (value: unknown) => value is T,
  message: string,
): T {
  if (!valid(value)) throw new Error(message);
  return value;
}
function choice<T extends string>(
  value: unknown,
  allowed: readonly T[],
  message: string,
): T {
  const selected = allowed.find((item) => item === value);
  if (selected === undefined) throw new Error(message);
  return selected;
}
const text = (value: unknown): value is string => typeof value === 'string';
const hash = (value: unknown): value is string =>
  typeof value === 'string' && HASH.test(value);
const boolean = (value: unknown): value is boolean =>
  typeof value === 'boolean';
function optional<T>(
  value: unknown,
  valid: (value: unknown) => value is T,
  message: string,
): T | undefined {
  return value == null ? undefined : requireValue(value, valid, message);
}
function block(value: unknown): BlockIdentity {
  const row = record(value, 'Block identity is incomplete.');
  return {
    number: requireValue(row.number, safe, 'Invalid block number.'),
    hash: requireValue(row.hash, hash, 'Invalid block hash.'),
    timestamp: requireValue(row.timestamp, safe, 'Invalid block timestamp.'),
  };
}
function source(value: unknown): IndexSource {
  const row = record(value, 'Deployment identity is incomplete.');
  const result: IndexSource = {
    ...row,
    rpcOrigin: optional(row.rpcOrigin, text, 'Invalid RPC origin.'),
    kind: choice(row.kind, ['riftwell-market-events'], 'Invalid source kind.'),
    chainId: requireValue(row.chainId, safe, 'Invalid source chain.'),
    market: requireValue(row.market, validAddress, 'Invalid market address.'),
    collection: requireValue(
      row.collection,
      validAddress,
      'Invalid collection address.',
    ),
    paymentToken: requireValue(
      row.paymentToken,
      validAddress,
      'Invalid payment token.',
    ),
    deploymentBlock: requireValue(
      row.deploymentBlock,
      safe,
      'Invalid deployment block.',
    ),
    deploymentBlockHash: requireValue(
      row.deploymentBlockHash,
      hash,
      'Invalid deployment block hash.',
    ),
    expectedMarketCodeHash: requireValue(
      row.expectedMarketCodeHash,
      hash,
      'Invalid market code hash.',
    ),
    abiHash: requireValue(row.abiHash, hash, 'Invalid ABI hash.'),
    paymentDecimals: requireValue(
      row.paymentDecimals,
      safe,
      'Invalid payment decimals.',
    ),
    confirmations: requireValue(
      row.confirmations,
      safe,
      'Invalid confirmations.',
    ),
  };
  if (!result.chainId || result.paymentDecimals > 36)
    throw new Error('Deployment identity is incomplete.');
  return result;
}
function financedSource(value: unknown): FinancedSource {
  const row = record(value, 'Financed deployment identity is incomplete.');
  return {
    ...row,
    rpcOrigin: optional(row.rpcOrigin, text, 'Invalid financed RPC origin.'),
    kind: choice(
      row.kind,
      ['riftwell-loans-events'],
      'Invalid financed source kind.',
    ),
    chainId: requireValue(row.chainId, safe, 'Invalid financed chain.'),
    loans: requireValue(row.loans, validAddress, 'Invalid loans address.'),
    collection: requireValue(
      row.collection,
      validAddress,
      'Invalid financed collection.',
    ),
    paymentToken: requireValue(
      row.paymentToken,
      validAddress,
      'Invalid financed payment token.',
    ),
    voter: requireValue(row.voter, validAddress, 'Invalid voter.'),
    treasury: requireValue(row.treasury, validAddress, 'Invalid treasury.'),
    guardian: requireValue(row.guardian, validAddress, 'Invalid guardian.'),
    deploymentBlock: requireValue(
      row.deploymentBlock,
      safe,
      'Invalid financed deployment block.',
    ),
    deploymentBlockHash: requireValue(
      row.deploymentBlockHash,
      hash,
      'Invalid financed deployment hash.',
    ),
    expectedCodeHash: requireValue(
      row.expectedCodeHash,
      hash,
      'Invalid financed code hash.',
    ),
    abiHash: requireValue(row.abiHash, hash, 'Invalid financed ABI hash.'),
    paymentDecimals: requireValue(
      row.paymentDecimals,
      safe,
      'Invalid financed decimals.',
    ),
    confirmations: requireValue(
      row.confirmations,
      safe,
      'Invalid financed confirmations.',
    ),
    claimsVerified: requireValue(
      row.claimsVerified,
      boolean,
      'Invalid verified claims status.',
    ),
    creditCoverage: choice(
      row.creditCoverage,
      ['complete_manager_events'],
      'Incomplete credit coverage.',
    ),
  };
}
function sync(value: unknown): IndexSync {
  const row = record(value, 'Index health metadata is incomplete.');
  return {
    ...row,
    confirmedTarget: optional(
      row.confirmedTarget,
      safe,
      'Invalid confirmation target.',
    ),
    lastAttemptAt: optional(
      row.lastAttemptAt,
      timestamp,
      'Invalid last attempt time.',
    ),
    reason: optional(row.reason, text, 'Invalid failure reason.'),
    error: optional(row.error, text, 'Invalid error.'),
    status: choice(row.status, SYNC_STATES, 'Invalid index sync state.'),
    lagBlocks: requireValue(row.lagBlocks ?? 0, safe, 'Invalid index lag.'),
    staleAfterSeconds: requireValue(
      row.staleAfterSeconds ?? 90,
      safe,
      'Invalid stale threshold.',
    ),
    rolledBackBlocks: requireValue(
      row.rolledBackBlocks ?? 0,
      safe,
      'Invalid rollback count.',
    ),
    lastSuccessfulSyncAt: optional(
      row.lastSuccessfulSyncAt,
      timestamp,
      'Invalid last successful sync time.',
    ),
    completedAt: optional(
      row.completedAt,
      timestamp,
      'Invalid completion time.',
    ),
    indexedThrough:
      row.indexedThrough == null ? null : block(row.indexedThrough),
    observedHead: row.observedHead == null ? null : block(row.observedHead),
    stale: optional(row.stale, boolean, 'Invalid stale flag.'),
    clockSkew: optional(row.clockSkew, boolean, 'Invalid clock flag.'),
    observationFailures: optional(
      row.observationFailures,
      safe,
      'Invalid observation failure count.',
    ),
  };
}
function observation(value: unknown): Observation {
  const row = record(value, 'Observation is incomplete.');
  return {
    ...row,
    status: choice(row.status, OBSERVATIONS, 'Invalid observation status.'),
    transactionSimulation: choice(
      row.transactionSimulation,
      ['not_performed'],
      'Transaction simulation exceeds the read-only boundary.',
    ),
    atBlock:
      row.atBlock == null
        ? null
        : requireValue(row.atBlock, safe, 'Invalid observation block.'),
    blockHash:
      row.blockHash == null
        ? null
        : requireValue(row.blockHash, hash, 'Invalid observation hash.'),
    reason: optional(row.reason, text, 'Invalid observation reason.'),
    owner: optional(row.owner, validAddress, 'Invalid observed owner.'),
    tokenApproval: optional(
      row.tokenApproval,
      (value): value is string =>
        typeof value === 'string' && ADDRESS.test(value),
      'Invalid approval address.',
    ),
    operatorApproval: optional(
      row.operatorApproval,
      boolean,
      'Invalid operator approval.',
    ),
    ownerMatchesSeller: optional(
      row.ownerMatchesSeller,
      boolean,
      'Invalid owner match.',
    ),
    approvedForMarket: optional(
      row.approvedForMarket,
      boolean,
      'Invalid approval match.',
    ),
    marketOrderMatches: optional(
      row.marketOrderMatches,
      boolean,
      'Invalid order match.',
    ),
    ownerMatchesCustody: optional(
      row.ownerMatchesCustody,
      boolean,
      'Invalid custody match.',
    ),
    loanStateMatches: optional(
      row.loanStateMatches,
      boolean,
      'Invalid loan match.',
    ),
    financedOrderMatches: optional(
      row.financedOrderMatches,
      boolean,
      'Invalid financed order match.',
    ),
  };
}
function debt(value: unknown): Debt {
  const row = record(value, 'Debt is incomplete.');
  return {
    principalAtomic: requireValue(
      row.principalAtomic,
      uint,
      'Invalid principal.',
    ),
    interestAtomic: requireValue(row.interestAtomic, uint, 'Invalid interest.'),
    totalAtomic: requireValue(row.totalAtomic, uint, 'Invalid total debt.'),
    atBlock: requireValue(row.atBlock, safe, 'Invalid debt block.'),
    blockHash: requireValue(row.blockHash, hash, 'Invalid debt block hash.'),
  };
}
function coverage(value: unknown): DebtCoverage {
  const row = record(value, 'Debt coverage is incomplete.');
  return {
    saleFeeAtomic: requireValue(row.saleFeeAtomic, uint, 'Invalid sale fee.'),
    netSaleAtomic: requireValue(row.netSaleAtomic, uint, 'Invalid net sale.'),
    debtAtomic: requireValue(row.debtAtomic, uint, 'Invalid covered debt.'),
    coversDebt: requireValue(row.coversDebt, boolean, 'Invalid coverage flag.'),
    borrowerResidualAtomic:
      row.borrowerResidualAtomic === null
        ? null
        : requireValue(row.borrowerResidualAtomic, uint, 'Invalid residual.'),
    atBlock: requireValue(row.atBlock, safe, 'Invalid coverage block.'),
    blockHash: requireValue(row.blockHash, hash, 'Invalid coverage hash.'),
  };
}
function order(value: unknown): IndexOrder {
  const row = record(value, 'Indexed listing is malformed.');
  return {
    ...row,
    cancellationReason:
      row.cancellationReason == null
        ? undefined
        : choice(
            row.cancellationReason,
            ['repriced', 'borrower_cancelled', 'loan_closed'] as const,
            'Invalid cancellation reason.',
          ),
    eventState:
      row.eventState == null
        ? undefined
        : choice(row.eventState, ORDER_STATES, 'Invalid event order state.'),
    sellerNonce: optional(row.sellerNonce, uint, 'Invalid seller nonce.'),
    createdBlock: optional(row.createdBlock, safe, 'Invalid created block.'),
    createdTransaction: optional(
      row.createdTransaction,
      hash,
      'Invalid created transaction.',
    ),
    updatedBlock: optional(row.updatedBlock, safe, 'Invalid updated block.'),
    updatedTransaction: optional(
      row.updatedTransaction,
      hash,
      'Invalid updated transaction.',
    ),
    buyer: optional(row.buyer, validAddress, 'Invalid buyer.'),
    recipient: optional(row.recipient, validAddress, 'Invalid recipient.'),
    listingId: requireValue(row.listingId, uint, 'Invalid listing ID.'),
    tokenId: requireValue(row.tokenId, uint, 'Invalid token ID.'),
    priceAtomic: requireValue(row.priceAtomic, uint, 'Invalid price.'),
    expiry: requireValue(row.expiry, uint, 'Invalid expiry.'),
    seller: requireValue(row.seller, validAddress, 'Invalid seller.'),
    orderState: choice(row.orderState, ORDER_STATES, 'Invalid order state.'),
    observation: observation(row.observation),
    sourceKind: choice(
      row.sourceKind ?? 'market',
      ['market', 'financed'] as const,
      'Invalid order source.',
    ),
    orderKey: optional(row.orderKey, text, 'Invalid order key.'),
    loanId: optional(row.loanId, uint, 'Invalid loan ID.'),
    loanState:
      row.loanState == null
        ? undefined
        : choice(row.loanState, LOAN_STATES, 'Invalid loan state.'),
    collateralState:
      row.collateralState == null
        ? undefined
        : choice(
            row.collateralState,
            COLLATERAL_STATES,
            'Invalid collateral state.',
          ),
    debt: row.debt == null ? undefined : debt(row.debt),
    coverage: row.coverage == null ? undefined : coverage(row.coverage),
    debtPaidAtomic: optional(row.debtPaidAtomic, uint, 'Invalid paid debt.'),
    protocolFeeAtomic: optional(
      row.protocolFeeAtomic,
      uint,
      'Invalid settled fee.',
    ),
    borrowerProceedsAtomic: optional(
      row.borrowerProceedsAtomic,
      uint,
      'Invalid borrower proceeds.',
    ),
  };
}
function loan(value: unknown): IndexLoan {
  const row = record(value, 'Indexed loan is malformed.');
  return {
    ...row,
    createdBlock: optional(
      row.createdBlock,
      safe,
      'Invalid created loan block.',
    ),
    createdTransaction: optional(
      row.createdTransaction,
      hash,
      'Invalid created loan transaction.',
    ),
    updatedBlock: optional(
      row.updatedBlock,
      safe,
      'Invalid updated loan block.',
    ),
    updatedTransaction: optional(
      row.updatedTransaction,
      hash,
      'Invalid updated loan transaction.',
    ),
    loanId: requireValue(row.loanId, uint, 'Invalid loan ID.'),
    offerId: requireValue(row.offerId, uint, 'Invalid offer ID.'),
    tokenId: requireValue(row.tokenId, uint, 'Invalid loan token ID.'),
    lender: requireValue(row.lender, validAddress, 'Invalid lender.'),
    borrower: requireValue(row.borrower, validAddress, 'Invalid borrower.'),
    vault: requireValue(row.vault, validAddress, 'Invalid vault.'),
    principalAtomic: requireValue(
      row.principalAtomic,
      uint,
      'Invalid loan principal.',
    ),
    aprBps: requireValue(row.aprBps, uint, 'Invalid loan APR.'),
    maturity: requireValue(row.maturity, uint, 'Invalid maturity.'),
    lastAccrued: requireValue(row.lastAccrued, uint, 'Invalid accrual time.'),
    accruedInterestAtomic: requireValue(
      row.accruedInterestAtomic,
      uint,
      'Invalid accrued interest.',
    ),
    interestRemainder: requireValue(
      row.interestRemainder,
      uint,
      'Invalid interest remainder.',
    ),
    activeListingId: requireValue(
      row.activeListingId,
      uint,
      'Invalid active listing ID.',
    ),
    loanState: choice(row.loanState, LOAN_STATES, 'Invalid loan state.'),
    collateralState: choice(
      row.collateralState,
      COLLATERAL_STATES,
      'Invalid collateral state.',
    ),
    observation: observation(row.observation),
    debt: row.debt == null ? undefined : debt(row.debt),
  };
}
function credit(value: unknown): IndexCreditAccount {
  const row = record(value, 'Indexed account credit is malformed.');
  return {
    account: requireValue(row.account, validAddress, 'Invalid credit account.'),
    lenderCreditAtomic: requireValue(
      row.lenderCreditAtomic,
      uint,
      'Invalid lender credit.',
    ),
    borrowerCreditAtomic: requireValue(
      row.borrowerCreditAtomic,
      uint,
      'Invalid borrower credit.',
    ),
    observation: observation(row.observation),
  };
}
function array<T>(
  value: unknown,
  parser: (item: unknown) => T,
  name: string,
): T[] {
  if (!Array.isArray(value) || value.length > 10_000)
    throw new Error(`${name} exceeds the prototype snapshot boundary.`);
  return value.map((item: unknown) => parser(item));
}
function orderCounts(
  value: unknown,
): Partial<Record<OrderState, number>> | undefined {
  if (value == null) return undefined;
  const row = record(value, 'Invalid order counts.');
  const counts: Partial<Record<OrderState, number>> = {};
  for (const [key, count] of Object.entries(row))
    counts[choice(key, ORDER_STATES, 'Invalid order count state.')] =
      requireValue(count, safe, 'Invalid order count.');
  return counts;
}
export function validateIndexSnapshot(value: unknown): IndexSnapshot {
  const raw = record(value, 'Unsupported index snapshot schema.');
  if (raw.schemaVersion !== 1 || !Array.isArray(raw.listings))
    throw new Error('Unsupported index snapshot schema.');
  const rawSync = record(raw.sync, 'Index health metadata is incomplete.');
  if (rawSync.status === 'unconfigured') {
    if (
      raw.listings.length ||
      raw.financedSource ||
      (raw.loans != null && (!Array.isArray(raw.loans) || raw.loans.length)) ||
      (raw.creditAccounts != null &&
        (!Array.isArray(raw.creditAccounts) || raw.creditAccounts.length))
    )
      throw new Error(
        'Unconfigured source cannot contain orders, loans or credits.',
      );
    return {
      schemaVersion: 1,
      source: null,
      listings: [],
      sync: { status: 'unconfigured' },
      transactionSimulation: 'not_performed',
    };
  }
  const snapshot: IndexSnapshot = {
    ...raw,
    orderCounts: orderCounts(raw.orderCounts),
    schemaVersion: 1,
    source: source(raw.source),
    sync: sync(raw.sync),
    listings: array(raw.listings, order, 'Listings'),
    transactionSimulation: choice(
      raw.transactionSimulation,
      ['not_performed'],
      'This source does not match the read-only prototype boundary.',
    ),
    snapshotId: optional(raw.snapshotId, hash, 'Invalid snapshot hash.'),
    financedSource:
      raw.financedSource == null ? null : financedSource(raw.financedSource),
    loans: raw.loans == null ? undefined : array(raw.loans, loan, 'Loans'),
    creditAccounts:
      raw.creditAccounts == null
        ? undefined
        : array(raw.creditAccounts, credit, 'Credits'),
  };
  const s = snapshot.source,
    f = snapshot.financedSource;
  if (!s) throw new Error('Deployment identity is incomplete.');
  if (
    f &&
    (f.chainId !== s.chainId ||
      sameAddress(f.loans, s.market) ||
      !sameAddress(f.collection, s.collection) ||
      !sameAddress(f.paymentToken, s.paymentToken) ||
      f.paymentDecimals !== s.paymentDecimals ||
      f.confirmations !== s.confirmations ||
      !snapshot.loans ||
      !snapshot.creditAccounts)
  )
    throw new Error('Financed deployment identity or coverage is incomplete.');
  if (!f && (snapshot.loans?.length || snapshot.creditAccounts?.length))
    throw new Error('Loans and credits require a financed source.');
  const ids = new Set<string>();
  for (const order of snapshot.listings) {
    const kind = order.sourceKind ?? 'market',
      key = `${kind}:${order.listingId}`;
    if (
      ids.has(key) ||
      (order.orderKey != null && order.orderKey !== key) ||
      order.observation.status === 'credits_observed'
    )
      throw new Error('Indexed listing is malformed or duplicated.');
    ids.add(key);
    if (kind !== 'financed') continue;
    if (
      !f ||
      order.loanId == null ||
      order.loanState == null ||
      order.collateralState == null ||
      !pinned(order.observation, snapshot.sync) ||
      ![
        'custody_and_debt_observed',
        'loan_and_custody_observed',
        'custody_mismatch',
        'debt_not_covered',
        'unavailable',
      ].includes(order.observation.status)
    )
      throw new Error('Financed order lacks a pinned loan source.');
    if (order.debt && !validDebt(order.debt, snapshot.sync))
      throw new Error('Financed debt is malformed or from another block.');
    if (order.observation.status !== 'unavailable' && !order.debt)
      throw new Error('Financed order requires exact observed debt.');
    if (
      ['active', 'expired'].includes(order.orderState) &&
      order.observation.status !== 'unavailable'
    ) {
      const observedDebt = order.debt,
        c = order.coverage,
        fee = (BigInt(order.priceAtomic) * 50n) / 10_000n,
        net = BigInt(order.priceAtomic) - fee;
      if (
        !observedDebt ||
        !c ||
        !pinned(c, snapshot.sync) ||
        BigInt(c.saleFeeAtomic) !== fee ||
        BigInt(c.netSaleAtomic) !== net ||
        c.debtAtomic !== observedDebt.totalAtomic ||
        c.coversDebt !== net >= BigInt(c.debtAtomic) ||
        (c.coversDebt
          ? c.borrowerResidualAtomic == null ||
            BigInt(c.borrowerResidualAtomic) !== net - BigInt(c.debtAtomic)
          : c.borrowerResidualAtomic !== null)
      )
        throw new Error(
          'Financed debt coverage disagrees with exact price, fee or debt.',
        );
    }
    if (
      order.orderState === 'sold' &&
      (order.debtPaidAtomic == null ||
        order.protocolFeeAtomic == null ||
        order.borrowerProceedsAtomic == null ||
        BigInt(order.protocolFeeAtomic) !==
          (BigInt(order.priceAtomic) * 50n) / 10_000n ||
        BigInt(order.priceAtomic) !==
          BigInt(order.debtPaidAtomic) +
            BigInt(order.protocolFeeAtomic) +
            BigInt(order.borrowerProceedsAtomic))
    )
      throw new Error('Financed sale settlement amounts are inconsistent.');
  }
  if (f) {
    const loanIds = new Set<string>(),
      accounts = new Set<string>(),
      loans = snapshot.loans ?? [],
      credits = snapshot.creditAccounts ?? [];
    for (const loan of loans) {
      if (
        loanIds.has(loan.loanId) ||
        !pinned(loan.observation, snapshot.sync) ||
        ![
          'loan_and_custody_observed',
          'custody_mismatch',
          'unavailable',
        ].includes(loan.observation.status) ||
        (loan.debt && !validDebt(loan.debt, snapshot.sync)) ||
        (loan.observation.status !== 'unavailable' && !loan.debt)
      )
        throw new Error('Pinned indexed loan is malformed or duplicated.');
      loanIds.add(loan.loanId);
    }
    for (const order of snapshot.listings.filter(
      (order) => order.sourceKind === 'financed',
    )) {
      const loan = loans.find((loan) => loan.loanId === order.loanId);
      if (
        !loan ||
        loan.tokenId !== order.tokenId ||
        !sameAddress(loan.borrower, order.seller) ||
        loan.loanState !== order.loanState ||
        loan.collateralState !== order.collateralState ||
        (order.debt &&
          (!loan.debt ||
            order.debt.principalAtomic !== loan.debt.principalAtomic ||
            order.debt.interestAtomic !== loan.debt.interestAtomic ||
            order.debt.totalAtomic !== loan.debt.totalAtomic ||
            order.debt.atBlock !== loan.debt.atBlock ||
            order.debt.blockHash !== loan.debt.blockHash))
      )
        throw new Error('Financed order disagrees with its indexed loan.');
    }
    for (const row of credits) {
      if (
        accounts.has(row.account.toLowerCase()) ||
        !pinned(row.observation, snapshot.sync) ||
        !['credits_observed', 'unavailable'].includes(row.observation.status)
      )
        throw new Error('Indexed account credit is malformed or duplicated.');
      accounts.add(row.account.toLowerCase());
    }
  }
  return snapshot;
}
export function indexHealth(
  snapshot: IndexSnapshot | null | undefined,
  now = Date.now(),
): IndexHealth {
  if (!snapshot?.source)
    return {
      configured: false,
      stale: true,
      ageSeconds: null,
      label: 'No deployment configured',
    };
  const sync = snapshot.sync;
  const ageSeconds = sync.lastSuccessfulSyncAt
    ? Math.max(
        0,
        Math.floor((now - Date.parse(sync.lastSuccessfulSyncAt)) / 1000),
      )
    : null;
  const blockAge = sync.indexedThrough
    ? Math.max(0, Math.floor(now / 1000) - sync.indexedThrough.timestamp)
    : null;
  const threshold = sync.staleAfterSeconds ?? 90;
  const clockSkew =
    (sync.lastSuccessfulSyncAt != null &&
      Date.parse(sync.lastSuccessfulSyncAt) > now + 30_000) ||
    (sync.indexedThrough != null &&
      sync.indexedThrough.timestamp * 1000 > now + 30_000);
  const stale =
    !!sync.stale ||
    clockSkew ||
    sync.status !== 'synced' ||
    ageSeconds == null ||
    ageSeconds > threshold ||
    blockAge == null ||
    blockAge > threshold ||
    (sync.lagBlocks ?? 0) > 0;
  return {
    configured: true,
    stale,
    ageSeconds,
    blockAge,
    clockSkew,
    label:
      sync.status === 'error'
        ? 'Index sync failed'
        : clockSkew
          ? 'Snapshot clock differs'
          : sync.status === 'catching_up'
            ? 'Catching up'
            : sync.status === 'partial_observations'
              ? 'Incomplete observations'
              : sync.status === 'awaiting_confirmations'
                ? 'Awaiting confirmations'
                : stale
                  ? 'Cached snapshot · stale'
                  : 'Confirmed snapshot',
  };
}
export async function fetchIndexSnapshot(
  url: string | URL,
  fetcher: typeof fetch = fetch,
): Promise<IndexSnapshot> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetcher(url, {
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok)
      throw new Error(`Index snapshot returned HTTP ${response.status}.`);
    const text = await response.text();
    if (text.length > 8_000_000)
      throw new Error('Index snapshot exceeds the prototype size limit.');
    const value: unknown = JSON.parse(text);
    return validateIndexSnapshot(value);
  } finally {
    clearTimeout(timeout);
  }
}
export function formatAtomic(
  value: string | number | bigint,
  decimals: number,
): string {
  if (!uint(String(value)) || !safe(decimals) || decimals > 36)
    throw new Error('Invalid exact token amount.');
  const amount = BigInt(value),
    scale = 10n ** BigInt(decimals);
  const whole = (amount / scale).toLocaleString('en-US');
  if (!decimals) return whole;
  const fraction = (amount % scale).toString().padStart(decimals, '0');
  return `${whole}.${fraction}`;
}
