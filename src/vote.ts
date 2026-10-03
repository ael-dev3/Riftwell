import { lockDaysRemaining } from './domain';

// Example pools and reward rates for the preview vote planner. They are not
// KittenSwap gauge data, and a plan never casts a vote.
export type ExamplePool = {
  id: string;
  pair: string;
  kind: 'Volatile' | 'Stable';
  /** Example net reward per 1,000 votes per epoch, in USDC micros. */
  rewardPerThousandMicros: bigint;
};

export const EXAMPLE_POOLS: readonly ExamplePool[] = [
  {
    id: 'kitten-whype',
    pair: 'KITTEN / WHYPE',
    kind: 'Volatile',
    rewardPerThousandMicros: 1_300_000n,
  },
  {
    id: 'kitten-usdt0',
    pair: 'KITTEN / USDT0',
    kind: 'Volatile',
    rewardPerThousandMicros: 1_180_000n,
  },
  {
    id: 'whype-usdt0',
    pair: 'WHYPE / USDT0',
    kind: 'Volatile',
    rewardPerThousandMicros: 1_050_000n,
  },
  {
    id: 'example-bluechip',
    pair: 'Example blue-chip pair',
    kind: 'Volatile',
    rewardPerThousandMicros: 940_000n,
  },
  {
    id: 'example-stable',
    pair: 'Example stable pair',
    kind: 'Stable',
    rewardPerThousandMicros: 720_000n,
  },
];

export type VoteMode = 'optimizer' | 'manual';
export type VotePlan = {
  version: 1;
  mode: VoteMode;
  /** Manual weights in basis points by pool id. */
  weights: Record<string, number>;
};

export const VOTE_STORAGE_KEY = 'riftwell.vote-plan.v1';
export const MAX_LOCK_DAYS = 730;
export const OPTIMIZER_WEIGHTS: Readonly<Record<string, number>> = {
  'kitten-whype': 4500,
  'kitten-usdt0': 3500,
  'whype-usdt0': 2000,
};

export const defaultVotePlan = (): VotePlan => ({
  version: 1,
  mode: 'optimizer',
  weights: { ...OPTIMIZER_WEIGHTS },
});

export const weightTotal = (weights: Readonly<Record<string, number>>) =>
  Object.values(weights).reduce((sum, value) => sum + value, 0);

function validWeights(value: unknown): value is Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.entries(value as Record<string, unknown>);
  return (
    entries.every(
      ([id, weight]) =>
        EXAMPLE_POOLS.some((pool) => pool.id === id) &&
        typeof weight === 'number' &&
        Number.isSafeInteger(weight) &&
        weight >= 0 &&
        weight <= 10_000,
    ) &&
    weightTotal(Object.fromEntries(entries) as Record<string, number>) ===
      10_000
  );
}

export function parseVotePlan(raw: string | null): VotePlan {
  if (!raw || raw.length > 10_000) return defaultVotePlan();
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return defaultVotePlan();
    const plan = value as Record<string, unknown>;
    if (
      plan.version !== 1 ||
      (plan.mode !== 'optimizer' && plan.mode !== 'manual') ||
      !validWeights(plan.weights)
    )
      return defaultVotePlan();
    return {
      version: 1,
      mode: plan.mode,
      weights: { ...(plan.weights as Record<string, number>) },
    };
  } catch {
    return defaultVotePlan();
  }
}

export const planWeights = (
  plan: VotePlan,
): Readonly<Record<string, number>> =>
  plan.mode === 'optimizer' ? OPTIMIZER_WEIGHTS : plan.weights;

/** ve-style voting power: balance scaled by remaining lock over a 2-year maximum. */
export function votingPower(
  balance: number,
  unlockDate: string,
  now = Date.now(),
): number {
  const days = Math.min(MAX_LOCK_DAYS, lockDaysRemaining(unlockDate, now));
  return Math.floor((balance * days) / MAX_LOCK_DAYS);
}

/** Example net reward per epoch for a plan, in USDC micros. */
export function projectedRewardMicros(plan: VotePlan, power: number): bigint {
  const weights = planWeights(plan);
  const votes = BigInt(Math.max(0, Math.floor(power)));
  return EXAMPLE_POOLS.reduce(
    (sum, pool) =>
      sum +
      (votes * BigInt(weights[pool.id] ?? 0) * pool.rewardPerThousandMicros) /
        10_000_000n,
    0n,
  );
}

/** Even manual split used when a planner switches to manual mode. */
export function evenWeights(): Record<string, number> {
  const share = Math.floor(10_000 / EXAMPLE_POOLS.length);
  const weights: Record<string, number> = {};
  EXAMPLE_POOLS.forEach((pool, index) => {
    weights[pool.id] =
      index === 0 ? 10_000 - share * (EXAMPLE_POOLS.length - 1) : share;
  });
  return weights;
}

/** True when a plan still matches the starting optimizer plan. */
export function isDefaultVotePlan(plan: VotePlan): boolean {
  const initial = defaultVotePlan();
  return (
    plan.mode === initial.mode &&
    EXAMPLE_POOLS.every(
      (pool) =>
        (plan.weights[pool.id] ?? 0) === (initial.weights[pool.id] ?? 0),
    )
  );
}
