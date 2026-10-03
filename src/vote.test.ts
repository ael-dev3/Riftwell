import { describe, expect, it } from 'vitest';
import {
  defaultVotePlan,
  evenWeights,
  EXAMPLE_POOLS,
  isDefaultVotePlan,
  OPTIMIZER_WEIGHTS,
  parseVotePlan,
  planWeights,
  projectedRewardMicros,
  votingPower,
  weightTotal,
} from './vote';

describe('example vote planner', () => {
  it('scales voting power by remaining lock over a two-year maximum', () => {
    const now = Date.parse('2026-10-02T00:00:00Z');
    expect(votingPower(100_000, '2028-10-01', now)).toBe(100_000);
    expect(votingPower(100_000, '2027-10-02', now)).toBe(50_000);
    expect(votingPower(100_000, '2026-01-01', now)).toBe(0);
  });

  it('projects example rewards from weights and example pool rates', () => {
    const plan = defaultVotePlan();
    expect(weightTotal(planWeights(plan))).toBe(10_000);
    // 100,000 votes: 45% × 1.30 + 35% × 1.18 + 20% × 1.05 per 1,000 votes
    expect(projectedRewardMicros(plan, 100_000)).toBe(120_800_000n);
    expect(projectedRewardMicros(plan, 0)).toBe(0n);
    const stable = {
      version: 1 as const,
      mode: 'manual' as const,
      weights: { 'example-stable': 10_000 },
    };
    expect(projectedRewardMicros(stable, 100_000)).toBe(72_000_000n);
  });

  it('accepts only complete manual plans for known example pools', () => {
    const manual = { version: 1, mode: 'manual', weights: evenWeights() };
    expect(weightTotal(evenWeights())).toBe(10_000);
    expect(Object.keys(evenWeights())).toHaveLength(EXAMPLE_POOLS.length);
    expect(parseVotePlan(JSON.stringify(manual))).toEqual(manual);
    for (const invalid of [
      '{broken',
      JSON.stringify({ ...manual, weights: { 'kitten-whype': 9_999 } }),
      JSON.stringify({ ...manual, weights: { unknown: 10_000 } }),
      JSON.stringify({ ...manual, weights: { 'kitten-whype': 10_000.5 } }),
      JSON.stringify({ ...manual, mode: 'auto' }),
      JSON.stringify({ ...manual, version: 2 }),
    ])
      expect(parseVotePlan(invalid)).toEqual(defaultVotePlan());
    expect(parseVotePlan(null).weights).toEqual(OPTIMIZER_WEIGHTS);
  });

  it('recognises the untouched starting plan', () => {
    expect(isDefaultVotePlan(defaultVotePlan())).toBe(true);
    expect(isDefaultVotePlan({ ...defaultVotePlan(), mode: 'manual' })).toBe(
      false,
    );
    expect(
      isDefaultVotePlan({ ...defaultVotePlan(), weights: evenWeights() }),
    ).toBe(false);
  });
});
