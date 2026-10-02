# Application API

The application service serves the production frontend and `/api/v1` on one origin. GitHub Pages remains a separate, clearly labelled interactive preview. Set `VITE_APP_MODE=connected` when building for the application service; `VITE_API_BASE` is empty for same-origin deployment. No service failure may silently substitute demo data.

## Scope

Wallet-authenticated, durable off-chain marketplace listings are supported. Positions are read from the canonical KittenSwap escrow on HyperEVM (chain 999). Listing a position does not transfer custody. The lending product is a shared USDC vault and revenue-backed collateral credit line; it has not been deployed. Contract-dependent purchases, borrowing, supply, withdrawal, repayment, reward claims and token approvals are disabled. No backend private key or transaction signer exists.

Amounts are unsigned decimal **strings of raw units**, never JSON floating-point money: USDC has six decimals; KITTEN has eighteen. Token IDs are canonical decimal uint256 strings. Dates are UTC ISO strings. All exposed records carry their market and status; browser-local preview receipts are never imported as real orders or ownership.

## Common responses

Errors use `{ "error": { "code": "...", "message": "...", "requestId": "..." } }`. Do not expose database errors, stack traces, RPC credentials or session tokens. List responses are `{ "items": [], "nextCursor": null }`; cursors are opaque and input-validated. Default limit is 24, maximum 50.

`GET /status` returns `{ mode: "connected", chainId: 999, marketId: "kittenswap", settlementEnabled: false, capabilities: { walletSignIn: true, marketplace: true, lending: false, settlement: false } }`. Chain health may be included separately without making an unhealthy service appear ready. `/health/live` is process liveness; `/health/ready` checks database and chain readiness.

`GET /markets` returns `{ markets: [...] }`. The sole market is KittenSwap, using the same identity and light-green accent as `src/markets.ts`.

## Authentication

- `POST /auth/challenge`: `{ address, chainId: 999 }` → `{ challengeId, message, expiresAt }`. The server constructs an ERC-4361 message for its configured origin, address and chain, with a cryptographic nonce and five-minute expiration.
- `POST /auth/verify`: `{ challengeId, signature }` → session below. The signature must match the exact issued message and address. A challenge is single-use, including under concurrent verification. EOA wallets are supported; contract-wallet signatures must fail clearly rather than be treated as verified EOAs.
- `GET /auth/session` → `{ address, chainId: 999, csrfToken, expiresAt }`, or 401.
- `POST /auth/logout` → `{ ok: true }`; revoke the session and clear its cookie.

The session is an opaque random token in an HttpOnly, SameSite=Strict cookie, Secure in production. Persist only a hash of the session token. Clients send `credentials: "include"`. All unsafe requests must have the exact configured `Origin`; authenticated mutations also require `X-CSRF-Token` from the session response. Secrets stay out of local storage and logs. Authentication requests are rate limited.

## Position data

`GET /positions/:tokenId` → `Position`. Each read verifies ownership and locked state at a coherent, confirmed block. No invented price, APR, reward estimate or collateral valuation is returned.

```text
Position {
  id: "kittenswap-" + tokenId,
  tokenId, marketId: "kittenswap", owner,
  lockedAmountRaw, lockedUntil, votingPowerRaw,
  blockNumber: integer, blockHash, observedAt
}
```

`GET /account` requires a session and returns `{ address, positions: Position[], nextPositionsCursor, listings: Listing[], loanRequests: LoanRequest[], offers: Offer[], receivedOffers: Offer[], positionsUnavailable: boolean, historyTruncated: boolean }`. `offers` are sent by the account; `receivedOffers` belong to requests created by it. Other accounts cannot read this private offer history. Each history is limited to its latest 500 records, with truncation indicated. Optional `positionsCursor` and `limit` paginate ownership enumeration. Positions use short-lived block-pinned cursors; an expired cursor requires an account refresh. RPC failure returns empty positions and `positionsUnavailable: true` while retaining explicitly historical off-chain records for cancellation. Public actionable records never use this stale-history fallback.

## Marketplace

- `GET /account/listings?market=kittenswap&limit=24&cursor=...` requires a session and returns the creator's active, unexpired saved listings independently of the capped account history. Default limit is 24, maximum 50; signed keyset cursors are bound to the creator, market and this route's scope. It makes no chain read and remains available during RPC outages. Position metadata reflects its last observed block, not fresh ownership verification. This is a private management view; public listings and edits retain their fresh ownership checks.
- `GET /listings?market=kittenswap&limit=24&cursor=...` → active, unexpired, freshly ownership-verified `Listing` records. Ownership movement invalidates an off-chain listing. An RPC failure is an unavailable response, not a false claim that there are no listings.
- `GET /listings/:id` → a fresh active listing; expired or invalidated records return 409, and chain outages return 503.
- `POST /listings`: `{ tokenId, priceMicros, expiresAt, idempotencyKey, kind?, endPriceMicros?, auctionEndsAt?, recipient? }` → `Listing`.
- `PATCH /listings/:id`: `{ priceMicros, expiresAt, expectedRevision, idempotencyKey, kind?, endPriceMicros?, auctionEndsAt?, recipient? }` → updated `Listing`. The creator must still own the position. A concurrent revision change returns 409 `LISTING_CHANGED`.
- `DELETE /listings/:id` → cancelled `Listing`, including during a chain outage.

