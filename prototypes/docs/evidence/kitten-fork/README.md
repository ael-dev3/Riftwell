# Kitten custody fork evidence

The authoritative completed run is
[2026-10-02-anvil-token18371.json](2026-10-02-anvil-token18371.json), with
[matching test output](2026-10-02-anvil-token18371.tap): **2 passed, 0 failed,
0 skipped**. It ran on the official Anvil 1.7.1 native binary with Cancun rules,
against chain 999 state pinned to block 47,471,441 and the block hash recorded in
the report. [manifest.json](manifest.json) records compiler, source and evidence
hashes; the main report records live proxy/implementation bytecode hashes.

NFT 18371 retained a real 864622-unit USDC entitlement for closed period 2960
after transfer to the loan vault. The vault received all 864622 units. The loan
manager credited 432311 units to its lender; the lender then withdrew exactly
that amount. The remaining 432311 units stayed in custody until the borrower
withdrew them after debt closure. Typed vault voting succeeded. NFT transfer
remained blocked before the next epoch, then the exact NFT was returned after
the local period advanced from 2961 to 2962. Previous-owner and unrelated direct
claims, unrelated voting, active-period claims and closed-loan revoting reverted.

All transaction receipts in this directory are from disposable local forks.
Remote RPC methods are allowlisted reads. No live wallet, mainnet transaction,
ERC-20 balance override, protocol storage override or manufactured entitlement
was used. Public accounts were impersonated and given native gas only locally.
The completed run's process cleanup was awaited; no orphan fork process remained.

Production reward automation remains **unverified/disabled**. This evidence
covers one NFT, pool, closed period and native-USDC path at the recorded
implementation hashes. integration maintainers integration review, upgrades, additional pools
and tokens, current-period claims, rebases and other supported lock types need
their own release evidence. See [the integration document](../../kitten-integration.md)
for the exact reproduction command and remaining gates.

Investigation files are retained to make limitations visible:

| File | Meaning |
| --- | --- |
| `2026-10-02-nonzero-discovery.json` | Bounded read-only search that found NFT 18371's real unclaimed USDC |
| `2026-10-02-drpc-token18371-gas5m-failure.json` | Ganache failed the loan safe custody transfer at 5 million gas |
| `2026-10-02-drpc-token18371.json` | Ganache failed the same path at 20 million gas; partial failure trace |
| `2026-10-02-ganache-engine-probe.json` | A direct Ganache NFT transfer to an EOA succeeded; the safe custody failure's exact cause was not isolated |
| `2026-10-02-anvil-token18371-clock-probe.json` | Contract custody and nonzero claim passed before the local timestamp advancement was corrected |
| `2026-10-02-anvil-token18371-rate-limit.json` | Public endpoint HTTP 429 blocked startup account reads; pacing/backoff was subsequently added |

The Ganache failures are not evidence of a live Kitten transfer failure. No
specific unsupported opcode is asserted without an execution trace proving it.
