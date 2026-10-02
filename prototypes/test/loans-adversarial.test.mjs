import test from 'node:test';
import assert from 'node:assert/strict';
import { Contract, ZeroAddress, parseUnits } from 'ethers';
import { createTestContext, deploy, compileContracts } from './helpers.mjs';

const usd = n => parseUnits(String(n), 6);
const day = 86400;
const sent = async operation => (await operation).wait();

async function fixture(t, tokenName = 'MarketTestUSDC', claimsVerified = true) {
  const c = await createTestContext();
  t.after(() => c.close());
  const [admin, lender, borrower, outsider, keeper, alternate, otherLender] = c.signers;
  const [treasury, lenderAddress, borrowerAddress, outsiderAddress, keeperAddress, alternateAddress, otherLenderAddress] = c.addresses;
  const nft = await deploy('LoanTestNFT', admin);
  const token = await deploy(tokenName, admin);
  const voter = await deploy('LoanTestVoter', admin, [nft.target]);
  const loans = await deploy('RiftwellLoans', admin, [nft.target, token.target, voter.target, treasury, treasury, claimsVerified]);
  const now = Number((await c.provider.getBlock('latest')).timestamp);
  for (const id of [1, 2]) {
    await sent(nft.mint(borrowerAddress, id));
    await sent(nft.setLock(id, 100000n * 10n ** 18n, now + 730 * day));
  }
  await sent(nft.connect(borrower).setApprovalForAll(loans.target, true));
  for (const [signer, address] of [[lender, lenderAddress], [otherLender, otherLenderAddress]]) {
    await sent(token.mint(address, usd(10000)));
    await sent(token.connect(signer).approve(loans.target, usd(10000)));
  }
  const fund = async (principal = usd(1000), tokenId = 1, fundingLender = lender) => {
    await sent(loans.connect(fundingLender).fundOffer(borrowerAddress, tokenId, principal, 0, 30 * day, now + 10 * day, now + 30 * day, 1));
    return await loans.offerCount();
  };
  const accept = async offerId => {
    await sent(loans.connect(borrower).acceptOffer(offerId));
    const id = await loans.loanCount();
    const loan = await loans.loans(id);
    const vault = new Contract(loan.vault, compileContracts().RiftwellLoanVault.abi, borrower);
    return { id, loan, vault };
  };
  const open = async (...args) => accept(await fund(...args));
  return { ...c, admin, lender, borrower, outsider, keeper, alternate, otherLender, treasury, lenderAddress, borrowerAddress, outsiderAddress, keeperAddress, alternateAddress, otherLenderAddress, nft, token, voter, loans, fund, accept, open };
}

async function expectMinedRevert(operation) {
  await assert.rejects(async () => sent(operation()), error => error.code === 'CALL_EXCEPTION');
}

async function expectError(contract, operation, expectedName) {
  let caught;
  try { await operation(); } catch (error) { caught = error; }
  assert.ok(caught, `Expected ${expectedName}`);
  assert.equal(contract.interface.parseError(caught.data)?.name, expectedName);
}

async function assertReserve(f, expectedEscrow, expectedCredits, donation = 0n) {
  assert.equal(await f.loans.escrowedOfferCapital(), expectedEscrow);
  assert.equal(await f.loans.totalLenderCredits(), expectedCredits);
  assert.equal(await f.token.balanceOf(f.loans.target), expectedEscrow + expectedCredits + donation);
}

test('an actual blocked NFT acceptance rolls back loan creation, fee/proceeds, and offer-capital changes', async t => {
  const f = await fixture(t);
  const offerId = await f.fund();
  await sent(f.nft.setTransferBlocked(1, true));
  await expectMinedRevert(() => f.loans.connect(f.borrower).acceptOffer(offerId, { gasLimit: 4000000 }));
  assert.equal((await f.loans.offers(offerId)).active, true);
  assert.equal(await f.loans.loanCount(), 0n);
  assert.equal(await f.loans.activeLoanForToken(1), 0n);
  assert.equal(await f.nft.ownerOf(1), f.borrowerAddress);
  assert.equal(await f.token.balanceOf(f.borrowerAddress), 0n);
  assert.equal(await f.token.balanceOf(f.treasury), 0n);
  assert.equal(await f.token.balanceOf(f.lenderAddress), usd(9000));
  await assertReserve(f, usd(1000), 0n);
  await sent(f.nft.setTransferBlocked(1, false));
  await f.accept(offerId);
  await assertReserve(f, 0n, 0n);
});

