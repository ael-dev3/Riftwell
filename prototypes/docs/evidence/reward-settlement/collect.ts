import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import {
  array,
  record,
  string,
  errorInfo,
  type JsonValue,
} from '../../../scripts/boundaries.ts';
import {
  hex,
  rpcQuantity,
  evidenceABI,
  signature,
  transaction as parseTransaction,
  receipt as parseReceipt,
  type EvidenceABI,
  type RpcRecord,
  type RpcRequest,
  type CallRow,
  type CodeRecord,
} from './collection-types.ts';
const require = createRequire(import.meta.url);
const {
  parseExpressionAt,
}: typeof import('../../../node_modules/ganache/node_modules/acorn/dist/acorn.js') = require('../../../node_modules/ganache/node_modules/acorn');
import {
  Interface,
  keccak256,
  ZeroAddress,
  solidityPacked,
  type Result,
} from 'ethers';

const directory = path.dirname(fileURLToPath(import.meta.url));
const rpcUrl = 'https://rpc.hyperliquid.xyz/evm';
const allowedMethods = new Set([
  'eth_chainId',
  'eth_getBlockByNumber',
  'eth_getCode',
  'eth_getStorageAt',
  'eth_call',
  'eth_getTransactionByHash',
  'eth_getTransactionReceipt',
]);
let nextId = 1;
const rpcRecords: RpcRecord[] = [];
async function rpc(
  method: string,
  params: readonly unknown[],
): Promise<unknown> {
  if (!allowedMethods.has(method))
    throw new Error('Read-only RPC methods only');
  const request: RpcRequest = { jsonrpc: '2.0', id: nextId++, method, params };
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok)
    throw new Error(`Read-only RPC returned HTTP ${response.status}.`);
  const body: unknown = await response.json();
  const value = record(body);
  if (value.jsonrpc !== '2.0' || value.id !== request.id)
    throw new Error('Unexpected RPC response identity.');
  rpcRecords.push({
    request,
    response:
      method === 'eth_getCode' && typeof value.result === 'string'
        ? {
            ...value,
            result: {
              runtimeKeccak256: keccak256(value.result),
              runtimeBytes: (value.result.length - 2) / 2,
              publicationSummary: true,
            },
          }
        : value,
  });
  if (value.error) {
    const error = record(value.error);
    throw Object.assign(new Error(string(error.message)), { data: error.data });
  }
  return value.result;
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
const sha = (value: string) =>
  crypto.createHash('sha256').update(value).digest('hex');
function literal(value: unknown): JsonValue {
  const node = record(value);
  if (node.type === 'Literal') {
    const result = node.value;
    if (
      result === null ||
      typeof result === 'string' ||
      typeof result === 'number' ||
      typeof result === 'boolean'
    )
      return result;
    throw new Error('Unsupported ABI literal.');
  }
  if (
    node.type === 'UnaryExpression' &&
    ['!', '-', '+'].includes(string(node.operator))
  ) {
    const argument = record(node.argument);
    if (argument.type !== 'Literal')
      throw new Error('Nonliteral ABI unary expression.');
    const result = literal(argument);
    if (node.operator === '!') return !result;
    if (typeof result !== 'number')
      throw new Error('Non-numeric ABI unary expression');
    return node.operator === '-' ? -result : +result;
  }
  if (node.type === 'ArrayExpression') return array(node.elements).map(literal);
  if (node.type === 'ObjectExpression')
    return Object.fromEntries(
      array(node.properties).map((value) => {
        const property = record(value);
        if (
          property.type !== 'Property' ||
          property.computed ||
          property.kind !== 'init'
        )
          throw new Error('Nonliteral ABI property');
        const key = record(property.key);
        const name = string(key.type === 'Identifier' ? key.name : key.value);
        return [name, literal(property.value)];
      }),
    );
  throw new Error(`Nonliteral ABI node ${string(node.type)}`);
}
function extractArray(source: string, binding: string) {
  const match = new RegExp(
    `(?:^|[,;\\s])${binding.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}=(\\[)`,
  ).exec(source);
  if (!match) throw new Error(`ABI binding ${binding} missing`);
  const position = match.index + match[0].lastIndexOf('[');
  // Isolate the array so Acorn cannot consume later comma-separated declarations.
  let depth = 0,
    quote = '',
    escaped = false,
    end = -1;
  for (let i = position; i < source.length; i++) {
    const character = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === '[') depth++;
    else if (character === ']' && --depth === 0) {
      end = i + 1;
      break;
    }
  }
  if (end === -1) throw new Error('ABI array has no matching bracket');
  const node = parseExpressionAt(source.slice(position, end), 0, {
    ecmaVersion: 'latest',
  });
  return { binding, start: position, end, abi: evidenceABI(literal(node)) };
}

