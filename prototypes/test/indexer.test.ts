import { array, bigint, record, string } from '../scripts/boundaries.ts';
import type {
  IndexConfig,
  RpcLog,
  RpcSender,
} from '../scripts/indexer-types.ts';
import type { IndexSnapshot } from '../web/index-types.ts';
import type { TestContext } from 'node:test';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Interface, keccak256, toUtf8Bytes } from 'ethers';
import { MarketIndexer, ReadOnlyRpc } from '../scripts/indexer.ts';
import {
  compileContracts,
  createTestContext,
  deploy,
  advanceTime,
  sent,
  latestBlock,
} from './helpers.ts';
import { validateIndexSnapshot, indexHealth } from '../web/index-source.ts';

const ABI = compileContracts().RiftwellMarket.abi;
const LOANS_ABI = compileContracts().RiftwellLoans.abi;
const MARKET = new Interface(ABI);
const NFT = new Interface([
  'function ownerOf(uint256) view returns(address)',
  'function getApproved(uint256) view returns(address)',
  'function isApprovedForAll(address,address) view returns(bool)',
]);
const TOKEN = new Interface(['function decimals() view returns(uint8)']);
const addr = (digit: string) => `0x${digit.repeat(40)}`;
const M = addr('1'),
  N = addr('2'),
  T = addr('3'),
  SELLER = addr('4'),
  BUYER = addr('5');
const ZERO = addr('0'),
  CODE = '0x6000',
  START = 1790930000;
const h = (text: string) => keccak256(toUtf8Bytes(text));
const q = (n: number) => `0x${Number(n).toString(16)}`;

type FixtureEvent =
  | { name: 'Listed'; values: [number, string, number, number, number, number] }
  | { name: 'ListingCancelled'; values: [number] }
  | { name: 'Purchased'; values: [number, string, string, number, bigint] }
  | { name: 'SellerListingsInvalidated'; values: [string, number] };
interface MockBlock {
  number: string;
  hash: string;
  parentHash: string;
  timestamp: string;
  events: FixtureEvent[];
  logs: RpcLog[];
}
interface RpcCall {
  method: string;
  params: readonly unknown[];
}
type IndexerOptions = ConstructorParameters<typeof MarketIndexer>[0];
type IndexerOverrides = Partial<IndexerOptions>;
type RpcTransform = (
  method: string,
  params: readonly unknown[],
  value: unknown,
) => unknown | Promise<unknown>;
interface RpcControl {
  afterRead:
    | ((method: string, params: readonly unknown[]) => void | Promise<void>)
    | null;
  transform: RpcTransform | null;
}

function required<T>(value: T | undefined | null): T {
  assert.ok(
    value !== undefined && value !== null,
    'Expected fixture data to be present.',
  );
  return value;
}

const listed = (
  id = 1,
  token = 41,
  price = 1234567,
  expiry = START + 100000,
  nonce = 0,
): FixtureEvent => ({
  name: 'Listed',
  values: [id, SELLER, token, price, expiry, nonce],
});
const cancel = (id: number): FixtureEvent => ({
  name: 'ListingCancelled',
  values: [id],
});
const buy = (id: number, price: number): FixtureEvent => ({
  name: 'Purchased',
  values: [id, BUYER, BUYER, price, (BigInt(price) * 50n) / 10000n],
});

function chain(
  eventsByBlock: Record<number, FixtureEvent[]> = {},
  branch = 'base',
  head = 5,
): MockBlock[] {
  const blocks: MockBlock[] = [];
  for (let number = 0; number <= head; number++) {
    const blockHash = h(number < 3 ? `base-${number}` : `${branch}-${number}`);
    const block: MockBlock = {
      number: q(number),
      hash: blockHash,
      parentHash: number ? required(blocks.at(-1)).hash : h('genesis-parent'),
      timestamp: q(START + number * 2),
      events: eventsByBlock[number] || [],
      logs: [],
    };
    block.logs = block.events.map((event, index) => {
      const encoded = MARKET.encodeEventLog(
        required(MARKET.getEvent(event.name)),
        event.values,
      );
      return {
        address: M,
        ...encoded,
        blockNumber: q(number),
        blockHash,
        transactionHash: h(
          `${number < 3 ? 'base' : branch}-tx-${number}-${index}`,
        ),
        transactionIndex: q(index),
        logIndex: q(index),
        removed: false,
      };
    });
    blocks.push(block);
  }
  return blocks;
}

