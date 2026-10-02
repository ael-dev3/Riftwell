export type CollateralLimits = Readonly<Record<string, string>>;
export type LendingActivityKind =
  | 'supply'
  | 'withdraw'
  | 'redeem'
  | 'deposit-collateral'
  | 'remove-collateral'
  | 'borrow'
  | 'repay'
  | 'epoch'
  | 'purchase';
export type LendingActivity = {
  id: string;
  kind: LendingActivityKind;
  createdAt: string;
  amountMicros: string;
  sharesRaw: string;
  feeMicros: string;
  collateralId: string | null;
  rewardRepaidMicros: string;
  rewardSurplusMicros: string;
  poolYieldMicros: string;
};
export type LendingState = {
  version: 1;
  walletMicros: string;
  poolCashMicros: string;
  poolOutstandingMicros: string;
  totalSharesRaw: string;
  shareBalanceRaw: string;
  debtMicros: string;
  platformFeesMicros: string;
  collateralIds: string[];
  epoch: number;
  activity: LendingActivity[];
};
export type LendingMetrics = {
  totalAssetsMicros: string;
  suppliedAssetsMicros: string;
  totalCreditMicros: string;
  availableCreditMicros: string;
  maxWithdrawMicros: string;
  utilizationBps: number;
};

const USDC = 1_000_000n;
const SEED_CASH = 200_000n * USDC;
const SEED_OUTSTANDING = 80_000n * USDC;
const SEED_SHARES = SEED_CASH + SEED_OUTSTANDING;
const MAX_MONEY = 1_000_000n * USDC;
const UINT256_MAX = (1n << 256n) - 1n;
const MAX_ACTIVITY = 100;
const MAX_COLLATERAL = 100;
const MAX_EPOCH = 10_000;
export const MAX_EPOCH_INPUT_MICROS = '1000000000';
const ACTIVITY_KINDS: readonly string[] = [
  'supply',
  'withdraw',
  'redeem',
  'deposit-collateral',
  'remove-collateral',
  'borrow',
  'repay',
  'epoch',
  'purchase',
];

export class LendingError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'LendingError';
    this.code = code;
  }
}

function fail(code: string, message: string): never {
  throw new LendingError(code, message);
}

function raw(value: unknown, maximum = MAX_MONEY): value is string {
  return (
    typeof value === 'string' &&
    /^(0|[1-9][0-9]{0,77})$/.test(value) &&
    BigInt(value) <= maximum
  );
}

function positive(value: string, maximum = MAX_MONEY): bigint {
  if (!raw(value, maximum) || BigInt(value) === 0n)
    fail('INVALID_AMOUNT', 'Enter a positive amount in exact raw units.');
  return BigInt(value);
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validActivity(value: unknown): value is LendingActivity {
  return (
    object(value) &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    value.id.length <= 100 &&
    typeof value.kind === 'string' &&
    ACTIVITY_KINDS.includes(value.kind) &&
    typeof value.createdAt === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.createdAt) &&
    Number.isFinite(Date.parse(value.createdAt)) &&
    new Date(value.createdAt).toISOString() === value.createdAt &&
    raw(value.amountMicros) &&
    raw(value.sharesRaw, UINT256_MAX) &&
    raw(value.feeMicros) &&
    (value.collateralId === null ||
      (typeof value.collateralId === 'string' &&
        value.collateralId.length > 0 &&
        value.collateralId.length <= 100)) &&
    raw(value.rewardRepaidMicros) &&
    raw(value.rewardSurplusMicros) &&
    raw(value.poolYieldMicros)
  );
}

function validState(value: unknown): value is LendingState {
  return (
    object(value) &&
    value.version === 1 &&
    raw(value.walletMicros) &&
    raw(value.poolCashMicros) &&
    raw(value.poolOutstandingMicros) &&
    raw(value.totalSharesRaw, UINT256_MAX) &&
    raw(value.shareBalanceRaw, UINT256_MAX) &&
    raw(value.debtMicros) &&
    raw(value.platformFeesMicros) &&
    BigInt(value.totalSharesRaw) > 0n &&
    BigInt(value.poolOutstandingMicros) - BigInt(value.debtMicros) ===
      SEED_OUTSTANDING &&
    BigInt(value.totalSharesRaw) - BigInt(value.shareBalanceRaw) ===
      SEED_SHARES &&
    BigInt(value.poolCashMicros) + BigInt(value.poolOutstandingMicros) <=
      MAX_MONEY &&
    Array.isArray(value.collateralIds) &&
    value.collateralIds.length <= MAX_COLLATERAL &&
    value.collateralIds.every(
      (id) => typeof id === 'string' && id.length > 0 && id.length <= 100,
    ) &&
    new Set(value.collateralIds).size === value.collateralIds.length &&
    typeof value.epoch === 'number' &&
    Number.isSafeInteger(value.epoch) &&
    value.epoch >= 0 &&
    value.epoch <= MAX_EPOCH &&
    Array.isArray(value.activity) &&
    value.activity.length <= MAX_ACTIVITY &&
    value.activity.every(validActivity)
  );
}

