import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const solc = require('solc');
export function compile() {
  const sources = Object.fromEntries(['SkillBadge', 'Reputation', 'TaskEscrow'].map(name => [`contracts/${name}.sol`, { content: fs.readFileSync(`contracts/${name}.sol`, 'utf8') }]));
  const result = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources, settings: { evmVersion: 'shanghai', optimizer: { enabled: true, runs: 200 }, outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } } }), {
    import: (name: string) => { try { return { contents: fs.readFileSync(path.resolve('node_modules', name), 'utf8') }; } catch { return { error: `Missing ${name}` }; } }
  }));
  const errors = result.errors?.filter((e: { severity: string }) => e.severity === 'error');
  if (errors?.length) throw new Error(JSON.stringify(errors));
  return Object.fromEntries(['SkillBadge', 'Reputation', 'TaskEscrow'].map(name => [name, result.contracts[`contracts/${name}.sol`][name]]));
}
if (process.argv[1]?.endsWith('compile.ts')) {
  fs.mkdirSync('artifacts', { recursive: true });
  for (const [name, contract] of Object.entries(compile())) fs.writeFileSync(`artifacts/${name}.json`, JSON.stringify(contract, null, 2));
  console.log('Compiled SkillBadge, Reputation, TaskEscrow (Solidity 0.8.30 / Shanghai).');
}