class MockRpc implements RpcSender {
  blocks: MockBlock[];
  calls: RpcCall[] = [];
  owner = SELLER;
  approved = M;
  operatorApproved = false;
  failNFT = false;
  code = CODE;
  chainId = 31337;
  decimals = 6;
  mutateDuringRead: (() => void) | null = null;
  constructor(blocks: MockBlock[]) {
    this.blocks = blocks;
  }
  async send(method: string, params: readonly unknown[]): Promise<unknown> {
    this.calls.push({ method, params });
    if (method === 'eth_chainId') return q(this.chainId);
    if (method === 'eth_blockNumber') return q(this.blocks.length - 1);
    if (method === 'eth_getBlockByNumber')
      return this.blocks[Number(BigInt(string(params[0])))] ?? null;
    if (method === 'eth_getCode') return this.code;
    if (method === 'eth_getLogs') {
      const { fromBlock, toBlock } = record(params[0]);
      return this.blocks
        .slice(
          Number(BigInt(string(fromBlock))),
          Number(BigInt(string(toBlock))) + 1,
        )
        .flatMap((b) => b.logs);
    }
    if (method !== 'eth_call')
      throw new Error('Unexpected method in read-only test');
    const call = record(params[0]);
    const to = string(call.to),
      data = string(call.data),
      height = Number(BigInt(string(params[1])));
    if (this.mutateDuringRead) {
      const change = this.mutateDuringRead;
      this.mutateDuringRead = null;
      change();
    }
    if (to.toLowerCase() === T)
      return TOKEN.encodeFunctionResult('decimals', [this.decimals]);
    if (to.toLowerCase() === N) {
      if (this.failNFT) throw new Error('NFT observation unavailable');
      const parsed = required(NFT.parseTransaction({ data }));
      const value =
        parsed.name === 'ownerOf'
          ? this.owner
          : parsed.name === 'getApproved'
            ? this.approved
            : this.operatorApproved;
      return NFT.encodeFunctionResult(parsed.name, [value]);
    }
    const parsed = required(MARKET.parseTransaction({ data }));
    let result: readonly unknown[] | undefined;
    if (parsed.name === 'collection') result = [N];
    else if (parsed.name === 'paymentToken') result = [T];
    else if (parsed.name === 'FEE_BPS') result = [50];
    else {
      // Independent mock chain's view functions. Events use numeric fixture objects,
      // not deriveOrders(), so decoded/persisted index state cannot feed its own oracle.
      const orders = new Map<
        string,
        [string, number, number, number, number, boolean]
      >();
      const current = new Map<string, number>();
      let nonce = 0;
      for (const block of this.blocks.slice(0, height + 1))
        for (const e of block.events) {
          if (e.name === 'Listed') {
            const [id, seller, token, price, expiry, sellerNonce] = e.values;
            orders.set(String(id), [
              seller,
              token,
              price,
              expiry,
              sellerNonce,
              true,
            ]);
            current.set(String(token), id);
          }
          if (e.name === 'ListingCancelled' || e.name === 'Purchased') {
            const row = orders.get(String(e.values[0]));
            if (row) {
              row[5] = false;
              current.delete(String(row[1]));
            }
          }
          if (e.name === 'SellerListingsInvalidated') nonce = e.values[1];
        }
      if (parsed.name === 'listings')
        result = orders.get(bigint(parsed.args[0]).toString()) || [
          ZERO,
          0,
          0,
          0,
          0,
          false,
        ];
      if (parsed.name === 'currentListing')
        result = [current.get(bigint(parsed.args[0]).toString()) || 0];
      if (parsed.name === 'sellerNonces') result = [nonce];
      if (parsed.name === 'listingCount') result = [orders.size];
    }
    return MARKET.encodeFunctionResult(parsed.name, required(result));
  }
}

async function fixture(
  blocks: MockBlock[] = chain({
    2: [listed()],
    3: [cancel(1)],
    4: [listed(2, 42, 999000000)],
    5: [buy(2, 999000000)],
  }),
  overrides: Partial<IndexConfig> = {},
) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'riftwell-indexer-'));
  const config = {
    chainId: 31337,
    rpcUrl: 'http://127.0.0.1:8545',
    market: M,
    collection: N,
    paymentToken: T,
    deploymentBlock: 1,
    deploymentBlockHash: blocks[1].hash,
    expectedMarketCodeHash: keccak256(CODE),
    paymentDecimals: 6,
    confirmations: 0,
    maxBlocksPerSync: 250,
    staleAfterSeconds: 90,
    ...overrides,
  };
  const rpc = new MockRpc(blocks);
  const paths = {
    statePath: path.join(dir, 'state.json'),
    viewPath: path.join(dir, 'view.json'),
  };
  const clock = () => (START + (rpc.blocks.length - 1) * 2 + 1) * 1000;
  const make = () =>
    new MarketIndexer({ config, abi: ABI, rpc, ...paths, clock });
  return {
    dir,
    config,
    rpc,
    paths,
    make,
    clean: () => fs.rm(dir, { recursive: true, force: true }),
  };
}

test('persistent indexer decodes exact amounts, cancellation and sold history from deployment', async () => {
  const f = await fixture();
  try {
    const first = await f.make().syncOnce();
    assert.equal(first.sync.status, 'synced');
    assert.equal(first.sync.stale, false);
    assert.deepEqual(
      first.listings.map((l) => l.orderState),
      ['cancelled', 'sold'],
    );
    assert.equal(first.listings[0].priceAtomic, '1234567');
    assert.equal(first.listings[1].protocolFeeAtomic, '4995000');
    assert.equal(first.transactionSimulation, 'not_performed');
    const persisted = record(
      JSON.parse(await fs.readFile(f.paths.statePath, 'utf8')),
    );
    assert.equal(array(persisted.blocks).length, 5);
    const second = await f.make().syncOnce(); // Separate instance proves restart hydration.
    assert.deepEqual(second.listings, first.listings);
    assert.equal(second.sync.rolledBackBlocks, 0);
    assert.ok(
      f.rpc.calls.every((c) =>
        [
          'eth_chainId',
          'eth_blockNumber',
          'eth_getBlockByNumber',
          'eth_getCode',
          'eth_getLogs',
          'eth_call',
        ].includes(c.method),
      ),
    );
  } finally {
    await f.clean();
  }
});

