# Connected application operations

## Scope

Riftwell is a single-instance Node 24 service with SQLite on local persistent storage. It serves the connected frontend and API from one HTTPS origin. Settlement is hard-disabled. There are no custody keys, backend signers or payment rails.

Pages continues to host the static preview. The connected service needs a host and domain; publishing source does not provision them. Docker and Caddy configuration are supplied, but container execution and final public deployment need verification on the chosen host.

## Docker and HTTPS

Requirements: Docker Engine and Compose on Linux, a domain pointing to the host, TCP ports 80/443 (UDP 443 optional), persistent local storage and an RPC endpoint supporting EIP-1898 block-hash references with `requireCanonical` for HyperEVM chain 999.

```sh
cp deploy/.env.example deploy/.env
```

Fill `RIFTWELL_DOMAIN`, `SESSION_SECRET` and `HYPEREVM_RPC_URL`. Generate the secret with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Keep it outside Git. Never use a wallet key as a session secret.

```sh
chmod 600 deploy/.env
docker compose --env-file deploy/.env -f deploy/compose.yaml config --quiet
docker compose --env-file deploy/.env -f deploy/compose.yaml up --build -d
```

Only Caddy exposes public ports. The service trusts Caddy's fixed `10.89.0.2` proxy address. If the subnet conflicts with the host, update the network, both container addresses and `TRUST_PROXY` together. Never trust arbitrary forwarded headers.

Images are pinned to manifest digests. The runtime uses a non-root user, read-only root filesystem, dropped capabilities and the `application-data` volume. Do not remove that volume during upgrades or run `down --volumes` against live data.

## Native service

Use Node 24, `npm ci --ignore-scripts` at the root and `npm ci --prefix server` for the native SQLite binding. Build `VITE_APP_MODE=connected npm run build`. Run `node server/index.ts` under a service manager behind HTTPS.

Production requires `NODE_ENV=production`, exact HTTPS `APP_ORIGIN`, absolute persistent `DB_PATH`, `SESSION_SECRET` of at least 32 bytes and `HYPEREVM_RPC_URL`. Set `DIST_PATH` to the frontend build. Missing settings or a temporary production database path prevent startup. `server/.env.example` documents optional settings; environment files must be loaded explicitly by a process manager or Node's `--env-file` flag.

## Monitoring

- `/health/live` checks process responsiveness. The container uses this endpoint.
- `/health/ready` checks SQLite and a fresh confirmed RPC read. It returns 503 when dependencies are unavailable. Monitor separately; an RPC outage should not cause repeated process restarts.
- Responses include `X-Request-ID`; JSON errors expose safe codes. Logs redact cookies and omit request bodies, signatures and RPC credentials.
- Alert on sustained readiness failures, disk usage, repeated 5xx responses, restarts and backup failures. Rotate logs and archive older off-chain history according to your retention policy.

Sessions expire after eight hours; sign-in challenges after five minutes. Challenges are consumed atomically. Rotating `SESSION_SECRET` invalidates sessions and cursors; records persist. Authentication supports EOA browser providers. Contract wallets and desktop WalletConnect require future integration.

The chain reader bounds concurrency, payloads and retries. It requires a fresh head and canonical hash-pinned block. Public pages are bounded. Account history returns the most recent 500 entries of each type with a truncation flag. Position pagination uses short-lived block-pinned cursors; refresh the account when one expires. Public records are unavailable on RPC failure, while owner history remains accessible for cancellation.

## Backups and restore

Use the online backup command rather than copying an open database without its WAL. Choose a new destination; the command refuses overwriting files and verifies SQLite integrity.

```sh
node server/backup.ts /absolute/riftwell.sqlite /absolute/backup-20261002.sqlite
```

For Docker, run this command via `docker compose exec app`, using `/var/lib/riftwell/` paths, then copy the backup off the container with `docker compose cp`. Encrypt backups off-host and restrict access: they include wallet addresses, records and authentication hashes. Store secrets separately. Test recovery periodically on an isolated service.

Restore with the service stopped. Preserve the current database and WAL/SHM as a rollback set; install the verified backup at `DB_PATH`, remove old WAL/SHM from that restored path and set permissions for the runtime user. Start and check readiness and records. Never swap a running database. Retain the matching release image; older code may reject a newer schema. Back up before upgrades.

## Public release checks

Run frontend, server and browser checks locally; inspect the diff and follow Actions guidance before remote triggers. On the chosen host, verify container startup, HTTPS, proxy/origin handling, wallet sign-in, an owned-position read, persistent restart and backup recovery. Confirm RPC failures hide public actionable records and funded endpoints remain disabled. These are required host checks; simulations do not replace them.