const appUrl = 'https://app.kittenswap.finance/';
const appHtml = await (
  await fetch(appUrl, { signal: AbortSignal.timeout(20000) })
).text();
const scriptPaths = [
  ...appHtml.matchAll(/<script[^>]*src=["']([^"']+\.js)["']/g),
].map((m) => m[1]);
const scriptUrl = new URL(
  scriptPaths.find((p) => /index-/.test(p)) || scriptPaths[0],
  appUrl,
).href;
const bundle = await (
  await fetch(scriptUrl, { signal: AbortSignal.timeout(30000) })
).text();
const bindings = {
  factory: 'rGt',
  quoter: 'fze',
  router: 'sGt',
  rebase: 'Rzt',
  escrow: 'C$',
};
type Extraction =
  | { binding: string; start: number; end: number; abi: EvidenceABI }
  | { binding: string; extractionError: string; abi?: undefined };
const abis: Record<string, Extraction> = {};
for (const [name, binding] of Object.entries(bindings)) {
  try {
    abis[name] = extractArray(bundle, binding);
  } catch (error) {
    abis[name] = { binding, extractionError: errorInfo(error).message };
  }
}
save('app-abi-evidence.json', {
  observedAtUtc: new Date().toISOString(),
  appUrl,
  scriptUrl,
  bundleSha256: sha(bundle),
  bytes: Buffer.byteLength(bundle),
  extraction:
    'Parsed literal ABI arrays only; bundle was never executed and implementation code was not retained.',
  abis,
});
if (Object.values(abis).some((v) => !v.abi))
  throw new Error(
    'Required ABI extraction failed; inspect app-abi-evidence.json before collecting RPC evidence.',
  );

const addresses: Record<string, string> = {
  factory: '0x5f95E92c338e6453111Fc55ee66D4AafccE661A7',
  quoter: '0xc58874216AFe47779ADED27B8AAd77E8Bd6eBEBb',
  router: '0x4e73E421480a7E0C24fB3c11019254edE194f736',
  rebase: '0xDd002E8DF80ccB7A8964BFef6e15ee36D414fC36',
  veKitten: '0x29d3A21fF35a519E00cF6d272f2aD897b109BD84',
  voter: '0xb7F7053F7e6c210e6777D5BA758E4b3ECa6C88A0',
  kitten: '0x618275F8EFE54c2afa87bfB9F210A52F0fF89364',
  whype: '0x5555555555555555555555555555555555555555',
  usdc: '0xb88339cb7199b77e23db6e890353e22632ba630f',
  primaryPool: '0x12df9913e9e08453440e3c4b1ae73819160b513e',
};
const block = record(await rpc('eth_getBlockByNumber', ['latest', false]));
const blockTag = rpcQuantity(block.number);
const rows: CallRow[] = [];
const iface = (name: string) => {
  const entry = abis[name];
  if (!entry?.abi) throw new Error(`Required ABI ${name} missing.`);
  return new Interface(entry.abi);
};
async function read(
  label: string,
  address: string,
  contractInterface: Interface,
  method: string,
  args: readonly unknown[] = [],
  extra: Record<string, unknown> = {},
): Promise<Result | null> {
  try {
    const data = contractInterface.encodeFunctionData(method, args);
    const raw = hex(
      await rpc('eth_call', [{ to: address, data, ...extra }, blockTag]),
    );
    const decoded = contractInterface.decodeFunctionResult(method, raw);
    const row = {
      label,
      address,
      method,
      signature: signature(contractInterface, method).format('sighash'),
      args,
      raw,
      decoded: Array.from(decoded),
    };
    rows.push(row);
    return decoded;
  } catch (error) {
    rows.push({
      label,
      address,
      method,
      args,
      error: errorInfo(error).message,
      data: errorInfo(error).data,
    });
    return null;
  }
}
const erc20 = new Interface([
  'function decimals() view returns(uint8)',
  'function symbol() view returns(string)',
  'function balanceOf(address) view returns(uint256)',
  'function allowance(address,address) view returns(uint256)',
]);
const poolInterface = new Interface([
  'function token0() view returns(address)',
  'function token1() view returns(address)',
  'function liquidity() view returns(uint128)',
  'function plugin() view returns(address)',
  'function factory() view returns(address)',
  'function globalState() view returns(uint160 price,int24 tick,uint16 lastFee,uint8 pluginConfig,uint16 communityFee,bool unlocked)',
]);
const code: Record<string, CodeRecord> = {};
const implementationSlot =
  '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
