import test from 'node:test';
import assert from 'node:assert/strict';
import { ZeroAddress, parseUnits } from 'ethers';
import { createTestContext, deploy, advanceTime } from './helpers.mjs';

const usd = n => parseUnits(String(n), 6);
const sent = async operation => (await operation).wait();

async function fixture(t, tokenName = 'MarketTestUSDC') {
  const context = await createTestContext();
  t.after(() => context.close());
  const [seller, buyer, treasury, outsider, nextOwner] = context.signers;
  const [sellerAddress, buyerAddress, treasuryAddress, outsiderAddress, nextOwnerAddress] = context.addresses;
  const nft = await deploy('MarketTestNFT', seller);
  const token = await deploy(tokenName, seller);
  const market = await deploy('RiftwellMarket', seller, [await nft.getAddress(), await token.getAddress(), treasuryAddress]);
  await sent(nft.mint(sellerAddress, 1));
  await sent(nft.mint(sellerAddress, 2));
  await sent(nft.setApprovalForAll(await market.getAddress(), true));
  await sent(token.mint(buyerAddress, usd(10000)));
  await sent(token.connect(buyer).approve(await market.getAddress(), usd(10000)));
  const now = Number((await context.provider.getBlock('latest')).timestamp);
  return { ...context, seller, buyer, treasury, outsider, nextOwner, sellerAddress, buyerAddress, treasuryAddress, outsiderAddress, nextOwnerAddress, nft, token, market, expiry: now + 3600 };
}

async function list(f, tokenId = 1, price = usd(1000), expiry = f.expiry) {
  await sent(f.market.createListing(tokenId, price, expiry));
  return await f.market.listingCount();
}

async function expectCustomError(contract, operation, expectedName) {
  let caught;
  try { await operation(); } catch (error) { caught = error; }
  assert.ok(caught, `Expected ${expectedName}`);
  assert.equal(contract.interface.parseError(caught.data)?.name, expectedName);
}

async function expectMinedRevert(operation) {
  await assert.rejects(async () => sent(operation()), error => error.code === 'CALL_EXCEPTION');
}

test('sale settles one exact 0.5% seller fee and transfers the NFT to the chosen recipient', async t => {
  const f = await fixture(t);
  const id = await list(f);
  const receipt = await sent(f.market.connect(f.buyer).buy(id, usd(1000), f.outsiderAddress));
  assert.equal(await f.nft.ownerOf(1), f.outsiderAddress);
  assert.equal(await f.token.balanceOf(f.buyerAddress), usd(9000));
  assert.equal(await f.token.balanceOf(f.sellerAddress), usd(995));
  assert.equal(await f.token.balanceOf(f.treasuryAddress), usd(5));
  assert.equal(await f.token.balanceOf(await f.market.getAddress()), 0n);
  assert.equal((await f.market.listings(id)).active, false);
  assert.equal(await f.market.currentListing(1), 0n);
  const event = receipt.logs.map(log => { try { return f.market.interface.parseLog(log); } catch { return null; } }).find(e => e?.name === 'Purchased');
  assert.equal(event.args.protocolFee, usd(5));
  await expectCustomError(f.market, () => f.market.connect(f.buyer).buy.staticCall(id, usd(1000), f.buyerAddress), 'InactiveListing');
});

test('old voting history does not prevent a transfer the NFT implementation allows', async t => {
  const f = await fixture(t);
  await sent(f.nft.setVoted(1, true));
  const id = await list(f);
  await sent(f.market.connect(f.buyer).buy(id, usd(1000), f.buyerAddress));
  assert.equal(await f.nft.voted(1), true);
  assert.equal(await f.nft.ownerOf(1), f.buyerAddress);
});

test('actual collection transfer restrictions roll back payment and leave the listing available', async t => {
  const f = await fixture(t);
  const id = await list(f);
  await sent(f.nft.setTransferBlocked(1, true));
  await expectMinedRevert(() => f.market.connect(f.buyer).buy(id, usd(1000), f.buyerAddress, { gasLimit: 600000 }));
  assert.equal(await f.nft.ownerOf(1), f.sellerAddress);
  assert.equal(await f.token.balanceOf(f.buyerAddress), usd(10000));
  assert.equal(await f.token.balanceOf(f.sellerAddress), 0n);
  assert.equal(await f.token.balanceOf(f.treasuryAddress), 0n);
  assert.equal((await f.market.listings(id)).active, true);
  await sent(f.nft.setTransferBlocked(1, false));
  await sent(f.market.connect(f.buyer).buy(id, usd(1000), f.buyerAddress));
});

test('creation rejects a non-owner, missing approval, zero price, and nonfuture expiry', async t => {
  const f = await fixture(t);
  await expectCustomError(f.market, () => f.market.connect(f.outsider).createListing.staticCall(1, usd(1000), f.expiry), 'NotOwner');
  await sent(f.nft.setApprovalForAll(await f.market.getAddress(), false));
  await expectCustomError(f.market, () => f.market.createListing.staticCall(1, usd(1000), f.expiry), 'NotApproved');
  await sent(f.nft.approve(await f.market.getAddress(), 1));
  await expectCustomError(f.market, () => f.market.createListing.staticCall(1, 0, f.expiry), 'InvalidPriceOrExpiry');
  const now = Number((await f.provider.getBlock('latest')).timestamp);
  await expectCustomError(f.market, () => f.market.createListing.staticCall(1, usd(1000), now), 'InvalidPriceOrExpiry');
  await list(f);
});

