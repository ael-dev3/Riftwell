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
import { Contract } from 'ethers';
import {
  createTestContext,
  deploy,
  compileContracts,
  advanceTime,
  sent,
  attachContract,
  latestBlock,
} from './helpers.ts';

const UNIT = 1_000_000n;
const YEAR = 31_536_000n;
const day = 86400;
const tx = sent;
async function fixture(t: TestContext, claimsVerified = true) {
  const c = await createTestContext();
  t.after(() => c.close());
  const [admin, lender, borrower, outsider, keeper] = c.signers;
  const [
    treasury,
    lenderAddress,
    borrowerAddress,
    outsiderAddress,
    keeperAddress,
  ] = c.addresses;
  const nft = await deploy('LoanTestNFT', admin);
  const usdc = await deploy('MarketTestUSDC', admin);
  const voter = await deploy('LoanTestVoter', admin, [await nft.getAddress()]);
  const loans = await deploy('RiftwellLoans', admin, [
    await nft.getAddress(),
    await usdc.getAddress(),
    await voter.getAddress(),
    treasury,
    treasury,
    claimsVerified,
  ]);
  const now = (await latestBlock(c.provider)).timestamp;
  await tx(nft.mint(borrowerAddress, 1));
  await tx(nft.setLock(1, 100_000n * 10n ** 18n, now + 730 * day));
  await tx(usdc.mint(lenderAddress, 10_000n * UNIT));
  await tx(
    usdc.connect(lender).approve(await loans.getAddress(), 10_000n * UNIT),
  );
  await tx(nft.connect(borrower).approve(await loans.getAddress(), 1));
  async function offer(
    overrides: Partial<{
      principal: bigint;
      aprBps: number;
      duration: number;
      expiry: number;
      minimumLockEnd: number;
      minimumLockedAmount: bigint;
    }> = {},
  ) {
    const o = {
      principal: 1000n * UNIT,
      aprBps: 1200,
      duration: 30 * day,
      expiry: now + 10 * day,
      minimumLockEnd: now + 30 * day,
      minimumLockedAmount: 1n,
      ...overrides,
    };
    await tx(
      loans
        .connect(lender)
        .fundOffer(
          borrowerAddress,
          1,
          o.principal,
          o.aprBps,
          o.duration,
          o.expiry,
          o.minimumLockEnd,
          o.minimumLockedAmount,
        ),
    );
    return await loans.offerCount();
  }
  async function open(overrides: Parameters<typeof offer>[0] = {}) {
    const offerId = await offer(overrides);
    await tx(loans.connect(borrower).acceptOffer(offerId));
    const id = await loans.loanCount();
    const loan = await loans.loans(id);
    const vault = attachContract('RiftwellLoanVault', loan.vault, borrower);
    return { id, loan, vault, offerId };
  }
  return {
    ...c,
    admin,
    lender,
    borrower,
    outsider,
    keeper,
    treasury,
    lenderAddress,
    borrowerAddress,
    outsiderAddress,
    keeperAddress,
    nft,
    usdc,
    voter,
    loans,
    now,
    offer,
    open,
  };
}

test('actual funded loan charges 0.5% once, isolates custody and leaves other offer capital intact', async (t) => {
  const f = await fixture(t);
  const other = await f.offer({ principal: 500n * UNIT });
  const { id, vault } = await f.open();
  assert.equal(await f.usdc.balanceOf(f.borrowerAddress), 995n * UNIT);
  assert.equal(await f.usdc.balanceOf(f.treasury), 5n * UNIT);
  assert.equal(await f.loans.escrowedOfferCapital(), 500n * UNIT);
  assert.equal(await f.usdc.balanceOf(await f.loans.getAddress()), 500n * UNIT);
  assert.equal(await f.nft.ownerOf(1), await vault.getAddress());
  assert.deepEqual(Array.from(await f.loans.debt(id)), [
    1000n * UNIT,
    0n,
    1000n * UNIT,
  ]);
  await tx(f.loans.connect(f.lender).cancelOffer(other));
  assert.equal(await f.loans.escrowedOfferCapital(), 0n);
});

test('cancel refunds funded principal without a loan fee; borrower cannot spend another offer', async (t) => {
  const f = await fixture(t);
  const id = await f.offer();
  await assert.rejects(f.loans.connect(f.outsider).acceptOffer(id));
  await assert.rejects(f.loans.connect(f.borrower).cancelOffer(id));
  await tx(f.loans.connect(f.lender).cancelOffer(id));
  assert.equal(await f.loans.lenderCredits(f.lenderAddress), 1000n * UNIT);
  await tx(
    f.loans
      .connect(f.lender)
      .withdrawLenderCredit(f.lenderAddress, 1000n * UNIT),
  );
  assert.equal(await f.usdc.balanceOf(f.lenderAddress), 10_000n * UNIT);
  assert.equal(await f.usdc.balanceOf(f.treasury), 0n);
  await assert.rejects(f.loans.connect(f.borrower).acceptOffer(id));
});

