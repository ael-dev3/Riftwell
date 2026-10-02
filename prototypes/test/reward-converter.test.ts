import { errorInfo } from '../scripts/boundaries.ts';
import type { TestContext } from 'node:test';
import type {
  BaseContract,
  BigNumberish,
  ContractTransactionResponse,
} from 'ethers';
import type { RiftwellLoanVault } from './contracts.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ContractFactory,
  ZeroAddress,
  parseUnits,
  solidityPacked,
} from 'ethers';
import {
  createTestContext,
  deploy,
  compileContracts,
  sent,
  attachContract,
  latestBlock,
} from './helpers.ts';

const units = (n: string | number | bigint) => parseUnits(String(n), 18);
const usd = (n: string | number | bigint) => parseUnits(String(n), 6);

async function fixture(t: TestContext) {
  const c = await createTestContext();
  t.after(() => c.close());
  const [admin, caller, outsider] = c.signers;
  const [adminAddress, callerAddress, outsiderAddress] = c.addresses;
  const whype = await deploy('ConverterTestToken', admin, ['WHYPE', 18]);
  const kitten = await deploy('ConverterTestToken', admin, ['KITTEN', 18]);
  const usdc = await deploy('ConverterTestToken', admin, ['USDC', 6]);
  const plugin = await deploy('ConverterTestPlugin', admin);
  const factory = await deploy('ConverterTestFactory', admin, [adminAddress]);
  const whypePool = await deploy('ConverterTestPool', admin, [
    factory.target,
    whype.target,
    usdc.target,
    plugin.target,
  ]);
  const kittenPool = await deploy('ConverterTestPool', admin, [
    factory.target,
    kitten.target,
    whype.target,
    plugin.target,
  ]);
  await sent(factory.setPool(whype.target, usdc.target, whypePool.target));
  await sent(factory.setPool(kitten.target, whype.target, kittenPool.target));
  const router = await deploy('ConverterTestRouter', admin, [
    factory.target,
    adminAddress,
    whype.target,
  ]);
  const configuration = {
    router: router.target,
    factory: factory.target,
    whype: whype.target,
    kitten: kitten.target,
    usdc: usdc.target,
    whypeUSDCPool: whypePool.target,
    kittenWHYPEPool: kittenPool.target,
    maxWHYPEInput: units(100),
    maxKITTENInput: units(1000),
  };
  const converter = await deploy('RiftwellKittenRewardConverter', admin, [
    configuration,
  ]);
  for (const [token, amount] of [
    [whype, units(100)],
    [kitten, units(1000)],
  ] as const) {
    await sent(token.mint(callerAddress, amount));
    await sent(token.connect(caller).approve(converter.target, amount));
  }
  await sent(usdc.mint(router.target, usd(10000)));
  await sent(router.setSwap(10000, usd(12), usd(12)));
  const now = Number((await latestBlock(c.provider)).timestamp);
  return {
    ...c,
    admin,
    caller,
    outsider,
    adminAddress,
    callerAddress,
    outsiderAddress,
    whype,
    kitten,
    usdc,
    plugin,
    factory,
    whypePool,
    kittenPool,
    router,
    converter,
    configuration,
    now,
    deadline: now + 300,
  };
}

async function expectError(
  contract: Pick<BaseContract, 'interface'>,
  operation: () => Promise<unknown>,
  expectedName: string,
) {
  let caught;
  try {
    await operation();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, `Expected ${expectedName}`);
  const data = errorInfo(caught).data;
  assert.ok(data, 'Expected EVM revert data');
  assert.equal(contract.interface.parseError(data)?.name, expectedName);
}

type Fixture = Awaited<ReturnType<typeof fixture>>;
async function balances(f: Fixture, token = f.whype) {
  return {
    callerInput: await token.balanceOf(f.callerAddress),
    converterInput: await token.balanceOf(f.converter.target),
    routerInput: await token.balanceOf(f.router.target),
    callerOutput: await f.usdc.balanceOf(f.callerAddress),
    converterOutput: await f.usdc.balanceOf(f.converter.target),
    routerOutput: await f.usdc.balanceOf(f.router.target),
    callerAllowance: await token.allowance(f.callerAddress, f.converter.target),
    routerAllowance: await token.allowance(f.converter.target, f.router.target),
    routerCalls: await f.router.calls(),
  };
}

