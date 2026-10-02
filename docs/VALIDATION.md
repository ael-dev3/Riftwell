# Validation scope

The frontend, Node service and contract prototypes have separate dependency trees. Frontend production dependencies are React, React DOM and Lucide; the server uses Fastify, ethers and better-sqlite3. Contract/compiler tooling is not shipped with the application. Captured application audits are in `production-dependency-audit.json` and `server-production-dependency-audit.json`.

## Connected application checks — 2 October 2026

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

## Frontend release checks — 2 October 2026

- 10 domain tests passed: exact USDC fee/interest flooring, input boundaries, filtering and persisted receipts.
- Strict TypeScript and Vite production build passed. Initial JavaScript is approximately 82 kB compressed; CSS approximately 8 kB compressed.
- 77 browser checks passed against the built production preview using isolated headless Chrome. Coverage includes the default and sole KittenSwap market, supplied logo loading, selected-market accents in body-portalled dialogs, search/filter/sort, position details, purchase receipts, borrowing, lending proposals, amount/APR validation, cancellation/reset, persistence, hash/history navigation, keyboard focus and reduced motion.
- 10 tested views passed automated WCAG A/AA accessibility checks with no reported violations. Desktop and mobile layouts were inspected; no horizontal overflow was found at 320, 390, 768, 1440 or 1920 pixels.
- No browser runtime/console errors or external requests were observed in those flows. Corrupt and unavailable browser storage were checked separately.

The reproducible browser script is `scripts/browser-qa.mjs`; its results are in [qa/browser-report.json](qa/browser-report.json). Screenshots in `qa/` show the KittenSwap light-green theme, demo veKITTEN positions and USDC interface. The checks use local sample data, not a wallet or live lending integration.

Automated checks cover the tested views and browser only; they do not establish universal accessibility or security of future integrations. Production hosting must still be verified at its final URL, including HTTPS, response headers and cache behavior. The frontend is ready for static hosting as a preview; the contracts and funded protocol are not a production release.