test('reorganization rolls back cancelled/sold orders and persists replacement canonical events', async () => {
  const f = await fixture();
  try {
    await f.make().syncOnce();
    f.rpc.blocks = chain(
      { 2: [listed()], 4: [listed(2, 42, 999000000)], 5: [cancel(2)] },
      'replacement',
    );
    const replacement = await f.make().syncOnce();
    assert.equal(replacement.sync.rolledBackBlocks, 3);
    assert.deepEqual(
      replacement.listings.map((l) => l.orderState),
      ['active', 'cancelled'],
    );
    assert.equal(
      replacement.listings[0].observation.status,
      'ownership_and_approval_observed',
    );
    assert.equal(
      replacement.listings[0].observation.transactionSimulation,
      'not_performed',
    );
    const persisted = record(
      JSON.parse(await fs.readFile(f.paths.statePath, 'utf8')),
    );
    assert.equal(
      record(array(persisted.blocks).at(-1)).hash,
      f.rpc.blocks[5].hash,
    );
    assert.equal(array(persisted.reorgs).length, 1);
    assert.ok(!JSON.stringify(persisted.blocks).includes(h('base-tx-5-0')));
    const restart = await f.make().syncOnce();
    assert.deepEqual(restart.listings, replacement.listings);
  } finally {
    await f.clean();
  }
});

test('seller nonce invalidation survives restart and later explicit cancellation remains valid', async () => {
  const f = await fixture(
    chain({
      2: [listed()],
      3: [{ name: 'SellerListingsInvalidated', values: [SELLER, 1] }],
    }),
  );
  try {
    let view = await f.make().syncOnce();
    assert.equal(view.listings[0].orderState, 'invalidated');
    f.rpc.blocks = chain(
      {
        2: [listed()],
        3: [{ name: 'SellerListingsInvalidated', values: [SELLER, 1] }],
        6: [cancel(1)],
      },
      'base',
      6,
    );
    view = await f.make().syncOnce();
    assert.equal(view.listings[0].orderState, 'cancelled');
  } finally {
    await f.clean();
  }
});

test('confirmed batching exposes lag/stale state until the canonical target is caught up', async () => {
  const f = await fixture(chain({ 2: [listed()], 4: [cancel(1)] }, 'base', 6), {
    confirmations: 1,
    maxBlocksPerSync: 2,
  });
  try {
    let view = await f.make().syncOnce();
    assert.equal(required(view.sync.indexedThrough).number, 2);
    assert.equal(view.sync.lagBlocks, 3);
    assert.equal(view.sync.status, 'catching_up');
    assert.equal(view.sync.stale, true);
    assert.equal(view.listings[0].observation.atBlock, 2);
    view = await f.make().syncOnce();
    assert.equal(required(view.sync.indexedThrough).number, 4);
    assert.equal(view.listings[0].orderState, 'cancelled');
    view = await f.make().syncOnce();
    assert.equal(required(view.sync.indexedThrough).number, 5);
    assert.equal(view.sync.lagBlocks, 0);
    assert.equal(view.sync.stale, false);
  } finally {
    await f.clean();
  }
});

test('owner mismatch, absent approval, missing RPC fields and expiry are distinct observations', async () => {
  const f = await fixture(chain({ 2: [listed(1, 41, 1234567, START + 9)] }));
  try {
    let view = await f.make().syncOnce();
    assert.equal(view.listings[0].orderState, 'expired');
    f.rpc.owner = BUYER;
    view = await f.make().syncOnce();
    assert.equal(view.listings[0].observation.status, 'owner_mismatch');
    f.rpc.owner = SELLER;
    f.rpc.approved = ZERO;
    view = await f.make().syncOnce();
    assert.equal(view.listings[0].observation.status, 'approval_missing');
    f.rpc.operatorApproved = true;
    view = await f.make().syncOnce();
    assert.equal(
      view.listings[0].observation.status,
      'ownership_and_approval_observed',
    );
    f.rpc.failNFT = true;
    view = await f.make().syncOnce();
    assert.equal(view.listings[0].observation.status, 'unavailable');
    assert.equal(view.listings[0].observation.owner, undefined);
    assert.equal(view.sync.status, 'partial_observations');
    assert.equal(view.sync.stale, true);
  } finally {
    await f.clean();
  }
});

test('omitted events and wrong payment decimals cannot be published as a fresh index', async () => {
  const f = await fixture(chain({ 2: [listed()], 4: [cancel(1)] }));
  try {
    await f.make().syncOnce();
    const original = await fs.readFile(f.paths.statePath, 'utf8');
    f.rpc.decimals = 18;
    await assert.rejects(() => f.make().syncOnce(), /decimals/);
    f.rpc.decimals = 6;
    assert.equal(await fs.readFile(f.paths.statePath, 'utf8'), original);
    // New replacement branch has a listing but the RPC suppresses its Listed log.
    f.rpc.blocks = chain(
      { 2: [listed()], 4: [listed(2, 42, 1000000)] },
      'omit-events',
    );
    f.rpc.blocks[4].logs = [];
    await assert.rejects(() => f.make().syncOnce(), /listing count/);
    assert.equal(await fs.readFile(f.paths.statePath, 'utf8'), original);
    // Suppressing cancellation also contradicts its pinned onchain active flag.
    f.rpc.blocks = chain({ 2: [listed()], 4: [cancel(1)] }, 'omit-cancel');
    f.rpc.blocks[4].logs = [];
    await assert.rejects(() => f.make().syncOnce(), /activity differs/);
    assert.equal(await fs.readFile(f.paths.statePath, 'utf8'), original);
  } finally {
    await f.clean();
  }
});

