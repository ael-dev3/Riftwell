import ganache from 'ganache';
import { BrowserProvider, ContractFactory } from 'ethers';
import { compileContracts as compileAll } from '../scripts/compile.mjs';
let artifacts;
export function compileContracts() { return artifacts ||= compileAll(); }
export async function deploy(name, signer, args = []) {
  const artifact = compileContracts()[name];
  if (!artifact || artifact.bytecode === '0x') throw new Error(`Missing deployable contract ${name}`);
  const contract = await new ContractFactory(artifact.abi, artifact.bytecode, signer).deploy(...args);
  await contract.waitForDeployment();
  return contract;
}
export async function createTestContext() {
  const evm = ganache.provider({ logging: { quiet: true }, chain: { chainId: 31337, hardfork: 'shanghai' }, wallet: { totalAccounts: 10, deterministic: true }, miner: { timestampIncrement: 0 } });
  const provider = new BrowserProvider(evm, undefined, { cacheTimeout: -1 });
  provider.pollingInterval = 10;
  const signers = await Promise.all(Array.from({ length: 10 }, (_, i) => provider.getSigner(i)));
  const addresses = await Promise.all(signers.map(s => s.getAddress()));
  return { evm, provider, signers, addresses, close: () => evm.disconnect() };
}
export async function advanceTime(provider, seconds) {
  await provider.send('evm_increaseTime', [seconds]);
  await provider.send('evm_mine', []);
}
