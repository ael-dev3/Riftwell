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
  | 'purchase'
  | 'relayer-deposit'
  | 'relayer-withdraw'
  | 'merge'
  | 'increase-lock';
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
  /** Net rewards collected for relayer positions. */
  relayerRewardMicros: string;
  /** The part of `relayerRewardMicros` that repaid debt; the rest was paid out. */
  relayerRepaidMicros: string;
  /** For a merge: the wallet position merged into `collateralId`. */
  mergedId: string | null;
  /** For a lock increase: whole demo token units added. */
  lockUnits: string;
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
  /** Positions deposited for automated reward collection, without credit. */
  relayerIds: string[];
  /** Share of relayer rewards routed to repay debt, in basis points. */
  relayerRepayBps: number;
  /** Demo market tokens in the wallet, in whole units, for lock increases. */
  tokenUnits: string;
  /** Whole token units added to each position's lock. */
  lockIncreases: Record<string, string>;
  /** Positions merged away, each mapped to the position it joined. */
  mergedInto: Record<string, string>;
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
/** Demo market tokens available for lock increases in a fresh preview. */
export const DEMO_TOKEN_UNITS = '20000';
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
  'relayer-deposit',
  'relayer-withdraw',
  'merge',
  'increase-lock',
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
    raw(value.poolYieldMicros) &&
    raw(value.relayerRewardMicros) &&
    raw(value.relayerRepaidMicros) &&
    BigInt(value.relayerRepaidMicros) <= BigInt(value.relayerRewardMicros) &&
    (value.mergedId === null || validId(value.mergedId)) &&
    raw(value.lockUnits, BigInt(DEMO_TOKEN_UNITS))
  );
}

function validShare(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= 10_000
  );
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 100;
}

function validRecord(
  value: unknown,
  valid: (key: string, item: unknown) => boolean,
): value is Record<string, string> {
  return (
    object(value) &&
    Object.keys(value).length <= MAX_COLLATERAL &&
    Object.entries(value).every(
      ([key, item]) => validId(key) && valid(key, item),
    )
  );
}

/** Following merges from any position must end; a cycle would never resolve. */
function acyclic(links: Record<string, string>): boolean {
  return Object.keys(links).every((start) => {
    let id = start;
    for (let steps = 0; Object.hasOwn(links, id); steps += 1) {
      if (steps > MAX_COLLATERAL) return false;
      const target = links[id];
      if (target === undefined) return false;
      id = target;
    }
    return true;
  });
}

function validIds(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_COLLATERAL &&
    value.every(validId) &&
    new Set(value).size === value.length
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
    validIds(value.collateralIds) &&
    validIds(value.relayerIds) &&
    // Both lists were validated above; a position is in at most one of them.
    !value.relayerIds.some((id) =>
      (value.collateralIds as string[]).includes(id),
    ) &&
    validShare(value.relayerRepayBps) &&
    raw(value.tokenUnits, BigInt(DEMO_TOKEN_UNITS)) &&
    validRecord(
      value.lockIncreases,
      (_, units) =>
        raw(units, BigInt(DEMO_TOKEN_UNITS)) && BigInt(units as string) > 0n,
    ) &&
    // Demo tokens are only ever moved from the wallet into locks.
    Object.values(value.lockIncreases).reduce(
      (sum, units) => sum + BigInt(units),
      BigInt(value.tokenUnits),
    ) === BigInt(DEMO_TOKEN_UNITS) &&
    validRecord(
      value.mergedInto,
      (source, target) => validId(target) && target !== source,
    ) &&
    // A merged position no longer exists, so it cannot be in use.
    Object.keys(value.mergedInto).every(
      (id) =>
        !(value.collateralIds as string[]).includes(id) &&
        !(value.relayerIds as string[]).includes(id),
    ) &&
    acyclic(value.mergedInto) &&
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
    relayerRewardMicros: '0',
    relayerRepaidMicros: '0',
    mergedId: null,
    lockUnits: '0',
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
    relayerIds: [],
    relayerRepayBps: 0,
    tokenUnits: DEMO_TOKEN_UNITS,
    lockIncreases: {},
    mergedInto: {},
    epoch: 0,
    activity: [],
  };
}

