import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Interface, keccak256 } from 'ethers';

const directory = path.dirname(fileURLToPath(import.meta.url));
const readJson = name => JSON.parse(fs.readFileSync(path.join(directory, name)));
const snapshot = readJson('rpc-route-evidence.json');
const abiEvidence = readJson('app-abi-evidence.json');
const abis = abiEvidence.abis;
const endpoint = snapshot.endpoint;
const blockTag = `0x${snapshot.block.number.toString(16)}`;
const a = snapshot.addresses;
const records = [];
let id = 1;
const whitelist = new Set(['eth_call', 'eth_getCode', 'eth_getTransactionByHash', 'eth_getTransactionReceipt']);
async function rpc(method, params) {
  if (!whitelist.has(method)) throw new Error('Read-only methods only');
  const request = { jsonrpc: '2.0', id: id++, method, params };
  const result = await (await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request), signal: AbortSignal.timeout(20000) })).json();
  records.push({ request, response: method === "eth_getCode" && typeof result.result === "string" ? { ...result, result: { runtimeKeccak256: keccak256(result.result), runtimeBytes: (result.result.length - 2) / 2, publicationSummary: true } } : result });
  if (result.error) throw new Error(result.error.message);
  return result.result;
}
function save(name, value) { fs.writeFileSync(path.join(directory, name), JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2) + '\n'); }
const rows = [];
async function call(label, address, abi, method, args = []) {
  const iface = new Interface(abi);
  try {
    const raw = await rpc('eth_call', [{ to: address, data: iface.encodeFunctionData(method, args) }, blockTag]);
    const decoded = Array.from(iface.decodeFunctionResult(method, raw));
    rows.push({ label, address, signature: iface.getFunction(method).format('sighash'), args, raw, decoded });
    return decoded;
  } catch (error) { rows.push({ label, address, method, args, error: error.message }); return null; }
}
const poolAbi = ['function token0() view returns(address)', 'function token1() view returns(address)', 'function liquidity() view returns(uint128)', 'function plugin() view returns(address)', 'function factory() view returns(address)', 'function globalState() view returns(uint160,int24,uint16,uint8,uint16,bool)'];
const direct = snapshot.rows.find(r => r.label === 'base pool kitten/usdc').decoded[0];
for (const method of ['token0', 'token1', 'liquidity', 'plugin', 'globalState']) await call(`direct KITTEN/USDC ${method}`, direct, poolAbi, method);
for (const method of ['getRewardList', 'getCurrentPeriod', 'DURATION', 'owner']) await call(`rebase ${method}`, a.rebase, abis.rebase.abi, method);
for (const method of ['kitten', 'voter']) await call(`escrow ${method}`, a.veKitten, abis.escrow.abi, method);
const code = {};
const implementations = Object.fromEntries(['kitten', 'rebase', 'veKitten', 'voter'].map(k => [`${k}Implementation`, `0x${snapshot.code[k].implementationSlot.slice(-40)}`]));
const extraAddresses = { kittenWhypePool: a.kittenWhypePool, directKittenUsdcPool: direct, ...implementations,
  whypeUsdcPlugin: snapshot.rows.find(r => r.label === 'primaryPool plugin').decoded[0],
  kittenWhypePlugin: snapshot.rows.find(r => r.label === 'kittenWhypePool plugin').decoded[0] };
for (const [label, address] of Object.entries(extraAddresses)) {
  const runtime = await rpc('eth_getCode', [address, blockTag]);
  code[label] = { address, runtimeBytes: (runtime.length - 2) / 2, runtimeKeccak256: keccak256(runtime) };
}
const transferInterface = new Interface(['event Transfer(address indexed from,address indexed to,uint256 value)']);
const escrowInterface = new Interface(abis.escrow.abi);
const rebaseInterface = new Interface(abis.rebase.abi);
const routerInterface = new Interface(abis.router.abi);
function decodedLogs(receipt) {
  return receipt.logs.flatMap(log => {
    const address = log.address.toLowerCase();
    let iface;
    if ([a.kitten, a.whype, a.usdc].map(x => x.toLowerCase()).includes(address)) iface = transferInterface;
    else if (address === a.veKitten.toLowerCase()) iface = escrowInterface;
    else if (address === a.rebase.toLowerCase()) iface = rebaseInterface;
    else return [];
    try { const p = iface.parseLog(log); return p ? [{ address: log.address, name: p.name, signature: p.signature, fields: p.fragment.inputs.map((x, i) => ({ name: x.name, value: p.args[i] })) }] : []; }
    catch { return []; }
  });
}
function decodeCalls(data, iface) {
  const p = iface.parseTransaction({ data });
  return { name: p.name, signature: p.signature, args: Array.from(p.args), selector: p.selector,
    ...(p.name === 'multicall' ? { innerCalls: p.args[0].map(v => decodeCalls(v, iface)) } : {}) };
}
const historical = [];
for (const name of ['ba122414', '70873bb3']) {
  const item = readJson(`transaction-${name}.json`);
  historical.push({ transactionHash: item.transaction.hash, block: parseInt(item.receipt.blockNumber, 16), status: item.receipt.status,
    from: item.transaction.from, to: item.transaction.to, call: decodeCalls(item.transaction.input, routerInterface), logs: decodedLogs(item.receipt) });
}
const rebaseHash = '0xb5c1569eaa6e753d1aa0cf1c207dad9f157e880d067bf133fca9fd8a02b0198e';
const transaction = await rpc('eth_getTransactionByHash', [rebaseHash]);
const receipt = await rpc('eth_getTransactionReceipt', [rebaseHash]);
const rebaseCall = decodeCalls(transaction.input, rebaseInterface);
const rebaseSample = { transaction, receipt, call: rebaseCall, logs: decodedLogs(receipt) };
save('transaction-rebase-b5c1569e.json', rebaseSample);
await call('sample rebase NFT owner now', a.veKitten, abis.escrow.abi, 'ownerOf', [rebaseCall.args[0]]);
await call('sample rebase NFT locked now', a.veKitten, abis.escrow.abi, 'locked', [rebaseCall.args[0]]);
await call('sample rebase NFT earned now', a.rebase, abis.rebase.abi, 'earnedForTokenId', [rebaseCall.args[0]]);
const signatures = {};
for (const [name, methods] of Object.entries({ router: ['exactInputSingle', 'exactInput'], quoter: ['quoteExactInputSingle', 'quoteExactInput'], rebase: ['getRewardForTokenId', 'getRewardForPeriod', 'getRewardForOwner', 'earnedForTokenId'] })) {
  const iface = new Interface(abis[name].abi);
  signatures[name] = methods.map(method => ({ signature: iface.getFunction(method).format('sighash'), selector: iface.getFunction(method).selector, abi: abis[name].abi.find(x => x.name === method && x.type === 'function') }));
}
save('supplement-evidence.json', { observedAtUtc: new Date().toISOString(), endpoint, block: snapshot.block, rows, code, signatures, historical,
  rebaseSample: { hash: transaction.hash, from: transaction.from, to: transaction.to, block: parseInt(receipt.blockNumber, 16), status: receipt.status, call: rebaseCall, logs: rebaseSample.logs },
  limitation: 'Current-state calls and existing transaction logs only. No state/balance overrides, funded vault swap, execution trace or before/after archive state reconstruction.' });
save('supplement-rpc-requests.json', records);
console.log(JSON.stringify({ rows: rows.map(r => ({ label: r.label, decoded: r.decoded, error: r.error })), rebaseSample: { hash: transaction.hash, call: rebaseCall, logs: rebaseSample.logs } }, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2));
