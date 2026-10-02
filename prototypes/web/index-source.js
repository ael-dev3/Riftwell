const ADDRESS = /^0x[0-9a-f]{40}$/i;
const HASH = /^0x[0-9a-f]{64}$/i;
const UINT = /^\d+$/;
const ORDER_STATES = new Set(['active', 'cancelled', 'sold', 'invalidated', 'superseded', 'expired']);
const OBSERVATIONS = new Set(['not_checked', 'ownership_and_approval_observed', 'owner_mismatch', 'approval_missing', 'unavailable', 'custody_and_debt_observed', 'loan_and_custody_observed', 'custody_mismatch', 'debt_not_covered']);
const LOAN_STATES = new Set(['active', 'repaid', 'forgiven', 'sold']);
const COLLATERAL_STATES = new Set(['custody', 'withdrawn']);
const SYNC_STATES = new Set(['synced', 'catching_up', 'partial_observations', 'awaiting_confirmations', 'error']);
const uint = value => typeof value === 'string' && UINT.test(value) && BigInt(value) < 2n ** 256n;
const safe = value => Number.isSafeInteger(value) && value >= 0;
const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const validAddress = value => typeof value === 'string' && ADDRESS.test(value) && !/^0x0{40}$/i.test(value);
const sameAddress = (a, b) => a.toLowerCase() === b.toLowerCase();
const pinned = (value, sync) => value && value.atBlock === sync.indexedThrough?.number && value.blockHash === sync.indexedThrough?.hash;
const validDebt = (value, sync) => pinned(value, sync) && [value.principalAtomic, value.interestAtomic, value.totalAtomic].every(uint) && BigInt(value.totalAtomic) === BigInt(value.principalAtomic) + BigInt(value.interestAtomic);