test('wrong chain, changed deployment anchor/code and mid-read reorg fail without altering journal', async () => {
  const f = await fixture(chain({ 2: [listed()] }));
  try {
    await f.make().syncOnce();
    const original = await fs.readFile(f.paths.statePath, 'utf8');
    f.rpc.chainId = 1;
    await assert.rejects(() => f.make().syncOnce(), /chain ID/);
    f.rpc.chainId = 31337;
    assert.equal(await fs.readFile(f.paths.statePath, 'utf8'), original);
    f.rpc.code = '0x6001';
    await assert.rejects(() => f.make().syncOnce(), /bytecode/);
    f.rpc.code = CODE;
    f.rpc.blocks[1].hash = h('wrong-anchor');
    await assert.rejects(() => f.make().syncOnce(), /Deployment block/);
    f.rpc.blocks[1].hash = f.config.deploymentBlockHash;
    f.rpc.mutateDuringRead = () =>
      (f.rpc.blocks = chain({ 2: [listed()] }, 'changed-mid-read'));
    await assert.rejects(() => f.make().syncOnce(), /Chain changed/);
    assert.equal(await fs.readFile(f.paths.statePath, 'utf8'), original);
    const view = record(
      JSON.parse(await fs.readFile(f.paths.viewPath, 'utf8')),
    );
    assert.equal(record(view.sync).status, 'error');
    assert.equal(record(view.sync).stale, true);
    assert.ok(record(view.sync).lastSuccessfulSyncAt);
    assert.ok(record(view.sync).lastAttemptAt);
    assert.ok(
      (await fs.readdir(f.dir)).every(
        (name) => !name.endsWith('.tmp') && !name.endsWith('.lock'),
      ),
    );
  } finally {
    await f.clean();
  }
});

test('a regressed RPC head is an unavailable observation, not evidence to discard confirmed journal', async () => {
  const f = await fixture();
  try {
    await f.make().syncOnce();
    const before = await fs.readFile(f.paths.statePath, 'utf8');
    f.rpc.blocks = f.rpc.blocks.slice(0, 4);
    await assert.rejects(() => f.make().syncOnce(), /head regressed/);
    assert.equal(await fs.readFile(f.paths.statePath, 'utf8'), before);
  } finally {
    await f.clean();
  }
});

test('deployment identity mismatch, malformed history and overlapping writers fail closed', async () => {
  const f = await fixture();
  try {
    await f.make().syncOnce();
    const state = record(
      JSON.parse(await fs.readFile(f.paths.statePath, 'utf8')),
    );
    state.identity = h('other-deployment');
    await fs.writeFile(f.paths.statePath, JSON.stringify(state));
    await assert.rejects(() => f.make().syncOnce(), /another deployment/);
    state.identity = f.make().identity;
    record(array(state.blocks)[2]).parentHash = h('wrong-parent');
    await fs.writeFile(f.paths.statePath, JSON.stringify(state));
    await assert.rejects(() => f.make().syncOnce(), /not contiguous/);
    await fs.writeFile(`${f.paths.statePath}.lock`, 'existing writer');
    await assert.rejects(() => f.make().syncOnce(), { code: 'EEXIST' });
    assert.equal(
      await fs.readFile(`${f.paths.statePath}.lock`, 'utf8'),
      'existing writer',
    );
  } finally {
    await f.clean();
  }
});

test('read-only RPC wrapper rejects all transaction/signing methods before any network call', async () => {
  let requests = 0;
  const rpc = new ReadOnlyRpc('http://127.0.0.1:8545', async () => {
    requests++;
    throw new Error('not used');
  });
  for (const method of [
    'eth_sendTransaction',
    'eth_sendRawTransaction',
    'personal_sign',
    'eth_signTypedData_v4',
    'wallet_switchEthereumChain',
  ])
    await assert.rejects(() => rpc.send(method, []), /rejected/);
  assert.equal(requests, 0);
});