/** Fill fields added after a preview was first saved, before validation. */
function upgrade(value: unknown): unknown {
  if (!object(value)) return value;
  return {
    ...value,
    relayerIds: value.relayerIds ?? [],
    relayerRepayBps: value.relayerRepayBps ?? 0,
    tokenUnits: value.tokenUnits ?? DEMO_TOKEN_UNITS,
    lockIncreases: value.lockIncreases ?? {},
    mergedInto: value.mergedInto ?? {},
    activity: Array.isArray(value.activity)
      ? value.activity.map((entry: unknown) =>
          object(entry)
            ? {
                relayerRewardMicros: '0',
                relayerRepaidMicros: '0',
                mergedId: null,
                lockUnits: '0',
                ...entry,
              }
            : entry,
        )
      : value.activity,
  };
}

/**
 * Restore a saved preview. Limits may depend on the saved merges and lock
 * increases, so they can be given as a function of the parsed state.
 */
export function parseLendingState(
  rawState: string | null,
  limits: CollateralLimits | ((state: LendingState) => CollateralLimits),
): LendingState {
  try {
    if (!rawState || rawState.length > 200_000) return createLendingState();
    const value = upgrade(JSON.parse(rawState));
    if (
      !validState(value) ||
      BigInt(value.debtMicros) >
        credit(value, typeof limits === 'function' ? limits(value) : limits)
    )
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
  if (Object.hasOwn(state.mergedInto, id))
    fail('MERGED', 'This position was merged into another one.');
  if (state.collateralIds.includes(id))
    fail('COLLATERAL_ALREADY_DEPOSITED', 'This position is already deposited.');
  if (state.relayerIds.includes(id))
    fail(
      'IN_RELAYER',
      'Withdraw this position from the relayer before using it as collateral.',
    );
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

/**
 * Merge a wallet position into deposited collateral. The wallet position stops
 * existing on its own; its locked units and later unlock date carry into the
 * collateral, so the caller's limits grow with it. Debt does not change.
 */
export function mergePositions(
  state: LendingState,
  sourceId: string,
  targetId: string,
  limits: CollateralLimits,
): LendingState {
  checked(state);
  limitFor(sourceId, limits);
  limitFor(targetId, limits);
  if (!state.collateralIds.includes(targetId))
    fail(
      'NOT_COLLATERAL',
      'Merge into a position that is deposited as collateral.',
    );
  if (sourceId === targetId)
    fail('SAME_POSITION', 'Choose another position to merge.');
  if (Object.hasOwn(state.mergedInto, sourceId))
    fail('MERGED', 'This position was merged into another one.');
  if (
    state.collateralIds.includes(sourceId) ||
    state.relayerIds.includes(sourceId)
  )
    fail('NOT_IN_WALLET', 'Merge a position that is in your wallet.');
  return finish(
    state,
    { mergedInto: { ...state.mergedInto, [sourceId]: targetId } },
    'merge',
    { collateralId: targetId, mergedId: sourceId },
  );
}

/** Lock more demo tokens into a deposited position, growing its credit. */
export function increaseLock(
  state: LendingState,
  id: string,
  units: string,
  limits: CollateralLimits,
): LendingState {
  checked(state);
  limitFor(id, limits);
  if (!state.collateralIds.includes(id))
    fail(
      'NOT_COLLATERAL',
      'Increase the lock of a position deposited as collateral.',
    );
  if (!raw(units, BigInt(DEMO_TOKEN_UNITS)) || BigInt(units) === 0n)
    fail('INVALID_UNITS', 'Enter a whole number of tokens above zero.');
  const amount = BigInt(units);
  if (amount > BigInt(state.tokenUnits))
    fail('INSUFFICIENT_TOKENS', 'This is more than your demo token balance.');
  const previous = Object.hasOwn(state.lockIncreases, id)
    ? BigInt(state.lockIncreases[id] ?? '0')
    : 0n;
  return finish(
    state,
    {
      tokenUnits: (BigInt(state.tokenUnits) - amount).toString(),
      lockIncreases: {
        ...state.lockIncreases,
        [id]: (previous + amount).toString(),
      },
    },
    'increase-lock',
    { collateralId: id, lockUnits: units },
  );
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

/**
 * Deposit a position for automated reward collection. It earns no credit and
 * cannot back a loan; each epoch its net rewards are paid to the wallet.
 */
export function depositToRelayer(
  state: LendingState,
  id: string,
  limits: CollateralLimits,
): LendingState {
  checked(state);
  limitFor(id, limits);
  if (Object.hasOwn(state.mergedInto, id))
    fail('MERGED', 'This position was merged into another one.');
  if (state.relayerIds.includes(id))
    fail('ALREADY_IN_RELAYER', 'This position is already in the relayer.');
  if (state.collateralIds.includes(id))
    fail(
      'COLLATERAL_DEPOSITED',
      'Remove this position from your collateral before adding it to the relayer.',
    );
  return finish(
    state,
    { relayerIds: [...state.relayerIds, id] },
    'relayer-deposit',
    { collateralId: id },
  );
}

export function withdrawFromRelayer(
  state: LendingState,
  id: string,
): LendingState {
  checked(state);
  if (!state.relayerIds.includes(id))
    fail('NOT_IN_RELAYER', 'This position is not in the relayer.');
  return finish(
    state,
    { relayerIds: state.relayerIds.filter((item) => item !== id) },
    'relayer-withdraw',
    { collateralId: id },
  );
}

/** Buy a position straight into the relayer, then pay the seller. */
export function purchaseIntoRelayer(
  state: LendingState,
  assetId: string,
  priceMicros: string,
  limits: CollateralLimits,
): LendingState {
  return purchase(
    depositToRelayer(state, assetId, limits),
    assetId,
    priceMicros,
  );
}

/**
 * Route a share of future relayer rewards to repay debt; the rest is paid out.
 * A setting rather than a transaction, so it adds no activity entry.
 */
export function setRelayerRepayShare(
  state: LendingState,
  bps: number,
): LendingState {
  checked(state);
  if (!validShare(bps))
    fail('INVALID_SHARE', 'Choose a repayment share from 0% to 100%.');
  return checked({ ...state, relayerRepayBps: bps });
}

export function advanceEpoch(
  state: LendingState,
  collateralRewardMicros = '50000000',
  poolYieldMicros = '200000000',
  relayerRewardMicros = '0',
): LendingState {
  checked(state);
  // Every input is an illustrative NET amount after any upstream reward fees
  // or automation charges. This ledger does not assume a gross reward rate or
  // introduce a fee. The inputs are scenario values, not a forecast or claim.
  const maximum = BigInt(MAX_EPOCH_INPUT_MICROS);
  if (
    !raw(collateralRewardMicros, maximum) ||
    !raw(poolYieldMicros, maximum) ||
    !raw(relayerRewardMicros, maximum)
  )
    fail(
      'INVALID_REWARD',
      'Enter an illustrative epoch amount from 0 to 1,000 USDC.',
    );
  const collateralReward = state.collateralIds.length
    ? BigInt(collateralRewardMicros)
    : 0n;
  const relayerReward = state.relayerIds.length
    ? BigInt(relayerRewardMicros)
    : 0n;
  const poolYield = BigInt(poolYieldMicros);
  const repaid = min(collateralReward, BigInt(state.debtMicros));
  const surplus = collateralReward - repaid;
  // Collateral rewards repay first; the chosen share of relayer rewards then
  // repays what remains, and everything else is paid out.
  const relayerRepaid = min(
    (relayerReward * BigInt(state.relayerRepayBps)) / 10_000n,
    BigInt(state.debtMicros) - repaid,
  );
  const totalRepaid = repaid + relayerRepaid;
  return finish(
    state,
    {
      walletMicros: (
        BigInt(state.walletMicros) +
        surplus +
        relayerReward -
        relayerRepaid
      ).toString(),
      poolCashMicros: (
        BigInt(state.poolCashMicros) +
        totalRepaid +
        poolYield
      ).toString(),
      poolOutstandingMicros: (
        BigInt(state.poolOutstandingMicros) - totalRepaid
      ).toString(),
      debtMicros: (BigInt(state.debtMicros) - totalRepaid).toString(),
      epoch: state.epoch + 1,
    },
    'epoch',
    {
      amountMicros: collateralReward.toString(),
      rewardRepaidMicros: repaid.toString(),
      rewardSurplusMicros: surplus.toString(),
      poolYieldMicros: poolYield.toString(),
      relayerRewardMicros: relayerReward.toString(),
      relayerRepaidMicros: relayerRepaid.toString(),
    },
  );
}
