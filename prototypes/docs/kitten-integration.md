# Publication context

This document contains historical development observations from before source renaming. It is not release approval for the current experimental artifacts. Historical evidence is retained under docs/evidence; its predecessor source hashes do not match renamed current artifacts.

# KittenSwap integration evidence and release gates

Checked on 2 October 2026. This is an integration investigation, not an audit or a
claim that a funded lending deployment is ready. No live wallet was connected,
no mainnet transaction was signed or broadcast, and no remote repository was
changed. The explicit integration test sends transactions only to a disposable
local fork, using local test accounts and impersonated public accounts.

The product goals are collaboration with the integration maintainers, useful services for Kitten
holders, and original technology that can support later integrations. Correct
custody and reward accounting are prerequisites to those goals.

## Addresses and current interface evidence

| Component                 | HyperEVM mainnet address                     |
| ------------------------- | -------------------------------------------- |
| Chain                     | 999                                          |
| veKITTEN                  | `0x29d3A21fF35a519E00cF6d272f2aD897b109BD84` |
| Voter                     | `0xb7F7053F7e6c210e6777D5BA758E4b3ECa6C88A0` |
| KITTEN                    | `0x618275F8EFE54c2afa87bfB9F210A52F0fF89364` |
| RebaseReward              | `0xDd002E8DF80ccB7A8964BFef6e15ee36D414fC36` |
| Native USDC               | `0xb88339cb7199b77e23db6e890353e22632ba630f` |
| Sample primary pool       | `0x12df9913e9e08453440e3c4b1ae73819160b513e` |
| Sample pool voting reward | `0x75b843855aa873b5bc8f9be04f4ae972b90ee503` |

Official Kitten documentation identifies the escrow and Voter deployment. The
current official application bundle contains the escrow, Voter and voting reward
ABIs. Independently written public declarations are in
`contracts/interfaces/IKittenVoting.sol`; no competitor implementation was used
to write them.

