# Hosting modes

## Public preview: Firebase Hosting

[riftwell-ael.web.app](https://riftwell-ael.web.app) serves the static preview with illustrative data. It does not authenticate wallets or enable settlement. GitHub hosts and validates the source; Firebase hosts the frontend, and Deno serves the separately deployed API.

The GitHub workflow validates both application dependency trees, types, formatting and the connected container, then builds the explicit preview at base `/`. It does not publish a site or deploy contracts. Direct provider deployment remains separate from source publication and CI.

```sh
npm ci --ignore-scripts
npm ci --prefix server
npm run test
npm --prefix server test
VITE_APP_MODE=preview VITE_SESSION_TRANSPORT=cookie VITE_API_BASE= npm run build -- --base=/
npm run preview -- --base=/ --port 5192
```

Run preview browser checks with `RIFTWELL_PREVIEW_URL=http://127.0.0.1:5192/ npm run test:ui`. Firebase's configured security headers, caching and SPA fallback require verification after each frontend release.

## Firebase frontend and Deno backend

Firebase Hosting configuration is supplied in `firebase.json` for the default `PROJECT_ID.web.app` domain. It publishes only `dist/`, supports SPA fallback, disables caching for HTML and unversioned files, and caches hashed Vite assets immutably. Build at base `/`.

Publish the explicit preview build first. A connected Firebase build requires a verified Deno Deploy backend, durable PostgreSQL, an exact Firebase `APP_ORIGIN`, `SESSION_TRANSPORT=bearer` on the server, and `VITE_SESSION_TRANSPORT=bearer` plus the verified `VITE_API_BASE` at frontend build time. Bearer sessions stay in browser memory; refreshing requires wallet sign-in again. This mode does not rely on cross-site cookies between `web.app` and `deno.net`.

Use the [Firebase and Deno guide](FIREBASE_DENO.md) for local checks, direct CLI deployment and required host evidence. Project IDs, endpoints and release evidence must come from the actual provisioned services. Prepared configuration alone does not establish a live deployment.

The integrated source is published on GitHub, and Firebase serves the redesigned preview. Earlier Pages deployment failures and the retirement of that unused target are recorded in [publication and hosted evidence](VALIDATION.md#publication-and-hosted-preview--3-october-2026). Repository validation triggers and required checks are preserved.

## Connected application: single service host

For the same-origin cookie mode, build with `VITE_APP_MODE=connected` and leave `VITE_API_BASE` unset. The Node service serves the built frontend and `/api/v1` from one origin. The API rejects unsafe requests from any other origin. Cookie sessions require this hosting arrangement; use the bearer configuration above for the separate Firebase and Deno hosts.

Use the [deployment instructions](OPERATIONS.md), or run Node 24 behind HTTPS with persistent SQLite storage and an exact `APP_ORIGIN`. The service sets tested security headers, revalidates HTML and caches hashed assets immutably. Hash navigation supports Borrow, Earn and Marketplace.

Only one application instance may use a local SQLite database. Multiple replicas and network-mounted SQLite are unsupported. Deno Deploy uses managed PostgreSQL rather than a local SQLite file. The deployment contains no contract signer, custody key or automated blockchain transaction service.

## Release evidence

Local browser and API tests use temporary databases and simulated EOA providers. Live RPC smoke checks are read-only. Before exposing a connected host, verify HTTPS, origin/proxy settings, readiness, durable storage, wallet authentication and backup recovery at its actual domain. Record those results separately from local simulations; the supplied hosting configuration is not release evidence. See [validation](VALIDATION.md).
