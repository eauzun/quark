import fs from 'node:fs';
import { createPublicClient, createWalletClient, http, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { compile } from './compile';
import { monad } from '../src/lib/contracts';

async function main() {
  const key = process.env.DEPLOYER_PRIVATE_KEY as Hex | undefined;
  const oracleKey = process.env.ORACLE_PRIVATE_KEY as Hex | undefined;
  if (!key || !oracleKey) throw new Error('DEPLOYER_PRIVATE_KEY and ORACLE_PRIVATE_KEY are required.');
  const path = 'deployments/monad-testnet.json';
  if (fs.existsSync(path)) throw new Error('Deployment file already exists. Archive it before an intentional redeployment.');
  const transport = http(process.env.RPC_URL || monad.rpcUrls.default.http[0]);
  const account = privateKeyToAccount(key);
  const wallet = createWalletClient({ account, chain: monad, transport });
  const client = createPublicClient({ chain: monad, transport });
  if (await client.getChainId() !== 10143) throw new Error('RPC is not Monad Testnet (10143).');
  const artifacts = compile();
  const deployed: Record<string, unknown> = { chainId: 10143, deployer: account.address };
  fs.mkdirSync('deployments', { recursive: true });
  const save = () => fs.writeFileSync(path, JSON.stringify(deployed, null, 2));
  async function deploy(name: string, args: unknown[] = []): Promise<Address> {
    const a = artifacts[name];
    const hash = await wallet.deployContract({ abi: a.abi, bytecode: `0x${a.evm.bytecode.object}`, args });
    deployed[`${name}Tx`] = hash; save();
    const receipt = await client.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success' || !receipt.contractAddress) throw new Error(`${name} deployment failed.`);
    deployed[name] = receipt.contractAddress;
    if (!deployed.startBlock) deployed.startBlock = receipt.blockNumber.toString();
    save(); return receipt.contractAddress;
  }
  const badge = await deploy('SkillBadge', [privateKeyToAccount(oracleKey).address]);
  const reputation = await deploy('Reputation');
  const escrow = await deploy('TaskEscrow', [badge, reputation]);
  const hash = await wallet.writeContract({ address: reputation, abi: artifacts.Reputation.abi, functionName: 'setEscrow', args: [escrow] });
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error('Reputation.setEscrow failed; deployment remains incomplete.');
  deployed.configured = true; save();
  console.log(`Deployment recorded in ${path}. Copy addresses into app and indexer environment configuration.`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
