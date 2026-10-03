export interface KittenConfiguration {
  name: 'KittenSwap';
  chainId: 999;
  rpc: string;
  escrow: string;
  voter: string;
  usdc: string;
  explorer: string;
  docs: string;
  riftwellDeployment: null;
}
export const KITTEN = Object.freeze({
  name: 'KittenSwap',
  chainId: 999,
  rpc: 'https://rpc.hyperliquid.xyz/evm',
  escrow: '0x29d3A21fF35a519E00cF6d272f2aD897b109BD84',
  voter: '0xb7f7053f7e6c210e6777d5ba758e4b3eca6c88a0',
  usdc: '0xb88339cb7199b77e23db6e890353e22632ba630f',
  explorer: 'https://hyperevmscan.io',
  docs: 'https://docs.kittenswap.finance/tokenomics/deployed-contracts',
  // Deployment is deliberately absent. Public Kitten reads do not activate writes.
  riftwellDeployment: null,
} satisfies KittenConfiguration);
export const PLATFORM_FEE_BPS = 50n;
export const USDC_DECIMALS = 6;
// The offline event indexer can atomically write this public, read-only snapshot.
export const INDEX_VIEW_URL = './data/market-index.json';
