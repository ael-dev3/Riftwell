import { PLATFORM_FEE_BPS } from './config.js';

export const SCALE = 1_000_000n;
export const DAY = 86_400n;
export const YEAR = 365n * DAY;

/** Exact, non-negative USDC amounts. Reject exponential notation and precision loss. */
export function parseUSDC(value) {
  if (typeof value !== 'string' || !/^\d+(\.\d{1,6})?$/.test(value.trim())) {
    throw new Error('Use a positive amount with up to six decimal places.');
  }
  const [whole, fraction = ''] = value.trim().split('.');
  const result = BigInt(whole) * SCALE + BigInt(fraction.padEnd(6, '0'));
  if (result > 1_000_000_000_000n * SCALE) throw new Error('Amount exceeds the prototype limit.');
  return result;
}

export function formatUSDC(value, digits = 2) {
  const n = BigInt(value);
  const negative = n < 0n;
  const v = negative ? -n : n;
  const whole = (v / SCALE).toLocaleString('en-US');
  const fraction = (v % SCALE).toString().padStart(6, '0').slice(0, digits);
  return `${negative ? '−' : ''}${whole}${digits ? `.${fraction}` : ''}`;
}

export function platformFee(amount) { return BigInt(amount) * PLATFORM_FEE_BPS / 10_000n; }

export function marketQuote(price) {
  const ask = typeof price === 'bigint' ? price : parseUSDC(price);
  if (ask <= 0n) throw new Error('Enter an asking price greater than zero.');
  const fee = platformFee(ask);
  return { buyerPays: ask, platformFee: fee, sellerReceives: ask - fee };
}

export function parseAPR(value) {
  if (!/^\d+(\.\d{1,2})?$/.test(String(value))) throw new Error('Enter APR with up to two decimal places.');
  const [whole, fraction = ''] = String(value).split('.');
  const bps = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (bps > 10_000n) throw new Error('Demo APR must be between 0% and 100%.');
  return bps;
}

export function accruedInterest(principal, aprBps, elapsedSeconds, maturitySeconds) {
  const elapsed = BigInt(elapsedSeconds);
  const maturity = BigInt(maturitySeconds);
  if (elapsed < 0n || maturity < 0n || principal < 0n || aprBps < 0n) throw new Error('Invalid interest inputs.');
  const capped = elapsed > maturity ? maturity : elapsed;
  return principal * aprBps * capped / (10_000n * YEAR);
}

export function loanQuote(principal, apr, days) {
  const amount = typeof principal === 'bigint' ? principal : parseUSDC(principal);
  if (amount <= 0n) throw new Error('Enter a loan amount greater than zero.');
  if (!/^\d+$/.test(String(days)) || Number(days) < 1 || Number(days) > 365) {
    throw new Error('Choose a term from 1 to 365 days.');
  }
  const aprBps = parseAPR(apr);
  const maturitySeconds = BigInt(days) * DAY;
  const fee = platformFee(amount);
  const interest = accruedInterest(amount, aprBps, maturitySeconds, maturitySeconds);
  return { principal: amount, aprBps, maturitySeconds, platformFee: fee,
    borrowerReceives: amount - fee, maturityInterest: interest, maturityRepayment: amount + interest };
}

export function createDemo() {
  return {
    connected: false, balance: 5_000n * SCALE, day: 0, events: [], nextId: 9,
    assets: [
      { id: 'DEMO-007', amount: 250_000, power: 248_000, expiry: '2028-09-27', listed: false },
      { id: 'DEMO-008', amount: 100_000, power: 70_000, expiry: '2028-02-24', listed: false },
    ],
    listings: [
      { id: 'DEMO-001', amount: 250_000, power: 247_000, expiry: '2028-09-26', price: 1_380n * SCALE, months: 24, yours: false },
      { id: 'DEMO-002', amount: 100_000, power: 68_000, expiry: '2028-02-24', price: 490n * SCALE, months: 17, yours: false },
      { id: 'DEMO-003', amount: 750_000, power: 743_000, expiry: '2028-09-28', price: 4_200n * SCALE, months: 24, yours: false },
      { id: 'DEMO-004', amount: 50_000, power: 13_000, expiry: '2027-04-22', price: 210n * SCALE, months: 7, yours: false },
    ], loans: [],
  };
}

function requireDemo(state) { if (!state.connected) throw new Error('Open the demo account first.'); }
function event(state, title, details) { state.events.unshift({ day: state.day, title, details }); }

