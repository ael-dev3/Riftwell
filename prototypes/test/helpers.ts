import ganache from 'ganache';
import {
  BrowserProvider,
  Contract,
  ContractFactory,
  type ContractRunner,
  type ContractTransactionResponse,
} from 'ethers';
import { compileContracts as compileAll } from '../scripts/compile.ts';
import type { Artifacts } from '../scripts/compile.ts';
import type { ContractBindings } from './contracts.ts';
let artifacts: Artifacts | undefined;
export function compileContracts() {
  return (artifacts ||= compileAll());
}
export async function deploy<Name extends keyof ContractBindings>(
  name: Name,
  signer: ContractRunner,
  args: readonly unknown[] = [],
): Promise<ContractBindings[Name]> {
  const artifact = compileContracts()[name];
  if (!artifact || artifact.bytecode === '0x')
    throw new Error(`Missing deployable contract ${name}`);
  const contract = await new ContractFactory(
    artifact.abi,
    artifact.bytecode,
    signer,
  ).deploy(...args);
  await contract.waitForDeployment();
  // ContractFactory installs methods from this exact compiled ABI at runtime.
  return contract as unknown as ContractBindings[Name];
}
export function attachContract<Name extends keyof ContractBindings>(
  name: Name,
  target: string,
  runner: ContractRunner,
): ContractBindings[Name] {
  return new Contract(
    target,
    compileContracts()[name].abi,
    runner,
  ) as unknown as ContractBindings[Name];
}
export async function sent(operation: Promise<ContractTransactionResponse>) {
  const receipt = await (await operation).wait();
  if (!receipt)
    throw new Error('A mined local transaction receipt is required.');
  return receipt;
}
export async function latestBlock(provider: BrowserProvider) {
  const block = await provider.getBlock('latest');
  if (!block) throw new Error('The local EVM did not return its latest block.');
  return block;
}
export async function createTestContext() {
  const evm = ganache.provider({
    logging: { quiet: true },
    chain: { chainId: 31337, hardfork: 'shanghai' },
    wallet: { totalAccounts: 10, deterministic: true },
    miner: { timestampIncrement: 0 },
  });
  const provider = new BrowserProvider(evm, undefined, { cacheTimeout: -1 });
  provider.pollingInterval = 10;
  const signers = await Promise.all(
    Array.from({ length: 10 }, (_, i) => provider.getSigner(i)),
  );
  const addresses = await Promise.all(signers.map((s) => s.getAddress()));
  return { evm, provider, signers, addresses, close: () => evm.disconnect() };
}
export async function advanceTime(provider: BrowserProvider, seconds: number) {
  await provider.send('evm_increaseTime', [seconds]);
  await provider.send('evm_mine', []);
}
