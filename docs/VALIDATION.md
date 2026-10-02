# Validation scope

The frontend, Node service and contract prototypes have separate dependency trees. Frontend production dependencies are React, React DOM and Lucide; the server uses Fastify, ethers and better-sqlite3. Contract/compiler tooling is not shipped with the application. Captured application audits are in `production-dependency-audit.json` and `server-production-dependency-audit.json`.

## Marketplace and TypeScript migration — 2 October 2026

- All first-party application, server, QA and experimental tooling source uses TypeScript 7.0.2. The application, server and QA tools pass strict type checking with separate runtime and compiler boundaries. Node 24 runs server and tooling entry points through native type stripping; type stripping does not replace the compiler check. The frontend also checks unchecked indexed access and exact optional properties.
- 121 frontend tests pass, including fixed and cubic Dutch pricing, reserved buyers, seller revisions, ownership, expiry, stale quotes, exact USDC accounting and all-or-nothing preview sweeps. Existing pooled lending and connected client checks remain included.
- 65 server tests pass on Node 24 with real SQLite. Coverage includes fixed/Dutch listing validation, reserved recipients, atomic revisions, creator-only management, scoped idempotency, ownership revalidation, bounded pagination, batched chain reads, authentication, Origin/CSRF, persistence, backup and outage recovery.
- Native TypeScript server startup was smoke-tested against the connected production build: HTTP 200 health, connected mode, disabled settlement, and successful HTML/compiled-asset delivery. The optional RPC setting was unset; no external chain request was made.
- Both production frontend modes build successfully. Preview JavaScript is approximately 95 kB compressed; connected mode approximately 90 kB; CSS approximately 10 kB. Docker is unavailable on this host, so the updated TypeScript container entry point has not been rebuilt locally.
- Manual browser checks exercised listing, editing and cancellation; fixed and Dutch purchase reviews; reserved-buyer validation; multiple-item purchase accounting; reload persistence; history; and independent marketplace/lending balances. Rendered widths of 433 and 1422 CSS pixels were inspected without page overflow. A fresh final preview tab reported no browser console errors. Screenshots: [desktop marketplace](qa/marketplace-desktop.png), [narrow marketplace](qa/marketplace-narrow.png).
- The connected marketplace was inspected using a temporary local HTTP/SQLite fixture service with simulated read-only chain data. Purchase review fetched a fresh listing and confirmed block data while its funded action remained disabled. Signed browser account flows were covered by client/server tests, but were not manually exercised in this inspection.

The updated TypeScript browser QA scripts were type-checked but **not executed**. Older automated browser/accessibility reports below remain historical evidence. No live NFT purchases, approvals, lending or smart-contract deployment occurred. The Solidity prototype source is unchanged; application listing records remain off-chain expressions of interest until a separate contract release.

The separate prototype toolchain compiles 19 deployable original/mock artifacts and emits browser-compatible modules successfully. Its full default suite passes 102 checks with one opt-in remote fork skipped: 68 contract checks, 15 event-indexer checks and 19 model/mocked-RPC checks. All 184 installed Solidity source files matched their pre-migration hashes; generated TypeScript ABI interfaces describe the existing contracts. The migrated read-only collectors and discovery entry points were type/syntax-checked without fetching new evidence. Historical JSON observations and source hashes remain historical; the public manifest separately identifies current collector source.

### Publication status

This correction is retained locally. The GitHub Pages check for run `37044531914` did not start: GitHub reported failed recent account payments or an exhausted spending limit. A read-only check of all six repository runs on 2 October UTC found no queued or in-progress runs, alternate workflows or rerun attempts. A normal push would trigger one Pages job, estimated at 1–3 runner minutes; monthly usage is unknown. No additional push or rerun was triggered while billing blocks the required checks. The live Pages preview still shows an earlier release.

## Pooled lending correction — 2 October 2026

These results precede the marketplace replacement and full TypeScript migration above.

- 96 frontend tests pass: 23 pooled-accounting tests, eight marketplace/domain tests and 65 connected client/wallet tests. Coverage includes exact share rounding, cash-limited withdrawals, debt and credit limits, collateral release, net reward repayment, zero-reward epochs, persisted-state validation and undeployed API responses.
- 48 server tests pass on Node 24 with real SQLite. The corrected lending status returns null accounting and terms; funded actions remain disabled. Retired request/offer creation returns HTTP 410 while private historical records and creator-only cancellation remain available. Authentication, Origin/CSRF, idempotency, ownership, outage recovery, database persistence and read-only chain checks pass.
- Strict TypeScript and both production build modes pass. The preview bundle is approximately 90 kB compressed; connected mode approximately 86 kB compressed; CSS approximately 10 kB compressed.
- Manual browser checks verified collateral deposit without debt, gross draw versus net proceeds, amount rejection, zero and positive reward epochs, supply/share accounting, liquidity and balance withdrawal limits, full manual repayment, collateral release and persistence after reload. A narrow rendered viewport (355 CSS pixels) showed no horizontal overflow. Public connected Borrow/Lend views were inspected against the built frontend and a temporary HTTP/SQLite service with simulated read-only chain data; accounting remained unknown and funded controls disabled. No browser runtime errors were observed in those inspected flows.
- Screenshots: [borrow desktop](qa/pooled-borrow-desktop.jpg), [borrow mobile](qa/pooled-borrow-mobile.jpg), [connected vault](qa/pooled-connected-lend.jpg). These are preview/service-fixture evidence, not live lending evidence.

