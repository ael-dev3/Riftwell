# Read-only Riftwell order and loan index

The event indexer is an original local/fork foundation for `RiftwellMarket`, with an optional `RiftwellLoans` source in the same canonical snapshot. It does not invent a Riftwell mainnet deployment. The default interface remains unconfigured, and its example cards stay fictional.

## What it does

- Requires a known chain, market, collection, payment token, deployment block/hash, exact market runtime-code hash and compiled ABI.
- Verifies chain ID, deployment anchor, bytecode, immutable collection/payment token, token decimals and the market's 50-basis-point fee before publishing a snapshot.
- Decodes `Listed`, `ListingCancelled`, `SellerListingsInvalidated` and `Purchased` from the market address. Amounts are decimal integer strings in payment-token atomic units; no floating point or guessed USD prices.
- Stores a contiguous canonical block journal, with each raw log pinned to its header's hash. Logs are sorted and deduplicated by block/log index. Order history is replayed deterministically.
- On a fork, walks backward to a common ancestor, drops orphaned blocks and rebuilds current/historical orders from canonical events. A reorganization of the configured deployment block fails closed and requires operator review.
- Keeps `active`, `cancelled`, `sold`, `invalidated`, `superseded` and `expired` order states separate. Seller nonce invalidation is distinct from later explicit cancellation.
- Checks current orders against pinned market storage, owner, token approval and operator approval. Ownership/approval observations are not a transfer simulation, voting eligibility verdict or guarantee a purchase succeeds.
- Compares indexed order count with `listingCount`; missing listing events or contradictory active-order storage prevent a fresh snapshot. A failed NFT read yields incomplete observations and stale health, never fabricated ownership.
- Publishes exact sync time, latest observed head, confirmed target, indexed block/hash/time, catch-up distance, reorg count and stale status. The browser also ages the snapshot with its clock.
- With a configured loan manager, verifies its deployment anchor, runtime bytecode, collection, settlement token, voter, treasury, guardian, `claimsVerified` and fee. All loan/debt/order/credit observations use the same numeric confirmed block as ordinary orders.
- Replays funded and cancelled offers, loan opening, repayments, forgiveness, closure, collateral withdrawal, financed listing/repricing/cancellation/sale, and lender/borrower credit withdrawals. Exact interest and its fractional remainder are retained across partial repayments.
- Checks the offer, loan and financed listing counts, offer escrow, aggregate credit liabilities, per-account credits, every indexed loan's storage and exact debt, and every financed listing's stored terms/activity against pinned getters. Omitted or contradictory events fail without committing the candidate journal.
- Keeps financed order state, loan closure state and collateral custody state distinct. A fully repaid loan can retain its NFT in custody. Repricing cancels the old order and creates a new ID; cancellation reasons distinguish repricing, borrower cancellation and loan closure.
- Computes current sale coverage as `price - floor(price × 50 / 10000) >= debt` using exact integers at the pinned block. Coverage is an observation of present debt, not a guarantee against later interest accrual or failed NFT transfer.

Ordinary and financed order IDs can overlap. `sourceKind` and `orderKey` identify them as `market:1` and `financed:1`, for example. The existing `source` metadata identifies the market; `financedSource` separately identifies the loan manager and declares `creditCoverage: "complete_manager_events"`. The public view also contains `loans` and `creditAccounts`. Every amount, ID, rate, accrual value and maturity in these rows remains a decimal integer string.

## Known deployment configuration

Supply JSON with actual values obtained from the specific local or fork deployment. This is a schema example, not an address manifest:

```json
{
  "rpcUrl": "http://127.0.0.1:8545",
  "chainId": 31337,
  "market": "<deployed RiftwellMarket address>",
  "collection": "<exact deployed NFT collection>",
  "paymentToken": "<exact deployed ERC20>",
  "paymentDecimals": 6,
  "deploymentBlock": 123,
  "deploymentBlockHash": "<32-byte receipt block hash>",
  "expectedMarketCodeHash": "<keccak256 of eth_getCode runtime bytes>",
  "confirmations": 2,
  "maxBlocksPerSync": 250,
  "staleAfterSeconds": 90
}
```

The runtime hash must come from the actual deployed bytecode, which includes immutables. The compiler artifact's unlinked/runtime placeholder is insufficient. Block hash, chain and code checks establish deployment identity; they are not a code audit or a guarantee the RPC is honest.

To include financed collateral, add this optional object to the same configuration, with actual values from the specific deployment:

```json
{
  "loans": {
    "address": "<deployed RiftwellLoans address>",
    "deploymentBlock": 124,
    "deploymentBlockHash": "<32-byte loan manager receipt block hash>",
    "expectedCodeHash": "<keccak256 of deployed loan manager runtime bytes>",
    "voter": "<expected voter address>",
    "treasury": "<expected treasury address>",
    "guardian": "<expected guardian address>",
    "claimsVerified": false
  }
}
```