export function validateIndexSnapshot(raw) {
  if (raw?.schemaVersion !== 1 || !Array.isArray(raw.listings)) throw new Error('Unsupported index snapshot schema.');
  if (raw.sync?.status === 'unconfigured') {
    if (raw.listings.length || raw.financedSource || raw.loans?.length || raw.creditAccounts?.length) throw new Error('Unconfigured source cannot contain orders, loans or credits.');
    return { ...raw, source: null };
  }
  const s = raw.source, sync = raw.sync;
  if (!s || s.kind !== 'riftwell-market-events' || !safe(s.chainId) || !s.chainId ||
    ![s.market, s.collection, s.paymentToken].every(validAddress) ||
    ![s.deploymentBlockHash, s.expectedMarketCodeHash, s.abiHash].every(h => typeof h === 'string' && HASH.test(h)) ||
    !safe(s.paymentDecimals) || s.paymentDecimals > 36 || !safe(s.deploymentBlock) || !safe(s.confirmations)) {
    throw new Error('Deployment identity is incomplete.');
  }
  if (!sync || !SYNC_STATES.has(sync.status) || !safe(sync.lagBlocks ?? 0) || !safe(sync.staleAfterSeconds ?? 90) ||
    !safe(sync.rolledBackBlocks ?? 0) || (sync.lastSuccessfulSyncAt != null && !timestamp(sync.lastSuccessfulSyncAt))) throw new Error('Index health metadata is incomplete.');
  if (sync.indexedThrough != null && (!safe(sync.indexedThrough.number) || !HASH.test(sync.indexedThrough.hash) || !safe(sync.indexedThrough.timestamp))) throw new Error('Indexed block identity is incomplete.');
  if (sync.observedHead != null && (!safe(sync.observedHead.number) || !HASH.test(sync.observedHead.hash) || !safe(sync.observedHead.timestamp))) throw new Error('Observed block identity is incomplete.');
  if (raw.listings.length > 10_000) throw new Error('Snapshot is too large for this prototype view.');
  const f = raw.financedSource;
  if (f != null && (f.kind !== 'riftwell-loans-events' || f.chainId !== s.chainId || ![f.loans, f.collection, f.paymentToken, f.voter, f.treasury, f.guardian].every(validAddress) ||
    sameAddress(f.loans, s.market) || !sameAddress(f.collection, s.collection) || !sameAddress(f.paymentToken, s.paymentToken) || f.paymentDecimals !== s.paymentDecimals || f.confirmations !== s.confirmations ||
    ![f.deploymentBlockHash, f.expectedCodeHash, f.abiHash].every(h => typeof h === 'string' && HASH.test(h)) || !safe(f.deploymentBlock) || typeof f.claimsVerified !== 'boolean' || f.creditCoverage !== 'complete_manager_events' ||
    !Array.isArray(raw.loans) || !Array.isArray(raw.creditAccounts) || raw.loans.length > 10_000 || raw.creditAccounts.length > 10_000)) throw new Error('Financed deployment identity or coverage is incomplete.');
  if (!f && (raw.loans?.length || raw.creditAccounts?.length)) throw new Error('Loans and credits require a financed source.');
  const ids = new Set();
  for (const order of raw.listings) {
    const kind = order.sourceKind ?? 'market', key = `${kind}:${order.listingId}`;
    if (!uint(order.listingId) || !uint(order.tokenId) || !uint(order.priceAtomic) || !uint(order.expiry) ||
      !validAddress(order.seller) || !ORDER_STATES.has(order.orderState) || !['market', 'financed'].includes(kind) || ids.has(key) || (order.orderKey != null && order.orderKey !== key) ||
      !order.observation || !OBSERVATIONS.has(order.observation.status) || order.observation.transactionSimulation !== 'not_performed') {
      throw new Error('Indexed listing is malformed or duplicated.');
    }
    ids.add(key);
    if (kind === 'financed') {
      if (!f || !uint(order.loanId) || !LOAN_STATES.has(order.loanState) || !COLLATERAL_STATES.has(order.collateralState) || !pinned(order.observation, sync) || !['custody_and_debt_observed', 'loan_and_custody_observed', 'custody_mismatch', 'debt_not_covered', 'unavailable'].includes(order.observation.status)) throw new Error('Financed order lacks a pinned loan source.');
      if (order.debt != null && !validDebt(order.debt, sync)) throw new Error('Financed debt is malformed or from another block.');
      if (order.observation.status !== 'unavailable' && !order.debt) throw new Error('Financed order requires exact observed debt.');
      if (['active', 'expired'].includes(order.orderState) && order.observation.status !== 'unavailable') {
        const coverage = order.coverage, fee = BigInt(order.priceAtomic) * 50n / 10_000n, net = BigInt(order.priceAtomic) - fee;
        if (!pinned(coverage, sync) || ![coverage.saleFeeAtomic, coverage.netSaleAtomic, coverage.debtAtomic].every(uint) || BigInt(coverage.saleFeeAtomic) !== fee || BigInt(coverage.netSaleAtomic) !== net || coverage.debtAtomic !== order.debt.totalAtomic || coverage.coversDebt !== (net >= BigInt(coverage.debtAtomic)) || (coverage.coversDebt ? !uint(coverage.borrowerResidualAtomic) || BigInt(coverage.borrowerResidualAtomic) !== net - BigInt(coverage.debtAtomic) : coverage.borrowerResidualAtomic !== null)) throw new Error('Financed debt coverage disagrees with exact price, fee or debt.');
      }
      if (order.orderState === 'sold' && (!['debtPaidAtomic', 'protocolFeeAtomic', 'borrowerProceedsAtomic'].every(field => uint(order[field])) || BigInt(order.protocolFeeAtomic) !== BigInt(order.priceAtomic) * 50n / 10_000n || BigInt(order.priceAtomic) !== BigInt(order.debtPaidAtomic) + BigInt(order.protocolFeeAtomic) + BigInt(order.borrowerProceedsAtomic))) throw new Error('Financed sale settlement amounts are inconsistent.');
    }
  }
  if (f) {
    const loanIds = new Set(), accounts = new Set();
    for (const loan of raw.loans) {
      if (!['loanId', 'offerId', 'tokenId', 'principalAtomic', 'aprBps', 'maturity', 'lastAccrued', 'accruedInterestAtomic', 'interestRemainder', 'activeListingId'].every(field => uint(loan[field])) || ![loan.lender, loan.borrower, loan.vault].every(validAddress) || !LOAN_STATES.has(loan.loanState) || !COLLATERAL_STATES.has(loan.collateralState) || loanIds.has(loan.loanId) || !pinned(loan.observation, sync) || !['loan_and_custody_observed', 'custody_mismatch', 'unavailable'].includes(loan.observation.status) || loan.observation.transactionSimulation !== 'not_performed' || (loan.debt != null && !validDebt(loan.debt, sync)) || (loan.observation.status !== 'unavailable' && !loan.debt)) throw new Error('Pinned indexed loan is malformed or duplicated.');
      loanIds.add(loan.loanId);
    }
    for (const order of raw.listings.filter(order => order.sourceKind === 'financed')) {
      const loan = raw.loans.find(loan => loan.loanId === order.loanId);
      if (!loan || loan.tokenId !== order.tokenId || !sameAddress(loan.borrower, order.seller) || loan.loanState !== order.loanState || loan.collateralState !== order.collateralState || (order.debt && (!loan.debt || ['principalAtomic', 'interestAtomic', 'totalAtomic', 'atBlock', 'blockHash'].some(field => order.debt[field] !== loan.debt[field])))) throw new Error('Financed order disagrees with its indexed loan.');
    }
    for (const row of raw.creditAccounts) {
      if (!validAddress(row.account) || accounts.has(row.account.toLowerCase()) || !uint(row.lenderCreditAtomic) || !uint(row.borrowerCreditAtomic) || !pinned(row.observation, sync) || !['credits_observed', 'unavailable'].includes(row.observation.status) || row.observation.transactionSimulation !== 'not_performed') throw new Error('Indexed account credit is malformed or duplicated.');
      accounts.add(row.account.toLowerCase());
    }
  }
  if (raw.transactionSimulation !== 'not_performed') throw new Error('This source does not match the read-only prototype boundary.');
  return raw;
}

