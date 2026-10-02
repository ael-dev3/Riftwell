# Riftwell interface direction

A focused NFT marketplace and NFT-backed lending interface. Dark ink backgrounds, the selected market’s accents (light green for KittenSwap), a restrained portal motif. Think a quiet, premium gallery with a little science fiction—not a neon trading terminal. Typography: crisp editorial headings, legible compact UI. Navigation contains exactly Lending and Marketplace. Header brand mark is a custom orbit portal.

Desktop composition: full-width header, a generous two-column hero (headline + large original CSS/SVG portal scene), market selector, tabs/filters above a clean working workspace. Market cards feature original procedural art, not remote URLs. Lending uses a highly legible table/card layout with clearly separated borrow rates and collateral. Supporting details live in accessible dialogs/drawers rather than more navigation sections. Market-accent primary CTA, neutral secondary CTAs, subtle boundaries, small restrained mint success accents.

Production frontend requirements: responsive down to 320px; no horizontal overflow; keyboard accessible inputs/navigation/dialogs; dialog focus containment, Escape dismissal and focus restoration; visible focus; reduced-motion support; semantic labels and appropriate contrast; no external trackers/fonts/media; no console errors; strict TypeScript; realistic loading/empty/error and filtered-empty states; non-working/dead buttons avoided.

The interface is a clearly labelled preview. Data are illustrative. No wallet transactions, signatures, token approval or contract deployment. A meaningful simulated workflow may use the browser's local storage for a sample portfolio and explicitly show its preview status. No fake public live metrics. Portal visuals may animate slowly with transform/opacity and must stay decorative, not block actions.

Fee policy displayed in action reviews and receipts: marketplace seller pays 0.5% of sale price; borrowing pays a one-time 0.5% origination fee. Lender interest is separate. No guarantees or invented live yields. Collateral examples are explicitly labelled demo veKITTEN positions with illustrative KITTEN balances. The supplied KittenSwap logo identifies the only current market; original portal artwork remains decorative.

Content tone: short, calm, useful. No competitors, private collaborators, personal wallets, or private research in the public repository. No inflated "10/10" claims, unsupported security claims or AI marketing boilerplate. Use the name Riftwell consistently.

Implementation ownership for parallel work: root scaffolding, package/dependencies, documentation, prototype migration, QA and publication. App agent owns src/App.tsx, src/data.ts, src/domain.ts, src/domain.test.ts and src/components/*.tsx. Design agent owns src/styles.css and original public SVGs (except brand riftwell.svg), coordinating class hooks with App agent. Neither edits the other's files or package configuration.