test('incoming taxed offer funding cannot create unsupported capital or an offer', async t => {
  const f = await fixture(t, 'MarketTaxUSDC');
  const now = Number((await f.provider.getBlock('latest')).timestamp);
  await expectError(f.loans, () => f.loans.connect(f.lender).fundOffer.staticCall(f.borrowerAddress, 1, usd(1000), 0, 30 * day, now + day, now + 30 * day, 1), 'InexactPayment');
  await expectMinedRevert(() => f.loans.connect(f.lender).fundOffer(f.borrowerAddress, 1, usd(1000), 0, 30 * day, now + day, now + 30 * day, 1, { gasLimit: 700000 }));
  assert.equal(await f.loans.offerCount(), 0n);
  assert.equal(await f.token.balanceOf(f.lenderAddress), usd(10000));
  await assertReserve(f, 0n, 0n);
});

test('taxed borrower disbursement rolls back NFT custody and preserves all funded offer capital', async t => {
  const f = await fixture(t, 'MarketTaxUSDC');
  await sent(f.token.setTaxedSender(f.loans.target));
  const offerId = await f.fund();
  await expectError(f.loans, () => f.loans.connect(f.borrower).acceptOffer.staticCall(offerId), 'InexactPayment');
  await expectMinedRevert(() => f.loans.connect(f.borrower).acceptOffer(offerId, { gasLimit: 4000000 }));
  assert.equal((await f.loans.offers(offerId)).active, true);
  assert.equal(await f.loans.loanCount(), 0n);
  assert.equal(await f.nft.ownerOf(1), f.borrowerAddress);
  assert.equal(await f.token.balanceOf(f.borrowerAddress), 0n);
  assert.equal(await f.token.balanceOf(f.treasury), 0n);
  await assertReserve(f, usd(1000), 0n);
});

test('taxed manual repayment cannot reduce principal or invent lender credits', async t => {
  const f = await fixture(t, 'MarketTaxUSDC');
  await sent(f.token.setTaxedSender(ZeroAddress));
  const { id, vault } = await f.open();
  await sent(f.token.mint(f.borrowerAddress, usd(5)));
  await sent(f.token.connect(f.borrower).approve(f.loans.target, usd(1000)));
  await sent(f.token.setTaxedSender(f.borrowerAddress));
  await expectError(f.loans, () => f.loans.connect(f.borrower).repay.staticCall(id, usd(1000)), 'InexactPayment');
  await expectMinedRevert(() => f.loans.connect(f.borrower).repay(id, usd(1000), { gasLimit: 700000 }));
  assert.equal((await f.loans.debt(id)).total, usd(1000));
  assert.equal(await f.loans.isLoanActive(id), true);
  assert.equal(await f.nft.ownerOf(1), vault.target);
  assert.equal(await f.token.balanceOf(f.borrowerAddress), usd(1000));
  await assertReserve(f, 0n, 0n);
});

test('a taxed vault reward transfer cannot reduce debt or debit the isolated vault', async t => {
  const f = await fixture(t, 'MarketTaxUSDC');
  await sent(f.token.setTaxedSender(ZeroAddress));
  const { id, vault } = await f.open();
  await sent(f.token.mint(vault.target, usd(1100)));
  await sent(f.token.setTaxedSender(vault.target));
  await expectError(vault, () => f.loans.connect(f.keeper).repayFromRewards.staticCall(id), 'InexactTransfer');
  await expectMinedRevert(() => f.loans.connect(f.keeper).repayFromRewards(id, { gasLimit: 700000 }));
  assert.equal((await f.loans.debt(id)).total, usd(1000));
  assert.equal(await f.token.balanceOf(vault.target), usd(1100));
  await assertReserve(f, 0n, 0n);
});

