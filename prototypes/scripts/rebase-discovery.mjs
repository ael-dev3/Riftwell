import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Interface, keccak256, toQuantity } from 'ethers';

export const addresses = {
  escrow: '0x29d3a21ff35a519e00cf6d272f2ad897b109bd84',
  voter: '0xb7f7053f7e6c210e6777d5ba758e4b3eca6c88a0',
  rebase: '0xdd002e8df80ccb7a8964bfef6e15ee36d414fc36',
  kitten: '0x618275f8efe54c2afa87bfb9f210a52f0ff89364',
  usdc: '0xb88339cb7199b77e23db6e890353e22632ba630f',
};
export const readMethods = new Set(['eth_chainId', 'net_version', 'eth_blockNumber',
  'eth_getBlockByNumber', 'eth_getBlockByHash', 'eth_getCode', 'eth_getStorageAt',
  'eth_getBalance', 'eth_getTransactionCount', 'eth_call',
  'eth_getTransactionByHash', 'eth_getTransactionReceipt']);
export const stringify = value => JSON.stringify(value,
  (_, v) => typeof v === 'bigint' ? v.toString() : v, 2) + '\n';
const delay = ms => new Promise(resolveDelay => setTimeout(resolveDelay, ms));

// The upstream has no signer. Only the disposable fork may accept writes.
export function createReadOnlyRpc(url, report = {}, spacing = 350) {
  const controllers = new Set();
  const cache = new Map();
  let queue = Promise.resolve(), id = 0, nextAt = 0;
  report.remoteMethods ||= {};
  report.rpcRecords ||= [];
  return {
    abort() { for (const controller of controllers) controller.abort(); },
    async request({ method, params = [] }) {
      assert(readMethods.has(method), `Refusing non-read remote RPC method ${method}`);
      const cacheable = ['eth_getCode', 'eth_getStorageAt', 'eth_getBalance',
        'eth_getTransactionCount', 'eth_call'].includes(method)
        && typeof params.at(-1) === 'string' && /^0x[0-9a-f]+$/i.test(params.at(-1));
      const key = JSON.stringify([method, params]).toLowerCase();
      if (cacheable && cache.has(key)) {
        report.remoteCacheHits = (report.remoteCacheHits || 0) + 1;
        return cache.get(key);
      }
      const result = queue.catch(() => {}).then(async () => {
        for (let attempt = 0; attempt < 3; attempt++) {
          await delay(Math.max(0, nextAt - Date.now()));
          nextAt = Date.now() + spacing;
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 15_000);
          controllers.add(controller);
          const request = { jsonrpc: '2.0', id: ++id, method, params };
          report.remoteMethods[method] = (report.remoteMethods[method] || 0) + 1;
          try {
            const response = await fetch(url, { method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(request), signal: controller.signal });
            if ([429, 503].includes(response.status) && attempt < 2) {
              report.remoteReadRetries = (report.remoteReadRetries || 0) + 1;
              const retryAfter = Number(response.headers.get('retry-after'));
              await response.arrayBuffer();
              await delay(Math.min(10_000, retryAfter > 0 ? retryAfter * 1000 : 2000 * (attempt + 1)));
              continue;
            }
            if (!response.ok) throw Object.assign(new Error(`Remote ${method}: HTTP ${response.status}`), { code: -32000 });
            const body = await response.json();
            report.rpcRecords.push({ request, response: method === "eth_getCode" && typeof body.result === "string" ? { ...body, result: { runtimeKeccak256: keccak256(body.result), runtimeBytes: (body.result.length - 2) / 2, publicationSummary: true } } : body });
            if (body.error) throw Object.assign(new Error(`Remote ${method}: ${body.error.message}`), { code: body.error.code });
            if (method === 'eth_getBlockByNumber' && /^0x[0-9a-f]+$/i.test(params[0]) && body.result) {
              assert.equal(BigInt(body.result.number), BigInt(params[0]), 'Remote returned the wrong numeric block');
            }
            return body.result;
          } finally { clearTimeout(timeout); controllers.delete(controller); }
        }
      });
      queue = result;
      if (cacheable) cache.set(key, result);
      try { return await result; } catch (error) { cache.delete(key); throw error; }
    },
  };
}

export async function rebaseInterfaces() {
  const evidence = JSON.parse(await readFile(new URL('../docs/evidence/reward-settlement/app-abi-evidence.json', import.meta.url), 'utf8'));
  return {
    escrow: new Interface(evidence.abis.escrow.abi),
    rebase: new Interface(evidence.abis.rebase.abi),
    voter: new Interface(['function veKitten() view returns(address)',
      'function kitten() view returns(address)', 'function rebaseReward() view returns(address)',
      'function getCurrentPeriod() view returns(uint256)',
      'function checkPeriodVoted(uint256,uint256) view returns(bool)']),
  };
}