test('actual local EVM ABI events and ownership reads survive cancellation rollback', async () => {
  const c = await createTestContext();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'riftwell-evm-indexer-'));
  try {
    const nft = await deploy('MarketTestNFT', c.signers[0]);
    const usdc = await deploy('MarketTestUSDC', c.signers[0]);
    const market = await deploy('RiftwellMarket', c.signers[0], [
      await nft.getAddress(),
      await usdc.getAddress(),
      c.addresses[9],
    ]);
    const deploymentReceipt = required(
      await required(market.deploymentTransaction()).wait(),
    );
    const block = required(
      await c.evm.request({
        method: 'eth_getBlockByNumber',
        params: [q(deploymentReceipt.blockNumber), false],
      }),
    );
    const code = await c.evm.request({
      method: 'eth_getCode',
      params: [await market.getAddress(), 'latest'],
    });
    await (await nft.mint(c.addresses[1], 41)).wait();
    await (
      await nft.connect(c.signers[1]).approve(await market.getAddress(), 41)
    ).wait();
    const head = await latestBlock(c.provider);
    await (
      await market
        .connect(c.signers[1])
        .createListing(41, 1234567n, head.timestamp + 100000)
    ).wait();
    const calls: string[] = [];
    const rpc: RpcSender = {
      send: async (method, params) => {
        calls.push(method);
        return c.provider.send(method, [...params]);
      },
    };
    const config = {
      chainId: 31337,
      rpcUrl: 'http://127.0.0.1:8545',
      market: await market.getAddress(),
      collection: await nft.getAddress(),
      paymentToken: await usdc.getAddress(),
      deploymentBlock: deploymentReceipt.blockNumber,
      deploymentBlockHash: block.hash,
      expectedMarketCodeHash: keccak256(code),
      confirmations: 0,
    };
    const make = () =>
      new MarketIndexer({
        config,
        abi: ABI,
        rpc,
        statePath: path.join(dir, 'state.json'),
        viewPath: path.join(dir, 'view.json'),
      });
    let view = await make().syncOnce();
    assert.equal(view.listings[0].priceAtomic, '1234567');
    assert.equal(
      view.listings[0].observation.status,
      'ownership_and_approval_observed',
    );
    const snapshot = await c.evm.request({
      method: 'evm_snapshot',
      params: [],
    });
    await (await market.connect(c.signers[1]).cancelListing(1)).wait();
    view = await make().syncOnce();
    assert.equal(view.listings[0].orderState, 'cancelled');
    await c.evm.request({ method: 'evm_revert', params: [snapshot] });
    await advanceTime(c.provider, 2); // Replacement branch restores listing, at same head height.
    view = await make().syncOnce();
    assert.equal(view.sync.rolledBackBlocks, 1);
    assert.equal(view.listings[0].orderState, 'active');
    assert.equal(
      view.listings[0].observation.status,
      'ownership_and_approval_observed',
    );
    assert.ok(
      calls.every(
        (method) =>
          !method.startsWith('evm_') && method !== 'eth_sendTransaction',
      ),
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
    c.close();
  }
});

async function financedFixture(t: TestContext) {
  const c = await createTestContext();
  const dir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'riftwell-financed-indexer-'),
  );
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
    c.close();
  });
  const nft = await deploy('LoanTestNFT', c.signers[0]);
  const token = await deploy('MarketTestUSDC', c.signers[0]);
  const voter = await deploy('LoanTestVoter', c.signers[0], [nft.target]);
  const market = await deploy('RiftwellMarket', c.signers[0], [
    nft.target,
    token.target,
    c.addresses[9],
  ]);
  const loans = await deploy('RiftwellLoans', c.signers[0], [
    nft.target,
    token.target,
    voter.target,
    c.addresses[9],
    c.addresses[9],
    true,
  ]);
  const marketReceipt = required(
      await required(market.deploymentTransaction()).wait(),
    ),
    loanReceipt = required(
      await required(loans.deploymentTransaction()).wait(),
    );
  const marketBlock = required(
    await c.evm.request({
      method: 'eth_getBlockByNumber',
      params: [q(marketReceipt.blockNumber), false],
    }),
  );
  const loanBlock = required(
    await c.evm.request({
      method: 'eth_getBlockByNumber',
      params: [q(loanReceipt.blockNumber), false],
    }),
  );
  const marketCode = await c.evm.request({
    method: 'eth_getCode',
    params: [market.target, 'latest'],
  });
  const loanCode = await c.evm.request({
    method: 'eth_getCode',
    params: [loans.target, 'latest'],
  });
  const now = Number((await latestBlock(c.provider)).timestamp),
    day = 86400;
  for (const id of [1, 2, 3, 4]) {
    await sent(nft.mint(c.addresses[2], id));
    await sent(nft.setLock(id, 100000n * 10n ** 18n, now + 730 * day));
  }
  await sent(nft.connect(c.signers[2]).setApprovalForAll(loans.target, true));
  await sent(nft.connect(c.signers[2]).setApprovalForAll(market.target, true));
  for (const who of [1, 2, 3]) {
    await sent(token.mint(c.addresses[who], 10n ** 24n));
    await sent(token.connect(c.signers[who]).approve(loans.target, 10n ** 24n));
  }
  const config = {
    chainId: 31337,
    rpcUrl: 'http://127.0.0.1:8545',
    market: market.target,
    collection: nft.target,
    paymentToken: token.target,
    deploymentBlock: marketReceipt.blockNumber,
    deploymentBlockHash: marketBlock.hash,
    expectedMarketCodeHash: keccak256(marketCode),
    confirmations: 0,
    loans: {
      address: loans.target,
      deploymentBlock: loanReceipt.blockNumber,
      deploymentBlockHash: loanBlock.hash,
      expectedCodeHash: keccak256(loanCode),
      voter: voter.target,
      treasury: c.addresses[9],
      guardian: c.addresses[9],
      claimsVerified: true,
    },
  };
  const calls: RpcCall[] = [];
  const control: RpcControl = { afterRead: null, transform: null };
  const rpc: RpcSender = {
    send: async (method, params) => {
      calls.push({ method, params });
      const value: unknown = await c.provider.send(method, [...params]);
      const transformed = control.transform
        ? await control.transform(method, params, value)
        : value;
      if (control.afterRead) await control.afterRead(method, params);
      return transformed;
    },
  };
  const make = (overrides: IndexerOverrides = {}) =>
    new MarketIndexer({
      config,
      abi: ABI,
      loansAbi: LOANS_ABI,
      rpc,
      statePath: path.join(dir, 'state.json'),
      viewPath: path.join(dir, 'view.json'),
      ...overrides,
    });
  const open = async (tokenId = 1, principal = 1_000_000_000n, apr = 0) => {
    await sent(
      loans
        .connect(c.signers[1])
        .fundOffer(
          c.addresses[2],
          tokenId,
          principal,
          apr,
          30 * day,
          now + 30 * day,
          now + 30 * day,
          1,
        ),
    );
    const offerId = await loans.offerCount();
    await sent(loans.connect(c.signers[2]).acceptOffer(offerId));
    return await loans.loanCount();
  };
  const list = async (
    loanId: bigint,
    price = 1_250_000_000n,
    expiry = now + 29 * day,
  ) => {
    await sent(
      loans.connect(c.signers[2]).listFinancedCollateral(loanId, price, expiry),
    );
    return await loans.financedListingCount();
  };
  const save = async (label: string, view: IndexSnapshot) => {
    validateIndexSnapshot(view);
    const evidenceDir = process.env.RIFTWELL_INDEXER_EVIDENCE_DIR;
    if (evidenceDir) {
      await fs.mkdir(evidenceDir, { recursive: true });
      await fs.writeFile(
        path.join(evidenceDir, `${label}.json`),
        `${JSON.stringify({ evidenceType: 'local-in-process-EVM-fixture-only', snapshot: view }, null, 2)}\n`,
      );
    }
  };
  return {
    ...c,
    nft,
    token,
    market,
    loans,
    config,
    calls,
    control,
    make,
    sent,
    open,
    list,
    save,
    dir,
    now,
    day,
  };
}

