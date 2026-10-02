# Validation scope

The frontend and contract prototypes have separate dependency trees. Frontend production dependencies are React, React DOM and Lucide; no experimental chain/compiler tooling is shipped in its bundle. A captured production dependency audit is in `production-dependency-audit.json`.

Default prototype validation on the renamed public source passed 101 checks, failed none and skipped one explicit remote fork (102 tests total). That opt-in fork is excluded from ordinary local validation. Earlier predecessor fork records are retained in `prototypes/docs/evidence/`; they identify the older source/compiler, not release verification of renamed artifacts.

The reward-converter draft has 15 dedicated local tests covering measured single- and two-hop outputs, caller authorization, caps and deadlines, minimum output, partial-spend rollback, taxed and false-return tokens, approval cleanup, dependency changes and reentrancy. These use mock tokens and a mock router. Actual Algebra swaps on a pinned fork and lending-vault integration remain unverified; the converter is not connected to the frontend.

The experimental contract toolchain currently reports dependency advisories in its separately installed development tree. It is not part of the production frontend, and its package code/binaries are not committed. Review or replace that toolchain before using it for a production contract release. Do not apply forced dependency upgrades without checking compiler/EVM behavior and saved evidence.

## Frontend release checks — 2 October 2026

- 10 domain tests passed: exact USDC fee/interest flooring, input boundaries, filtering and persisted receipts.
- Strict TypeScript and Vite production build passed. Initial JavaScript is approximately 82 kB compressed; CSS approximately 9 kB compressed.
- 61 browser checks passed against the built production preview using isolated headless Chrome. Coverage includes search/filter/sort, position details, purchase receipts, borrowing, lending proposals, amount/APR validation, cancellation/reset, persistence, hash/history navigation, keyboard focus and reduced motion.
- 10 tested views passed automated WCAG A/AA accessibility checks with no reported violations. Desktop and mobile layouts were inspected; no horizontal overflow was found at 320, 390, 768, 1440 or 1920 pixels.
- No browser runtime/console errors or external requests were observed in those flows. Corrupt and unavailable browser storage were checked separately.

The reproducible browser script is `scripts/browser-qa.mjs`; its results are in [qa/browser-report.json](qa/browser-report.json). Screenshots in `qa/` show the final position and USDC interface. The checks use local sample data, not a wallet or live lending integration.

Automated checks cover the tested views and browser only; they do not establish universal accessibility or security of future integrations. Production hosting must still be verified at its final URL, including HTTPS, response headers and cache behavior. The frontend is ready for static hosting as a preview; the contracts and funded protocol are not a production release.
