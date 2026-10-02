import { describe, expect, it } from 'vitest';
import {
  LendingError,
  advanceEpoch,
  borrow,
  createLendingState,
  depositCollateral,
  getLendingMetrics,
  parseLendingState,
  redeem,
  removeCollateral,
  repay,
  supply,
  withdraw,
  type LendingState,
} from './lending';

// Credit limits stand in for explicitly illustrative reward-history policy.
const limits = {
  first: '2000000000',
  second: '3200000000',
  third: '4000000000',
};
const broadLimits = { large: '300000000000' };
const units = (state: LendingState, key: keyof LendingState) =>
  BigInt(String(state[key]));
const cash = (state: LendingState) =>
  units(state, 'walletMicros') +
  units(state, 'poolCashMicros') +
  units(state, 'platformFeesMicros');
const poolAssets = (state: LendingState) =>
  units(state, 'poolCashMicros') + units(state, 'poolOutstandingMicros');

function expectInvariants(state: LendingState) {
  expect(
    units(state, 'poolOutstandingMicros') - units(state, 'debtMicros'),
  ).toBe(80_000_000_000n);
  expect(units(state, 'totalSharesRaw') - units(state, 'shareBalanceRaw')).toBe(
    280_000_000_000n,
  );
  expect(units(state, 'debtMicros')).toBeLessThanOrEqual(
    units(state, 'poolOutstandingMicros'),
  );
  expect(units(state, 'shareBalanceRaw')).toBeLessThanOrEqual(
    units(state, 'totalSharesRaw'),
  );
  for (const key of [
    'walletMicros',
    'poolCashMicros',
    'poolOutstandingMicros',
    'debtMicros',
    'platformFeesMicros',
  ] as const)
    expect(units(state, key)).toBeGreaterThanOrEqual(0n);
}

