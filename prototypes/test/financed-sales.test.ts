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
import { Contract, ZeroAddress, parseUnits } from 'ethers';
import {
  createTestContext,
  deploy,
  compileContracts,
  advanceTime,
  sent,
  attachContract,
  latestBlock,
} from './helpers.ts';

const usd = (n: string | number | bigint) => parseUnits(String(n), 6);
const day = 86400;

async function fixture<
  TokenName extends 'MarketTestUSDC' | 'MarketTaxUSDC' | 'LoanBlacklistUSDC' =
    'MarketTestUSDC',
>(t: TestContext, tokenName: TokenName = 'MarketTestUSDC' as TokenName) {
  const c = await createTestContext();
  t.after(() => c.close());
  const [
    admin,
    lender,
    borrower,
    buyer,
    outsider,
    keeper,
    alternate,
    otherLender,
  ] = c.signers;
  const [
    treasury,
    lenderAddress,
    borrowerAddress,
    buyerAddress,
    outsiderAddress,
    keeperAddress,
    alternateAddress,
    otherLenderAddress,
  ] = c.addresses;
  const nft = await deploy('LoanTestNFT', admin);
  const token = await deploy(tokenName, admin);
  const voter = await deploy('LoanTestVoter', admin, [nft.target]);
  const loans = await deploy('RiftwellLoans', admin, [
    nft.target,
    token.target,
    voter.target,
    treasury,
    treasury,
    true,
  ]);
  const now = Number((await latestBlock(c.provider)).timestamp);
  for (const id of [1, 2, 3]) {
    await sent(nft.mint(borrowerAddress, id));
    await sent(nft.setLock(id, 100000n * 10n ** 18n, now + 730 * day));
  }
  await sent(nft.connect(borrower).setApprovalForAll(loans.target, true));
  for (const [signer, address] of [
    [lender, lenderAddress],
    [buyer, buyerAddress],
    [otherLender, otherLenderAddress],
  ] as const) {
    await sent(token.mint(address, usd(10000)));
    await sent(token.connect(signer).approve(loans.target, usd(10000)));
  }
  const fund = async (
    tokenId = 1,
    principal = usd(1000),
    aprBps = 0,
    fundingLender = lender,
  ) => {
    await sent(
      loans
        .connect(fundingLender)
        .fundOffer(
          borrowerAddress,
          tokenId,
          principal,
          aprBps,
          30 * day,
          now + 10 * day,
          now + 30 * day,
          1,
        ),
    );
    return await loans.offerCount();
  };
  const open = async (...args: Parameters<typeof fund>) => {
    const offerId = await fund(...args);
    await sent(loans.connect(borrower).acceptOffer(offerId));
    const id = await loans.loanCount();
    const loan = await loans.loans(id);
    const vault = attachContract('RiftwellLoanVault', loan.vault, borrower);
    return { id, loan, vault, offerId };
  };
  const list = async (
    loanId: BigNumberish,
    price = usd(1250),
    expiry = now + day,
  ) => {
    await sent(
      loans.connect(borrower).listFinancedCollateral(loanId, price, expiry),
    );
    return await loans.financedListingCount();
  };
  return {
    ...c,
    admin,
    lender,
    borrower,
    buyer,
    outsider,
    keeper,
    alternate,
    otherLender,
    treasury,
    lenderAddress,
    borrowerAddress,
    buyerAddress,
    outsiderAddress,
    keeperAddress,
    alternateAddress,
    otherLenderAddress,
    nft,
    token,
    voter,
    loans,
    fund,
    open,
    list,
    now,
  };
}

async function expectRevert(operation: () => Promise<unknown>) {
  await assert.rejects(
    operation(),
    (error) => errorInfo(error).code === 'CALL_EXCEPTION',
  );
}