test('actual EVM mixed orders preserve financed repricing, cancellation, repayment closure and exact account credits', async (t) => {
  const f = await financedFixture(t);
  await f.sent(
    f.market
      .connect(f.signers[2])
      .createListing(4, 1_234_567n, f.now + 20 * f.day),
  );
  const loanId = await f.open(1, 1_000_000_000n, 1200);
  await f.list(loanId, 1_007_000_000n);
  let view = await f.make().syncOnce();
  assert.deepEqual(
    view.listings.map((order) => order.orderKey),
    ['market:1', 'financed:1'],
  );
  assert.equal(
    view.listings[1].observation.status,
    'custody_and_debt_observed',
  );
  assert.equal(required(view.listings[1].coverage).coversDebt, true);
  assert.equal(required(view.listings[1].coverage).saleFeeAtomic, '5035000');
  await f.save('01-mixed-listed', view);
  await advanceTime(f.provider, 7 * f.day);
  view = await f.make().syncOnce();
  assert.equal(view.listings[1].observation.status, 'debt_not_covered');
  assert.equal(required(view.listings[1].debt).totalAtomic, '1002301369');
  assert.equal(
    required(view.listings[1].coverage).borrowerResidualAtomic,
    null,
  );
  await f.save('02-interest-uncovered', view);
  await f.list(loanId, 1_250_000_000n);
  view = await f.make().syncOnce();
  assert.equal(view.listings[1].orderState, 'cancelled');
  assert.equal(view.listings[1].cancellationReason, 'repriced');
  assert.equal(view.listings[2].orderState, 'active');
  await f.save('03-repriced', view);
  await f.sent(f.loans.connect(f.signers[2]).cancelFinancedListing(2));
  view = await f.make().syncOnce();
  assert.equal(view.listings[2].cancellationReason, 'borrower_cancelled');
  await f.save('04-cancelled', view);
  await f.list(loanId);
  await f.sent(f.loans.connect(f.signers[2]).repay(loanId, 500_000_000n));
  view = await f.make().syncOnce();
  assert.equal(required(view.loans)[0].principalAtomic, '502301369');
  assert.equal(required(view.loans)[0].accruedInterestAtomic, '0');
  assert.ok(BigInt(required(view.loans)[0].interestRemainder) > 0n);
  assert.equal(
    required(
      required(view.creditAccounts).find(
        (row) => row.account === f.addresses[1].toLowerCase(),
      ),
    ).lenderCreditAtomic,
    '500000000',
  );
  await f.save('05-partial-repayment', view);
  await f.sent(f.loans.connect(f.signers[2]).repay(loanId, 10n ** 24n));
  view = await f.make().syncOnce();
  assert.equal(view.listings[3].orderState, 'cancelled');
  assert.equal(view.listings[3].cancellationReason, 'loan_closed');
  assert.equal(required(view.loans)[0].loanState, 'repaid');
  assert.equal(required(view.loans)[0].collateralState, 'custody');
  assert.equal(required(required(view.loans)[0].debt).totalAtomic, '0');
  assert.equal(required(view.loans)[0].observation.ownerMatchesCustody, true);
  await f.save('06-repaid-custody', view);
  await f.sent(
    f.loans.connect(f.signers[2]).withdrawCollateral(loanId, f.addresses[2]),
  );
  await f.sent(
    f.loans
      .connect(f.signers[1])
      .withdrawLenderCredit(f.addresses[1], 1_002_301_369n),
  );
  view = await f.make().syncOnce();
  assert.equal(required(view.loans)[0].collateralState, 'withdrawn');
  assert.equal(
    required(view.loans)[0].observation.owner,
    f.addresses[2].toLowerCase(),
  );
  assert.equal(
    required(
      required(view.creditAccounts).find(
        (row) => row.account === f.addresses[1].toLowerCase(),
      ),
    ).lenderCreditAtomic,
    '0',
  );
  const restart = await f.make().syncOnce();
  assert.deepEqual(restart.listings, view.listings);
  assert.deepEqual(
    required(restart.creditAccounts),
    required(view.creditAccounts),
  );
  await f.save('07-withdrawn-restart', restart);
  assert.ok(
    f.calls.every((call) =>
      [
        'eth_chainId',
        'eth_blockNumber',
        'eth_getBlockByNumber',
        'eth_getCode',
        'eth_getLogs',
        'eth_call',
      ].includes(call.method),
    ),
  );
});

