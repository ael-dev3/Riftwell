import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Interface } from 'ethers';
import { createChain, KITTEN_CHAIN, tokenId } from '../chain.ts';

const now = Date.parse('2026-10-02T18:00:00Z');
const owner = '0x1111111111111111111111111111111111111111';
const other = '0x2222222222222222222222222222222222222222';
const blockHash = `0x${'ab'.repeat(32)}`;
const abi = new Interface([
  'function ownerOf(uint256) view returns (address)',
  'function locked(uint256) view returns (int128,uint256)',
  'function balanceOfNFT(uint256) view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function tokenOfOwnerByIndex(address,uint256) view returns (uint256)',
  'function MAXTIME() view returns (uint256)',
]);

type Overrides = Partial<
  Record<
    | 'wrongChain'
    | 'reorg'
    | 'stale'
    | 'staleHead'
    | 'malformedHead'
    | 'ignoredBlock'
    | 'noCode'
    | 'unsupportedPin'
    | 'missing'
    | 'moved'
    | 'negative'
    | 'empty'
    | 'malformedCall'
    | 'wrongId',
    boolean
  >
> & { http?: number };
interface RpcFixtureRequest {
  id: number;
  method: string;
  params: [
    { to: string; data: string } | string,
    { blockHash: string; requireCanonical: boolean }?,
  ];
}
function fixture(overrides: Overrides = {}) {
  const requests: RpcFixtureRequest[] = [];
  let head = 100;
  let safeReads = 0;
  const fetcher: typeof fetch = async (_url, options) => {
    assert.ok(options && typeof options.body === 'string');
    const request = JSON.parse(options.body) as RpcFixtureRequest;
    requests.push(request);
    if (overrides.http) return new Response('{}', { status: overrides.http });
    let result;
    if (request.method === 'eth_chainId')
      result = overrides.wrongChain ? '0x1' : '0x3e7';
    else if (request.method === 'eth_getBlockByNumber') {
      const latest = request.params[0] === 'latest';
      assert.equal(typeof request.params[0], 'string');
      if (!latest) safeReads += 1;
      result = {
        number: latest ? `0x${head.toString(16)}` : request.params[0],
        hash:
          overrides.reorg && safeReads > 1 ? `0x${'cd'.repeat(32)}` : blockHash,
        timestamp: `0x${(BigInt(now / 1000) - BigInt(overrides.stale || (latest && overrides.staleHead) ? 600 : 3)).toString(16)}`,
      };
      if (overrides.malformedHead && latest) result.number = 'not-a-block';
      if (overrides.ignoredBlock && !latest) result.number = '0x64';
    } else if (request.method === 'eth_getCode')
      result = overrides.noCode ? '0x' : '0x6000';
    else if (request.method === 'eth_call') {
      assert.ok(typeof request.params[0] === 'object');
      assert.equal(request.params[0].to, KITTEN_CHAIN.escrow);
      assert.deepEqual(request.params[1], {
        blockHash,
        requireCanonical: true,
      });
      const call = abi.parseTransaction({ data: request.params[0].data });
      assert.ok(call);
      if (overrides.unsupportedPin)
        return Response.json({
          jsonrpc: '2.0',
          id: request.id,
          error: { code: -32602, message: 'unsupported block reference' },
        });
      if (call.name === 'ownerOf') {
        if (overrides.missing || call.args[0] === 999n)
          return Response.json({
            jsonrpc: '2.0',
            id: request.id,
            error: { code: 3, message: 'execution reverted' },
          });
        result = abi.encodeFunctionResult(call.name, [
          overrides.moved ? other : owner,
        ]);
      } else if (call.name === 'locked')
        result = abi.encodeFunctionResult(call.name, [
          overrides.negative ? -1n : 123456789012345678901234n,
          BigInt(now / 1000 + 86400 * 365),
        ]);
      else if (call.name === 'balanceOfNFT')
        result = abi.encodeFunctionResult(call.name, [99999999999999999999n]);
      else if (call.name === 'balanceOf')
        result = abi.encodeFunctionResult(call.name, [overrides.empty ? 0 : 3]);
      else if (call.name === 'tokenOfOwnerByIndex')
        result = abi.encodeFunctionResult(call.name, [call.args[1] + 1n]);
      else if (call.name === 'MAXTIME')
        result = abi.encodeFunctionResult(call.name, [63072000n]);
      if (overrides.malformedCall) result = '0x1234';
    } else assert.fail(`Write or unexpected RPC method: ${request.method}`);
    return Response.json({
      jsonrpc: '2.0',
      id: overrides.wrongId ? request.id + 1 : request.id,
      result,
    });
  };
  return {
    chain: createChain({ fetch: fetcher, now: () => now }),
    requests,
    advanceHead: (number: number) => {
      head = number;
    },
  };
}

