import { describe, expect, it } from 'vitest';
import {
  LendingError,
  advanceEpoch,
  borrow,
  createLendingState,
  DEMO_TOKEN_UNITS,
  depositCollateral,
  depositToRelayer,
  getLendingMetrics,
  increaseLock,
  mergePositions,
  parseLendingState,
  purchase,
  purchaseIntoCollateral,
  purchaseIntoRelayer,
  redeem,
  removeCollateral,
  repay,
  setRelayerRepayShare,
  supply,
  withdraw,
  withdrawFromRelayer,
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
    badActivity.activity[0].rewardRepaidMicros = '-1';
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

describe('marketplace purchases in the preview ledger', () => {
  it('pays the full ask from the wallet and books only the seller fee as platform revenue', () => {
    const before = createLendingState();
    const state = purchase(before, 'listed', '3100000000');
    expect(state.walletMicros).toBe('21900000000');
    expect(state.platformFeesMicros).toBe('15500000');
    expect(state.debtMicros).toBe('0');
    expect(state.poolCashMicros).toBe(before.poolCashMicros);
    expect(state.activity.at(-1)).toMatchObject({
      kind: 'purchase',
      amountMicros: '3100000000',
      feeMicros: '15500000',
      collateralId: 'listed',
    });
    // The seller's net proceeds leave the preview; nothing else moves.
    expect(cash(before) - cash(state)).toBe(3_084_500_000n);
    expectInvariants(state);
  });

  it('floors the seller fee at the micro boundary', () => {
    const state = purchase(createLendingState(), 'listed', '1000199');
    expect(state.platformFeesMicros).toBe('5000');
    expect(state.walletMicros).toBe('24998999801');
  });

  it('rejects purchases beyond the wallet, invalid amounts and missing positions', () => {
    const state = createLendingState();
    expect(() => purchase(state, 'listed', '25000000001')).toThrowError(
      expect.objectContaining({ code: 'INSUFFICIENT_WALLET' }),
    );
    for (const amount of ['0', '-1', '1.5', '1e6', ''])
      expect(() => purchase(state, 'listed', amount)).toThrowError(
        expect.objectContaining({ code: 'INVALID_AMOUNT' }),
      );
    expect(() => purchase(state, '', '1000000')).toThrowError(
      expect.objectContaining({ code: 'INVALID_POSITION' }),
    );
    expect(() => purchase(state, 'x'.repeat(101), '1000000')).toThrowError(
      expect.objectContaining({ code: 'INVALID_POSITION' }),
    );
  });

  it('buys into collateral by depositing, borrowing against it, then paying', () => {
    const before = createLendingState();
    const state = purchaseIntoCollateral(
      before,
      'first',
      '3100000000',
      '1600000000',
      limits,
    );
    expect(state.collateralIds).toEqual(['first']);
    expect(state.debtMicros).toBe('1600000000');
    // 25,000 + 1,600 - 8 origination fee - 3,100 purchase
    expect(state.walletMicros).toBe('23492000000');
    expect(state.platformFeesMicros).toBe('23500000');
    expect(state.activity.map((entry) => entry.kind)).toEqual([
      'deposit-collateral',
      'borrow',
      'purchase',
    ]);
    expectInvariants(state);
    expect(parseLendingState(JSON.stringify(state), limits)).toEqual(state);
  });

  it('allows buying into collateral without borrowing', () => {
    const state = purchaseIntoCollateral(
      createLendingState(),
      'second',
      '6800000000',
      '0',
      limits,
    );
    expect(state.debtMicros).toBe('0');
    expect(state.collateralIds).toEqual(['second']);
    expect(state.walletMicros).toBe('18200000000');
  });

  it('commits nothing when any step of a credit purchase fails', () => {
    const poor = { ...createLendingState(), walletMicros: '1000000000' };
    expect(() =>
      purchaseIntoCollateral(poor, 'first', '3100000000', '1600000000', limits),
    ).toThrowError(expect.objectContaining({ code: 'INSUFFICIENT_WALLET' }));
    expect(() =>
      purchaseIntoCollateral(
        createLendingState(),
        'first',
        '3100000000',
        '2000000001',
        limits,
      ),
    ).toThrowError(expect.objectContaining({ code: 'INSUFFICIENT_CREDIT' }));
    expect(() =>
      purchaseIntoCollateral(
        createLendingState(),
        'unknown',
        '3100000000',
        '0',
        limits,
      ),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_COLLATERAL' }));
    expect(() =>
      purchaseIntoCollateral(
        createLendingState(),
        'first',
        '3100000000',
        'abc',
        limits,
      ),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_AMOUNT' }));
    const deposited = depositCollateral(createLendingState(), 'first', limits);
    expect(() =>
      purchaseIntoCollateral(deposited, 'first', '3100000000', '0', limits),
    ).toThrowError(
      expect.objectContaining({ code: 'COLLATERAL_ALREADY_DEPOSITED' }),
    );
  });

  it('round-trips purchase activity through saved state', () => {
    const state = purchase(createLendingState(), 'listed', '180000000');
    expect(parseLendingState(JSON.stringify(state), limits)).toEqual(state);
  });
});

describe('relayer positions in the preview ledger', () => {
  it('collects net rewards for relayer positions without credit or debt', () => {
    const start = createLendingState();
    const relayed = depositToRelayer(start, 'first', limits);
    expect(relayed.relayerIds).toEqual(['first']);
    expect(relayed.activity.at(-1)).toMatchObject({
      kind: 'relayer-deposit',
      collateralId: 'first',
    });
    expect(getLendingMetrics(relayed, limits).totalCreditMicros).toBe('0');
    expect(() => borrow(relayed, '1000000', limits)).toThrowError(
      expect.objectContaining({ code: 'INSUFFICIENT_CREDIT' }),
    );
    const paid = advanceEpoch(relayed, '0', '0', '40000000');
    expect(units(paid, 'walletMicros') - units(relayed, 'walletMicros')).toBe(
      40_000_000n,
    );
    expect(paid.activity.at(-1)).toMatchObject({
      kind: 'epoch',
      relayerRewardMicros: '40000000',
      rewardRepaidMicros: '0',
    });
    expect(paid.debtMicros).toBe('0');
    expectInvariants(paid);
  });

  it('keeps relayer and collateral positions apart', () => {
    const relayed = depositToRelayer(createLendingState(), 'first', limits);
    expect(() => depositCollateral(relayed, 'first', limits)).toThrowError(
      expect.objectContaining({ code: 'IN_RELAYER' }),
    );
    expect(() => depositToRelayer(relayed, 'first', limits)).toThrowError(
      expect.objectContaining({ code: 'ALREADY_IN_RELAYER' }),
    );
    const collateral = depositCollateral(
      createLendingState(),
      'second',
      limits,
    );
    expect(() => depositToRelayer(collateral, 'second', limits)).toThrowError(
      expect.objectContaining({ code: 'COLLATERAL_DEPOSITED' }),
    );
    expect(() =>
      depositToRelayer(createLendingState(), 'unknown', limits),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_COLLATERAL' }));
    expect(() =>
      withdrawFromRelayer(createLendingState(), 'first'),
    ).toThrowError(expect.objectContaining({ code: 'NOT_IN_RELAYER' }));
    const released = withdrawFromRelayer(relayed, 'first');
    expect(released.relayerIds).toEqual([]);
    expect(released.activity.at(-1)?.kind).toBe('relayer-withdraw');
    expect(depositCollateral(released, 'first', limits).collateralIds).toEqual([
      'first',
    ]);
  });

  it('pays relayer rewards only while positions are in the relayer', () => {
    const state = advanceEpoch(createLendingState(), '0', '0', '40000000');
    expect(state.walletMicros).toBe(createLendingState().walletMicros);
    expect(state.activity.at(-1)?.relayerRewardMicros).toBe('0');
    expect(() =>
      advanceEpoch(
        depositToRelayer(createLendingState(), 'first', limits),
        '0',
        '0',
        '1000000001',
      ),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_REWARD' }));
  });

  it('buys straight into the relayer and pays the seller from the wallet', () => {
    const start = createLendingState();
    const bought = purchaseIntoRelayer(start, 'third', '3100000000', limits);
    expect(bought.relayerIds).toEqual(['third']);
    expect(bought.collateralIds).toEqual([]);
    expect(bought.activity.slice(-2).map((entry) => entry.kind)).toEqual([
      'relayer-deposit',
      'purchase',
    ]);
    expect(units(start, 'walletMicros') - units(bought, 'walletMicros')).toBe(
      3_100_000_000n,
    );
    expect(() =>
      purchaseIntoRelayer(start, 'third', '25000000001', limits),
    ).toThrowError(expect.objectContaining({ code: 'INSUFFICIENT_WALLET' }));
  });

  it('upgrades previews saved before the relayer existed and rejects overlaps', () => {
    const saved = advanceEpoch(
      depositCollateral(createLendingState(), 'first', limits),
      '10000000',
      '0',
    );
    const legacy = JSON.parse(JSON.stringify(saved));
    delete legacy.relayerIds;
    for (const entry of legacy.activity) delete entry.relayerRewardMicros;
    expect(parseLendingState(JSON.stringify(legacy), limits)).toEqual(saved);
    const overlapping = { ...saved, relayerIds: ['first'] };
    expect(parseLendingState(JSON.stringify(overlapping), limits)).toEqual(
      createLendingState(),
    );
    const relayed = depositToRelayer(createLendingState(), 'second', limits);
    expect(parseLendingState(JSON.stringify(relayed), limits)).toEqual(relayed);
  });
});

describe('merges and lock increases in the preview ledger', () => {
  // Credit grows with merged positions and added units: one unit adds one
  // micro of credit here, so the limits stay easy to read.
  const grown = (state: LendingState) =>
    Object.fromEntries(
      Object.entries(limits).map(([id, limit]) => {
        let total = BigInt(limit) + BigInt(state.lockIncreases[id] ?? '0');
        for (const [source, target] of Object.entries(state.mergedInto))
          if (target === id) total += BigInt(limits[source as 'first']);
        return [id, total.toString()];
      }),
    );

  it('merges a wallet position into collateral without changing debt', () => {
    let state = depositCollateral(createLendingState(), 'first', limits);
    state = borrow(state, '1000000000', limits);
    const merged = mergePositions(state, 'second', 'first', grown(state));
    expect(merged.mergedInto).toEqual({ second: 'first' });
    expect(merged.collateralIds).toEqual(['first']);
    expect(merged.debtMicros).toBe(state.debtMicros);
    expect(merged.walletMicros).toBe(state.walletMicros);
    expect(merged.activity.at(-1)).toMatchObject({
      kind: 'merge',
      collateralId: 'first',
      mergedId: 'second',
      amountMicros: '0',
    });
    expect(getLendingMetrics(merged, grown(merged)).totalCreditMicros).toBe(
      '5200000000',
    );
    expectInvariants(merged);
  });

  it('only merges an idle wallet position into deposited collateral', () => {
    const start = depositCollateral(createLendingState(), 'first', limits);
    const code = (run: () => unknown) => {
      try {
        run();
      } catch (error) {
        return error instanceof LendingError ? error.code : 'OTHER';
      }
      return 'NONE';
    };
    expect(code(() => mergePositions(start, 'first', 'second', limits))).toBe(
      'NOT_COLLATERAL',
    );
    expect(code(() => mergePositions(start, 'first', 'first', limits))).toBe(
      'SAME_POSITION',
    );
    expect(code(() => mergePositions(start, 'unknown', 'first', limits))).toBe(
      'INVALID_COLLATERAL',
    );
    const relayed = depositToRelayer(start, 'second', limits);
    expect(code(() => mergePositions(relayed, 'second', 'first', limits))).toBe(
      'NOT_IN_WALLET',
    );
    const merged = mergePositions(start, 'second', 'first', limits);
    expect(code(() => mergePositions(merged, 'second', 'first', limits))).toBe(
      'MERGED',
    );
    expect(code(() => depositCollateral(merged, 'second', limits))).toBe(
      'MERGED',
    );
    expect(code(() => depositToRelayer(merged, 'second', limits))).toBe(
      'MERGED',
    );
  });

  it('locks demo tokens into deposited collateral and conserves them', () => {
    let state = depositCollateral(createLendingState(), 'first', limits);
    expect(state.tokenUnits).toBe(DEMO_TOKEN_UNITS);
    state = increaseLock(state, 'first', '5000', limits);
    expect(state.tokenUnits).toBe('15000');
    expect(state.lockIncreases).toEqual({ first: '5000' });
    expect(state.activity.at(-1)).toMatchObject({
      kind: 'increase-lock',
      collateralId: 'first',
      lockUnits: '5000',
    });
    state = increaseLock(state, 'first', '15000', limits);
    expect(state.tokenUnits).toBe('0');
    expect(state.lockIncreases).toEqual({ first: '20000' });
    expect(() => increaseLock(state, 'first', '1', limits)).toThrowError(
      expect.objectContaining({ code: 'INSUFFICIENT_TOKENS' }),
    );
    const fresh = depositCollateral(createLendingState(), 'first', limits);
    for (const bad of ['0', '1.5', '-1', '20001', ''])
      expect(() => increaseLock(fresh, 'first', bad, limits)).toThrowError(
        expect.objectContaining({ code: 'INVALID_UNITS' }),
      );
    expect(() => increaseLock(fresh, 'second', '1', limits)).toThrowError(
      expect.objectContaining({ code: 'NOT_COLLATERAL' }),
    );
  });

  it('restores merged credit with limits derived from the saved state', () => {
    let state = depositCollateral(createLendingState(), 'first', limits);
    state = mergePositions(state, 'second', 'first', grown(state));
    state = increaseLock(state, 'first', '1000', grown(state));
    // More than the first position alone could support.
    state = borrow(state, '5000000000', grown(state));
    const saved = JSON.stringify(state);
    expect(parseLendingState(saved, grown)).toEqual(state);
    expect(parseLendingState(saved, limits)).toEqual(createLendingState());
    expect(() => removeCollateral(state, 'first', grown(state))).toThrowError(
      expect.objectContaining({ code: 'COLLATERAL_REQUIRED' }),
    );
  });

  it('rejects tampered token balances, merge cycles and merged collateral', () => {
    const base = depositCollateral(createLendingState(), 'first', limits);
    const saved = increaseLock(base, 'first', '400', limits);
    const restore = (value: object) =>
      parseLendingState(JSON.stringify(value), limits);
    expect(restore(saved)).toEqual(saved);
    expect(restore({ ...saved, tokenUnits: DEMO_TOKEN_UNITS })).toEqual(
      createLendingState(),
    );
    expect(restore({ ...saved, lockIncreases: { first: '0' } })).toEqual(
      createLendingState(),
    );
    expect(
      restore({ ...base, mergedInto: { second: 'third', third: 'second' } }),
    ).toEqual(createLendingState());
    expect(restore({ ...base, mergedInto: { first: 'second' } })).toEqual(
      createLendingState(),
    );
    expect(restore({ ...base, mergedInto: { second: 'second' } })).toEqual(
      createLendingState(),
    );
    const chained = {
      ...base,
      mergedInto: { second: 'third', third: 'first' },
    };
    expect(restore(chained)).toEqual(chained);
  });

  it('upgrades previews saved before merges and lock increases existed', () => {
    const saved = advanceEpoch(
      depositCollateral(createLendingState(), 'first', limits),
      '10000000',
      '0',
    );
    const legacy = JSON.parse(JSON.stringify(saved));
    delete legacy.tokenUnits;
    delete legacy.lockIncreases;
    delete legacy.mergedInto;
    for (const entry of legacy.activity) {
      delete entry.mergedId;
      delete entry.lockUnits;
    }
    expect(parseLendingState(JSON.stringify(legacy), limits)).toEqual(saved);
  });
});

describe('relayer reward strategy in the preview ledger', () => {
  it('routes the chosen share of relayer rewards to debt and pays out the rest', () => {
    let state = depositCollateral(createLendingState(), 'first', limits);
    state = borrow(state, '1000000000', limits);
    state = depositToRelayer(state, 'second', limits);
    const entries = state.activity.length;
    state = setRelayerRepayShare(state, 5_000);
    expect(state.relayerRepayBps).toBe(5_000);
    expect(state.activity).toHaveLength(entries);
    const before = state;
    // 10 USDC of collateral rewards repay first, then half of 40 USDC.
    state = advanceEpoch(state, '10000000', '0', '40000000');
    expect(state.debtMicros).toBe('970000000');
    expect(units(state, 'walletMicros') - units(before, 'walletMicros')).toBe(
      20_000_000n,
    );
    expect(
      units(state, 'poolCashMicros') - units(before, 'poolCashMicros'),
    ).toBe(30_000_000n);
    expect(state.activity.at(-1)).toMatchObject({
      rewardRepaidMicros: '10000000',
      relayerRewardMicros: '40000000',
      relayerRepaidMicros: '20000000',
    });
    expectInvariants(state);
    // Funds are conserved: only the 50 USDC of example rewards enter.
    const wealth = (value: LendingState) =>
      cash(value) +
      units(value, 'poolOutstandingMicros') -
      units(value, 'debtMicros');
    expect(wealth(state) - wealth(before)).toBe(50_000_000n);
  });

  it('never repays more than the remaining debt', () => {
    let state = depositCollateral(createLendingState(), 'first', limits);
    state = borrow(state, '1000000000', limits);
    state = repay(state, '999000000');
    state = setRelayerRepayShare(
      depositToRelayer(state, 'second', limits),
      10_000,
    );
    const before = state;
    state = advanceEpoch(state, '0', '0', '40000000');
    expect(state.debtMicros).toBe('0');
    expect(state.activity.at(-1)?.relayerRepaidMicros).toBe('1000000');
    expect(units(state, 'walletMicros') - units(before, 'walletMicros')).toBe(
      39_000_000n,
    );
    expectInvariants(state);
    for (const bad of [-1, 10_001, 0.5, Number.NaN])
      expect(() => setRelayerRepayShare(state, bad)).toThrowError(
        expect.objectContaining({ code: 'INVALID_SHARE' }),
      );
  });

  it('restores the strategy and rejects inconsistent relayer repayments', () => {
    const saved = setRelayerRepayShare(createLendingState(), 2_500);
    expect(parseLendingState(JSON.stringify(saved), limits)).toEqual(saved);
    expect(
      parseLendingState(
        JSON.stringify({ ...saved, relayerRepayBps: 10_001 }),
        limits,
      ),
    ).toEqual(createLendingState());
    const epoch = advanceEpoch(
      depositToRelayer(createLendingState(), 'second', limits),
      '0',
      '0',
      '5000000',
    );
    const tampered = JSON.parse(JSON.stringify(epoch));
    tampered.activity.at(-1).relayerRepaidMicros = '6000000';
    expect(parseLendingState(JSON.stringify(tampered), limits)).toEqual(
      createLendingState(),
    );
  });
});
