# Historical evidence context

The recorded run used the predecessor source before project renaming. JSON observations are retained; personal local paths were redacted from TAP output. Historical manifest source/output hashes refer to the original run, not new production verification.

# Financed sale on the pinned live Kitten deployment

The optional financed-sale fork gate passed on 2 October 2026. It extends the
existing custody, typed vote, epoch release and nonzero USDC reward gate without
changing the meaning of its six original checks. The run used the live veKITTEN
NFT **18371** at HyperEVM block **47471441**, hash
`0xdc489fb72c1af10b795dae8337959bedf53b3cda2ee890fa45f0345d483b5205`,
timestamp `2026-10-02T14:02:23Z`.

The report remains `productionClaimsVerified: false` and
`local-gates-passed-release-review-required`. This is evidence for the sampled
NFT, pool, reward token, exact protocol bytecode and recorded predecessor sources.
It is not a production deployment or a completion of the broader launch goal.

## Settlement and cash conservation

The actual NFT owner accepted a funded lender offer and moved the live NFT into
the deployed loan vault. A separate buyer received 20 USDC through a real USDC
transfer from the existing funded account, approved the sale price and bought a
listing created by the borrower. An unrelated lender could not list collateral.

| Settlement item | Raw USDC units | USDC |
| --- | ---: | ---: |
| Buyer payment | 1250000 | 1.250000 |
| One 0.5% sale fee | 6250 | 0.006250 |
| Debt paid into lender credit | 432311 | 0.432311 |
| Residual in separate borrower credit | 811439 | 0.811439 |
| Manager cash after settlement | 1243750 | 1.243750 |

The borrower and lender cash balances did not increase during settlement; their
separate credits were backed by the manager's actual USDC. Both then withdrew
their credits successfully, leaving the manager with its prior balance and both
credit liabilities cleared. The treasury's increase was exactly 6250 units,
the buyer's decrease was exactly 1250000, the debt was zero, the loan and listing
were inactive, and NFT 18371 belonged to the buyer. Receipt events agreed with
these balance and storage reads.

The tiny principal and price were test values selected to make the existing
nonzero reward check practical. They are not an NFT appraisal. Local time was
held at the pinned timestamp through settlement, so this particular sale had
zero accrued interest; the local financed-sale suite separately tests interest
and debt changes between listing and purchase.

## Previously unclaimed rewards after sale

The sampled pool was `0x12df9913e9e08453440e3c4b1ae73819160b513e`, with voting
reward contract `0x75b843855aa873b5bc8f9be04f4ae972b90ee503`. Period **2960** was
closed; current period was 2961. Its **864622 raw USDC units** remained unclaimed
before custody transfer and before the sale, and remained exactly that amount
after the sale.

The previous seller's direct claim reverted. The old loan vault's typed claim
also reverted once it no longer owned the NFT. The actual buyer then called
`getRewardForPeriod(2960, 18371, USDC)` and received exactly 864622 units. The old
seller and vault balances did not increase, and the remaining entitlement became
zero. Thus this previously unclaimed closed-period USDC reward followed the
current NFT owner through the financed sale. Sale terms need to disclose that
result for supported deployments. Rewards already claimed into a loan vault are
a different asset held by that vault; this sale branch did not claim them before
selling.

This result covers one closed period, one pool and USDC. It does not establish
the disposition of every bribe asset, rebase reward, current-period accrual,
legacy/killed gauge, unusual lock type or future upgrade.

## Atomic failure after a next-period vote

The harness restored its local custody snapshot after the successful sale and
buyer reward claim. The original borrower vault then voted for period 2962.
The live transfer simulation failed, and a newly funded and approved buyer
attempted to execute the same sale price against a borrower-created listing.

The purchase was actually mined with receipt status **0**, **277083 gas** and no
logs. The complete before/after settlement objects were equal: buyer USDC and
allowance, treasury cash, lender and borrower cash, manager and vault balances,
individual and total credits, complete stored loan and debt, active loan and
listing pointers, NFT custody and reward entitlement. The loan remained active
and the listing remained usable after the rejected purchase. Native gas usage
and transaction nonce are outside this cash comparison.

The original nonzero reward gate then claimed 864622 units into the vault,
repaid 432311 into lender credit, withdrew that credit and the remaining borrower
surplus, advanced to the next period and returned the same NFT. All six original
checks and all nine optional financed-sale checks passed.

## Evidence, source identity and safe reproduction

- [Exact report](evidence/kitten-fork/2026-10-02-anvil-financed-token18371.json)
- [TAP test output](evidence/kitten-fork/2026-10-02-anvil-financed-token18371.tap)
- [Companion manifest](evidence/kitten-fork/2026-10-02-anvil-financed-manifest.json)
- [Harness](../test/kitten-fork.test.mjs)

The report captures source SHA-256 values before compilation, compiler version,
optimizer settings, compiled bytecode identity, actual deployed manager/vault
runtime hashes, the pinned block identity and escrow/Voter/reward implementation
slots and code hashes. It also records USDC code identity. USDC's EIP-1967 slot
was zero; this does not identify it as an EIP-1967 proxy. The companion manifest
hashes the immutable report and test output and documents bytecode hash encoding.

The successful sale transactions occupy zero-based report transaction indexes
6 through 12. They were mined in a disposable snapshot branch, then reverted by
the local snapshot reset. Their receipts are preserved as test evidence; their
hashes are not mainnet transactions. The subsequent rollback and original reward
gate ran from the restored custody state.

```sh
RIFTWELL_KITTEN_FORK=1 \
RIFTWELL_KITTEN_FINANCED_SALE=1 \
RIFTWELL_KITTEN_FORK_ENGINE=anvil \
RIFTWELL_HYPEREVM_RPC=https://hyperliquid.drpc.org \
RIFTWELL_KITTEN_FORK_BLOCK=47471441 \
RIFTWELL_KITTEN_TOKEN_ID=18371 \
RIFTWELL_KITTEN_CLOSED_PERIOD=2960 \
RIFTWELL_KITTEN_EVIDENCE_FILE=/tmp/riftwell-financed-fork.json \
node --test --test-reporter=tap test/kitten-fork.test.mjs
```

Anvil uses a local proxy enforcing a remote read-method allowlist and numeric
block pin. Remote reads are paced, immutable numeric-block responses are cached
only in memory, and retry count and request timeouts are bounded. Every
transaction, impersonation, native gas balance change and snapshot/reset runs
on the disposable local fork. No ERC20 mint, balance override, protocol storage
override or code replacement is used. The run ended with exit code 0, its Anvil
process exited with code 0, and its proxy closed.

The production reward flag remains disabled pending integration and release
review. Broader reward and lock coverage, contract/indexer changes after these
source hashes, independent security review and launch operations require their
own evidence.
