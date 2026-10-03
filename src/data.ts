import type { Asset, AssetCategory } from './domain';
import type { CollateralLimits, LendingState } from './lending';
import { DEFAULT_MARKET } from './markets';

// Fictional veKITTEN positions with illustrative KITTEN balances, not live listings.
// Stable preview IDs preserve existing local receipts and collateral across releases.
// USDC prices and reference values are illustrative, with no price feed:
// every reference value uses the same sample rate of 0.1 USDC per KITTEN.
type Sample = {
  id: string;
  category: AssetCategory;
  price: number;
  underlyingBalance: number;
  lockTerm: string;
  unlockDate: string;
  description: string;
};

const sample = (entry: Sample, index: number): Asset => ({
  ...entry,
  name: `Demo veKITTEN #${entry.id.slice(5)}`,
  collection: 'KittenSwap',
  marketId: DEFAULT_MARKET.id,
  underlyingSymbol: DEFAULT_MARKET.tokenSymbol,
  artwork: `${import.meta.env.BASE_URL}artwork-${index % 6}.svg`,
  referenceValue: entry.underlyingBalance / 10,
  positionId: entry.id.slice(5),
});

export const ASSETS: readonly Asset[] = (
  [
    {
      id: 'rift-041',
      category: 'Short lock',
      price: 4200,
      underlyingBalance: 50000,
      lockTerm: '12 months',
      unlockDate: '2027-10-02',
      description:
        'A fictional vote-escrowed NFT in your demo wallet, holding 50,000 sample KITTEN units. Deposit it to open illustrative credit or list it for sale.',
    },
    {
      id: 'rift-018',
      category: 'Max lock',
      price: 6800,
      underlyingBalance: 80000,
      lockTerm: '24 months',
      unlockDate: '2028-10-01',
      description:
        'A fictional vote-escrowed NFT in your demo wallet, holding 80,000 sample KITTEN units. Its reference value is a fixed example, independent of any live market.',
    },
    {
      id: 'rift-009',
      category: 'Short lock',
      price: 3100,
      underlyingBalance: 40000,
      lockTerm: '6 months',
      unlockDate: '2027-04-02',
      description:
        'A fictional vote-escrowed NFT position holding 40,000 sample KITTEN units. This shorter sample lock illustrates how positions can carry different terms.',
    },
    {
      id: 'rift-027',
      category: 'Long lock',
      price: 5400,
      underlyingBalance: 65000,
      lockTerm: '18 months',
      unlockDate: '2028-04-02',
      description:
        'A fictional vote-escrowed NFT position holding 65,000 sample KITTEN units. Its price and reference value are illustrative USDC amounts.',
    },
    {
      id: 'rift-062',
      category: 'Short lock',
      price: 2600,
      underlyingBalance: 35000,
      lockTerm: '3 months',
      unlockDate: '2027-01-02',
      description:
        'A fictional vote-escrowed NFT position holding 35,000 sample KITTEN units. Its displayed unlock date is part of the example, not verified chain data.',
    },
    {
      id: 'rift-012',
      category: 'Max lock',
      price: 8300,
      underlyingBalance: 100000,
      lockTerm: '24 months',
      unlockDate: '2028-10-01',
      description:
        'A fictional vote-escrowed NFT in your demo wallet, holding 100,000 sample KITTEN units. The longest sample lock carries the most example voting power.',
    },
    {
      id: 'rift-073',
      category: 'Short lock',
      price: 1020,
      underlyingBalance: 12000,
      lockTerm: '9 months',
      unlockDate: '2027-07-01',
      description:
        'A fictional vote-escrowed NFT position holding 12,000 sample KITTEN units, listed below its illustrative reference value.',
    },
    {
      id: 'rift-088',
      category: 'Max lock',
      price: 12600,
      underlyingBalance: 150000,
      lockTerm: '24 months',
      unlockDate: '2028-09-28',
      description:
        'A fictional maximum-lock position holding 150,000 sample KITTEN units. Larger positions carry larger example reward histories.',
    },
    {
      id: 'rift-095',
      category: 'Short lock',
      price: 180,
      underlyingBalance: 2400,
      lockTerm: '6 months',
      unlockDate: '2027-04-08',
      description:
        'A small fictional position holding 2,400 sample KITTEN units. Hide small positions to filter listings like this one.',
    },
    {
      id: 'rift-104',
      category: 'Long lock',
      price: 5000,
      underlyingBalance: 58000,
      lockTerm: '15 months',
      unlockDate: '2028-01-06',
      description:
        'A fictional vote-escrowed NFT position holding 58,000 sample KITTEN units with an illustrative mid-length lock.',
    },
    {
      id: 'rift-117',
      category: 'Short lock',
      price: 1780,
      underlyingBalance: 22500,
      lockTerm: '12 months',
      unlockDate: '2027-10-07',
      description:
        'A fictional vote-escrowed NFT position holding 22,500 sample KITTEN units. Its discount compares the ask with a fixed example reference value.',
    },
    {
      id: 'rift-126',
      category: 'Long lock',
      price: 8450,
      underlyingBalance: 96000,
      lockTerm: '21 months',
      unlockDate: '2028-07-06',
      description:
        'A fictional vote-escrowed NFT position holding 96,000 sample KITTEN units. Values are illustrative and are not chain data.',
    },
    {
      id: 'rift-133',
      category: 'Short lock',
      price: 140,
      underlyingBalance: 1800,
      lockTerm: '7 months',
      unlockDate: '2027-05-06',
      description:
        'A small fictional position holding 1,800 sample KITTEN units, included to demonstrate small-position filtering.',
    },
    {
      id: 'rift-148',
      category: 'Max lock',
      price: 3560,
      underlyingBalance: 40000,
      lockTerm: '24 months',
      unlockDate: '2028-09-28',
      description:
        'A fictional maximum-lock position holding 40,000 sample KITTEN units, listed near its illustrative reference value.',
    },
    {
      id: 'rift-156',
      category: 'Max lock',
      price: 26350,
      underlyingBalance: 310000,
      lockTerm: '24 months',
      unlockDate: '2028-09-28',
      description:
        'The largest fictional position in the preview, holding 310,000 sample KITTEN units. Use it to explore buying into collateral.',
    },
  ] satisfies Sample[]
).map(sample);