export function buyDemo(state, id) {
  requireDemo(state);
  const listing = state.listings.find(l => l.id === id);
  if (!listing || listing.yours) throw new Error('This example is no longer available to buy.');
  if (state.balance < listing.price) throw new Error('Your demo USDC balance is too low. Reset the demo to start again.');
  state.balance -= listing.price;
  state.assets.push({ id: listing.id, amount: listing.amount, power: listing.power, expiry: listing.expiry, listed: false });
  state.listings = state.listings.filter(l => l.id !== id);
  event(state, 'Example purchase', `${id} · ${formatUSDC(listing.price)} USDC`);
}

export function listDemo(state, id, price) {
  requireDemo(state);
  const asset = state.assets.find(a => a.id === id);
  if (!asset || asset.listed || state.loans.some(l => l.assetId === id && !l.withdrawn)) throw new Error('Choose an available example lock.');
  const quote = marketQuote(price);
  asset.listed = true;
  state.listings.push({ ...asset, price: quote.buyerPays, months: null, yours: true });
  event(state, 'Local listing created', `${id} · ${formatUSDC(quote.buyerPays)} USDC`);
}

export function cancelDemoListing(state, id) {
  requireDemo(state);
  const listing = state.listings.find(l => l.id === id && l.yours);
  if (!listing) throw new Error('Only your local listings can be cancelled.');
  state.listings = state.listings.filter(l => l.id !== id);
  state.assets.find(a => a.id === id).listed = false;
  event(state, 'Local listing cancelled', id);
}

export function startDemoLoan(state, assetId, quote) {
  requireDemo(state);
  const asset = state.assets.find(a => a.id === assetId);
  if (!asset || asset.listed || state.loans.some(l => l.assetId === assetId && !l.withdrawn)) throw new Error('This example lock is already listed or held as collateral.');
  const loan = { id: `LOAN-${state.loans.length + 1}`, assetId, principal: quote.principal,
    aprBps: quote.aprBps, maturitySeconds: quote.maturitySeconds,
    originatedDay: state.day, checkpointDay: state.day, interest: 0n, interestRemainder: 0n, closed: false, withdrawn: false };
  state.loans.push(loan);
  state.balance += quote.borrowerReceives;
  event(state, 'Example loan started', `${assetId} · ${formatUSDC(quote.borrowerReceives)} USDC received`);
  return loan;
}

export function currentDebt(state, loan) {
  if (loan.closed) return { principal: 0n, interest: 0n, total: 0n, remainder: 0n };
  const maturityDay = loan.originatedDay + Number(loan.maturitySeconds / DAY);
  const endDay = Math.min(state.day, maturityDay);
  const elapsed = Math.max(0, endDay - loan.checkpointDay);
  const numerator = loan.principal * loan.aprBps * BigInt(elapsed) * DAY + loan.interestRemainder;
  const denominator = 10_000n * YEAR;
  const interest = loan.interest + numerator / denominator;
  return { principal: loan.principal, interest, total: loan.principal + interest, remainder: numerator % denominator };
}

export function repayDemo(state, loanId, value) {
  requireDemo(state);
  const loan = state.loans.find(l => l.id === loanId && !l.closed);
  if (!loan) throw new Error('This loan is already closed.');
  const payment = typeof value === 'bigint' ? value : parseUSDC(value);
  const debt = currentDebt(state, loan);
  if (payment <= 0n || payment > debt.total) throw new Error('Payment must be above zero and no greater than the outstanding debt.');
  if (payment > state.balance) throw new Error('Your demo USDC balance is too low.');
  state.balance -= payment;
  const paidInterest = payment < debt.interest ? payment : debt.interest;
  loan.interest = debt.interest - paidInterest;
  loan.interestRemainder = debt.remainder;
  loan.principal -= payment - paidInterest;
  loan.checkpointDay = state.day;
  loan.closed = loan.principal === 0n && loan.interest === 0n;
  event(state, loan.closed ? 'Example debt cleared' : 'Example repayment', `${loan.assetId} · ${formatUSDC(payment)} USDC`);
}

export function withdrawDemoCollateral(state, loanId) {
  requireDemo(state);
  const loan = state.loans.find(l => l.id === loanId && !l.withdrawn);
  if (!loan || !loan.closed) throw new Error('Clear this demo loan before withdrawing its collateral.');
  // This local example assumes transfer readiness. A real adapter must check it at withdrawal.
  loan.withdrawn = true;
  event(state, 'Example collateral withdrawn', loan.assetId);
}

export function availableAssets(state) {
  return state.assets.filter(a => !a.listed && !state.loans.some(l => l.assetId === a.id && !l.withdrawn));
}