describe('pooled USDC preview accounting', () => {
  it('seeds external pool capital separately from the current account', () => {
    const state = createLendingState();
    expect(getLendingMetrics(state, limits)).toEqual({
      totalAssetsMicros: '280000000000',
      suppliedAssetsMicros: '0',
      totalCreditMicros: '0',
      availableCreditMicros: '0',
      maxWithdrawMicros: '0',
      utilizationBps: 2857,
    });
    expect(state.walletMicros).toBe('25000000000');
    expect(state.shareBalanceRaw).toBe('0');
    expect(state.debtMicros).toBe('0');
    expectInvariants(state);
  });

  it('transfers supply into pool cash and mints shares without diluting existing holders', () => {
    const initial = createLendingState();
    const state = supply(initial, '10000000000');
    expect(state.walletMicros).toBe('15000000000');
    expect(state.poolCashMicros).toBe('210000000000');
    expect(state.shareBalanceRaw).toBe('10000000000');
    expect(state.totalSharesRaw).toBe('290000000000');
    expect(poolAssets(state) * units(initial, 'totalSharesRaw')).toBe(
      poolAssets(initial) * units(state, 'totalSharesRaw'),
    );
    expect(cash(state)).toBe(cash(initial));
    expect(state.platformFeesMicros).toBe('0');
    expect(initial.activity).toEqual([]);
    expectInvariants(state);
  });

  it('allocates illustrative net lender revenue by share ownership and permits exact withdrawal', () => {
    const supplied = supply(createLendingState(), '10000000000');
    const yielded = advanceEpoch(supplied, '0', '290000000');
    // The account owns 1/29 of the vault: a 290 USDC scenario adds 10 USDC.
    expect(getLendingMetrics(yielded, limits).suppliedAssetsMicros).toBe(
      '10010000000',
    );
    expect(yielded.walletMicros).toBe(supplied.walletMicros);
    const withdrawn = withdraw(yielded, '10010000000');
    expect(withdrawn.walletMicros).toBe('25010000000');
    expect(withdrawn.shareBalanceRaw).toBe('0');
    expect(withdrawn.totalSharesRaw).toBe('280000000000');
    expect(withdrawn.platformFeesMicros).toBe('0');
    expect(cash(withdrawn)).toBe(cash(createLendingState()) + 290_000_000n);
    expectInvariants(withdrawn);
  });

  it('floors minted shares, ceilings asset-withdrawal shares and floors share redemption', () => {
    const yielded = advanceEpoch(
      supply(createLendingState(), '10000000000'),
      '0',
      '290000000',
    );
    const supplied = supply(yielded, '1000001');
    expect(supplied.activity.at(-1)?.sharesRaw).toBe('999001');
    expect(
      poolAssets(supplied) * units(yielded, 'totalSharesRaw'),
    ).toBeGreaterThanOrEqual(
      poolAssets(yielded) * units(supplied, 'totalSharesRaw'),
    );
    const withdrawn = withdraw(yielded, '1000001');
    expect(withdrawn.activity.at(-1)?.sharesRaw).toBe('999002');
    const redeemed = redeem(yielded, '999002');
    expect(redeemed.activity.at(-1)?.amountMicros).toBe('1000001');
    expectInvariants(supplied);
    expectInvariants(withdrawn);
    expectInvariants(redeemed);
  });

  it('rejects a deposit that would transfer USDC while minting zero shares', () => {
    const state = advanceEpoch(createLendingState(), '0', '1');
    expect(() => supply(state, '1')).toThrowError(
      expect.objectContaining({ code: 'ZERO_SHARES' }),
    );
    expect(state.walletMicros).toBe('25000000000');
  });

  it('charges only the floored 0.5% origination fee and mirrors debt in the pool', () => {
    const initial = depositCollateral(createLendingState(), 'first', limits);
    const state = borrow(initial, '1000000199', limits);
    expect(state.activity.at(-1)?.feeMicros).toBe('5000000');
    expect(state.walletMicros).toBe('25995000199');
    expect(state.debtMicros).toBe('1000000199');
    expect(poolAssets(state)).toBe(poolAssets(initial));
    expect(cash(state)).toBe(cash(initial));
    const repaid = repay(state, '1000000199');
    expect(repaid.debtMicros).toBe('0');
    expect(repaid.poolOutstandingMicros).toBe('80000000000');
    expect(repaid.walletMicros).toBe('24995000000');
    expect(repaid.platformFeesMicros).toBe('5000000');
    expect(cash(repaid)).toBe(cash(initial));
    expectInvariants(repaid);
  });

  it('checks credit independently from idle liquidity and limits withdrawals to cash', () => {
    let state = depositCollateral(createLendingState(), 'large', broadLimits);
    state = borrow(state, '200000000000', broadLimits);
    state = supply(state, '10000000000');
    state = borrow(state, '10000000000', broadLimits);
    expect(state.poolCashMicros).toBe('0');
    expect(getLendingMetrics(state, broadLimits)).toMatchObject({
      suppliedAssetsMicros: '10000000000',
      maxWithdrawMicros: '0',
      availableCreditMicros: '0',
    });
    expect(() => borrow(state, '1', broadLimits)).toThrowError(
      expect.objectContaining({ code: 'INSUFFICIENT_LIQUIDITY' }),
    );
    expect(() => withdraw(state, '1')).toThrowError(
      expect.objectContaining({ code: 'INSUFFICIENT_LIQUIDITY' }),
    );
    expect(() => redeem(state, '1')).toThrowError(
      expect.objectContaining({ code: 'INSUFFICIENT_LIQUIDITY' }),
    );
    state = repay(state, '100000000');
    expect(getLendingMetrics(state, broadLimits).maxWithdrawMicros).toBe(
      '100000000',
    );
    state = withdraw(state, '100000000');
    expect(state.poolCashMicros).toBe('0');
    expect(state.platformFeesMicros).toBe('1050000000');
    expect(cash(state)).toBe(cash(createLendingState()));
    expectInvariants(state);
  });
});

