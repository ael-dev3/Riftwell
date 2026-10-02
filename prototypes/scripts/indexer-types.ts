import type { LogDescription, Result } from 'ethers';
import { bigint, boolean, decodedRecord, string } from './boundaries.ts';
import type {
  BlockIdentity,
  IndexCreditAccount,
  IndexLoan,
  IndexOrder,
  IndexSync,
  Observation,
  OrderState,
} from '../web/index-types.ts';

export interface LoanConfig {
  address: string;
  deploymentBlock: number;
  deploymentBlockHash: string;
  expectedCodeHash: string;
  voter: string;
  treasury: string;
  guardian: string;
  claimsVerified: boolean;
}
export interface IndexConfig {
  chainId: number;
  rpcUrl: string;
  market: string;
  collection: string;
  paymentToken: string;
  deploymentBlock: number;
  deploymentBlockHash: string;
  expectedMarketCodeHash: string;
  paymentDecimals: number;
  confirmations: number;
  maxBlocksPerSync: number;
  staleAfterSeconds: number;
  loans?: LoanConfig;
}
export interface RpcSender {
  send(method: string, params: readonly unknown[]): Promise<unknown>;
}
export interface RpcLog {
  address: string;
  data: string;
  topics: string[];
  blockNumber: string;
  blockHash: string;
  transactionHash: string;
  transactionIndex: string;
  logIndex: string;
  removed: false;
}
export interface JournalBlock extends BlockIdentity {
  parentHash: string;
  logs: RpcLog[];
}
export interface JournalState {
  schemaVersion: 1;
  identity: string;
  blocks: JournalBlock[];
  reorgs: unknown[];
  sync: IndexSync | null;
}
export interface EventOrder extends Omit<
  IndexOrder,
  'observation' | 'orderState'
> {
  eventState: OrderState;
  updatedBlock: number;
  updatedTransaction: string;
  cancellationReason?: 'repriced' | 'borrower_cancelled' | 'loan_closed';
}
export interface FinancedEventOrder extends EventOrder {
  loanId: string;
  sourceKind: 'financed';
  orderKey: string;
}
export interface EventLoan extends Omit<IndexLoan, 'observation'> {
  observation?: Observation;
  lastPaymentAtomic?: string;
  forgiven?: boolean;
  recipient?: string;
}
export type EventCredit = Omit<IndexCreditAccount, 'observation'> & {
  observation?: Observation;
};
export interface EventOffer {
  lender: string;
  borrower: string;
  tokenId: string;
  principalAtomic: string;
  aprBps: string;
  duration: string;
  active: boolean;
}
export interface FinancedJournal {
  orders: FinancedEventOrder[];
  loans: EventLoan[];
  offers: EventOffer[];
  creditAccounts: EventCredit[];
}
export type CreditField = 'lenderCreditAtomic' | 'borrowerCreditAtomic';

const loanFields = {
  OfferFunded: {
    uint: ['offerId', 'tokenId', 'principal', 'aprBps', 'duration'],
    address: ['lender', 'borrower'],
  },
  OfferCancelled: { uint: ['offerId'], address: [] },
  LoanOpened: {
    uint: ['loanId', 'offerId', 'protocolFee', 'borrowerProceeds', 'maturity'],
    address: ['vault'],
  },
  Repaid: {
    uint: ['loanId', 'amount', 'interestPaid', 'principalPaid'],
    address: ['payer'],
  },
  DebtForgiven: { uint: ['loanId', 'principal', 'interest'], address: [] },
  LoanClosed: { uint: ['loanId'], address: [] },
  CollateralWithdrawn: { uint: ['loanId'], address: ['recipient'] },
  LenderCreditWithdrawn: { uint: ['amount'], address: ['lender', 'recipient'] },
  BorrowerCreditWithdrawn: {
    uint: ['amount'],
    address: ['borrower', 'recipient'],
  },
  FinancedCollateralListed: {
    uint: ['listingId', 'loanId', 'tokenId', 'price', 'expiry'],
    address: ['borrower'],
  },
  FinancedListingCancelled: { uint: ['listingId'], address: [] },
  FinancedCollateralSold: {
    uint: [
      'listingId',
      'loanId',
      'price',
      'debtPaid',
      'protocolFee',
      'borrowerProceeds',
    ],
    address: ['buyer', 'recipient'],
  },
} as const;
type LoanEventName = keyof typeof loanFields;
type LoanEventArgs<Name extends LoanEventName> = {
  [Key in (typeof loanFields)[Name]['uint'][number]]: bigint;
} & { [Key in (typeof loanFields)[Name]['address'][number]]: string };
export type LoanEvent = {
  [Name in LoanEventName]: { name: Name; args: LoanEventArgs<Name> };
}[LoanEventName];
export function loanEvent(parsed: LogDescription): LoanEvent | null {
  if (!Object.hasOwn(loanFields, parsed.name)) return null;
  const name = parsed.name as LoanEventName;
  const fields = loanFields[name];
  const source = decodedRecord(parsed.args);
  const args: Record<string, bigint | string> = {};
  for (const key of fields.uint) args[key] = bigint(source[key]);
  for (const key of fields.address) args[key] = string(source[key]);
  // The descriptor validates every field in the discriminated event schema.
  return { name, args } as LoanEvent;
}