export async function discoverRebase({ rpcUrl = process.env.RIFTWELL_HYPEREVM_RPC || 'https://rpc.hyperliquid.xyz/evm',
  block = process.env.RIFTWELL_REBASE_FORK_BLOCK,
  tokenIds = (process.env.RIFTWELL_REBASE_TOKEN_IDS || '18570,18371,18373,19023').split(',').map(BigInt),
  periodCount = Number(process.env.RIFTWELL_REBASE_PERIOD_COUNT || 4),
  report = {}, remote = createReadOnlyRpc(rpcUrl, report) } = {}) {
  assert(tokenIds.length > 0 && tokenIds.length <= 16, 'Discovery permits 1–16 explicit NFT candidates');
  assert(Number.isInteger(periodCount) && periodCount > 0 && periodCount <= 4, 'Discovery permits 1–4 closed periods per NFT');
  report.observedAtUtc = new Date().toISOString();
  report.endpointHost = new URL(rpcUrl).hostname;
  report.addresses = addresses;
  report.safety = 'Allowlisted remote reads only; fixed numeric block; bounded explicit candidates; no balance, storage or code overrides.';
  const rpc = (method, params = []) => remote.request({ method, params });
  assert.equal(await rpc('eth_chainId'), '0x3e7', 'Expected HyperEVM mainnet chain 999');
  const blockTag = block ? toQuantity(BigInt(block)) : await rpc('eth_blockNumber');
  const header = await rpc('eth_getBlockByNumber', [blockTag, false]);
  assert(header, 'The endpoint did not return the numeric fork block');
  const repeated = await rpc('eth_getBlockByNumber', [blockTag, false]);
  assert.equal(repeated.hash, header.hash, 'Pinned block hash changed');
  report.block = { number: Number(BigInt(blockTag)), hash: header.hash,
    timestamp: Number(BigInt(header.timestamp)), timestampUtc: new Date(Number(BigInt(header.timestamp)) * 1000).toISOString() };
  const interfaces = await rebaseInterfaces();
  const read = async (address, iface, name, args = []) => {
    const result = iface.decodeFunctionResult(name, await rpc('eth_call', [{ to: address,
      data: iface.encodeFunctionData(name, args) }, blockTag]));
    return result.length === 1 ? result[0] : result;
  };
  const canonical = await read(addresses.voter, interfaces.voter, 'rebaseReward');
  assert.equal(canonical.toLowerCase(), addresses.rebase, 'Canonical rebase registry changed; review a new deployment before claiming');
  assert.equal((await read(addresses.voter, interfaces.voter, 'veKitten')).toLowerCase(), addresses.escrow);
  assert.equal((await read(addresses.escrow, interfaces.escrow, 'voter')).toLowerCase(), addresses.voter);
  assert.equal((await read(addresses.escrow, interfaces.escrow, 'kitten')).toLowerCase(), addresses.kitten);
  assert.equal((await read(canonical, interfaces.rebase, 'veKitten')).toLowerCase(), addresses.escrow);
  assert.equal((await read(canonical, interfaces.rebase, 'voter')).toLowerCase(), addresses.voter);
  const tokens = await read(canonical, interfaces.rebase, 'getRewardList');
  assert(tokens.some(token => token.toLowerCase() === addresses.kitten), 'Canonical rebase does not list KITTEN');
  const period = await read(addresses.voter, interfaces.voter, 'getCurrentPeriod');
  assert.equal(await read(canonical, interfaces.rebase, 'getCurrentPeriod'), period);
  report.identity = { canonical, getter: 'Voter.rebaseReward()', voter: addresses.voter,
    escrow: addresses.escrow, kitten: addresses.kitten, currentPeriod: period, rewardTokens: tokens,
    policy: 'Registry is mutable; snapshot canonical address immutably in each vault and reject registry drift.' };
  report.rows = [];
  for (const tokenId of tokenIds) {
    const row = { tokenId };
    report.rows.push(row);
    try {
      row.owner = await read(addresses.escrow, interfaces.escrow, 'ownerOf', [tokenId]);
      const lock = await read(addresses.escrow, interfaces.escrow, 'locked', [tokenId]);
      row.lockedAmount = lock.amount;
      row.lockEnd = lock.end;
      row.nextPeriodVoted = await read(addresses.voter, interfaces.voter, 'checkPeriodVoted', [period + 1n, tokenId]);
      row.periods = [];
      for (let offset = 1; offset <= periodCount; offset++) {
        const closedPeriod = period - BigInt(offset);
        row.periods.push({ period: closedPeriod, earnedKITTEN: await read(canonical, interfaces.rebase,
          'earnedForPeriod', [closedPeriod, tokenId, addresses.kitten]) });
      }
      row.transferableCandidate = !row.nextPeriodVoted && lock.amount > 0n
        && lock.end > BigInt(report.block.timestamp + 7 * 86400);
      if (!report.selected && row.transferableCandidate) {
        const claim = row.periods.find(value => value.earnedKITTEN > 0n);
        if (claim) report.selected = { tokenId, owner: row.owner, lockedAmount: lock.amount,
          lockEnd: lock.end, period: claim.period, earnedKITTEN: claim.earnedKITTEN };
      }
    } catch (error) { row.error = error.shortMessage || error.message; }
  }
  report.implementations = {};
  const slot = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
  for (const name of ['escrow', 'voter', 'rebase', 'kitten']) {
    const address = addresses[name];
    const raw = await rpc('eth_getStorageAt', [address, slot, blockTag]);
    const implementation = '0x' + raw.slice(-40);
    report.implementations[name] = { address, implementationSlot: raw, implementation,
      proxyCodeHash: keccak256(await rpc('eth_getCode', [address, blockTag])),
      implementationCodeHash: keccak256(await rpc('eth_getCode', [implementation, blockTag])) };
  }
  report.status = report.selected ? 'nonzero-transferable-candidate-found' : 'no-nonzero-transferable-candidate-found';
  return { report, remote, blockTag, interfaces };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = {};
  try { await discoverRebase({ report }); }
  catch (error) { report.status = 'failed'; report.error = error.shortMessage || error.message; process.exitCode = 1; }
  report.finishedAtUtc = new Date().toISOString();
  if (process.env.RIFTWELL_REBASE_DISCOVERY_FILE) {
    const path = resolve(process.env.RIFTWELL_REBASE_DISCOVERY_FILE);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, stringify(report));
  }
  console.info(stringify({ ...report, rpcRecords: undefined }));
}
