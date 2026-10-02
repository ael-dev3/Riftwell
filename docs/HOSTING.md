# Frontend hosting

`npm run build` produces a static `dist/` directory. Deploy its contents to an HTTPS static host; no server secrets or user wallet keys exist in this frontend. The frontend uses hash navigation, so a server-side route rewrite is unnecessary.

The current Vite base targets the domain root. For subdirectory hosting, configure Vite's `base` and verify asset paths under that exact URL. A custom domain or root preview deployment works directly.

Recommended HTTP headers: `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and an appropriate Content Security Policy permitting this site's locally bundled styles/scripts/assets. The portal uses local CSS/SVG; no font or media CDN allowance is necessary. Test a CSP against the deployed build before enabling it; React and the interface use style attributes for visual state.

Cache hashed `/assets/` files immutably. Revalidate `index.html` so a new release cannot leave clients pointed at missing bundles. Enable compression at the host and verify mobile layout, keyboard dialogs and reduced motion at the public URL.

Deployment is intentionally separate from source publication. This repository introduces no GitHub Actions workflows, deployment credentials, contract deployment scripts or automatic funded release.