async function assertAtomicRejection(
  f: Fixture,
  expectedName: string,
  token = f.whype,
  minimum = usd(10),
) {
  const args = [token.target, units(2), minimum, f.deadline] as const;
  const before = await balances(f, token);
  await expectError(
    f.converter,
    () => f.converter.connect(f.caller).convert.staticCall(...args),
    expectedName,
  );
  await assert.rejects(
    async () =>
      sent(
        f.converter.connect(f.caller).convert(...args, { gasLimit: 1500000 }),
      ),
    (error) => errorInfo(error).code === 'CALL_EXCEPTION',
  );
  assert.deepEqual(
    await balances(f, token),
    before,
    'A failed swap must roll back collection, allowances, router effects and payout',
  );
}

test('WHYPE conversion returns measured USDC, preserves donations and binds the exact single-hop instruction', async (t) => {
  const f = await fixture(t);
  await sent(f.whype.mint(f.converter.target, units(3)));
  await sent(f.usdc.mint(f.converter.target, usd(17)));
  assert.equal(
    await f.converter
      .connect(f.caller)
      .convert.staticCall(f.whype.target, units(2), usd(10), f.deadline),
    usd(12),
  );
  const receipt = await sent(
    f.converter
      .connect(f.caller)
      .convert(f.whype.target, units(2), usd(10), f.deadline),
  );
  assert.equal(await f.whype.balanceOf(f.callerAddress), units(98));
  assert.equal(await f.whype.balanceOf(f.converter.target), units(3));
  assert.equal(await f.whype.balanceOf(f.router.target), units(2));
  assert.equal(await f.usdc.balanceOf(f.callerAddress), usd(12));
  assert.equal(await f.usdc.balanceOf(f.converter.target), usd(17));
  assert.equal(await f.usdc.balanceOf(f.outsiderAddress), 0n);
  assert.equal(
    await f.whype.allowance(f.converter.target, f.router.target),
    0n,
  );
  assert.equal(await f.router.allowanceAtSwap(), units(2));
  assert.equal(await f.router.usedMultihop(), false);
  assert.equal(await f.router.lastTokenIn(), f.whype.target);
  assert.equal(await f.router.lastTokenOut(), f.usdc.target);
  assert.equal(await f.router.lastRecipient(), f.converter.target);
  assert.equal(await f.router.lastDeployer(), ZeroAddress);
  assert.equal(await f.router.lastLimit(), 0n);
  assert.equal(await f.router.lastAmount(), units(2));
  assert.equal(await f.router.lastMinimum(), usd(10));
  assert.equal(await f.router.lastDeadline(), BigInt(f.deadline));
  const event = receipt.logs
    .map((log) => {
      try {
        return f.converter.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find((log) => log?.name === 'Converted');
  assert.ok(event);
  assert.ok(event);
  assert.equal(event.args.caller, f.callerAddress);
  assert.equal(event.args.inputToken, f.whype.target);
  assert.equal(event.args.inputAmount, units(2));
  assert.equal(event.args.outputAmount, usd(12));
  assert.equal(event.args.minimumOutput, usd(10));
});

test('KITTEN follows only the fixed two-hop path and has no lasting router or intermediate-token allowance', async (t) => {
  const f = await fixture(t);
  await sent(f.kitten.mint(f.converter.target, units(4)));
  await sent(
    f.converter
      .connect(f.caller)
      .convert(f.kitten.target, units(20), usd(12), f.deadline),
  );
  assert.equal(await f.router.usedMultihop(), true);
  assert.equal(
    await f.router.lastPath(),
    solidityPacked(
      ['address', 'address', 'address', 'address', 'address'],
      [
        f.kitten.target,
        ZeroAddress,
        f.whype.target,
        ZeroAddress,
        f.usdc.target,
      ],
    ),
  );
  assert.equal(await f.router.lastRecipient(), f.converter.target);
  assert.equal(await f.router.lastMinimum(), usd(12));
  assert.equal(await f.router.lastAmount(), units(20));
  assert.equal(await f.router.allowanceAtSwap(), units(20));
  assert.equal(await f.kitten.balanceOf(f.callerAddress), units(980));
  assert.equal(await f.kitten.balanceOf(f.converter.target), units(4));
  assert.equal(await f.usdc.balanceOf(f.callerAddress), usd(12));
  for (const token of [f.kitten, f.whype, f.usdc])
    assert.equal(
      await token.allowance(f.converter.target, f.router.target),
      0n,
    );
});

test('unknown inputs, zero amounts/floors, excessive amounts and deadlines outside the five-minute window fail before collection', async (t) => {
  const f = await fixture(t);
  const before = await balances(f);
  const cases = [
    [f.usdc.target, units(2), usd(10), f.deadline],
    [f.outsiderAddress, units(2), usd(10), f.deadline],
    [f.whype.target, 0n, usd(10), f.deadline],
    [f.whype.target, units(100) + 1n, usd(10), f.deadline],
    [f.kitten.target, units(1000) + 1n, usd(10), f.deadline],
    [f.whype.target, units(2), 0n, f.deadline],
    [f.whype.target, units(2), usd(10), f.now - 1],
    [f.whype.target, units(2), usd(10), f.now + 301],
  ] as const;
  for (const [token, input, minimum, expiry] of cases)
    await expectError(
      f.converter,
      () =>
        f.converter
          .connect(f.caller)
          .convert.staticCall(token, input, minimum, expiry),
      'InvalidInstruction',
    );
  assert.deepEqual(await balances(f), before);
  // Both deadline boundaries and the exact input cap are permitted.
  assert.equal(
    await f.converter
      .connect(f.caller)
      .convert.staticCall(f.whype.target, units(100), usd(12), f.now),
    usd(12),
  );
  await sent(
    f.converter
      .connect(f.caller)
      .convert(f.whype.target, units(100), usd(12), f.now + 300),
  );
  assert.equal(await f.whype.balanceOf(f.callerAddress), 0n);
});

test('the converter enforces the caller minimum even when the router disregards it', async (t) => {
  const f = await fixture(t);
  await sent(f.router.setSwap(10000, usd(8), usd(8)));
  await assertAtomicRejection(f, 'InexactSwap');
});

test('router return values must equal new USDC; existing donations cannot cover an inflated result', async (t) => {
  const f = await fixture(t);
  await sent(f.usdc.mint(f.converter.target, usd(17)));
  for (const [delivered, reported] of [
    [8, 12],
    [12, 10],
    [0, 12],
  ] as const) {
    await sent(f.router.setSwap(10000, usd(delivered), usd(reported)));
    await assertAtomicRejection(f, 'InexactSwap');
  }
});

test('partial input consumption is rejected atomically, including when prior input donations exist', async (t) => {
  const f = await fixture(t);
  await sent(f.whype.mint(f.converter.target, units(3)));
  await sent(f.usdc.mint(f.converter.target, usd(17)));
  for (const spend of [0, 9000]) {
    await sent(f.router.setSwap(spend, usd(12), usd(12)));
    await assertAtomicRejection(f, 'InexactSwap');
  }
});

test('conversion debits and pays only its caller; a different account cannot use another account approval', async (t) => {
  const f = await fixture(t);
  const before = await balances(f);
  await expectError(
    f.whype,
    () =>
      f.converter
        .connect(f.outsider)
        .convert.staticCall(f.whype.target, units(2), usd(10), f.deadline),
    'ERC20InsufficientAllowance',
  );
  await sent(f.whype.mint(f.outsiderAddress, units(4)));
  await expectError(
    f.whype,
    () =>
      f.converter
        .connect(f.outsider)
        .convert.staticCall(f.whype.target, units(2), usd(10), f.deadline),
    'ERC20InsufficientAllowance',
  );
  await sent(f.whype.connect(f.outsider).approve(f.converter.target, units(4)));
  await sent(
    f.converter
      .connect(f.outsider)
      .convert(f.whype.target, units(2), usd(10), f.deadline),
  );
  assert.equal(await f.whype.balanceOf(f.callerAddress), before.callerInput);
  assert.equal(
    await f.whype.allowance(f.callerAddress, f.converter.target),
    before.callerAllowance,
  );
  assert.equal(await f.usdc.balanceOf(f.callerAddress), before.callerOutput);
  assert.equal(await f.whype.balanceOf(f.outsiderAddress), units(2));
  assert.equal(await f.usdc.balanceOf(f.outsiderAddress), usd(12));
});

test('incoming taxed input and taxed USDC delivery/payout each roll back the complete conversion', async (t) => {
  const f = await fixture(t);
  await sent(f.whype.setTax(true, f.callerAddress));
  await assertAtomicRejection(f, 'InexactTransfer');
  await sent(f.whype.setTax(false, ZeroAddress));
  await sent(f.usdc.setTax(true, f.router.target));
  await assertAtomicRejection(f, 'InexactSwap');
  await sent(f.usdc.setTax(true, f.converter.target));
  await assertAtomicRejection(f, 'InexactTransfer');
});

test('false-return collection, approval and USDC payout cannot leave custody or router approvals behind', async (t) => {
  const f = await fixture(t);
  await sent(f.whype.setFailures(true, false, ZeroAddress, 0));
  await assertAtomicRejection(f, 'SafeERC20FailedOperation');
  await sent(f.whype.setFailures(false, false, ZeroAddress, 1));
  await assertAtomicRejection(f, 'SafeERC20FailedOperation');
  await sent(f.whype.setFailures(false, false, ZeroAddress, 0));
  await sent(f.usdc.setFailures(false, true, f.converter.target, 0));
  await assertAtomicRejection(f, 'SafeERC20FailedOperation');
});

test('allowances are explicitly cleared even if transferFrom preserves them, and dishonest approval/clear operations fail', async (t) => {
  const f = await fixture(t);
  await sent(f.whype.setPreserveAllowance(true));
  await sent(
    f.converter
      .connect(f.caller)
      .convert(f.whype.target, units(2), usd(10), f.deadline),
  );
  assert.equal(await f.router.allowanceAtSwap(), units(2));
  assert.equal(
    await f.whype.allowance(f.converter.target, f.router.target),
    0n,
  );
  for (const [mode, error] of [
    [2, 'InexactTransfer'],
    [3, 'SafeERC20FailedOperation'],
    [4, 'InexactTransfer'],
  ] as const) {
    await sent(f.whype.setFailures(false, false, ZeroAddress, mode));
    await assertAtomicRejection(f, error);
  }
  await sent(f.whype.setFailures(false, false, ZeroAddress, 0));
  await sent(
    f.converter
      .connect(f.caller)
      .convert(f.whype.target, units(2), usd(10), f.deadline),
  );
  assert.equal(
    await f.whype.allowance(f.converter.target, f.router.target),
    0n,
  );
});

test('registry, pool identity and plugin changes fail before authorizing or collecting caller funds', async (t) => {
  const f = await fixture(t);
  const mutations = [
    () =>
      sent(
        f.router.setRegistry(f.outsiderAddress, f.adminAddress, f.whype.target),
      ),
    () =>
      sent(
        f.router.setRegistry(
          f.factory.target,
          f.outsiderAddress,
          f.whype.target,
        ),
      ),
    () =>
      sent(
        f.router.setRegistry(f.factory.target, f.adminAddress, f.kitten.target),
      ),
    () => sent(f.factory.setPoolDeployer(f.outsiderAddress)),
    () =>
      sent(
        f.factory.setPool(f.whype.target, f.usdc.target, f.kittenPool.target),
      ),
    () =>
      sent(
        f.factory.setPool(f.kitten.target, f.whype.target, f.whypePool.target),
      ),
    () =>
      sent(
        f.whypePool.setIdentity(
          f.outsiderAddress,
          f.whype.target,
          f.usdc.target,
        ),
      ),
    () =>
      sent(
        f.kittenPool.setIdentity(
          f.factory.target,
          f.usdc.target,
          f.whype.target,
        ),
      ),
    () => sent(f.whypePool.setPlugin(f.outsiderAddress)),
    () => sent(f.kittenPool.setPlugin(f.outsiderAddress)),
  ];
  const before = await balances(f);
  for (const mutate of mutations) {
    const snapshot = await f.provider.send('evm_snapshot', []);
    await mutate();
    await expectError(
      f.converter,
      () =>
        f.converter
          .connect(f.caller)
          .convert.staticCall(f.whype.target, units(2), usd(10), f.deadline),
      'DependencyChanged',
    );
    assert.deepEqual(await balances(f), before);
    assert.equal(await f.provider.send('evm_revert', [snapshot]), true);
  }
});

test('replacement router, factory, pool or plugin bytecode is rejected against pinned hashes', async (t) => {
  const f = await fixture(t);
  const before = await balances(f);
  for (const dependency of [
    f.router,
    f.factory,
    f.whypePool,
    f.kittenPool,
    f.plugin,
  ]) {
    const snapshot = await f.provider.send('evm_snapshot', []);
    await f.provider.send('evm_setAccountCode', [dependency.target, '0x00']);
    await expectError(
      f.converter,
      () =>
        f.converter
          .connect(f.caller)
          .convert.staticCall(f.whype.target, units(2), usd(10), f.deadline),
      'DependencyChanged',
    );
    assert.equal(await f.provider.send('evm_revert', [snapshot]), true);
    assert.deepEqual(await balances(f), before);
  }
});

test('WHYPE requires its USDC pool liquidity and KITTEN additionally requires its intermediate pool liquidity', async (t) => {
  const f = await fixture(t);
  await sent(f.whypePool.setLiquidity(0));
  for (const token of [f.whype, f.kitten])
    await assertAtomicRejection(f, 'EmptyLiquidity', token);
  await sent(f.whypePool.setLiquidity(1));
  await sent(f.kittenPool.setLiquidity(0));
  await assertAtomicRejection(f, 'EmptyLiquidity', f.kitten);
  await sent(
    f.converter
      .connect(f.caller)
      .convert(f.whype.target, units(2), usd(10), f.deadline),
  );
  assert.equal(await f.usdc.balanceOf(f.callerAddress), usd(12));
});

test('constructor rejects absent code, zero caps, wrong decimals, duplicate tokens/pools and registry/plugin mismatches', async (t) => {
  const f = await fixture(t);
  const badDecimals = await deploy('ConverterTestToken', f.admin, ['BAD', 8]);
  const artifact = compileContracts().RiftwellKittenRewardConverter;
  const factory = new ContractFactory(artifact.abi, artifact.bytecode, f.admin);
  const check = async (
    changes: Partial<typeof f.configuration>,
    error = 'InvalidConfiguration',
  ) => {
    const transaction = await factory.getDeployTransaction({
      ...f.configuration,
      ...changes,
    });
    await expectError(
      f.converter,
      () => f.provider.call({ ...transaction, from: f.adminAddress }),
      error,
    );
  };
  for (const field of [
    'router',
    'factory',
    'whype',
    'kitten',
    'usdc',
    'whypeUSDCPool',
    'kittenWHYPEPool',
  ])
    await check({ [field]: f.outsiderAddress });
  for (const field of ['maxWHYPEInput', 'maxKITTENInput'])
    await check({ [field]: 0n });
  for (const field of ['whype', 'kitten', 'usdc'])
    await check({ [field]: badDecimals.target });
  await check({ whype: f.kitten.target });
  await check({ whype: f.usdc.target });
  await check({ kitten: f.usdc.target });
  await check({ kittenWHYPEPool: f.whypePool.target });
  await sent(
    f.factory.setPool(f.whype.target, f.usdc.target, f.kittenPool.target),
  );
  await check({}, 'DependencyChanged');
  await sent(
    f.factory.setPool(f.whype.target, f.usdc.target, f.whypePool.target),
  );
  await sent(f.whypePool.setPlugin(f.outsiderAddress));
  await check({});
});

test('collection, router and USDC payout callbacks cannot reenter while the outer conversion settles exactly', async (t) => {
  const f = await fixture(t);
  const data = f.converter.interface.encodeFunctionData('convert', [
    f.whype.target,
    units(1),
    usd(1),
    f.deadline,
  ]);
  await sent(f.whype.setCallback(f.callerAddress, f.converter.target, data));
  await sent(f.router.setCallback(f.converter.target, data));
  await sent(f.usdc.setCallback(f.converter.target, f.converter.target, data));
  await sent(
    f.converter
      .connect(f.caller)
      .convert(f.whype.target, units(2), usd(10), f.deadline),
  );
  for (const dependency of [f.whype, f.router, f.usdc]) {
    assert.equal(await dependency.callbackSucceeded(), false);
    assert.equal(
      f.converter.interface.parseError(await dependency.callbackReturnData())
        ?.name,
      'ReentrancyGuardReentrantCall',
    );
  }
  assert.equal(await f.router.calls(), 1n);
  assert.equal(await f.whype.balanceOf(f.callerAddress), units(98));
  assert.equal(await f.usdc.balanceOf(f.callerAddress), usd(12));
  assert.equal(await f.whype.balanceOf(f.converter.target), 0n);
  assert.equal(await f.usdc.balanceOf(f.converter.target), 0n);
  assert.equal(
    await f.whype.allowance(f.converter.target, f.router.target),
    0n,
  );
  await sent(
    f.converter
      .connect(f.caller)
      .convert(f.whype.target, units(2), usd(10), f.deadline),
  );
  assert.equal(await f.router.calls(), 2n);
  assert.equal(await f.usdc.balanceOf(f.callerAddress), usd(24));
});
