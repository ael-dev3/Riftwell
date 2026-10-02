# Product direction

Riftwell is a focused place to use NFT positions: collateral credit lines, pooled USDC lending and a marketplace, starting with KittenSwap on HyperEVM.

## Implemented interface and service

The preview models collateral deposits, credit drawdowns, manual/reward repayment, shared USDC supply and liquidity-limited redemptions. Example reward history and credit parameters are explicit. There is no borrower-request board, fixed loan APR or maturity.

Connected mode supports EOA sign-in, block-pinned wallet position reads and persistent marketplace listings. Lending reports an undeployed status with null accounting and terms. Prior unfunded intents remain historical/cancellable; they cannot be converted into funded loans or vault shares.

The backend is packaged for a single-instance HTTPS deployment. GitHub Pages remains the illustrative preview. Provisioning and verification at a public connected domain remain outstanding.

## Separate funded release

Release a compatible pooled vault and collateral-account implementation before enabling lending. Agree reward-based credit policy, portfolio custody/release rules, borrowing headroom, reward conversion and routing, debt settlement, share valuation/rounding, fee schedules and withdrawal liquidity. Independently review those contracts and dependencies, test coherent block reads and transaction/custody boundaries, and run a limited pilot.

Existing Solidity prototypes are experimental and unchanged. They do not implement the intended pooled vault/credit-line product. Frontend or backend validation is not funded protocol evidence.

## Fee basis

Future marketplace settlement charges the seller 0.5% of price. The borrowing design retains a one-time 0.5% origination basis on gross draw, with net proceeds disclosed at confirmation. Revenue shares, automation and vault fees require explicit agreed terms and contract verification. No fees are charged by saving a marketplace listing or using the local preview.

## Later integrations

Desktop WalletConnect, contract-wallet authentication and further collection adapters can follow a verified deployment. Multiple server replicas require a different database architecture. Domain/trademark clearance and independent release review are not implied by source publication.