describe('collateral and reward scenarios', () => {
  it('requires supported, unique collateral and preserves sufficient remaining credit', () => {
    const initial = createLendingState();
    expect(() => depositCollateral(initial, 'unknown', limits)).toThrow(
      LendingError,
    );
    let state = depositCollateral(initial, 'first', limits);
    expect(() => depositCollateral(state, 'first', limits)).toThrowError(
      expect.objectContaining({ code: 'COLLATERAL_ALREADY_DEPOSITED' }),
    );
    expect(() => borrow(state, '2000000001', limits)).toThrowError(
      expect.objectContaining({ code: 'INSUFFICIENT_CREDIT' }),
    );
    state = depositCollateral(state, 'second', limits);
    state = borrow(state, '5000000000', limits);
    expect(() => removeCollateral(state, 'second', limits)).toThrowError(
      expect.objectContaining({ code: 'COLLATERAL_REQUIRED' }),
    );
    state = repay(state, '3000000000');
    state = removeCollateral(state, 'second', limits);
    expect(state.collateralIds).toEqual(['first']);
    expect(() => removeCollateral(state, 'first', limits)).toThrow(
      LendingError,
    );
    state = repay(state, '2000000000');
    state = removeCollateral(state, 'first', limits);
    expect(state.collateralIds).toEqual([]);
    expectInvariants(state);
  });

  it('uses net collateral rewards for debt first and credits only the surplus to the account', () => {
    const borrowed = borrow(
      depositCollateral(createLendingState(), 'first', limits),
      '20000000',
      limits,
    );
    const epoch = advanceEpoch(borrowed, '50000000', '200000000');
    expect(epoch.debtMicros).toBe('0');
    expect(units(epoch, 'walletMicros') - units(borrowed, 'walletMicros')).toBe(
      30_000_000n,
    );
    expect(
      units(epoch, 'poolCashMicros') - units(borrowed, 'poolCashMicros'),
    ).toBe(220_000_000n);
    expect(poolAssets(epoch) - poolAssets(borrowed)).toBe(200_000_000n);
    expect(cash(epoch) - cash(borrowed)).toBe(250_000_000n);
    expect(epoch.activity.at(-1)).toMatchObject({
      rewardRepaidMicros: '20000000',
      rewardSurplusMicros: '30000000',
      poolYieldMicros: '200000000',
      feeMicros: '0',
    });
    expect(epoch.platformFeesMicros).toBe(borrowed.platformFeesMicros);
    expectInvariants(epoch);
  });

  it('supports zero and variable reward epochs without growing debt or imposing maturity', () => {
    const borrowed = borrow(
      depositCollateral(createLendingState(), 'first', limits),
      '100000000',
      limits,
    );
    const zero = advanceEpoch(borrowed, '0', '0');
    for (const key of [
      'walletMicros',
      'poolCashMicros',
      'poolOutstandingMicros',
      'debtMicros',
      'platformFeesMicros',
    ] as const)
      expect(zero[key]).toBe(borrowed[key]);
    const first = advanceEpoch(zero, '30000000', '0');
    expect(first.debtMicros).toBe('70000000');
    const second = advanceEpoch(first, '120000000', '0');
    expect(second.debtMicros).toBe('0');
    expect(second.activity.at(-1)?.rewardSurplusMicros).toBe('50000000');
    expect(poolAssets(second)).toBe(poolAssets(borrowed));
    expect(cash(second) - cash(borrowed)).toBe(150_000_000n);
    expect(second.platformFeesMicros).toBe('500000');
    expect(second).not.toHaveProperty('maturity');
    expect(second).not.toHaveProperty('apr');
    expectInvariants(second);
  });

  it('does not fabricate collateral rewards when no collateral is deposited', () => {
    const initial = createLendingState();
    const epoch = advanceEpoch(initial, '50000000', '0');
    expect(epoch.walletMicros).toBe(initial.walletMicros);
    expect(epoch.poolCashMicros).toBe(initial.poolCashMicros);
    expect(epoch.activity.at(-1)?.amountMicros).toBe('0');
  });

  it('rejects overpayment, absent wallet funds, absent shares and invalid epoch inputs', () => {
    const initial = createLendingState();
    expect(() => repay(initial, '1')).toThrowError(
      expect.objectContaining({ code: 'EXCESS_REPAYMENT' }),
    );
    expect(() => supply(initial, '25000000001')).toThrowError(
      expect.objectContaining({ code: 'INSUFFICIENT_WALLET' }),
    );
    expect(() => withdraw(initial, '1')).toThrowError(
      expect.objectContaining({ code: 'INSUFFICIENT_SHARES' }),
    );
    expect(() => advanceEpoch(initial, '-1', '0')).toThrowError(
      expect.objectContaining({ code: 'INVALID_REWARD' }),
    );
    expect(() => advanceEpoch(initial, '0', '1000000001')).toThrowError(
      expect.objectContaining({ code: 'INVALID_REWARD' }),
    );
  });

  it.each(['0', '-1', '+1', '01', '1e6', '1.1', ' 1 ', '1000000000001'])(
    'rejects noncanonical or unsupported action amount %s',
    (amount) => {
      expect(() => supply(createLendingState(), amount)).toThrowError(
        expect.objectContaining({ code: 'INVALID_AMOUNT' }),
      );
    },
  );
});

