import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Interface, keccak256 } from 'ethers';
import {
  array,
  record,
  string,
  errorInfo,
} from '../../../scripts/boundaries.ts';
import {
  hex,
  rpcQuantity,
  parseAbis,
  parseRouteEvidence,
  requiredAbi,
  signature,
  rowAddress,
  transaction as parseTransaction,
  receipt as parseReceipt,
  type EvidenceABI,
  type RpcRecord,
  type RpcRequest,
  type CallRow,
  type CodeRecord,
  type Receipt,
  type DecodedCall,
  type DecodedLog,
} from './collection-types.ts';

const directory = path.dirname(fileURLToPath(import.meta.url));
const readJson = (name: string): unknown =>
  JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
const snapshot = parseRouteEvidence(readJson('rpc-route-evidence.json'));
const abis = parseAbis(readJson('app-abi-evidence.json'));
const endpoint = snapshot.endpoint;
const blockTag = `0x${snapshot.block.number.toString(16)}`;
const a = snapshot.addresses;
const records: RpcRecord[] = [];
let id = 1;
const whitelist = new Set([
  'eth_call',
  'eth_getCode',
  'eth_getTransactionByHash',
  'eth_getTransactionReceipt',
]);
async function rpc(
  method: string,
  params: readonly unknown[],
): Promise<unknown> {
  if (!whitelist.has(method)) throw new Error('Read-only methods only');
  const request: RpcRequest = { jsonrpc: '2.0', id: id++, method, params };
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok)
    throw new Error(`Read-only RPC returned HTTP ${response.status}.`);
  const body: unknown = await response.json();
  const result = record(body);
  if (result.jsonrpc !== '2.0' || result.id !== request.id)
    throw new Error('Unexpected RPC response identity.');
  records.push({
    request,
    response:
      method === 'eth_getCode' && typeof result.result === 'string'
        ? {
            ...result,
            result: {
              runtimeKeccak256: keccak256(result.result),
              runtimeBytes: (result.result.length - 2) / 2,
              publicationSummary: true,
            },
          }
        : result,
  });
  if (result.error) throw new Error(string(record(result.error).message));
  return result.result;
}
function save(name: string, value: unknown) {
  fs.writeFileSync(
    path.join(directory, name),
    JSON.stringify(
      value,
      (_, v) => (typeof v === 'bigint' ? v.toString() : v),
      2,
    ) + '\n',
  );
}
const rows: CallRow[] = [];
async function call(
  label: string,
  address: string,
  abi: EvidenceABI,
  method: string,
  args: readonly unknown[] = [],
): Promise<unknown[] | null> {
  const iface = new Interface(abi);
  try {
    const raw = hex(
      await rpc('eth_call', [
        { to: address, data: iface.encodeFunctionData(method, args) },
        blockTag,
      ]),
    );
    const decoded = Array.from(iface.decodeFunctionResult(method, raw));
    rows.push({
      label,
      address,
      signature: signature(iface, method).format('sighash'),
      args,
      raw,
      decoded,
    });
    return decoded;
  } catch (error) {
    rows.push({
      label,
      address,
      method,
      args,
      error: errorInfo(error).message,
    });
    return null;
  }
}
const poolAbi = [
  'function token0() view returns(address)',
  'function token1() view returns(address)',
  'function liquidity() view returns(uint128)',
  'function plugin() view returns(address)',
  'function factory() view returns(address)',
  'function globalState() view returns(uint160,int24,uint16,uint8,uint16,bool)',
];
const direct = rowAddress(snapshot.rows, 'base pool kitten/usdc');
for (const method of ['token0', 'token1', 'liquidity', 'plugin', 'globalState'])
  await call(`direct KITTEN/USDC ${method}`, direct, poolAbi, method);
for (const method of ['getRewardList', 'getCurrentPeriod', 'DURATION', 'owner'])
  await call(`rebase ${method}`, a.rebase, requiredAbi(abis, 'rebase'), method);
for (const method of ['kitten', 'voter'])
  await call(
    `escrow ${method}`,
    a.veKitten,
    requiredAbi(abis, 'escrow'),
    method,
  );
