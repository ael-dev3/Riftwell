# Security scope

The connected application stores off-chain expressions of interest. It authenticates EOA wallets with single-use sign-in challenges, uses HttpOnly session cookies and validates Origin plus CSRF tokens on authenticated mutations. Owner checks use confirmed, hash-pinned HyperEVM reads. Public actionable records are withheld when verification fails; creators can still cancel their own off-chain records.

The service does not store wallet keys, request approvals, submit transactions or custody assets. Settlement is disabled on client and API. The GitHub Pages build remains an illustrative preview. Contract-wallet authentication and desktop WalletConnect are not supported.

Drafts under `prototypes/` are experimental, unaudited and unsuitable for real funds until their separate release gates are met. Application tests do not establish contract security or asset economics.

Production requires HTTPS, explicit origin and trusted-proxy settings, a strong persistent session secret, restricted database access, monitored RPC availability and tested backups. See [operations](docs/OPERATIONS.md). Rate limits are single-instance controls, not a substitute for host-level traffic protection.

Do not post keys, seed phrases, personal documents, wallet signatures, RPC credentials or session secrets in issues. Use GitHub private vulnerability reporting if enabled. If unavailable, request a private contact without publishing exploit details.

Passing tests covers the recorded scenarios, not all future dependencies or deployment configurations. This project has not undergone an independent security audit.
