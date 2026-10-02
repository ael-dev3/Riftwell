# Publication context

This document contains historical development observations from before source renaming. It is not release approval for the current experimental artifacts. Historical evidence is retained under docs/evidence; its predecessor source hashes do not match renamed current artifacts.

# Kitten reward settlement: verified routes and adapter boundaries

Status: historical route research, 2 October 2026. A separate unintegrated converter draft is now included; its dedicated swap and vault-integration gates remain open. No wallet was connected and no mainnet transaction was sent.

## Decision

There is a verified current KittenSwap route from **WHYPE to native USDC**, and
from **liquid KITTEN through WHYPE to native USDC**. Keep settlement restricted
to those two typed routes initially. A direct KITTEN/USDC pool exists but had
zero active liquidity and could not quote the sampled trade.

**Rebases are different:** an existing successful claim sent KITTEN into the
veKITTEN escrow and increased the NFT's locked amount. That value cannot be
credited as cash debt repayment or passed into the liquid-token swap route.

The current prototype can receive and apply USDC voting rewards; its recorded
nonzero fork test is described in [kitten-integration.md](kitten-integration.md).
That test does not prove a WHYPE/KITTEN conversion adapter. Keep production
reward claims disabled and non-USDC conversion unavailable until the separate
gates below pass.

## Evidence and observation boundary

The RPC observation is HyperEVM chain **999**, block **47,472,185**, hash
`0x943441169fb94d764ce02e361096ab4425821908e2e7f4da0643c72d6f35b36f`,
timestamp **2026-10-02 14:14:35 UTC**. All state calls used this numeric block.
The official app bundle observed at the same investigation was
`https://app.kittenswap.finance/assets/index-DTVlrAoN.js`, SHA-256
`52c6fba413ff9c0163fab80d49783a2d145072711b449ec6758a254ba9e2312a`.

Only literal public ABI arrays were extracted, using an AST parser without
executing the bundle. No competitor contract implementation was copied.
The collectors whitelist read-only JSON-RPC methods; they do not use balance
or storage overrides. Quoter inputs are sample trade sizes, not claims that a
vault or account holds those balances.

Primary sources:

