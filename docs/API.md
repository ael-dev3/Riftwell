# Application API

The application service serves the production frontend and `/api/v1` on one origin. GitHub Pages remains a separate, clearly labelled interactive preview. Set `VITE_APP_MODE=connected` when building for the application service; `VITE_API_BASE` is empty for same-origin deployment. No service failure may silently substitute demo data.

## Scope

Wallet-authenticated, durable off-chain marketplace listings, borrowing requests and lending proposals are supported. Positions are read from the canonical KittenSwap escrow on HyperEVM (chain 999). Listing a position does not transfer custody. Proposals are unfunded until a future reviewed settlement integration exists. Contract-dependent purchases, funded loans, repayment, reward claims and token approvals are disabled. No backend private key or transaction signer exists.

Amounts are unsigned decimal **strings of raw units**, never JSON floating-point money: USDC has six decimals; KITTEN has eighteen. Token IDs are canonical decimal uint256 strings. Dates are UTC ISO strings. All exposed records carry their market and status; browser-local preview receipts are never imported as real orders or ownership.

## Common responses

Errors use `{ "error": { "code": "...", "message": "...", "requestId": "..." } }`. Do not expose database errors, stack traces, RPC credentials or session tokens. List responses are `{ "items": [], "nextCursor": null }`; cursors are opaque and input-validated. Default limit is 24, maximum 50.

`GET /status` returns `{ mode: "connected", chainId: 999, marketId: "kittenswap", settlementEnabled: false, capabilities: { walletSignIn: true, marketplace: true, lending: true, settlement: false } }`. Chain health may be included separately without making an unhealthy service appear ready. `/health/live` is process liveness; `/health/ready` checks database and chain readiness.

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

- `GET /listings?market=kittenswap&limit=24&cursor=...` → active, unexpired, freshly ownership-verified `Listing` records. Ownership movement invalidates an off-chain listing. An RPC failure is an unavailable response, not a false claim that there are no listings.
- `POST /listings`: `{ tokenId, priceMicros, expiresAt, idempotencyKey }` → `Listing`.
- `DELETE /listings/:id` → cancelled `Listing`.

```text
Listing {
  id, marketId: "kittenswap", tokenId, owner, priceMicros,
  status: "active" | "cancelled" | "expired" | "invalidated",
  expiresAt, createdAt, position: Position
}
```

Creation verifies that the authenticated address currently owns the NFT. At most one active listing exists per NFT. Only its creator can cancel a listing. An ownership transfer never gives a new owner authority to edit the previous owner's off-chain intent. Cancellation does not need a chain transaction.

## Lending

- `GET /loan-requests?market=kittenswap&limit=24&cursor=...` → active, unexpired, ownership-verified `LoanRequest` records.
- `POST /loan-requests`: `{ tokenId, principalMicros, aprBps, durationDays, expiresAt, idempotencyKey }` → `LoanRequest`.
- `DELETE /loan-requests/:id` → cancelled `LoanRequest`.
- `POST /offers`: `{ requestId, principalMicros, aprBps, durationDays, expiresAt, idempotencyKey }` → `Offer`.
- `DELETE /offers/:id` → cancelled `Offer`.

```text
LoanRequest {
  id, marketId: "kittenswap", tokenId, owner, principalMicros,
  aprBps: integer, durationDays: integer,
  status: "active" | "cancelled" | "expired" | "invalidated",
  expiresAt, createdAt, position: Position
}
Offer {
  id, requestId, lender, principalMicros, aprBps: integer,
  durationDays: integer,
  status: "proposed" | "cancelled" | "expired" | "invalidated",
  expiresAt, createdAt
}
```

Requests and offers are expressly unfunded. Ownership does not establish collateral eligibility or a safe borrowing capacity. The service does not invent an LTV oracle. Supported durations are 7, 14 and 30 days; APR is 100–4,000 basis points. Principal/ask minimum is 1 USDC; maximum is 1,000,000 USDC. Orders expire within 30 days; offers cannot outlive their request and cannot be made by the borrower. A cancelled, expired or invalidated request invalidates its outstanding offers.

An offer must match its request's principal and duration and cannot exceed the requested APR. Only the lender can cancel its offer. Creators can cancel their off-chain records without a working RPC connection; cancellation never moves assets.

## Mutation reliability

Create requests carry a UUID `idempotencyKey`. Scope keys by authenticated account and operation; store a canonical request hash and result in the same transaction as the mutation. Repeating the same key and payload returns the original result; reusing a key for another payload returns 409. Authentication, ownership and state checks remain enforced. Concurrent active-order creation must be protected by database constraints. Append an audit event without secrets for every state change.

Unknown JSON fields, invalid addresses, malformed IDs, unsafe integers, oversized bodies and invalid dates are rejected. Clients must handle rejection, expired sessions, unavailable chain reads, user-rejected signatures, wallet/account changes and cancelled requests.

## Settlement boundary

`POST /settlement` always returns HTTP 503, code `SMART_CONTRACTS_DISABLED`. The response must not contain transaction calldata, approvals, a signer, a success receipt or a synthetic funded balance. Marketplace seller fees remain 0.5% of sale price; borrower origination fees remain a one-time 0.5% of principal. These are review terms for the future settlement path, separate from lender interest, and are not charged by an off-chain listing or proposal.