test('taxed lender withdrawal rolls back the credit debit and retains cash reserves', async t => {
  const f = await fixture(t, 'MarketTaxUSDC');
  await sent(f.token.setTaxedSender(f.loans.target));
  const offerId = await f.fund();
  await sent(f.loans.connect(f.lender).cancelOffer(offerId));
  await expectError(f.loans, () => f.loans.connect(f.lender).withdrawLenderCredit.staticCall(f.alternateAddress, usd(1000)), 'InexactPayment');
  await expectMinedRevert(() => f.loans.connect(f.lender).withdrawLenderCredit(f.alternateAddress, usd(1000), { gasLimit: 700000 }));
  assert.equal(await f.loans.lenderCredits(f.lenderAddress), usd(1000));
  assert.equal(await f.token.balanceOf(f.alternateAddress), 0n);
  await assertReserve(f, 0n, usd(1000));
});

test('blacklisted lender destination cannot block repayment, debt closure, or borrower NFT withdrawal', async t => {
  const f = await fixture(t, 'LoanBlacklistUSDC');
  const { id, vault } = await f.open();
  await sent(f.token.setBlacklisted(f.lenderAddress, true));
  await sent(f.token.mint(f.borrowerAddress, usd(5)));
  await sent(f.token.connect(f.borrower).approve(f.loans.target, usd(1000)));
  await sent(f.loans.connect(f.borrower).repay(id, usd(1000)));
  assert.equal(await f.loans.isLoanActive(id), false);
  assert.equal((await f.loans.debt(id)).total, 0n);
  assert.equal(await f.loans.lenderCredits(f.lenderAddress), usd(1000));
  await assertReserve(f, 0n, usd(1000));
  await sent(f.loans.connect(f.borrower).withdrawCollateral(id, f.borrowerAddress));
  assert.equal(await f.nft.ownerOf(1), f.borrowerAddress);
  await expectMinedRevert(() => f.loans.connect(f.lender).withdrawLenderCredit(f.lenderAddress, usd(1000), { gasLimit: 700000 }));
  assert.equal(await f.loans.lenderCredits(f.lenderAddress), usd(1000));
  await assertReserve(f, 0n, usd(1000));
  await sent(f.loans.connect(f.lender).withdrawLenderCredit(f.alternateAddress, usd(1000)));
  assert.equal(await f.token.balanceOf(f.alternateAddress), usd(1000));
  assert.equal(await f.loans.lenderCredits(f.lenderAddress), 0n);
  assert.equal(await f.token.balanceOf(vault.target), 0n);
  await assertReserve(f, 0n, 0n);
});

test('reward overpayment closes debt despite a blacklisted borrower and preserves borrower-only surplus', async t => {
  const f = await fixture(t, 'LoanBlacklistUSDC');
  const { id, vault } = await f.open();
  await sent(f.token.mint(vault.target, usd(1100)));
  await sent(f.token.setBlacklisted(f.borrowerAddress, true));
  await sent(f.loans.connect(f.keeper).repayFromRewards(id));
  assert.equal(await f.loans.isLoanActive(id), false);
  assert.equal((await f.loans.debt(id)).total, 0n);
  assert.equal(await f.token.balanceOf(vault.target), usd(100));
  assert.equal(await f.token.balanceOf(f.borrowerAddress), usd(995));
  await assertReserve(f, 0n, usd(1000));
  await expectMinedRevert(() => vault.connect(f.keeper).withdrawSurplus(f.token.target, f.alternateAddress, { gasLimit: 700000 }));
  await expectMinedRevert(() => vault.withdrawSurplus(f.token.target, f.borrowerAddress, { gasLimit: 700000 }));
  assert.equal(await f.token.balanceOf(vault.target), usd(100));
  await sent(vault.withdrawSurplus(f.token.target, f.alternateAddress));
  assert.equal(await f.token.balanceOf(f.alternateAddress), usd(100));
  assert.equal(await f.token.balanceOf(vault.target), 0n);
});