test('expired offer and changed lock collateral cannot release lender capital', async (t) => {
  const f = await fixture(t);
  const id = await f.offer({ expiry: f.now + day });
  await tx(f.nft.setLock(1, 0, f.now + 730 * day));
  await assert.rejects(f.loans.connect(f.borrower).acceptOffer(id));
  await tx(f.nft.setLock(1, 1n, f.now + day));
  await assert.rejects(f.loans.connect(f.borrower).acceptOffer(id));
  await advanceTime(f.provider, day + 1);
  await assert.rejects(f.loans.connect(f.borrower).acceptOffer(id));
  assert.equal(
    await f.usdc.balanceOf(await f.loans.getAddress()),
    1000n * UNIT,
  );
});

test('simple interest accrues on outstanding principal and a partial repayment lowers future accrual', async (t) => {
  const f = await fixture(t);
  const { id } = await f.open();
  await advanceTime(f.provider, 7 * day);
  const firstInterest =
    (1000n * UNIT * 1200n * BigInt(7 * day)) / (10_000n * YEAR);
  assert.equal((await f.loans.debt(id)).interest, firstInterest);
  await tx(
    f.usdc.connect(f.borrower).approve(await f.loans.getAddress(), 500n * UNIT),
  );
  await tx(f.loans.connect(f.borrower).repay(id, 500n * UNIT));
  const remaining = 1000n * UNIT - (500n * UNIT - firstInterest);
  assert.equal((await f.loans.debt(id)).principal, remaining);
  const feeBefore = await f.usdc.balanceOf(f.treasury);
  await advanceTime(f.provider, 7 * day);
  const remainder = (1000n * UNIT * 1200n * BigInt(7 * day)) % (10_000n * YEAR);
  const secondInterest =
    (remaining * 1200n * BigInt(7 * day) + remainder) / (10_000n * YEAR);
  assert.equal((await f.loans.debt(id)).interest, secondInterest);
  assert.equal(await f.usdc.balanceOf(f.treasury), feeBefore);
});

test('interest stops at maturity without compounding or price-triggered collateral seizure', async (t) => {
  const f = await fixture(t);
  const { id, vault } = await f.open({ duration: 7 * day });
  await advanceTime(f.provider, 7 * day);
  const maturityDebt = await f.loans.debt(id);
  await advanceTime(f.provider, 500 * day);
  assert.deepEqual(
    Array.from(await f.loans.debt(id)),
    Array.from(maturityDebt),
  );
  assert.equal(await f.nft.ownerOf(1), await vault.getAddress());
  await assert.rejects(
    f.loans.connect(f.lender).withdrawCollateral(id, f.lenderAddress),
  );
});

test('voting cannot prevent debt repayment; collateral withdrawal waits for actual NFT transfer eligibility', async (t) => {
  const f = await fixture(t);
  const { id, vault } = await f.open();
  await tx(vault.vote([f.outsiderAddress], [1]));
  await tx(f.usdc.mint(f.borrowerAddress, 5n * UNIT));
  await tx(
    f.usdc
      .connect(f.borrower)
      .approve(await f.loans.getAddress(), 1000n * UNIT),
  );
  await tx(f.loans.connect(f.borrower).repay(id, 1000n * UNIT));
  assert.equal(await f.loans.isLoanActive(id), false);
  assert.equal((await f.loans.debt(id)).total, 0n);
  await assert.rejects(
    f.loans.connect(f.borrower).withdrawCollateral(id, f.borrowerAddress),
  );
  await assert.rejects(vault.vote([f.outsiderAddress], [1]));
  await tx(f.nft.setTransferBlocked(1, false));
  await tx(
    f.loans.connect(f.borrower).withdrawCollateral(id, f.borrowerAddress),
  );
  assert.equal(await f.nft.ownerOf(1), f.borrowerAddress);
});

