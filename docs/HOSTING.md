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

## Connected application: service host

Build with `VITE_APP_MODE=connected`. The Node service serves the built frontend and `/api/v1` from the same origin. The API rejects unsafe requests from any other origin. Cross-origin wallet sessions are intentionally unsupported: do not point a Pages connected build at an unrelated API domain.

Use the [deployment instructions](OPERATIONS.md), or run Node 24 behind HTTPS with persistent SQLite storage and an exact `APP_ORIGIN`. The service sets tested security headers, revalidates HTML and caches hashed assets immutably. Hash navigation supports both main sections.

Only one application instance may use the database. Multiple replicas and network-mounted SQLite are unsupported. The deployment contains no contract signer, custody key or automated blockchain transaction service.

## Release evidence

Local browser and API tests use temporary databases and simulated EOA providers. Live RPC smoke checks are read-only. A public connected host has not been provisioned. Before exposing one, verify HTTPS, origin/proxy settings, readiness, durable storage and backup recovery at its actual domain. See [validation](VALIDATION.md).
