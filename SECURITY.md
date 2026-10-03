# Security scope

The connected application stores off-chain marketplace listings and historical lending intents. It authenticates EOA wallets with single-use sign-in challenges and validates Origin plus CSRF tokens on authenticated mutations. Owner checks use confirmed, hash-pinned HyperEVM reads. Public actionable records are withheld when verification fails; creators can still cancel their own off-chain records.

The combined same-origin service uses HttpOnly, SameSite=Strict session cookies, with Secure cookies in production. The separate Firebase frontend and Deno API use exactly configured origins and bearer sessions held only in frontend memory; cookies do not authenticate that deployment, and refreshing signs out. Session hashes, challenges and revocation records persist in the selected database.

Injected wallets must support account, chain and disconnect events. Listener setup must succeed before account prompts or authentication requests. Unsupported wallets receive sign-in guidance while public browsing stays available; failed listener cleanup leaves disabled callbacks inert.

The service does not store wallet keys, request approvals, submit transactions or custody assets. Settlement is disabled on client and API. The live Firebase frontend is an illustrative preview; the connected frontend awaits its documented release checks. Contract-wallet authentication and desktop WalletConnect are not supported.

Drafts under `prototypes/` are experimental, unaudited and unsuitable for real funds until their separate release gates are met. Application tests do not establish contract security or asset economics.

Production requires HTTPS, an explicit origin, a strong persistent session secret, restricted database access, monitored RPC availability and tested backups. Trust forwarded client addresses only when the ingress is verified; the current Deno deployment leaves proxy trust unset. PostgreSQL enforces shared rate-limit windows across API instances and restarts; SQLite uses an in-memory limiter for its single-instance deployment. These application limits do not replace host-level traffic protection. See [operations](docs/OPERATIONS.md).

Do not post keys, seed phrases, personal documents, wallet signatures, RPC credentials or session secrets in issues. Use GitHub private vulnerability reporting if enabled. If unavailable, request a private contact without publishing exploit details.

Passing tests covers the recorded scenarios, not all future dependencies or deployment configurations. This project has not undergone an independent security audit.
