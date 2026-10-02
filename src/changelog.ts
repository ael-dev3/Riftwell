// Release notes shown in "What's new". Entries describe changes that exist in
// this repository; links point to its public documentation.
export type ReleaseNote = {
  id: string;
  date: string;
  kind: 'Update' | 'Docs';
  title: string;
  summary: string;
  href?: string;
};

const DOCS = 'https://github.com/ael-dev3/Riftwell/blob/main/docs';

export const RELEASE_NOTES: readonly ReleaseNote[] = [
  {
    id: 'interface-redesign',
    date: '2026-10-02',
    kind: 'Update',
    title: 'Borrow, Earn and Marketplace',
    summary:
      'A rebuilt interface with a reward relayer, private listings, market history and statistics.',
  },
  {
    id: 'pooled-lending',
    date: '2026-10-02',
    kind: 'Docs',
    title: 'How pooled lending works',
    summary:
      'USDC vault shares and collateral credit lines replace fixed-term loan offers.',
    href: `${DOCS}/LENDING.md`,
  },
  {
    id: 'connected-app',
    date: '2026-10-02',
    kind: 'Update',
    title: 'Connected application',
    summary:
      'Wallet sign-in, verified ownership reads and durable off-chain listings.',
    href: `${DOCS}/API.md`,
  },
  {
    id: 'kittenswap-market',
    date: '2026-10-02',
    kind: 'Update',
    title: 'KittenSwap is the first market',
    summary: 'veKITTEN positions on HyperEVM, with a light-green market theme.',
  },
];