/** Positions in the demo wallet at the start of every preview. */
export const STARTING_POSITION_IDS: readonly string[] = [
  'rift-041',
  'rift-018',
  'rift-012',
];
/** Other sellers' sample listings. */
export const LISTINGS: readonly Asset[] = ASSETS.filter(
  (asset) => !STARTING_POSITION_IDS.includes(asset.id),
);
export const LISTING_IDS: readonly string[] = LISTINGS.map((asset) => asset.id);
export const assetById = (id: string): Asset | undefined =>
  ASSETS.find((asset) => asset.id === id);

export const CATEGORIES = [
  'All',
  'Short lock',
  'Long lock',
  'Max lock',
] as const;
/** Positions below this sample balance count as small in marketplace filters. */
export const SMALL_POSITION_KITTEN = 5000;

// An example net historical reward observation, not a forecast or live credit policy:
// one USDC per 1,000 sample KITTEN per seven-day epoch.
const REWARD_MICROS_PER_UNIT = 1000n;
export const SAMPLE_CREDIT_EPOCHS = 40;

/** Example net reward per epoch for a position's locked balance. */
export function rewardMicros(asset: Asset): bigint {
  return BigInt(asset.underlyingBalance) * REWARD_MICROS_PER_UNIT;
}

/** Example credit for a position: its reward × the sample epoch count. */
export function creditMicros(asset: Asset): bigint {
  return rewardMicros(asset) * BigInt(SAMPLE_CREDIT_EPOCHS);
}

type LockChanges = Pick<LendingState, 'lockIncreases' | 'mergedInto'>;

