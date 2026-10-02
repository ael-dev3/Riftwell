# Lending model

Riftwell’s intended lending product uses a shared USDC vault and collateral-backed credit lines. The marketplace is a separate product. There is no public borrower-request board, lender bidding, negotiated annual rate or fixed loan maturity.

## Borrow

1. Add an eligible veKITTEN position to a collateral portfolio. Depositing collateral and borrowing are separate actions; a portfolio may have no debt.
2. Read the **collateral credit limit**, based on verified reward history and the configured lending policy. An NFT’s market price does not establish approved credit.
3. Read **available to borrow**: remaining collateral credit, constrained by the vault’s borrowing headroom and other protocol limits. This differs from both total credit and idle vault cash.
4. Review a draw’s gross principal, one-time origination fee and net USDC received before confirmation. Only gross principal adds to debt. The current design basis is 0.5%; funded terms require a separate release.
5. Process collateral revenue under the selected strategy. Reward proceeds can reduce debt and pay configured lender/protocol revenue shares. Manual partial or full repayment is separate from automatic repayment.
6. Remove collateral only when the remaining portfolio satisfies the configured credit requirements. Individual collateral release rules must come from the actual protocol.

A position can instead be added to a reward relayer: its rewards are collected each epoch and paid to the owner, with no credit line. The owner can route a share of those rewards to repay credit-line debt after collateral rewards have been applied; the rest is paid out. A relayer position cannot back a loan or be listed until it is withdrawn. Any automation charge is configured at launch, and simulated relayer amounts are net of it.

Deposited collateral can grow without new debt. Merging folds a wallet position into a deposited one: the locked balances add up, the later unlock date applies and the wallet position no longer exists on its own. Increasing a lock adds tokens from the wallet without changing the unlock date. Both raise the position’s example reward and credit; debt is unchanged, and a merge cannot be undone.

The seven-day epoch is a reward cycle, not a loan duration. Reward amounts vary. Lower rewards slow repayment; no rewards means no automatic repayment. Any payoff estimate must name its reward and deduction assumptions and must not be presented as a maturity date.

## Lend

Suppliers deposit USDC into the shared vault and receive vault shares. Shares represent an entitlement to vault assets, including outstanding loan receivables. Lender revenue can increase share value; it is variable, not a fixed rate negotiated with a borrower.

Show these values separately:

- Vault assets and outstanding loans.
- Idle/free liquidity and utilization.
- The supplier’s share balance and its current asset value.
- The maximum amount withdrawable now.
- Realized historical yield, with its period and source; estimated yield must be marked as estimated.

Withdrawals/redeems are limited by the actual contract’s `maxWithdraw`/`maxRedeem` and free liquidity. A positive share value is not a promise of immediate cash. A cap on new borrowing does not guarantee a permanent cash reserve after lender withdrawals. Do not imply a withdrawal queue, secondary share market or instant exit unless that functionality exists.

## Fees and reward accounting

Origination, lender revenue share, protocol revenue share, optional automation charges and any vault performance fees are different quantities. A reward share is a percentage of collateral revenue, not interest added periodically to principal. An annualized cost illustration must show its reward assumptions.

Use configured contract terms for the selected market/version. Do not hard-code fee schedules from another protocol. Reward claims, unvested rewards, vested lender revenue and settled debt credit may become recognizable at different times. A future adapter must pin related reads to a coherent block and include its observation time. Claimable amounts and last-epoch realized results are not interchangeable.

## Current execution boundary

The preview has an exact local simulation of pooled accounting. Its cash, collateral reward history, credit multiplier and manually simulated epoch amounts are examples. Preview operations have no connection to a wallet or blockchain. A preview vault can become temporarily illiquid; withdrawals reject amounts beyond available cash. Old fixed-term preview loans/proposals are never converted into collateral, debt or vault shares.

Connected mode reports `not-deployed` and null vault addresses, accounting and terms. It displays real verified wallet NFT reads separately from deposited collateral; ownership alone does not create a credit line. Every funded lending action is disabled on the server. Historical unfunded requests/offers remain cancellable but are not actionable lending products.

Existing Solidity prototypes remain experimental and unchanged. They do not provide the pooled share/credit-line execution required by this interface. A funded release needs a compatible, independently reviewed vault/account implementation, reward and share accounting, coherent on-chain reads and transaction simulations. Source publication is not that release.