test('actual financed EVM sale and reorg restore debt, custody, listing and credits across restarts', async (t) => {
  const f = await financedFixture(t),
    loanId = await f.open();
  const listingId = await f.list(loanId);
  const before = await f.make().syncOnce();
  const fork = await f.evm.request({ method: 'evm_snapshot', params: [] });
  await f.sent(
    f.loans
      .connect(f.signers[3])
      .buyFinancedCollateral(listingId, 1_250_000_000n, f.addresses[3]),
  );
  let view = await f.make().syncOnce();
  assert.equal(view.listings[0].orderState, 'sold');
  assert.equal(view.listings[0].debtPaidAtomic, '1000000000');
  assert.equal(view.listings[0].protocolFeeAtomic, '6250000');
  assert.equal(view.listings[0].borrowerProceedsAtomic, '243750000');
  assert.equal(required(view.loans)[0].loanState, 'sold');
  assert.equal(required(view.loans)[0].collateralState, 'withdrawn');
  assert.equal(required(required(view.loans)[0].debt).totalAtomic, '0');
  assert.equal(
    required(view.loans)[0].observation.owner,
    f.addresses[3].toLowerCase(),
  );
  assert.equal(
    required(
      required(view.creditAccounts).find(
        (row) => row.account === f.addresses[2].toLowerCase(),
      ),
    ).borrowerCreditAtomic,
    '243750000',
  );
  await f.save('08-sold', view);
  assert.deepEqual((await f.make().syncOnce()).listings, view.listings);
  await f.evm.request({ method: 'evm_revert', params: [fork] });
  await advanceTime(f.provider, 2);
  view = await f.make().syncOnce();
  assert.equal(view.sync.rolledBackBlocks, 1);
  assert.equal(view.listings[0].orderState, 'active');
  assert.equal(required(view.loans)[0].loanState, 'active');
  assert.equal(required(view.loans)[0].collateralState, 'custody');
  assert.equal(
    required(required(view.loans)[0].debt).totalAtomic,
    required(required(before.loans)[0].debt).totalAtomic,
  );
  assert.ok(
    required(view.creditAccounts).every(
      (row) =>
        row.lenderCreditAtomic === '0' && row.borrowerCreditAtomic === '0',
    ),
  );
  assert.deepEqual((await f.make().syncOnce()).listings, view.listings);
  await f.save('09-sale-reorg-restart', view);
  await f.sent(
    f.loans
      .connect(f.signers[3])
      .buyFinancedCollateral(listingId, 1_250_000_000n, f.addresses[3]),
  );
  await f.sent(
    f.loans
      .connect(f.signers[2])
      .withdrawBorrowerCredit(f.addresses[2], 43_750_000n),
  );
  await f.sent(
    f.loans
      .connect(f.signers[1])
      .withdrawLenderCredit(f.addresses[1], 300_000_000n),
  );
  view = await f.make().syncOnce();
  assert.equal(
    required(
      required(view.creditAccounts).find(
        (row) => row.account === f.addresses[2].toLowerCase(),
      ),
    ).borrowerCreditAtomic,
    '200000000',
  );
  assert.equal(
    required(
      required(view.creditAccounts).find(
        (row) => row.account === f.addresses[1].toLowerCase(),
      ),
    ).lenderCreditAtomic,
    '700000000',
  );
  await f.save('10-credit-withdrawals', view);
});

test('actual financed EVM cancelled offers, large exact integers, forgiveness and expiry remain distinct', async (t) => {
  const f = await financedFixture(t),
    large = 9_007_199_254_741_993n;
  await f.sent(
    f.loans
      .connect(f.signers[1])
      .fundOffer(
        f.addresses[2],
        2,
        large,
        0,
        30 * f.day,
        f.now + f.day,
        f.now + 30 * f.day,
        1,
      ),
  );
  await f.sent(f.loans.connect(f.signers[1]).cancelOffer(1));
  let view = await f.make().syncOnce();
  assert.equal(
    required(
      required(view.creditAccounts).find(
        (row) => row.account === f.addresses[1].toLowerCase(),
      ),
    ).lenderCreditAtomic,
    large.toString(),
  );
  await f.save('11-offer-refund-exact-integer', view);
  const id = await f.open(1, large, 10_000);
  await f.list(id, large * 2n, f.now + 100);
  await advanceTime(f.provider, 101);
  view = await f.make().syncOnce();
  assert.equal(view.listings[0].orderState, 'expired');
  assert.equal(
    required(required(view.loans)[0].debt).totalAtomic,
    (await f.loans.debt(id)).total.toString(),
  );
  await f.save('12-expired-exact-debt', view);
  await f.sent(f.loans.connect(f.signers[1]).forgiveDebt(id));
  view = await f.make().syncOnce();
  assert.equal(required(view.loans)[0].loanState, 'forgiven');
  assert.equal(required(required(view.loans)[0].debt).totalAtomic, '0');
  assert.equal(view.listings[0].cancellationReason, 'loan_closed');
  assert.equal(
    required(
      required(view.creditAccounts).find(
        (row) => row.account === f.addresses[1].toLowerCase(),
      ),
    ).lenderCreditAtomic,
    large.toString(),
  );
  await f.save('13-forgiven', view);
});

