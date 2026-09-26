import { test } from 'node:test';
import assert from 'node:assert/strict';
import ganache from 'ganache';
import { createPublicClient, createWalletClient, custom, defineChain, encodeAbiParameters, keccak256, parseEther, toHex, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { compile } from '../scripts/compile';

test('MON escrow: badge authorization, payment, revision, timeout and refunds', { timeout: 45000 }, async () => {
  const provider = ganache.provider({ logging: { quiet: true }, chain: { chainId: 10143, hardfork: 'shanghai' }, wallet: { totalAccounts: 3 } });
  try {
    const chain = defineChain({ id: 10143, name: 'Local Monad test', nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 }, rpcUrls: { default: { http: ['http://localhost'] } } });
    const transport = custom(provider);
    const publicClient = createPublicClient({ chain, transport, pollingInterval: 20, cacheTime: 0 });
    const accounts = Object.values(provider.getInitialAccounts()).map(a => privateKeyToAccount(a.secretKey as Hex));
    const [employer, worker, outsider] = accounts.map(account => createWalletClient({ account, chain, transport }));
    const oracle = privateKeyToAccount(`0x${'ab'.repeat(32)}`);
    const artifacts = compile();
    const deploy = async (name: string, args: unknown[] = []) => {
      const artifact = artifacts[name];
      const hash = await employer.deployContract({ abi: artifact.abi, bytecode: `0x${artifact.evm.bytecode.object}`, args });
      return (await publicClient.waitForTransactionReceipt({ hash })).contractAddress!;
    };
    const badge = await deploy('SkillBadge', [oracle.address]);
    const reputation = await deploy('Reputation');
    const escrow = await deploy('TaskEscrow', [badge, reputation]);
    const send = async (wallet: typeof employer, name: string, address: Address, fn: string, args: unknown[], value = 0n) => {
      const hash = await wallet.writeContract({ address, abi: artifacts[name].abi, functionName: fn, args, value });
      assert.equal((await publicClient.waitForTransactionReceipt({ hash })).status, 'success');
    };
    const rejects = async (wallet: typeof employer, name: string, address: Address, fn: string, args: unknown[], value = 0n) => {
      await assert.rejects(publicClient.simulateContract({ account: wallet.account, address, abi: artifacts[name].abi, functionName: fn, args, value }));
    };
    await send(employer, 'Reputation', reputation, 'setEscrow', [escrow]);
    await rejects(outsider, 'Reputation', reputation, 'recordCompletion', [worker.account.address, employer.account.address, 5, 1n]);
    const skill = keccak256(toHex('solidity:basic'));
    const amount = parseEther('2');
    const create = async () => {
      const id = await publicClient.readContract({ address: escrow, abi: artifacts.TaskEscrow.abi, functionName: 'nextTaskId' }) as bigint;
      const timestamp = (await publicClient.getBlock()).timestamp;
      await send(employer, 'TaskEscrow', escrow, 'createTask', [skill, amount, timestamp + 86400n], amount);
      return id;
    };
    const readTask = async (id: bigint) => await publicClient.readContract({ address: escrow, abi: artifacts.TaskEscrow.abi, functionName: 'tasks', args: [id] }) as unknown[];
    const id = await create();
    await rejects(employer, 'TaskEscrow', escrow, 'assignWorker', [id, worker.account.address]);
    const payload = keccak256(encodeAbiParameters([{ type: 'uint256' }, { type: 'address' }, { type: 'address' }, { type: 'bytes32' }], [10143n, badge, worker.account.address, skill]));
    const signature = await oracle.signMessage({ message: { raw: payload } });
    await rejects(worker, 'SkillBadge', badge, 'mintBadge', [outsider.account.address, skill, signature]);
    await send(worker, 'SkillBadge', badge, 'mintBadge', [worker.account.address, skill, signature]);
    await rejects(worker, 'SkillBadge', badge, 'mintBadge', [worker.account.address, skill, signature]);
    await send(employer, 'TaskEscrow', escrow, 'assignWorker', [id, worker.account.address]);
    const delivery = keccak256(toHex('https://example.com/delivery'));
    await rejects(outsider, 'TaskEscrow', escrow, 'submitDelivery', [id, delivery]);
    await send(worker, 'TaskEscrow', escrow, 'submitDelivery', [id, delivery]);
    await rejects(employer, 'TaskEscrow', escrow, 'refund', [id]);
    await rejects(outsider, 'TaskEscrow', escrow, 'approve', [id, 5]);
    const balance = await publicClient.getBalance({ address: worker.account.address });
    await send(employer, 'TaskEscrow', escrow, 'approve', [id, 5]);
    assert.equal(await publicClient.getBalance({ address: worker.account.address }), balance + amount);
    assert.equal((await readTask(id))[7], 3);
    await rejects(employer, 'TaskEscrow', escrow, 'approve', [id, 5]);
    const score = await publicClient.readContract({ address: reputation, abi: artifacts.Reputation.abi, functionName: 'getScore', args: [worker.account.address] }) as { completedTasks: bigint; totalEarned: bigint };
    assert.equal(score.completedTasks, 1n); assert.equal(score.totalEarned, amount);
    const refundId = await create(); await send(employer, 'TaskEscrow', escrow, 'refund', [refundId]);
    assert.equal((await readTask(refundId))[7], 5);
    const timeoutId = await create();
    await send(employer, 'TaskEscrow', escrow, 'assignWorker', [timeoutId, worker.account.address]);
    await send(worker, 'TaskEscrow', escrow, 'submitDelivery', [timeoutId, delivery]);
    await rejects(worker, 'TaskEscrow', escrow, 'claimAfterReview', [timeoutId]);
    await provider.request({ method: 'evm_increaseTime', params: [3 * 86400 + 2] });
    await provider.request({ method: 'evm_mine', params: [] });
    await send(worker, 'TaskEscrow', escrow, 'claimAfterReview', [timeoutId]);
    assert.equal((await readTask(timeoutId))[7], 3);
    const revisionId = await create();
    await send(employer, 'TaskEscrow', escrow, 'assignWorker', [revisionId, worker.account.address]);
    await send(worker, 'TaskEscrow', escrow, 'submitDelivery', [revisionId, delivery]);
    await send(employer, 'TaskEscrow', escrow, 'reject', [revisionId, 'Add tests']);
    await send(worker, 'TaskEscrow', escrow, 'submitDelivery', [revisionId, delivery]);
    await send(employer, 'TaskEscrow', escrow, 'reject', [revisionId, 'Still incomplete']);
    await rejects(worker, 'TaskEscrow', escrow, 'submitDelivery', [revisionId, delivery]);
    await rejects(employer, 'TaskEscrow', escrow, 'refund', [revisionId]);
    await provider.request({ method: 'evm_increaseTime', params: [3 * 86400 + 2] });
    await provider.request({ method: 'evm_mine', params: [] });
    await send(employer, 'TaskEscrow', escrow, 'refund', [revisionId]);
    assert.equal(await publicClient.getBalance({ address: escrow }), 0n);
  } finally { await provider.disconnect(); }
});