The browser scripts now cover the pooled product and historical-record compatibility. The updated automated browser suites have **not been executed** for this correction; the older reports below cannot be used as coverage of the new lending interface. Signed connected account flows were covered by server/client tests, but were not exercised in the manual browser inspection.

## Earlier connected application checks — retained historical evidence

The following results describe the application before its pooled-lending correction. They do not validate the replacement interface or its new lending model.

- 74 frontend/domain/client tests pass, including exact money, runtime response validation, wallet rejection/account changes and offer consent limits.
- 45 server tests pass on Node 24 with real SQLite: nonce replay/concurrency, Origin/CSRF, raw HTTP encoded-path rejection, bounded rate limits/readiness probes, ownership invalidation, idempotency, private received offers, outage cancellation, WAL restart, backup/restore and static path/header/cache handling.
- Strict TypeScript, both build modes, formatting and diff checks pass. Production dependency audits report zero known advisories at the captured check time; this is not an independent audit.
- 36 integrated browser checks pass against the built connected frontend and a real HTTP/SQLite service, using ephemeral EOA providers and a simulated read-only chain. Ten tested views report no automated WCAG A/AA violations. Ownership dialogs, forms, received-offer review, service restart, outage cancellation, disconnect and mobile layouts are covered. No blockchain transaction is sent.
- A live read-only HyperEVM smoke check validates canonical block-hash reads of veKITTEN #18371. [The evidence](chain-read-smoke.json) records the block, escrow and lock data. It does not demonstrate trade execution or ownership by the application operator.

Run `VITE_APP_MODE=connected npm run build -- --outDir /tmp/riftwell-connected-qa`, then `npm run test:connected` for the integrated browser suite. Chrome and loopback networking are required. `RIFTWELL_CONNECTED_DIST` and `RIFTWELL_QA_PORT` can select a different build path and local port. See [qa/connected-browser-report.json](qa/connected-browser-report.json).

The existing Pages workflow also builds the pinned Linux container and smoke-tests it with a read-only filesystem, non-root runtime, isolated persistent volume and disabled settlement. Docker is unavailable on the local macOS validation host; Linux evidence is the corresponding workflow run. Container build checks do not establish readiness of an unprovisioned public service.

Public connected hosting, actual browser-extension/mobile-wallet interoperability at its final HTTPS domain, host backup recovery and independent security review remain deployment evidence to obtain. EOA browser providers are supported; desktop WalletConnect and contract-wallet signatures are not. Purchases, funded loans and other contract-dependent flows remain disabled. No prototype files changed in this application release.

Default prototype validation on the renamed public source passed 101 checks, failed none and skipped one explicit remote fork (102 tests total). That opt-in fork is excluded from ordinary local validation. Earlier predecessor fork records are retained in `prototypes/docs/evidence/`; they identify the older source/compiler, not release verification of renamed artifacts.

The reward-converter draft has 15 dedicated local tests covering measured single- and two-hop outputs, caller authorization, caps and deadlines, minimum output, partial-spend rollback, taxed and false-return tokens, approval cleanup, dependency changes and reentrancy. These use mock tokens and a mock router. Actual Algebra swaps on a pinned fork and lending-vault integration remain unverified; the converter is not connected to the frontend.

The experimental contract toolchain currently reports dependency advisories in its separately installed development tree. It is not part of the production frontend, and its package code/binaries are not committed. Review or replace that toolchain before using it for a production contract release. Do not apply forced dependency upgrades without checking compiler/EVM behavior and saved evidence.

## Earlier frontend checks — retained historical evidence

The following results describe the former request/offer preview, not the replacement pooled interface.

- 10 domain tests passed: exact USDC fee/interest flooring, input boundaries, filtering and persisted receipts.
- Strict TypeScript and Vite production build passed. Initial JavaScript is approximately 82 kB compressed; CSS approximately 8 kB compressed.
- 77 browser checks passed against the built production preview using isolated headless Chrome. Coverage includes the default and sole KittenSwap market, supplied logo loading, selected-market accents in body-portalled dialogs, search/filter/sort, position details, purchase receipts, borrowing, lending proposals, amount/APR validation, cancellation/reset, persistence, hash/history navigation, keyboard focus and reduced motion.
- 10 tested views passed automated WCAG A/AA accessibility checks with no reported violations. Desktop and mobile layouts were inspected; no horizontal overflow was found at 320, 390, 768, 1440 or 1920 pixels.
- No browser runtime/console errors or external requests were observed in those flows. Corrupt and unavailable browser storage were checked separately.

The reproducible browser script is `scripts/browser-qa.ts`; its results are in [qa/browser-report.json](qa/browser-report.json). Screenshots in `qa/` show the KittenSwap light-green theme, demo veKITTEN positions and USDC interface. The checks use local sample data, not a wallet or live lending integration.

Automated checks cover the tested views and browser only; they do not establish universal accessibility or security of future integrations. Production hosting must still be verified at its final URL, including HTTPS, response headers and cache behavior. The frontend is ready for static hosting as a preview; the contracts and funded protocol are not a production release.
