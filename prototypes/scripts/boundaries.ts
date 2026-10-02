import { Interface, type InterfaceAbi, type Result } from 'ethers';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type UnknownRecord = Record<string, unknown>;
export function record(value: unknown): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Expected an object.');
  return value as UnknownRecord;
}
export function string(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Expected a string.');
  return value;
}
export function bigint(value: unknown): bigint {
  if (typeof value !== 'bigint')
    throw new Error('Expected a decoded Solidity integer.');
  return value;
}
export function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean')
    throw new Error('Expected a decoded Solidity boolean.');
  return value;
}
export function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('Expected an array.');
  return value as unknown[];
}
export function abi(value: unknown): InterfaceAbi {
  const entries = array(value);
  for (const entry of entries) {
    if (typeof entry !== 'string') {
      const fragment = record(entry);
      if (typeof fragment.type !== 'string')
        throw new Error('Invalid ABI fragment.');
    }
  }
  // ethers validates the ABI fragment grammar and components at this boundary.
  const validated = entries as InterfaceAbi;
  new Interface(validated);
  return validated;
}
export function errorInfo(value: unknown) {
  const fields =
    value && typeof value === 'object' ? (value as UnknownRecord) : {};
  return {
    message:
      typeof fields.message === 'string' ? fields.message : String(value),
    shortMessage:
      typeof fields.shortMessage === 'string' ? fields.shortMessage : undefined,
    code:
      typeof fields.code === 'string' || typeof fields.code === 'number'
        ? fields.code
        : undefined,
    data: typeof fields.data === 'string' ? fields.data : undefined,
    integrityFailure: fields.integrityFailure === true,
  };
}
export function decodedRecord(result: Result): UnknownRecord {
  return result.toObject() as UnknownRecord;
}
