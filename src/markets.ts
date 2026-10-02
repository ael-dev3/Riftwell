export type MarketId = 'kittenswap';

export type Market = {
  id: MarketId;
  name: string;
  shortName: string;
  chain: string;
  tokenSymbol: string;
  positionSymbol: string;
  accentColor: string;
  logoPath: string;
};

export const MARKETS: readonly Market[] = [
  {
    id: 'kittenswap',
    name: 'KittenSwap',
    shortName: 'Kitten',
    chain: 'HyperEVM',
    tokenSymbol: 'KITTEN',
    positionSymbol: 'veKITTEN',
    accentColor: '#bff4aa',
    logoPath: 'markets/kittenswap.png',
  },
];

export const DEFAULT_MARKET = MARKETS[0];