async function expectMinedRevert(
  operation: () => Promise<ContractTransactionResponse>,
) {
  await assert.rejects(
    async () => sent(operation()),
    (error) => errorInfo(error).code === 'CALL_EXCEPTION',
  );
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
async function assertReserves(
  f: Fixture,
  escrow: bigint,
  lender: bigint,
  borrower: bigint,
  donation = 0n,
) {
  assert.equal(await f.loans.escrowedOfferCapital(), escrow);
  assert.equal(await f.loans.totalLenderCredits(), lender);
  assert.equal(await f.loans.totalBorrowerCredits(), borrower);
  assert.equal(
    await f.token.balanceOf(f.loans.target),
    escrow + lender + borrower + donation,
  );
}

async function assertUnsettled(
  f: Fixture,
  loanId: BigNumberish,
  listingId: BigNumberish,
  vault: RiftwellLoanVault,
  price = usd(1250),
) {
  assert.equal(await f.loans.isLoanActive(loanId), true);
  assert.equal((await f.loans.financedListings(listingId)).active, true);
  assert.equal((await f.loans.financedListings(listingId)).price, price);
  assert.equal(await f.loans.activeFinancedListing(loanId), listingId);
  assert.equal(await f.nft.ownerOf(1), vault.target);
  assert.equal(await f.token.balanceOf(f.buyerAddress), usd(10000));
  assert.equal(await f.loans.lenderCredits(f.lenderAddress), 0n);
  assert.equal(await f.loans.borrowerCredits(f.borrowerAddress), 0n);
  assert.equal(await f.token.balanceOf(f.treasury), usd(5));
  await assertReserves(f, 0n, 0n, 0n);
}

test('financed sale closes actual debt, transfers collateral, charges one sale fee, and credits only the residual to borrower', async (t) => {
  const f = await fixture(t);
  const { id } = await f.open();
  const listing = await f.list(id);
  await sent(
    f.loans
      .connect(f.buyer)
      .buyFinancedCollateral(listing, usd(1250), f.outsiderAddress),
  );
  assert.equal(await f.nft.ownerOf(1), f.outsiderAddress);
  assert.equal(await f.loans.isLoanActive(id), false);
  assert.equal((await f.loans.debt(id)).total, 0n);
  assert.equal((await f.loans.financedListings(listing)).active, false);
  assert.equal(await f.loans.activeFinancedListing(id), 0n);
  assert.equal(await f.loans.lenderCredits(f.lenderAddress), usd(1000));
  assert.equal(await f.loans.borrowerCredits(f.borrowerAddress), usd(243.75));
  assert.equal(await f.token.balanceOf(f.buyerAddress), usd(8750));
  assert.equal(await f.token.balanceOf(f.borrowerAddress), usd(995));
  assert.equal(await f.token.balanceOf(f.treasury), usd(11.25));
  await assertReserves(f, 0n, usd(1000), usd(243.75));
  await sent(
    f.loans
      .connect(f.borrower)
      .withdrawBorrowerCredit(f.borrowerAddress, usd(243.75)),
  );
  await sent(
    f.loans.connect(f.lender).withdrawLenderCredit(f.lenderAddress, usd(1000)),
  );
  assert.equal(await f.token.balanceOf(f.borrowerAddress), usd(1238.75));
  assert.equal(await f.token.balanceOf(f.lenderAddress), usd(10000));
  await assertReserves(f, 0n, 0n, 0n);
});

test('financed price must cover debt after the sale fee, including interest accrued since listing', async (t) => {
  const f = await fixture(t);
  const { id, vault } = await f.open(1, usd(1000), 1200);
  const listing = await f.list(id, usd(1007), f.now + 10 * day);
  await advanceTime(f.provider, 7 * day);
  const expectedInterest =
    (usd(1000) * 1200n * BigInt(7 * day)) / (10000n * 31536000n);
  assert.equal((await f.loans.debt(id)).total, usd(1000) + expectedInterest);
  await expectError(
    f.loans,
    () =>
      f.loans
        .connect(f.buyer)
        .buyFinancedCollateral.staticCall(listing, usd(1007), f.buyerAddress),
    'InsufficientSaleProceeds',
  );
  await expectMinedRevert(() =>
    f.loans
      .connect(f.buyer)
      .buyFinancedCollateral(listing, usd(1007), f.buyerAddress, {
        gasLimit: 1500000,
      }),
  );
  await assertUnsettled(f, id, listing, vault, usd(1007));
  const newListing = await f.list(id, usd(1020), f.now + 10 * day);
  await sent(
    f.loans
      .connect(f.buyer)
      .buyFinancedCollateral(newListing, usd(1020), f.buyerAddress),
  );
  const debtPaid = usd(1000) + expectedInterest;
  assert.equal(await f.loans.lenderCredits(f.lenderAddress), debtPaid);
  assert.equal(
    await f.loans.borrowerCredits(f.borrowerAddress),
    usd(1020) - usd(5.1) - debtPaid,
  );
  await assertReserves(f, 0n, debtPaid, usd(1020) - usd(5.1) - debtPaid);
});

test('only borrower can list, reprice, and cancel; repricing permanently invalidates the old listing ID', async (t) => {
  const f = await fixture(t);
  const { id } = await f.open();
  await expectRevert(() =>
    f.loans
      .connect(f.outsider)
      .listFinancedCollateral.staticCall(id, usd(1250), f.now + day),
  );
  const old = await f.list(id);
  await expectRevert(() =>
    f.loans.connect(f.lender).cancelFinancedListing.staticCall(old),
  );
  const replacement = await f.list(id, usd(1400));
  assert.equal((await f.loans.financedListings(old)).active, false);
  assert.equal((await f.loans.financedListings(old)).price, usd(1250));
  assert.equal(await f.loans.activeFinancedListing(id), replacement);
  await expectRevert(() =>
    f.loans
      .connect(f.buyer)
      .buyFinancedCollateral.staticCall(old, usd(1250), f.buyerAddress),
  );
  await expectRevert(() =>
    f.loans
      .connect(f.buyer)
      .buyFinancedCollateral.staticCall(replacement, usd(1399), f.buyerAddress),
  );
  await sent(f.loans.connect(f.borrower).cancelFinancedListing(replacement));
  assert.equal((await f.loans.financedListings(replacement)).active, false);
  assert.equal(await f.loans.activeFinancedListing(id), 0n);
  await expectRevert(() =>
    f.loans
      .connect(f.buyer)
      .buyFinancedCollateral.staticCall(replacement, usd(1400), f.buyerAddress),
  );
});

test('expiry, price limits, and reserved NFT recipients cannot execute a financed sale', async (t) => {
  const f = await fixture(t);
  const { id, vault } = await f.open();
  await expectRevert(() =>
    f.loans
      .connect(f.borrower)
      .listFinancedCollateral.staticCall(id, 0, f.now + day),
  );
  await expectRevert(() =>
    f.loans
      .connect(f.borrower)
      .listFinancedCollateral.staticCall(id, usd(1250), f.now),
  );
  const listing = await f.list(id, usd(1250), f.now + 3600);
  for (const recipient of [ZeroAddress, f.loans.target, vault.target]) {
    await expectRevert(() =>
      f.loans
        .connect(f.buyer)
        .buyFinancedCollateral.staticCall(listing, usd(1250), recipient),
    );
  }
  await expectRevert(() =>
    f.loans
      .connect(f.buyer)
      .buyFinancedCollateral.staticCall(listing, usd(1249), f.buyerAddress),
  );
  await advanceTime(f.provider, 3600);
  await expectMinedRevert(() =>
    f.loans
      .connect(f.buyer)
      .buyFinancedCollateral(listing, usd(1250), f.buyerAddress, {
        gasLimit: 1500000,
      }),
  );
  await assertUnsettled(f, id, listing, vault);
});

test('manual full repayment invalidates the sale, even while the NFT still waits in custody', async (t) => {
  const f = await fixture(t);
  const { id, vault } = await f.open();
  const listing = await f.list(id);
  await sent(f.token.mint(f.borrowerAddress, usd(5)));
  await sent(f.token.connect(f.borrower).approve(f.loans.target, usd(1000)));
  await sent(f.loans.connect(f.borrower).repay(id, usd(1000)));
  assert.equal((await f.loans.financedListings(listing)).active, false);
  assert.equal(await f.loans.activeFinancedListing(id), 0n);
  assert.equal(await f.nft.ownerOf(1), vault.target);
  await expectMinedRevert(() =>
    f.loans
      .connect(f.buyer)
      .buyFinancedCollateral(listing, usd(1250), f.buyerAddress, {
        gasLimit: 1500000,
      }),
  );
  assert.equal(await f.token.balanceOf(f.buyerAddress), usd(10000));
  await expectRevert(() =>
    f.loans
      .connect(f.borrower)
      .listFinancedCollateral.staticCall(id, usd(1250), f.now + day),
  );
  await sent(
    f.loans.connect(f.borrower).withdrawCollateral(id, f.borrowerAddress),
  );
  assert.equal(await f.nft.ownerOf(1), f.borrowerAddress);
  await assertReserves(f, 0n, usd(1000), 0n);
});

test('actual voted-transfer restriction rolls back the entire purchase and all lender/borrower credits', async (t) => {
  const f = await fixture(t);
  const { id, vault } = await f.open();
  const listing = await f.list(id);
  await sent(vault.vote([f.outsiderAddress], [1]));
  await expectMinedRevert(() =>
    f.loans
      .connect(f.buyer)
      .buyFinancedCollateral(listing, usd(1250), f.buyerAddress, {
        gasLimit: 1500000,
      }),
  );
  assert.equal((await f.loans.debt(id)).total, usd(1000));
  await assertUnsettled(f, id, listing, vault);
  await sent(f.nft.setTransferBlocked(1, false));
  await sent(
    f.loans
      .connect(f.buyer)
      .buyFinancedCollateral(listing, usd(1250), f.buyerAddress),
  );
  assert.equal(await f.nft.ownerOf(1), f.buyerAddress);
});

test('rejecting NFT receiver rolls back fees and credit creation', async (t) => {
  const f = await fixture(t);
  const { id, vault } = await f.open();
  const listing = await f.list(id);
  const receiver = await deploy('MarketRejectingReceiver', f.admin);
  await expectMinedRevert(() =>
    f.loans
      .connect(f.buyer)
      .buyFinancedCollateral(listing, usd(1250), receiver.target, {
        gasLimit: 1500000,
      }),
  );
  await assertUnsettled(f, id, listing, vault);
});

test('NFT receiver cannot reenter another financed sale during collateral release', async (t) => {
  const f = await fixture(t);
  const first = await f.open();
  const second = await f.open(2);
  const firstListing = await f.list(first.id);
  const secondListing = await f.list(second.id);
  const receiver = await deploy('FinancedSaleReenteringReceiver', f.admin, [
    f.loans.target,
  ]);
  await sent(receiver.setTarget(secondListing));
  await sent(
    f.loans
      .connect(f.buyer)
      .buyFinancedCollateral(firstListing, usd(1250), receiver.target),
  );
  assert.equal(await receiver.reentrySucceeded(), false);
  assert.equal(
    f.loans.interface.parseError(await receiver.reentryReturnData())?.name,
    'ReentrancyGuardReentrantCall',
  );
  assert.equal(await f.nft.ownerOf(1), receiver.target);
  assert.equal(await f.nft.ownerOf(2), second.vault.target);
  assert.equal(await f.loans.isLoanActive(second.id), true);
  assert.equal((await f.loans.financedListings(secondListing)).active, true);
  assert.equal(await f.loans.lenderCredits(f.lenderAddress), usd(1000));
  await assertReserves(f, 0n, usd(1000), usd(243.75));
});

test('incoming taxed buyer payment rolls back financed debt, listings, custody, and reserves', async (t) => {
  const f = await fixture(t, 'MarketTaxUSDC');
  await sent(f.token.setTaxedSender(ZeroAddress));
  const { id, vault } = await f.open();
  const listing = await f.list(id);
  await sent(f.token.setTaxedSender(f.buyerAddress));
  await expectMinedRevert(() =>
    f.loans
      .connect(f.buyer)
      .buyFinancedCollateral(listing, usd(1250), f.buyerAddress, {
        gasLimit: 1500000,
      }),
  );
  await assertUnsettled(f, id, listing, vault);
});

test('taxed treasury fee also reverts the sale rather than spending another offer or credit reserve', async (t) => {
  const f = await fixture(t, 'MarketTaxUSDC');
  await sent(f.token.setTaxedSender(ZeroAddress));
  const { id, vault } = await f.open();
  const listing = await f.list(id);
  const spare = await f.fund(2, usd(500));
  await sent(f.token.setTaxedSender(f.loans.target));
  await expectMinedRevert(() =>
    f.loans
      .connect(f.buyer)
      .buyFinancedCollateral(listing, usd(1250), f.buyerAddress, {
        gasLimit: 1500000,
      }),
  );
  assert.equal(await f.loans.isLoanActive(id), true);
  assert.equal((await f.loans.financedListings(listing)).active, true);
  assert.equal(await f.nft.ownerOf(1), vault.target);
  assert.equal(await f.token.balanceOf(f.buyerAddress), usd(10000));
  assert.equal((await f.loans.offers(spare)).active, true);
  assert.equal(await f.token.balanceOf(f.treasury), usd(5));
  await assertReserves(f, usd(500), 0n, 0n);
});

test('blacklisted lender and borrower destinations do not block a sale; each can withdraw their own credit elsewhere', async (t) => {
  const f = await fixture(t, 'LoanBlacklistUSDC');
  const { id } = await f.open();
  const listing = await f.list(id);
  await sent(f.token.setBlacklisted(f.lenderAddress, true));
  await sent(f.token.setBlacklisted(f.borrowerAddress, true));
  await sent(
    f.loans
      .connect(f.buyer)
      .buyFinancedCollateral(listing, usd(1250), f.buyerAddress),
  );
  assert.equal(await f.loans.isLoanActive(id), false);
  assert.equal(await f.nft.ownerOf(1), f.buyerAddress);
  await assertReserves(f, 0n, usd(1000), usd(243.75));
  for (const [recipient, amount] of [
    [ZeroAddress, usd(1)],
    [f.loans.target, usd(1)],
    [f.alternateAddress, 0n],
    [f.alternateAddress, usd(244)],
  ] as const) {
    await expectError(
      f.loans,
      () =>
        f.loans
          .connect(f.borrower)
          .withdrawBorrowerCredit.staticCall(recipient, amount),
      'InvalidWithdrawal',
    );
  }
  await expectMinedRevert(() =>
    f.loans
      .connect(f.lender)
      .withdrawLenderCredit(f.lenderAddress, usd(1000), { gasLimit: 700000 }),
  );
  await expectMinedRevert(() =>
    f.loans
      .connect(f.borrower)
      .withdrawBorrowerCredit(f.borrowerAddress, usd(243.75), {
        gasLimit: 700000,
      }),
  );
  await assertReserves(f, 0n, usd(1000), usd(243.75));
  await expectRevert(() =>
    f.loans
      .connect(f.outsider)
      .withdrawBorrowerCredit.staticCall(f.outsiderAddress, usd(1)),
  );
  await sent(
    f.loans
      .connect(f.lender)
      .withdrawLenderCredit(f.alternateAddress, usd(1000)),
  );
  await sent(
    f.loans
      .connect(f.borrower)
      .withdrawBorrowerCredit(f.outsiderAddress, usd(243.75)),
  );
  assert.equal(await f.token.balanceOf(f.alternateAddress), usd(1000));
  assert.equal(await f.token.balanceOf(f.outsiderAddress), usd(243.75));
  await assertReserves(f, 0n, 0n, 0n);
});

test('financed sale preserves other offers and both lenders credits through partial independent withdrawals', async (t) => {
  const f = await fixture(t);
  const { id } = await f.open();
  const listing = await f.list(id);
  const pending = await f.fund(2, usd(500), 0, f.otherLender);
  const refund = await f.fund(3, usd(200), 0, f.otherLender);
  await sent(f.loans.connect(f.otherLender).cancelOffer(refund));
  await sent(f.token.mint(f.loans.target, usd(17)));
  await assertReserves(f, usd(500), usd(200), 0n, usd(17));
  await sent(
    f.loans
      .connect(f.buyer)
      .buyFinancedCollateral(listing, usd(1250), f.buyerAddress),
  );
  assert.equal((await f.loans.offers(pending)).active, true);
  assert.equal(await f.loans.lenderCredits(f.otherLenderAddress), usd(200));
  assert.equal(await f.loans.lenderCredits(f.lenderAddress), usd(1000));
  await assertReserves(f, usd(500), usd(1200), usd(243.75), usd(17));
  await sent(
    f.loans
      .connect(f.borrower)
      .withdrawBorrowerCredit(f.borrowerAddress, usd(100)),
  );
  await sent(
    f.loans
      .connect(f.otherLender)
      .withdrawLenderCredit(f.otherLenderAddress, usd(200)),
  );
  await assertReserves(f, usd(500), usd(1000), usd(143.75), usd(17));
  await sent(
    f.loans.connect(f.lender).withdrawLenderCredit(f.lenderAddress, usd(1000)),
  );
  await sent(
    f.loans
      .connect(f.borrower)
      .withdrawBorrowerCredit(f.borrowerAddress, usd(143.75)),
  );
  await assertReserves(f, usd(500), 0n, 0n, usd(17));
  await sent(f.loans.connect(f.otherLender).cancelOffer(pending));
  await sent(
    f.loans
      .connect(f.otherLender)
      .withdrawLenderCredit(f.otherLenderAddress, usd(500)),
  );
  await assertReserves(f, 0n, 0n, 0n, usd(17));
});

test('lender forgiveness permanently invalidates a financed listing without exposing the NFT to a stale buyer', async (t) => {
  const f = await fixture(t);
  const { id, vault } = await f.open();
  const listing = await f.list(id);
  await sent(f.loans.connect(f.lender).forgiveDebt(id));
  assert.equal((await f.loans.financedListings(listing)).active, false);
  assert.equal(await f.loans.activeFinancedListing(id), 0n);
  assert.equal(await f.loans.isLoanActive(id), false);
  assert.equal(await f.nft.ownerOf(1), vault.target);
  await expectMinedRevert(() =>
    f.loans
      .connect(f.buyer)
      .buyFinancedCollateral(listing, usd(1250), f.buyerAddress, {
        gasLimit: 1500000,
      }),
  );
  assert.equal(await f.token.balanceOf(f.buyerAddress), usd(10000));
  await sent(
    f.loans.connect(f.borrower).withdrawCollateral(id, f.borrowerAddress),
  );
  assert.equal(await f.nft.ownerOf(1), f.borrowerAddress);
  await assertReserves(f, 0n, 0n, 0n);
});

test('partial repayment keeps a listing usable and sale settlement applies only remaining debt', async (t) => {
  const f = await fixture(t);
  const { id } = await f.open();
  const listing = await f.list(id);
  await sent(f.token.connect(f.borrower).approve(f.loans.target, usd(200)));
  await sent(f.loans.connect(f.borrower).repay(id, usd(200)));
  assert.equal((await f.loans.debt(id)).total, usd(800));
  assert.equal((await f.loans.financedListings(listing)).active, true);
  await assertReserves(f, 0n, usd(200), 0n);
  await sent(
    f.loans
      .connect(f.buyer)
      .buyFinancedCollateral(listing, usd(1250), f.buyerAddress),
  );
  assert.equal(await f.loans.lenderCredits(f.lenderAddress), usd(1000));
  assert.equal(await f.loans.borrowerCredits(f.borrowerAddress), usd(443.75));
  assert.equal(await f.loans.isLoanActive(id), false);
  assert.equal(await f.token.balanceOf(f.borrowerAddress), usd(795));
  await assertReserves(f, 0n, usd(1000), usd(443.75));
});

test('guardian pause blocks fresh lending risk while financed sales and both credit withdrawals remain available', async (t) => {
  const f = await fixture(t);
  const { id } = await f.open();
  await sent(f.loans.setNewLoansPaused(true));
  await expectRevert(() =>
    f.loans
      .connect(f.lender)
      .fundOffer.staticCall(
        f.borrowerAddress,
        2,
        usd(1000),
        0,
        30 * day,
        f.now + day,
        f.now + 30 * day,
        1,
      ),
  );
  const listing = await f.list(id);
  await sent(
    f.loans
      .connect(f.buyer)
      .buyFinancedCollateral(listing, usd(1250), f.buyerAddress),
  );
  await sent(
    f.loans.connect(f.lender).withdrawLenderCredit(f.lenderAddress, usd(1000)),
  );
  await sent(
    f.loans
      .connect(f.borrower)
      .withdrawBorrowerCredit(f.borrowerAddress, usd(243.75)),
  );
  assert.equal(await f.nft.ownerOf(1), f.buyerAddress);
  await assertReserves(f, 0n, 0n, 0n);
});
