import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import {
  Interface,
  getAddress,
  keccak256,
  toUtf8Bytes,
  type InterfaceAbi,
} from 'ethers';
import {
  abi as validateAbi,
  array,
  bigint,
  decodedRecord,
  errorInfo,
  record,
  string,
} from './boundaries.ts';
import {
  decodeGetter,
  loanEvent,
  type CreditField,
  type EventCredit,
  type EventLoan,
  type EventOffer,
  type EventOrder,
  type FinancedEventOrder,
  type FinancedJournal,
  type GetterOutputs,
  type IndexConfig,
  type JournalBlock,
  type JournalState,
  type LoanConfig,
  type RpcLog,
  type RpcSender,
} from './indexer-types.ts';
import type {
  FinancedSource,
  IndexCreditAccount,
  IndexLoan,
  IndexOrder,
  IndexSnapshot,
  IndexSource,
  IndexSync,
  Observation,
} from '../web/index-types.ts';
import { validateIndexSnapshot } from '../web/index-source.ts';

function requireValue<T>(value: T | null | undefined, message: string): T {
  if (value == null) throw new Error(message);
  return value;
}

const VERSION = 1;
const READ_METHODS = new Set([
  'eth_chainId',
  'eth_blockNumber',
  'eth_getBlockByNumber',
  'eth_getCode',
  'eth_getLogs',
  'eth_call',
]);
const EVENT_NAMES = new Set([
  'Listed',
  'ListingCancelled',
  'SellerListingsInvalidated',
  'Purchased',
]);
const LOAN_EVENTS = new Set([
  'OfferFunded',
  'OfferCancelled',
  'LoanOpened',
  'Repaid',
  'DebtForgiven',
  'LoanClosed',
  'CollateralWithdrawn',
  'LenderCreditWithdrawn',
  'BorrowerCreditWithdrawn',
  'FinancedCollateralListed',
  'FinancedListingCancelled',
  'FinancedCollateralSold',
]);
const INTEREST_DENOMINATOR = 10_000n * 31_536_000n;
const NFT = new Interface([
  'function ownerOf(uint256) view returns (address)',
  'function getApproved(uint256) view returns (address)',
  'function isApprovedForAll(address,address) view returns (bool)',
]);
const TOKEN = new Interface(['function decimals() view returns (uint8)']);
const ZERO = '0x0000000000000000000000000000000000000000';
const quantity = (n: string | number | bigint) => `0x${BigInt(n).toString(16)}`;
const address = (value: unknown) => getAddress(string(value)).toLowerCase();
const hash = (value: unknown) => {
  if (typeof value !== 'string' || !/^0x[0-9a-f]{64}$/i.test(value))
    throw new Error('Expected a 32-byte hash.');
  return value.toLowerCase();
};
const integer = (value: unknown, name: string, minimum = 0) => {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < minimum
  )
    throw new Error(`${name} must be a safe integer of at least ${minimum}.`);
  return value;
};
const rpcInteger = (value: unknown) => {
  if (typeof value !== 'string' || !/^0x[0-9a-f]+$/i.test(value))
    throw new Error('Invalid RPC quantity.');
  const n = BigInt(value);
  if (n > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error('RPC quantity exceeds safe block-number precision.');
  return Number(n);
};

export function validateConfig(value: unknown): IndexConfig {
  const raw = record(value);
  const rpcUrl = new URL(string(raw.rpcUrl));
  if (!['http:', 'https:'].includes(rpcUrl.protocol))
    throw new Error('Use an HTTP(S) RPC URL.');
  const config: IndexConfig = {
    chainId: integer(raw.chainId, 'chainId', 1),
    market: address(raw.market),
    collection: address(raw.collection),
    paymentToken: address(raw.paymentToken),
    deploymentBlock: integer(raw.deploymentBlock, 'deploymentBlock'),
    deploymentBlockHash: hash(raw.deploymentBlockHash),
    expectedMarketCodeHash: hash(raw.expectedMarketCodeHash),
    paymentDecimals: integer(raw.paymentDecimals ?? 6, 'paymentDecimals'),
    confirmations: integer(raw.confirmations ?? 2, 'confirmations'),
    maxBlocksPerSync: integer(
      raw.maxBlocksPerSync ?? 250,
      'maxBlocksPerSync',
      1,
    ),
    staleAfterSeconds: integer(
      raw.staleAfterSeconds ?? 90,
      'staleAfterSeconds',
      1,
    ),
    rpcUrl: rpcUrl.href,
  };
  if ([config.market, config.collection, config.paymentToken].includes(ZERO))
    throw new Error('Deployment addresses cannot be zero.');
  if (config.paymentDecimals > 36 || config.maxBlocksPerSync > 5000)
    throw new Error('Unsupported decimal or batch bound.');
  if (raw.loans != null) {
    const l = record(raw.loans);
    if (typeof l.claimsVerified !== 'boolean')
      throw new Error(
        'Expected loan claimsVerified configuration is required.',
      );
    config.loans = {
      address: address(l.address),
      deploymentBlock: integer(l.deploymentBlock, 'loans.deploymentBlock'),
      deploymentBlockHash: hash(l.deploymentBlockHash),
      expectedCodeHash: hash(l.expectedCodeHash),
      voter: address(l.voter),
      treasury: address(l.treasury),
      guardian: address(l.guardian),
      claimsVerified: l.claimsVerified,
    };
    if (
      [
        config.loans.address,
        config.loans.voter,
        config.loans.treasury,
        config.loans.guardian,
      ].includes(ZERO) ||
      config.loans.address === config.market
    )
      throw new Error(
        'Loan deployment addresses must be nonzero and distinct from market.',
      );
  }
  return config;
}

export class ReadOnlyRpc implements RpcSender {
  url: string;
  fetcher: typeof fetch;
  id: number;
  constructor(url: string, fetcher: typeof fetch = fetch) {
    this.url = url;
    this.fetcher = fetcher;
    this.id = 0;
  }
  async send(method: string, params: readonly unknown[]): Promise<unknown> {
    if (!READ_METHODS.has(method))
      throw new Error(`Write or unsupported RPC method rejected: ${method}`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const id = ++this.id;
      const response = await this.fetcher(this.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      });
      if (!response.ok) throw new Error(`RPC HTTP ${response.status}.`);
      const body = record(await response.json());
      if (body.id !== id || body.error || body.result == null)
        throw new Error(
          body.error
            ? errorInfo(body.error).message
            : 'RPC response is missing or has the wrong request ID.',
        );
      return body.result;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function normalizeBlock(value: unknown, number: number): JournalBlock {
  const raw = record(value);
  if (!raw || rpcInteger(raw.number) !== number)
    throw new Error(`Block ${number} is unavailable or mismatched.`);
  return {
    number,
    hash: hash(raw.hash),
    parentHash: hash(raw.parentHash),
    timestamp: rpcInteger(raw.timestamp),
    logs: [],
  };
}

function normalizeLog(
  value: unknown,
  block: JournalBlock,
  sources: string | readonly string[],
): RpcLog {
  const raw = record(value);
  const emitter = address(raw.address);
  if (
    raw.removed ||
    !(Array.isArray(sources) ? sources : [sources]).includes(emitter) ||
    rpcInteger(record(raw).blockNumber) !== block.number ||
    hash(raw.blockHash) !== block.hash
  )
    throw new Error('Log does not belong to the pinned source block.');
  if (
    !/^0x(?:[0-9a-f]{2})*$/i.test(string(raw.data)) ||
    !Array.isArray(raw.topics) ||
    raw.topics.length > 4
  )
    throw new Error('Malformed event payload.');
  return {
    address: emitter,
    data: string(raw.data).toLowerCase(),
    topics: raw.topics.map(hash),
    blockNumber: quantity(block.number),
    blockHash: block.hash,
    transactionHash: hash(raw.transactionHash),
    transactionIndex: quantity(rpcInteger(raw.transactionIndex)),
    logIndex: quantity(rpcInteger(raw.logIndex)),
    removed: false,
  };
}

type MarketEvent = { transactionHash: string; logIndex: number } & (
  | {
      name: 'Listed';
      listingId: string;
      seller: string;
      tokenId: string;
      price: string;
      expiry: string;
      sellerNonce: string;
    }
  | { name: 'SellerListingsInvalidated'; seller: string; newNonce: string }
  | {
      name: 'Purchased';
      listingId: string;
      buyer: string;
      recipient: string;
      price: string;
      protocolFee: string;
    }
  | { name: 'ListingCancelled'; listingId: string }
);
function decodeEvent(iface: Interface, log: RpcLog): MarketEvent | null {
  let parsed;
  try {
    parsed = iface.parseLog({ topics: log.topics, data: log.data });
  } catch {
    throw new Error('Known deployment produced an undecodable market event.');
  }
  if (!parsed || !EVENT_NAMES.has(parsed.name)) return null;
  const a = decodedRecord(parsed.args);
  const base = {
    transactionHash: log.transactionHash,
    logIndex: rpcInteger(log.logIndex),
  };
  if (parsed.name === 'Listed')
    return {
      ...base,
      name: 'Listed',
      listingId: bigint(a.listingId).toString(),
      seller: address(a.seller),
      tokenId: bigint(a.tokenId).toString(),
      price: bigint(a.price).toString(),
      expiry: bigint(a.expiry).toString(),
      sellerNonce: bigint(a.sellerNonce).toString(),
    };
  if (parsed.name === 'SellerListingsInvalidated')
    return {
      ...base,
      name: 'SellerListingsInvalidated',
      seller: address(a.seller),
      newNonce: bigint(a.newNonce).toString(),
    };
  if (parsed.name === 'Purchased')
    return {
      ...base,
      name: 'Purchased',
      listingId: bigint(a.listingId).toString(),
      buyer: address(a.buyer),
      recipient: address(a.recipient),
      price: bigint(a.price).toString(),
      protocolFee: bigint(a.protocolFee).toString(),
    };
  return {
    ...base,
    name: 'ListingCancelled',
    listingId: bigint(a.listingId).toString(),
  };
}

/** Rebuild derived orders from canonical journal, including terminal historical states. */
export function deriveOrders(
  blocks: readonly JournalBlock[],
  iface: Interface,
): EventOrder[] {
  const orders = new Map<string, EventOrder>();
  const current = new Map<string, string>();
  const sellerNonces = new Map<string, bigint>();
  for (const block of blocks)
    for (const log of block.logs) {
      const e = decodeEvent(iface, log);
      if (!e) continue;
      if (e.name === 'Listed') {
        if (
          orders.has(e.listingId) ||
          BigInt(e.listingId) < 1n ||
          BigInt(e.price) === 0n
        )
          throw new Error('Invalid or duplicate listing event.');
        const previous = orders.get(current.get(e.tokenId) ?? '');
        if (previous?.eventState === 'active')
          previous.eventState = 'superseded';
        const nonce = sellerNonces.get(e.seller) ?? 0n;
        if (BigInt(e.sellerNonce) !== nonce)
          throw new Error(
            'Listing nonce disagrees with indexed seller history.',
          );
        orders.set(e.listingId, {
          listingId: e.listingId,
          seller: e.seller,
          tokenId: e.tokenId,
          priceAtomic: e.price,
          expiry: e.expiry,
          sellerNonce: e.sellerNonce,
          eventState: 'active',
          createdBlock: block.number,
          createdTransaction: e.transactionHash,
          updatedBlock: block.number,
          updatedTransaction: e.transactionHash,
        });
        current.set(e.tokenId, e.listingId);
      } else if (e.name === 'SellerListingsInvalidated') {
        if (BigInt(e.newNonce) !== (sellerNonces.get(e.seller) ?? 0n) + 1n)
          throw new Error('Seller nonce history is incomplete.');
        sellerNonces.set(e.seller, BigInt(e.newNonce));
        for (const order of orders.values())
          if (
            order.seller === e.seller &&
            order.eventState === 'active' &&
            BigInt(
              requireValue(order.sellerNonce, 'Missing indexed seller nonce'),
            ) < BigInt(e.newNonce)
          ) {
            order.eventState = 'invalidated';
            order.updatedBlock = block.number;
            order.updatedTransaction = e.transactionHash;
          }
      } else {
        const order = orders.get(e.listingId);
        if (
          !order ||
          (e.name === 'Purchased'
            ? order.eventState !== 'active'
            : ['sold', 'cancelled'].includes(order.eventState))
        )
          throw new Error(
            'Cancellation or purchase lacks a compatible indexed listing.',
          );
        if (e.name === 'Purchased') {
          if (
            e.price !== order.priceAtomic ||
            BigInt(e.protocolFee) !== (BigInt(e.price) * 50n) / 10_000n
          )
            throw new Error(
              'Purchase event price or fee disagrees with the fixed order.',
            );
          order.buyer = e.buyer;
          order.recipient = e.recipient;
          order.protocolFeeAtomic = e.protocolFee;
          order.eventState = 'sold';
        } else order.eventState = 'cancelled';
        order.updatedBlock = block.number;
        order.updatedTransaction = e.transactionHash;
        if (current.get(order.tokenId) === order.listingId)
          current.delete(order.tokenId);
      }
    }
  return [...orders.values()].sort((a, b) =>
    BigInt(a.listingId) < BigInt(b.listingId) ? -1 : 1,
  );
}

/** Replay the complete loan manager journal; no debt or credits use floating point. */
export function deriveFinanced(
  blocks: readonly JournalBlock[],
  iface: Interface,
): FinancedJournal {
  const offers = new Map<string, EventOffer>(),
    loans = new Map<string, EventLoan>(),
    orders = new Map<string, FinancedEventOrder>(),
    accounts = new Map<string, EventCredit>();
  const account = (who: string): EventCredit => {
    const current = accounts.get(who);
    if (current) return current;
    const created: EventCredit = {
      account: who,
      lenderCreditAtomic: '0',
      borrowerCreditAtomic: '0',
    };
    accounts.set(who, created);
    return created;
  };
  const credit = (who: string, field: CreditField, delta: bigint) => {
    const row = account(who),
      value = BigInt(row[field]) + delta;
    if (value < 0n)
      throw new Error('Loan credit withdrawal exceeds indexed liability.');
    row[field] = value.toString();
  };
  const accrue = (loan: EventLoan, timestamp: number) => {
    const until =
      BigInt(timestamp) < BigInt(loan.maturity)
        ? BigInt(timestamp)
        : BigInt(loan.maturity);
    let numerator = BigInt(loan.interestRemainder);
    if (until > BigInt(loan.lastAccrued)) {
      numerator +=
        BigInt(loan.principalAtomic) *
        BigInt(loan.aprBps) *
        (until - BigInt(loan.lastAccrued));
      loan.lastAccrued = until.toString();
    }
    loan.accruedInterestAtomic = (
      BigInt(loan.accruedInterestAtomic) +
      numerator / INTEREST_DENOMINATOR
    ).toString();
    loan.interestRemainder = (numerator % INTEREST_DENOMINATOR).toString();
  };
  const requireLoan = (id: string) => {
    const loan = loans.get(id);
    if (!loan) throw new Error('Loan event lacks an indexed loan.');
    return loan;
  };
  for (const block of blocks)
    for (const log of block.logs) {
      let parsed;
      try {
        parsed = iface.parseLog(log);
      } catch {
        throw new Error('Known deployment produced an undecodable loan event.');
      }
      if (!parsed) continue;
      const decoded = loanEvent(parsed);
      if (!decoded) continue;
      const { name, args: a } = decoded,
        id = 'loanId' in a ? a.loanId.toString() : '',
        listingId = 'listingId' in a ? a.listingId.toString() : '';
      const touch = (row: EventLoan | EventOrder) => {
        row.updatedBlock = block.number;
        row.updatedTransaction = log.transactionHash;
      };
      if (name === 'OfferFunded') {
        const key = a.offerId.toString();
        if (
          offers.has(key) ||
          BigInt(key) !== BigInt(offers.size) + 1n ||
          a.principal === 0n ||
          a.duration === 0n
        )
          throw new Error('Invalid or incomplete funded offer history.');
        offers.set(key, {
          lender: address(a.lender),
          borrower: address(a.borrower),
          tokenId: bigint(a.tokenId).toString(),
          principalAtomic: a.principal.toString(),
          aprBps: a.aprBps.toString(),
          duration: a.duration.toString(),
          active: true,
        });
        account(address(a.lender));
        account(address(a.borrower));
      } else if (name === 'OfferCancelled') {
        const offer = offers.get(a.offerId.toString());
        if (!offer?.active)
          throw new Error('Offer cancellation lacks an active indexed offer.');
        offer.active = false;
        credit(
          offer.lender,
          'lenderCreditAtomic',
          BigInt(offer.principalAtomic),
        );
      } else if (name === 'LoanOpened') {
        const offer = offers.get(a.offerId.toString());
        if (
          !offer?.active ||
          loans.has(id) ||
          BigInt(id) !== BigInt(loans.size) + 1n ||
          a.protocolFee !== (BigInt(offer.principalAtomic) * 50n) / 10_000n ||
          a.borrowerProceeds + a.protocolFee !==
            BigInt(offer.principalAtomic) ||
          a.maturity !== BigInt(block.timestamp) + BigInt(offer.duration)
        )
          throw new Error('Loan opening disagrees with indexed funded terms.');
        offer.active = false;
        loans.set(id, {
          loanId: id,
          offerId: a.offerId.toString(),
          lender: offer.lender,
          borrower: offer.borrower,
          tokenId: offer.tokenId,
          vault: address(a.vault),
          principalAtomic: offer.principalAtomic,
          aprBps: offer.aprBps,
          maturity: a.maturity.toString(),
          lastAccrued: String(block.timestamp),
          accruedInterestAtomic: '0',
          interestRemainder: '0',
          loanState: 'active',
          collateralState: 'custody',
          activeListingId: '0',
          createdBlock: block.number,
          createdTransaction: log.transactionHash,
          updatedBlock: block.number,
          updatedTransaction: log.transactionHash,
        });
      } else if (
        name === 'LenderCreditWithdrawn' ||
        name === 'BorrowerCreditWithdrawn'
      ) {
        credit(
          address(name === 'LenderCreditWithdrawn' ? a.lender : a.borrower),
          name === 'LenderCreditWithdrawn'
            ? 'lenderCreditAtomic'
            : 'borrowerCreditAtomic',
          -a.amount,
        );
      } else if (name === 'FinancedCollateralListed') {
        const loan = requireLoan(id);
        if (
          loan.loanState !== 'active' ||
          loan.activeListingId !== '0' ||
          orders.has(listingId) ||
          BigInt(listingId) !== BigInt(orders.size) + 1n ||
          address(a.borrower) !== loan.borrower ||
          a.tokenId.toString() !== loan.tokenId ||
          a.price === 0n
        )
          throw new Error(
            'Financed listing disagrees with indexed loan history.',
          );
        // Replacement is recognizable only from a cancellation in the same transaction.
        for (const old of orders.values())
          if (
            old.loanId === id &&
            old.eventState === 'cancelled' &&
            old.updatedTransaction === log.transactionHash
          )
            old.cancellationReason = 'repriced';
        orders.set(listingId, {
          sourceKind: 'financed',
          orderKey: `financed:${listingId}`,
          listingId,
          loanId: id,
          seller: loan.borrower,
          tokenId: loan.tokenId,
          priceAtomic: bigint(a.price).toString(),
          expiry: bigint(a.expiry).toString(),
          eventState: 'active',
          createdBlock: block.number,
          createdTransaction: log.transactionHash,
          updatedBlock: block.number,
          updatedTransaction: log.transactionHash,
        });
        loan.activeListingId = listingId;
      } else if (name === 'FinancedListingCancelled') {
        const order = orders.get(listingId);
        if (!order || order.eventState !== 'active')
          throw new Error('Financed cancellation lacks an active listing.');
        order.eventState = 'cancelled';
        order.cancellationReason = 'borrower_cancelled';
        touch(order);
        requireLoan(order.loanId).activeListingId = '0';
      } else if (name === 'FinancedCollateralSold') {
        const order = orders.get(listingId),
          loan = requireLoan(id);
        if (
          !order ||
          order.eventState !== 'active' ||
          order.loanId !== id ||
          loan.loanState !== 'repaid' ||
          loan.collateralState !== 'withdrawn' ||
          bigint(a.price).toString() !== order.priceAtomic ||
          a.protocolFee !== (a.price * 50n) / 10_000n ||
          a.price !== a.debtPaid + a.protocolFee + a.borrowerProceeds ||
          loan.lastPaymentAtomic !== a.debtPaid.toString() ||
          loan.recipient !== address(a.recipient)
        )
          throw new Error(
            'Financed sale settlement disagrees with loan/debt history.',
          );
        loan.activeListingId = '0';
        loan.loanState = 'sold';
        Object.assign(order, {
          eventState: 'sold',
          buyer: address(a.buyer),
          recipient: address(a.recipient),
          debtPaidAtomic: a.debtPaid.toString(),
          protocolFeeAtomic: bigint(a.protocolFee).toString(),
          borrowerProceedsAtomic: a.borrowerProceeds.toString(),
        });
        touch(order);
        credit(loan.borrower, 'borrowerCreditAtomic', a.borrowerProceeds);
        touch(loan);
      } else {
        const loan = requireLoan(id);
        if (name === 'Repaid') {
          if (loan.loanState !== 'active')
            throw new Error('Repayment follows inactive loan.');
          accrue(loan, block.timestamp);
          const interest = BigInt(loan.accruedInterestAtomic),
            principal = BigInt(loan.principalAtomic);
          if (
            a.amount === 0n ||
            a.interestPaid !== (a.amount < interest ? a.amount : interest) ||
            a.amount !== a.interestPaid + a.principalPaid ||
            a.principalPaid > principal
          )
            throw new Error(
              'Repayment amounts disagree with exact accrued debt.',
            );
          loan.accruedInterestAtomic = (interest - a.interestPaid).toString();
          loan.principalAtomic = (principal - a.principalPaid).toString();
          loan.lastPaymentAtomic = a.amount.toString();
          credit(loan.lender, 'lenderCreditAtomic', a.amount);
        } else if (name === 'DebtForgiven') {
          if (loan.loanState !== 'active')
            throw new Error('Forgiveness follows inactive loan.');
          accrue(loan, block.timestamp);
          if (
            a.principal.toString() !== loan.principalAtomic ||
            a.interest.toString() !== loan.accruedInterestAtomic
          )
            throw new Error('Forgiven debt disagrees with exact accrued debt.');
          loan.principalAtomic = '0';
          loan.accruedInterestAtomic = '0';
          loan.interestRemainder = '0';
          loan.forgiven = true;
        } else if (name === 'LoanClosed') {
          if (
            loan.loanState !== 'active' ||
            loan.principalAtomic !== '0' ||
            loan.accruedInterestAtomic !== '0'
          )
            throw new Error('Loan closure lacks cleared indexed debt.');
          loan.loanState = loan.forgiven ? 'forgiven' : 'repaid';
          loan.interestRemainder = '0';
          for (const order of orders.values())
            if (
              order.loanId === id &&
              order.eventState === 'cancelled' &&
              order.updatedTransaction === log.transactionHash
            )
              order.cancellationReason = 'loan_closed';
        } else if (name === 'CollateralWithdrawn') {
          if (loan.loanState === 'active' || loan.collateralState !== 'custody')
            throw new Error('Collateral withdrawal lacks closed indexed loan.');
          loan.collateralState = 'withdrawn';
          loan.recipient = address(a.recipient);
        }
        touch(loan);
      }
    }
  return {
    orders: [...orders.values()],
    loans: [...loans.values()],
    offers: [...offers.values()],
    creditAccounts: [...accounts.values()].sort((a, b) =>
      a.account.localeCompare(b.account),
    ),
  };
}

async function atomicJSON(filename: string, value: unknown) {
  await fs.mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${randomUUID()}.tmp`;
  try {
    const file = await fs.open(temporary, 'wx', 0o600);
    try {
      await file.writeFile(`${JSON.stringify(value, null, 2)}\n`);
      await file.sync();
    } finally {
      await file.close();
    }
    await fs.rename(temporary, filename);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

export class MarketIndexer {
  config: IndexConfig;
  iface: Interface;
  loansIface: Interface = new Interface([]);
  abiHash: string;
  loansAbiHash = '';
  startBlock: number;
  emitters: string[];
  identity: string;
  rpc: RpcSender;
  statePath: string;
  viewPath: string;
  clock: () => number;
  busy: boolean;
  requireLoans(): LoanConfig {
    const loans = this.config.loans;
    if (!loans) throw new Error('Loan source is not configured.');
    return loans;
  }
  constructor({
    config,
    abi,
    loansAbi,
    rpc,
    statePath,
    viewPath,
    clock = () => Date.now(),
  }: {
    config: unknown;
    abi: InterfaceAbi;
    loansAbi?: InterfaceAbi;
    rpc?: RpcSender;
    statePath: string;
    viewPath: string;
    clock?: () => number;
  }) {
    this.config = validateConfig(config);
    this.iface = new Interface(abi);
    for (const name of EVENT_NAMES)
      if (!this.iface.getEvent(name))
        throw new Error(`Required market event ABI missing: ${name}`);
    for (const name of [
      'collection',
      'paymentToken',
      'listings',
      'currentListing',
      'sellerNonces',
      'listingCount',
      'FEE_BPS',
    ])
      if (!this.iface.getFunction(name))
        throw new Error(`Required market getter ABI missing: ${name}`);
    this.abiHash = keccak256(
      toUtf8Bytes(
        this.iface.fragments
          .map((f) => f.format('full'))
          .sort()
          .join('\n'),
      ),
    );
    if (this.config.loans) {
      if (!loansAbi)
        throw new Error(
          'Configured loans deployment requires its compiled ABI.',
        );
      this.loansIface = new Interface(loansAbi);
      for (const name of LOAN_EVENTS)
        if (!this.loansIface.getEvent(name))
          throw new Error(`Required loan event ABI missing: ${name}`);
      for (const name of [
        'collection',
        'settlementToken',
        'voter',
        'treasury',
        'guardian',
        'claimsVerified',
        'FEE_BPS',
        'offerCount',
        'loanCount',
        'financedListingCount',
        'loans',
        'debt',
        'financedListings',
        'activeFinancedListing',
        'activeLoanForToken',
        'lenderCredits',
        'borrowerCredits',
        'totalLenderCredits',
        'totalBorrowerCredits',
        'escrowedOfferCapital',
      ])
        if (!this.loansIface.getFunction(name))
          throw new Error(`Required loan getter ABI missing: ${name}`);
      this.loansAbiHash = keccak256(
        toUtf8Bytes(
          this.loansIface.fragments
            .map((f) => f.format('full'))
            .sort()
            .join('\n'),
        ),
      );
    }
    this.startBlock = Math.min(
      this.config.deploymentBlock,
      this.config.loans?.deploymentBlock ?? this.config.deploymentBlock,
    );
    this.emitters = [
      this.config.market,
      ...(this.config.loans ? [this.requireLoans().address] : []),
    ];
    const { rpcUrl, maxBlocksPerSync, staleAfterSeconds, ...identity } =
      this.config;
    this.identity = keccak256(
      toUtf8Bytes(
        JSON.stringify({
          ...identity,
          abiHash: this.abiHash,
          ...(this.loansAbiHash ? { loansAbiHash: this.loansAbiHash } : {}),
        }),
      ),
    );
    this.rpc = rpc || new ReadOnlyRpc(rpcUrl);
    this.statePath = path.resolve(statePath);
    this.viewPath = path.resolve(viewPath);
    if (
      this.statePath === this.viewPath ||
      !this.statePath.endsWith('.json') ||
      !this.viewPath.endsWith('.json')
    )
      throw new Error('State and public view need separate .json paths.');
    this.clock = clock;
    this.busy = false;
  }

  async block(number: number) {
    return normalizeBlock(
      await this.rpc.send('eth_getBlockByNumber', [quantity(number), false]),
      number,
    );
  }

  async call<Name extends keyof GetterOutputs>(
    to: string,
    iface: Interface,
    name: Name,
    args: readonly unknown[],
    block: number,
  ): Promise<GetterOutputs[Name]> {
    const data = iface.encodeFunctionData(name, args);
    return decodeGetter(
      name,
      iface.decodeFunctionResult(
        name,
        string(
          await this.rpc.send('eth_call', [{ to, data }, quantity(block)]),
        ),
      ),
    );
  }

  async loadState(): Promise<JournalState> {
    let raw: Record<string, unknown>;
    try {
      raw = record(JSON.parse(await fs.readFile(this.statePath, 'utf8')));
    } catch (error) {
      if (errorInfo(error).code !== 'ENOENT') throw error;
      return {
        schemaVersion: VERSION,
        identity: this.identity,
        blocks: [],
        reorgs: [],
        sync: null,
      };
    }
    if (
      raw.schemaVersion !== VERSION ||
      raw.identity !== this.identity ||
      !Array.isArray(raw.blocks) ||
      !Array.isArray(raw.reorgs)
    )
      throw new Error(
        'Persisted state belongs to another deployment, ABI or schema.',
      );
    const storedBlocks = array(raw.blocks);
    const state: JournalState = {
      schemaVersion: VERSION,
      identity: this.identity,
      blocks: storedBlocks.map((value) => {
        const stored = record(value);
        return {
          number: integer(stored.number, 'Stored block number'),
          timestamp: integer(stored.timestamp, 'Stored timestamp'),
          hash: hash(stored.hash),
          parentHash: hash(stored.parentHash),
          logs: [],
        };
      }),
      reorgs: array(raw.reorgs),
      sync:
        raw.sync == null
          ? null
          : validateIndexSnapshot({
              schemaVersion: VERSION,
              source: this.source(),
              sync: raw.sync,
              listings: [],
              transactionSimulation: 'not_performed',
            }).sync,
    };
    let previous: JournalBlock | undefined;
    state.blocks.forEach((stored, index) => {
      integer(stored.number, 'Stored block number');
      integer(stored.timestamp, 'Stored timestamp');
      hash(stored.hash);
      hash(stored.parentHash);
      if (
        stored.number !== this.startBlock + index ||
        (previous && stored.parentHash !== previous.hash) ||
        !Array.isArray(stored.logs)
      )
        throw new Error('Persisted block journal is not contiguous.');
      if (
        (stored.number === this.config.deploymentBlock &&
          stored.hash !== this.config.deploymentBlockHash) ||
        (stored.number === this.config.loans?.deploymentBlock &&
          stored.hash !== this.requireLoans().deploymentBlockHash)
      )
        throw new Error('Persisted deployment anchor mismatch.');
      const seen = new Set();
      stored.logs = array(record(storedBlocks[index]).logs).map((log) => {
        const normalized = normalizeLog(log, stored, this.emitters);
        if (
          (normalized.address === this.config.market &&
            stored.number < this.config.deploymentBlock) ||
          (normalized.address === this.config.loans?.address &&
            stored.number < this.requireLoans().deploymentBlock)
        )
          throw new Error('Persisted source log predates its deployment.');
        const key = normalized.logIndex;
        if (seen.has(key)) throw new Error('Duplicate persisted log.');
        seen.add(key);
        return normalized;
      });
      previous = stored;
    });
    deriveOrders(
      this.sourceBlocks(state.blocks, this.config.market),
      this.iface,
    ); // Fail closed on broken event ordering or exact amounts.
    if (this.config.loans)
      deriveFinanced(
        this.sourceBlocks(state.blocks, this.requireLoans().address),
        this.loansIface,
      );
    return state;
  }

  source(): IndexSource & { rpcOrigin: string } {
    const c = this.config;
    return {
      kind: 'riftwell-market-events',
      chainId: c.chainId,
      market: c.market,
      collection: c.collection,
      paymentToken: c.paymentToken,
      paymentDecimals: c.paymentDecimals,
      deploymentBlock: c.deploymentBlock,
      deploymentBlockHash: c.deploymentBlockHash,
      expectedMarketCodeHash: c.expectedMarketCodeHash,
      abiHash: this.abiHash,
      rpcOrigin: new URL(c.rpcUrl).origin,
      confirmations: c.confirmations,
    };
  }

  sourceBlocks(blocks: readonly JournalBlock[], emitter: string) {
    return blocks.map((block) => ({
      ...block,
      logs: block.logs.filter((log) => log.address === emitter),
    }));
  }

  financedSource(): (FinancedSource & { rpcOrigin: string }) | null {
    const c = this.config,
      l = c.loans;
    return l
      ? {
          kind: 'riftwell-loans-events',
          chainId: c.chainId,
          loans: l.address,
          collection: c.collection,
          paymentToken: c.paymentToken,
          paymentDecimals: c.paymentDecimals,
          deploymentBlock: l.deploymentBlock,
          deploymentBlockHash: l.deploymentBlockHash,
          expectedCodeHash: l.expectedCodeHash,
          voter: l.voter,
          treasury: l.treasury,
          guardian: l.guardian,
          claimsVerified: l.claimsVerified,
          abiHash: this.loansAbiHash,
          rpcOrigin: new URL(c.rpcUrl).origin,
          confirmations: c.confirmations,
          creditCoverage: 'complete_manager_events',
        }
      : null;
  }

  async syncOnce(): Promise<IndexSnapshot> {
    if (this.busy) throw new Error('This indexer is already syncing.');
    this.busy = true;
    let lock;
    let state: JournalState | undefined;
    const lockPath = `${this.statePath}.lock`;
    try {
      await fs.mkdir(path.dirname(lockPath), { recursive: true });
      lock = await fs.open(lockPath, 'wx', 0o600);
      await lock.writeFile(
        JSON.stringify({
          pid: process.pid,
          startedAt: new Date(this.clock()).toISOString(),
        }),
      );
      state = await this.loadState();
      const c = this.config;
      if (rpcInteger(await this.rpc.send('eth_chainId', [])) !== c.chainId)
        throw new Error('RPC chain ID does not match the known deployment.');
      const headNumber = rpcInteger(await this.rpc.send('eth_blockNumber', []));
      if (
        headNumber < Math.max(c.deploymentBlock, c.loans?.deploymentBlock ?? 0)
      )
        throw new Error('Known deployment is not present at this RPC head.');
      const [head, deployment] = await Promise.all([
        this.block(headNumber),
        this.block(c.deploymentBlock),
      ]);
      if (
        state.sync?.observedHead &&
        headNumber < state.sync.observedHead.number
      )
        throw new Error(
          'RPC head regressed behind the previous observation. Existing canonical state is preserved pending a fresh observation.',
        );
      if (deployment.hash !== c.deploymentBlockHash)
        throw new Error(
          'Deployment block hash changed. Operator review is required.',
        );
      if (
        c.loans &&
        (await this.block(this.requireLoans().deploymentBlock)).hash !==
          this.requireLoans().deploymentBlockHash
      )
        throw new Error(
          'Loan deployment block hash changed. Operator review is required.',
        );
      const confirmedTarget = Math.max(
        this.startBlock - 1,
        headNumber - c.confirmations,
      );

      // Walk backward to the common ancestor. Derived orders are rebuilt, never patched in place.
      const canonical = [...state.blocks];
      let rolledBack = 0;
      while (canonical.length) {
        const tip = canonical.at(-1)!;
        if (
          tip.number <= confirmedTarget &&
          (await this.block(tip.number)).hash === tip.hash
        )
          break;
        canonical.pop();
        rolledBack++;
      }
      const from = canonical.length
        ? canonical.at(-1)!.number + 1
        : this.startBlock;
      const to = Math.min(confirmedTarget, from + c.maxBlocksPerSync - 1);
      const newBlocks: JournalBlock[] = [];
      // Fetch bounded batches of headers in parallel while retaining deterministic block order.
      for (let n = from; n <= to; n += 8) {
        const batch = await Promise.all(
          Array.from({ length: Math.min(8, to - n + 1) }, (_, i) =>
            this.block(n + i),
          ),
        );
        newBlocks.push(...batch);
      }
      let previous = canonical.at(-1);
      for (const block of newBlocks) {
        if (
          (!previous &&
            block.hash !==
              (this.startBlock === c.deploymentBlock
                ? deployment.hash
                : this.requireLoans().deploymentBlockHash)) ||
          (previous && block.parentHash !== previous.hash)
        )
          throw new Error(
            'Chain changed while reading block headers. Retry the same state.',
          );
        previous = block;
      }
      if (newBlocks.length) {
        const logs = await this.rpc.send('eth_getLogs', [
          {
            address: this.emitters.length === 1 ? c.market : this.emitters,
            fromBlock: quantity(from),
            toBlock: quantity(to),
          },
        ]);
        if (!Array.isArray(logs))
          throw new Error('Malformed event log response.');
        const byNumber = new Map(
          newBlocks.map((block) => [block.number, block]),
        );
        for (const raw of logs) {
          const block = byNumber.get(rpcInteger(record(raw).blockNumber));
          if (!block)
            throw new Error('RPC returned a log outside the requested range.');
          const normalized = normalizeLog(raw, block, this.emitters);
          if (
            (normalized.address === c.market &&
              block.number < c.deploymentBlock) ||
            (normalized.address === c.loans?.address &&
              block.number < this.requireLoans().deploymentBlock)
          )
            throw new Error('Source log predates its configured deployment.');
          block.logs.push(normalized);
        }
        for (const block of newBlocks) {
          block.logs.sort(
            (a, b) => rpcInteger(a.logIndex) - rpcInteger(b.logIndex),
          );
          if (
            new Set(block.logs.map((log) => log.logIndex)).size !==
            block.logs.length
          )
            throw new Error('RPC returned duplicate logs.');
        }
      }
      const blocks = [...canonical, ...newBlocks];
      const orders = deriveOrders(
        this.sourceBlocks(blocks, c.market),
        this.iface,
      );
      const tip = blocks.at(-1);
      const atBlock = tip?.number ?? head.number;
      // Both configured runtimes must exist at the observation point; catch up across deployment first.
      const marketAtBlock = Math.max(atBlock, c.deploymentBlock);
      const code = await this.rpc.send('eth_getCode', [
        c.market,
        quantity(marketAtBlock),
      ]);
      if (keccak256(string(code)) !== c.expectedMarketCodeHash)
        throw new Error('Market bytecode does not match the known deployment.');
      const [collection, token, decimals, feeBps, listingCount] =
        await Promise.all([
          this.call(c.market, this.iface, 'collection', [], marketAtBlock),
          this.call(c.market, this.iface, 'paymentToken', [], marketAtBlock),
          this.call(c.paymentToken, TOKEN, 'decimals', [], marketAtBlock),
          this.call(c.market, this.iface, 'FEE_BPS', [], marketAtBlock),
          this.call(c.market, this.iface, 'listingCount', [], marketAtBlock),
        ]);
      if (
        address(collection[0]) !== c.collection ||
        address(token[0]) !== c.paymentToken
      )
        throw new Error(
          'Market immutable collection or payment token mismatch.',
        );
      if (Number(decimals[0]) !== c.paymentDecimals || feeBps[0] !== 50n)
        throw new Error('Payment decimals or market fee basis mismatch.');
      if (
        tip &&
        tip.number >= c.deploymentBlock &&
        listingCount[0] !== BigInt(orders.length)
      )
        throw new Error(
          'Indexed event history does not account for the pinned listing count.',
        );

      const listings: IndexOrder[] = [];
      for (const order of orders)
        listings.push(
          await this.observeOrder(
            {
              sourceKind: 'market',
              orderKey: `market:${order.listingId}`,
              ...order,
            },
            tip,
          ),
        );
      let financed: FinancedJournal | null = null;
      if (c.loans && tip && tip.number >= this.requireLoans().deploymentBlock) {
        financed = deriveFinanced(
          this.sourceBlocks(blocks, this.requireLoans().address),
          this.loansIface,
        );
        await this.verifyLoanSource(financed, tip);
        for (const loan of financed.loans)
          Object.assign(
            loan,
            await this.observeLoan(
              loan,
              tip,
              financed.loans.find(
                (other) =>
                  other.tokenId === loan.tokenId &&
                  other.loanState === 'active',
              )?.loanId ?? '0',
            ),
          );
        for (const order of financed.orders)
          listings.push(
            await this.observeFinancedOrder(
              order,
              requireValue(
                financed.loans.find((loan) => loan.loanId === order.loanId),
                'Missing indexed loan',
              ),
              tip,
            ),
          );
        for (const row of financed.creditAccounts)
          Object.assign(row, await this.observeCredits(row, tip));
      }
      // Pin the observation point again. A concurrent reorg must not be published as a success.
      if ((await this.block(atBlock)).hash !== (tip?.hash ?? head.hash))
        throw new Error(
          'Chain changed while reading market state. Retry the same state.',
        );
      if ((await this.block(head.number)).hash !== head.hash)
        throw new Error(
          'Observed head changed during synchronization. Retry the same state.',
        );

      const completedAt = new Date(this.clock()).toISOString();
      const lagBlocks = Math.max(
        0,
        confirmedTarget - (tip?.number ?? this.startBlock - 1),
      );
      const observationFailures =
        listings.filter(
          (order) =>
            order.eventState === 'active' &&
            order.observation.status === 'unavailable',
        ).length +
        (financed?.loans.filter(
          (loan) => loan.observation?.status === 'unavailable',
        ).length ?? 0) +
        (financed?.creditAccounts.filter(
          (row) => row.observation?.status === 'unavailable',
        ).length ?? 0);
      const awaitingSources =
        !!tip &&
        tip.number < Math.max(c.deploymentBlock, c.loans?.deploymentBlock ?? 0);
      const clockSkew = !!tip && tip.timestamp > this.clock() / 1000 + 30;
      const sync: IndexSync & { confirmedTarget: number } = {
        status: tip
          ? lagBlocks
            ? 'catching_up'
            : awaitingSources
              ? 'awaiting_confirmations'
              : observationFailures
                ? 'partial_observations'
                : 'synced'
          : 'awaiting_confirmations',
        completedAt,
        lastSuccessfulSyncAt: completedAt,
        observedHead: {
          number: head.number,
          hash: head.hash,
          timestamp: head.timestamp,
        },
        indexedThrough: tip
          ? { number: tip.number, hash: tip.hash, timestamp: tip.timestamp }
          : null,
        confirmedTarget,
        lagBlocks,
        staleAfterSeconds: c.staleAfterSeconds,
        stale:
          !tip ||
          awaitingSources ||
          clockSkew ||
          lagBlocks > 0 ||
          observationFailures > 0 ||
          this.clock() / 1000 - tip.timestamp > c.staleAfterSeconds,
        clockSkew,
        observationFailures,
        rolledBackBlocks: rolledBack,
      };
      const reorgs = [...state.reorgs];
      if (rolledBack)
        reorgs.push({
          detectedAt: completedAt,
          oldTip: state.blocks.at(-1)!.number,
          commonAncestor: canonical.at(-1)?.number ?? null,
          rolledBackBlocks: rolledBack,
        });
      state = {
        schemaVersion: VERSION,
        identity: this.identity,
        blocks,
        reorgs: reorgs.slice(-100),
        sync,
      };
      const snapshotId = keccak256(
        toUtf8Bytes(
          JSON.stringify({
            identity: this.identity,
            tip: tip?.hash,
            completedAt,
          }),
        ),
      );
      const view: IndexSnapshot & { orderCounts: Record<string, number> } = {
        schemaVersion: VERSION,
        snapshotId,
        source: this.source(),
        financedSource: this.financedSource(),
        sync,
        listings,
        ...(c.loans
          ? {
              loans:
                financed?.loans.map((loan) => ({
                  ...loan,
                  observation: requireValue(
                    loan.observation,
                    'Missing loan observation',
                  ),
                })) ?? [],
              creditAccounts:
                financed?.creditAccounts.map((row) => ({
                  ...row,
                  observation: requireValue(
                    row.observation,
                    'Missing credit observation',
                  ),
                })) ?? [],
            }
          : {}),
        transactionSimulation: 'not_performed',
        orderCounts: Object.fromEntries(
          [
            'active',
            'cancelled',
            'sold',
            'invalidated',
            'superseded',
            'expired',
          ].map((status) => [
            status,
            listings.filter((l) => l.orderState === status).length,
          ]),
        ),
      };
      await atomicJSON(this.statePath, state);
      await atomicJSON(this.viewPath, view);
      return view;
    } catch (error) {
      // Keep the last successful journal untouched; publish failure only as a health status.
      // A lock collision must not write through another process's public snapshot.
      if (lock && state) {
        let previous;
        try {
          previous = validateIndexSnapshot(
            JSON.parse(await fs.readFile(this.viewPath, 'utf8')),
          );
        } catch {
          previous = {
            schemaVersion: VERSION,
            source: this.source(),
            financedSource: this.financedSource(),
            listings: [],
            ...(this.config.loans ? { loans: [], creditAccounts: [] } : {}),
            transactionSimulation: 'not_performed',
            sync: { status: 'error' },
          };
        }
        const reason = errorInfo(error)
          .message.replaceAll(this.config.rpcUrl, '[RPC URL]')
          .slice(0, 250);
        await atomicJSON(this.viewPath, {
          ...previous,
          sync: {
            ...(previous.sync || {}),
            status: 'error',
            stale: true,
            lastAttemptAt: new Date(this.clock()).toISOString(),
            reason,
          },
        });
      }
      throw error;
    } finally {
      if (lock) {
        await lock.close();
        await fs.rm(lockPath, { force: true });
      }
      this.busy = false;
    }
  }

  async observeOrder(
    order: EventOrder,
    tip: JournalBlock | undefined,
  ): Promise<IndexOrder> {
    const result: IndexOrder = {
      ...order,
      orderState: order.eventState,
      observation: {
        status: 'not_checked',
        atBlock: tip?.number ?? null,
        blockHash: tip?.hash ?? null,
        transactionSimulation: 'not_performed',
      },
    };
    if (order.eventState !== 'active' || !tip) return result;
    if (BigInt(order.expiry) <= BigInt(tip.timestamp))
      result.orderState = 'expired';
    try {
      const c = this.config;
      const [stored, current, nonce] = await Promise.all([
        this.call(
          c.market,
          this.iface,
          'listings',
          [order.listingId],
          tip.number,
        ),
        this.call(
          c.market,
          this.iface,
          'currentListing',
          [order.tokenId],
          tip.number,
        ),
        this.call(
          c.market,
          this.iface,
          'sellerNonces',
          [order.seller],
          tip.number,
        ),
      ]);
      if (
        address(stored[0]) !== order.seller ||
        stored[1].toString() !== order.tokenId ||
        stored[2].toString() !== order.priceAtomic ||
        stored[3].toString() !== order.expiry ||
        stored[4].toString() !== order.sellerNonce
      )
        throw Object.assign(
          new Error('Indexed order differs from pinned contract state.'),
          { integrityFailure: true },
        );
      result.observation.marketOrderMatches =
        stored[5] &&
        current[0].toString() === order.listingId &&
        nonce[0].toString() === order.sellerNonce;
      if (!result.observation.marketOrderMatches)
        throw Object.assign(
          new Error(
            'Indexed order activity differs from pinned contract state.',
          ),
          { integrityFailure: true },
        );
      const [owner, approval, operatorApproval] = await Promise.all([
        this.call(c.collection, NFT, 'ownerOf', [order.tokenId], tip.number),
        this.call(
          c.collection,
          NFT,
          'getApproved',
          [order.tokenId],
          tip.number,
        ),
        this.call(
          c.collection,
          NFT,
          'isApprovedForAll',
          [order.seller, c.market],
          tip.number,
        ),
      ]);
      result.observation.owner = address(owner[0]);
      result.observation.tokenApproval = address(approval[0]);
      result.observation.operatorApproval = operatorApproval[0];
      result.observation.ownerMatchesSeller =
        result.observation.owner === order.seller;
      result.observation.approvedForMarket =
        result.observation.tokenApproval === c.market ||
        result.observation.operatorApproval;
      result.observation.status = !result.observation.ownerMatchesSeller
        ? 'owner_mismatch'
        : !result.observation.approvedForMarket
          ? 'approval_missing'
          : 'ownership_and_approval_observed';
    } catch (error) {
      if (errorInfo(error).integrityFailure) throw error;
      result.observation.status = 'unavailable';
      result.observation.reason =
        'At least one pinned contract observation failed. No transferable status is inferred.';
    }
    return result;
  }

  async verifyLoanSource(financed: FinancedJournal, tip: JournalBlock) {
    const c = this.config,
      l = this.requireLoans(),
      iface = this.loansIface;
    const code = await this.rpc.send('eth_getCode', [
      l.address,
      quantity(tip.number),
    ]);
    if (keccak256(string(code)) !== l.expectedCodeHash)
      throw new Error(
        'Loan manager bytecode does not match the known deployment.',
      );
    const names: (keyof GetterOutputs)[] = [
      'collection',
      'settlementToken',
      'voter',
      'treasury',
      'guardian',
      'claimsVerified',
      'FEE_BPS',
      'offerCount',
      'loanCount',
      'financedListingCount',
      'totalLenderCredits',
      'totalBorrowerCredits',
      'escrowedOfferCapital',
    ];
    const values: Record<string, string | bigint | boolean> =
      Object.fromEntries(
        await Promise.all(
          names.map(async (name) => [
            name,
            (await this.call(l.address, iface, name, [], tip.number))[0],
          ]),
        ),
      );
    if (
      address(values.collection) !== c.collection ||
      address(values.settlementToken) !== c.paymentToken ||
      address(values.voter) !== l.voter ||
      address(values.treasury) !== l.treasury ||
      address(values.guardian) !== l.guardian ||
      values.claimsVerified !== l.claimsVerified ||
      values.FEE_BPS !== 50n
    )
      throw new Error('Loan manager immutable configuration or fee mismatch.');
    if (
      values.offerCount !== BigInt(financed.offers.length) ||
      values.loanCount !== BigInt(financed.loans.length) ||
      values.financedListingCount !== BigInt(financed.orders.length)
    )
      throw new Error(
        'Indexed history does not account for pinned offer, loan or financed listing counts.',
      );
    const sum = (field: CreditField) =>
      financed.creditAccounts.reduce(
        (total, row) => total + BigInt(row[field]),
        0n,
      );
    if (
      values.totalLenderCredits !== sum('lenderCreditAtomic') ||
      values.totalBorrowerCredits !== sum('borrowerCreditAtomic') ||
      values.escrowedOfferCapital !==
        financed.offers
          .filter((offer) => offer.active)
          .reduce((total, offer) => total + BigInt(offer.principalAtomic), 0n)
    )
      throw new Error(
        'Indexed loan credits or offer escrow differ from pinned liabilities.',
      );
  }

  async observeLoan(
    loan: EventLoan,
    tip: JournalBlock,
    expectedActiveLoan: string,
  ): Promise<{ observation: Observation; debt?: IndexLoan['debt'] }> {
    const c = this.config,
      iface = this.loansIface;
    const observation: Observation = {
      status: 'not_checked',
      atBlock: tip.number,
      blockHash: tip.hash,
      transactionSimulation: 'not_performed',
    };
    try {
      const [stored, debt, active] = await Promise.all([
        this.call(
          this.requireLoans().address,
          iface,
          'loans',
          [loan.loanId],
          tip.number,
        ),
        this.call(
          this.requireLoans().address,
          iface,
          'debt',
          [loan.loanId],
          tip.number,
        ),
        this.call(
          this.requireLoans().address,
          iface,
          'activeLoanForToken',
          [loan.tokenId],
          tip.number,
        ),
      ]);
      const expected = [
        loan.lender,
        loan.borrower,
        loan.vault,
        loan.tokenId,
        loan.principalAtomic,
        loan.aprBps,
        loan.maturity,
        loan.lastAccrued,
        loan.accruedInterestAtomic,
        loan.interestRemainder,
        loan.loanState === 'active',
      ];
      if (
        expected.some((value, index) =>
          index < 3
            ? address(stored[index]) !== value
            : index === 10
              ? stored[index] !== value
              : stored[index].toString() !== value,
        ) ||
        active[0].toString() !== expectedActiveLoan
      )
        throw Object.assign(
          new Error('Indexed loan differs from pinned contract state.'),
          { integrityFailure: true },
        );
      const until =
        BigInt(tip.timestamp) < BigInt(loan.maturity)
          ? BigInt(tip.timestamp)
          : BigInt(loan.maturity);
      const numerator =
        BigInt(loan.interestRemainder) +
        (loan.loanState === 'active' && until > BigInt(loan.lastAccrued)
          ? BigInt(loan.principalAtomic) *
            BigInt(loan.aprBps) *
            (until - BigInt(loan.lastAccrued))
          : 0n);
      const interest =
        BigInt(loan.accruedInterestAtomic) + numerator / INTEREST_DENOMINATOR;
      if (
        debt[0] !== BigInt(loan.principalAtomic) ||
        debt[1] !== interest ||
        debt[2] !== debt[0] + debt[1]
      )
        throw Object.assign(
          new Error('Pinned loan debt differs from exact indexed debt.'),
          { integrityFailure: true },
        );
      const owner = address(
        (
          await this.call(
            c.collection,
            NFT,
            'ownerOf',
            [loan.tokenId],
            tip.number,
          )
        )[0],
      );
      observation.owner = owner;
      observation.loanStateMatches = true;
      observation.ownerMatchesCustody = owner === loan.vault;
      observation.status =
        loan.collateralState === 'custody' && !observation.ownerMatchesCustody
          ? 'custody_mismatch'
          : 'loan_and_custody_observed';
      return {
        observation,
        debt: {
          principalAtomic: debt[0].toString(),
          interestAtomic: debt[1].toString(),
          totalAtomic: debt[2].toString(),
          atBlock: tip.number,
          blockHash: tip.hash,
        },
      };
    } catch (error) {
      if (errorInfo(error).integrityFailure) throw error;
      return {
        observation: {
          ...observation,
          status: 'unavailable',
          reason:
            'At least one pinned loan, debt or owner read failed. No transferable status is inferred.',
        },
      };
    }
  }

  async observeFinancedOrder(
    order: FinancedEventOrder,
    loan: EventLoan,
    tip: JournalBlock,
  ): Promise<IndexOrder> {
    const c = this.config,
      result: IndexOrder = {
        ...order,
        orderState: order.eventState,
        loanState: loan.loanState,
        collateralState: loan.collateralState,
        observation: {
          status: 'not_checked',
          atBlock: tip.number,
          blockHash: tip.hash,
          transactionSimulation: 'not_performed',
        },
      };
    if (
      order.eventState === 'active' &&
      BigInt(order.expiry) <= BigInt(tip.timestamp)
    )
      result.orderState = 'expired';
    try {
      const [stored, current] = await Promise.all([
        this.call(
          this.requireLoans().address,
          this.loansIface,
          'financedListings',
          [order.listingId],
          tip.number,
        ),
        this.call(
          this.requireLoans().address,
          this.loansIface,
          'activeFinancedListing',
          [order.loanId],
          tip.number,
        ),
      ]);
      if (
        stored[0].toString() !== order.loanId ||
        stored[1].toString() !== order.priceAtomic ||
        stored[2].toString() !== order.expiry ||
        stored[3] !== (order.eventState === 'active') ||
        current[0].toString() !== loan.activeListingId
      )
        throw Object.assign(
          new Error(
            'Indexed financed order differs from pinned contract state.',
          ),
          { integrityFailure: true },
        );
      result.observation.financedOrderMatches = true;
      if (
        !loan.observation ||
        loan.observation.status === 'unavailable' ||
        !loan.debt
      ) {
        result.observation.status = 'unavailable';
        return result;
      }
      result.observation.owner = loan.observation.owner;
      result.observation.ownerMatchesCustody =
        loan.observation.ownerMatchesCustody;
      result.debt = loan.debt;
      const fee = (BigInt(order.priceAtomic) * 50n) / 10_000n,
        net = BigInt(order.priceAtomic) - fee,
        debt = BigInt(loan.debt.totalAtomic);
      if (order.eventState === 'active')
        result.coverage = {
          atBlock: tip.number,
          blockHash: tip.hash,
          saleFeeAtomic: fee.toString(),
          netSaleAtomic: net.toString(),
          debtAtomic: debt.toString(),
          coversDebt: net >= debt,
          borrowerResidualAtomic: net >= debt ? (net - debt).toString() : null,
        };
      result.observation.status =
        loan.observation.status === 'custody_mismatch'
          ? 'custody_mismatch'
          : order.eventState !== 'active'
            ? 'loan_and_custody_observed'
            : net < debt
              ? 'debt_not_covered'
              : 'custody_and_debt_observed';
    } catch (error) {
      if (errorInfo(error).integrityFailure) throw error;
      result.observation.status = 'unavailable';
      result.observation.reason =
        'At least one pinned financed-order read failed. No executable status is inferred.';
    }
    return result;
  }

  async observeCredits(
    row: EventCredit,
    tip: JournalBlock,
  ): Promise<{ observation: Observation }> {
    const observation: Observation = {
      status: 'not_checked',
      atBlock: tip.number,
      blockHash: tip.hash,
      transactionSimulation: 'not_performed',
    };
    try {
      const [lender, borrower] = await Promise.all([
        this.call(
          this.requireLoans().address,
          this.loansIface,
          'lenderCredits',
          [row.account],
          tip.number,
        ),
        this.call(
          this.requireLoans().address,
          this.loansIface,
          'borrowerCredits',
          [row.account],
          tip.number,
        ),
      ]);
      if (
        lender[0].toString() !== row.lenderCreditAtomic ||
        borrower[0].toString() !== row.borrowerCreditAtomic
      )
        throw Object.assign(
          new Error(
            'Indexed account credits differ from pinned contract state.',
          ),
          { integrityFailure: true },
        );
      return { observation: { ...observation, status: 'credits_observed' } };
    } catch (error) {
      if (errorInfo(error).integrityFailure) throw error;
      return { observation: { ...observation, status: 'unavailable' } };
    }
  }
}

function argumentsFrom(argv: readonly string[]) {
  const result: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (
      !['--config', '--abi', '--loans-abi', '--state', '--view'].includes(
        key,
      ) ||
      !argv[i + 1]
    )
      throw new Error(
        'Use --config, --abi, optional --loans-abi, --state and --view. This command performs one read-only synchronization.',
      );
    result[key.slice(2)] = argv[++i];
  }
  if (!['config', 'abi', 'state', 'view'].every((key) => result[key]))
    throw new Error(
      'All four paths are required: --config --abi --state --view.',
    );
  return result;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const args = argumentsFrom(process.argv.slice(2));
    const config = record(JSON.parse(await fs.readFile(args.config, 'utf8')));
    const artifact: unknown = JSON.parse(await fs.readFile(args.abi, 'utf8'));
    const artifactAbi = (
      value: unknown,
      name: string,
      allowDirect: boolean,
    ) => {
      if (Array.isArray(value)) return validateAbi(value);
      const source = record(value);
      const nested =
        source.artifacts == null ? undefined : record(source.artifacts)[name];
      const candidate =
        (allowDirect ? source.abi : undefined) ??
        (nested == null ? undefined : record(nested).abi);
      if (!candidate)
        throw new Error(
          'ABI file must be a raw ABI, a contract artifact, or build/artifacts.json.',
        );
      return validateAbi(candidate);
    };
    const abi = artifactAbi(artifact, 'RiftwellMarket', true);
    const loanArtifact: unknown = args['loans-abi']
      ? JSON.parse(await fs.readFile(args['loans-abi'], 'utf8'))
      : artifact;
    const loansAbi = config.loans
      ? artifactAbi(loanArtifact, 'RiftwellLoans', !!args['loans-abi'])
      : undefined;
    const indexer = new MarketIndexer({
      config,
      abi,
      loansAbi,
      statePath: args.state,
      viewPath: args.view,
    });
    const view = await indexer.syncOnce();
    console.log(
      JSON.stringify({
        status: view.sync.status,
        indexedThrough: view.sync.indexedThrough,
        listings: view.listings.length,
        lagBlocks: view.sync.lagBlocks,
        stale: view.sync.stale,
      }),
    );
  } catch (error) {
    console.error(errorInfo(error).message);
    process.exitCode = 1;
  }
}