test('reads exact lock/owner/voting power at a canonical block without transaction RPC', async () => {
  const { chain, requests } = fixture();
  const position = await chain.getPosition('1');
  assert.equal(position.owner, owner);
  assert.equal(position.lockedAmountRaw, '123456789012345678901234');
  assert.equal(position.votingPowerRaw, '99999999999999999999');
  assert.equal(position.blockNumber, 98);
  assert.equal(position.blockHash, blockHash);
  assert.equal(position.marketId, 'kittenswap');
  assert.ok(
    requests.every(
      (request) =>
        !request.method.includes('send') && !request.method.includes('sign'),
    ),
  );
});

test('ownership pages retain their block and owner, with an explicit empty account', async () => {
  const { chain } = fixture();
  const first = await chain.getOwnedPositions(owner, { limit: 2 });
  assert.deepEqual(
    first.items.map((position) => position.tokenId),
    ['1', '2'],
  );
  assert.equal(typeof first.nextCursor, 'string');
  const second = await chain.getOwnedPositions(owner, {
    limit: 2,
    cursor: first.nextCursor,
  });
  assert.deepEqual(
    second.items.map((position) => position.tokenId),
    ['3'],
  );
  assert.equal(second.nextCursor, null);
  await assert.rejects(
    chain.getOwnedPositions(other, { cursor: first.nextCursor }),
    { code: 'INVALID_CURSOR' },
  );
  assert.deepEqual(
    await fixture({ empty: true }).chain.getOwnedPositions(owner),
    { items: [], nextCursor: null },
  );
});

for (const blockNumber of [99, 100, 101]) {
  test(`rejects a caller-crafted cursor at unconfirmed block ${blockNumber}`, async () => {
    const { chain, requests } = fixture();
    const cursor = Buffer.from(
      JSON.stringify({
        address: owner,
        offset: 2,
        blockNumber,
        blockHash,
        issuedAt: now,
      }),
    ).toString('base64url');
    await assert.rejects(chain.getOwnedPositions(owner, { cursor }), {
      code: 'CHAIN_UNAVAILABLE',
    });
    assert.ok(
      requests.every(
        (request) =>
          request.method !== 'eth_call' && request.method !== 'eth_getCode',
      ),
    );
  });
}

test('a valid ownership cursor retains its historical snapshot as the head advances', async () => {
  const { chain, requests, advanceHead } = fixture();
  const first = await chain.getOwnedPositions(owner, { limit: 2 });
  assert.equal(first.items[0]?.blockNumber, 98);
  assert.equal(typeof first.nextCursor, 'string');
  advanceHead(106);
  const second = await chain.getOwnedPositions(owner, {
    limit: 2,
    cursor: first.nextCursor,
  });
  assert.deepEqual(
    second.items.map((position) => position.tokenId),
    ['3'],
  );
  assert.equal(second.items[0]?.blockNumber, 98);
  assert.equal(second.items[0]?.blockHash, first.items[0]?.blockHash);
  assert.equal(second.nextCursor, null);
  assert.equal(
    requests.filter(
      (request) =>
        request.method === 'eth_getBlockByNumber' &&
        request.params[0] === 'latest',
    ).length,
    2,
  );
  assert.ok(
    requests
      .filter(
        (request) =>
          request.method === 'eth_getBlockByNumber' &&
          request.params[0] !== 'latest',
      )
      .every((request) => request.params[0] === '0x62'),
  );
});

test('rejects a formerly confirmed cursor if the current head no longer gives it sufficient depth', async () => {
  const { chain, advanceHead } = fixture();
  const first = await chain.getOwnedPositions(owner, { limit: 2 });
  advanceHead(99);
  await assert.rejects(
    chain.getOwnedPositions(owner, { cursor: first.nextCursor }),
    { code: 'CHAIN_UNAVAILABLE' },
  );
});

for (const failure of ['staleHead', 'malformedHead'] as const) {
  test(`a valid cursor fails closed when its fresh head is ${failure}`, async () => {
    const overrides: Overrides = {};
    const { chain } = fixture(overrides);
    const first = await chain.getOwnedPositions(owner, { limit: 2 });
    overrides[failure] = true;
    await assert.rejects(
      chain.getOwnedPositions(owner, { cursor: first.nextCursor }),
      { code: 'CHAIN_UNAVAILABLE' },
    );
  });
}

for (const [name, overrides] of Object.entries({
  'wrong chain': { wrongChain: true },
  'stale head': { stale: true },
  'block changed after reads': { reorg: true },
  'provider ignored numeric block': { ignoredBlock: true },
  'canonical deployment absent': { noCode: true },
  'malformed ABI': { malformedCall: true },
  'negative signed lock': { negative: true },
  'block hash pinning unsupported': { unsupportedPin: true },
  'response id mismatch': { wrongId: true },
  'RPC rejected request': { http: 403 },
})) {
  test(`fails closed when ${name}`, async () => {
    const { chain } = fixture(overrides);
    await assert.rejects(chain.getPosition('1'), { code: 'CHAIN_UNAVAILABLE' });
    if (!overrides.negative) assert.equal((await chain.health()).ready, false);
  });
}