test('closed-period registered rewards repay debt, return excess and never take an ongoing platform share', async (t) => {
  const f = await fixture(t);
  const { id, vault } = await f.open();
  const reward = await deploy('LoanTestReward', f.admin, [
    await f.voter.getAddress(),
    await f.nft.getAddress(),
  ]);
  const pool = f.outsiderAddress;
  await tx(f.voter.setGauge(pool, await reward.getAddress()));
  await tx(f.usdc.mint(await reward.getAddress(), 1100n * UNIT));
  await tx(reward.setReward(9, 1, await f.usdc.getAddress(), 1100n * UNIT));
  await assert.rejects(
    vault.claimClosedPeriod(pool, 10, await f.usdc.getAddress()),
  );
  await tx(
    vault
      .connect(f.outsider)
      .claimClosedPeriod(pool, 9, await f.usdc.getAddress()),
  );
  assert.equal(await f.usdc.balanceOf(await vault.getAddress()), 1100n * UNIT);
  await tx(f.loans.connect(f.keeper).repayFromRewards(id));
  assert.equal(await f.usdc.balanceOf(await vault.getAddress()), 100n * UNIT);
  await tx(vault.withdrawSurplus(await f.usdc.getAddress(), f.borrowerAddress));
  assert.equal(await f.loans.lenderCredits(f.lenderAddress), 1000n * UNIT);
  await tx(
    f.loans
      .connect(f.lender)
      .withdrawLenderCredit(f.lenderAddress, 1000n * UNIT),
  );
  assert.equal(await f.usdc.balanceOf(f.borrowerAddress), 1095n * UNIT);
  assert.equal(await f.usdc.balanceOf(f.lenderAddress), 10_000n * UNIT);
  assert.equal(await f.usdc.balanceOf(f.treasury), 5n * UNIT);
  assert.equal(await f.usdc.balanceOf(await vault.getAddress()), 0n);
  assert.equal(await f.loans.isLoanActive(id), false);
});

test('claims stay disabled if exact live deployment semantics have not been verified', async (t) => {
  const f = await fixture(t, false);
  const { vault } = await f.open();
  await assert.rejects(
    vault.claimClosedPeriod(f.outsiderAddress, 9, await f.usdc.getAddress()),
  );
});

test('operator can only vote and claim; active collateral and reward tokens cannot escape', async (t) => {
  const f = await fixture(t);
  const { id, vault } = await f.open();
  await tx(vault.setOperator(f.keeperAddress));
  await assert.rejects(vault.connect(f.keeper).setOperator(f.outsiderAddress));
  await assert.rejects(
    vault.connect(f.outsider).vote([f.outsiderAddress], [1]),
  );
  await tx(vault.connect(f.keeper).vote([f.outsiderAddress], [1]));
  await assert.rejects(vault.connect(f.keeper).takeSettlement(1));
  await assert.rejects(
    vault.connect(f.keeper).releaseCollateral(f.keeperAddress),
  );
  await assert.rejects(
    vault.withdrawSurplus(await f.usdc.getAddress(), f.borrowerAddress),
  );
  await assert.rejects(
    f.loans.connect(f.borrower).withdrawCollateral(id, f.borrowerAddress),
  );
  await assert.rejects(
    vault.claimClosedPeriod(f.outsiderAddress, 9, await f.usdc.getAddress()),
  );
});

test('pause stops new risk but preserves lender refunds, repayments and withdrawal', async (t) => {
  const f = await fixture(t);
  const spare = await f.offer();
  const { id } = await f.open();
  await assert.rejects(f.loans.connect(f.outsider).setNewLoansPaused(true));
  await tx(f.loans.setNewLoansPaused(true));
  await assert.rejects(f.offer());
  await tx(f.loans.connect(f.lender).cancelOffer(spare));
  await tx(f.usdc.mint(f.borrowerAddress, 5n * UNIT));
  await tx(
    f.usdc
      .connect(f.borrower)
      .approve(await f.loans.getAddress(), 1000n * UNIT),
  );
  await tx(f.loans.connect(f.borrower).repay(id, 1000n * UNIT));
  await tx(
    f.loans.connect(f.borrower).withdrawCollateral(id, f.borrowerAddress),
  );
  assert.equal(await f.nft.ownerOf(1), f.borrowerAddress);
});

test('only lender may forgive debt, and forgiveness frees borrower collateral rather than seizing it', async (t) => {
  const f = await fixture(t);
  const { id } = await f.open();
  await assert.rejects(f.loans.connect(f.borrower).forgiveDebt(id));
  await tx(f.loans.connect(f.lender).forgiveDebt(id));
  assert.equal((await f.loans.debt(id)).total, 0n);
  await tx(
    f.loans.connect(f.borrower).withdrawCollateral(id, f.borrowerAddress),
  );
  assert.equal(await f.nft.ownerOf(1), f.borrowerAddress);
  assert.equal(await f.usdc.balanceOf(f.lenderAddress), 9000n * UNIT);
});

test('repeated small principal repayments conserve interest fraction rather than resetting accrual', async (t) => {
  const f = await fixture(t);
  const { id } = await f.open({ principal: 100n * UNIT });
  await tx(
    f.usdc.connect(f.borrower).approve(await f.loans.getAddress(), 100n * UNIT),
  );
  let principal = 100n * UNIT;
  let remainder = 0n;
  for (let i = 0; i < 6; i++) {
    await advanceTime(f.provider, 1);
    const numerator = remainder + principal * 1200n;
    const interest = numerator / (10_000n * YEAR);
    remainder = numerator % (10_000n * YEAR);
    const amount = 100n;
    await tx(f.loans.connect(f.borrower).repay(id, amount));
    principal -= amount - interest;
    const state = await f.loans.loans(id);
    assert.equal(state.principal, principal);
    assert.equal(state.interestRemainder, remainder);
  }
});
