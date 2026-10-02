# Hosting modes

## Public preview: GitHub Pages

[ael-dev3.github.io/Riftwell](https://ael-dev3.github.io/Riftwell/) serves the static preview with illustrative data. It does not host the backend, authenticate wallets or enable settlement.

The Pages workflow validates both application dependency trees, builds the default frontend with base `/Riftwell/` and publishes only `dist/`. Actions are pinned to commit revisions. The workflow never installs the Solidity toolchain or deploys contracts. Unrelated prototype or documentation changes do not deploy the site.

```sh
npm ci --ignore-scripts
npm ci --prefix server
npm run test
npm --prefix server test
npm run build -- --base=/Riftwell/
npm run preview -- --base=/Riftwell/ --port 5192
```

Run preview browser checks with `RIFTWELL_PREVIEW_URL=http://127.0.0.1:5192/Riftwell/ npm run test:ui`. GitHub Pages controls its own HTTP headers and caching; this repository does not claim custom security headers there.

## Firebase frontend and Deno backend

Firebase Hosting configuration is supplied in `firebase.json` for the default `PROJECT_ID.web.app` domain. It publishes only `dist/`, supports SPA fallback, disables caching for HTML and unversioned files, and caches hashed Vite assets immutably. Build at base `/`; the GitHub Pages base `/Riftwell/` is specific to Pages.

Publish the explicit preview build first. A connected Firebase build requires a verified Deno Deploy backend, durable PostgreSQL, an exact Firebase `APP_ORIGIN`, `SESSION_TRANSPORT=bearer` on the server, and `VITE_SESSION_TRANSPORT=bearer` plus the verified `VITE_API_BASE` at frontend build time. Bearer sessions stay in browser memory; refreshing requires wallet sign-in again. This mode does not rely on cross-site cookies between `web.app` and `deno.net`.

Use the [Firebase and Deno guide](FIREBASE_DENO.md) for local checks, direct CLI deployment and required host evidence. Project IDs, endpoints and release evidence must come from the actual provisioned services. Prepared configuration alone does not establish a live deployment.

The [GitHub publication status](VALIDATION.md#publication-status) remains unchanged. Firebase and Deno uploads do not publish local source to GitHub or update the existing Pages release. Repository Actions workflows remain unchanged.

## Connected application: single service host

For the same-origin cookie mode, build with `VITE_APP_MODE=connected` and leave `VITE_API_BASE` unset. The Node service serves the built frontend and `/api/v1` from one origin. The API rejects unsafe requests from any other origin. Cookie sessions require this hosting arrangement; use the bearer configuration above for the separate Firebase and Deno hosts.

Use the [deployment instructions](OPERATIONS.md), or run Node 24 behind HTTPS with persistent SQLite storage and an exact `APP_ORIGIN`. The service sets tested security headers, revalidates HTML and caches hashed assets immutably. Hash navigation supports both main sections.

Only one application instance may use a local SQLite database. Multiple replicas and network-mounted SQLite are unsupported. Deno Deploy uses managed PostgreSQL rather than a local SQLite file. The deployment contains no contract signer, custody key or automated blockchain transaction service.

## Release evidence

Local browser and API tests use temporary databases and simulated EOA providers. Live RPC smoke checks are read-only. Before exposing a connected host, verify HTTPS, origin/proxy settings, readiness, durable storage, wallet authentication and backup recovery at its actual domain. Record those results separately from local simulations; the supplied hosting configuration is not release evidence. See [validation](VALIDATION.md).
