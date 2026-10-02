# Firebase frontend and Deno backend

This deployment uses Firebase Hosting for the static frontend on its default `web.app` domain and current Deno Deploy for the API, backed by managed PostgreSQL. Publish preview mode first. Enable connected mode only after the backend passes the host checks below. Marketplace records remain off-chain; purchases, pooled lending and smart-contract settlement stay disabled.

Firebase project `riftwell-ael` is selected in `.firebaserc`. The reviewed preview is live at [riftwell-ael.web.app](https://riftwell-ael.web.app), with Hosting version `74a5226cee788f58`; its HTML and hashed assets match the local build. Deno application `riftwell` is live in organization `ael-dev3`, revision `n2gtkjk4f2fm`, with the managed PostgreSQL database `riftwell` attached in Frankfurt. The API runtime uses the Europe region, shown as Amsterdam by the provider. Its stable production origin is `https://riftwell.ael-dev3.deno.net`. Production migration and 17 live API checks passed, including database/chain readiness, exact-origin CORS, ephemeral EOA authentication, replay rejection and revocation. The connected frontend release and recovery check remain pending. Keep secrets outside the repository.

## Project and application settings

Use Firebase's default Hosting site and a local-source Deno application. Use the current `deno deploy` CLI, not `deployctl` for retired Deploy Classic. Keep both deployment paths independent of GitHub integration.

```sh
FIREBASE_PROJECT_ID='riftwell-ael'
FIREBASE_ORIGIN="https://${FIREBASE_PROJECT_ID}.web.app"
DENO_ORG='ael-dev3'
DENO_APP='riftwell'
DENO_API_ORIGIN='https://riftwell.ael-dev3.deno.net'
```

Use an exact origin, with no path or trailing slash, for each service URL. The Firebase `firebaseapp.com` alias is a different origin; use the selected `web.app` URL consistently for wallet authentication.

Upload the repository's `server/` directory as the source root. Within that upload, the app directory and working directory are both `.`, and the dynamic entrypoint is `index.ts`. Install locked dependencies with `npm ci --ignore-scripts`, build with `npm run typecheck`, and run `deno task migrate` as the pre-deploy command. `server/deno.json` defines that task; `server/migrate.ts` applies and checks the PostgreSQL schema before production serves traffic. Deno runs TypeScript directly; this path does not use the Docker image or its SQLite volume. Inspect preview startup separately: the observed provider preview timeline skipped the pre-deploy command.

The attached database integration supplies environment-specific `DATABASE_URL` values. Production and preview use separate provider timeline connections and distinct credentials; keep their session secrets separate too. Do not substitute a local SQLite file, an in-memory database or a backup file for managed storage.

The provider's current connection strings omit the database path. Read-only TLS queries on each timeline connection confirmed `current_database()` as `postgres`, so `PGDATABASE=postgres` is explicitly configured for Production and Preview. `loadConfig` uses that validated name only when the URL has no database path; an explicit path remains authoritative, and credentials and TLS options are preserved. This is a verified provider setting, not a generic database-name default. Do not infer a database name from a provider timeline identifier.

Set the following runtime variables in Deno's Production and Preview contexts before accepting traffic. In particular, exclude Build from `NODE_ENV=production`: applying it to Build causes `npm ci` to omit the TypeScript development dependency and fail type checking with `tsc: command not found`.

| Variable             | Value                                                                  |
| -------------------- | ---------------------------------------------------------------------- |
| `NODE_ENV`           | `production`                                                           |
| `HOST`               | `0.0.0.0`                                                              |
| `PORT`               | `8080`                                                                 |
| `APP_ORIGIN`         | Exact verified Firebase `web.app` origin                               |
| `API_ONLY`           | `true`                                                                 |
| `SESSION_TRANSPORT`  | `bearer`                                                               |
| `SESSION_SECRET`     | Stable random secret containing at least 32 bytes                      |
| `HYPEREVM_RPC_URL`   | Reliable HTTPS HyperEVM endpoint supporting canonical block-hash reads |
| `DATABASE_URL`       | Injected TLS connection string for the attached PostgreSQL database    |
| `PGDATABASE`         | `postgres`, verified separately on both current timeline connections   |
| `DATABASE_POOL_SIZE` | `3`                                                                    |

Store `SESSION_SECRET` and credential-bearing RPC settings as secrets. Production and Preview have distinct `SESSION_SECRET` values, each scoped only to its own context. Keep each secret stable across revisions and instances: it keys session-token hashes and cursors. Keep credentials out of frontend build variables, committed files, screenshots and deployment logs. The current credential-free RPC is `https://rpc.hyperliquid.xyz/evm`; actual Deno readiness and a canonical read of veKITTEN #18371 passed. `TRUST_PROXY` remains unset: no trusted Deno ingress address contract was established, so per-IP limits may aggregate users behind a proxy. The Docker example's Caddy address does not apply here.

The frontend keeps bearer sessions only in memory; refresh requires signing in again. Server sessions expire after eight hours by default (`SESSION_TTL_SECONDS=28800`). The API permits exactly `APP_ORIGIN` through CORS, answers supported preflights and preserves Origin and CSRF checks on mutations. Cookie mode remains available for a combined same-origin service; it is not used across these provider domains.

PostgreSQL coordinates transactions and rate-limit windows across instances and cold starts. Run PostgreSQL integration tests with `TEST_DATABASE_URL` pointing to a disposable database, never the production database. The SQLite backup utility does not back up PostgreSQL. The [manual PostgreSQL utility](OPERATIONS.md#postgresql) passes local synthetic backup and isolated restore checks; no production records were exported. Production recovery, automatic backup retention and point-in-time recovery have not been verified for this managed integration.

## Build and review the Firebase preview

From the repository root, use Node 24 and the locked dependencies:

```sh
npm ci --ignore-scripts
npm ci --prefix server
npm run test
npm --prefix server test
npm run typecheck
VITE_APP_MODE=preview VITE_API_BASE= VITE_SESSION_TRANSPORT=cookie npm run build -- --base=/
npm run preview -- --base=/ --port 5192
```

In another terminal, run the preview browser checks against the local URL:

```sh
RIFTWELL_PREVIEW_URL=http://127.0.0.1:5192/ npm run test:ui
```

Confirm Lending and Marketplace load on desktop and narrow screens, preview labels are visible, navigation works after refreshing and the browser makes no backend authentication or settlement requests. The mode is fixed at build time; deploying an existing `dist/` does not change it.

For Firebase configuration checks, use an authenticated Firebase CLI with the confirmed project selected explicitly:

```sh
firebase emulators:start --only hosting --project "$FIREBASE_PROJECT_ID"
```

Inspect the emulator URL reported by the CLI. Check the root, a fallback navigation path and actual hashed JS/CSS files from `dist/index.html`. HTML must return `Cache-Control: no-store`; hashed assets must return `public, max-age=31536000, immutable`. Also check the security headers and content types.

`firebase.json` applies freshness and security headers to all paths, then overrides caching for hashed `/assets/` URLs. Header matching occurs before SPA rewrites, so the general freshness rule also covers fallback HTML. The CSP allows same-origin scripts and fonts, local/data images and the inline styles used by the UI. It restricts base URLs and form submissions to the same origin, blocks embedding and plugins, and upgrades insecure requests. The reviewed connected configuration permits only `'self'` and the verified `https://riftwell.ael-dev3.deno.net` origin in `connect-src`; test the supported wallet flow after publishing it. Firebase manages HTTPS and HSTS on its default domains.

## Local two-origin bearer browser QA

Use Node 24, the frontend and server dependencies installed above, local Chrome, OpenSSL and a disposable PostgreSQL database. Keep ports 5196, 5197 and 5198 available. From the repository root:

```sh
export TEST_DATABASE_URL='REPLACE_WITH_DISPOSABLE_POSTGRESQL_CONNECTION_URL'
export RIFTWELL_BEARER_QA_DIST="$(node -p "require('node:path').join(require('node:os').tmpdir(), 'riftwell-bearer-qa')")"
VITE_APP_MODE=connected VITE_SESSION_TRANSPORT=bearer VITE_API_BASE=https://127.0.0.1:5196 npm run build -- --base=/ --outDir="$RIFTWELL_BEARER_QA_DIST"
npm run test:bearer
```

The harness creates and drops an isolated schema in that database. It runs the built frontend against a separate local HTTPS API with a test certificate, an ephemeral wallet and simulated position reads. It checks CORS, signing in, creating/cancelling an off-chain listing, logging out, token storage and reload behavior, without funds or transactions. This establishes local browser evidence; actual provider TLS, CSP and persistence still need the host checks below.

`RIFTWELL_BEARER_QA_DIST` selects the existing build directory; its default is `riftwell-bearer-qa` inside the operating system's temporary directory. Screenshots and `bearer-browser-report.json` default to `riftwell-bearer-qa-evidence` in the same temporary directory. Set `RIFTWELL_BEARER_QA_OUTPUT` explicitly to retain them elsewhere. Relative overrides resolve from the working directory.

## Direct deployment

Use provider authentication and the confirmed identifiers. Do not run `firebase init` over the supplied Hosting configuration or initialize GitHub deployment workflows.

Deploy the reviewed preview build from the repository root:

```sh
firebase deploy --only hosting --project "$FIREBASE_PROJECT_ID"
```

Record the returned live `web.app` URL, release timestamp and build mode. Verify the actual live responses and browser behavior; an emulator check does not establish public HTTPS evidence.

Provider CLI sign-in is complete for this deployment. The tested Deno deployment combination is the native Deno 2.9.5 CLI with `DENO_DEPLOY_CLI_SPECIFIER=https://jsr.io/@deno/deploy/0.0.9908/main.ts`. The tested Deno 2.9.6 native deployment wrapper duplicated arguments; do not use that wrapper for these uploads. Use the native CLI rather than directly running the deploy module, so its supported keychain authentication remains available.

Use the Deno console to edit environment contexts. The current CLI's `env update-contexts` request failed because it omitted the variable value; the console successfully saved the context changes. The provider's current runtime context labels are Production and Preview, not Development. Do not copy secret values into diagnostic output while changing their scope.

For new local-source applications, validate creation settings first with the CLI's `--dry-run` option. Creation can attempt its first build immediately. Missing production database or runtime settings must fail closed; an initial failed warmup is not a verified backend. Configure the attached database, migrations and runtime secrets before retrying deployment, and fix an identified failure before issuing another upload.

Upload the reviewed backend directly from the backend application directory:

```sh
cd server
DENO_DEPLOY_CLI_SPECIFIER=https://jsr.io/@deno/deploy/0.0.9908/main.ts \
  deno deploy . --org "$DENO_ORG" --app "$DENO_APP" \
  --ignore data --ignore .env --ignore '.env.*' --ignore test --ignore node_modules \
  --no-wait --json --non-interactive
```

This creates a preview revision. After it passes the checks below, deploy the reviewed revision to production:

```sh
DENO_DEPLOY_CLI_SPECIFIER=https://jsr.io/@deno/deploy/0.0.9908/main.ts \
  deno deploy . --org "$DENO_ORG" --app "$DENO_APP" --prod \
  --ignore data --ignore .env --ignore '.env.*' --ignore test --ignore node_modules \
  --no-wait --json --non-interactive
```

Repeat `--ignore` for each exclusion; a comma-separated value is not a list of patterns. Both commands use the uploaded backend directory as their source root, preserving the app directory `.`, rather than uploading the whole repository. Inspect `/health/live`, `/health/ready` and `/api/v1/status` at the stable production origin, along with the build and migration logs. Keep that origin for the frontend rather than a temporary revision URL.

Direct Firebase uploads and local-source Deno uploads do not require repository Actions. The existing [GitHub publication status](VALIDATION.md#publication-status) remains unchanged: these deployments do not publish local source or update GitHub Pages. Before any later GitHub mutation that can start Actions, follow the current approval policy and the complete current-UTC-day run/attempt preflight in [AGENTS.md](../AGENTS.md). Monthly usage remains unknown unless established through the existing read-only access; do not bypass required checks or change triggers to fit a budget.

## Enable connected mode after backend verification

Complete and record these host checks before replacing the Firebase preview:

1. Verify TLS, exact Origin/CORS handling, preflight responses and the selected bearer transport from the actual Firebase origin. Reject unrelated origins.
2. Sign in with a real supported wallet on chain 999. Confirm the signature only authorizes off-chain session access, sessions are absent from persistent browser storage and a refresh requires signing in again.
3. Read an owned position, create and cancel an off-chain listing, and verify idempotent retries and revision conflicts. Confirm a challenge cannot be consumed twice, including concurrent requests.
4. Verify records survive instance restart and a new revision, and that multiple instances use the shared PostgreSQL database. Check the database's actual backup and isolated recovery procedure.
5. Confirm ownership/RPC failures hide public actionable records while creators can cancel their own records. Validate readiness with the production RPC endpoint.
6. Confirm settlement and contract-dependent lending actions remain disabled and produce no transaction, approval or token movement.

Then rebuild the frontend from the repository root with the exact verified production API origin:

```sh
VITE_APP_MODE=connected VITE_SESSION_TRANSPORT=bearer VITE_API_BASE="$DENO_API_ORIGIN" npm run build -- --base=/
```

Review the connected build locally, deploy only Hosting with the same explicit project command, then check the connected UI at the actual Firebase origin. Record the frontend and backend release identifiers together with the resulting browser evidence. Update any CSP `connect-src` directive to include the exact production API origin before that deployment. Keep a verified preview build available for rollback; rebuilding preview mode and deploying its `dist/` restores the explicit static preview without touching backend data.

## References

- [Firebase Hosting configuration](https://firebase.google.com/docs/hosting/full-config)
- [Firebase local checks, previews and deployment](https://firebase.google.com/docs/hosting/test-preview-deploy)
- [Current Deno Deploy CLI](https://docs.deno.com/runtime/reference/cli/deploy/)
- [Deno Deploy databases and migrations](https://docs.deno.com/deploy/reference/databases/)
- [Deno Deploy environment contexts](https://docs.deno.com/deploy/reference/env_vars_and_contexts/)
- [Deno Deploy runtime lifecycle](https://docs.deno.com/deploy/reference/runtime/)