function checked(state: LendingState): LendingState {
  if (!validState(state))
    fail(
      'INVALID_STATE',
      'The saved lending preview is invalid. Reset the preview to continue.',
    );
  return state;
}

function limitFor(id: string, limits: CollateralLimits): bigint {
  if (!Object.hasOwn(limits, id) || !raw(limits[id]))
    fail(
      'INVALID_COLLATERAL',
      'Choose a supported preview collateral position.',
    );
  return BigInt(limits[id]);
}

function credit(state: LendingState, limits: CollateralLimits): bigint {
  return state.collateralIds.reduce(
    (sum, id) => sum + limitFor(id, limits),
    0n,
  );
}

function assets(state: LendingState): bigint {
  return BigInt(state.poolCashMicros) + BigInt(state.poolOutstandingMicros);
}

function min(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

function finish(
  state: LendingState,
  changes: Partial<LendingState>,
  kind: LendingActivityKind,
  activity: Partial<Omit<LendingActivity, 'id' | 'kind' | 'createdAt'>> = {},
): LendingState {
  const entry: LendingActivity = {
    id: globalThis.crypto.randomUUID(),
    kind,
    createdAt: new Date().toISOString(),
    amountMicros: '0',
    sharesRaw: '0',
    feeMicros: '0',
    collateralId: null,
    rewardRepaidMicros: '0',
    rewardSurplusMicros: '0',
    poolYieldMicros: '0',
    ...activity,
  };
  const next = {
    ...state,
    ...changes,
    activity: [...state.activity, entry].slice(-MAX_ACTIVITY),
  };
  if (!validState(next))
    fail(
      'STATE_LIMIT',
      'This action exceeds the supported preview balance limit.',
    );
  return next;
}

export function createLendingState(): LendingState {
  return {
    version: 1,
    walletMicros: (25_000n * USDC).toString(),
    poolCashMicros: SEED_CASH.toString(),
    poolOutstandingMicros: SEED_OUTSTANDING.toString(),
    totalSharesRaw: SEED_SHARES.toString(),
    shareBalanceRaw: '0',
    debtMicros: '0',
    platformFeesMicros: '0',
    collateralIds: [],
    epoch: 0,
    activity: [],
  };
}

export function parseLendingState(
  rawState: string | null,
  limits: CollateralLimits,
): LendingState {
  try {
    if (!rawState || rawState.length > 200_000) return createLendingState();
    const value: unknown = JSON.parse(rawState);
    if (!validState(value) || BigInt(value.debtMicros) > credit(value, limits))
      return createLendingState();
    return value;
  } catch {
    return createLendingState();
  }
}

export function getLendingMetrics(
  state: LendingState,
  limits: CollateralLimits,
): LendingMetrics {
  checked(state);
  const totalAssets = assets(state);
  const supplied =
    (BigInt(state.shareBalanceRaw) * totalAssets) /
    BigInt(state.totalSharesRaw);
  const capacity = credit(state, limits);
  const remaining =
    capacity > BigInt(state.debtMicros)
      ? capacity - BigInt(state.debtMicros)
      : 0n;
  return {
    totalAssetsMicros: totalAssets.toString(),
    suppliedAssetsMicros: supplied.toString(),
    totalCreditMicros: capacity.toString(),
    availableCreditMicros: min(
      remaining,
      BigInt(state.poolCashMicros),
    ).toString(),
    maxWithdrawMicros: min(supplied, BigInt(state.poolCashMicros)).toString(),
    utilizationBps: Number(
      (BigInt(state.poolOutstandingMicros) * 10_000n) / totalAssets,
    ),
  };
}

export function supply(
  state: LendingState,
  amountMicros: string,
): LendingState {
  checked(state);
  const amount = positive(amountMicros);
  if (amount > BigInt(state.walletMicros))
    fail(
      'INSUFFICIENT_WALLET',
      'Your preview wallet does not have enough USDC.',
    );
  const shares = (amount * BigInt(state.totalSharesRaw)) / assets(state);
  if (shares === 0n)
    fail('ZERO_SHARES', 'This amount is too small to mint a share.');
  return finish(
    state,
    {
      walletMicros: (BigInt(state.walletMicros) - amount).toString(),
      poolCashMicros: (BigInt(state.poolCashMicros) + amount).toString(),
      shareBalanceRaw: (BigInt(state.shareBalanceRaw) + shares).toString(),
      totalSharesRaw: (BigInt(state.totalSharesRaw) + shares).toString(),
    },
    'supply',
    { amountMicros, sharesRaw: shares.toString() },
  );
}

function withdrawShares(
  state: LendingState,
  amount: bigint,
  shares: bigint,
  kind: 'withdraw' | 'redeem',
): LendingState {
  if (shares > BigInt(state.shareBalanceRaw))
    fail('INSUFFICIENT_SHARES', 'Your preview vault position is too small.');
  if (amount > BigInt(state.poolCashMicros))
    fail(
      'INSUFFICIENT_LIQUIDITY',
      'The vault does not have enough idle USDC for this withdrawal.',
    );
  return finish(
    state,
    {
      walletMicros: (BigInt(state.walletMicros) + amount).toString(),
      poolCashMicros: (BigInt(state.poolCashMicros) - amount).toString(),
      shareBalanceRaw: (BigInt(state.shareBalanceRaw) - shares).toString(),
      totalSharesRaw: (BigInt(state.totalSharesRaw) - shares).toString(),
    },
    kind,
    { amountMicros: amount.toString(), sharesRaw: shares.toString() },
  );
}

export function withdraw(
  state: LendingState,
  amountMicros: string,
): LendingState {
  checked(state);
  const amount = positive(amountMicros);
  const totalAssets = assets(state);
  const shares =
    (amount * BigInt(state.totalSharesRaw) + totalAssets - 1n) / totalAssets;
  return withdrawShares(state, amount, shares, 'withdraw');
}

export function redeem(state: LendingState, sharesRaw: string): LendingState {
  checked(state);
  const shares = positive(sharesRaw, UINT256_MAX);
  const amount = (shares * assets(state)) / BigInt(state.totalSharesRaw);
  if (amount === 0n)
    fail('ZERO_ASSETS', 'These shares are too small to redeem for USDC.');
  return withdrawShares(state, amount, shares, 'redeem');
}

export function depositCollateral(
  state: LendingState,
  id: string,
  limits: CollateralLimits,
): LendingState {
  checked(state);
  limitFor(id, limits);
  if (state.collateralIds.includes(id))
    fail('COLLATERAL_ALREADY_DEPOSITED', 'This position is already deposited.');
  return finish(
    state,
    { collateralIds: [...state.collateralIds, id] },
    'deposit-collateral',
    { collateralId: id },
  );
}

export function removeCollateral(
  state: LendingState,
  id: string,
  limits: CollateralLimits,
): LendingState {
  checked(state);
  if (!state.collateralIds.includes(id))
    fail('COLLATERAL_NOT_DEPOSITED', 'This position is not deposited.');
  const collateralIds = state.collateralIds.filter((item) => item !== id);
  if (credit({ ...state, collateralIds }, limits) < BigInt(state.debtMicros))
    fail(
      'COLLATERAL_REQUIRED',
      'Repay debt before removing collateral that supports it.',
    );
  return finish(state, { collateralIds }, 'remove-collateral', {
    collateralId: id,
  });
}

export function borrow(
  state: LendingState,
  principalMicros: string,
  limits: CollateralLimits,
): LendingState {
  checked(state);
  const principal = positive(principalMicros);
  if (BigInt(state.debtMicros) + principal > credit(state, limits))
    fail(
      'INSUFFICIENT_CREDIT',
      'This amount exceeds your illustrative collateral credit.',
    );
  if (principal > BigInt(state.poolCashMicros))
    fail(
      'INSUFFICIENT_LIQUIDITY',
      'The vault does not have enough idle USDC to fund this amount.',
    );
  const fee = (principal * 50n) / 10_000n;
  return finish(
    state,
    {
      walletMicros: (BigInt(state.walletMicros) + principal - fee).toString(),
      poolCashMicros: (BigInt(state.poolCashMicros) - principal).toString(),
      poolOutstandingMicros: (
        BigInt(state.poolOutstandingMicros) + principal
      ).toString(),
      debtMicros: (BigInt(state.debtMicros) + principal).toString(),
      platformFeesMicros: (BigInt(state.platformFeesMicros) + fee).toString(),
    },
    'borrow',
    { amountMicros: principalMicros, feeMicros: fee.toString() },
  );
}

export function repay(state: LendingState, amountMicros: string): LendingState {
  checked(state);
  const amount = positive(amountMicros);
  if (amount > BigInt(state.debtMicros))
    fail(
      'EXCESS_REPAYMENT',
      'Repayment cannot exceed your remaining preview debt.',
    );
  if (amount > BigInt(state.walletMicros))
    fail(
      'INSUFFICIENT_WALLET',
      'Your preview wallet does not have enough USDC.',
    );
  return finish(
    state,
    {
      walletMicros: (BigInt(state.walletMicros) - amount).toString(),
      poolCashMicros: (BigInt(state.poolCashMicros) + amount).toString(),
      poolOutstandingMicros: (
        BigInt(state.poolOutstandingMicros) - amount
      ).toString(),
      debtMicros: (BigInt(state.debtMicros) - amount).toString(),
    },
    'repay',
    { amountMicros },
  );
}

/**
 * Pay for a sample marketplace position from the demo wallet. The seller's
 * one-time 0.5% fee is platform revenue; the seller's net proceeds leave the
 * preview. Ownership of the position is tracked by the purchase receipt.
 */
export function purchase(
  state: LendingState,
  assetId: string,
  priceMicros: string,
): LendingState {
  checked(state);
  if (typeof assetId !== 'string' || !assetId || assetId.length > 100)
    fail('INVALID_POSITION', 'Choose a listed preview position.');
  const price = positive(priceMicros);
  if (price > BigInt(state.walletMicros))
    fail(
      'INSUFFICIENT_WALLET',
      'Your preview wallet does not have enough USDC for this purchase.',
    );
  const fee = (price * 5n) / 1000n;
  return finish(
    state,
    {
      walletMicros: (BigInt(state.walletMicros) - price).toString(),
      platformFeesMicros: (BigInt(state.platformFeesMicros) + fee).toString(),
    },
    'purchase',
    {
      amountMicros: price.toString(),
      feeMicros: fee.toString(),
      collateralId: assetId,
    },
  );
}

/**
 * Buy a position straight into collateral: deposit it, optionally draw USDC
 * against the enlarged credit line, then pay the seller. Every step keeps the
 * usual checks, and nothing is committed unless all of them succeed.
 */
export function purchaseIntoCollateral(
  state: LendingState,
  assetId: string,
  priceMicros: string,
  borrowMicros: string,
  limits: CollateralLimits,
): LendingState {
  let next = depositCollateral(state, assetId, limits);
  if (raw(borrowMicros) && BigInt(borrowMicros) > 0n)
    next = borrow(next, borrowMicros, limits);
  else if (borrowMicros !== '0')
    fail('INVALID_AMOUNT', 'Enter a borrow amount in exact raw units.');
  return purchase(next, assetId, priceMicros);
}

export function advanceEpoch(
  state: LendingState,
  collateralRewardMicros = '50000000',
  poolYieldMicros = '200000000',
): LendingState {
  checked(state);
  // Both inputs are illustrative NET amounts after any upstream reward fees.
  // This ledger does not assume a gross reward rate or introduce a reward fee.
  // The inputs are scenario values, not a forecast or reward claim.
  const maximum = BigInt(MAX_EPOCH_INPUT_MICROS);
  if (!raw(collateralRewardMicros, maximum) || !raw(poolYieldMicros, maximum))
    fail(
      'INVALID_REWARD',
      'Enter an illustrative epoch amount from 0 to 1,000 USDC.',
    );
  const collateralReward = state.collateralIds.length
    ? BigInt(collateralRewardMicros)
    : 0n;
  const poolYield = BigInt(poolYieldMicros);
  const repaid = min(collateralReward, BigInt(state.debtMicros));
  const surplus = collateralReward - repaid;
  return finish(
    state,
    {
      walletMicros: (BigInt(state.walletMicros) + surplus).toString(),
      poolCashMicros: (
        BigInt(state.poolCashMicros) +
        repaid +
        poolYield
      ).toString(),
      poolOutstandingMicros: (
        BigInt(state.poolOutstandingMicros) - repaid
      ).toString(),
      debtMicros: (BigInt(state.debtMicros) - repaid).toString(),
      epoch: state.epoch + 1,
    },
    'epoch',
    {
      amountMicros: collateralReward.toString(),
      rewardRepaidMicros: repaid.toString(),
      rewardSurplusMicros: surplus.toString(),
      poolYieldMicros: poolYield.toString(),
    },
  );
}