```text
Listing {
  id, marketId: "kittenswap", tokenId, owner, priceMicros,
  kind: "fixed" | "dutch", startPriceMicros, endPriceMicros,
  startsAt, auctionEndsAt: ISO | null, recipient: address | null,
  status: "active" | "cancelled" | "expired" | "invalidated",
  expiresAt, createdAt, updatedAt, revision: positive integer, position: Position
}
```

Creation and edits replace the complete terms. Omitted kind means fixed, omitted floor equals the starting ask, and omitted auction end/recipient are null. A Dutch listing requires an explicit floor and auction end; it decays cubically using 1e18 staged integer floors, then holds its floor until expiry. `startsAt` is server-owned and resets on repricing. `priceMicros` in a response is the current ask; input `priceMicros` is the starting ask. Prices range from 1 to 1,000,000 USDC. A reserved buyer must be valid, nonzero and different from the seller. Reservations are public intent, not privacy or funded execution.

Optional `seller`, `tokenId`, `minPriceMicros` and `maxPriceMicros` filters use exact raw amounts. Pagination cursors are bound to normalized query filters. Current-price filtering scans at most 150 newest records per request and advances over unmatched rows; an empty page can still carry a next cursor. Status changes and edits advance the listing revision.

Creation verifies that the authenticated address currently owns the NFT. At most one active listing exists per NFT. Only its creator can cancel a listing. An ownership transfer never gives a new owner authority to edit the previous owner's off-chain intent. Cancellation does not need a chain transaction.

## Lending

`GET /lending` is public and accepts no query fields. It returns:

```json
{
  "model": "pooled-revenue",
  "state": "not-deployed",
  "marketId": "kittenswap",
  "asset": "USDC",
  "chainId": 999,
  "vaultAddress": null,
  "portfolioAddress": null,
  "accounting": null,
  "terms": null,
  "executionEnabled": false
}
```

Unknown accounting is `null`, not a zero balance. Wallet ownership does not imply deposited collateral, approved credit or vault shares. The client rejects an enabled or fabricated deployment response.

`POST /lending/actions` requires the same exact Origin, session and CSRF protections as other authenticated mutations. It always rejects with HTTP 503 `SMART_CONTRACTS_DISABLED`, creates no record and makes no chain call.

### Historical lending intents

`GET /loan-requests`, `POST /loan-requests` and `POST /offers` return HTTP 410 `LEGACY_LENDING_RETIRED`. Creation still requires Origin/session/CSRF; there is no new request/offer matching product. Existing data is not deleted or converted into balances.

`GET /account` retains its bounded private `loanRequests`, `offers` and `receivedOffers` collections for history. Historical records retain their original principal, APR/duration and explicit status; those fields are not terms of the pooled product. The UI labels them as previous unfunded records.

- `DELETE /loan-requests/:id` cancels a request owned by the caller and invalidates its outstanding offers.
- `DELETE /offers/:id` cancels an offer created by the caller.

Cancellation remains possible during RPC outages and never transfers assets. Another owner/lender cannot cancel the record. Account histories remain session-protected and preserve their privacy boundaries.

## Mutation reliability

Create and edit requests carry a UUID `idempotencyKey`. Scope keys by authenticated account and operation; store a canonical request hash and result in the same transaction as the mutation. Repeating the same key and payload returns the original result; reusing a key for another payload returns 409. Authentication, ownership and state checks remain enforced. Concurrent active-order creation must be protected by database constraints. Append an audit event without secrets for every state change.

Unknown JSON fields, invalid addresses, malformed IDs, unsafe integers, oversized bodies and invalid dates are rejected. Clients must handle rejection, expired sessions, unavailable chain reads, user-rejected signatures, wallet/account changes and cancelled requests.

## Settlement boundary

`POST /settlement` always returns HTTP 503, code `SMART_CONTRACTS_DISABLED`. The response must not contain transaction calldata, approvals, a signer, a success receipt or a synthetic funded balance. Marketplace reviews retain the future 0.5% seller-fee basis. The pooled lending endpoint has no configured fee terms until a compatible contract release; its null terms must not be replaced with another protocol’s schedule. See [lending semantics](LENDING.md).
