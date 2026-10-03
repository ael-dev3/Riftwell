export type OrderState =
  'active' | 'cancelled' | 'sold' | 'invalidated' | 'superseded' | 'expired';
export type LoanState = 'active' | 'repaid' | 'forgiven' | 'sold';
export type CollateralState = 'custody' | 'withdrawn';
export type ObservationStatus =
  | 'not_checked'
  | 'ownership_and_approval_observed'
  | 'owner_mismatch'
  | 'approval_missing'
  | 'unavailable'
  | 'custody_and_debt_observed'
  | 'loan_and_custody_observed'
  | 'custody_mismatch'
  | 'debt_not_covered'
  | 'credits_observed';
export interface BlockIdentity {
  number: number;
  hash: string;
  timestamp: number;
}
export interface IndexSource {
  kind: 'riftwell-market-events';
  chainId: number;
  market: string;
  collection: string;
  paymentToken: string;
  deploymentBlock: number;
  deploymentBlockHash: string;
  expectedMarketCodeHash: string;
  abiHash: string;
  paymentDecimals: number;
  confirmations: number;
  rpcOrigin?: string;
}
export interface FinancedSource {
  kind: 'riftwell-loans-events';
  chainId: number;
  loans: string;
  collection: string;
  paymentToken: string;
  voter: string;
  treasury: string;
  guardian: string;
  deploymentBlock: number;
  deploymentBlockHash: string;
  expectedCodeHash: string;
  abiHash: string;
  paymentDecimals: number;
  confirmations: number;
  claimsVerified: boolean;
  creditCoverage: 'complete_manager_events';
  rpcOrigin?: string;
}
export interface IndexSync {
  status:
    | 'unconfigured'
    | 'synced'
    | 'catching_up'
    | 'partial_observations'
    | 'awaiting_confirmations'
    | 'error';
  stale?: boolean;
  lastSuccessfulSyncAt?: string | null;
  completedAt?: string;
  indexedThrough?: BlockIdentity | null;
  observedHead?: BlockIdentity | null;
  lagBlocks?: number;
  staleAfterSeconds?: number;
  rolledBackBlocks?: number;
  clockSkew?: boolean;
  observationFailures?: number;
  confirmedTarget?: number;
  lastAttemptAt?: string;
  reason?: string;
  error?: string;
}
export interface Observation {
  status: ObservationStatus;
  transactionSimulation: 'not_performed';
  atBlock?: number | null;
  blockHash?: string | null;
  reason?: string;
  owner?: string;
  tokenApproval?: string;
  operatorApproval?: boolean;
  ownerMatchesSeller?: boolean;
  approvedForMarket?: boolean;
  marketOrderMatches?: boolean;
  ownerMatchesCustody?: boolean;
  loanStateMatches?: boolean;
  financedOrderMatches?: boolean;
}
export interface Debt {
  principalAtomic: string;
  interestAtomic: string;
  totalAtomic: string;
  atBlock: number;
  blockHash: string;
}
export interface DebtCoverage {
  saleFeeAtomic: string;
  netSaleAtomic: string;
  debtAtomic: string;
  coversDebt: boolean;
  borrowerResidualAtomic: string | null;
  atBlock: number;
  blockHash: string;
}
export interface IndexOrder {
  cancellationReason?: 'repriced' | 'borrower_cancelled' | 'loan_closed';
  sourceKind?: 'market' | 'financed';
  orderKey?: string;
  listingId: string;
  tokenId: string;
  seller: string;
  priceAtomic: string;
  expiry: string;
  orderState: OrderState;
  observation: Observation;
  loanId?: string;
  loanState?: LoanState;
  collateralState?: CollateralState;
  debt?: Debt;
  coverage?: DebtCoverage;
  debtPaidAtomic?: string;
  protocolFeeAtomic?: string;
  borrowerProceedsAtomic?: string;
  eventState?: OrderState;
  sellerNonce?: string;
  createdBlock?: number;
  createdTransaction?: string;
  updatedBlock?: number;
  updatedTransaction?: string;
  buyer?: string;
  recipient?: string;
}
export interface IndexLoan {
  loanId: string;
  offerId: string;
  tokenId: string;
  lender: string;
  borrower: string;
  vault: string;
  principalAtomic: string;
  aprBps: string;
  maturity: string;
  lastAccrued: string;
  accruedInterestAtomic: string;
  interestRemainder: string;
  activeListingId: string;
  loanState: LoanState;
  collateralState: CollateralState;
  observation: Observation;
  debt?: Debt;
  createdBlock?: number;
  createdTransaction?: string;
  updatedBlock?: number;
  updatedTransaction?: string;
}
export interface IndexCreditAccount {
  account: string;
  lenderCreditAtomic: string;
  borrowerCreditAtomic: string;
  observation: Observation;
}
export interface IndexSnapshot {
  schemaVersion: 1;
  source: IndexSource | null;
  sync: IndexSync;
  listings: IndexOrder[];
  transactionSimulation: 'not_performed';
  snapshotId?: string;
  financedSource?: FinancedSource | null;
  loans?: IndexLoan[];
  creditAccounts?: IndexCreditAccount[];
  orderCounts?: Partial<Record<OrderState, number>>;
}
export interface IndexHealth {
  configured: boolean;
  stale: boolean;
  ageSeconds: number | null;
  blockAge?: number | null;
  clockSkew?: boolean;
  label: string;
}
