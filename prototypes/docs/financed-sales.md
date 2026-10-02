# Publication context

This document contains historical development observations from before source renaming. It is not release approval for the current experimental artifacts. Some raw research links refer to locally retained evidence that is intentionally not part of this public repository.

# Financed NFT sale settlement

This original flow is implemented in `RiftwellLoans.sol`. It is a local prototype, not a live Kitten deployment.

## Borrower and buyer flow

1. Only the loan's borrower can list its active collateral, choosing a fixed USDC price and expiry. The NFT remains in its isolated loan vault; no marketplace approval is issued.
2. Each replacement receives a new listing ID. The previous order becomes permanently inactive. Cancellation and ordinary debt closure also invalidate the order.
3. A buyer approves the loan contract for the purchase amount and supplies a maximum price and NFT recipient.
4. Settlement recomputes debt at the transaction timestamp. The price after its 0.5% sale fee must cover all outstanding principal and accrued lender interest.
5. Actual buyer funds enter the contract. The full debt becomes the lender's withdrawable credit, the residual becomes the borrower's separate withdrawable credit, and the fixed sale fee goes to the immutable treasury.
6. Debt closes and the exact NFT transfers directly from its loan vault to the buyer recipient. A rejecting receiver or Kitten transfer restriction reverts the whole transaction, including payment, credits, debt closure, fee and order consumption.

The buyer does not assume the seller's loan. The lender and borrower can withdraw credits to their chosen recipients; neither destination must accept a push payment during the sale. A loan may be settled normally while a Kitten vote blocks its NFT transfer. A sale must wait until the NFT can actually move.

## Conservation rule

For a successful purchase with price `P`, fee `F = floor(P × 50 / 10,000)`, and transaction-time debt `D`:

```
P = D + F + borrower residual
borrower residual = P - F - D >= 0
cash retained by manager = escrowed offer capital
                         + total lender withdrawal credits
                         + total borrower withdrawal credits
                         + unsolicited donations
```

The fee uses an overflow-safe equivalent of the integer formula. Repayment credits are created only after actual funds are received. No second origination charge applies to this sale; the loan's earlier origination fee and its lender interest remain separate costs.

Existing liquid rewards already in the old loan vault remain the original borrower's surplus after debt closes. They are not silently sold with the NFT. A pinned fork now proves that an older USDC reward follows NFT 18371 into new custody; broader unclaimed-reward coverage and the complete financed-sale flow remain integration gates and must be disclosed before launch.

## Boundaries

- There is no forced lender sale, price liquidation, price oracle, pooled capital or arbitrary settlement call.
- Listing a low price does not allow underpayment: coverage is enforced at purchase. Interest may make an earlier quote insufficient, so a buyer must refresh the debt quote.
- New-loan pause does not prevent debt repayment, cancellation, credit withdrawal or a borrower-authorized exit sale.
- Only exact-transfer settlement tokens are supported. Incoming or outgoing token taxes revert rather than debit another user's reserves.
- Local mined tests cover cash conservation, permissions, replacements, debt changes, expired orders, rejecting transfers and callbacks. The actual Kitten fork and independent review remain separate launch requirements.