test('revoked approvals are checked at purchase and cannot debit the buyer', async t => {
  const f = await fixture(t);
  const id = await list(f);
  await sent(f.nft.setApprovalForAll(await f.market.getAddress(), false));
  await expectCustomError(f.market, () => f.market.connect(f.buyer).buy.staticCall(id, usd(1000), f.buyerAddress), 'NotApproved');
  await expectMinedRevert(() => f.market.connect(f.buyer).buy(id, usd(1000), f.buyerAddress, { gasLimit: 600000 }));
  assert.equal(await f.token.balanceOf(f.buyerAddress), usd(10000));
  assert.equal((await f.market.listings(id)).active, true);
});

test('transferred ownership makes an old seller order fail; a new owner cannot inherit its price', async t => {
  const f = await fixture(t);
  const oldId = await list(f);
  await sent(f.nft.transferFrom(f.sellerAddress, f.nextOwnerAddress, 1));
  await sent(f.nft.connect(f.nextOwner).approve(await f.market.getAddress(), 1));
  await expectCustomError(f.market, () => f.market.connect(f.buyer).buy.staticCall(oldId, usd(1000), f.buyerAddress), 'NotOwner');
  await sent(f.market.connect(f.nextOwner).createListing(1, usd(1250), f.expiry));
  const newId = await f.market.listingCount();
  assert.notEqual(oldId, newId);
  await expectCustomError(f.market, () => f.market.connect(f.buyer).buy.staticCall(oldId, usd(1000), f.buyerAddress), 'InactiveListing');
  await expectCustomError(f.market, () => f.market.connect(f.buyer).buy.staticCall(newId, usd(1000), f.buyerAddress), 'PriceExceedsLimit');
  await sent(f.market.connect(f.buyer).buy(newId, usd(1250), f.buyerAddress));
  assert.equal(await f.token.balanceOf(f.nextOwnerAddress), usd(1243.75));
});

test('repricing requires a new listing ID and permanently deactivates the superseded order', async t => {
  const f = await fixture(t);
  const oldId = await list(f);
  const newId = await list(f, 1, usd(1100));
  assert.equal((await f.market.listings(oldId)).active, false);
  assert.equal((await f.market.listings(oldId)).price, usd(1000));
  assert.equal(await f.market.currentListing(1), newId);
  await expectCustomError(f.market, () => f.market.connect(f.buyer).buy.staticCall(oldId, usd(1000), f.buyerAddress), 'InactiveListing');
  await sent(f.market.connect(f.buyer).buy(newId, usd(1100), f.buyerAddress));
});

test('seller-only cancellation and seller nonces revoke current listings even after a round-trip transfer', async t => {
  const f = await fixture(t);
  const cancelled = await list(f, 2);
  await expectCustomError(f.market, () => f.market.connect(f.outsider).cancelListing.staticCall(cancelled), 'NotSeller');
  await sent(f.market.cancelListing(cancelled));
  await expectCustomError(f.market, () => f.market.connect(f.buyer).buy.staticCall(cancelled, usd(1000), f.buyerAddress), 'InactiveListing');
  const oldId = await list(f);
  await sent(f.market.invalidateListings());
  await sent(f.nft.transferFrom(f.sellerAddress, f.nextOwnerAddress, 1));
  await sent(f.nft.connect(f.nextOwner).transferFrom(f.nextOwnerAddress, f.sellerAddress, 1));
  await expectCustomError(f.market, () => f.market.connect(f.buyer).buy.staticCall(oldId, usd(1000), f.buyerAddress), 'InactiveListing');
  const freshId = await list(f);
  assert.equal((await f.market.listings(freshId)).sellerNonce, 1n);
  await sent(f.market.connect(f.buyer).buy(freshId, usd(1000), f.buyerAddress));
});

test('expired orders, slippage limits, zero recipients, and market custody recipients are rejected', async t => {
  const f = await fixture(t);
  const id = await list(f);
  await expectCustomError(f.market, () => f.market.connect(f.buyer).buy.staticCall(id, usd(999), f.buyerAddress), 'PriceExceedsLimit');
  await expectCustomError(f.market, () => f.market.connect(f.buyer).buy.staticCall(id, usd(1000), ZeroAddress), 'InvalidRecipient');
  await expectCustomError(f.market, () => f.market.connect(f.buyer).buy.staticCall(id, usd(1000), f.market.target), 'InvalidRecipient');
  await advanceTime(f.provider, 3600);
  await expectCustomError(f.market, () => f.market.connect(f.buyer).buy.staticCall(id, usd(1000), f.buyerAddress), 'ExpiredListing');
});

