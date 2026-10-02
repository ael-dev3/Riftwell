import type Database from 'better-sqlite3';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { RateControl } from './rate-limit.ts';

export type Clock = () => number;
export type App = FastifyInstance;
export type SqliteStore = Database.Database;
export type SqlParameter = string | number | null;
export interface Store {
  readonly dialect: 'sqlite' | 'postgres';
  readonly sqlite?: SqliteStore;
  get<T>(query: string, ...parameters: SqlParameter[]): Promise<T | undefined>;
  all<T>(query: string, ...parameters: SqlParameter[]): Promise<T[]>;
  run(
    query: string,
    ...parameters: SqlParameter[]
  ): Promise<{ changes: number }>;
  transaction<T>(operation: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export interface ServerConfig {
  production: boolean;
  sessionTransport?: 'cookie' | 'bearer';
  apiOnly?: boolean;
  origin: string;
  dbPath: string;
  databaseUrl?: string;
  databasePoolSize?: number;
  sessionSecret: string;
  rpcUrl: string | undefined;
  host: string;
  port: number;
  sessionTtlSeconds: number;
  confirmations: number;
  maxHeadAgeSeconds: number;
  timeoutMs: number;
  distPath: string;
  trustProxy: false | string[];
  logger: boolean;
}

export interface Position {
  id: string;
  tokenId: string;
  marketId: 'kittenswap';
  owner: string;
  lockedAmountRaw: string;
  lockedUntil: string;
  votingPowerRaw: string;
  blockNumber: number;
  blockHash: string;
  observedAt: string;
}
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
export interface OwnershipOptions {
  cursor?: string | null;
  limit?: number;
}
export interface ChainHealth {
  ready: boolean;
  available: boolean;
  chainId: number;
  blockNumber?: number;
  blockHash?: string;
  observedAt?: string;
  errorCode?: string;
}
export interface ChainAdapter {
  getPosition(tokenId: string): Promise<Position>;
  getPositions?(tokenIds: readonly string[]): Promise<(Position | null)[]>;
  getOwnedPositions(
    address: string,
    options?: OwnershipOptions,
  ): Promise<Page<Position>>;
  health(): Promise<ChainHealth>;
}
export interface ChainOptions {
  rpcUrl?: string | undefined;
  fetch?: typeof globalThis.fetch;
  now?: Clock;
  confirmations?: number;
  maxHeadAgeSeconds?: number;
  timeoutMs?: number;
}

export type OrderStatus = 'active' | 'cancelled' | 'expired' | 'invalidated';
export type ListingKind = 'fixed' | 'dutch';
export interface OrderBase {
  id: string;
  marketId: 'kittenswap';
  tokenId: string;
  owner: string;
  status: OrderStatus;
  expiresAt: string;
  createdAt: string;
  position: Position;
}
export interface Listing extends OrderBase {
  priceMicros: string;
  revision: number;
  updatedAt: string;
  kind: ListingKind;
  startPriceMicros: string;
  endPriceMicros: string;
  startsAt: string;
  auctionEndsAt: string | null;
  recipient: string | null;
}
export interface LoanRequest extends OrderBase {
  principalMicros: string;
  aprBps: number;
  durationDays: number;
}
export interface Offer {
  id: string;
  requestId: string;
  lender: string;
  principalMicros: string;
  aprBps: number;
  durationDays: number;
  status: 'proposed' | 'cancelled' | 'expired' | 'invalidated';
  expiresAt: string;
  createdAt: string;
}
export interface Account {
  address: string;
  positions: Position[];
  nextPositionsCursor: string | null;
  listings: Listing[];
  loanRequests: LoanRequest[];
  offers: Offer[];
  receivedOffers: Offer[];
  historyTruncated: boolean;
  positionsUnavailable: boolean;
}
export interface OrderRowBase {
  id: string;
  market: 'kittenswap';
  token_id: string;
  owner: string;
  expires_at: number;
  created_at: number;
  updated_at: number;
  status: OrderStatus;
  position_json: string;
}
export interface ListingRow extends OrderRowBase {
  price_micros: string;
  revision: number;
  kind: ListingKind;
  end_price_micros: string;
  starts_at: number;
  auction_ends_at: number | null;
  recipient: string | null;
}
export interface LoanRequestRow extends OrderRowBase {
  principal_micros: string;
  apr_bps: number;
  duration_days: number;
}
export type OrderRow = ListingRow | LoanRequestRow;
export interface OfferRow {
  id: string;
  request_id: string;
  lender: string;
  principal_micros: string;
  apr_bps: number;
  duration_days: number;
  expires_at: number;
  created_at: number;
  updated_at: number;
  status: Offer['status'];
}
export interface SessionRow {
  token_hash: string;
  address: string;
  chain_id: number;
  csrf_hash: string;
  created_at: number;
  expires_at: number;
}
export interface SessionActor extends SessionRow {
  token: string;
}
export interface Session {
  address: string;
  chainId: number;
  csrfToken: string;
  expiresAt: string;
}
export interface ChallengeRow {
  id: string;
  address: string;
  chain_id: number;
  nonce: string;
  message: string;
  created_at: number;
  expires_at: number;
  consumed_at: number | null;
}
export interface IdempotencyRow {
  actor: string;
  operation: string;
  key: string;
  payload_hash: string;
  entity_id: string;
  response_json: string;
  created_at: number;
}
export type RequireSession = (
  request: FastifyRequest,
  mutation?: boolean,
) => Promise<SessionActor>;
export interface AuthContext {
  db: Store;
  config: ServerConfig;
  now: Clock;
  limiter: RateControl;
  hash(value: string): string;
}
export interface ServiceContext extends AuthContext {
  chain: ChainAdapter;
  chainCall<T>(operation: () => Promise<T>): Promise<T>;
  checkPosition(value: unknown, tokenId: string): Position;
  freshPosition(tokenId: string): Promise<Position>;
  freshPositions(tokenIds: readonly string[]): Promise<(Position | null)[]>;
}
export interface AppContext extends ServiceContext {
  requireSession: RequireSession;
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Local SQLite tooling only. PostgreSQL callers use database. */
    store: SqliteStore;
    database: Store;
  }
}
