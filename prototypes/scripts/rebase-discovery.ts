import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Interface, keccak256, toQuantity } from 'ethers';
import {
  abi,
  array,
  bigint,
  boolean,
  errorInfo,
  record,
  string,
} from './boundaries.ts';

export interface RpcRequest {
  method: string;
  params?: readonly unknown[];
}
export interface ReadOnlyRpc {
  abort(): void;
  request(request: RpcRequest): Promise<unknown>;
}
export interface DiscoveryRow {
  tokenId: bigint;
  owner?: string;
  lockedAmount?: bigint;
  lockEnd?: bigint;
  nextPeriodVoted?: boolean;
  periods?: { period: bigint; earnedKITTEN: bigint }[];
  transferableCandidate?: boolean;
  error?: string;
}
export interface DiscoveryReport {
  remoteMethods?: Record<string, number>;
  rpcRecords?: unknown[];
  remoteCacheHits?: number;
  remoteReadRetries?: number;
  observedAtUtc?: string;
  endpointHost?: string;
  addresses?: typeof addresses;
  safety?: string;
  block?: {
    number: number;
    hash: string;
    timestamp: number;
    timestampUtc: string;
  };
  identity?: {
    canonical: string;
    getter: string;
    voter: string;
    escrow: string;
    kitten: string;
    currentPeriod: bigint;
    rewardTokens: string[];
    policy: string;
  };
  rows?: DiscoveryRow[];
  selected?: {
    tokenId: bigint;
    owner: string;
    lockedAmount: bigint;
    lockEnd: bigint;
    period: bigint;
    earnedKITTEN: bigint;
  };
  implementations?: Record<
    string,
    {
      address: string;
      implementationSlot: string;
      implementation: string;
      proxyCodeHash: string;
      implementationCodeHash: string;
    }
  >;
  status?: string;
  error?: string;
  finishedAtUtc?: string;
}
export interface DiscoveryOptions {
  rpcUrl?: string;
  block?: string;
  tokenIds?: bigint[];
  periodCount?: number;
  report?: DiscoveryReport;
  remote?: ReadOnlyRpc;
}

export const addresses = {
  escrow: '0x29d3a21ff35a519e00cf6d272f2ad897b109bd84',
  voter: '0xb7f7053f7e6c210e6777d5ba758e4b3eca6c88a0',
  rebase: '0xdd002e8df80ccb7a8964bfef6e15ee36d414fc36',
  kitten: '0x618275f8efe54c2afa87bfb9f210a52f0ff89364',
  usdc: '0xb88339cb7199b77e23db6e890353e22632ba630f',
};
export const readMethods = new Set([
  'eth_chainId',
  'net_version',
  'eth_blockNumber',
  'eth_getBlockByNumber',
  'eth_getBlockByHash',
  'eth_getCode',
  'eth_getStorageAt',
  'eth_getBalance',
  'eth_getTransactionCount',
  'eth_call',
  'eth_getTransactionByHash',
  'eth_getTransactionReceipt',
]);
export const stringify = (value: unknown): string =>
  JSON.stringify(
    value,
    (_, v) => (typeof v === 'bigint' ? v.toString() : v),
    2,
  ) + '\n';
const delay = (ms: number) =>
  new Promise<void>((resolveDelay) => setTimeout(resolveDelay, ms));