- [KittenSwap current deployments](https://docs.kittenswap.finance/tokenomics/deployed-contracts)
  identifies the active Algebra contracts separately from unsupported legacy deployments.
- [Official current app](https://app.kittenswap.finance/) supplies the observed
  ABI/configuration; successful getter and quote calls match it to live contracts.
- [Circle USDC addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses)
  identifies the HyperEVM USDC address below as native Circle USDC.
- [Algebra Integral pool interface documentation](https://github.com/cryptoalgebra/algebra-integral-docs/blob/main/integration-of-algebra-integral-protocol/contracts-api/Core/interfaces/pool/IAlgebraPoolState.md)
  defines fee units and warns that pool state/last fees are not independent oracles.

Reproducible local evidence:

- [App ABIs and bundle hash](evidence/reward-settlement/app-abi-evidence.json).
- [Pinned-block pool registry, token metadata, runtime hashes and quotes](evidence/reward-settlement/rpc-route-evidence.json).
- [Exact RPC request/response records](evidence/reward-settlement/rpc-requests.json).
- [Decoded historical swaps, rebase events, implementation hashes and selectors](evidence/reward-settlement/supplement-evidence.json).
- [Supplement RPC records](evidence/reward-settlement/supplement-rpc-requests.json).
- [Read-only collector](evidence/reward-settlement/collect.ts) and
  [supplement collector](evidence/reward-settlement/collect-supplement.ts).

## Current addresses and matching

| Component                                           | HyperEVM address                             |
| --------------------------------------------------- | -------------------------------------------- |
| Algebra factory                                     | `0x5f95E92c338e6453111Fc55ee66D4AafccE661A7` |
| Swap router                                         | `0x4e73E421480a7E0C24fB3c11019254edE194f736` |
| QuoterV2                                            | `0xc58874216AFe47779ADED27B8AAd77E8Bd6eBEBb` |
| Pool deployer, returned by router/quoter/factory    | `0x88813b47D2687ceA50DBfd644EeFE17294E10303` |
| WHYPE, 18 decimals                                  | `0x5555555555555555555555555555555555555555` |
| KITTEN, 18 decimals                                 | `0x618275F8EFE54c2afa87bfB9F210A52F0fF89364` |
| Native USDC, 6 decimals                             | `0xb88339CB7199b77E23DB6E890353E22632Ba630f` |
| WHYPE/USDC base pool                                | `0x12Df9913E9E08453440e3C4B1aE73819160b513E` |
| KITTEN/WHYPE base pool                              | `0x71d1FDE797e1810711E4C9abcFcA6Ef04C266196` |
| KITTEN/USDC base pool, inactive liquidity at sample | `0xdf99bADEEA1C9B81c5d4134E644e939244C1Fb1C` |
| WHYPE/USDC plugin                                   | `0x84510Aa9ed5b356f2b223aa10B930cF6a9604943` |
| KITTEN/WHYPE plugin                                 | `0x9cC23759073bA914943445BbcA3A2D665F73E7Bb` |
| veKITTEN escrow                                     | `0x29d3A21fF35a519E00cF6d272f2aD897b109BD84` |
| Voter                                               | `0xb7F7053F7e6c210e6777D5BA758E4b3ECa6C88A0` |
| RebaseReward                                        | `0xDd002E8DF80ccB7A8964BFef6e15ee36D414fC36` |

The factory's `poolByPair(address,address)` returned these pools. Their
`token0()/token1()` and factory getters were checked, and both usable pools had
nonzero active liquidity. Router and quoter agreed on factory, pool deployer and
WHYPE. The `deployer` parameter **inside a base-pool route is the zero address**;
it is not the `0x8881…` pool-deployer contract. This distinction is verified by
successful live quotes and the existing transactions below.

Recorded router runtime hash:
`0x19d1ac2ea27ef5244f45cf3d4c70ae4dd3dc8dbc4fd00416c694597b82f31cce`.
Quoter runtime hash:
`0x5d9d9198143acb537c97bf19e061f35f7abfe97b28c97cfbbc0506d85d342581`.
An empty EIP-1967 slot alone is not proof that every dependency is immutable.
KITTEN and the voting/escrow/rebase contracts are proxies; plugins/factory
configuration add further external control risk. Current KITTEN implementation
is `0xE9C39eAca6dcD550bB554Ef826ae46a27733dcb6`; rebase implementation is
`0xdCB9EFB0339E13c8fEbe85b13d6270175F770214`.
Their implementation runtime hashes are retained in the supplement.

## Exact public methods

The observed public ABI defines these tuple fields in this order:

```text
exactInputSingle(
  (address tokenIn, address tokenOut, address deployer, address recipient,
   uint256 deadline, uint256 amountIn, uint256 amountOutMinimum,
   uint160 limitSqrtPrice) params
) payable returns (uint256 amountOut)
selector 0x1679c792

exactInput(
  (bytes path, address recipient, uint256 deadline,
   uint256 amountIn, uint256 amountOutMinimum) params
) payable returns (uint256 amountOut)
selector 0xc04b8d59

quoteExactInputSingle(
  (address tokenIn, address tokenOut, address deployer,
   uint256 amountIn, uint160 limitSqrtPrice) params
) returns (uint256 amountOut, uint256 amountIn, uint160 sqrtPriceX96After,
           uint32 initializedTicksCrossed, uint256 gasEstimate, uint16 fee)
selector 0xe94764c4

quoteExactInput(bytes path, uint256 amountInRequired)
  returns (uint256[] amountOutList, uint256[] amountInList,
           uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList,
           uint256 gasEstimate, uint16[] feeList)
selector 0xcdca1753
```

Use `exactInputSingle` for WHYPE/USDC, with the zero deployer and a fixed vault
recipient. For KITTEN, build the path internally as five packed 20-byte addresses:
`KITTEN | address(0) | WHYPE | address(0) | USDC`. This 100-byte path successfully
quoted through `quoteExactInput`; do not use a Uniswap-style three-byte fee path.
The router also exposes multicalls, sweep/unwrap helpers, permits and a
fee-on-transfer entry point. The adapter should expose none of those powers.

## Quoted route and actual historical execution

| Sample input               | Pinned-block quoted output      | Evidence                                       |
| -------------------------- | ------------------------------- | ---------------------------------------------- |
| 1 WHYPE                    | 90.258710 USDC                  | `quoteExactInputSingle`, raw output `90258710` |
| 10,000 KITTEN              | 0.158326529799033279 WHYPE      | `quoteExactInputSingle`                        |
| 10,000 KITTEN, two hops    | 14.290666 USDC                  | `quoteExactInput`, raw last output `14290666`  |
| 10,000 KITTEN, direct USDC | Reverted: `Zero liquidity swap` | Direct pool active liquidity was zero          |

Both quoted hops returned fee **500**, which is **0.05%** in Algebra's
millionth units. This is a sampled swap fee, not a fixed future promise. The
plugin may change fees; `globalState.lastFee` can be stale. Quotes already
include pool swap fees and price impact. They exclude gas and any separate
application/partner charge.

Actual successful mainnet receipts strengthen the route evidence:

- [KITTEN through WHYPE to USDC, transaction ba122414…](https://hyperevmscan.io/tx/0xba122414959a8baf89c2a760726066c3f8a703c3ddcfc16528a7d9799cd4073e),
  block 44,807,830: a router multicall containing `exactInput` spent
  8,428.023993955717261285 KITTEN, routed 0.194886099506841000 WHYPE through the
  two named pools, and paid 16.217503 USDC to its specified recipient.
- [USDC to WHYPE, transaction 70873bb3…](https://hyperevmscan.io/tx/0x70873bb3b1e951f027269bbed1e74e2834684e4f9a149b2840bf54826a95e43c),
  block 45,601,904: `exactInputSingle` spent 28.842937 USDC and paid
  0.360000001360069101 WHYPE, using the zero route deployer and the named pool.

The input transfer logs equal the requested inputs in those samples; WHYPE
intermediate amounts also match exactly. No transfer tax is evident there.
This does **not** certify that KITTEN cannot be upgraded, taxed or restricted,
or that event values alone prove all future balance changes. Enforce balance
deltas in the adapter and reject inexact tokens rather than silently accepting
the router's fee-on-transfer mode.

The first historical transaction's deadline is `1788329676238`, a very distant
seconds value. Preserve it as evidence only; do not copy it into the adapter.
Generate deadlines in Unix **seconds**, with an enforced short validity bound.

These are quotes and other users' existing successful receipts. No actual
funded isolated loan vault executed a swap in this investigation. The official
app also contains a LiquidSwap aggregation integration; that does not justify
accepting API-supplied arbitrary targets, spenders or calldata in collateral custody.

## Rebase path: locked value, not repayment cash

The current RebaseReward ABI includes:

```text
earnedForTokenId(uint256 tokenId) view returns (uint256[] amounts,address[] tokens)
getRewardForTokenId(uint256 tokenId)                 selector 0x3c8a4ecf
getRewardForPeriod(uint256 period,uint256 tokenId,address token)
                                                    selector 0xcd8935e9
getRewardForOwner(uint256 tokenId)                  selector 0xc2a8c832
getRewardList() view returns (address[])
```

Its reward list at the sampled block was KITTEN only; duration was 604800
seconds and period was 2961. Its `veKitten()` and `voter()` getters match the
current escrow/voter above.

The successful [rebase transaction b5c1569e…](https://hyperevmscan.io/tx/0xb5c1569eaa6e753d1aa0cf1c207dad9f157e880d067bf133fca9fd8a02b0198e)
called `getRewardForTokenId(18570)`. Its receipt records transfers of
**62.733592718325354817** and **60.876814318314456765 KITTEN** from RebaseReward
to the escrow, with equal-value `Deposit` events for NFT 18570 and corresponding
`Supply` increases. They were claims for periods 2955 and 2956.
The `ClaimReward._to` event names the NFT owner, but the actual ERC-20 destination
is the escrow: do not mistake that event field for liquid payout custody.
Raw evidence is [transaction-rebase-b5c1569e.json](evidence/reward-settlement/transaction-rebase-b5c1569e.json).

Treat this as demonstrated compounding behavior for the sampled claims.
It does not prove every entry point/token/proxy version behaves identically.
A future separate typed rebase action should require borrower opt-in, validate
the exact NFT and reward identity, and prove locked-amount/expiry effects on a
pinned live fork. It must not create lender USDC credits, fabricate USDC value,
force an extended lock, or sell locked KITTEN as if it were a liquid balance.

## Proposed bounded conversion adapter

This is a recommendation for a later implementation, not a description of code
already shipped.

1. **Fix scope at deployment.** Pin chain, router, factory, token identities and
   the two base pools. Derive paths internally from a small route enum. No user
   target, spender, recipient, arbitrary bytes, multicall, native HYPE unwrapping,
   ERC-721 approvals or unrelated token rescue powers. Fail closed on unexpected
   code/configuration; a new reviewed adapter handles dependency changes.
   Proxy `extcodehash` does not reveal an implementation upgrade. That requires
   a verified public implementation getter, where available, or a monitored
   pause/review policy; Solidity cannot read another contract's arbitrary storage.
2. **Keep authority explicit.** Borrower opts into conversion; lender accepts
   settlement terms at loan origination. Commit route, maximum input, acceptable
   loss bounds, deadline policy and reward ownership. An operator/keeper may
   execute only those bounds, and cannot lower `minimumOut` or choose another
   recipient. Route/slippage changes affecting lender economics require both
   parties' consent. Public execution of a valid committed order is possible;
   public discretion over the order's economics is not.
3. **Use measured funds and limited approvals.** Convert only tokens actually in
   that loan's vault. Approve only the exact input for the fixed router, using
   zero-reset/`forceApprove`; clear and verify allowance after the call. The
   transfer wrapper must check actual vault input spent and USDC received,
   including any temporary vault→adapter custody leg. Reject taxed/rebasing
   inputs or output discrepancies. Reentrancy guards and atomic rollback cover
   callbacks, failed swaps, failed approval clearing and token restrictions.
4. **Credit only received USDC.** Apply debt reduction only after the manager's
   measured USDC receipt. Cap repayment at actual debt; preserve excess for the
   borrower. A quote, token amount, NFT voting power or rebase event cannot
   create lender credits. A failed/unavailable swap leaves token rewards in
   custody and cannot prevent ordinary USDC repayment or lawful collateral exit.
5. **Enforce an economic minimum.** Require nonzero minimum output, bounded
   trade size and deadline, and an accepted reference-price policy. A spot quote
   or same-pool spot tick is not an independent oracle. An unattended keeper
   needs reviewed TWAP/independent feeds, freshness and liquidity checks,
   deviation limits, decimal-safe arithmetic and a floor such as
   `max(consentedMinimum, oracleReferenceLessPermittedLoss)`. No trustworthy
   KITTEN oracle configuration was established here, so automatic settlement
   remains gated. A narrowly bounded borrower-authorized fresh quote can be a
   conscious alternative only if the lender agreed to that risk. Never infer
   an oracle from these sample outputs or let a keeper set `minimumOut = 0`.
6. **Account for costs without inventing revenue.** Pool fees, price impact,
   gas and MEV lower actual USDC receipts. Keep them distinct from Riftwell's
   agreed origination/sale fees and lender interest. Do not add a recurring
   reward share or an unreviewed aggregator partner fee. Keep raw non-USDC
   borrower surplus recoverable after closure, subject to the token's own controls.

Short validity alone does not eliminate sandwiching. Independent reference
prices, conservative loss limits, execution-size caps and a reviewed private
submission option may reduce risk; none guarantees a specific yield. Limited
allowances contain external router exposure but cannot eliminate dependency
upgrades, malicious plugins or issuer freezes.

## Gates before implementation is advertised as supported

- Verify a real nonzero WHYPE/KITTEN voting reward reaches the NFT-owning vault,
  then execute the exact typed route locally on a pinned current live fork with
  measured input/output and zero leftover allowances. Do not fund that test by
  overriding ERC-20 balances or reward entitlement.
- Test atomic rollback for insufficient minimum output, expiry, tax/rebasing
  tokens, false router returns, callback reentrancy, dependency changes and
  frozen USDC destinations. Verify separate vaults and all outstanding USDC
  credits/offer escrow conserve reserves after both conversion and withdrawal.
- Establish and test the oracle or explicitly consented quote policy, including
  stale observations, zero liquidity, decimal rounding, extreme fee changes and
  keeper manipulation. Agree economic bounds with the integration maintainers and holders.
- Test rebase compounding separately, including permission, exact NFT amount,
  unlock time and behavior before/after collateral sale/return. Clarify which
  rewards follow the NFT and which belong to the old borrower.
- Review the original adapter and dependencies independently. Repeat deployment
  matching immediately before release and keep claims/conversion disabled if
  identity, permissions or economic policy cannot be proved.

No GitHub publication, Actions trigger, deployment or signing was needed for
this research. Any later remote action remains subject to the user's all-run,
all-attempt UTC-day Actions preflight and approval policy.
