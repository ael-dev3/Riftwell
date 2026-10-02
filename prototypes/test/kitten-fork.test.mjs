import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { BrowserProvider, JsonRpcProvider, JsonRpcSigner, Contract, ContractFactory, Interface, keccak256, parseEther, toQuantity } from 'ethers';
import { compileContracts } from '../scripts/compile.mjs';
import solc from 'solc';

// The remote transport accepts reads ONLY. Transactions, impersonation and gas
// funding use the disposable local fork; no remote signer or wallet exists.
const enabled = process.env.RIFTWELL_KITTEN_FORK === '1';
const financedSalesEnabled = process.env.RIFTWELL_KITTEN_FINANCED_SALE === '1';
const engine = process.env.RIFTWELL_KITTEN_FORK_ENGINE || 'anvil';
const rpcUrl = process.env.RIFTWELL_HYPEREVM_RPC || 'https://rpc.hyperliquid.xyz/evm';
const nftAddress = '0x29d3a21ff35a519e00cf6d272f2ad897b109bd84';
const voterAddress = '0xb7f7053f7e6c210e6777d5ba758e4b3eca6c88a0';
const usdcAddress = '0xb88339cb7199b77e23db6e890353e22632ba630f';
const pool = process.env.RIFTWELL_KITTEN_REWARD_POOL || '0x12df9913e9e08453440e3c4b1ae73819160b513e';
const tokenId = BigInt(process.env.RIFTWELL_KITTEN_TOKEN_ID || '18373');
const usdcFunder = process.env.RIFTWELL_USDC_FUNDER || '0x68acb2051b73c2342be78cd1a7e5ca44483d10c5';
const usdcAbi = ['function balanceOf(address) view returns(uint256)', 'function allowance(address,address) view returns(uint256)', 'function transfer(address,uint256) returns(bool)', 'function approve(address,uint256) returns(bool)'];
const nftAbiExtra = ['function approve(address,uint256)', 'function transferFrom(address,address,uint256)'];
const readMethods = new Set(['eth_chainId', 'net_version', 'eth_blockNumber', 'eth_getBlockByNumber',
  'eth_getBlockByHash', 'eth_getCode', 'eth_getStorageAt', 'eth_getBalance',
  'eth_getTransactionCount', 'eth_call', 'eth_getTransactionByHash', 'eth_getTransactionReceipt']);
const stringify = value => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2) + '\n';