Retained [ABI extraction evidence](evidence/reward-settlement/app-abi-evidence.json)
records the [official application bundle](https://app.kittenswap.finance/assets/index-DTVlrAoN.js)
observed on 2 October 2026. Its recorded SHA-256 is
`52c6fba413ff9c0163fab80d49783a2d145072711b449ec6758a254ba9e2312a`.
The [Voter ABI evidence](evidence/rebase/app-voter-abi.json) separately records
its extraction from that official bundle. These are historical observations,
not a claim that the currently served bundle or deployed interfaces are unchanged.
The escrow ABI is bound to `_p`, the Voter ABI to `uC`, and the pool voting reward
ABI to `Due`. `Rzt` is a separate rebase reward ABI; do not confuse rebases with
liquid voting revenue.

At observed head block **47,468,911** (13:20:55 UTC), public RPC reads returned:

| Read                              | Result                                       |
| --------------------------------- | -------------------------------------------- |
| Voter implementation slot         | `0x957685ab613965edb7e4964e7698f192370e1284` |
| Escrow implementation slot        | `0xd2b6bf91bbbb8d86a72788a37c3886a4f821a873` |
| Sample reward implementation slot | `0xb390c8c641a1fb3f786b9cabacef14e594ef82f1` |
| `Voter.veKitten()`                | Current escrow address above                 |
| `escrow.voter()`                  | Current Voter address above                  |
| `escrow.MAXTIME()`                | `63,072,000` seconds, or 730 days            |
| `Voter.getCurrentPeriod()`        | `2961`                                       |

The inspected Voter and sample reward implementation pages reported unverified
source. Official app ABIs and runtime behavior provide stronger evidence than
guessing from Solidly conventions, but they do not provide full verified-source
review or protection against future upgrades. Deployment configuration must pin
and verify implementation versions, not merely proxy addresses.

## Exact methods needed by custody

Escrow reads are `ownerOf(tokenId)`, `getApproved(tokenId)`,
`isApprovedForAll(owner,operator)`, `isApprovedOrOwner(account,tokenId)`,
`locked(tokenId) -> (int128 amount,uint256 end)`,
`balanceOfNFT(tokenId) -> uint256`, `ownership_change(tokenId) -> uint256`,
and `voted(tokenId) -> bool`. The supplied current ABI has no `attachments`,
`managed`, `isPermanent`, or managed-lock getters. Do not invent those interfaces
or claim unsupported lock types are supported.

Voter methods are:

```solidity
vote(uint256 tokenId, address[] pools, uint256[] weights)
claimVotingRewardBatch(address[] votingRewards, uint256 tokenId)
checkPeriodVoted(uint256 period, uint256 tokenId) returns (bool)
getTokenIdVotes(uint256 period, uint256 tokenId)
    returns (address[] pools, uint256[] weights)
getGauge(address pool) returns (Gauge)
```

`Gauge` is a tuple in this exact order:
`(address gauge,bool isAlgebra,address votingReward,bool isAlive,address vault)`.
The sample pool registry read returned gauge
`0xd71b7377fa1cc0065d2b2b2562efa19a6ea9c42f`, `isAlgebra=true`, voting reward
`0x75b843855aa873b5bc8f9be04f4ae972b90ee503`, `isAlive=true`, and vault
`0xc5397609d162ee8ce1013ac7cac8d48a077614fc`.

Reward methods are **not** the common Solidly `getReward` interface:

```solidity
getRewardForTokenId(uint256 tokenId)
getRewardForOwner(uint256 tokenId)
getRewardForPeriod(uint256 period, uint256 tokenId, address token)
earnedForPeriod(uint256 period, uint256 tokenId, address token) returns (uint256)
earnedForToken(uint256 tokenId, address token) returns (uint256)
earnedForTokenId(uint256 tokenId)
    returns (uint256[] amounts, address[] tokens)
getRewardList() returns (address[])
```

The last argument to `getRewardForPeriod` is the **reward token**, not a recipient.
No caller-selectable recipient argument appears in these declarations.

## Current authorization probes

Read-only `eth_call` simulations requested block `47,468,911`, NFT `18373`, the
sample reward above and USDC. The current owner read returned
`0xa1f62daf42d8bcd3669dec72271b3f658b9c3891`.

| Call                                           | From NFT owner | From unrelated address | From Voter             |
| ---------------------------------------------- | -------------- | ---------------------- | ---------------------- |
| Reward `getRewardForTokenId(18373)`            | Succeeded      | `NotApprovedOrOwner()` | `NotApprovedOrOwner()` |
| Reward `getRewardForPeriod(2960,18373,USDC)`   | Succeeded      | `NotApprovedOrOwner()` | `NotApprovedOrOwner()` |
| Reward `getRewardForOwner(18373)`              | `NotVoter()`   | `NotVoter()`           | Succeeded              |
| Voter `claimVotingRewardBatch([reward],18373)` | Succeeded      | `NotApprovedOrOwner()` | Not tested             |
| Voter `vote(18373,[primaryPool],[1])`          | Succeeded      | `NotApprovedOrOwner()` | Not tested             |

The custom-error selectors were matched against the official ABI:
`NotApprovedOrOwner()` is `0xe433766c` and `NotVoter()` is `0xc18384c1`.
These calls do not prove an amount was paid: NFT 18373 had zero earned amounts in
the sampled reward contract. They confirm the authorization distinction for this
observed deployment and token.

The 31 July 2025 Pashov review describes an audited batch path which checks NFT
ownership/approval, calls the reward from the Voter, and pays the current NFT
owner. This supports owning each pledged NFT in an isolated custody vault. The
audited snapshot is not proof that the current implementation retains every
detail, especially direct closed-period recipient behavior after transfer.

## Nonzero payment evidence and its limits

An existing successful transaction provides actual liquid payout evidence:

[Reward claim transaction](https://hyperevmscan.io/tx/0x6a1765d62c938c4290a372db3afee2a1773ac0f3595a456b9df0556887bb419e)

At block `47,414,223`, sender `0x68acb2051b73c2342be78cd1a7e5ca44483d10c5`
called the sample reward's `getRewardForTokenId(19023)` (`0x3c8a4ecf`). Its receipt
contains successful ERC-20 transfers from that reward to the sender, including
`387360` raw USDC units (**0.387360 USDC**) and WHYPE. An owner read also returned
that sender, with the historical-state limitation below.

This is direct evidence of a paid owner-path claim. It is not proof of a nonzero
`getRewardForPeriod` payout to a contract owner, nor complete evidence of rewards
following an NFT sale or collateral return.

Historical requests for balances immediately before and after that transaction
both returned identical already-claimed state on `rpc.hyperliquid.xyz/evm`.
A temporary code-override claim probe consequently returned zero balance delta.
Do not interpret this as proof that the claim fails or sends to the wrong place:
the sampled historical state was not shown reliable. `debug_traceCall` was also
unsupported. Use an archive-capable RPC and a local fork for the release tests.

## Completed local fork evidence

The explicit integration gate passed **2 tests, 0 failures, 0 skips** on
2 October 2026, 14:15:13–14:16:02 UTC. It used actual chain 999 deployment state
at numeric block **47,471,441**, hash
`0xdc489fb72c1af10b795dae8337959bedf53b3cda2ee890fa45f0345d483b5205`
(block timestamp 14:02:23 UTC), through `hyperliquid.drpc.org`. The same numeric
block was read repeatedly and required to return the same number and hash.
Remote contract calls and local fork fallback state reads used numeric block
tags. Proxy and implementation bytecode hashes are saved with the report.

The tested NFT was **18371**, owned at that block by
`0x57Ee32f42dfD116482e389d5cb87a4F20eF53699`. Its actual unclaimed primary-pool
USDC entitlement for closed period **2960** was **864622 raw units**. This
entitlement remained exactly 864622 after transfer into the deployed loan vault.

| Observed local behavior                                       | Result                                                                         |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Real NFT accepted into isolated loan custody                  | Vault became owner of NFT 18371                                                |
| Typed borrower vote through NFT-owning vault                  | Voter marked next period 2962 voted                                            |
| Unrelated lender voting through vault                         | Reverted                                                                       |
| NFT transfer after voting for next period                     | Reverted while current period was 2961                                         |
| Direct reward claims from previous owner and unrelated lender | Both reverted after NFT transfer                                               |
| Claim of active period through vault                          | Reverted                                                                       |
| Actual closed-period USDC claim                               | Vault balance rose from 0 to 864622 raw units                                  |
| Claimed period entitlement                                    | Became zero                                                                    |
| Reward debt repayment                                         | 432311 raw units credited to lender; lender balance unchanged until withdrawal |
| Lender credit withdrawal                                      | Exactly 432311 raw units paid to lender                                        |
| Excess reward custody                                         | 432311 raw units remained in vault after repayment                             |
| Borrower surplus withdrawal after debt closure                | Exactly 432311 raw units paid to borrower; vault USDC became zero              |
| Closed loan revote                                            | Reverted                                                                       |
| Collateral withdrawal before epoch change                     | Reverted                                                                       |
| Local time advanced to period 2962                            | Exact NFT returned to borrower                                                 |

Primary evidence is in
[`evidence/kitten-fork/2026-10-02-anvil-token18371.json`](evidence/kitten-fork/2026-10-02-anvil-token18371.json)
and the matching
[`2026-10-02-anvil-token18371.tap`](evidence/kitten-fork/2026-10-02-anvil-token18371.tap).
These transaction hashes are **local fork receipts**, not mainnet transactions
or explorer links. The full report retains `productionClaimsVerified=false`;
the successful fork does not itself authorize a funded production launch.

The successful engine was the official `@foundry-rs/anvil` **1.7.1** native
binary, with the **Cancun** hardfork. Ganache **7.9.2**, limited to Shanghai,
reproduced the owner and reward state and could perform a direct NFT transfer,
but reverted on the funded loan's safe custody transfer even at 20 million gas.
That engine failure is saved separately; no exact unsupported opcode is claimed
from its incomplete trace. Anvil passed the same custody path without altering
the deployed escrow's bytecode or storage. The standard Hyperliquid and
Hypurrscan endpoints rejected genesis with `invalid block height: 0`; Ganache
requires genesis, while the Anvil path does not request it. Public dRPC briefly
returned HTTP 429 during investigation. The harness now paces reads, uses bounded
backoff, and reuses responses only for immutable numeric-block reads within the
current process.

The test remains opt-in and sends every transaction to the local fork. Its
localhost proxy permits only remote read methods and rejects fallback state
requests after the pinned block. Impersonation and native gas funding occur
locally; no ERC-20 balance, protocol storage, reward entitlement or NFT ownership
is overridden. Process cleanup is awaited; a read-only process check after the
successful run found no leftover Anvil or fork-test process.

Run the recorded gate after `npm ci`, from the `prototypes` directory with Node.js 24:

```sh
RIFTWELL_KITTEN_FORK=1 \
RIFTWELL_HYPEREVM_RPC=https://hyperliquid.drpc.org \
RIFTWELL_KITTEN_FORK_ENGINE=anvil \
RIFTWELL_KITTEN_FORK_BLOCK=47471441 \
RIFTWELL_KITTEN_TOKEN_ID=18371 \
RIFTWELL_KITTEN_CLOSED_PERIOD=2960 \
RIFTWELL_KITTEN_EVIDENCE_FILE=docs/evidence/kitten-fork/recheck.json \
node --test test/kitten-fork.test.ts
```

The RPC must retain genuine state at the selected block. For a fresh deployment
review, choose a validated recent block and a genuinely unclaimed nonzero
position, then review implementation hashes and ownership again. A zero claim
is recorded as unproven and cannot satisfy the recipient gate.

## Voting periods, transfers and release

For NFT 18373, current period `2961` returned voted=true and the primary pool's
weight; next period `2962` returned voted=false and empty votes. Owner `vote`
simulation succeeded despite current-period voted=true. The Pashov review's
escrow transfer guard checks the **next** period, and the previously saved
marketplace research simulated successful transfers for two NFTs flagged voted
in the current period. Therefore current-period `checkPeriodVoted` or the generic
`voted` getter alone is not a valid transferability rule.

Use complete transfer simulation at the latest state and expose the actual
reason a NFT cannot move. A vault voting for the next period can temporarily
prevent collateral return until the epoch flips. A debt-free loan should enter a
closing state that stops keeper revoting; the interface must explain any epoch
wait rather than promise immediate release.

`locked` is collateral amount and expiry, not current voting power.
`balanceOfNFT` is current voting power and can decay. At the observed head,
NFT 18373 returned `1023182098347841257487735` raw voting power. Model capacity
from realized rewards with an expiry bound and conservative assumptions, not a
permanent assumption that a newly bought lock earns the seller's displayed APR.

## Safe original adapter design

- Each loan owns its NFT in an isolated vault. The vault gives no ERC-721 blanket
  approvals to keepers, reward contracts or swap targets.
- Borrower/authorized keeper actions are typed voting and typed reward claims.
  There is no generic arbitrary execution method.
- Resolve reward addresses from official `Voter.getGauge(pool)`. A contract
  claiming `voter()==Voter` and `veKitten()==escrow` alone can lie; it must also
  match the official registry for the selected pool. Review legacy/killed reward
  treatment with the integration maintainers before broadening the allowed set.
- Supply a closed period and one explicit allowed reward token to direct claims.
  Measure the vault's actual balance change. Only realized supported stablecoin
  proceeds enter the debt ledger. Repeated zero claims must not accrue invented
  credit or fees.
- Only the lending manager can apply USDC proceeds to lender principal/interest,
  send borrower surplus, and return the exact NFT after debt repayment. Keep the
  reward asset, protocol fee and lender return separate.
- Block arbitrary token swaps, unbounded approvals, arbitrary reward targets,
  NFT merges/splits, reward redirection, and lock mutations that violate debt
  terms. Any future bounded swap adapter receives its own review and tests.
- Rebases are a distinct path; if they compound KITTEN into the lock, that is not
  USDC repayment. Do not count compounded collateral as cash for lenders.

## Mandatory release evidence with the integration maintainers

1. Obtain the current canonical implementations/ABIs and review upgrade
   coordination. Verify deployment bytecode and owner/timelock roles.
2. On a reliable archive fork, transfer an actual live NFT into a deployed test
   custody vault; show typed vote works with the vault as current owner.
3. Claim a **nonzero closed-period reward** and prove by vault token balances and
   receipts that the vault receives it. Repeat after an NFT ownership transfer,
   and establish whether earlier unclaimed periods follow the token or remain
   with the seller. Disclose the result in sale/loan terms.
4. Prove borrower, unrelated account, keeper, prior owner and approved operator
   permissions; ensure a supplied malicious reward/swap contract cannot move
   the NFT, gain approvals, redirect proceeds or reenter debt processing.
5. Establish current epoch claim behavior and incremental claims. The Pashov
   review marks finding L14 (early-current-period claim loss) **Resolved**. This
   is not an allegation that the live bug persists. Confirm the deployed fix,
   then decide whether claiming current accrued rewards is safe and useful.
6. Test collateral release before/after vote and epoch flip, paid-off keeper
   behavior, lock expiry, reward tokens changing and protocol upgrades.
7. Agree supported normal lock types, reward settlement, holder communication,
   pilot funding and support with the integration maintainers. No attached/managed/permanent lock
   support should be implied without specific evidence.

The recorded fork satisfies the observed nonzero contract-recipient, ownership
transfer, typed vote and epoch release checks for its pinned implementations.
Keep production reward automation explicitly unverified/disabled until the
remaining release evidence and integration review with the integration maintainers are complete.
Local mock success is useful development evidence, not a replacement for those
remaining gates or verification after a protocol upgrade.

## Primary references

- [Kitten deployed contracts](https://docs.kittenswap.finance/)
- [Current Voter proxy](https://hyperevmscan.io/address/0xb7f7053f7e6c210e6777d5ba758e4b3eca6c88a0)
- [Current escrow proxy](https://hyperevmscan.io/address/0x29d3a21ff35a519e00cf6d272f2ad897b109bd84)
- [Inspected Voter implementation](https://hyperevmscan.io/address/0x957685ab613965edb7e4964e7698f192370e1284)
- [Inspected sample reward implementation](https://hyperevmscan.io/address/0xb390c8c641a1fb3f786b9cabacef14e594ef82f1)
- [Pashov KittenSwap review, 31 July 2025](https://github.com/pashov/audits/blob/master/team/pdf/KittenSwap-security-review_2025-07-31.pdf)
- Current first-party app ABI snapshot and saved RPC data in the research output
  directory named above. The live permission probes, registry values and existing
  receipt were collected through read-only HyperEVM RPC calls during this task.
