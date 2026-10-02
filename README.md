# Riftwell

[Live preview → ael-dev3.github.io/Riftwell](https://ael-dev3.github.io/Riftwell/)

NFT-backed lending and a focused marketplace, starting with KittenSwap on HyperEVM. Dark surfaces, a light-green accent and a quiet portal theme.

![Riftwell preview](docs/qa/preview.png)

## Application

Two build modes share the interface:

- **Preview:** the GitHub Pages site uses labelled sample positions and local demo receipts.
- **Connected:** the Node service serves the interface and API together. Wallet sign-in, confirmed veKITTEN ownership reads, persistent listings, borrowing requests and lender offers work through SQLite. Borrowers can review received offers; creators can cancel their records.

Listings and offers are off-chain expressions of interest. Purchases, funded loans, acceptance, repayment and liquidation remain unavailable until the settlement contracts are separately released. No application route requests token approvals, transfers an NFT or sends a blockchain transaction. Displayed 0.5% settlement fees are future terms; saving a record charges nothing.

## Run locally

Use Node.js 24 and npm. Frontend and server dependencies have separate lockfiles.

```sh
npm ci --ignore-scripts
npm ci --prefix server
npm run dev
```

To run the connected application at `http://127.0.0.1:8080`:

```sh
VITE_APP_MODE=connected npm run build
APP_ORIGIN=http://127.0.0.1:8080 npm --prefix server start
```

The development database is `server/data/riftwell.sqlite`. Authentication supports EOA accounts through an Ethereum browser wallet on HyperEVM (chain 999). Open the site inside a compatible mobile wallet browser or use an extension. Desktop WalletConnect and contract-wallet authentication are not implemented.

```sh
npm run check
npm --prefix server test
npm run format:check
```

Read [deployment and operations](docs/OPERATIONS.md), the [API contract](docs/API.md), [hosting modes](docs/HOSTING.md) and [validation scope](docs/VALIDATION.md). The Docker deployment supplies HTTPS configuration, persistent storage and health checks. A production host, domain and suitable RPC endpoint must still be configured and verified.

## Source

- `src/` — React interface, preview logic and connected API/wallet client.
- `server/` — authentication, SQLite persistence, order APIs and read-only chain adapter.
- `deploy/` — single-instance Docker Compose and HTTPS reverse proxy.
- `public/` — original artwork and supplied KittenSwap logo.
- `prototypes/` — experimental Solidity and local integration tooling.

The Solidity prototypes are not deployed, independently audited or approved for real funds. They are not used by the running application and remain a separate release. See [prototype boundaries](prototypes/README.md).

## License

Original source and artwork use Apache 2.0. Dependencies retain their own licenses and notices. Branding and collection rights are separate from software permissions.
