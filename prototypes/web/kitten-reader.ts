import { KITTEN } from './config.ts';

// Small explicit ABI surface, selectors generated with ethers.id(signature).
export const SELECTORS = Object.freeze({
  ownerOf: '0x6352211e',
  locked: '0xb45a3c0e',
  balanceOfNFT: '0xe7e242d4',
  voted: '0x8fbb38ff',
  getApproved: '0x081812fc',
  getCurrentPeriod: '0x086146d2',
  checkPeriodVoted: '0x650ed4e4',
});
export type RpcReader = (
  method: string,
  params: readonly unknown[],
) => Promise<unknown>;
export type ReaderField =
  'locked' | 'power' | 'nftVoted' | 'approved' | 'period' | 'periodVoted';
export interface KittenSnapshot {
  id: string;
  owner: string;
  chainId: number;
  block: string;
  blockHash: string;
  timestamp: number;
  checkedAt: number;
  errors: Partial<Record<ReaderField, string>>;
  amount?: string;
  expiry?: number;
  approved?: string;
  nftVoted?: boolean;
  power?: string;
  period?: string;
  periodVoted?: boolean;
}
const uint = (n: string | number | bigint) =>
  BigInt(n).toString(16).padStart(64, '0');
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
function hex(value: unknown): string {
  if (typeof value !== 'string' || !/^0x[0-9a-f]+$/i.test(value))
    throw new Error('Unexpected numeric RPC response.');
  return value;
}
function block(value: unknown): {
  number: string;
  timestamp: string;
  hash: string;
} {
  if (
    !object(value) ||
    typeof value.hash !== 'string' ||
    !/^0x[0-9a-f]{64}$/i.test(value.hash)
  )
    throw new Error('Block metadata is unavailable.');
  const number = hex(value.number),
    timestamp = hex(value.timestamp);
  if (BigInt(timestamp) > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error('Block timestamp is unsupported.');
  return { number, timestamp, hash: value.hash };
}
export function validateTokenId(value: unknown): bigint {
  if (
    (typeof value !== 'string' &&
      typeof value !== 'bigint' &&
      typeof value !== 'number') ||
    (typeof value === 'number' && !Number.isSafeInteger(value)) ||
    !/^\d+$/.test(String(value))
  )
    throw new Error('Enter a numeric veKITTEN token ID.');
  const id = BigInt(value);
  if (id < 1n || id >= 2n ** 256n)
    throw new Error('Token ID must be between 1 and uint256 maximum.');
  return id;
}
export async function rpc(
  method: string,
  params: readonly unknown[],
  fetcher: typeof fetch = fetch,
): Promise<unknown> {
  // No sendTransaction, signing, wallet provider, or private-key handling exists here.
  if (!['eth_chainId', 'eth_getBlockByNumber', 'eth_call'].includes(method))
    throw new Error('Read-only RPC method required.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetcher(KITTEN.rpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: controller.signal,
    });
    if (!response.ok)
      throw new Error(`Public RPC returned HTTP ${response.status}.`);
    const body: unknown = await response.json();
    if (!object(body)) throw new Error('Invalid public RPC envelope.');
    if (body.error || body.result == null)
      throw new Error(
        object(body.error) && typeof body.error.message === 'string'
          ? body.error.message
          : 'No result from public RPC.',
      );
    return body.result;
  } finally {
    clearTimeout(timeout);
  }
}
function words(value: unknown, expected = 1): bigint[] {
  if (
    typeof value !== 'string' ||
    !/^0x[0-9a-f]+$/i.test(value) ||
    value.length !== 2 + expected * 64
  )
    throw new Error('Unexpected contract response.');
  return Array.from({ length: expected }, (_, i) =>
    BigInt(`0x${value.slice(2 + i * 64, 66 + i * 64)}`),
  );
}
function address(value: unknown): string {
  words(value);
  if (typeof value !== 'string' || !/^0x0{24}[0-9a-f]{40}$/i.test(value))
    throw new Error('Invalid address response.');
  return `0x${value.slice(-40)}`;
}
/** Snapshot all observations at a single numeric block tag; no guessed fallbacks. */
export async function readKitten(
  value: unknown,
  rpcFn: RpcReader = rpc,
): Promise<KittenSnapshot> {
  const id = validateTokenId(value);
  const chain = BigInt(hex(await rpcFn('eth_chainId', [])));
  if (chain !== BigInt(KITTEN.chainId))
    throw new Error('RPC is on an unexpected chain. Nothing was read.');
  const head = block(await rpcFn('eth_getBlockByNumber', ['latest', false]));
  const call = (
    to: string,
    selector: string,
    args: readonly (string | bigint)[] = [],
  ) =>
    rpcFn('eth_call', [
      { to, data: selector + args.map(uint).join('') },
      head.number,
    ]);
  const owner = address(await call(KITTEN.escrow, SELECTORS.ownerOf, [id]));
  if (/^0x0{40}$/.test(owner))
    throw new Error('The NFT has no owner at this block.');
  const requests = {
    locked: () => call(KITTEN.escrow, SELECTORS.locked, [id]),
    power: () => call(KITTEN.escrow, SELECTORS.balanceOfNFT, [id]),
    nftVoted: () => call(KITTEN.escrow, SELECTORS.voted, [id]),
    approved: () => call(KITTEN.escrow, SELECTORS.getApproved, [id]),
    period: () => call(KITTEN.voter, SELECTORS.getCurrentPeriod),
  };
  const keys = ['locked', 'power', 'nftVoted', 'approved', 'period'] as const;
  const results = await Promise.allSettled(keys.map((key) => requests[key]()));
  const snapshot: KittenSnapshot = {
    id: id.toString(),
    owner,
    chainId: KITTEN.chainId,
    block: BigInt(head.number).toString(),
    blockHash: head.hash,
    timestamp: Number(BigInt(head.timestamp)),
    checkedAt: Date.now(),
    errors: {},
  };
  results.forEach((result, index) => {
    const key = keys[index];
    try {
      if (result.status === 'rejected') throw result.reason;
      if (key === 'locked') {
        const [amount, expiry] = words(result.value, 2);
        // Negative int128 values have a sign-extended ABI word. Never display as a giant balance.
        if (amount >= 2n ** 127n || expiry > BigInt(Number.MAX_SAFE_INTEGER))
          throw new Error('Unsupported lock response.');
        snapshot.amount = amount.toString();
        snapshot.expiry = Number(expiry);
      } else if (key === 'approved') snapshot.approved = address(result.value);
      else if (key === 'nftVoted') {
        const [voted] = words(result.value);
        if (voted > 1n) throw new Error('Invalid boolean response.');
        snapshot.nftVoted = voted === 1n;
      } else snapshot[key] = words(result.value)[0].toString();
    } catch (error) {
      snapshot.errors[key] =
        error instanceof Error ? error.message : 'Contract field unavailable.';
    }
  });
  if (snapshot.period != null) {
    try {
      // Verified ABI: checkPeriodVoted(period, tokenId). This is distinct from escrow.voted(id).
      const [voted] = words(
        await call(KITTEN.voter, SELECTORS.checkPeriodVoted, [
          snapshot.period,
          id,
        ]),
      );
      if (voted > 1n) throw new Error('Invalid period vote response.');
      snapshot.periodVoted = voted === 1n;
    } catch (error) {
      snapshot.errors.periodVoted =
        error instanceof Error
          ? error.message
          : 'Period vote observation unavailable.';
    }
  }
  return snapshot;
}