const increase = (changes: LockChanges, id: string) =>
  Object.hasOwn(changes.lockIncreases, id)
    ? Number(changes.lockIncreases[id])
    : 0;

/**
 * A position after preview merges and lock increases: its own units, any
 * increases and every position merged into it, with the latest unlock date.
 */
export function positionView(asset: Asset, changes: LockChanges): Asset {
  let units = 0;
  let latest = asset;
  const visit = (item: Asset, depth: number) => {
    units += item.underlyingBalance + increase(changes, item.id);
    if (item.unlockDate > latest.unlockDate) latest = item;
    // The ledger rejects merge cycles; the depth bound is a second guard.
    if (depth >= ASSETS.length) return;
    for (const [source, target] of Object.entries(changes.mergedInto)) {
      const merged = target === item.id ? assetById(source) : undefined;
      if (merged) visit(merged, depth + 1);
    }
  };
  visit(asset, 0);
  if (units === asset.underlyingBalance && latest === asset) return asset;
  return {
    ...asset,
    underlyingBalance: units,
    referenceValue: units / 10,
    // Keep the original ask's discount to reference value.
    price: Math.round((asset.price * units) / asset.underlyingBalance),
    unlockDate: latest.unlockDate,
    lockTerm: latest.lockTerm,
    category: latest.category,
    description: `A fictional vote-escrowed NFT, now holding ${units.toLocaleString('en-US')} sample KITTEN units after preview merges or lock increases.`,
  };
}

/** Credit limits for every sample position, after merges and increases. */
export function collateralLimits(changes: LockChanges): CollateralLimits {
  return Object.fromEntries(
    ASSETS.map((asset) => [
      asset.id,
      creditMicros(positionView(asset, changes)).toString(),
    ]),
  );
}

// Retained for the previous preview ledger and its stored records.
// Owned marketplace positions are distinct from public listings and lending collateral.
export const OWNED_MARKET_ASSETS: readonly [Asset, Asset, Asset] = [
  {
    id: 'market-owned-101',
    name: 'Demo veKITTEN #101',
    collection: 'KittenSwap',
    marketId: DEFAULT_MARKET.id,
    underlyingSymbol: DEFAULT_MARKET.tokenSymbol,
    category: 'Short lock',
    artwork: `${import.meta.env.BASE_URL}artwork-1.svg`,
    price: 1200,
    referenceValue: 1500,
    underlyingBalance: 15000,
    lockTerm: '6 months',
    unlockDate: '2027-04-02',
    positionId: '101',
    description:
      'A fictional owned marketplace position with 15,000 sample KITTEN units.',
  },
  {
    id: 'market-owned-202',
    name: 'Demo veKITTEN #202',
    collection: 'KittenSwap',
    marketId: DEFAULT_MARKET.id,
    underlyingSymbol: DEFAULT_MARKET.tokenSymbol,
    category: 'Long lock',
    artwork: `${import.meta.env.BASE_URL}artwork-3.svg`,
    price: 2000,
    referenceValue: 2400,
    underlyingBalance: 24000,
    lockTerm: '18 months',
    unlockDate: '2028-04-02',
    positionId: '202',
    description:
      'A fictional owned marketplace position with 24,000 sample KITTEN units.',
  },
  {
    id: 'market-owned-303',
    name: 'Demo veKITTEN #303',
    collection: 'KittenSwap',
    marketId: DEFAULT_MARKET.id,
    underlyingSymbol: DEFAULT_MARKET.tokenSymbol,
    category: 'Max lock',
    artwork: `${import.meta.env.BASE_URL}artwork-5.svg`,
    price: 5100,
    referenceValue: 6000,
    underlyingBalance: 60000,
    lockTerm: '24 months',
    unlockDate: '2028-10-01',
    positionId: '303',
    description:
      'A fictional owned marketplace position with 60,000 sample KITTEN units.',
  },
];
export const ALL_MARKET_ASSETS: readonly Asset[] = [
  ...ASSETS.slice(0, 6),
  ...OWNED_MARKET_ASSETS,
];