export function indexHealth(snapshot, now = Date.now()) {
  if (!snapshot?.source) return { configured: false, stale: true, ageSeconds: null, label: 'No deployment configured' };
  const sync = snapshot.sync;
  const ageSeconds = sync.lastSuccessfulSyncAt ? Math.max(0, Math.floor((now - Date.parse(sync.lastSuccessfulSyncAt)) / 1000)) : null;
  const blockAge = sync.indexedThrough ? Math.max(0, Math.floor(now / 1000) - sync.indexedThrough.timestamp) : null;
  const threshold = sync.staleAfterSeconds ?? 90;
  const clockSkew = Date.parse(sync.lastSuccessfulSyncAt) > now + 30_000 || sync.indexedThrough?.timestamp * 1000 > now + 30_000;
  const stale = !!sync.stale || clockSkew || sync.status !== 'synced' || ageSeconds == null || ageSeconds > threshold || blockAge == null || blockAge > threshold || sync.lagBlocks > 0;
  return { configured: true, stale, ageSeconds, blockAge, clockSkew,
    label: sync.status === 'error' ? 'Index sync failed' : clockSkew ? 'Snapshot clock differs' : sync.status === 'catching_up' ? 'Catching up' : sync.status === 'partial_observations' ? 'Incomplete observations' : sync.status === 'awaiting_confirmations' ? 'Awaiting confirmations' : stale ? 'Cached snapshot · stale' : 'Confirmed snapshot' };
}

export async function fetchIndexSnapshot(url, fetcher = fetch) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetcher(url, { cache: 'no-store', signal: controller.signal });
    if (!response.ok) throw new Error(`Index snapshot returned HTTP ${response.status}.`);
    const text = await response.text();
    if (text.length > 8_000_000) throw new Error('Index snapshot exceeds the prototype size limit.');
    return validateIndexSnapshot(JSON.parse(text));
  } finally { clearTimeout(timeout); }
}

export function formatAtomic(value, decimals) {
  if (!uint(String(value)) || !safe(decimals) || decimals > 36) throw new Error('Invalid exact token amount.');
  const amount = BigInt(value), scale = 10n ** BigInt(decimals);
  const whole = (amount / scale).toLocaleString('en-US');
  if (!decimals) return whole;
  const fraction = (amount % scale).toString().padStart(decimals, '0');
  return `${whole}.${fraction}`;
}
