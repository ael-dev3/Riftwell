import { describe, expect, it } from 'vitest';
import {
  assetById,
  collateralLimits,
  creditMicros,
  positionView,
  rewardMicros,
} from './data';
import type { Asset } from './domain';

const asset = (id: string): Asset => {
  const found = assetById(id);
  if (!found) throw new Error(`Missing sample position ${id}`);
  return found;
};
const none = { lockIncreases: {}, mergedInto: {} };

describe('sample positions after merges and lock increases', () => {
  it('derives example rewards and credit from the locked balance', () => {
    expect(rewardMicros(asset('rift-041'))).toBe(50_000_000n);
    expect(creditMicros(asset('rift-041'))).toBe(2_000_000_000n);
    expect(positionView(asset('rift-041'), none)).toBe(asset('rift-041'));
  });

  it('adds merged and increased units and keeps the later unlock date', () => {
    const view = positionView(asset('rift-012'), {
      lockIncreases: { 'rift-012': '5000' },
      mergedInto: { 'rift-041': 'rift-012' },
    });
    expect(view).toMatchObject({
      id: 'rift-012',
      underlyingBalance: 155_000,
      referenceValue: 15_500,
      price: 12_865,
      unlockDate: '2028-10-01',
      category: 'Max lock',
    });
    expect(view.description).toContain('155,000 sample KITTEN');

    const later = positionView(asset('rift-041'), {
      lockIncreases: {},
      mergedInto: { 'rift-018': 'rift-041' },
    });
    expect(later).toMatchObject({
      underlyingBalance: 130_000,
      unlockDate: '2028-10-01',
      lockTerm: '24 months',
      category: 'Max lock',
    });
  });

  it('follows merge chains, including increases on merged positions', () => {
    const changes = {
      lockIncreases: { 'rift-041': '1000' },
      mergedInto: { 'rift-041': 'rift-018', 'rift-018': 'rift-012' },
    };
    expect(positionView(asset('rift-012'), changes).underlyingBalance).toBe(
      231_000,
    );
    const limits = collateralLimits(changes);
    expect(limits['rift-012']).toBe('9240000000');
    expect(limits['rift-009']).toBe(creditMicros(asset('rift-009')).toString());
  });
});