describe('durable preview ledger validation', () => {
  it('round-trips the full ledger after its activity history is truncated', () => {
    let state = borrow(
      depositCollateral(
        supply(createLendingState(), '1000000000'),
        'first',
        limits,
      ),
      '100000000',
      limits,
    );
    for (let index = 0; index < 125; index++)
      state = advanceEpoch(state, '0', '0');
    expect(state.activity).toHaveLength(100);
    expect(state.debtMicros).toBe('100000000');
    expect(state.shareBalanceRaw).toBe('1000000000');
    expect(state.collateralIds).toEqual(['first']);
    expect(parseLendingState(JSON.stringify(state), limits)).toEqual(state);
    expectInvariants(state);
  });

  it('rejects corrupt, oversized, unsupported or inconsistent saved state', () => {
    const initial = createLendingState();
    const invalid = [
      '{broken',
      JSON.stringify({ ...initial, walletMicros: '01' }),
      JSON.stringify({ ...initial, walletMicros: 25_000_000_000 }),
      JSON.stringify({ ...initial, walletMicros: '1000000000001' }),
      JSON.stringify({
        ...initial,
        debtMicros: '1',
        poolOutstandingMicros: '80000000001',
      }),
      JSON.stringify({ ...initial, debtMicros: '1' }),
      JSON.stringify({ ...initial, shareBalanceRaw: '1' }),
      JSON.stringify({ ...initial, collateralIds: ['unknown'] }),
      JSON.stringify({ ...initial, collateralIds: ['first', 'first'] }),
      JSON.stringify({ ...initial, epoch: 10_001 }),
      JSON.stringify({ ...initial, epoch: 0.5 }),
      JSON.stringify({ ...initial, padding: 'a'.repeat(200_000) }),
    ];
    for (const raw of invalid)
      expect(parseLendingState(raw, limits)).toEqual(initial);
    const unsupportedDebt = borrow(
      depositCollateral(initial, 'first', limits),
      '2000000000',
      limits,
    );
    expect(
      parseLendingState(JSON.stringify(unsupportedDebt), {
        first: '1999999999',
      }),
    ).toEqual(initial);
    const badActivity = supply(initial, '1000000');
    badActivity.activity[0]!.rewardRepaidMicros = '-1';
    expect(parseLendingState(JSON.stringify(badActivity), limits)).toEqual(
      initial,
    );
  });

  it('bounds epoch simulation and refuses actions that exceed supported balances', () => {
    const maximumEpoch = { ...createLendingState(), epoch: 10_000 };
    expect(() => advanceEpoch(maximumEpoch, '0', '0')).toThrowError(
      expect.objectContaining({ code: 'STATE_LIMIT' }),
    );
    const maximumAssets = {
      ...createLendingState(),
      poolCashMicros: '920000000000',
    };
    expect(() => advanceEpoch(maximumAssets, '0', '1')).toThrowError(
      expect.objectContaining({ code: 'STATE_LIMIT' }),
    );
  });
});
