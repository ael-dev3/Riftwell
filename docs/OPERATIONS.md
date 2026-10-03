# Connected application operations

## Scope

Riftwell supports two deployments: a single-instance Node 24 service with persistent SQLite and same-origin cookie sessions, or Firebase Hosting with an API-only Deno Deploy service and shared PostgreSQL. Settlement is hard-disabled. There are no custody keys, backend signers or payment rails.

The live Firebase frontend remains a static preview. Source publication does not itself provision a connected service. Provider setup and host verification are recorded separately in the [current release evidence](VALIDATION.md#publication-and-hosted-preview--3-october-2026).

GitHub Actions validates frontend/server tests, types, formatting, the connected container and the preview build. Hosting releases use the direct Firebase and Deno tools; CI has no Pages deployment or Pages/OIDC write permissions. Preserve all validation checks and the conservative publication preflight.

## Firebase and Deno Deploy

Firebase project `riftwell-ael` serves the preview at `https://riftwell-ael.web.app`. Use that exact origin consistently; the `firebaseapp.com` alias is a different origin. Deno organization `ael-dev3`, application `riftwell`, serves the API at `https://riftwell.ael-dev3.deno.net`. Revision `y91af7xr00p2` passed the rollout continuity checks recorded in [validation](VALIDATION.md). The connected frontend build has not replaced the preview; recovery and actual-wallet verification remain release checks. Follow [the deployment guide](FIREBASE_DENO.md); no GitHub Actions job is needed for direct provider uploads.

Deno runs `server/index.ts` with `NODE_ENV=production`, `HOST=0.0.0.0`, `API_ONLY=true`, `SESSION_TRANSPORT=bearer`, the exact frontend `APP_ORIGIN`, a stable `SESSION_SECRET`, an HTTPS RPC endpoint and a TLS-protected `DATABASE_URL`. Set `NODE_ENV` only in Production and Preview, so build-time installation includes TypeScript. The managed URLs omit a database path; the separately verified `PGDATABASE=postgres` supplies it in those two runtime contexts. Configure `deno task migrate` as the pre-deploy command. `server/deno.json` supplies the tasks; `server/migrate.ts` checks the PostgreSQL schema. Production and preview databases and secrets are separate; local instance files are not durable storage.

PostgreSQL transactions coordinate writes across instances, including challenge consumption, listing revisions, idempotency and audit records. Rate-limit windows are shared in PostgreSQL and survive cold starts. Bearer sessions stay only in frontend memory; refresh requires another wallet sign-in. Keep session secrets stable across instances. Do not weaken exact-origin CORS or CSRF checks to accommodate separate provider domains.

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

For this combined SQLite service, production requires `NODE_ENV=production`, exact HTTPS `APP_ORIGIN`, absolute persistent `DB_PATH`, `SESSION_SECRET` of at least 32 bytes and `HYPEREVM_RPC_URL`. Set `DIST_PATH` to the frontend build. Missing settings or a temporary production database path prevent startup. `server/.env.example` documents both storage and transport choices; configure `DB_PATH` or `DATABASE_URL`, never both. Environment files must be loaded explicitly by a process manager or Node's `--env-file` flag.

## Monitoring

- `/health/live` checks process responsiveness. The container uses this endpoint.
- `/health/ready` checks the selected database and a fresh confirmed RPC read. It returns 503 when dependencies are unavailable. Monitor separately; an RPC outage should not cause repeated process restarts.
- Both health responses include an opaque `runtime.instanceId` and real `runtime.startedAt`, stable for that application lifetime, with `Cache-Control: no-store`. Health and API responses carry the same `X-Riftwell-Instance` ID, and startup/completed shutdown logs use it too. These contain no host, credential or wallet identifiers. A changed ID distinguishes a new service instance from a repeated request; it does not by itself prove cold-start persistence or replica consistency. Record the serving IDs alongside synthetic session, challenge and record checks on an isolated preview. Keep revision rollout evidence separate from a same-revision restart, and verify production independently before making production claims.
- Responses include `X-Request-ID`; JSON errors expose safe codes. Logs redact cookies, Authorization and CSRF headers and omit request bodies, signatures and RPC credentials.
- Alert on sustained readiness failures, disk usage, repeated 5xx responses, restarts and backup failures. Rotate logs and archive older off-chain history according to your retention policy.

Sessions expire after eight hours; sign-in challenges after five minutes. Challenges are consumed atomically. Rotating `SESSION_SECRET` invalidates sessions and cursors; records persist. Authentication supports EOA browser providers. Contract wallets and desktop WalletConnect require future integration.

The chain reader bounds concurrency, payloads and retries. It requires a fresh head and canonical hash-pinned block. Public pages are bounded. Account history returns the most recent 500 entries of each type with a truncation flag. Position pagination uses short-lived block-pinned cursors; refresh the account when one expires. Public records are unavailable on RPC failure, while owner history remains accessible for cancellation.

## Backups and restore

The following command backs up **SQLite only**. Use an online backup rather than copying an open database without its WAL. Choose a new destination; the command refuses overwriting files and verifies SQLite integrity.

```sh
node server/backup.ts /absolute/riftwell.sqlite /absolute/backup-20261002.sqlite
```

For Docker, run this command via `docker compose exec app`, using `/var/lib/riftwell/` paths, then copy the backup off the container with `docker compose cp`. Encrypt backups off-host and restrict access: they include wallet addresses, records and authentication hashes. Store secrets separately. Test recovery periodically on an isolated service.

Restore with the service stopped. Preserve the current database and WAL/SHM as a rollback set; install the verified backup at `DB_PATH`, remove old WAL/SHM from that restored path and set permissions for the runtime user. Start and check readiness and records. Never swap a running database. Retain the matching release image; older code may reject a newer schema. Back up before upgrades.

### PostgreSQL

The SQLite command does not protect PostgreSQL. A manual logical backup is available for schema version 2:

```sh
node --env-file=/private/config/riftwell-backup.env server/postgres-backup.ts /private/backups/riftwell-20261002
```

Use a new absolute destination directory outside the source repository. Supply `DATABASE_URL` through a protected environment file or secret manager, not command arguments. `PGDATABASE` supplies the database name only when the URL has no path. Set `PG_CLIENT_BIN` to an absolute directory containing native `pg_dump`, or install it on `PATH`. Its major version must be at least the source server's major version. Remote connections require verified TLS; `RIFTWELL_BACKUP_CA_FILE` can select a trusted CA file when system trust is insufficient. Extra URL connection overrides are rejected.

The utility holds a read-only, repeatable-read snapshot while native `pg_dump` creates a custom-format archive of exactly the nine public application tables and their owned sequences. Unrelated tables and schemas are excluded; missing selected tables cause failure. It records schema version, those table counts and a streamed SHA-256 checksum. The new directory has mode 0700; `riftwell.pgdump` and `manifest.json` have mode 0600. Temporary password files are removed on success or failure, and partial archives are removed on failure. Existing destinations are refused. A killed process or host crash can leave temporary files; inspect failed destinations privately. The archive contains wallet records, authentication hashes and audit history, so encrypt it for off-host retention and keep credentials separately. New external schema/type dependencies would require an explicit backup design and restore test; table selection does not include arbitrary dependencies.

Verify the archive checksum before recovery. Restore into a separate empty database with compatible extensions and a trusted native `pg_restore`; use `--no-owner --no-acl --exit-on-error --single-transaction`. Provide connection settings through the environment and a protected password file. Confirm schema version 2, compare every table count with the manifest, inspect representative records, and test application readiness before any production switch. Counts and a checksum do not alone prove a complete operational recovery. Retain the matching source release and rollback database; do not restore over the serving database.

Deno's managed Prisma integration has not established automated backup retention, recovery access or point-in-time recovery for this instance. Record confirmed provider capabilities separately. The manual utility does not schedule backups, enforce retention, encrypt archives or provide point-in-time recovery. Verify an isolated restore and agree retention before accepting production records, and repeat recovery checks after schema changes.

## Public release checks

Run frontend, server and browser checks locally; inspect the diff and follow Actions guidance before remote triggers. On the chosen host, verify startup, HTTPS, proxy/origin handling, wallet sign-in, an owned-position read, persistent restart and backup recovery. For separate frontend/API hosts, also verify preflight handling, shared PostgreSQL writes and limits, and memory-only sessions from the actual frontend origin. Confirm RPC failures hide public actionable records and funded endpoints remain disabled. These are required host checks; simulations do not replace them.