This manager must use the same collection and payment token as the market. The journal begins at the earlier configured deployment block. Each source has its own immutable anchor; a source with a later deployment waits for confirmed coverage before its observations are published. Adding a loan source changes checkpoint identity and requires a new or explicitly rebuilt state file. Omitting `loans` preserves the standalone marketplace configuration and checkpoint format.

## Run one synchronization

From the `prototypes` directory, with Node.js 24:

```sh
node scripts/indexer.ts \
  --config deployment.local.json \
  --abi build/artifacts.json \
  --state var/market-index-state.json \
  --view web/data/market-index.json
```

The ABI argument accepts `build/artifacts.json`, a `{ "abi": [...] }` artifact, or a raw ABI array. With loans configured, `build/artifacts.json` supplies both compiled ABIs; when separate artifacts are used, add `--loans-abi path/to/RiftwellLoans.json`. The programmatic constructor accepts `loansAbi` alongside `abi`. All paths are explicit. There is no wallet, signer, private key or transaction method. The command performs one bounded synchronization; invoke it again to catch up or refresh observations. Refreshing the browser snapshot does not run this command.

The state and public view must use separate `.json` files. State includes the deployment/ABI identity, canonical journal and recent rollback records. The public view contains source identifiers and derived observations; it excludes RPC credentials and private state-file paths. The files are individually replaced atomically after a flushed temporary-file write. A crash between the two replacements can leave the browser with an older view; timestamps make this visible and a successful next sync republishes it.

An exclusive `<state>.lock` prevents overlapping writers. A leftover lock is not proof that its recorded process is still running: inspect that process before removing a crash residue. The indexer never automatically deletes another writer's lock or treats a temporarily regressed RPC head as evidence to discard its journal. RPC/validation failures preserve the last successful canonical journal and mark the public snapshot stale/error where a compatible previous view exists.

Operational settings are bounded. Header reads run in batches of eight, and one event-log query covers both configured source addresses for each new block range. Checkpointing from the earliest deployment block is required for complete nonce/order/offer/loan/credit history. An ABI, deployment identity or confirmation-policy change requires an explicitly selected compatible/rebuilt state file rather than silently reusing a foreign checkpoint. Old blocks and implausibly future block timestamps mark the view stale; the browser independently checks snapshot age and clock skew.

## Interface integration

This experimental event adapter is separate from the production API; its JSON is not a live order feed in the application. `web/index-source.ts` validates snapshots for future integration. Build browser modules with `npm run build:web`, then serve the emitted `build/web/*.js` modules from a browser host. Node tooling imports TypeScript sources directly.

## Validation

```sh
node --test --test-concurrency=1 test/indexer.test.ts
node --test web/model.test.ts
```

The indexer tests cover restart persistence, exact event fees, cancellation/sale rollback, seller invalidation followed by cancellation, confirmed catch-up, owner/approval/expiry distinctions, wrong chain/code/anchor, mid-read reorg, omitted listing/cancellation events, decimals mismatch, regressed head, corrupt journals, writer locks and rejection of signing/transaction RPC methods. Tests deploy real compiled market and loan contracts to an in-process EVM. Financed cases exercise mixed IDs, listing, repricing, cancellation, accrued insufficient coverage, partial/full repayment, debt closure in custody, withdrawal, forgiveness, sale, borrower/lender credits and credit withdrawal, reorg/restart recovery, large exact integers, unavailable ownership, corrupted debt/runtime responses and omitted cancellation events. They never broadcast to a public network.

The schema/model tests separately cover the default unconfigured source, exact atomic formatting, snapshot aging and safe rejection of malformed public metadata. Financed cases reject wrong source identity, mismatched blocks, debt arithmetic, coverage, loan references and duplicate credits. Fixture snapshots used in tests are explicitly test evidence, not live market data. Captured snapshots and the focused test log are in `docs/evidence/indexer-financed-2026-10-02/`.

## Limits

This is a local/fork prototype, not production indexing infrastructure. The JSON journal grows with block history; use a database and retention/checkpoint design before a high-volume service. It has no multi-provider quorum, log-proof verification, RPC failover, daemon scheduler, pagination, metrics exporter or full transaction simulation. Ownership in a vault and sufficient price coverage do not verify Kitten's exact transfer eligibility, recipient acceptance, buyer funds/approval or future executable status. A dishonest RPC that supplies internally consistent but false data cannot be defeated by these checks alone. Rewards beyond manager repayment events and other protocol adapters need separate schemas and review. Integration with the frontend and complete transaction simulation remain pending.
