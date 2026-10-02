import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { appendAudit, expireRecords, invalidateOffers } from './database.mjs';
import { fail } from './errors.mjs';
import * as valid from './validation.mjs';

const iso = (time) => new Date(time).toISOString();
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
};

function orderResponse(row, position = JSON.parse(row.position_json)) {
  const result = {
    id: row.id,
    marketId: row.market,
    tokenId: row.token_id,
    owner: row.owner,
    status: row.status,
    expiresAt: iso(row.expires_at),
    createdAt: iso(row.created_at),
    position,
  };
  if (row.price_micros !== undefined) result.priceMicros = row.price_micros;
  else
    Object.assign(result, {
      principalMicros: row.principal_micros,
      aprBps: row.apr_bps,
      durationDays: row.duration_days,
    });
  return result;
}

function offerResponse(row) {
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

function loanEligible(position, days, now) {
  try {
    return (
      BigInt(position.lockedAmountRaw) > 0n &&
      Date.parse(position.lockedUntil) >= now + days * 86400000
    );
  } catch {
    return false;
  }
}

export function registerOrders(app, ctx) {
  const { db, now, hash, freshPosition, chainCall, chain } = ctx;
  const retireLending = () =>
    fail(
      410,
      'LEGACY_LENDING_RETIRED',
      'Lending requests and offers are retired. Historical intents remain available for cancellation.',
    );
  const responseFor = (table, id) => {
    const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
    return (
      row && (table === 'offers' ? offerResponse(row) : orderResponse(row))
    );
  };
  const invalidate = (definition, row, reason) =>
    db.transaction(() => {
      const changes = db
        .prepare(
          `UPDATE ${definition.table} SET status = 'invalidated', updated_at = ? WHERE id = ? AND status = 'active'`,
        )
        .run(now(), row.id).changes;
      if (changes) {
        appendAudit(
          db,
          now(),
          null,
          `${definition.kind}.invalidated`,
          definition.kind,
          row.id,
          { reason },
        );
        if (definition.table === 'loan_requests')
          invalidateOffers(db, row.id, now());
      }
    })();

  async function verifyRecord(definition, row, suppliedPosition = undefined) {
    if (!row || row.status !== 'active') return null;
    let position;
    try {
      if (suppliedPosition === null) {
        invalidate(definition, row, 'position_missing');
        return null;
      }
      position = suppliedPosition ?? (await freshPosition(row.token_id));
    } catch (error) {
      if (error.code !== 'POSITION_NOT_FOUND') throw error;
      invalidate(definition, row, 'position_missing');
      return null;
    }
    if (
      !valid.sameOwner(position.owner, row.owner) ||
      (definition.table === 'loan_requests' &&
        !loanEligible(position, row.duration_days, now()))
    ) {
      invalidate(definition, row, 'ownership_or_lock_changed');
      return null;
    }
    expireRecords(db, now());
    const current = db
      .prepare(`SELECT * FROM ${definition.table} WHERE id = ?`)
      .get(row.id);
    return current?.status === 'active'
      ? orderResponse(current, position)
      : null;
  }

  function cached(actor, operation, key, payloadHash) {
    const row = db
      .prepare(
        'SELECT * FROM idempotency WHERE actor = ? AND operation = ? AND key = ?',
      )
      .get(actor, operation, key);
    if (row && row.payload_hash !== payloadHash)
      fail(
        409,
        'IDEMPOTENCY_CONFLICT',
        'This idempotency key was used with another request.',
      );
    return row;
  }
  function saveResult(actor, operation, key, payloadHash, result) {
    db.prepare(
      'INSERT INTO idempotency(actor,operation,key,payload_hash,entity_id,response_json,created_at) VALUES (?,?,?,?,?,?,?)',
    ).run(
      actor,
      operation,
      key,
      payloadHash,
      result.id,
      JSON.stringify(result),
      now(),
    );
  }
  function payloadHash(value) {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }
  function encodeCursor(row) {
    const payload = Buffer.from(
      JSON.stringify({ time: row.created_at, id: row.id }),
    ).toString('base64url');
    return `${payload}.${hash(`cursor:${payload}`)}`;
  }
  function decodeCursor(value) {
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
        Buffer.from(hash(`cursor:${payload}`), 'hex'),
      )
    )
      fail(400, 'INVALID_PAGINATION', 'The pagination cursor is invalid.');
    let decoded;
    try {
      decoded = JSON.parse(Buffer.from(payload, 'base64url').toString());
    } catch {
      fail(400, 'INVALID_PAGINATION', 'The pagination cursor is invalid.');
    }
    valid.fields(decoded, ['time', 'id']);
    if (!Number.isSafeInteger(decoded.time) || decoded.time < 0)
      fail(400, 'INVALID_PAGINATION', 'The pagination cursor is invalid.');
    valid.uuid(decoded.id);
    return decoded;
  }

  for (const [path, definition] of Object.entries(definitions)) {
    app.get(`/api/v1/${path}`, async (request) => {
      if (lendingTable(definition)) retireLending();
      const query = valid.fields(request.query, ['market', 'limit', 'cursor']);
      if (query.market !== undefined && query.market !== 'kittenswap')
        fail(400, 'INVALID_MARKET', 'KittenSwap is the only available market.');
      const limit = valid.limit(query.limit);
      let cursor = decodeCursor(query.cursor);
      expireRecords(db, now());
      const items = [];
      let scanned = 0;
      let last;
      let more = false;
      while (items.length <= limit && scanned < 150) {
        const rows = db
          .prepare(
            `SELECT * FROM ${definition.table} WHERE status = 'active' AND (created_at < ? OR (created_at = ? AND id < ?)) ORDER BY created_at DESC, id DESC LIMIT ?`,
          )
          .all(cursor.time, cursor.time, cursor.id, limit + 1);
        if (!rows.length) {
          more = false;
          break;
        }
        const positions = await ctx.freshPositions(
          rows.map((row) => row.token_id),
        );
        for (const [index, row] of rows.entries()) {
          last = row;
          scanned++;
          const verified = await verifyRecord(
            definition,
            row,
            positions[index],
          );
          if (verified) items.push({ row, value: verified });
          if (items.length > limit || scanned >= 150) break;
        }
        more = rows.length === limit + 1;
        if (items.length > limit || !more || scanned >= 150) break;
        cursor = { time: last.created_at, id: last.id };
      }
      return {
        items: items.slice(0, limit).map((item) => item.value),
        nextCursor:
          items.length > limit
            ? encodeCursor(items[limit - 1].row)
            : more && last
              ? encodeCursor(last)
              : null,
      };
    });

    app.post(`/api/v1/${path}`, async (request) => {
      const session = ctx.requireSession(request, true);
      if (lendingTable(definition)) retireLending();
      const body = valid.fields(request.body, [
        'tokenId',
        definition.amount,
        'expiresAt',
        'idempotencyKey',
      ]);
      const tokenId = valid.tokenId(body.tokenId);
      const amount = valid.money(body[definition.amount]);
      const expiresAt = valid.expiry(body.expiresAt, now());
      const key = valid.uuid(body.idempotencyKey, 'Idempotency key');
      // Keep the original listing digest shape for durable idempotency retries.
      const digest = payloadHash({
        tokenId,
        amount,
        expiresAt,
        apr: null,
        days: null,
      });
      cached(session.address, path, key, digest);
      const position = await freshPosition(tokenId);
      if (!valid.sameOwner(position.owner, session.address)) {
        const previous = db
          .prepare(
            `SELECT * FROM ${definition.table} WHERE token_id = ? AND status = 'active'`,
          )
          .get(tokenId);
        if (previous && !valid.sameOwner(position.owner, previous.owner))
          invalidate(definition, previous, 'ownership_changed');
        fail(
          403,
          'NOT_OWNER',
          'The signed-in account must currently own this position.',
        );
      }
      return db.transaction(() => {
        if (expiresAt <= now())
          fail(400, 'INVALID_EXPIRY', 'Expiry must still be in the future.');
        expireRecords(db, now());
        const retry = cached(session.address, path, key, digest);
        if (retry) {
          const current = db
            .prepare(`SELECT status FROM ${definition.table} WHERE id = ?`)
            .get(retry.entity_id);
          if (current?.status !== 'active')
            fail(
              409,
              'ORDER_INACTIVE',
              'The original order is no longer active.',
            );
          return JSON.parse(retry.response_json);
        }
        const prior = db
          .prepare(
            `SELECT * FROM ${definition.table} WHERE token_id = ? AND status = 'active'`,
          )
          .get(tokenId);
        if (prior && !valid.sameOwner(prior.owner, position.owner))
          invalidate(definition, prior, 'ownership_changed');
        else if (prior)
          fail(
            409,
            'ACTIVE_ORDER_EXISTS',
            'An active order already exists for this position.',
          );
        const id = randomUUID();
        const createdAt = now();
        db.prepare(
          "INSERT INTO listings(id,market,token_id,owner,price_micros,expires_at,created_at,updated_at,status,position_json) VALUES (?,'kittenswap',?,?,?,?,?,?, 'active',?)",
        ).run(
          id,
          tokenId,
          session.address,
          amount,
          expiresAt,
          createdAt,
          createdAt,
          JSON.stringify(position),
        );
        const result = responseFor(definition.table, id);
        saveResult(session.address, path, key, digest, result);
        appendAudit(
          db,
          createdAt,
          session.address,
          `${definition.kind}.created`,
          definition.kind,
          id,
          { tokenId, marketId: 'kittenswap' },
        );
        return result;
      })();
    });

    app.delete(`/api/v1/${path}/:id`, async (request) => {
      const session = ctx.requireSession(request, true);
      valid.fields(request.body, [], true);
      const id = valid.uuid(request.params.id);
      expireRecords(db, now());
      const row = db
        .prepare(`SELECT * FROM ${definition.table} WHERE id = ?`)
        .get(id);
      if (!row) fail(404, 'ORDER_NOT_FOUND', 'The order was not found.');
      if (!valid.sameOwner(row.owner, session.address))
        fail(403, 'FORBIDDEN', 'Only the creator can cancel this order.');
      // Withdrawing off-chain intent cannot move funds or custody and must remain
      // available during an RPC outage. Creator authority never follows an NFT.
      return db.transaction(() => {
        const changes = db
          .prepare(
            `UPDATE ${definition.table} SET status = 'cancelled', updated_at = ? WHERE id = ? AND status = 'active'`,
          )
          .run(now(), id).changes;
        if (changes) {
          appendAudit(
            db,
            now(),
            session.address,
            `${definition.kind}.cancelled`,
            definition.kind,
            id,
          );
          if (lendingTable(definition))
            invalidateOffers(db, id, now(), session.address);
        }
        return orderResponse(
          db.prepare(`SELECT * FROM ${definition.table} WHERE id = ?`).get(id),
        );
      })();
    });
  }

  app.post('/api/v1/offers', async (request) => {
    ctx.requireSession(request, true);
    retireLending();
  });

  app.delete('/api/v1/offers/:id', async (request) => {
    const session = ctx.requireSession(request, true);
    valid.fields(request.body, [], true);
    const id = valid.uuid(request.params.id);
    expireRecords(db, now());
    const row = db.prepare('SELECT * FROM offers WHERE id = ?').get(id);
    if (!row) fail(404, 'ORDER_NOT_FOUND', 'The proposal was not found.');
    if (!valid.sameOwner(row.lender, session.address))
      fail(403, 'FORBIDDEN', 'Only the lender can cancel this proposal.');
    return db.transaction(() => {
      const changed = db
        .prepare(
          "UPDATE offers SET status = 'cancelled', updated_at = ? WHERE id = ? AND status = 'proposed'",
        )
        .run(now(), id).changes;
      if (changed)
        appendAudit(db, now(), session.address, 'offer.cancelled', 'offer', id);
      return responseFor('offers', id);
    })();
  });

  app.get('/api/v1/positions/:tokenId', async (request) => {
    valid.fields(request.query, []);
    return freshPosition(valid.tokenId(request.params.tokenId));
  });

  app.get('/api/v1/account', async (request) => {
    const session = ctx.requireSession(request);
    const query = valid.fields(request.query, ['positionsCursor', 'limit']);
    const limit = valid.limit(query.limit);
    if (
      query.positionsCursor !== undefined &&
      (typeof query.positionsCursor !== 'string' ||
        query.positionsCursor.length > 1024)
    )
      fail(400, 'INVALID_PAGINATION', 'The ownership cursor is invalid.');
    let positionsUnavailable = false;
    let owned = { items: [], nextCursor: null };
    try {
      owned = await chainCall(() =>
        chain.getOwnedPositions(session.address, {
          cursor: query.positionsCursor,
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
      if (error.status !== 503) throw error;
      positionsUnavailable = true;
      owned = { items: [], nextCursor: null };
    }
    expireRecords(db, now());
    const results = {};
    let historyTruncated = false;
    const verifiedRequests = new Set();
    for (const [path, definition] of Object.entries(definitions)) {
      const allRows = db
        .prepare(
          `SELECT * FROM ${definition.table} WHERE owner = ? ORDER BY created_at DESC, id DESC LIMIT 501`,
        )
        .all(session.address);
      historyTruncated ||= allRows.length > 500;
      const rows = allRows.slice(0, 500);
      const activeRows = rows.filter((row) => row.status === 'active');
      let fresh = [];
      if (!positionsUnavailable)
        try {
          fresh = await ctx.freshPositions(
            activeRows.map((row) => row.token_id),
          );
        } catch (error) {
          if (error.status !== 503) throw error;
          positionsUnavailable = true;
        }
      const positions = new Map(
        activeRows.map((row, index) => [row.id, fresh[index]]),
      );
      const items = [];
      for (const row of rows) {
        if (row.status === 'active' && !positionsUnavailable) {
          items.push(
            (await verifyRecord(definition, row, positions.get(row.id))) ??
              responseFor(definition.table, row.id),
          );
          if (definition.table === 'loan_requests')
            verifiedRequests.add(row.id);
        } else items.push(orderResponse(row));
      }
      results[path] = items;
    }
    const allOffers = db
      .prepare(
        'SELECT * FROM offers WHERE lender = ? ORDER BY created_at DESC, id DESC LIMIT 501',
      )
      .all(session.address);
    historyTruncated ||= allOffers.length > 500;
    const offers = allOffers.slice(0, 500);
    const allReceived = db
      .prepare(
        'SELECT o.* FROM offers o JOIN loan_requests r ON r.id = o.request_id WHERE r.owner = ? ORDER BY o.created_at DESC, o.id DESC LIMIT 501',
      )
      .all(session.address);
    historyTruncated ||= allReceived.length > 500;
    const received = allReceived.slice(0, 500);
    const requestRows = [];
    for (const offer of [...offers, ...received])
      if (
        offer.status === 'proposed' &&
        !verifiedRequests.has(offer.request_id)
      ) {
        verifiedRequests.add(offer.request_id);
        const borrowing = db
          .prepare('SELECT * FROM loan_requests WHERE id = ?')
          .get(offer.request_id);
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
        if (error.status !== 503) throw error;
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
      offers: offers.map((row) => responseFor('offers', row.id)),
      receivedOffers: received.map((row) => responseFor('offers', row.id)),
      historyTruncated,
      positionsUnavailable,
    };
  });
}

function lendingTable(definition) {
  return definition.table === 'loan_requests';
}