const code: Record<string, CodeRecord> = {};
const implementations = Object.fromEntries(
  ['kitten', 'rebase', 'veKitten', 'voter'].map((k) => [
    `${k}Implementation`,
    `0x${hex(snapshot.code[k]?.implementationSlot, 32).slice(-40)}`,
  ]),
);
const extraAddresses = {
  kittenWhypePool: a.kittenWhypePool,
  directKittenUsdcPool: direct,
  ...implementations,
  whypeUsdcPlugin: rowAddress(snapshot.rows, 'primaryPool plugin'),
  kittenWhypePlugin: rowAddress(snapshot.rows, 'kittenWhypePool plugin'),
};
for (const [label, address] of Object.entries(extraAddresses)) {
  const runtime = hex(await rpc('eth_getCode', [address, blockTag]));
  code[label] = {
    address,
    runtimeBytes: (runtime.length - 2) / 2,
    runtimeKeccak256: keccak256(runtime),
  };
}
const transferInterface = new Interface([
  'event Transfer(address indexed from,address indexed to,uint256 value)',
]);
const escrowInterface = new Interface(requiredAbi(abis, 'escrow'));
const rebaseInterface = new Interface(requiredAbi(abis, 'rebase'));
const routerInterface = new Interface(requiredAbi(abis, 'router'));
function decodedLogs(receipt: Receipt): DecodedLog[] {
  return receipt.logs.flatMap((log) => {
    const address = log.address.toLowerCase();
    let iface;
    if (
      [a.kitten, a.whype, a.usdc].map((x) => x.toLowerCase()).includes(address)
    )
      iface = transferInterface;
    else if (address === a.veKitten.toLowerCase()) iface = escrowInterface;
    else if (address === a.rebase.toLowerCase()) iface = rebaseInterface;
    else return [];
    try {
      const p = iface.parseLog(log);
      return p
        ? [
            {
              address: log.address,
              name: p.name,
              signature: p.signature,
              fields: p.fragment.inputs.map((x, i) => ({
                name: x.name,
                value: p.args[i],
              })),
            },
          ]
        : [];
    } catch {
      return [];
    }
  });
}
function decodeCalls(data: string, iface: Interface): DecodedCall {
  const p = iface.parseTransaction({ data });
  if (!p)
    throw new Error('Historical transaction does not match the recorded ABI.');
  return {
    name: p.name,
    signature: p.signature,
    args: Array.from(p.args),
    selector: p.selector,
    ...(p.name === 'multicall'
      ? { innerCalls: array(p.args[0]).map((v) => decodeCalls(hex(v), iface)) }
      : {}),
  };
}
const historical: {
  transactionHash: string;
  block: number;
  status: string;
  from: string;
  to: string | null;
  call: DecodedCall;
  logs: DecodedLog[];
}[] = [];
for (const name of ['ba122414', '70873bb3']) {
  const item = record(readJson(`transaction-${name}.json`));
  const transaction = parseTransaction(item.transaction),
    receipt = parseReceipt(item.receipt);
  historical.push({
    transactionHash: transaction.hash,
    block: parseInt(receipt.blockNumber, 16),
    status: receipt.status,
    from: transaction.from,
    to: transaction.to,
    call: decodeCalls(transaction.input, routerInterface),
    logs: decodedLogs(receipt),
  });
}
const rebaseHash =
  '0xb5c1569eaa6e753d1aa0cf1c207dad9f157e880d067bf133fca9fd8a02b0198e';
const transaction = parseTransaction(
  await rpc('eth_getTransactionByHash', [rebaseHash]),
);
const receipt = parseReceipt(
  await rpc('eth_getTransactionReceipt', [rebaseHash]),
);
const rebaseCall = decodeCalls(transaction.input, rebaseInterface);
const rebaseSample = {
  transaction,
  receipt,
  call: rebaseCall,
  logs: decodedLogs(receipt),
};
save('transaction-rebase-b5c1569e.json', rebaseSample);
await call(
  'sample rebase NFT owner now',
  a.veKitten,
  requiredAbi(abis, 'escrow'),
  'ownerOf',
  [rebaseCall.args[0]],
);
await call(
  'sample rebase NFT locked now',
  a.veKitten,
  requiredAbi(abis, 'escrow'),
  'locked',
  [rebaseCall.args[0]],
);
await call(
  'sample rebase NFT earned now',
  a.rebase,
  requiredAbi(abis, 'rebase'),
  'earnedForTokenId',
  [rebaseCall.args[0]],
);
const signatures: Record<
  string,
  { signature: string; selector: string; abi: unknown }[]
> = {};
for (const [name, methods] of Object.entries({
  router: ['exactInputSingle', 'exactInput'],
  quoter: ['quoteExactInputSingle', 'quoteExactInput'],
  rebase: [
    'getRewardForTokenId',
    'getRewardForPeriod',
    'getRewardForOwner',
    'earnedForTokenId',
  ],
})) {
  const iface = new Interface(requiredAbi(abis, name));
  signatures[name] = methods.map((method) => ({
    signature: signature(iface, method).format('sighash'),
    selector: signature(iface, method).selector,
    abi: requiredAbi(abis, name).find(
      (x) =>
        typeof x !== 'string' &&
        'name' in x &&
        x.name === method &&
        x.type === 'function',
    ),
  }));
}
save('supplement-evidence.json', {
  observedAtUtc: new Date().toISOString(),
  endpoint,
  block: snapshot.block,
  rows,
  code,
  signatures,
  historical,
  rebaseSample: {
    hash: transaction.hash,
    from: transaction.from,
    to: transaction.to,
    block: parseInt(receipt.blockNumber, 16),
    status: receipt.status,
    call: rebaseCall,
    logs: rebaseSample.logs,
  },
  limitation:
    'Current-state calls and existing transaction logs only. No state/balance overrides, funded vault swap, execution trace or before/after archive state reconstruction.',
});
save('supplement-rpc-requests.json', records);
console.log(
  JSON.stringify(
    {
      rows: rows.map((r) => ({
        label: r.label,
        decoded: r.decoded,
        error: r.error,
      })),
      rebaseSample: {
        hash: transaction.hash,
        call: rebaseCall,
        logs: rebaseSample.logs,
      },
    },
    (_, v) => (typeof v === 'bigint' ? v.toString() : v),
    2,
  ),
);
