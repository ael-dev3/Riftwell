# Experimental contracts and integration tooling

These original development prototypes are published for review. They are not production contracts and must not be deployed with real funds yet. The production frontend preview is separate and never calls them.

- `RiftwellMarket`: fixed-collection NFT listings, cancellation/expiry, exact payment checks and a 0.5% seller fee.
- `RiftwellLoans`: actual lender-funded offers for a specified borrower and NFT; 0.5% once on new principal; remaining-principal simple interest; maturity stops interest; separate, fully funded lender and borrower credits.
- `RiftwellLoanVault`: individual NFT custody, constrained voting and registered closed-period reward claims. Claims require a deployment verification flag; keep it false for any unreviewed deployment.
- Financed collateral sales: seller-authorized sale, funded debt settlement before NFT delivery, one 0.5% sale fee, atomic rollback when actual collateral transfer fails.
- `RiftwellKittenRewardConverter`: **new unintegrated draft** of capped caller-authorized liquid reward conversion with fixed routes, measured transfers, short deadlines and cleared router allowances. It has no unattended oracle policy and is not yet covered by dedicated swap/fork tests. It is not connected to lending vaults or the frontend.
- Event indexing: local canonical-block/reorg foundation; JSON persistence and incomplete live integration are prototype limitations.

## Tests

```sh
npm ci --prefix prototypes --ignore-scripts
npm run contracts:compile
npm run contracts:test
```

Default tests use a disposable local EVM. The optional fork harness reads remote HyperEVM state and performs transactions only on a disposable local Anvil fork; it never submits a transaction remotely. No ERC-20 balance, protocol storage or reward-entitlement overrides are permitted by the harness.

Source was renamed from an earlier internal development codename for publication. This changes compiler metadata and source identities. Earlier fork observations are development evidence for the predecessor, not production approval for the renamed artifacts. New release evidence must identify the exact published source/compiler/deployment.

## Release gates

Independent review; exact protocol implementation/upgrade matching; transfer and reward ownership across all supported tokens; conversion/oracle policy and real funded swap tests; rebase treatment; custody exits; collateral eligibility; maturity/default economics; capital availability; durable indexing and monitoring; and a complete wallet/transaction integration. There is no price-triggered collateral seizure in the current loan design. A lender-funded offer is not guaranteed liquidity.

Dependencies are imported from upstream packages. Keep their copyright/license notices; the Apache license on original files does not relicense dependency code.
