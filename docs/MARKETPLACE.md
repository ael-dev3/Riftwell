# Marketplace

The marketplace opens on the listings table. All listings, My listings and History share one compact surface. List yours starts with an owned-position picker; Buy and sweep reviews show the exact selected NFTs and costs. Price, locked balance, unlock date and unit price stay visible together.

## Preview

The preview supports fixed-price listings and Dutch auctions with cubic premium decay. Auctions reach their floor at a separate auction end and remain at that floor until listing expiry. An optional reserved-buyer address limits a preview purchase to that account; this is not a privacy feature.

List, edit, cancel, buy and sweep update a browser-local ledger. Each quote carries a revision and maximum accepted price. A sweep is all-or-nothing in this preview: the entire selection must pass ownership, reservation, expiry, price, duplicate and balance checks before any state changes. Seller proceeds and fees are conserved in exact integer USDC units. The marketplace's demo balance is separate from the lending simulation.

Historical sample purchases are migrated once into owned positions. Saved state is validated before use. Reset restores illustrative balances and positions, without touching any real asset.

## Connected mode

Public listings use confirmed ownership reads. Fixed and cubic Dutch terms, separate auction/expiry dates and public reserved-buyer intent are stored durably. Server time controls the current ask; filters compare the current price rather than the starting price. Creator management uses wallet authentication, exact Origin and CSRF checks, atomic revision checks and durable idempotency. Editing never gives a new NFT owner authority over a previous seller's intent. Cancellation remains possible during RPC outages. Purchase reviews re-fetch every listing rather than trusting an old table row.

An off-chain listing does not escrow, approve or transfer an NFT. No purchase or sweep can settle until compatible marketplace contracts are separately released. The client does not ask for approvals or send transactions.

## Prices and fees

USDC is the selected quote unit. Unit prices derive from the ask and locked KITTEN amount. Preview reference comparisons are explicitly illustrative. Connected mode has no verified market-price feed, so it does not invent discounts, valuations, sale volumes or APR.

Riftwell's configured seller fee is 0.5% of each settled sale. It is disclosed in listing and purchase review, with the seller's proceeds. The preview applies it to its local ledger; no real fee is charged. Future contract parameters must match before settlement is enabled.

## Release checks

Future execution must bind a quote to its collection, token, seller, currency, nonce, expiry and current contract configuration; check ownership, approval and transfer restrictions at a coherent block; and simulate before presenting a wallet request. Multi-purchase receipts must be reconciled item by item. An indexer's flags are not proof that a listing is currently executable.
