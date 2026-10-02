import { getAddress, Interface } from 'ethers';
import { errorCode, rpcReverted } from './errors.ts';
import { isRecord } from './validation.ts';
import type {
  ChainAdapter,
  ChainHealth,
  ChainOptions,
  Page,
  Position,
} from './types.ts';

interface BlockSnapshot {
  number: number;
  hash: string;
  timestamp: number;
}
interface OwnershipCursor {
  address: string;
  offset: number;
  blockNumber: number;
  blockHash: string;
  issuedAt: number;
}
interface RawOwnershipOptions {
  cursor?: unknown;
  limit?: unknown;
}
export interface ChainReader extends ChainAdapter {
  getPosition(value: unknown): Promise<Position>;
  getPositions(values: unknown): Promise<(Position | null)[]>;
  getOwnedPositions(
    value: unknown,
    options?: RawOwnershipOptions,
  ): Promise<Page<Position>>;
}

export const KITTEN_CHAIN = Object.freeze({
  chainId: 999,
  escrow: '0x29d3A21fF35a519E00cF6d272f2aD897b109BD84',
  token: '0x618275F8EFE54c2afa87bfB9F210A52F0fF89364',
  rpcUrl: 'https://rpc.hyperliquid.xyz/evm',
});

const abi = new Interface([
  'function ownerOf(uint256) view returns (address)',
  'function locked(uint256) view returns (int128 amount,uint256 end)',
  'function balanceOfNFT(uint256) view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function tokenOfOwnerByIndex(address,uint256) view returns (uint256)',
  'function MAXTIME() view returns (uint256)',
]);
const hashPattern = /^0x[0-9a-f]{64}$/i;
const allowedMethods = new Set([
  'eth_chainId',
  'eth_getBlockByNumber',
  'eth_getCode',
  'eth_call',
]);
const unavailable = () =>
  Object.assign(
    new Error(
      'Verified chain data is temporarily unavailable. Please try again.',
    ),
    { code: 'CHAIN_UNAVAILABLE' },
  );
const invalidToken = () =>
  Object.assign(new Error('Enter a valid numeric veKITTEN token ID.'), {
    code: 'INVALID_TOKEN_ID',
  });
const notFound = () =>
  Object.assign(new Error('This veKITTEN position was not found.'), {
    code: 'POSITION_NOT_FOUND',
  });
const uint256Maximum = (1n << 256n) - 1n;
const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export function tokenId(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[1-9]\d{0,77}$/.test(value) ||
    BigInt(value) > uint256Maximum
  )
    throw invalidToken();
  return value;
}

function numeric(value: unknown): number {
  if (typeof value !== 'string' || !/^0x[0-9a-f]+$/i.test(value))
    throw unavailable();
  const integer = BigInt(value);
  if (integer > BigInt(Number.MAX_SAFE_INTEGER)) throw unavailable();
  return Number(integer);
}