test('permissionless harvesting uses only registered closed-period rewards and does not redirect funds to the caller', async t => {
  const f = await fixture(t);
  const { id, vault } = await f.open();
  const reward = await deploy('LoanTestReward', f.admin, [f.voter.target, f.nft.target]);
  await sent(f.voter.setGauge(f.outsiderAddress, reward.target));
  await sent(f.token.mint(reward.target, usd(1100)));
  await sent(reward.setReward(9, 1, f.token.target, usd(1100)));
  await expectError(vault, () => vault.connect(f.outsider).claimClosedPeriod.staticCall(f.outsiderAddress, 10, f.token.target), 'ActivePeriod');
  await expectError(vault, () => vault.connect(f.outsider).claimClosedPeriod.staticCall(f.alternateAddress, 9, f.token.target), 'InvalidReward');
  await sent(vault.connect(f.outsider).claimClosedPeriod(f.outsiderAddress, 9, f.token.target));
  assert.equal(await f.token.balanceOf(vault.target), usd(1100));
  assert.equal(await f.token.balanceOf(f.outsiderAddress), 0n);
  await sent(f.loans.connect(f.outsider).repayFromRewards(id));
  assert.equal(await f.loans.lenderCredits(f.lenderAddress), usd(1000));
  assert.equal(await f.token.balanceOf(vault.target), usd(100));
  assert.equal(await f.token.balanceOf(f.outsiderAddress), 0n);
  await assertReserve(f, 0n, usd(1000));
});

test('multiple lenders conserve separate credits and pending-offer reserves through cancellation, repayment, and partial withdrawals', async t => {
  const f = await fixture(t);
  const firstOffer = await f.fund(usd(1000), 1, f.lender);
  const otherOffer = await f.fund(usd(500), 2, f.otherLender);
  await sent(f.token.mint(f.loans.target, usd(17)));
  await assertReserve(f, usd(1500), 0n, usd(17));
  await sent(f.loans.connect(f.otherLender).cancelOffer(otherOffer));
  assert.equal(await f.loans.lenderCredits(f.otherLenderAddress), usd(500));
  await assertReserve(f, usd(1000), usd(500), usd(17));
  const { id } = await f.accept(firstOffer);
  await assertReserve(f, 0n, usd(500), usd(17));
  await sent(f.token.mint(f.borrowerAddress, usd(5)));
  await sent(f.token.connect(f.borrower).approve(f.loans.target, usd(1000)));
  await sent(f.loans.connect(f.borrower).repay(id, usd(1000)));
  assert.equal(await f.loans.lenderCredits(f.lenderAddress), usd(1000));
  await assertReserve(f, 0n, usd(1500), usd(17));
  await expectError(f.loans, () => f.loans.connect(f.outsider).withdrawLenderCredit.staticCall(f.outsiderAddress, usd(1)), 'InvalidWithdrawal');
  await expectError(f.loans, () => f.loans.connect(f.otherLender).withdrawLenderCredit.staticCall(f.otherLenderAddress, usd(501)), 'InvalidWithdrawal');
  await expectError(f.loans, () => f.loans.connect(f.lender).withdrawLenderCredit.staticCall(f.loans.target, usd(1)), 'InvalidWithdrawal');
  await expectError(f.loans, () => f.loans.connect(f.lender).withdrawLenderCredit.staticCall(ZeroAddress, usd(1)), 'InvalidWithdrawal');
  await sent(f.loans.connect(f.otherLender).withdrawLenderCredit(f.otherLenderAddress, usd(200)));
  assert.equal(await f.loans.lenderCredits(f.otherLenderAddress), usd(300));
  await assertReserve(f, 0n, usd(1300), usd(17));
  await sent(f.loans.connect(f.lender).withdrawLenderCredit(f.lenderAddress, usd(1000)));
  await assertReserve(f, 0n, usd(300), usd(17));
  await sent(f.loans.connect(f.otherLender).withdrawLenderCredit(f.otherLenderAddress, usd(300)));
  await assertReserve(f, 0n, 0n, usd(17));
});