// The upstream has no signer. Only the disposable fork may accept writes.
export function createReadOnlyRpc(
  url: string,
  report: DiscoveryReport = {},
  spacing = 350,
): ReadOnlyRpc {
  const controllers = new Set<AbortController>();
  const cache = new Map<string, Promise<unknown>>();
  const remoteMethods = (report.remoteMethods ??= {});
  const rpcRecords = (report.rpcRecords ??= []);
  let queue: Promise<unknown> = Promise.resolve(),
    id = 0,
    nextAt = 0;
  return {
    abort() {
      for (const controller of controllers) controller.abort();
    },
    async request({ method, params = [] }: RpcRequest) {
      assert(
        readMethods.has(method),
        `Refusing non-read remote RPC method ${method}`,
      );
      const last = params.at(-1);
      const cacheable =
        [
          'eth_getCode',
          'eth_getStorageAt',
          'eth_getBalance',
          'eth_getTransactionCount',
          'eth_call',
        ].includes(method) &&
        typeof last === 'string' &&
        /^0x[0-9a-f]+$/i.test(last);
      const key = JSON.stringify([method, params]).toLowerCase();
      const cached = cacheable ? cache.get(key) : undefined;
      if (cached) {
        report.remoteCacheHits = (report.remoteCacheHits || 0) + 1;
        return cached;
      }
      const result = queue
        .catch(() => {})
        .then(async () => {
          for (let attempt = 0; attempt < 3; attempt++) {
            await delay(Math.max(0, nextAt - Date.now()));
            nextAt = Date.now() + spacing;
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 15_000);
            controllers.add(controller);
            const request = { jsonrpc: '2.0', id: ++id, method, params };
            remoteMethods[method] = (remoteMethods[method] || 0) + 1;
            try {
              const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(request),
                signal: controller.signal,
              });
              if ([429, 503].includes(response.status) && attempt < 2) {
                report.remoteReadRetries = (report.remoteReadRetries || 0) + 1;
                const retryAfter = Number(response.headers.get('retry-after'));
                await response.arrayBuffer();
                await delay(
                  Math.min(
                    10_000,
                    retryAfter > 0 ? retryAfter * 1000 : 2000 * (attempt + 1),
                  ),
                );
                continue;
              }
              if (!response.ok)
                throw Object.assign(
                  new Error(`Remote ${method}: HTTP ${response.status}`),
                  { code: -32000 },
                );
              const value: unknown = await response.json();
              const body = record(value);
              rpcRecords.push({
                request,
                response:
                  method === 'eth_getCode' && typeof body.result === 'string'
                    ? {
                        ...body,
                        result: {
                          runtimeKeccak256: keccak256(body.result),
                          runtimeBytes: (body.result.length - 2) / 2,
                          publicationSummary: true,
                        },
                      }
                    : body,
              });
              if (body.error) {
                const error = record(body.error);
                throw Object.assign(
                  new Error(`Remote ${method}: ${string(error.message)}`),
                  { code: error.code },
                );
              }
              if (
                method === 'eth_getBlockByNumber' &&
                typeof params[0] === 'string' &&
                /^0x[0-9a-f]+$/i.test(params[0]) &&
                body.result
              ) {
                assert.equal(
                  BigInt(string(record(body.result).number)),
                  BigInt(params[0]),
                  'Remote returned the wrong numeric block',
                );
              }
              return body.result;
            } finally {
              clearTimeout(timeout);
              controllers.delete(controller);
            }
          }
        });
      queue = result;
      if (cacheable) cache.set(key, result);
      try {
        return await result;
      } catch (error) {
        cache.delete(key);
        throw error;
      }
    },
  };
}

