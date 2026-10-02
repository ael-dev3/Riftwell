# Frontend hosting

The frontend preview is hosted at [ael-dev3.github.io/Riftwell](https://ael-dev3.github.io/Riftwell/). Its collections, balances and actions remain illustrative; hosting does not enable wallet transactions or deploy contracts.

## GitHub Pages

`.github/workflows/pages.yml` tests and builds the frontend, then publishes only `dist/` through the official GitHub Pages actions. It runs on changes to frontend source, assets, dependencies, build configuration or the workflow on `main`; unrelated prototype or documentation changes do not deploy the site. Actions are pinned to verified commit revisions. Deployment uses the repository's `github-pages` environment and GitHub's short-lived token, with no stored deployment secret.

The Pages build uses `/Riftwell/` as its Vite base. Runtime artwork and logo paths use `import.meta.env.BASE_URL`, so they work at that repository URL and with a root deployment. Hash navigation needs no server-side route rewrite.

To reproduce the Pages build locally:

```sh
npm ci --ignore-scripts
npm run test
npm run build -- --base=/Riftwell/
npm run preview -- --base=/Riftwell/ --port 5192
```

Open `http://127.0.0.1:5192/Riftwell/`. Run the browser checks with `RIFTWELL_PREVIEW_URL=http://127.0.0.1:5192/Riftwell/ npm run test:ui`. Verify artwork, both hash routes, keyboard dialogs and mobile layouts at the final public URL after deployment.

## Other static hosts

`npm run build` defaults to the domain root and produces static `dist/` contents. No backend, API key, external media or user wallet key is needed. Set a matching Vite `--base` for other subdirectories.

For hosts with configurable response headers, use `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` and a tested Content Security Policy allowing the locally bundled scripts, styles and assets. React uses style attributes for visual state. GitHub Pages controls its own HTTP headers and caching; this repository does not claim custom header enforcement there.

On a configurable host, cache hashed assets immutably and revalidate `index.html`. The Pages workflow deploys the frontend only; it never installs the prototype toolchain or runs a contract deployment.
