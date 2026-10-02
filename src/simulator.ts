// Illustrative repayment projection. Every input is a user assumption; the
// output is arithmetic on those assumptions, not a forecast or a loan quote.

export type SimulationInput = {
  /** Net rewards available for repayment in the first epoch, in USDC micros. */
  rewardMicros: bigint;
  /** Credit policy multiplier: credit = reward × epochs. */
  creditEpochs: number;
  /** Gross principal drawn, in USDC micros. Capped at the credit limit. */
  borrowMicros: bigint;
  /** Share of net rewards applied to debt, in basis points (0–10,000). */
  repaymentShareBps: number;
  /** Reward change applied after every epoch, in basis points (e.g. -200 = -2%). */
  rewardChangeBps: number;
  /** Projection horizon in epochs. */
  maxEpochs?: number;
};

export type SimulationPoint = {
  epoch: number;
  debtMicros: bigint;
  repaidMicros: bigint;
};

export type SimulationResult = {
  creditMicros: bigint;
  principalMicros: bigint;
  feeMicros: bigint;
  netMicros: bigint;
  /** Epochs until debt reaches zero, or null when not repaid within the horizon. */
  epochsToRepay: number | null;
  schedule: SimulationPoint[];
  totalRepaidMicros: bigint;
};

export const ORIGINATION_FEE_BPS = 50n;
export const DEFAULT_HORIZON = 520;

const clampBps = (value: number, low: number, high: number) =>
  BigInt(Math.min(high, Math.max(low, Math.trunc(value))));

export function simulateRepayment(input: SimulationInput): SimulationResult {
  const reward = input.rewardMicros > 0n ? input.rewardMicros : 0n;
  const epochs = BigInt(Math.max(0, Math.trunc(input.creditEpochs)));
  const creditMicros = reward * epochs;
  const principalMicros =
    input.borrowMicros < 0n
      ? 0n
      : input.borrowMicros > creditMicros
        ? creditMicros
        : input.borrowMicros;
  const feeMicros = (principalMicros * ORIGINATION_FEE_BPS) / 10_000n;
  const share = clampBps(input.repaymentShareBps, 0, 10_000);
  const change = clampBps(input.rewardChangeBps, -9_000, 9_000);
  const horizon = Math.max(1, Math.trunc(input.maxEpochs ?? DEFAULT_HORIZON));

  let debt = principalMicros;
  let current = reward;
  let totalRepaid = 0n;
  let epochsToRepay: number | null = debt === 0n ? 0 : null;
  const schedule: SimulationPoint[] = [
    { epoch: 0, debtMicros: debt, repaidMicros: 0n },
  ];
  for (let epoch = 1; epoch <= horizon && debt > 0n; epoch++) {
    const available = (current * share) / 10_000n;
    const repaid = available < debt ? available : debt;
    debt -= repaid;
    totalRepaid += repaid;
    schedule.push({ epoch, debtMicros: debt, repaidMicros: repaid });
    if (debt === 0n) epochsToRepay = epoch;
    current = (current * (10_000n + change)) / 10_000n;
    if (current === 0n && debt > 0n) break;
  }
  return {
    creditMicros,
    principalMicros,
    feeMicros,
    netMicros: principalMicros - feeMicros,
    epochsToRepay,
    schedule,
    totalRepaidMicros: totalRepaid,
  };
}

/** Evenly thin a schedule for drawing, always keeping the first and last points. */
export function thinSchedule<T>(points: readonly T[], maximum = 60): T[] {
  if (points.length <= maximum) return [...points];
  const step = (points.length - 1) / (maximum - 1);
  return Array.from(
    { length: maximum },
    (_, index) => points[Math.round(index * step)],
  );
}
