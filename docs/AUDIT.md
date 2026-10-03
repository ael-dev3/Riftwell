# Production audit — 3 October 2026

A review of the integrated frontend in preview and connected modes, the service's browser-facing behavior and the hosting configuration, for security, correctness, design and motion. It records what was checked, what changed and what remains open. It is an internal engineering review, not an independent security audit.

## Security

**Changed**

- Static hosts such as GitHub Pages cannot send response headers, so the Pages preview had no Content-Security-Policy. Production builds now carry the policy in a meta tag: scripts, styles, fonts and connections limited to the same origin, local and data images, no plugins, and same-origin form targets and base URLs, plus a same-origin referrer policy. A connected build with a separate API, as bearer sessions use, allows exactly that `VITE_API_BASE` origin in `connect-src`. `frame-ancestors` and `upgrade-insecure-requests` stay in the headers: a meta tag cannot carry the first, and the second would break local HTTP previews.
- The service header and `firebase.json` allowed inline styles. The application sets styles through the DOM, which the policy does not restrict, so `style-src` is now `'self'` in the build, the service header and `firebase.json`. A service test asserts it; both browser suites ran under the stricter policy without a violation. The live Firebase site keeps its previous header until its next deploy.

**Reviewed without changes**

- Frontend: no raw-HTML rendering, `eval` or dynamic script creation; every external link opens with `rel="noreferrer"`; saved preview data is size-limited and validated field by field before use; amounts are parsed as exact decimal strings. In connected mode the client talks only to its configured API origin, bearer origins must be exact HTTPS origins, and bearer tokens live only in memory.
- Service: the request hook sends the policy, `nosniff`, `frame-ancestors 'none'`, opener isolation, a same-origin referrer policy and, in production, HSTS; it rejects encoded or non-canonical paths before any handler runs. Every mutation requires the exact configured Origin. Bearer-mode CORS allows only that origin and the supported methods and headers, without credentials. Sign-in challenges expire after five minutes and are consumed once inside a transaction. Session tokens are 32 random bytes stored only as HMAC digests. CSRF tokens are derived per session and compared in constant time. Logs redact cookies, authorization and CSRF headers.
- Dependencies: `npm audit` reports no known advisories for the frontend (production and development) or the service's production dependencies on 3 October 2026.

**Open**

- The per-address sign-in limit (ten challenges per fifteen minutes) lets a third party delay sign-in for one address; each IP is limited separately.
- Without a trusted proxy setting on Deno, per-IP limits may group every visitor behind the provider's ingress address, so one busy client can slow sign-in for others. This needs the provider's ingress contract before `TRUST_PROXY` can be set.
- The single-instance SQLite service keeps rate limits in memory, so they reset on restart. PostgreSQL instances share persistent windows.

## Bugs fixed

- **A reserved listing could lose its buyer.** After a validation error, the connected listing form moved focus to the message one frame later. Editing the buyer address in that frame could leave the field empty, and the listing then saved as public. The message and its focus now appear in the same task. The connected suite caught this intermittently; ten repeated runs of that step now keep the buyer.
- **Searching a token ID could list other positions.** The connected marketplace search also matched digits inside sellers' hexadecimal addresses, so "101" could show unrelated listings. A number, with or without "#", now matches token IDs by prefix; other text still matches names and sellers.
- **Two tabs overwrote each other.** Each tab saved its own copy of the preview, so a change in one tab was lost when the other saved. Tabs now adopt changes saved elsewhere, including the theme.
- **Hidden listings could be swept.** Selections stayed active after filters hid them, and "Buy selected" included them. Only listings in view can be selected, and filtering drops the rest.
- **Sample data aged.** Sample sales and lock dates were fixed, so the 7- and 30-day market views would have emptied within weeks and sample locks would have expired from January 2027. Sample dates now move forward by whole days from when they were written.
- **New pages opened mid-scroll.** Navigating kept the previous page's scroll position. A new page now opens at the top; back and forward keep the browser's scroll restoration.
- **The sales history could show an empty page** ("Page 6 of 5") after a reset. The page index is now clamped.
- **Amount fields rejected harmless input** such as surrounding spaces, ".5" or "5.", including connected listing prices. Input is normalized before exact parsing; saved values stay strictly validated. Whole-token fields accept commas only as thousands separators, so "1,5" is rejected instead of read as 15.
- **The phone context bar clipped the preview status**, and at 320 px the marketplace's volume figure ran into the next column and its last tab was cut off. The bar now keeps the market, countdown and status in view, figures wrap their units, and all four tabs fit.
- **The header moved on every page change**, fading with the page. It now stays still.
- **Connected browser checks could not save screenshots on Windows**, because file URLs were used as paths. They now convert them.

## Design

Each element was checked for a distinct purpose, building on the compact workspaces. Repeated or idle elements were removed:

- Context bar: the page name (already in the navigation and title) and a one-option market menu, now a plain label until a second market exists. The epoch number moved into the countdown's accessible description on phones, and the redundant flip date left the bar (it remains in the tooltip and description).
- Borrow opens on the credit line. Three vault stat cards and their popovers (vault totals belong to Earn) became one liquidity line in the credit card; a second credit meter beside the ring, an always-on utilization pill (now a warning from 80%) and a repeated credit-policy notice are gone; empty sections take one row.
- Earn is one vault card carrying the position and every action. The market and chain chips that repeated the context bar, a second "Your position" card and a card holding a single button are gone.
- Marketplace: no "Demo" pill on rows whose names already say Demo, no per-row copy buttons (a listing's details copy its link), no "Your purchases" card (the history marks your purchases) and a one-line note on how discounts are measured. On phones the listing action shares the collection's row and lock terms scroll in one row, so the first listing appears on the first screen.
- Connected mode: the marketplace opens on its listings, with "List yours" beside Refresh. Lending's launch state is marked once on each card, with a page banner only when the status cannot be read; empty sections take one row and say what applies to signed-in and signed-out visitors; the vault card matches the preview's. An unused connected market view was removed.
- Resources: Statistics folds its repeated disclaimer into the introduction, and the simulator states once that revenue shares are set at launch. Decorative eyebrows above resource titles are gone.
- The full-screen blur behind dialogs was costly to render and smeared transitions. The dimmed overlay remains.

Preview status stays explicit in the context bar, the footer and every confirmation.

## Motion

- The header and context bar hold still while the page beneath them cross-fades.
- Dialogs ease out when closed, and one dialog morphs into the next, such as a purchase into its receipt.
- A position glides between collateral, relayer and wallet when it moves.
- Credit-line and vault figures count between values.
- Toasts and the mobile menu ease out instead of disappearing.

Motion uses transforms and opacity, runs as view transitions where supported and falls back to immediate updates elsewhere. Reduced-motion settings turn it off.

## Verification

See [VALIDATION.md](VALIDATION.md#production-audit--3-october-2026) for test counts, browser checks and bundle sizes.