for (const [name, address] of Object.entries(addresses)) {
  const runtime = hex(await rpc('eth_getCode', [address, blockTag]));
  const storage = hex(
    await rpc('eth_getStorageAt', [address, implementationSlot, blockTag]),
    32,
  );
  code[name] = {
    address,
    runtimeBytes: (runtime.length - 2) / 2,
    runtimeKeccak256: keccak256(runtime),
    implementationSlot: storage,
  };
}
for (const name of ['kitten', 'whype', 'usdc']) {
  await read(`${name} decimals`, addresses[name], erc20, 'decimals');
  await read(`${name} symbol`, addresses[name], erc20, 'symbol');
}
for (const name of ['factory', 'quoter', 'router', 'rebase']) {
  if (!abis[name]?.abi) continue;
  for (const method of [
    'factory',
    'poolDeployer',
    'WNativeToken',
    'veKitten',
    'voter',
    'kitten',
  ]) {
    if (iface(name).getFunction(method)?.inputs.length === 0)
      await read(`${name} ${method}`, addresses[name], iface(name), method);
  }
}
if (abis.factory?.abi) {
  for (const [a, b] of [
    ['whype', 'usdc'],
    ['kitten', 'whype'],
    ['kitten', 'usdc'],
  ]) {
    const result = await read(
      `base pool ${a}/${b}`,
      addresses.factory,
      iface('factory'),
      'poolByPair',
      [addresses[a], addresses[b]],
    );
    if (a === 'kitten' && b === 'whype' && result && result[0] !== ZeroAddress)
      addresses.kittenWhypePool = string(result[0]);
  }
}
for (const name of ['primaryPool', 'kittenWhypePool']) {
  if (!addresses[name]) continue;
  for (const method of [
    'token0',
    'token1',
    'liquidity',
    'plugin',
    'factory',
    'globalState',
  ])
    await read(`${name} ${method}`, addresses[name], poolInterface, method);
}
if (abis.quoter?.abi) {
  for (const [a, b, amount] of [
    ['whype', 'usdc', 10n ** 18n],
    ['kitten', 'whype', 10000n * 10n ** 18n],
    ['kitten', 'usdc', 10000n * 10n ** 18n],
  ] as const) {
    await read(
      `quote ${a}/${b}`,
      addresses.quoter,
      iface('quoter'),
      'quoteExactInputSingle',
      [[addresses[a], addresses[b], ZeroAddress, amount, 0]],
    );
  }
  const route = solidityPacked(
    ['address', 'address', 'address', 'address', 'address'],
    [
      addresses.kitten,
      ZeroAddress,
      addresses.whype,
      ZeroAddress,
      addresses.usdc,
    ],
  );
  await read(
    'quote KITTEN→WHYPE→USDC',
    addresses.quoter,
    iface('quoter'),
    'quoteExactInput',
    [route, 10000n * 10n ** 18n],
  );
}
for (const txHash of [
  '0xba122414959a8baf89c2a760726066c3f8a703c3ddcfc16528a7d9799cd4073e',
  '0x70873bb3b1e951f027269bbed1e74e2834684e4f9a149b2840bf54826a95e43c',
]) {
  const transaction = parseTransaction(
    await rpc('eth_getTransactionByHash', [txHash]),
  );
  const receipt = parseReceipt(
    await rpc('eth_getTransactionReceipt', [txHash]),
  );
  let decoded: unknown;
  try {
    const p = iface('router').parseTransaction({
      data: transaction.input,
      value: transaction.value,
    });
    if (!p)
      throw new Error('Historical transaction does not match router ABI.');
    decoded = {
      name: p.name,
      signature: p.signature,
      args: Array.from(p.args),
    };
  } catch (error) {
    decoded = { error: errorInfo(error).message };
  }
  save(`transaction-${txHash.slice(2, 10)}.json`, {
    transaction,
    receipt,
    decoded,
  });
}
save('rpc-route-evidence.json', {
  observedAtUtc: new Date().toISOString(),
  endpoint: rpcUrl,
  chainId: await rpc('eth_chainId', []),
  block: {
    number: parseInt(blockTag, 16),
    hash: hex(block.hash, 32),
    timestamp: parseInt(rpcQuantity(block.timestamp), 16),
  },
  addresses,
  code,
  rows,
  caution:
    'All methods are read-only; no state or balance overrides; no wallet, signing or broadcast. A quoter result proves a quoted route at observed state, not a funded isolated-vault execution or future price.',
});
save('rpc-requests.json', rpcRecords);
console.log(
  JSON.stringify(
    {
      block: parseInt(blockTag, 16),
      bundleSha256: sha(bundle),
      extracted: Object.keys(abis),
      rows: rows.length,
      errors: rows
        .filter((r) => r.error)
        .map((r) => ({ label: r.label, error: r.error })),
      quoterResults: rows
        .filter((r) => r.label.startsWith('quote'))
        .map((r) => ({ label: r.label, decoded: r.decoded, error: r.error })),
    },
    (_, v) => (typeof v === 'bigint' ? v.toString() : v),
    2,
  ),
);
