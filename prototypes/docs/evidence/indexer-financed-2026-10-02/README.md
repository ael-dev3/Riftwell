# Local financed-indexer evidence

All snapshots in this directory come from the real compiled `LockkeepMarket` and `LockkeepLoans` contracts deployed to an in-process Ganache EVM. Addresses, loans, balances and orders are test fixtures, not public deployments or live marketplace data. The loan vault and Kitten-like NFT/voter here are local test contracts. No external RPC transaction was broadcast, no wallet was connected, and no snapshot was installed into the default interface data file.

The focused command in `manifest.json` passed **33 of 33 tests** with no failures or skips. `focused-tests.log` captures its complete output. Native Ganache/µWS bindings were unavailable for this Node version; Ganache used its JavaScript fallback, and the EVM tests completed successfully. The manifest records Node/platform information and SHA-256 hashes of the tested source files and unchanged contract sources.

The numbered JSON files capture mixed ordinary/financed listing IDs, interest growth making a price insufficient after the sale fee, repricing, explicit cancellation, partial repayment, full repayment while collateral remains in custody, collateral/credit withdrawal and restart, sale settlement, sale reorg/restart recovery, lender and borrower credit withdrawals, a cancelled offer above JavaScript's exact-number range, large exact debt, expiry, forgiveness, unavailable owner reads, and recovery after a mid-read reorg. Every JSON file wraps a snapshot with `evidenceType: "local-in-process-EVM-fixture-only"`.

The indexer's read path used only chain/head/header/code/log and `eth_call` methods. Tests separately mutate the local EVM to construct lifecycle and reorg cases. The tested adapter pins observations to one numeric block and rechecks hashes before committing. An unavailable read becomes a stale partial snapshot; contradictory code, configuration, debt, order activity or omitted events preserve the prior journal and mark a compatible public view stale/error.

`transactionSimulation` remains `not_performed`. Vault custody and price coverage do not prove that a Kitten transfer will succeed. Interest can grow after the indexed timestamp. No buyer balance/approval or exact purchase/recipient simulation is claimed.

Financed rendering in `web/app.js` and browser QA remain pending because task steering moved interface work to a separate project. This directory is durable local adapter evidence only.
