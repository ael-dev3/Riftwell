import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { appendAudit, expireRecords, invalidateOffers } from './database.ts';
import { ApiError, fail, errorCode } from './errors.ts';
import * as valid from './validation.ts';
import type {
  Account,
  App,
  AppContext,
  IdempotencyRow,
  Listing,
  ListingKind,
  ListingRow,
  LoanRequest,
  LoanRequestRow,
  Offer,
  OfferRow,
  OrderBase,
  OrderRow,
  Page,
  Position,
} from './types.ts';

const iso = (time: number): string => new Date(time).toISOString();
const definitions = {
  listings: {
    table: 'listings',
    kind: 'listing',
    amount: 'priceMicros',
    column: 'price_micros',
  },
  'loan-requests': {
    table: 'loan_requests',
    kind: 'loan-request',
    amount: 'principalMicros',
    column: 'principal_micros',
  },
} as const;
type Definition = (typeof definitions)[keyof typeof definitions];
type OrderTable = Definition['table'];
type OrderDTO = Listing | LoanRequest;
interface Terms {
  kind: ListingKind;
  startPriceMicros: string;
  endPriceMicros: string;
  expiresAt: number;
  auctionEndsAt: number | null;
  recipient: string | null;
}
interface Filters {
  market: 'kittenswap';
  seller: string | null;
  tokenId: string | null;
  minPriceMicros: string | null;
  maxPriceMicros: string | null;
}
interface Cursor {
  time: number;
  id: string;
}

function currentAskMicros(row: ListingRow, time: number): string {
  const start = BigInt(row.price_micros);
  if (row.kind !== 'dutch') return start.toString();
  const end = BigInt(row.end_price_micros);
  if (row.auction_ends_at === null)
    throw new Error('Missing Dutch price duration');
  const duration = row.auction_ends_at - row.starts_at;
  const remaining = BigInt(
    Math.min(Math.max(Math.trunc(row.auction_ends_at - time), 0), duration),
  );
  const scale = 1_000_000_000_000_000_000n;
  const fraction = (remaining * scale) / BigInt(duration);
  const squared = (fraction * fraction) / scale;
  const cubed = (squared * fraction) / scale;
  return (end + ((start - end) * cubed) / scale).toString();
}

function listingTermsResponse(
  row: ListingRow,
): Pick<
  Listing,
  | 'kind'
  | 'startPriceMicros'
  | 'endPriceMicros'
  | 'startsAt'
  | 'auctionEndsAt'
  | 'recipient'
> {
  return {
    kind: row.kind,
    startPriceMicros: row.price_micros,
    endPriceMicros:
      row.kind === 'fixed' ? row.price_micros : row.end_price_micros,
    startsAt: iso(row.starts_at || row.created_at),
    auctionEndsAt:
      row.auction_ends_at === null ? null : iso(row.auction_ends_at),
    recipient: row.recipient,
  };
}

function serializeOrder(
  row: OrderRow,
  position: Position,
  time: number,
): OrderDTO {
  const result: OrderBase = {
    id: row.id,
    marketId: row.market,
    tokenId: row.token_id,
    owner: row.owner,
    status: row.status,
    expiresAt: iso(row.expires_at),
    createdAt: iso(row.created_at),
    position,
  };
  if ('price_micros' in row)
    return {
      ...result,
      ...listingTermsResponse(row),
      priceMicros: currentAskMicros(row, time),
      revision: row.revision,
      updatedAt: iso(row.updated_at),
    };
  else
    return {
      ...result,
      principalMicros: row.principal_micros,
      aprBps: row.apr_bps,
      durationDays: row.duration_days,
    };
}

function offerResponse(row: OfferRow): Offer {
  return {
    id: row.id,
    requestId: row.request_id,
    lender: row.lender,
    principalMicros: row.principal_micros,
    aprBps: row.apr_bps,
    durationDays: row.duration_days,
    status: row.status,
    expiresAt: iso(row.expires_at),
    createdAt: iso(row.created_at),
  };
}

function loanEligible(position: Position, days: number, now: number): boolean {
  try {
    return (
      BigInt(position.lockedAmountRaw) > 0n &&
      Date.parse(position.lockedUntil) >= now + days * 86400000
    );
  } catch {
    return false;
  }
}