test('missing NFT is distinct from an unavailable provider', async () => {
  await assert.rejects(fixture().chain.getPosition('999'), {
    code: 'POSITION_NOT_FOUND',
  });
});

test('bulk order refresh uses one block and distinguishes burnt tokens from read failure', async () => {
  const { chain, requests } = fixture();
  const positions = await chain.getPositions(['1', '999', '2']);
  assert.deepEqual(
    positions.map((position) => position?.tokenId ?? null),
    ['1', null, '2'],
  );
  assert.equal(
    requests.filter((request) => request.method === 'eth_chainId').length,
    1,
  );
  assert.ok(
    positions
      .filter((position) => position !== null)
      .every((position) => position.blockHash === blockHash),
  );
  await assert.rejects(chain.getPositions(Array(51).fill('1')), {
    code: 'CHAIN_UNAVAILABLE',
  });
  await assert.rejects(
    fixture({ unsupportedPin: true }).chain.getPositions(['1']),
    { code: 'CHAIN_UNAVAILABLE' },
  );
});

test('ownership enumeration cannot return another wallet’s positions', async () => {
  await assert.rejects(
    fixture({ moved: true }).chain.getOwnedPositions(owner),
    { code: 'CHAIN_UNAVAILABLE' },
  );
});

test('rejects invalid IDs before any RPC and rejects arbitrary page cursors/limits', async () => {
  const { chain, requests } = fixture();
  for (const value of [
    '0',
    '01',
    '-1',
    '1e3',
    '0x10',
    ' 1 ',
    '',
    (1n << 256n).toString(),
    1,
  ]) {
    assert.throws(() => tokenId(value), { code: 'INVALID_TOKEN_ID' });
    await assert.rejects(chain.getPosition(value), {
      code: 'INVALID_TOKEN_ID',
    });
  }
  assert.equal(requests.length, 0);
  await assert.rejects(chain.getOwnedPositions(owner, { limit: 1000 }), {
    code: 'INVALID_CURSOR',
  });
  await assert.rejects(chain.getOwnedPositions(owner, { cursor: 'not-json' }), {
    code: 'INVALID_CURSOR',
  });
  await assert.rejects(chain.getOwnedPositions('not-address'), {
    code: 'INVALID_ADDRESS',
  });
});

test('health confirms read ABI support and exposes no endpoint credentials', async () => {
  const { chain } = fixture();
  const health = await chain.health();
  assert.equal(health.ready, true);
  assert.equal(health.available, true);
  assert.equal(health.chainId, 999);
  assert.equal(health.blockHash, blockHash);
  assert.equal('rpcUrl' in health, false);
});

test('timeouts, oversized responses and non-HTTP provider configuration fail closed', async () => {
  const chain = createChain({
    fetch: async () => {
      throw new Error('provider secret');
    },
  });
  await assert.rejects(chain.getPosition('1'), {
    code: 'CHAIN_UNAVAILABLE',
    message:
      'Verified chain data is temporarily unavailable. Please try again.',
  });
  const large = createChain({
    fetch: async () => new Response('a'.repeat(1_048_577)),
  });
  await assert.rejects(large.getPosition('1'), { code: 'CHAIN_UNAVAILABLE' });
  assert.throws(() => createChain({ rpcUrl: 'file:///private/key' }));
  assert.throws(() => createChain({ rpcUrl: 'https://user:pass@example.com' }));
});

test('a stalled provider aborts within the configured timeout', async () => {
  const started = Date.now();
  const chain = createChain({
    timeoutMs: 100,
    fetch: (_url, options) =>
      new Promise<Response>((_, reject) => {
        const signal = options?.signal;
        assert.ok(signal);
        signal.addEventListener('abort', () => reject(signal.reason), {
          once: true,
        });
      }),
  });
  const keepAlive = setInterval(() => {}, 100);
  try {
    await assert.rejects(chain.getPosition('1'), { code: 'CHAIN_UNAVAILABLE' });
    assert.ok(Date.now() - started < 2000);
  } finally {
    clearInterval(keepAlive);
  }
});

test('temporary HTTP throttling retries only bounded read requests', async () => {
  const reference = fixture();
  let attempts = 0;
  const chain = createChain({
    fetch: async () => {
      attempts += 1;
      return new Response('{}', { status: 429 });
    },
  });
  await assert.rejects(chain.getPosition('1'), { code: 'CHAIN_UNAVAILABLE' });
  assert.equal(attempts, 3);
  await reference.chain.getPosition('1');
  assert.ok(
    reference.requests.every(({ method }) =>
      [
        'eth_chainId',
        'eth_getBlockByNumber',
        'eth_getCode',
        'eth_call',
      ].includes(method),
    ),
  );
});