test('live Kitten custody, typed vote, epoch release and nonzero closed-period USDC gate', {
  skip: enabled ? false : 'Set RIFTWELL_KITTEN_FORK=1 to run the explicit read-only remote/local-fork gate.',
  timeout: financedSalesEnabled ? 600_000 : 300_000,
}, async t => {
  const report = {
    startedAtUtc: new Date().toISOString(), endpointHost: new URL(rpcUrl).hostname,
    chainId: 999, engine, nftAddress, voterAddress, usdcAddress, pool, tokenId,
    status: 'in-progress', productionClaimsVerified: false, remoteMethods: {}, transactions: [],
    gates: { custody: false, typedVote: false, epochTransferRestriction: false,
      epochRelease: false, nonzeroClaimAfterOwnershipTransfer: false, lenderCreditWithdrawal: false },
    safety: 'Read-only remote RPC; transactions only on disposable local fork; local native gas funding only. No ERC20 balance or protocol storage overrides.',
  };
  if (financedSalesEnabled) report.financedSaleGates = {
    fundedBuyer: false, sellerListing: false, settlement: false, exactSaleFee: false,
    separateCredits: false, buyerOwnership: false, creditWithdrawals: false,
    votedPurchaseAtomicRollback: false, unclaimedClosedPeriodRewardFollowsBuyer: false,
  };
  const evidenceFile = process.env.RIFTWELL_KITTEN_EVIDENCE_FILE;
  const controllers = new Set();
  let evm;
  let localProvider;
  let forkProcess;
  let proxy;
  let pinnedBlock;
  let requestId = 0;
  let nextRemoteRequestAt = 0;
  const remoteCache = new Map();
  const delay = ms => new Promise(resolveDelay => setTimeout(resolveDelay, ms));
  let cleaning;
  const cleanup = () => cleaning ||= (async () => {
    for (const controller of controllers) controller.abort();
    if (evm?.disconnect) {
      try { await evm.disconnect(); }
      catch (error) { report.cleanupError = error.message || String(error); }
    }
    localProvider?.destroy();
    if (forkProcess?.pid && forkProcess.exitCode === null && forkProcess.signalCode === null) {
      const exited = once(forkProcess, 'exit');
      forkProcess.kill('SIGTERM');
      const timeout = setTimeout(() => forkProcess.kill('SIGKILL'), 5_000);
      try { await exited; } finally { clearTimeout(timeout); }
    }
    if (proxy) { proxy.closeAllConnections(); await new Promise(resolveClose => proxy.close(resolveClose)); }
    report.cleanup = { completed: true, localForkPid: forkProcess?.pid || null,
      forkExitCode: forkProcess?.exitCode ?? null, forkSignal: forkProcess?.signalCode || null,
      proxyClosed: proxy ? !proxy.listening : null };
  })();
  t.after(cleanup);
  const stage = message => { report.stage = message; console.info(`Kitten fork: ${message}`); };
  const remote = {
    async request({ method, params = [] }) {
      assert(readMethods.has(method), `Refusing non-read remote RPC method ${method}`);
      const cacheable = new Set(['eth_getCode', 'eth_getStorageAt', 'eth_getBalance', 'eth_getTransactionCount', 'eth_call']).has(method)
        && typeof params.at(-1) === 'string' && /^0x[0-9a-f]+$/i.test(params.at(-1));
      const cacheKey = JSON.stringify([method, params]).toLowerCase();
      if (cacheable && remoteCache.has(cacheKey)) {
        report.remoteCacheHits = (report.remoteCacheHits || 0) + 1;
        return remoteCache.get(cacheKey);
      }
      const request = (async () => {
        for (let attempt = 0; attempt < 3; attempt++) {
          // Pace public RPC reads; immutable numeric-block responses may be
          // reused only in memory within this run. Read headers afresh.
          const wait = Math.max(0, nextRemoteRequestAt - Date.now());
          nextRemoteRequestAt = Math.max(Date.now(), nextRemoteRequestAt) + 300;
          if (wait) await delay(wait);
          report.remoteMethods[method] = (report.remoteMethods[method] || 0) + 1;
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 15_000);
          controllers.add(controller);
          try {
            const response = await fetch(rpcUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ jsonrpc: '2.0', id: ++requestId, method, params }), signal: controller.signal });
            if ((response.status === 429 || response.status === 503) && attempt < 2) {
              report.remoteReadRetries = (report.remoteReadRetries || 0) + 1;
              const retryAfter = Number(response.headers.get('retry-after'));
              await response.arrayBuffer();
              await delay(Math.min(10_000, retryAfter > 0 ? retryAfter * 1000 : 2000 * (attempt + 1)));
              continue;
            }
            if (!response.ok) throw Object.assign(new Error(`Remote ${method}: HTTP ${response.status}`), { code: -32000 });
            const body = await response.json();
            if (body.error) throw Object.assign(new Error(`Remote ${method}: ${body.error.message}`), { code: body.error.code });
            if (method === 'eth_getBlockByNumber' && body.result && /^0x[0-9a-f]+$/i.test(params[0])) {
              assert.equal(BigInt(body.result.number), BigInt(params[0]), `RPC returned a different block than requested (${params[0]})`);
              if (pinnedBlock && BigInt(params[0]) === BigInt(pinnedBlock.number)) {
                assert.equal(body.result.hash, pinnedBlock.hash, 'Pinned block hash changed during the fork');
              }
            }
            return body.result;
          } finally { clearTimeout(timeout); controllers.delete(controller); }
        }
      })();
      if (cacheable) remoteCache.set(cacheKey, request);
      try { return await request; }
      catch (error) { remoteCache.delete(cacheKey); throw error; }
    },
  };
  const rpc = (method, params) => remote.request({ method, params });
  const recordTransaction = async (label, promise) => {
    let receipt;
    try { receipt = await (await promise).wait(); }
    catch (error) {
      if (error.receipt) {
        report.failedTransaction = { label, hash: error.receipt.hash, gasUsed: error.receipt.gasUsed };
        try {
          const trace = await evm.request({ method: 'debug_traceTransaction', params: [error.receipt.hash,
            { disableMemory: true, disableStorage: true, disableStack: true }] });
          const compact = ({ depth, op, pc, error, gas, gasCost }) => ({ depth, op, pc, error, gas, gasCost });
          report.failedTransaction.traceTail = trace.structLogs.slice(-12).map(compact);
          report.failedTransaction.faults = trace.structLogs.filter(x => x.error || x.op === 'INVALID').map(compact);
          report.failedTransaction.depthTails = Object.fromEntries([...new Set(trace.structLogs.map(x => x.depth))]
            .map(depth => [depth, trace.structLogs.filter(x => x.depth === depth).slice(-6).map(compact)]));
        } catch (traceError) { report.failedTransaction.traceError = traceError.message; }
      }
      throw error;
    }
    assert.equal(receipt.status, 1, `${label} failed locally`);
    report.transactions.push({ label, hash: receipt.hash, blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed, logs: receipt.logs.map(({ address, topics, data }) => ({ address, topics, data })) });
    return receipt;
  };
  try {
    stage('Validate chain and an explicit numeric fork block.');
    assert.equal(await rpc('eth_chainId', []), '0x3e7', 'RPC is not HyperEVM mainnet chain 999');
    // A valid block-zero header is required only by Ganache. Anvil needs no
    // fabricated substitute when an endpoint cannot serve genesis.
    let genesis;
    if (engine === 'ganache') {
      genesis = await rpc('eth_getBlockByNumber', ['0x0', false]);
      assert(genesis && genesis.number === '0x0', 'RPC cannot serve genesis required by Ganache; custody gate remains unproven');
    }
    const blockTag = process.env.RIFTWELL_KITTEN_FORK_BLOCK
      ? toQuantity(BigInt(process.env.RIFTWELL_KITTEN_FORK_BLOCK)) : await rpc('eth_blockNumber', []);
    assert(/^0x[0-9a-f]+$/i.test(blockTag), 'Fork block must be an explicit numeric block');
    pinnedBlock = await rpc('eth_getBlockByNumber', [blockTag, false]);
    assert(pinnedBlock, `No numeric block ${blockTag}; use a reliable archive-capable endpoint`);
    const pinnedAgain = await rpc('eth_getBlockByNumber', [blockTag, false]);
    assert.equal(pinnedAgain.hash, pinnedBlock.hash, 'Numeric block did not resolve to a stable hash');
    const blockNumber = Number(BigInt(blockTag));
    const timestamp = Number(BigInt(pinnedBlock.timestamp));
    report.block = { number: blockNumber, hash: pinnedBlock.hash, timestamp,
      timestampUtc: new Date(timestamp * 1000).toISOString(), genesisHash: genesis?.hash || null };
    const sourceFiles = ['test/kitten-fork.test.mjs', 'scripts/compile.mjs',
      'contracts/RiftwellLoans.sol', 'contracts/RiftwellLoanVault.sol', 'contracts/interfaces/IKittenVoting.sol',
      'package.json', 'package-lock.json'];
    const sha256 = value => createHash('sha256').update(value).digest('hex');
    report.sourceIdentity = { compiler: solc.version(), evmVersion: 'shanghai', optimizer: { enabled: true, runs: 200 },
      sourceSha256: Object.fromEntries(await Promise.all(sourceFiles.map(async file => [file, sha256(await readFile(resolve(file)))]))) };
    const artifacts = compileContracts();
    report.sourceIdentity.bytecodes = Object.fromEntries(['RiftwellLoans', 'RiftwellLoanVault'].map(name => [name, {
      creationBytecodeSha256: sha256(artifacts[name].bytecode),
      compiledRuntimeTemplateSha256: sha256(artifacts[name].deployedBytecode),
    }]));
    const nftInterface = new Interface([...artifacts.IKittenVotingEscrow.abi, ...nftAbiExtra]);
    const voterInterface = new Interface(artifacts.IKittenVoter.abi);
    const rewardInterface = new Interface(artifacts.IKittenVotingReward.abi);
    const usdcInterface = new Interface(usdcAbi);
    const read = async (address, abi, method, args = []) => {
      const raw = await rpc('eth_call', [{ to: address, data: abi.encodeFunctionData(method, args) }, blockTag]);
      const result = abi.decodeFunctionResult(method, raw);
      return result.length === 1 ? result[0] : result;
    };
    stage(`Sample every remote contract read at numeric block ${blockNumber}.`);
    const owner = await read(nftAddress, nftInterface, 'ownerOf', [tokenId]);
    const lock = await read(nftAddress, nftInterface, 'locked', [tokenId]);
    const period = await read(voterAddress, voterInterface, 'getCurrentPeriod');
    const gauge = await read(voterAddress, voterInterface, 'getGauge', [pool]);
    const closedPeriod = process.env.RIFTWELL_KITTEN_CLOSED_PERIOD
      ? BigInt(process.env.RIFTWELL_KITTEN_CLOSED_PERIOD) : period - 1n;
    assert(closedPeriod >= 0n && closedPeriod < period, 'Choose a genuinely closed voting period');
    assert(lock.amount > 0n, 'Selected live NFT has no locked collateral');
    assert(lock.end > BigInt(timestamp + 7 * 86400), 'Selected lock expires before test maturity');
    assert.equal(await read(voterAddress, voterInterface, 'checkPeriodVoted', [period + 1n, tokenId]), false,
      'Selected NFT has already voted for next period; choose a transferable NFT');
    const minimumFunding = financedSalesEnabled ? 40_000_000n : 20_000_000n;
    const funderBalance = await read(usdcAddress, usdcInterface, 'balanceOf', [usdcFunder]);
    assert(funderBalance >= minimumFunding,
      `Real USDC funding address lacks ${minimumFunding} raw units; balances will not be fabricated`);
    const earnedBeforeFork = await read(gauge.votingReward, rewardInterface, 'earnedForPeriod', [closedPeriod, tokenId, usdcAddress]);
    report.sample = { owner, lockedAmount: lock.amount, lockEnd: lock.end, period, closedPeriod,
      votingReward: gauge.votingReward, earnedUSDC: earnedBeforeFork, usdcFunder, funderBalance };
    // Snapshot implementation slots and bytecode identities at the same block.
    const implementationSlot = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
    report.implementations = {};
    for (const [name, address] of Object.entries({ escrow: nftAddress, voter: voterAddress, reward: gauge.votingReward, settlement: usdcAddress })) {
      const slot = await rpc('eth_getStorageAt', [address, implementationSlot, blockTag]);
      const implementation = '0x' + slot.slice(-40);
      report.implementations[name] = { slot, implementation,
        proxyCodeHash: keccak256(await rpc('eth_getCode', [address, blockTag])),
        implementationCodeHash: keccak256(await rpc('eth_getCode', [implementation, blockTag])) };
    }
    stage(`Initialize local fork: NFT ${tokenId}, closed period ${closedPeriod}, real claimable USDC ${earnedBeforeFork} raw units.`);
    // Guard Ganache's remote fallback as well. All state requests must reference
    // numeric blocks no later than the validated fork block, never moving latest.
    const forkRemote = { request: async ({ method, params = [] }) => {
      const p = [...params];
      const blockIndex = ({ eth_getCode: 1, eth_getBalance: 1, eth_getTransactionCount: 1,
        eth_getStorageAt: 2, eth_call: 1, eth_getBlockByNumber: 0 })[method];
      if (blockIndex !== undefined) {
        if (p[blockIndex] === 'latest' || p[blockIndex] === 'pending') p[blockIndex] = blockTag;
        if (p[blockIndex] === 'earliest') p[blockIndex] = '0x0';
        if (typeof p[blockIndex] === 'number') p[blockIndex] = toQuantity(p[blockIndex]);
        assert(/^0x[0-9a-f]+$/i.test(p[blockIndex]), `Unpinned remote fallback ${method}: ${JSON.stringify(p)}`);
        assert(BigInt(p[blockIndex]) <= BigInt(blockTag), `Remote fallback exceeds fork block: ${method}`);
      }
      return rpc(method, p);
    } };
    let provider;
    if (engine === 'ganache') {
      const { default: ganache } = await import('ganache');
      evm = ganache.provider({ fork: { provider: forkRemote, blockNumber, disableCache: true },
        chain: { chainId: 999, networkId: 999, hardfork: 'shanghai', time: new Date(timestamp * 1000) },
        wallet: { totalAccounts: 5, deterministic: true, unlockedAccounts: [owner, usdcFunder] },
        miner: { timestampIncrement: 0, blockGasLimit: 30_000_000 }, logging: { quiet: true } });
      provider = new BrowserProvider(evm, undefined, { cacheTimeout: -1 });
    } else {
      assert.equal(engine, 'anvil', 'Unknown local fork engine');
      // Anvil connects to this local proxy. The proxy enforces the same remote
      // read allowlist and numeric pin as Ganache, including startup/fallbacks.
      proxy = createServer(async (request, response) => {
        try {
          let body = '';
          for await (const chunk of request) { body += chunk; assert(body.length < 1_000_000, 'Oversized fork RPC request'); }
          const payload = JSON.parse(body);
          const handle = async item => {
            try { return { jsonrpc: '2.0', id: item.id, result: await forkRemote.request(item) }; }
            catch (error) { return { jsonrpc: '2.0', id: item.id, error: { code: Number.isInteger(error.code) ? error.code : -32000, message: error.message } }; }
          };
          const result = Array.isArray(payload) ? await Promise.all(payload.map(handle)) : await handle(payload);
          response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(result));
        } catch (error) { response.writeHead(400); response.end(error.message); }
      });
      proxy.listen(0, '127.0.0.1');
      await once(proxy, 'listening');
      const architecture = process.arch === 'x64' ? 'amd64' : process.arch;
      const binary = process.env.RIFTWELL_ANVIL_BINARY || resolve('node_modules', '@foundry-rs', `anvil-${process.platform}-${architecture}`, 'bin', process.platform === 'win32' ? 'anvil.exe' : 'anvil');
      forkProcess = spawn(binary, ['--host', '127.0.0.1', '--port', '0', '--fork-url', `http://127.0.0.1:${proxy.address().port}`,
        '--fork-block-number', String(blockNumber), '--chain-id', '999', '--hardfork', 'cancun',
        '--timestamp', String(timestamp), '--gas-limit', '30000000', '--no-storage-caching', '--steps-tracing', '--retries', '0', '--timeout', '20000'],
      { stdio: ['ignore', 'pipe', 'pipe'] });
      const port = await new Promise((resolvePort, reject) => {
        const timeout = setTimeout(() => reject(new Error('Local Anvil did not become ready within 60 seconds')), 60_000);
        let output = '';
        forkProcess.once('error', error => { clearTimeout(timeout); reject(error); });
        forkProcess.once('exit', code => { clearTimeout(timeout); reject(new Error(`Local Anvil exited during startup (${code})`)); });
        forkProcess.stdout.on('data', chunk => {
          output += chunk.toString();
          const match = output.match(/Listening on 127\.0\.0\.1:(\d+)/);
          if (match) { clearTimeout(timeout); resolvePort(Number(match[1])); }
          if (output.length > 100_000) output = output.slice(-20_000);
        });
        // Drain stderr; don't print Anvil's deterministic local account banner.
        forkProcess.stderr.on('data', () => {});
      });
      provider = new JsonRpcProvider(`http://127.0.0.1:${port}`, 999, { staticNetwork: true, cacheTimeout: -1, batchMaxCount: 1 });
      localProvider = provider;
      evm = { request: ({ method, params }) => provider.send(method, params) };
      await evm.request({ method: 'anvil_setBlockTimestampInterval', params: [0] });
      for (const account of [owner, usdcFunder]) await evm.request({ method: 'anvil_impersonateAccount', params: [account] });
    }
    provider.pollingInterval = 10;
    // Native gas only; reward balances, ownership and protocol state come from RPC.
    for (const account of [owner, usdcFunder]) {
      await evm.request({ method: engine === 'anvil' ? 'anvil_setBalance' : 'evm_setAccountBalance', params: [account, toQuantity(parseEther('100'))] });
    }
    const admin = await provider.getSigner(0);
    const lender = await provider.getSigner(1);
    const buyer = financedSalesEnabled ? await provider.getSigner(2) : null;
    const buyerAddress = buyer ? await buyer.getAddress() : null;
    const borrower = engine === 'anvil' ? new JsonRpcSigner(provider, owner) : await provider.getSigner(owner);
    const funder = engine === 'anvil' ? new JsonRpcSigner(provider, usdcFunder) : await provider.getSigner(usdcFunder);
    const treasury = await admin.getAddress();
    const lenderAddress = await lender.getAddress();
    const nft = new Contract(nftAddress, nftInterface, borrower);
    const voter = new Contract(voterAddress, voterInterface, provider);
    const usdc = new Contract(usdcAddress, usdcAbi, provider);
    const reward = new Contract(gauge.votingReward, rewardInterface, provider);
    assert.equal((await nft.ownerOf(tokenId)).toLowerCase(), owner.toLowerCase(), 'Fork ownership differs from pinned sample');
    assert.equal(await voter.getCurrentPeriod(), period, 'Fork period differs from pinned sample');
    assert.equal(await reward.earnedForPeriod(closedPeriod, tokenId, usdcAddress), earnedBeforeFork,
      'Fork reward state differs from pinned remote state; endpoint cannot support reliable evidence');
    const loans = await new ContractFactory(artifacts.RiftwellLoans.abi, artifacts.RiftwellLoans.bytecode, admin)
      .deploy(nftAddress, usdcAddress, voterAddress, treasury, treasury, true);
    await recordTransaction('deploy local loan manager', Promise.resolve(loans.deploymentTransaction()));
    await loans.waitForDeployment();
    // True ONLY on this disposable fork, to exercise the recipient gate. This
    // report always retains productionClaimsVerified=false pending release review.
    const now = (await provider.getBlock('latest')).timestamp;
    // If real earnings are nonzero, deliberately use a smaller loan so the test
    // proves surplus remains with custody rather than being sent to the lender.
    const principal = earnedBeforeFork > 1n ? (earnedBeforeFork / 2n < 10_000_000n ? earnedBeforeFork / 2n : 10_000_000n) : 10_000_000n;
    report.principal = principal;
    await recordTransaction('fund local lender with real USDC', usdc.connect(funder).transfer(lenderAddress, 20_000_000n));
    await recordTransaction('approve local loan capital', usdc.connect(lender).approve(await loans.getAddress(), principal));
    await recordTransaction('approve local NFT collateral transfer', nft.approve(await loans.getAddress(), tokenId));
    await recordTransaction('fund local loan offer', loans.connect(lender).fundOffer(owner, tokenId, principal, 1200, 7 * 86400,
      now + 86400, now + 7 * 86400, 1));
    stage('Accept a funded local offer and move the live NFT into its deployed custody vault.');
    await recordTransaction('accept local offer and transfer NFT to vault', loans.connect(borrower).acceptOffer(1, { gasLimit: 20_000_000 }));
    const loan = await loans.loans(1);
    const vault = new Contract(loan.vault, artifacts.RiftwellLoanVault.abi, borrower);
    report.local = { manager: await loans.getAddress(), vault: loan.vault, lender: lenderAddress };
    report.local.runtimeCodeHashes = {
      manager: keccak256(await provider.getCode(await loans.getAddress())),
      vault: keccak256(await provider.getCode(loan.vault)),
    };
    assert.equal((await nft.ownerOf(tokenId)).toLowerCase(), loan.vault.toLowerCase());
    report.gates.custody = true;
    const earnedInVault = await reward.earnedForPeriod(closedPeriod, tokenId, usdcAddress);
    assert.equal(earnedInVault, earnedBeforeFork, 'NFT transfer changed prior-period reward entitlement');
    report.entitlementAfterTransfer = earnedInVault;
    // Clear any legitimate same-block ownership-change guard through mining.
    await evm.request({ method: 'evm_mine', params: [] });
    const simulateNFTTransfer = () => provider.call({ from: loan.vault, to: nftAddress,
      data: nftInterface.encodeFunctionData('transferFrom', [loan.vault, owner, tokenId]) });
    await simulateNFTTransfer();
    // This optional branch exercises sales without consuming the original
    // nonzero reward/custody gate. Snapshot/reset is local Anvil/Ganache state.
    const salePrice = 1_250_000n;
    const prepareSale = async () => {
      const manager = await loans.getAddress();
      const funderBefore = await usdc.balanceOf(usdcFunder);
      const buyerBefore = await usdc.balanceOf(buyerAddress);
      await recordTransaction('fund local sale buyer with real USDC', usdc.connect(funder).transfer(buyerAddress, 20_000_000n));
      assert.equal(await usdc.balanceOf(usdcFunder), funderBefore - 20_000_000n);
      assert.equal(await usdc.balanceOf(buyerAddress), buyerBefore + 20_000_000n);
      report.financedSaleGates.fundedBuyer = true;
      await recordTransaction('approve actual buyer USDC for financed purchase', usdc.connect(buyer).approve(manager, salePrice));
      await assert.rejects(loans.connect(lender).listFinancedCollateral.staticCall(1, salePrice, now + 86400),
        'Lender can list borrower collateral');
      await recordTransaction('seller lists collateral from its live loan vault',
        loans.connect(borrower).listFinancedCollateral(1, salePrice, now + 86400));
      const listingId = await loans.financedListingCount();
      assert.equal(await loans.activeFinancedListing(1), listingId);
      assert.equal((await loans.financedListings(listingId)).active, true);
      report.financedSaleGates.sellerListing = true;
      return listingId;
    };
    const settlementState = async listingId => {
      const manager = await loans.getAddress();
      // Field arrays preserve every stored value, including accrual timestamps
      // and remainders, so a failed purchase cannot silently mutate loan state.
      return {
        loan: [...await loans.loans(1)], debt: [...await loans.debt(1)],
        listing: [...await loans.financedListings(listingId)],
        activeListing: await loans.activeFinancedListing(1), activeLoan: await loans.activeLoanForToken(tokenId),
        nftOwner: await nft.ownerOf(tokenId), nextPeriodVoted: await voter.checkPeriodVoted(period + 1n, tokenId),
        balances: { buyer: await usdc.balanceOf(buyerAddress), borrower: await usdc.balanceOf(owner),
          lender: await usdc.balanceOf(lenderAddress), treasury: await usdc.balanceOf(treasury),
          manager: await usdc.balanceOf(manager), vault: await usdc.balanceOf(loan.vault),
          funder: await usdc.balanceOf(usdcFunder) },
        buyerAllowance: await usdc.allowance(buyerAddress, manager),
        lenderCredit: await loans.lenderCredits(lenderAddress), borrowerCredit: await loans.borrowerCredits(owner),
        totalLenderCredits: await loans.totalLenderCredits(), totalBorrowerCredits: await loans.totalBorrowerCredits(),
        escrowedOfferCapital: await loans.escrowedOfferCapital(),
        closedPeriodEarnedUSDC: await reward.earnedForPeriod(closedPeriod, tokenId, usdcAddress),
      };
    };
    if (financedSalesEnabled) await t.test('financed live NFT sale, separate funded credits and prior unclaimed USDC follows buyer', async () => {
      stage('Snapshot custody and settle financed sale with actual funded buyer USDC.');
      const snapshot = await evm.request({ method: 'evm_snapshot', params: [] });
      const transactionStart = report.transactions.length;
      try {
        const listingId = await prepareSale();
        const before = await settlementState(listingId);
        const fee = salePrice * 50n / 10_000n;
        const debtPaid = before.debt[2];
        const borrowerProceeds = salePrice - fee - debtPaid;
        assert(borrowerProceeds > 0n, 'Selected loan does not leave separate borrower sale proceeds');
        assert.equal(before.closedPeriodEarnedUSDC, earnedBeforeFork);
        const receipt = await recordTransaction('buy financed live NFT directly from custody',
          loans.connect(buyer).buyFinancedCollateral(listingId, salePrice, buyerAddress, { gasLimit: 3_000_000 }));
        const sold = receipt.logs.map(log => { try { return loans.interface.parseLog(log); } catch { return null; } })
          .find(log => log?.name === 'FinancedCollateralSold');
        assert(sold, 'No financed-sale settlement event');
        assert.equal(sold.args.price, salePrice);
        assert.equal(sold.args.debtPaid, debtPaid);
        assert.equal(sold.args.protocolFee, fee);
        assert.equal(sold.args.borrowerProceeds, borrowerProceeds);
        const after = await settlementState(listingId);
        assert.equal(after.balances.buyer, before.balances.buyer - salePrice);
        assert.equal(after.balances.treasury, before.balances.treasury + fee);
        assert.equal(after.balances.lender, before.balances.lender);
        assert.equal(after.balances.borrower, before.balances.borrower);
        assert.equal(after.lenderCredit, before.lenderCredit + debtPaid);
        assert.equal(after.borrowerCredit, before.borrowerCredit + borrowerProceeds);
        assert.equal(after.totalLenderCredits, before.totalLenderCredits + debtPaid);
        assert.equal(after.totalBorrowerCredits, before.totalBorrowerCredits + borrowerProceeds);
        assert.equal(after.balances.manager, before.balances.manager + debtPaid + borrowerProceeds);
        assert.equal(after.balances.manager, after.escrowedOfferCapital + after.totalLenderCredits + after.totalBorrowerCredits);
        assert.equal(after.debt[2], 0n);
        assert.equal(after.loan.at(-1), false);
        assert.equal(after.listing.at(-1), false);
        assert.equal(after.activeListing, 0n);
        assert.equal(after.activeLoan, 0n);
        assert.equal(after.nftOwner.toLowerCase(), buyerAddress.toLowerCase());
        report.financedSaleGates.settlement = true;
        report.financedSaleGates.exactSaleFee = true;
        report.financedSaleGates.separateCredits = true;
        report.financedSaleGates.buyerOwnership = true;
        report.financedSale = { listingId, buyer: buyerAddress, price: salePrice, fee, debtPaid, borrowerProceeds, before, after };
        await recordTransaction('withdraw funded sale lender credit', loans.connect(lender).withdrawLenderCredit(lenderAddress, debtPaid));
        await recordTransaction('withdraw separate funded sale borrower credit', loans.connect(borrower).withdrawBorrowerCredit(owner, borrowerProceeds));
        assert.equal(await usdc.balanceOf(lenderAddress), before.balances.lender + debtPaid);
        assert.equal(await usdc.balanceOf(owner), before.balances.borrower + borrowerProceeds);
        assert.equal(await loans.lenderCredits(lenderAddress), before.lenderCredit);
        assert.equal(await loans.borrowerCredits(owner), before.borrowerCredit);
        assert.equal(await loans.totalLenderCredits(), before.totalLenderCredits);
        assert.equal(await loans.totalBorrowerCredits(), before.totalBorrowerCredits);
        assert.equal(await usdc.balanceOf(await loans.getAddress()), before.balances.manager);
        report.financedSaleGates.creditWithdrawals = true;
        if (earnedBeforeFork > 0n) {
          stage('Claim untouched closed-period USDC as the actual financed-sale NFT buyer.');
          await evm.request({ method: 'evm_mine', params: [] });
          assert.equal(await reward.earnedForPeriod(closedPeriod, tokenId, usdcAddress), earnedBeforeFork);
          await assert.rejects(reward.connect(borrower).getRewardForPeriod.staticCall(closedPeriod, tokenId, usdcAddress),
            'Original seller can directly claim unclaimed rewards after sale');
          await assert.rejects(vault.claimClosedPeriod.staticCall(pool, closedPeriod, usdcAddress),
            'Old custody vault can claim after sale');
          const buyerBeforeClaim = await usdc.balanceOf(buyerAddress);
          const vaultBeforeClaim = await usdc.balanceOf(loan.vault);
          const sellerBeforeClaim = await usdc.balanceOf(owner);
          await recordTransaction('financed-sale buyer claims actual prior unclaimed USDC',
            reward.connect(buyer).getRewardForPeriod(closedPeriod, tokenId, usdcAddress, { gasLimit: 3_000_000 }));
          assert.equal(await usdc.balanceOf(buyerAddress), buyerBeforeClaim + earnedBeforeFork);
          assert.equal(await usdc.balanceOf(loan.vault), vaultBeforeClaim);
          assert.equal(await usdc.balanceOf(owner), sellerBeforeClaim);
          assert.equal(await reward.earnedForPeriod(closedPeriod, tokenId, usdcAddress), 0n);
          report.saleRewardDisposition = { closedPeriod, amount: earnedBeforeFork, recipient: buyerAddress,
            previousSellerBlocked: true, previousVaultBlocked: true, buyerReceivedExactReward: true,
            scope: 'One previously unclaimed closed-period USDC reward for this NFT, pool and pinned deployment.' };
          report.financedSaleGates.unclaimedClosedPeriodRewardFollowsBuyer = true;
        }
      } finally {
        assert.equal(await evm.request({ method: 'evm_revert', params: [snapshot] }), true, 'Local sale snapshot reset failed');
        report.snapshotBranches ||= [];
        report.snapshotBranches.push({ name: 'financed-sale-success', snapshotId: snapshot, restored: true,
          transactionIndexes: [transactionStart, report.transactions.length - 1],
          note: 'These transactions were mined successfully on a disposable branch and then reverted by snapshot reset.' });
        assert.equal((await nft.ownerOf(tokenId)).toLowerCase(), loan.vault.toLowerCase());
        assert.equal(await loans.isLoanActive(1), true);
        assert.equal(await reward.earnedForPeriod(closedPeriod, tokenId, usdcAddress), earnedBeforeFork);
      }
    });
    stage('Exercise typed owner vote and its next-period transfer restriction.');
    await assert.rejects(vault.connect(lender).vote.staticCall([pool], [1]), 'Unrelated lender can vote');
    await recordTransaction('typed vote from NFT-owning loan vault', vault.vote([pool], [1], { gasLimit: 3_000_000 }));
    assert.equal(await voter.checkPeriodVoted(period + 1n, tokenId), true);
    report.gates.typedVote = true;
    await assert.rejects(simulateNFTTransfer(), 'NFT transferred despite next-period vote');
    report.gates.epochTransferRestriction = true;

    if (financedSalesEnabled) await t.test('live next-period vote atomically rejects financed purchase without consuming funds, debt or listing', async () => {
      stage('Mine a financed purchase rejected by the live next-period vote guard and compare complete state.');
      const listingId = await prepareSale();
      const before = await settlementState(listingId);
      assert.equal(before.nextPeriodVoted, true);
      await assert.rejects(loans.connect(buyer).buyFinancedCollateral.staticCall(listingId, salePrice, buyerAddress),
        'Static purchase bypassed live vote restriction');
      let rejected;
      try { await (await loans.connect(buyer).buyFinancedCollateral(listingId, salePrice, buyerAddress, { gasLimit: 3_000_000 })).wait(); }
      catch (error) { rejected = error; }
      assert.equal(rejected?.code, 'CALL_EXCEPTION', 'Voted purchase did not fail as an EVM transaction');
      assert(rejected.receipt, 'Rejected purchase must have an actual mined receipt');
      assert.equal(rejected.receipt.status, 0);
      assert.equal(rejected.receipt.logs.length, 0, 'Rejected purchase retained logs');
      const after = await settlementState(listingId);
      assert.deepEqual(after, before, 'Rejected voted purchase did not roll back complete settlement state');
      report.votedPurchaseRollback = { listingId, hash: rejected.receipt.hash, blockNumber: rejected.receipt.blockNumber,
        gasUsed: rejected.receipt.gasUsed, receiptStatus: rejected.receipt.status, logs: [], before, after,
        unchanged: ['NFT custody', 'buyer USDC and allowance', 'treasury fee', 'borrower and lender USDC',
          'manager and vault cash', 'individual and total credits', 'complete loan and debt', 'active loan and sale listing', 'reward entitlement'] };
      report.financedSaleGates.votedPurchaseAtomicRollback = true;
    });

    await t.test('nonzero closed-period reward follows NFT into contract custody and becomes lender credit', async st => {
      if (earnedBeforeFork === 0n) {
        report.nonzeroClaimBlocker = 'Selected NFT/pool/closed period has zero claimable USDC. No nonzero contract-recipient or repayment proof.';
        st.skip(report.nonzeroClaimBlocker);
        return;
      }
      stage('Claim actual nonzero closed-period USDC into the NFT-owning vault.');
      const beforeVault = await usdc.balanceOf(loan.vault);
      const beforeLender = await usdc.balanceOf(lenderAddress);
      await assert.rejects(reward.connect(borrower).getRewardForPeriod.staticCall(closedPeriod, tokenId, usdcAddress),
        'Previous owner can still claim transferred NFT rewards directly');
      await assert.rejects(reward.connect(lender).getRewardForPeriod.staticCall(closedPeriod, tokenId, usdcAddress),
        'Unrelated account can directly claim NFT rewards');
      report.claimAuthorization = { previousOwnerBlocked: true, unrelatedAccountBlocked: true };
      await assert.rejects(vault.claimClosedPeriod.staticCall(pool, period, usdcAddress), 'Active period claim accepted');
      await recordTransaction('claim actual closed-period reward after NFT transfer',
        vault.claimClosedPeriod(pool, closedPeriod, usdcAddress, { gasLimit: 3_000_000 }));
      const afterVault = await usdc.balanceOf(loan.vault);
      assert.equal(afterVault - beforeVault, earnedBeforeFork, 'Exact actual reward did not reach contract NFT owner');
      assert.equal(await reward.earnedForPeriod(closedPeriod, tokenId, usdcAddress), 0n);
      report.claim = { earnedBeforeTransfer: earnedBeforeFork, earnedAfterTransfer: earnedInVault,
        vaultBefore: beforeVault, vaultAfter: afterVault };
      report.gates.nonzeroClaimAfterOwnershipTransfer = true;
      const [, , debt] = await loans.debt(1);
      const expectedPaid = afterVault < debt ? afterVault : debt;
      const creditBefore = await loans.lenderCredits(lenderAddress);
      await recordTransaction('apply realized USDC rewards to debt and lender credit', loans.repayFromRewards(1));
      assert.equal(await usdc.balanceOf(lenderAddress), beforeLender, 'Repayment unexpectedly bypassed lender credit');
      assert.equal(await loans.lenderCredits(lenderAddress), creditBefore + expectedPaid);
      assert.equal(await usdc.balanceOf(loan.vault), afterVault - expectedPaid, 'Excess rewards did not remain in custody');
      await recordTransaction('withdraw actual lender repayment credit', loans.connect(lender).withdrawLenderCredit(lenderAddress, expectedPaid));
      assert.equal(await usdc.balanceOf(lenderAddress), beforeLender + expectedPaid);
      assert.equal(await loans.lenderCredits(lenderAddress), creditBefore);
      report.repayment = { debt, paid: expectedPaid, surplusInCustody: afterVault - expectedPaid };
      report.gates.lenderCreditWithdrawal = true;
      if (!await loans.isLoanActive(1)) {
        const borrowerBefore = await usdc.balanceOf(owner);
        const surplus = await usdc.balanceOf(loan.vault);
        await recordTransaction('withdraw actual borrower reward surplus after debt closure', vault.withdrawSurplus(usdcAddress, owner));
        assert.equal(await usdc.balanceOf(owner), borrowerBefore + surplus);
        assert.equal(await usdc.balanceOf(loan.vault), 0n);
        report.surplusWithdrawal = { paidToBorrower: surplus };
      }
    });
    // Close any remaining local debt explicitly. A zero-reward sample can still
    // prove vote/release behavior; it cannot pass the nonzero reward release gate.
    if (await loans.isLoanActive(1)) await recordTransaction('forgive remaining local test debt for release check', loans.connect(lender).forgiveDebt(1));
    await assert.rejects(vault.vote.staticCall([pool], [1]), 'Closed loan can be revoted');
    await assert.rejects(loans.connect(borrower).withdrawCollateral.staticCall(1, owner), 'Voted collateral returned before epoch change');
    stage('Advance local time to the next period, freeze revoting, and release the exact collateral.');
    const localNow = (await provider.getBlock('latest')).timestamp;
    const nextBoundary = (Number(period) + 1) * 7 * 86400;
    assert(nextBoundary > localNow && nextBoundary - localNow <= 7 * 86400, 'Unexpected period clock; epoch release remains unproven');
    await evm.request({ method: engine === 'anvil' ? 'evm_setNextBlockTimestamp' : 'evm_increaseTime',
      params: [engine === 'anvil' ? nextBoundary + 1 : nextBoundary - localNow + 1] });
    await evm.request({ method: 'evm_mine', params: [] });
    assert.equal(await voter.getCurrentPeriod(), period + 1n);
    await recordTransaction('return exact NFT after epoch transfer guard clears', loans.connect(borrower).withdrawCollateral(1, owner, { gasLimit: 3_000_000 }));
    assert.equal((await nft.ownerOf(tokenId)).toLowerCase(), owner.toLowerCase());
    report.gates.epochRelease = true;
    if (earnedBeforeFork > 0n) {
      assert(Object.values(report.gates).every(Boolean), 'A required nonzero reward integration subtest failed');
      if (financedSalesEnabled) assert(Object.values(report.financedSaleGates).every(Boolean), 'A required financed-sale integration subtest failed');
      report.status = 'local-gates-passed-release-review-required';
    } else report.status = 'partial-nonzero-claim-unproven';
  } catch (error) {
    report.status = 'failed';
    report.error = { name: error.name, message: error.shortMessage || error.message, code: error.code,
      detail: error.info?.error?.message?.slice(0, 2000) };
    throw error;
  } finally {
    await cleanup();
    report.finishedAtUtc = new Date().toISOString();
    if (evidenceFile) {
      // Explicit output path prevents routine skipped/local tests overwriting
      // evidence; endpoint credentials and raw URLs are never included.
      const path = resolve(evidenceFile);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, stringify(report));
      t.diagnostic(`Fork evidence saved to ${path}`);
    }
  }
});