test('financed source integrity, omitted events, unavailable observations and mid-read reorg fail closed on actual EVM', async (t) => {
  const f = await financedFixture(t),
    loanId = await f.open();
  await f.list(loanId);
  const original = await f.make().syncOnce(),
    statePath = path.join(f.dir, 'state.json');
  const journal = await fs.readFile(statePath, 'utf8');
  const rejectsPreserved = async (
    overrides: IndexerOverrides,
    pattern: RegExp,
  ) => {
    await assert.rejects(() => f.make(overrides).syncOnce(), pattern);
    assert.equal(await fs.readFile(statePath, 'utf8'), journal);
  };
  // Changing expected configuration changes checkpoint identity and requires a new state file.
  await rejectsPreserved(
    {
      config: {
        ...f.config,
        loans: { ...f.config.loans, claimsVerified: false },
      },
    },
    /another deployment/,
  );
  f.control.transform = (method, params, value) =>
    method === 'eth_getCode' &&
    string(params[0]).toLowerCase() === f.loans.target.toLowerCase()
      ? '0x6001'
      : value;
  await rejectsPreserved({}, /Loan manager bytecode/);
  f.control.transform = null;
  const loanIface = new Interface(LOANS_ABI),
    debtSelector = required(loanIface.getFunction('debt')).selector;
  f.control.transform = (method, params, value) =>
    method === 'eth_call' &&
    string(record(params[0]).to).toLowerCase() ===
      f.loans.target.toLowerCase() &&
    string(record(params[0]).data).startsWith(
      required(loanIface.getFunction('voter')).selector,
    )
      ? loanIface.encodeFunctionResult('voter', [f.addresses[8]])
      : value;
  await rejectsPreserved({}, /immutable configuration/);
  f.control.transform = null;
  f.control.transform = (method, params, value) =>
    method === 'eth_getBlockByNumber' &&
    params[0] === q(f.config.loans.deploymentBlock)
      ? { ...record(value), hash: h('wrong-loan-deployment-anchor') }
      : value;
  await rejectsPreserved({}, /Loan deployment block hash/);
  f.control.transform = null;
  f.control.transform = (method, params, value) =>
    method === 'eth_call' &&
    string(record(params[0]).data).startsWith(debtSelector)
      ? loanIface.encodeFunctionResult('debt', [
          1_000_000_000n,
          0,
          1_000_000_001n,
        ])
      : value;
  await rejectsPreserved({}, /exact indexed debt/);
  f.control.transform = null;
  f.control.transform = (method, params, value) => {
    if (
      method === 'eth_call' &&
      string(record(params[0]).to).toLowerCase() ===
        f.nft.target.toLowerCase() &&
      string(record(params[0]).data).startsWith(
        required(NFT.getFunction('ownerOf')).selector,
      )
    )
      throw new Error('Unavailable owner');
    return value;
  };
  let view = await f.make().syncOnce();
  assert.equal(view.sync.status, 'partial_observations');
  assert.equal(view.sync.stale, true);
  assert.equal(view.listings[0].observation.status, 'unavailable');
  assert.equal(view.listings[0].coverage, undefined);
  await f.save('14-unavailable-failclosed', view);
  f.control.transform = null;
  const partialJournal = await fs.readFile(statePath, 'utf8');
  const fork = await f.evm.request({ method: 'evm_snapshot', params: [] });
  await f.sent(f.loans.connect(f.signers[2]).cancelFinancedListing(1));
  f.control.transform = (method, params, value) =>
    method === 'eth_getLogs'
      ? array(value).filter(
          (log) =>
            array(record(log).topics)[0] !==
            required(loanIface.getEvent('FinancedListingCancelled')).topicHash,
        )
      : value;
  await assert.rejects(() => f.make().syncOnce(), /financed order differs/);
  assert.equal(await fs.readFile(statePath, 'utf8'), partialJournal);
  f.control.transform = null;
  let mutated = false;
  f.control.afterRead = async (method) => {
    if (method === 'eth_call' && !mutated) {
      mutated = true;
      await f.evm.request({ method: 'evm_revert', params: [fork] });
      await advanceTime(f.provider, 2);
    }
  };
  await assert.rejects(
    () => f.make().syncOnce(),
    /Chain changed|financed order differs/,
  );
  assert.equal(mutated, true);
  assert.equal(await fs.readFile(statePath, 'utf8'), partialJournal);
  f.control.afterRead = null;
  view = await f.make().syncOnce();
  assert.equal(view.listings[0].orderState, 'active');
  await f.save('15-midread-reorg-recovery', view);
  assert.equal(
    indexHealth(
      original,
      Date.parse(required(original.sync.lastSuccessfulSyncAt)) + 91_000,
    ).stale,
    true,
  );
  const pinnedCalls = f.calls.filter((call) => call.method === 'eth_call');
  assert.ok(
    pinnedCalls.every((call) => /^0x[0-9a-f]+$/i.test(string(call.params[1]))),
  );
});
