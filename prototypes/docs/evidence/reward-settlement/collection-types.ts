import { Interface, type InterfaceAbi } from 'ethers';
import { abi, array, record, string } from '../../../scripts/boundaries.ts';

export type EvidenceABI = Exclude<InterfaceAbi, string>;
export type RpcRequest = {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params: readonly unknown[];
};
export type RpcRecord = { request: RpcRequest; response: unknown };
export type CallRow = {
  label: string;
  address: string;
  method?: string;
  signature?: string;
  args: readonly unknown[];
  raw?: string;
  decoded?: unknown[];
  error?: string;
  data?: unknown;
};
export type CodeRecord = {
  address: string;
  runtimeBytes: number;
  runtimeKeccak256: string;
  implementationSlot?: string;
};
export type RouteEvidence = {
  endpoint: string;
  block: { number: number; hash: string; timestamp: number };
  addresses: Record<string, string>;
  code: Record<string, CodeRecord>;
  rows: CallRow[];
};
export type Transaction = Record<string, unknown> & {
  hash: string;
  input: string;
  value: string;
  from: string;
  to: string | null;
};
export type RpcLog = Record<string, unknown> & {
  address: string;
  data: string;
  topics: string[];
};
export type Receipt = Record<string, unknown> & {
  blockNumber: string;
  status: string;
  logs: RpcLog[];
};
export type DecodedCall = {
  name: string;
  signature: string;
  args: unknown[];
  selector: string;
  innerCalls?: DecodedCall[];
};
export type DecodedLog = {
  address: string;
  name: string;
  signature: string;
  fields: { name: string; value: unknown }[];
};
export function hex(value: unknown, bytes?: number): string {
  const text = string(value);
  if (
    !/^0x(?:[0-9a-f]{2})*$/i.test(text) ||
    (bytes != null && text.length !== 2 + bytes * 2)
  )
    throw new Error('Expected exact hexadecimal bytes.');
  return text;
}
export function rpcQuantity(value: unknown): string {
  const text = string(value);
  if (!/^0x[0-9a-f]+$/i.test(text))
    throw new Error('Expected an RPC hexadecimal quantity.');
  return text;
}
export function address(value: unknown): string {
  return hex(value, 20);
}
export function exactNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new Error('Expected a non-negative safe integer.');
  return value;
}
export function evidenceABI(value: unknown): EvidenceABI {
  const parsed = abi(value);
  if (typeof parsed === 'string')
    throw new Error('Expected an extracted literal ABI array.');
  return parsed;
}
export function parseAbis(
  value: unknown,
): Record<string, { abi: EvidenceABI }> {
  const rows = record(record(value).abis),
    result: Record<string, { abi: EvidenceABI }> = {};
  for (const [name, entry] of Object.entries(rows))
    result[name] = { abi: evidenceABI(record(entry).abi) };
  return result;
}
export function requiredAbi(
  rows: Record<string, { abi: EvidenceABI }>,
  name: string,
): EvidenceABI {
  const entry = rows[name];
  if (!entry) throw new Error(`Required ABI ${name} is missing.`);
  return entry.abi;
}
export function signature(iface: Interface, method: string) {
  const fragment = iface.getFunction(method);
  if (!fragment) throw new Error(`Required ABI function ${method} is missing.`);
  return fragment;
}
export function transaction(value: unknown): Transaction {
  const row = record(value);
  return {
    ...row,
    hash: hex(row.hash, 32),
    input: hex(row.input),
    value: rpcQuantity(row.value),
    from: address(row.from),
    to: row.to == null ? null : address(row.to),
  };
}
export function receipt(value: unknown): Receipt {
  const row = record(value);
  const logs = array(row.logs).map((value) => {
    const log = record(value);
    return {
      ...log,
      address: address(log.address),
      data: hex(log.data),
      topics: array(log.topics).map((value) => hex(value, 32)),
    };
  });
  return {
    ...row,
    blockNumber: rpcQuantity(row.blockNumber),
    status: rpcQuantity(row.status),
    logs,
  };
}
export function parseRouteEvidence(value: unknown): RouteEvidence {
  const row = record(value),
    block = record(row.block),
    rawAddresses = record(row.addresses),
    rawCode = record(row.code);
  const endpoint = string(row.endpoint),
    url = new URL(endpoint);
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error('Expected a public RPC endpoint.');
  const addresses: Record<string, string> = {},
    code: Record<string, CodeRecord> = {};
  for (const [name, value] of Object.entries(rawAddresses))
    addresses[name] = address(value);
  for (const [name, value] of Object.entries(rawCode)) {
    const item = record(value);
    code[name] = {
      address: address(item.address),
      runtimeBytes: exactNumber(item.runtimeBytes),
      runtimeKeccak256: hex(item.runtimeKeccak256, 32),
      implementationSlot:
        item.implementationSlot == null
          ? undefined
          : hex(item.implementationSlot, 32),
    };
  }
  const rows = array(row.rows).map((value) => {
    const item = record(value);
    return {
      label: string(item.label),
      address: address(item.address),
      args: array(item.args),
      decoded: item.decoded == null ? undefined : array(item.decoded),
      error: item.error == null ? undefined : string(item.error),
    };
  });
  return {
    endpoint,
    block: {
      number: exactNumber(block.number),
      hash: hex(block.hash, 32),
      timestamp: exactNumber(block.timestamp),
    },
    addresses,
    code,
    rows,
  };
}
export function rowAddress(rows: readonly CallRow[], label: string): string {
  const row = rows.find((row) => row.label === label);
  if (!row?.decoded)
    throw new Error(`Required recorded call ${label} has no decoded result.`);
  return address(row.decoded[0]);
}
