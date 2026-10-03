# Product direction

Riftwell is a focused place to use NFT positions: collateral credit lines, pooled USDC lending and a marketplace, starting with KittenSwap on HyperEVM.

## Implemented interface and service

The preview models collateral deposits, credit drawdowns, manual/reward repayment, shared USDC supply and liquidity-limited redemptions. Example reward history and credit parameters are explicit. There is no borrower-request board, fixed loan APR or maturity.

Connected mode supports EOA sign-in, block-pinned wallet position reads and persistent marketplace listings. Lending reports an undeployed status with null accounting and terms. Prior unfunded intents remain historical/cancellable; they cannot be converted into funded loans or vault shares.

Firebase hosts the illustrative preview at `https://riftwell-ael.web.app`. The Deno API at `https://riftwell.ael-dev3.deno.net` uses separate managed PostgreSQL databases and session secrets for production and preview. Hosted API checks pass; the connected frontend build awaits recovery and actual-wallet verification before replacing the preview. Source is published on GitHub. GitHub validates application tests, types, formatting, the connected container and the preview build; the unused Pages deployment is retired. Firebase and Deno releases use their direct provider tools. See [current release evidence](VALIDATION.md#publication-and-hosted-preview--3-october-2026).

## Separate funded release

Release a compatible pooled vault and collateral-account implementation before enabling lending. Agree reward-based credit policy, portfolio custody/release rules, borrowing headroom, reward conversion and routing, debt settlement, share valuation/rounding, fee schedules and withdrawal liquidity. Independently review those contracts and dependencies, test coherent block reads and transaction/custody boundaries, and run a limited pilot.

Existing Solidity prototypes are experimental and unchanged. They do not implement the intended pooled vault/credit-line product. Frontend or backend validation is not funded protocol evidence.

## Fee basis

Future marketplace settlement charges the seller 0.5% of price. The borrowing design retains a one-time 0.5% origination basis on gross draw, with net proceeds disclosed at confirmation. Revenue shares, automation and vault fees require explicit agreed terms and contract verification. No fees are charged by saving a marketplace listing or using the local preview.

## Later integrations

Desktop WalletConnect, contract-wallet authentication and further collection adapters can follow a verified deployment. PostgreSQL already coordinates writes and rate limits across API instances; replica and restart verification on the selected host still needs release evidence. Domain/trademark clearance and independent release review are not implied by source publication.