export async function rebaseInterfaces() {
  const value: unknown = JSON.parse(
    await readFile(
      new URL(
        '../docs/evidence/reward-settlement/app-abi-evidence.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  const evidence = record(value);
  const abis = record(evidence.abis);
  return {
    escrow: new Interface(abi(record(abis.escrow).abi)),
    rebase: new Interface(abi(record(abis.rebase).abi)),
    voter: new Interface([
      'function veKitten() view returns(address)',
      'function kitten() view returns(address)',
      'function rebaseReward() view returns(address)',
      'function getCurrentPeriod() view returns(uint256)',
      'function checkPeriodVoted(uint256,uint256) view returns(bool)',
    ]),
  };
}

export async function discoverRebase({
  rpcUrl = process.env.RIFTWELL_HYPEREVM_RPC ||
    'https://rpc.hyperliquid.xyz/evm',
  block = process.env.RIFTWELL_REBASE_FORK_BLOCK,
  tokenIds = (
    process.env.RIFTWELL_REBASE_TOKEN_IDS || '18570,18371,18373,19023'
  )
    .split(',')
    .map(BigInt),
  periodCount = Number(process.env.RIFTWELL_REBASE_PERIOD_COUNT || 4),
  report = {},
  remote = createReadOnlyRpc(rpcUrl, report),
}: DiscoveryOptions = {}) {
  assert(
    tokenIds.length > 0 && tokenIds.length <= 16,
    'Discovery permits 1–16 explicit NFT candidates',
  );
  assert(
    Number.isInteger(periodCount) && periodCount > 0 && periodCount <= 4,
    'Discovery permits 1–4 closed periods per NFT',
  );
  report.observedAtUtc = new Date().toISOString();
  report.endpointHost = new URL(rpcUrl).hostname;
  report.addresses = addresses;
  report.safety =
    'Allowlisted remote reads only; fixed numeric block; bounded explicit candidates; no balance, storage or code overrides.';
  const rpc = (method: string, params: readonly unknown[] = []) =>
    remote.request({ method, params });
  assert.equal(
    await rpc('eth_chainId'),
    '0x3e7',
    'Expected HyperEVM mainnet chain 999',
  );
  const blockTag = block
    ? toQuantity(BigInt(block))
    : string(await rpc('eth_blockNumber'));
  const header = record(await rpc('eth_getBlockByNumber', [blockTag, false]));
  const repeated = record(await rpc('eth_getBlockByNumber', [blockTag, false]));
  assert.equal(repeated.hash, header.hash, 'Pinned block hash changed');
  const blockNumber = Number(BigInt(blockTag)),
    blockTimestamp = Number(BigInt(string(header.timestamp)));
  assert(
    Number.isSafeInteger(blockNumber) && blockNumber >= 0,
    'Pinned block number is unsupported',
  );
  assert(
    Number.isSafeInteger(blockTimestamp) && blockTimestamp >= 0,
    'Pinned block timestamp is unsupported',
  );
  const blockHash = string(header.hash);
  assert(/^0x[0-9a-f]{64}$/i.test(blockHash), 'Pinned block hash is malformed');
  report.block = {
    number: blockNumber,
    hash: blockHash,
    timestamp: blockTimestamp,
    timestampUtc: new Date(blockTimestamp * 1000).toISOString(),
  };
  const interfaces = await rebaseInterfaces();
  const read = async (
    address: string,
    iface: Interface,
    name: string,
    args: readonly unknown[] = [],
  ): Promise<unknown> => {
    const result = iface.decodeFunctionResult(
      name,
      string(
        await rpc('eth_call', [
          { to: address, data: iface.encodeFunctionData(name, args) },
          blockTag,
        ]),
      ),
    );
    return result.length === 1 ? result[0] : result;
  };
  const canonical = string(
    await read(addresses.voter, interfaces.voter, 'rebaseReward'),
  );
  assert.equal(
    canonical.toLowerCase(),
    addresses.rebase,
    'Canonical rebase registry changed; review a new deployment before claiming',
  );
  assert.equal(
    string(
      await read(addresses.voter, interfaces.voter, 'veKitten'),
    ).toLowerCase(),
    addresses.escrow,
  );
  assert.equal(
    string(
      await read(addresses.escrow, interfaces.escrow, 'voter'),
    ).toLowerCase(),
    addresses.voter,
  );
  assert.equal(
    string(
      await read(addresses.escrow, interfaces.escrow, 'kitten'),
    ).toLowerCase(),
    addresses.kitten,
  );
  assert.equal(
    string(await read(canonical, interfaces.rebase, 'veKitten')).toLowerCase(),
    addresses.escrow,
  );
  assert.equal(
    string(await read(canonical, interfaces.rebase, 'voter')).toLowerCase(),
    addresses.voter,
  );
  const tokens = array(
    await read(canonical, interfaces.rebase, 'getRewardList'),
  ).map(string);
  assert(
    tokens.some((token) => token.toLowerCase() === addresses.kitten),
    'Canonical rebase does not list KITTEN',
  );
  const period = bigint(
    await read(addresses.voter, interfaces.voter, 'getCurrentPeriod'),
  );
  assert.equal(
    bigint(await read(canonical, interfaces.rebase, 'getCurrentPeriod')),
    period,
  );
  report.identity = {
    canonical,
    getter: 'Voter.rebaseReward()',
    voter: addresses.voter,
    escrow: addresses.escrow,
    kitten: addresses.kitten,
    currentPeriod: period,
    rewardTokens: tokens,
    policy:
      'Registry is mutable; snapshot canonical address immutably in each vault and reject registry drift.',
  };
  report.rows = [];
  for (const tokenId of tokenIds) {
    const row: DiscoveryRow = { tokenId };
    report.rows.push(row);
    try {
      const owner = string(
        await read(addresses.escrow, interfaces.escrow, 'ownerOf', [tokenId]),
      );
      row.owner = owner;
      const lockValues = array(
        await read(addresses.escrow, interfaces.escrow, 'locked', [tokenId]),
      );
      const lock = {
        amount: bigint(lockValues[0]),
        end: bigint(lockValues[1]),
      };
      row.lockedAmount = lock.amount;
      row.lockEnd = lock.end;
      row.nextPeriodVoted = boolean(
        await read(addresses.voter, interfaces.voter, 'checkPeriodVoted', [
          period + 1n,
          tokenId,
        ]),
      );
      row.periods = [];
      for (let offset = 1; offset <= periodCount; offset++) {
        const closedPeriod = period - BigInt(offset);
        row.periods.push({
          period: closedPeriod,
          earnedKITTEN: bigint(
            await read(canonical, interfaces.rebase, 'earnedForPeriod', [
              closedPeriod,
              tokenId,
              addresses.kitten,
            ]),
          ),
        });
      }
      row.transferableCandidate =
        !row.nextPeriodVoted &&
        lock.amount > 0n &&
        lock.end > BigInt(blockTimestamp + 7 * 86400);
      if (!report.selected && row.transferableCandidate) {
        const claim = row.periods.find((value) => value.earnedKITTEN > 0n);
        if (claim)
          report.selected = {
            tokenId,
            owner,
            lockedAmount: lock.amount,
            lockEnd: lock.end,
            period: claim.period,
            earnedKITTEN: claim.earnedKITTEN,
          };
      }
    } catch (error) {
      const info = errorInfo(error);
      row.error = info.shortMessage || info.message;
    }
  }
  report.implementations = {};
  const slot =
    '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
  for (const name of ['escrow', 'voter', 'rebase', 'kitten'] as const) {
    const address = addresses[name];
    const raw = string(
      await rpc('eth_getStorageAt', [address, slot, blockTag]),
    );
    assert(
      /^0x[0-9a-f]{64}$/i.test(raw),
      'Implementation storage slot is malformed',
    );
    const implementation = '0x' + raw.slice(-40);
    const proxyCode = string(await rpc('eth_getCode', [address, blockTag]));
    const implementationCode = string(
      await rpc('eth_getCode', [implementation, blockTag]),
    );
    assert(
      /^0x(?:[0-9a-f]{2})*$/i.test(proxyCode) &&
        /^0x(?:[0-9a-f]{2})*$/i.test(implementationCode),
      'Runtime code is malformed',
    );
    report.implementations[name] = {
      address,
      implementationSlot: raw,
      implementation,
      proxyCodeHash: keccak256(proxyCode),
      implementationCodeHash: keccak256(implementationCode),
    };
  }
  report.status = report.selected
    ? 'nonzero-transferable-candidate-found'
    : 'no-nonzero-transferable-candidate-found';
  return { report, remote, blockTag, interfaces };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const report: DiscoveryReport = {};
  try {
    await discoverRebase({ report });
  } catch (error) {
    const info = errorInfo(error);
    report.status = 'failed';
    report.error = info.shortMessage || info.message;
    process.exitCode = 1;
  }
  report.finishedAtUtc = new Date().toISOString();
  if (process.env.RIFTWELL_REBASE_DISCOVERY_FILE) {
    const path = resolve(process.env.RIFTWELL_REBASE_DISCOVERY_FILE);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, stringify(report));
  }
  console.info(stringify({ ...report, rpcRecords: undefined }));
}