test('a rejecting NFT receiver reverts the complete settlement', async t => {
  const f = await fixture(t);
  const receiver = await deploy('MarketRejectingReceiver', f.seller);
  const id = await list(f);
  await expectMinedRevert(() => f.market.connect(f.buyer).buy(id, usd(1000), receiver.target, { gasLimit: 600000 }));
  assert.equal(await f.nft.ownerOf(1), f.sellerAddress);
  assert.equal(await f.token.balanceOf(f.buyerAddress), usd(10000));
  assert.equal((await f.market.listings(id)).active, true);
});

test('NFT receiver reentrancy cannot purchase another listing during settlement', async t => {
  const f = await fixture(t);
  const first = await list(f);
  const second = await list(f, 2);
  const receiver = await deploy('MarketReenteringReceiver', f.seller, [f.market.target]);
  await sent(receiver.setTarget(second));
  await sent(f.market.connect(f.buyer).buy(first, usd(1000), receiver.target));
  assert.equal(await receiver.reentrySucceeded(), false);
  assert.equal(f.market.interface.parseError(await receiver.reentryReturnData()).name, 'ReentrancyGuardReentrantCall');
  assert.equal(await f.nft.ownerOf(1), receiver.target);
  assert.equal(await f.nft.ownerOf(2), f.sellerAddress);
  assert.equal((await f.market.listings(second)).active, true);
  assert.equal(await f.token.balanceOf(f.treasuryAddress), usd(5));
});

test('incoming transfer-tax tokens are rejected without moving the NFT or leaving a partial payment', async t => {
  const f = await fixture(t, 'MarketTaxUSDC');
  const id = await list(f);
  await expectCustomError(f.market, () => f.market.connect(f.buyer).buy.staticCall(id, usd(1000), f.buyerAddress), 'InexactPayment');
  await expectMinedRevert(() => f.market.connect(f.buyer).buy(id, usd(1000), f.buyerAddress, { gasLimit: 600000 }));
  assert.equal(await f.nft.ownerOf(1), f.sellerAddress);
  assert.equal(await f.token.balanceOf(f.buyerAddress), usd(10000));
  assert.equal(await f.token.balanceOf(f.market.target), 0n);
  assert.equal((await f.market.listings(id)).active, true);
});

test('outgoing transfer-tax tokens cannot underpay the seller even when collection was exact', async t => {
  const f = await fixture(t, 'MarketTaxUSDC');
  await sent(f.token.setTaxedSender(f.market.target));
  const id = await list(f);
  await expectCustomError(f.market, () => f.market.connect(f.buyer).buy.staticCall(id, usd(1000), f.buyerAddress), 'InexactPayment');
  await expectMinedRevert(() => f.market.connect(f.buyer).buy(id, usd(1000), f.buyerAddress, { gasLimit: 600000 }));
  assert.equal(await f.nft.ownerOf(1), f.sellerAddress);
  assert.equal(await f.token.balanceOf(f.buyerAddress), usd(10000));
  assert.equal(await f.token.balanceOf(f.sellerAddress), 0n);
  assert.equal(await f.token.balanceOf(f.treasuryAddress), 0n);
  assert.equal((await f.market.listings(id)).active, true);
});

test('subcent prices use integer fee rounding without holding payment dust', async t => {
  const f = await fixture(t);
  const id = await list(f, 1, 199n);
  await sent(f.market.connect(f.buyer).buy(id, 199n, f.buyerAddress));
  assert.equal(await f.token.balanceOf(f.sellerAddress), 199n);
  assert.equal(await f.token.balanceOf(f.treasuryAddress), 0n);
  assert.equal(await f.token.balanceOf(f.market.target), 0n);
});

test('existing market token donations cannot subsidize or change a buyer settlement', async t => {
  const f = await fixture(t);
  await sent(f.token.mint(f.market.target, usd(73)));
  const id = await list(f);
  await sent(f.market.connect(f.buyer).buy(id, usd(1000), f.buyerAddress));
  assert.equal(await f.token.balanceOf(f.market.target), usd(73));
  assert.equal(await f.token.balanceOf(f.buyerAddress), usd(9000));
  assert.equal(await f.token.balanceOf(f.sellerAddress), usd(995));
  assert.equal(await f.token.balanceOf(f.treasuryAddress), usd(5));
});

test('payment accounting still settles exactly when the seller is the immutable fee recipient', async t => {
  const f = await fixture(t);
  await sent(f.nft.mint(f.treasuryAddress, 3));
  await sent(f.nft.connect(f.treasury).approve(f.market.target, 3));
  await sent(f.market.connect(f.treasury).createListing(3, usd(1000), f.expiry));
  const id = await f.market.listingCount();
  await sent(f.market.connect(f.buyer).buy(id, usd(1000), f.buyerAddress));
  assert.equal(await f.nft.ownerOf(3), f.buyerAddress);
  assert.equal(await f.token.balanceOf(f.treasuryAddress), usd(1000));
  assert.equal(await f.token.balanceOf(f.buyerAddress), usd(9000));
  assert.equal(await f.token.balanceOf(f.market.target), 0n);
});
