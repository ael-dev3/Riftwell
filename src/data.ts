import type { Asset } from './domain';
import { DEFAULT_MARKET } from './markets';

// Fictional veKITTEN positions with illustrative KITTEN balances, not live listings.
// Stable preview IDs preserve existing local receipts across presentation changes.
// USDC prices, collateral references and APRs are illustrative, with no price feed.
export const ASSETS: readonly Asset[] = [
  {
    id: 'rift-041',
    name: 'Demo veKITTEN #041',
    collection: 'KittenSwap',
    marketId: DEFAULT_MARKET.id,
    underlyingSymbol: DEFAULT_MARKET.tokenSymbol,
    category: 'Short lock',
    artwork: `${import.meta.env.BASE_URL}artwork-0.svg`,
    price: 4200,
    referenceValue: 5000,
    underlyingBalance: 50000,
    lockTerm: '12 months',
    unlockDate: '2027-10-02',
    apr: 12,
    positionId: '041',
    description:
      'A fictional vote-escrowed NFT position holding 50,000 sample KITTEN units. Review its lock and ask price before saving a preview purchase.',
  },
  {
    id: 'rift-018',
    name: 'Demo veKITTEN #018',
    collection: 'KittenSwap',
    marketId: DEFAULT_MARKET.id,
    underlyingSymbol: DEFAULT_MARKET.tokenSymbol,
    category: 'Long lock',
    artwork: `${import.meta.env.BASE_URL}artwork-1.svg`,
    price: 6800,
    referenceValue: 8000,
    underlyingBalance: 80000,
    lockTerm: '24 months',
    unlockDate: '2028-10-01',
    apr: 10,
    positionId: '018',
    description:
      'A fictional vote-escrowed NFT position holding 80,000 sample KITTEN units. The displayed reference value is a fixed example, independent of any live market.',
  },
  {
    id: 'rift-009',
    name: 'Demo veKITTEN #009',
    collection: 'KittenSwap',
    marketId: DEFAULT_MARKET.id,
    underlyingSymbol: DEFAULT_MARKET.tokenSymbol,
    category: 'Short lock',
    artwork: `${import.meta.env.BASE_URL}artwork-2.svg`,
    price: 3100,
    referenceValue: 4000,
    underlyingBalance: 40000,
    lockTerm: '6 months',
    unlockDate: '2027-04-02',
    apr: 14,
    positionId: '009',
    description:
      'A fictional vote-escrowed NFT position holding 40,000 sample KITTEN units. This shorter sample lock illustrates how positions can carry different terms.',
  },
  {
    id: 'rift-027',
    name: 'Demo veKITTEN #027',
    collection: 'KittenSwap',
    marketId: DEFAULT_MARKET.id,
    underlyingSymbol: DEFAULT_MARKET.tokenSymbol,
    category: 'Long lock',
    artwork: `${import.meta.env.BASE_URL}artwork-3.svg`,
    price: 5400,
    referenceValue: 6500,
    underlyingBalance: 65000,
    lockTerm: '18 months',
    unlockDate: '2028-04-02',
    apr: 11,
    positionId: '027',
    description:
      'A fictional vote-escrowed NFT position holding 65,000 sample KITTEN units. Its price and collateral reference are illustrative USDC amounts.',
  },
  {
    id: 'rift-062',
    name: 'Demo veKITTEN #062',
    collection: 'KittenSwap',
    marketId: DEFAULT_MARKET.id,
    underlyingSymbol: DEFAULT_MARKET.tokenSymbol,
    category: 'Short lock',
    artwork: `${import.meta.env.BASE_URL}artwork-4.svg`,
    price: 2600,
    referenceValue: 3500,
    underlyingBalance: 35000,
    lockTerm: '3 months',
    unlockDate: '2027-01-02',
    apr: 15,
    positionId: '062',
    description:
      'A fictional vote-escrowed NFT position holding 35,000 sample KITTEN units. Its displayed unlock date is part of the example, not verified chain data.',
  },
  {
    id: 'rift-012',
    name: 'Demo veKITTEN #012',
    collection: 'KittenSwap',
    marketId: DEFAULT_MARKET.id,
    underlyingSymbol: DEFAULT_MARKET.tokenSymbol,
    category: 'Max lock',
    artwork: `${import.meta.env.BASE_URL}artwork-5.svg`,
    price: 8300,
    referenceValue: 10000,
    underlyingBalance: 100000,
    lockTerm: '24 months',
    unlockDate: '2028-10-01',
    apr: 9,
    positionId: '012',
    description:
      'A fictional vote-escrowed NFT position holding 100,000 sample KITTEN units. The longest sample lock demonstrates the position details available for review.',
  },
];

// The lending preview uses a separate fictional account, not marketplace purchases.
export const COLLATERAL = [ASSETS[0], ASSETS[1], ASSETS[5]];
export const LEND_REQUESTS = [ASSETS[2], ASSETS[3], ASSETS[4]];
export const CATEGORIES = [
  'All',
  'Short lock',
  'Long lock',
  'Max lock',
] as const;