export interface GetterOutputs {
  collection: readonly [string];
  paymentToken: readonly [string];
  settlementToken: readonly [string];
  voter: readonly [string];
  treasury: readonly [string];
  guardian: readonly [string];
  ownerOf: readonly [string];
  getApproved: readonly [string];
  decimals: readonly [bigint];
  FEE_BPS: readonly [bigint];
  currentListing: readonly [bigint];
  sellerNonces: readonly [bigint];
  listingCount: readonly [bigint];
  offerCount: readonly [bigint];
  loanCount: readonly [bigint];
  financedListingCount: readonly [bigint];
  totalLenderCredits: readonly [bigint];
  totalBorrowerCredits: readonly [bigint];
  escrowedOfferCapital: readonly [bigint];
  activeLoanForToken: readonly [bigint];
  activeFinancedListing: readonly [bigint];
  lenderCredits: readonly [bigint];
  borrowerCredits: readonly [bigint];
  isApprovedForAll: readonly [boolean];
  claimsVerified: readonly [boolean];
  listings: readonly [string, bigint, bigint, bigint, bigint, boolean];
  loans: readonly [
    string,
    string,
    string,
    bigint,
    bigint,
    bigint,
    bigint,
    bigint,
    bigint,
    bigint,
    boolean,
  ];
  debt: readonly [bigint, bigint, bigint];
  financedListings: readonly [bigint, bigint, bigint, boolean];
}

const getterFields = {
  collection: ['address'],
  paymentToken: ['address'],
  settlementToken: ['address'],
  voter: ['address'],
  treasury: ['address'],
  guardian: ['address'],
  ownerOf: ['address'],
  getApproved: ['address'],
  decimals: ['uint'],
  FEE_BPS: ['uint'],
  currentListing: ['uint'],
  sellerNonces: ['uint'],
  listingCount: ['uint'],
  offerCount: ['uint'],
  loanCount: ['uint'],
  financedListingCount: ['uint'],
  totalLenderCredits: ['uint'],
  totalBorrowerCredits: ['uint'],
  escrowedOfferCapital: ['uint'],
  activeLoanForToken: ['uint'],
  activeFinancedListing: ['uint'],
  lenderCredits: ['uint'],
  borrowerCredits: ['uint'],
  isApprovedForAll: ['bool'],
  claimsVerified: ['bool'],
  listings: ['address', 'uint', 'uint', 'uint', 'uint', 'bool'],
  loans: [
    'address',
    'address',
    'address',
    'uint',
    'uint',
    'uint',
    'uint',
    'uint',
    'uint',
    'uint',
    'bool',
  ],
  debt: ['uint', 'uint', 'uint'],
  financedListings: ['uint', 'uint', 'uint', 'bool'],
} as const satisfies Record<
  keyof GetterOutputs,
  readonly ('address' | 'uint' | 'bool')[]
>;

export function decodeGetter<Name extends keyof GetterOutputs>(
  name: Name,
  result: Result,
): GetterOutputs[Name] {
  const fields = getterFields[name];
  if (result.length !== fields.length)
    throw new Error(`Unexpected ${name} getter output count.`);
  const values = fields.map((field, index) =>
    field === 'uint'
      ? bigint(result[index])
      : field === 'bool'
        ? boolean(result[index])
        : string(result[index]),
  );
  // Every positional field has been checked against the ABI getter schema.
  return values as unknown as GetterOutputs[Name];
}
