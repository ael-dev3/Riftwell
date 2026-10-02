import type { Asset } from '../domain';

export type LendingAction =
  | { kind: 'deposit-collateral' | 'remove-collateral'; asset: Asset }
  | { kind: 'borrow' | 'repay' | 'supply' | 'withdraw' | 'how' }
  | { kind: 'epoch'; rewardMicros?: string };

export const activityLabel: Readonly<Record<string, string>> = {
  'deposit-collateral': 'Collateral deposited',
  'remove-collateral': 'Collateral removed',
  borrow: 'USDC borrowed',
  repay: 'Debt repaid',
  supply: 'USDC supplied',
  withdraw: 'USDC withdrawn',
  redeem: 'Shares redeemed',
  epoch: 'Reward epoch simulated',
  purchase: 'Position purchased',
};

export const BORROW_KINDS = [
  'borrow',
  'repay',
  'deposit-collateral',
  'remove-collateral',
  'epoch',
  'purchase',
] as const;
export const VAULT_KINDS = ['supply', 'withdraw', 'redeem', 'epoch'] as const;