export function createChain(config: ChainOptions = {}): ChainReader {
  const endpoint = new URL(config.rpcUrl ?? KITTEN_CHAIN.rpcUrl);
  if (
    !['https:', 'http:'].includes(endpoint.protocol) ||
    endpoint.username ||
    endpoint.password
  )
    throw new Error(
      'RPC URL must be an HTTP(S) endpoint without embedded credentials.',
    );
  const fetcher = config.fetch ?? globalThis.fetch;
  const now = config.now ?? Date.now;
  const confirmations = config.confirmations ?? 2;
  const maxHeadAgeSeconds = config.maxHeadAgeSeconds ?? 60;
  const timeoutMs = config.timeoutMs ?? 8_000;
  for (const [value, minimum, maximum] of [
    [confirmations, 1, 100],
    [maxHeadAgeSeconds, 10, 300],
    [timeoutMs, 100, 15_000],
  ]) {
    if (!Number.isInteger(value) || value < minimum || value > maximum)
      throw new Error('Invalid chain reader configuration.');
  }
  let sequence = 0;
  let active = 0;
  const queue: (() => void)[] = [];
  const enter = async () => {
    if (queue.length >= 128) throw unavailable();
    if (active >= 4) {
      await new Promise<void>((resolve) => queue.push(resolve));
    } else active += 1;
  };
  const leave = () => {
    const next = queue.shift();
    if (next) next();
    else active -= 1;
  };

  async function rpc(
    method: string,
    params: readonly unknown[],
  ): Promise<unknown> {
    if (!allowedMethods.has(method)) throw unavailable();
    await enter();
    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const id = ++sequence;
        try {
          const response = await fetcher(endpoint.href, {
            method: 'POST',
            redirect: 'error',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
            signal: AbortSignal.timeout(timeoutMs),
          });
          if ([429, 502, 503, 504].includes(response.status) && attempt < 2) {
            await response.body?.cancel();
            await sleep(100 * (attempt + 1));
            continue;
          }
          if (
            !response.ok ||
            Number(response.headers.get('content-length') ?? 0) > 1_048_576
          )
            throw unavailable();
          if (!response.body) throw unavailable();
          const reader = response.body.getReader();
          const chunks: Uint8Array[] = [];
          let size = 0;
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > 1_048_576) {
              await reader.cancel();
              throw unavailable();
            }
            chunks.push(value);
          }
          const result: unknown = JSON.parse(
            Buffer.concat(chunks).toString('utf8'),
          );
          if (!isRecord(result) || result.jsonrpc !== '2.0' || result.id !== id)
            throw unavailable();
          if (result.error) {
            if (isRecord(result.error) && result.error.code === 3)
              throw Object.assign(unavailable(), { rpcRevert: true });
            throw unavailable();
          }
          if (result.result == null) throw unavailable();
          return result.result;
        } catch (error) {
          // Retry only explicitly transient HTTP statuses. Never turn a contract revert
          // or a malformed/unpinned provider response into plausible state.
          if (rpcReverted(error)) throw error;
          throw unavailable();
        }
      }
      throw unavailable();
    } finally {
      leave();
    }
  }

  function validateBlock(block: unknown): BlockSnapshot {
    if (
      !isRecord(block) ||
      typeof block.hash !== 'string' ||
      !hashPattern.test(block.hash)
    )
      throw unavailable();
    const number = numeric(block.number);
    const timestamp = numeric(block.timestamp);
    const age = now() / 1000 - timestamp;
    if (age > maxHeadAgeSeconds || age < -15) throw unavailable();
    return { number, hash: block.hash, timestamp };
  }

  async function snapshot(
    cursor: OwnershipCursor | null = null,
  ): Promise<BlockSnapshot> {
    if (numeric(await rpc('eth_chainId', [])) !== KITTEN_CHAIN.chainId)
      throw unavailable();
    const head = validateBlock(
      await rpc('eth_getBlockByNumber', ['latest', false]),
    );
    const safe = head.number - confirmations;
    if (safe < 1 || (cursor && cursor.blockNumber > safe)) throw unavailable();
    let block;
    if (cursor) {
      block = validateBlock(
        await rpc('eth_getBlockByNumber', [
          `0x${cursor.blockNumber.toString(16)}`,
          false,
        ]),
      );
      if (
        block.number !== cursor.blockNumber ||
        block.hash !== cursor.blockHash
      )
        throw unavailable();
    } else {
      block = validateBlock(
        await rpc('eth_getBlockByNumber', [`0x${safe.toString(16)}`, false]),
      );
      if (block.number !== safe) throw unavailable();
    }
    const code = await rpc('eth_getCode', [
      KITTEN_CHAIN.escrow,
      { blockHash: block.hash, requireCanonical: true },
    ]);
    if (typeof code !== 'string' || !/^0x(?:[0-9a-f]{2})+$/i.test(code))
      throw unavailable();
    return block;
  }

  async function call(
    block: BlockSnapshot,
    method: string,
    args: readonly unknown[] = [],
  ): Promise<readonly unknown[]> {
    const result = await rpc('eth_call', [
      { to: KITTEN_CHAIN.escrow, data: abi.encodeFunctionData(method, args) },
      { blockHash: block.hash, requireCanonical: true },
    ]);
    if (typeof result !== 'string') throw unavailable();
    try {
      return abi.decodeFunctionResult(method, result);
    } catch {
      throw unavailable();
    }
  }

  async function fence(block: BlockSnapshot): Promise<void> {
    const after = validateBlock(
      await rpc('eth_getBlockByNumber', [
        `0x${block.number.toString(16)}`,
        false,
      ]),
    );
    if (after.number !== block.number || after.hash !== block.hash)
      throw unavailable();
  }

  function abiInteger(value: unknown): bigint {
    if (typeof value !== 'bigint') throw unavailable();
    return value;
  }
  async function readPosition(
    block: BlockSnapshot,
    id: string,
  ): Promise<Position> {
    let owner: string;
    try {
      const value = (await call(block, 'ownerOf', [id]))[0];
      if (typeof value !== 'string') throw unavailable();
      owner = value;
    } catch (error) {
      if (rpcReverted(error)) throw notFound();
      throw error;
    }
    if (/^0x0{40}$/i.test(owner)) throw notFound();
    const [locked, voting] = await Promise.all([
      call(block, 'locked', [id]),
      call(block, 'balanceOfNFT', [id]),
    ]);
    const amount = abiInteger(locked[0]);
    const end = abiInteger(locked[1]);
    const power = abiInteger(voting[0]);
    if (amount < 0n || end > 8_640_000_000_000n || power < 0n)
      throw unavailable();
    return {
      id: `kittenswap-${id}`,
      tokenId: id,
      marketId: 'kittenswap',
      owner: getAddress(owner),
      lockedAmountRaw: amount.toString(),
      lockedUntil: new Date(Number(end) * 1000).toISOString(),
      votingPowerRaw: power.toString(),
      blockNumber: block.number,
      blockHash: block.hash,
      observedAt: new Date(now()).toISOString(),
    };
  }

  function decodeCursor(
    value: unknown,
    address: string,
  ): OwnershipCursor | null {
    if (value == null) return null;
    if (
      typeof value !== 'string' ||
      value.length > 512 ||
      !/^[A-Za-z0-9_-]+$/.test(value)
    )
      throw Object.assign(new Error('Invalid position page cursor.'), {
        code: 'INVALID_CURSOR',
      });
    try {
      const encoded = Buffer.from(value, 'base64url');
      if (encoded.toString('base64url') !== value) throw new Error();
      const cursor: unknown = JSON.parse(encoded.toString());
      if (
        !isRecord(cursor) ||
        cursor.address !== address.toLowerCase() ||
        typeof cursor.offset !== 'number' ||
        !Number.isSafeInteger(cursor.offset) ||
        cursor.offset < 0 ||
        typeof cursor.blockNumber !== 'number' ||
        !Number.isSafeInteger(cursor.blockNumber) ||
        cursor.blockNumber < 1 ||
        typeof cursor.blockHash !== 'string' ||
        !hashPattern.test(cursor.blockHash) ||
        typeof cursor.issuedAt !== 'number' ||
        !Number.isSafeInteger(cursor.issuedAt) ||
        now() - cursor.issuedAt > 45_000 ||
        cursor.issuedAt > now()
      )
        throw new Error();
      return {
        address: cursor.address,
        offset: cursor.offset,
        blockNumber: cursor.blockNumber,
        blockHash: cursor.blockHash,
        issuedAt: cursor.issuedAt,
      };
    } catch {
      throw Object.assign(
        new Error('Position page expired. Refresh your account.'),
        { code: 'INVALID_CURSOR' },
      );
    }
  }

  return {
    async getPosition(value: unknown): Promise<Position> {
      const id = tokenId(value);
      const block = await snapshot();
      const position = await readPosition(block, id);
      await fence(block);
      return position;
    },
    async getPositions(values: unknown): Promise<(Position | null)[]> {
      if (!Array.isArray(values) || values.length > 50) throw unavailable();
      const ids = values.map((value: unknown) => tokenId(value));
      if (!ids.length) return [];
      const block = await snapshot();
      const items: (Position | null)[] = [];
      for (let start = 0; start < ids.length; start += 4) {
        const batch = await Promise.all(
          ids.slice(start, start + 4).map(async (id) => {
            try {
              return await readPosition(block, id);
            } catch (error) {
              if (errorCode(error) === 'POSITION_NOT_FOUND') return null;
              throw error;
            }
          }),
        );
        items.push(...batch);
      }
      await fence(block);
      return items;
    },
    async getOwnedPositions(
      value: unknown,
      options: RawOwnershipOptions = {},
    ): Promise<Page<Position>> {
      let address: string;
      try {
        if (typeof value !== 'string') throw new Error('Invalid address');
        address = getAddress(value);
      } catch {
        throw Object.assign(new Error('Invalid wallet address.'), {
          code: 'INVALID_ADDRESS',
        });
      }
      const limit = options.limit ?? 24;
      if (
        typeof limit !== 'number' ||
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 50
      )
        throw Object.assign(new Error('Invalid page size.'), {
          code: 'INVALID_CURSOR',
        });
      const cursor = decodeCursor(options.cursor, address);
      const block = await snapshot(cursor);
      const total = abiInteger((await call(block, 'balanceOf', [address]))[0]);
      if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw unavailable();
      const offset = cursor?.offset ?? 0;
      if (offset > Number(total)) throw unavailable();
      const stop = Math.min(Number(total), offset + limit);
      const items: Position[] = [];
      for (let start = offset; start < stop; start += 4) {
        const batch = Array.from(
          { length: Math.min(4, stop - start) },
          (_, i) => start + i,
        );
        const positions = await Promise.all(
          batch.map(async (index) => {
            const decoded = await call(block, 'tokenOfOwnerByIndex', [
              address,
              index,
            ]);
            const value = abiInteger(decoded[0]);
            const position = await readPosition(
              block,
              tokenId(value.toString()),
            );
            if (position.owner.toLowerCase() !== address.toLowerCase())
              throw unavailable();
            return position;
          }),
        );
        items.push(...positions);
      }
      await fence(block);
      const nextCursor =
        stop < Number(total)
          ? Buffer.from(
              JSON.stringify({
                address: address.toLowerCase(),
                offset: stop,
                blockNumber: block.number,
                blockHash: block.hash,
                issuedAt: cursor?.issuedAt ?? now(),
              }),
            ).toString('base64url')
          : null;
      return { items, nextCursor };
    },
    async health(): Promise<ChainHealth> {
      try {
        const block = await snapshot();
        const maxTime = abiInteger((await call(block, 'MAXTIME'))[0]);
        if (maxTime < 1n) throw unavailable();
        await fence(block);
        return {
          ready: true,
          available: true,
          chainId: KITTEN_CHAIN.chainId,
          blockNumber: block.number,
          blockHash: block.hash,
          observedAt: new Date(now()).toISOString(),
        };
      } catch {
        return {
          ready: false,
          available: false,
          chainId: KITTEN_CHAIN.chainId,
          errorCode: 'CHAIN_UNAVAILABLE',
        };
      }
    },
  };
}