export function registerOrders(app: App, ctx: AppContext): void {
  const { db, now, hash, freshPosition, chainCall, chain } = ctx;
  function orderResponse(row: ListingRow, position?: Position): Listing;
  function orderResponse(row: LoanRequestRow, position?: Position): LoanRequest;
  function orderResponse(row: OrderRow, position?: Position): OrderDTO;
  function orderResponse(row: OrderRow, position?: Position): OrderDTO {
    const stored: unknown = position ?? JSON.parse(row.position_json);
    return serializeOrder(
      row,
      position ?? ctx.checkPosition(stored, row.token_id),
      now(),
    );
  }
  function retireLending(): never {
    return fail(
      410,
      'LEGACY_LENDING_RETIRED',
      'Lending requests and offers are retired. Historical intents remain available for cancellation.',
    );
  }
  function responseFor(table: 'listings', id: string): Promise<Listing>;
  function responseFor(
    table: 'loan_requests',
    id: string,
  ): Promise<LoanRequest>;
  function responseFor(table: 'offers', id: string): Promise<Offer>;
  function responseFor(table: OrderTable, id: string): Promise<OrderDTO>;
  async function responseFor(
    table: OrderTable | 'offers',
    id: string,
  ): Promise<OrderDTO | Offer> {
    if (table === 'offers') {
      const row = await db.get<OfferRow>(
        'SELECT * FROM offers WHERE id = ?',
        id,
      );
      if (!row) fail(500, 'INTERNAL_ERROR', 'The stored order is unavailable.');
      return offerResponse(row);
    }
    const row = await db.get<OrderRow>(
      `SELECT * FROM ${table} WHERE id = ?`,
      id,
    );
    if (!row) fail(500, 'INTERNAL_ERROR', 'The stored order is unavailable.');
    return orderResponse(row);
  }
  const invalidate = (
    definition: Definition,
    row: OrderRow,
    reason: string,
  ): Promise<void> =>
    db.transaction(async () => {
      const changes = (
        await db.run(
          `UPDATE ${definition.table} SET status = 'invalidated', updated_at = ?${definition.table === 'listings' ? ', revision = revision + 1' : ''} WHERE id = ? AND status = 'active'`,
          now(),
          row.id,
        )
      ).changes;
      if (changes) {
        await appendAudit(
          db,
          now(),
          null,
          `${definition.kind}.invalidated`,
          definition.kind,
          row.id,
          { reason },
        );
        if (definition.table === 'loan_requests')
          await invalidateOffers(db, row.id, now());
      }
    });

  async function verifyRecord(
    definition: Definition,
    row: ListingRow,
    suppliedPosition?: Position | null,
  ): Promise<Listing | null>;
  async function verifyRecord(
    definition: Definition,
    row: LoanRequestRow,
    suppliedPosition?: Position | null,
  ): Promise<LoanRequest | null>;
  async function verifyRecord(
    definition: Definition,
    row: OrderRow | undefined,
    suppliedPosition?: Position | null,
  ): Promise<OrderDTO | null>;
  async function verifyRecord(
    definition: Definition,
    row: OrderRow | undefined,
    suppliedPosition: Position | null | undefined = undefined,
  ): Promise<OrderDTO | null> {
    if (!row || row.status !== 'active') return null;
    let position: Position;
    try {
      if (suppliedPosition === null) {
        await invalidate(definition, row, 'position_missing');
        return null;
      }
      position = suppliedPosition ?? (await freshPosition(row.token_id));
    } catch (error) {
      if (errorCode(error) !== 'POSITION_NOT_FOUND') throw error;
      await invalidate(definition, row, 'position_missing');
      return null;
    }
    if (
      !valid.sameOwner(position.owner, row.owner) ||
      (definition.table === 'loan_requests' &&
        'duration_days' in row &&
        !loanEligible(position, row.duration_days, now()))
    ) {
      await invalidate(definition, row, 'ownership_or_lock_changed');
      return null;
    }
    await expireRecords(db, now());
    const current = await db.get<OrderRow>(
      `SELECT * FROM ${definition.table} WHERE id = ?`,
      row.id,
    );
    return current?.status === 'active'
      ? orderResponse(current, position)
      : null;
  }

  async function cached(
    actor: string,
    operation: string,
    key: string,
    payloadHash: string,
  ): Promise<IdempotencyRow | undefined> {
    const row = await db.get<IdempotencyRow>(
      'SELECT * FROM idempotency WHERE actor = ? AND operation = ? AND key = ?',
      actor,
      operation,
      key,
    );
    if (row && row.payload_hash !== payloadHash)
      fail(
        409,
        'IDEMPOTENCY_CONFLICT',
        'This idempotency key was used with another request.',
      );
    return row;
  }
  async function saveResult(
    actor: string,
    operation: string,
    key: string,
    payloadHash: string,
    result: OrderDTO | Offer,
  ): Promise<void> {
    await db.run(
      'INSERT INTO idempotency(actor,operation,key,payload_hash,entity_id,response_json,created_at) VALUES (?,?,?,?,?,?,?)',
      actor,
      operation,
      key,
      payloadHash,
      result.id,
      JSON.stringify(result),
      now(),
    );
  }
  function payloadHash(value: object): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }
  function listingSnapshot(json: string): Listing {
    const result: unknown = JSON.parse(json);
    if (!valid.isRecord(result))
      fail(
        500,
        'INTERNAL_ERROR',
        'The stored listing snapshot is unavailable.',
      );
    const owner = valid.address(result.owner);
    const tokenId = valid.tokenId(result.tokenId);
    const status = result.status;
    const revision = result.revision ?? 1;
    if (
      result.marketId !== 'kittenswap' ||
      (status !== 'active' &&
        status !== 'cancelled' &&
        status !== 'expired' &&
        status !== 'invalidated') ||
      typeof revision !== 'number' ||
      !Number.isSafeInteger(revision) ||
      revision < 1
    )
      fail(
        500,
        'INTERNAL_ERROR',
        'The stored listing snapshot is unavailable.',
      );
    const terms = listingTerms(
      {
        priceMicros: result.startPriceMicros ?? result.priceMicros,
        endPriceMicros: result.endPriceMicros ?? result.priceMicros,
        kind: result.kind ?? 'fixed',
        expiresAt: result.expiresAt,
        auctionEndsAt: result.auctionEndsAt ?? null,
        recipient: result.recipient ?? null,
      },
      owner,
    );
    // Old create responses remain original snapshots, with the additive fields
    // filled in without changing their durable idempotency payload digest.
    return {
      id: valid.uuid(result.id),
      marketId: 'kittenswap',
      tokenId,
      owner,
      status,
      position: ctx.checkPosition(result.position, tokenId),
      createdAt: iso(valid.expiryTimestamp(result.createdAt)),
      expiresAt: iso(terms.expiresAt),
      priceMicros: valid.money(result.priceMicros),
      revision,
      updatedAt: iso(
        valid.expiryTimestamp(result.updatedAt ?? result.createdAt),
      ),
      kind: terms.kind,
      startPriceMicros: terms.startPriceMicros,
      endPriceMicros: terms.endPriceMicros,
      startsAt: iso(valid.expiryTimestamp(result.startsAt ?? result.createdAt)),
      auctionEndsAt:
        terms.auctionEndsAt === null ? null : iso(terms.auctionEndsAt),
      recipient: terms.recipient,
    };
  }
  function listingTerms(body: Record<string, unknown>, owner: string): Terms {
    const kind = body.kind === undefined ? 'fixed' : body.kind;
    if (kind !== 'fixed' && kind !== 'dutch')
      fail(400, 'INVALID_LISTING_KIND', 'Listing kind must be fixed or dutch.');
    const startPriceMicros = valid.money(body.priceMicros);
    const endPriceMicros =
      body.endPriceMicros === undefined
        ? startPriceMicros
        : valid.money(body.endPriceMicros);
    const expiresAt = valid.expiryTimestamp(body.expiresAt);
    const auctionEndsAt =
      body.auctionEndsAt === undefined || body.auctionEndsAt === null
        ? null
        : valid.expiryTimestamp(body.auctionEndsAt);
    const recipient =
      body.recipient === undefined || body.recipient === null
        ? null
        : valid.address(body.recipient);
    if (
      recipient !== null &&
      (/^0x0{40}$/i.test(recipient) || valid.sameOwner(recipient, owner))
    )
      fail(
        400,
        'INVALID_RECIPIENT',
        'Use a different nonzero recipient address.',
      );
    if (
      BigInt(endPriceMicros) > BigInt(startPriceMicros) ||
      (kind === 'fixed' && endPriceMicros !== startPriceMicros) ||
      (kind === 'dutch' && body.endPriceMicros === undefined)
    )
      fail(
        400,
        'INVALID_AMOUNT',
        'Fixed prices must match; Dutch ending prices must be supplied and not exceed the starting price.',
      );
    if (
      kind === 'fixed'
        ? auctionEndsAt !== null
        : auctionEndsAt === null || auctionEndsAt > expiresAt
    )
      fail(
        400,
        'INVALID_AUCTION',
        'A Dutch price duration must end by the listing expiry; fixed listings have no auction end.',
      );
    return {
      kind,
      startPriceMicros,
      endPriceMicros,
      expiresAt,
      auctionEndsAt,
      recipient,
    };
  }
  function currentTerms(terms: Terms, time: number): void {
    valid.expiry(iso(terms.expiresAt), time);
    if (
      terms.kind === 'dutch' &&
      (terms.auctionEndsAt === null || terms.auctionEndsAt <= time)
    )
      fail(
        400,
        'INVALID_AUCTION',
        'The Dutch price duration must still be in the future.',
      );
  }
  function extendDigest(
    original: Record<string, unknown>,
    terms: Terms,
  ): Record<string, unknown> {
    // Normalized fixed/null defaults retain pre-extension durable request keys.
    return terms.kind === 'fixed' && terms.recipient === null
      ? original
      : {
          ...original,
          kind: terms.kind,
          endPriceMicros: terms.endPriceMicros,
          auctionEndsAt: terms.auctionEndsAt,
          recipient: terms.recipient?.toLowerCase() ?? null,
        };
  }
  function matchesPrice(priceMicros: string, filters: Filters): boolean {
    return (
      (filters.minPriceMicros === null ||
        BigInt(priceMicros) >= BigInt(filters.minPriceMicros)) &&
      (filters.maxPriceMicros === null ||
        BigInt(priceMicros) <= BigInt(filters.maxPriceMicros))
    );
  }
  function encodeCursor(row: ListingRow, filters: string): string {
    const payload = Buffer.from(
      JSON.stringify({ time: row.created_at, id: row.id, filters }),
    ).toString('base64url');
    return `${payload}.${hash(`listing-cursor:${payload}`)}`;
  }
  function decodeCursor(value: unknown, filters: string): Cursor {
    if (value === undefined)
      return {
        time: Number.MAX_SAFE_INTEGER,
        id: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
      };
    if (
      typeof value !== 'string' ||
      value.length > 512 ||
      !/^[A-Za-z0-9_-]+\.[0-9a-f]{64}$/.test(value)
    )
      fail(400, 'INVALID_PAGINATION', 'The pagination cursor is invalid.');
    const [payload, tag] = value.split('.');
    if (
      !timingSafeEqual(
        Buffer.from(tag, 'hex'),
        Buffer.from(hash(`listing-cursor:${payload}`), 'hex'),
      )
    )
      fail(400, 'INVALID_PAGINATION', 'The pagination cursor is invalid.');
    let raw: unknown;
    try {
      raw = JSON.parse(Buffer.from(payload, 'base64url').toString());
    } catch {
      fail(400, 'INVALID_PAGINATION', 'The pagination cursor is invalid.');
    }
    const decoded = valid.fields(raw, ['time', 'id', 'filters']);
    if (
      typeof decoded.time !== 'number' ||
      !Number.isSafeInteger(decoded.time) ||
      decoded.time < 0 ||
      decoded.filters !== filters
    )
      fail(400, 'INVALID_PAGINATION', 'The pagination cursor is invalid.');
    return { time: decoded.time, id: valid.uuid(decoded.id) };
  }

  for (const [path, definition] of Object.entries(definitions)) {
    app.get(`/api/v1/${path}`, async (request) => {
      if (lendingTable(definition)) retireLending();
      const query = valid.fields(request.query, [
        'market',
        'limit',
        'cursor',
        'seller',
        'tokenId',
        'minPriceMicros',
        'maxPriceMicros',
      ]);
      if (query.market !== undefined && query.market !== 'kittenswap')
        fail(400, 'INVALID_MARKET', 'KittenSwap is the only available market.');
      const limit = valid.limit(query.limit);
      const filters: Filters = {
        market: 'kittenswap',
        seller:
          query.seller === undefined
            ? null
            : valid.address(query.seller).toLowerCase(),
        tokenId:
          query.tokenId === undefined ? null : valid.tokenId(query.tokenId),
        minPriceMicros:
          query.minPriceMicros === undefined
            ? null
            : valid.money(query.minPriceMicros),
        maxPriceMicros:
          query.maxPriceMicros === undefined
            ? null
            : valid.money(query.maxPriceMicros),
      };
      if (
        filters.minPriceMicros !== null &&
        filters.maxPriceMicros !== null &&
        BigInt(filters.minPriceMicros) > BigInt(filters.maxPriceMicros)
      )
        fail(
          400,
          'INVALID_AMOUNT',
          'The minimum price must not exceed the maximum price.',
        );
      const filtersDigest = payloadHash(filters);
      let cursor = decodeCursor(query.cursor, filtersDigest);
      const clauses = ["status = 'active'", 'market = ?'];
      const parameters: string[] = [filters.market];
      if (filters.seller !== null) {
        clauses.push('lower(owner) = ?');
        parameters.push(filters.seller);
      }
      if (filters.tokenId !== null) {
        clauses.push('token_id = ?');
        parameters.push(filters.tokenId);
      }
      // Dutch current asks depend on server time. Price filters cannot use the
      // persisted starting price; scan a bounded newest-first window instead.
      await expireRecords(db, now());
      const items: { row: ListingRow; value: Listing }[] = [];
      let scanned = 0;
      let last: ListingRow | undefined;
      let more = false;
      while (items.length <= limit && scanned < 150) {
        const rows = await db.all<ListingRow>(
          `SELECT * FROM ${definition.table} WHERE ${clauses.join(' AND ')} AND (created_at < ? OR (created_at = ? AND id < ?)) ORDER BY created_at DESC, id DESC LIMIT ?`,
          ...parameters,
          cursor.time,
          cursor.time,
          cursor.id,
          limit + 1,
        );
        if (!rows.length) {
          more = false;
          break;
        }
        const pricingTime = now();
        const candidates = rows.filter((row) =>
          matchesPrice(currentAskMicros(row, pricingTime), filters),
        );
        const positions = candidates.length
          ? await ctx.freshPositions(candidates.map((row) => row.token_id))
          : [];
        const proofs = new Map(
          candidates.map((row, index) => [row.id, positions[index]]),
        );
        for (const row of rows) {
          last = row;
          scanned++;
          const verified = proofs.has(row.id)
            ? await verifyRecord(definition, row, proofs.get(row.id))
            : null;
          // A concurrent reprice can change the row while its chain read waits.
          // Apply price filters again to the current response, not its old SQL row.
          if (verified && matchesPrice(verified.priceMicros, filters))
            items.push({ row, value: verified });
          if (items.length > limit || scanned >= 150) break;
        }
        more = rows.length === limit + 1;
        if (items.length > limit || !more || scanned >= 150) break;
        if (!last) break;
        cursor = { time: last.created_at, id: last.id };
      }
      return {
        items: items.slice(0, limit).map((item) => item.value),
        nextCursor:
          items.length > limit
            ? encodeCursor(items[limit - 1].row, filtersDigest)
            : more && last
              ? encodeCursor(last, filtersDigest)
              : null,
      };
    });

    app.post(`/api/v1/${path}`, async (request) => {
      const session = await ctx.requireSession(request, true);
      if (lendingTable(definition)) retireLending();
      const body = valid.fields(request.body, [
        'tokenId',
        definition.amount,
        'expiresAt',
        'idempotencyKey',
        'kind',
        'endPriceMicros',
        'auctionEndsAt',
        'recipient',
      ]);
      const tokenId = valid.tokenId(body.tokenId);
      const terms = listingTerms(body, session.address);
      const amount = terms.startPriceMicros;
      const expiresAt = terms.expiresAt;
      const key = valid.uuid(body.idempotencyKey, 'Idempotency key');
      // Keep the original listing digest shape for durable idempotency retries.
      const digest = payloadHash(
        extendDigest(
          {
            tokenId,
            amount,
            expiresAt,
            apr: null,
            days: null,
          },
          terms,
        ),
      );
      const existingRetry = await cached(session.address, path, key, digest);
      if (!existingRetry) currentTerms(terms, now());
      const position = await freshPosition(tokenId);
      if (!valid.sameOwner(position.owner, session.address)) {
        const previous = await db.get<ListingRow>(
          `SELECT * FROM ${definition.table} WHERE token_id = ? AND status = 'active'`,
          tokenId,
        );
        if (previous && !valid.sameOwner(position.owner, previous.owner))
          await invalidate(definition, previous, 'ownership_changed');
        fail(
          403,
          'NOT_OWNER',
          'The signed-in account must currently own this position.',
        );
      }
      return db.transaction(async () => {
        await ctx.requireSession(request, true);
        await expireRecords(db, now());
        const retry = await cached(session.address, path, key, digest);
        if (retry) {
          const current = await db.get<Pick<ListingRow, 'status'>>(
            `SELECT status FROM ${definition.table} WHERE id = ?`,
            retry.entity_id,
          );
          if (current?.status !== 'active')
            fail(
              409,
              'ORDER_INACTIVE',
              'The original order is no longer active.',
            );
          return listingSnapshot(retry.response_json);
        }
        const prior = await db.get<ListingRow>(
          `SELECT * FROM ${definition.table} WHERE token_id = ? AND status = 'active'`,
          tokenId,
        );
        if (prior && !valid.sameOwner(prior.owner, position.owner))
          await invalidate(definition, prior, 'ownership_changed');
        else if (prior)
          fail(
            409,
            'ACTIVE_ORDER_EXISTS',
            'An active order already exists for this position.',
          );
        const id = randomUUID();
        const createdAt = now();
        currentTerms(terms, createdAt);
        await db.run(
          'INSERT INTO listings(id,market,token_id,owner,price_micros,expires_at,created_at,updated_at,status,position_json,kind,end_price_micros,starts_at,auction_ends_at,recipient) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          id,
          'kittenswap',
          tokenId,
          session.address,
          amount,
          expiresAt,
          createdAt,
          createdAt,
          'active',
          JSON.stringify(position),
          terms.kind,
          terms.endPriceMicros,
          createdAt,
          terms.auctionEndsAt,
          terms.recipient,
        );
        const result = await responseFor(definition.table, id);
        await saveResult(session.address, path, key, digest, result);
        await appendAudit(
          db,
          createdAt,
          session.address,
          `${definition.kind}.created`,
          definition.kind,
          id,
          { tokenId, marketId: 'kittenswap' },
        );
        return result;
      });
    });

    app.delete<{ Params: { id: string } }>(
      `/api/v1/${path}/:id`,
      async (request) => {
        const session = await ctx.requireSession(request, true);
        valid.fields(request.body, [], true);
        const id = valid.uuid(request.params.id);
        await expireRecords(db, now());
        const row = await db.get<OrderRow>(
          `SELECT * FROM ${definition.table} WHERE id = ?`,
          id,
        );
        if (!row) fail(404, 'ORDER_NOT_FOUND', 'The order was not found.');
        if (!valid.sameOwner(row.owner, session.address))
          fail(403, 'FORBIDDEN', 'Only the creator can cancel this order.');
        // Withdrawing off-chain intent cannot move funds or custody and must remain
        // available during an RPC outage. Creator authority never follows an NFT.
        return db.transaction(async () => {
          await ctx.requireSession(request, true);
          const changes = (
            await db.run(
              `UPDATE ${definition.table} SET status = 'cancelled', updated_at = ?${definition.table === 'listings' ? ', revision = revision + 1' : ''} WHERE id = ? AND status = 'active'`,
              now(),
              id,
            )
          ).changes;
          if (changes) {
            await appendAudit(
              db,
              now(),
              session.address,
              `${definition.kind}.cancelled`,
              definition.kind,
              id,
            );
            if (lendingTable(definition))
              await invalidateOffers(db, id, now(), session.address);
          }
          return orderResponse(
            (await db.get<OrderRow>(
              `SELECT * FROM ${definition.table} WHERE id = ?`,
              id,
            )) ??
              fail(500, 'INTERNAL_ERROR', 'The stored order is unavailable.'),
          );
        });
      },
    );
  }

  app.get<{ Params: { id: string } }>(
    '/api/v1/listings/:id',
    async (request) => {
      valid.fields(request.query, []);
      const id = valid.uuid(request.params.id);
      await expireRecords(db, now());
      const row = await db.get<ListingRow>(
        'SELECT * FROM listings WHERE id = ?',
        id,
      );
      if (!row) fail(404, 'ORDER_NOT_FOUND', 'The listing was not found.');
      const result = await verifyRecord(definitions.listings, row);
      if (!result)
        fail(409, 'ORDER_INACTIVE', 'The listing is no longer active.');
      return result;
    },
  );

  app.patch<{ Params: { id: string } }>(
    '/api/v1/listings/:id',
    async (request) => {
      const session = await ctx.requireSession(request, true);
      valid.fields(request.query, []);
      const id = valid.uuid(request.params.id);
      const body = valid.fields(request.body, [
        'priceMicros',
        'expiresAt',
        'expectedRevision',
        'idempotencyKey',
        'kind',
        'endPriceMicros',
        'auctionEndsAt',
        'recipient',
      ]);
      const terms = listingTerms(body, session.address);
      const priceMicros = terms.startPriceMicros;
      const expiresAt = terms.expiresAt;
      const revision = body.expectedRevision;
      if (
        typeof revision !== 'number' ||
        !Number.isSafeInteger(revision) ||
        revision < 1 ||
        revision >= Number.MAX_SAFE_INTEGER
      )
        fail(
          400,
          'INVALID_REVISION',
          'The expected revision must be a positive safe integer.',
        );
      const key = valid.uuid(body.idempotencyKey, 'Idempotency key');
      const operation = 'listings.update';
      const digest = payloadHash(
        extendDigest(
          {
            id,
            priceMicros,
            expiresAt,
            expectedRevision: revision,
          },
          terms,
        ),
      );
      const retry = await cached(session.address, operation, key, digest);
      if (!retry) currentTerms(terms, now());
      await expireRecords(db, now());
      const row = await db.get<ListingRow>(
        'SELECT * FROM listings WHERE id = ?',
        id,
      );
      if (!row) fail(404, 'ORDER_NOT_FOUND', 'The listing was not found.');
      if (!valid.sameOwner(row.owner, session.address))
        fail(403, 'NOT_OWNER', 'Only the creator can update this listing.');
      if (row.status !== 'active')
        fail(409, 'ORDER_INACTIVE', 'The listing is no longer active.');
      if (!retry && row.revision !== revision)
        fail(
          409,
          'LISTING_CHANGED',
          'The listing changed. Refresh it before editing.',
        );
      const verified = await verifyRecord(definitions.listings, row);
      if (!verified)
        fail(409, 'ORDER_INACTIVE', 'The listing is no longer active.');
      return db.transaction(async () => {
        // Authentication, expiry and revision may change while ownership is read.
        await ctx.requireSession(request, true);
        await expireRecords(db, now());
        const current = await db.get<ListingRow>(
          'SELECT * FROM listings WHERE id = ?',
          id,
        );
        if (!current)
          fail(404, 'ORDER_NOT_FOUND', 'The listing was not found.');
        if (current.status !== 'active')
          fail(409, 'ORDER_INACTIVE', 'The listing is no longer active.');
        const cachedResult = await cached(
          session.address,
          operation,
          key,
          digest,
        );
        if (cachedResult) return listingSnapshot(cachedResult.response_json);
        if (current.revision !== revision)
          fail(
            409,
            'LISTING_CHANGED',
            'The listing changed. Refresh it before editing.',
          );
        const updatedAt = now();
        currentTerms(terms, updatedAt);
        const changed = (
          await db.run(
            "UPDATE listings SET price_micros = ?, expires_at = ?, position_json = ?, updated_at = ?, kind = ?, end_price_micros = ?, starts_at = ?, auction_ends_at = ?, recipient = ?, revision = revision + 1 WHERE id = ? AND status = 'active' AND revision = ?",
            priceMicros,
            expiresAt,
            JSON.stringify(verified.position),
            updatedAt,
            terms.kind,
            terms.endPriceMicros,
            updatedAt,
            terms.auctionEndsAt,
            terms.recipient,
            id,
            revision,
          )
        ).changes;
        if (!changed)
          fail(
            409,
            'LISTING_CHANGED',
            'The listing changed. Refresh it before editing.',
          );
        const result = await responseFor('listings', id);
        await saveResult(session.address, operation, key, digest, result);
        await appendAudit(
          db,
          updatedAt,
          session.address,
          'listing.updated',
          'listing',
          id,
          {
            previous: {
              priceMicros: currentAskMicros(current, updatedAt),
              expiresAt: iso(current.expires_at),
              revision: current.revision,
            },
            next: {
              priceMicros,
              expiresAt: iso(expiresAt),
              revision: result.revision,
            },
            previousTerms: listingTermsResponse(current),
            nextTerms: listingTermsResponse(
              (await db.get<ListingRow>(
                'SELECT * FROM listings WHERE id = ?',
                id,
              )) ??
                fail(500, 'INTERNAL_ERROR', 'The stored order is unavailable.'),
            ),
          },
        );
        return result;
      });
    },
  );

  app.post('/api/v1/offers', async (request) => {
    await ctx.requireSession(request, true);
    retireLending();
  });

  app.delete<{ Params: { id: string } }>(
    '/api/v1/offers/:id',
    async (request) => {
      const session = await ctx.requireSession(request, true);
      valid.fields(request.body, [], true);
      const id = valid.uuid(request.params.id);
      await expireRecords(db, now());
      const row = await db.get<OfferRow>(
        'SELECT * FROM offers WHERE id = ?',
        id,
      );
      if (!row) fail(404, 'ORDER_NOT_FOUND', 'The proposal was not found.');
      if (!valid.sameOwner(row.lender, session.address))
        fail(403, 'FORBIDDEN', 'Only the lender can cancel this proposal.');
      return db.transaction(async () => {
        await ctx.requireSession(request, true);
        const changed = (
          await db.run(
            "UPDATE offers SET status = 'cancelled', updated_at = ? WHERE id = ? AND status = 'proposed'",
            now(),
            id,
          )
        ).changes;
        if (changed)
          await appendAudit(
            db,
            now(),
            session.address,
            'offer.cancelled',
            'offer',
            id,
          );
        return responseFor('offers', id);
      });
    },
  );

  app.get<{ Params: { tokenId: string } }>(
    '/api/v1/positions/:tokenId',
    async (request) => {
      valid.fields(request.query, []);
      return freshPosition(valid.tokenId(request.params.tokenId));
    },
  );

  app.get(
    '/api/v1/account/listings',
    async (request): Promise<Page<Listing>> => {
      const session = await ctx.requireSession(request);
      const query = valid.fields(request.query, ['market', 'limit', 'cursor']);
      if (query.market !== undefined && query.market !== 'kittenswap')
        fail(400, 'INVALID_MARKET', 'KittenSwap is the only available market.');
      const limit = valid.limit(query.limit);
      const filters = payloadHash({
        scope: 'creator-active-listings',
        market: 'kittenswap',
        owner: session.address.toLowerCase(),
      });
      const cursor = decodeCursor(query.cursor, filters);
      await expireRecords(db, now());
      const rows = await db.all<ListingRow>(
        "SELECT * FROM listings WHERE owner = ? AND market = 'kittenswap' AND status = 'active' AND (created_at < ? OR (created_at = ? AND id < ?)) ORDER BY created_at DESC, id DESC LIMIT ?",
        session.address,
        cursor.time,
        cursor.time,
        cursor.id,
        limit + 1,
      );
      const pageRows = rows.slice(0, limit);
      // Creator management uses saved metadata, never a public ownership proof.
      // Harmless cancellation must remain reachable during chain outages.
      return {
        items: pageRows.map((row) => orderResponse(row)),
        nextCursor:
          rows.length > limit
            ? encodeCursor(pageRows[limit - 1], filters)
            : null,
      };
    },
  );

  app.get('/api/v1/account', async (request): Promise<Account> => {
    const session = await ctx.requireSession(request);
    const query = valid.fields(request.query, ['positionsCursor', 'limit']);
    const limit = valid.limit(query.limit);
    const positionsCursor = query.positionsCursor;
    if (
      positionsCursor !== undefined &&
      (typeof positionsCursor !== 'string' || positionsCursor.length > 1024)
    )
      fail(400, 'INVALID_PAGINATION', 'The ownership cursor is invalid.');
    let positionsUnavailable = false;
    let owned: Page<Position> = { items: [], nextCursor: null };
    try {
      owned = await chainCall(() =>
        chain.getOwnedPositions(session.address, {
          ...(positionsCursor === undefined ? {} : { cursor: positionsCursor }),
          limit,
        }),
      );
      if (
        !owned ||
        !Array.isArray(owned.items) ||
        owned.items.length > limit ||
        owned.items.some(
          (position) => !valid.sameOwner(position.owner, session.address),
        )
      )
        fail(
          503,
          'CHAIN_UNAVAILABLE',
          'Confirmed position data is unavailable.',
        );
      owned.items = owned.items.map((position) =>
        ctx.checkPosition(position, position.tokenId),
      );
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 503) throw error;
      positionsUnavailable = true;
      owned = { items: [], nextCursor: null };
    }
    await expireRecords(db, now());
    const results: { listings: Listing[]; 'loan-requests': LoanRequest[] } = {
      listings: [],
      'loan-requests': [],
    };
    let historyTruncated = false;
    const verifiedRequests = new Set<string>();
    for (const [path, definition] of Object.entries(definitions) as [
      keyof typeof definitions,
      Definition,
    ][]) {
      const allRows = await db.all<OrderRow>(
        `SELECT * FROM ${definition.table} WHERE owner = ? ORDER BY created_at DESC, id DESC LIMIT 501`,
        session.address,
      );
      historyTruncated ||= allRows.length > 500;
      const rows = allRows.slice(0, 500);
      const activeRows = rows.filter((row) => row.status === 'active');
      let fresh: (Position | null)[] = [];
      if (!positionsUnavailable)
        try {
          fresh = await ctx.freshPositions(
            activeRows.map((row) => row.token_id),
          );
        } catch (error) {
          if (!(error instanceof ApiError) || error.status !== 503) throw error;
          positionsUnavailable = true;
        }
      const positions = new Map(
        activeRows.map((row, index) => [row.id, fresh[index]]),
      );
      const items: OrderDTO[] = [];
      for (const row of rows) {
        if (row.status === 'active' && !positionsUnavailable) {
          items.push(
            (await verifyRecord(definition, row, positions.get(row.id))) ??
              (await responseFor(definition.table, row.id)),
          );
          if (definition.table === 'loan_requests')
            verifiedRequests.add(row.id);
        } else items.push(orderResponse(row));
      }
      if (path === 'listings')
        results.listings = items.map((item) => {
          if (!('priceMicros' in item))
            fail(500, 'INTERNAL_ERROR', 'The stored listing is unavailable.');
          return item;
        });
      else
        results['loan-requests'] = items.map((item) => {
          if (!('principalMicros' in item))
            fail(500, 'INTERNAL_ERROR', 'The stored request is unavailable.');
          return item;
        });
    }
    const allOffers = await db.all<OfferRow>(
      'SELECT * FROM offers WHERE lender = ? ORDER BY created_at DESC, id DESC LIMIT 501',
      session.address,
    );
    historyTruncated ||= allOffers.length > 500;
    const offers = allOffers.slice(0, 500);
    const allReceived = await db.all<OfferRow>(
      'SELECT o.* FROM offers o JOIN loan_requests r ON r.id = o.request_id WHERE r.owner = ? ORDER BY o.created_at DESC, o.id DESC LIMIT 501',
      session.address,
    );
    historyTruncated ||= allReceived.length > 500;
    const received = allReceived.slice(0, 500);
    const requestRows: LoanRequestRow[] = [];
    for (const offer of [...offers, ...received])
      if (
        offer.status === 'proposed' &&
        !verifiedRequests.has(offer.request_id)
      ) {
        verifiedRequests.add(offer.request_id);
        const borrowing = await db.get<LoanRequestRow>(
          'SELECT * FROM loan_requests WHERE id = ?',
          offer.request_id,
        );
        if (borrowing?.status === 'active') requestRows.push(borrowing);
      }
    if (!positionsUnavailable)
      try {
        const fresh = await ctx.freshPositions(
          requestRows.map((row) => row.token_id),
        );
        for (const [index, row] of requestRows.entries())
          await verifyRecord(definitions['loan-requests'], row, fresh[index]);
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 503) throw error;
        positionsUnavailable = true;
      }
    return {
      address: session.address,
      positions: positionsUnavailable ? [] : owned.items,
      nextPositionsCursor: positionsUnavailable
        ? null
        : (owned.nextCursor ?? null),
      listings: results.listings,
      loanRequests: results['loan-requests'],
      offers: await Promise.all(
        offers.map((row) => responseFor('offers', row.id)),
      ),
      receivedOffers: await Promise.all(
        received.map((row) => responseFor('offers', row.id)),
      ),
      historyTruncated,
      positionsUnavailable,
    };
  });
}

function lendingTable(
  definition: Definition,
): definition is (typeof definitions)['loan-requests'] {
  return definition.table === 'loan_requests';
}
