import { describe, expect, it } from 'vitest';
import { simulateRepayment, thinSchedule } from './simulator';

const base = {
  rewardMicros: 50_000_000n,
  creditEpochs: 40,
  borrowMicros: 1_000_000_000n,
  repaymentShareBps: 10_000,
  rewardChangeBps: 0,
};

describe('illustrative repayment projection', () => {
  it('sizes credit from reward × epochs and deducts the 0.5% fee from proceeds', () => {
    const result = simulateRepayment(base);
    expect(result.creditMicros).toBe(2_000_000_000n);
    expect(result.principalMicros).toBe(1_000_000_000n);
    expect(result.feeMicros).toBe(5_000_000n);
    expect(result.netMicros).toBe(995_000_000n);
    expect(result.epochsToRepay).toBe(20);
    expect(result.schedule.at(-1)?.debtMicros).toBe(0n);
    expect(result.totalRepaidMicros).toBe(1_000_000_000n);
  });

  it('caps principal at the credit limit and handles a zero draw', () => {
    expect(
      simulateRepayment({ ...base, borrowMicros: 9_000_000_000n })
        .principalMicros,
    ).toBe(2_000_000_000n);
    const none = simulateRepayment({ ...base, borrowMicros: 0n });
    expect(none.epochsToRepay).toBe(0);
    expect(none.feeMicros).toBe(0n);
  });

  it('slows repayment when less reward is applied and never repays at zero share', () => {
    expect(
      simulateRepayment({ ...base, repaymentShareBps: 5_000 }).epochsToRepay,
    ).toBe(40);
    const none = simulateRepayment({ ...base, repaymentShareBps: 0 });
    expect(none.epochsToRepay).toBeNull();
    expect(none.schedule).toHaveLength(521);
  });

  it('stress-tests declining rewards without inventing repayment', () => {
    const declining = simulateRepayment({ ...base, rewardChangeBps: -2_000 });
    expect(declining.epochsToRepay).toBeNull();
    expect(declining.totalRepaidMicros).toBeLessThan(1_000_000_000n);
    const growing = simulateRepayment({ ...base, rewardChangeBps: 500 });
    expect(growing.epochsToRepay).toBeLessThan(20);
  });

  it('clamps out-of-range assumptions', () => {
    const result = simulateRepayment({
      ...base,
      repaymentShareBps: 50_000,
      rewardChangeBps: -50_000,
      creditEpochs: -3,
    });
    expect(result.creditMicros).toBe(0n);
    expect(result.principalMicros).toBe(0n);
  });

  it('thins long schedules but keeps both ends', () => {
    const points = Array.from({ length: 521 }, (_, index) => index);
    const thinned = thinSchedule(points, 60);
    expect(thinned).toHaveLength(60);
    expect(thinned[0]).toBe(0);
    expect(thinned.at(-1)).toBe(520);
    expect(thinSchedule([1, 2, 3])).toEqual([1, 2, 3]);
    expect(thinSchedule(points, 1)).toEqual([0, 520]);
    expect(thinSchedule(points, Number.NaN)).toHaveLength(60);
  });
});
