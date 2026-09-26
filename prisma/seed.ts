import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
const banks = {
  basic: [
    ['What does msg.sender identify?', ['The transaction origin always', 'The immediate caller', 'The contract owner', 'The miner'], 1],
    ['Where does a storage variable persist?', ['Only in the call stack', 'Only during one transaction', 'In contract state across transactions', 'In the browser'], 2],
    ['Which function can receive native MON?', ['An external payable function', 'Any view function', 'Only a pure function', 'Any internal function'], 0],
    ['What happens when require evaluates to false?', ['Only a warning is emitted', 'The caller is banned', 'The transaction execution reverts', 'The value becomes zero'], 2],
    ['Which declaration prevents a function from modifying state?', ['payable', 'public', 'virtual', 'view'], 3],
    ['What is the default value of a uint256 mapping entry?', ['null', '0', '1', 'It always reverts'], 1],
    ['What does an event provide?', ['A private secret', 'A log that off-chain applications can index', 'Automatic execution of another contract', 'Free persistent contract storage'], 1],
    ['Which type is appropriate for a wallet identifier?', ['uint8', 'bool', 'address', 'string only'], 2]
  ],
  expert: [
    ['What is the key checks-effects-interactions property?', ['External calls happen first', 'State changes happen before untrusted external calls', 'Every function is payable', 'All arithmetic is unchecked'], 1],
    ['Why bind an oracle signature to chain ID and contract address?', ['Reduce gas to zero', 'Hide the signer', 'Prevent cross-chain and cross-contract replay', 'Allow transfers without consent'], 2],
    ['Why is tx.origin unsuitable for authorization?', ['It cannot be read', 'It changes every block', 'It always equals address(0)', 'An intermediary contract can preserve the originating victim address'], 3],
    ['A low-level call returns false. What must payment code do?', ['Handle failure or revert explicitly', 'Assume success', 'Delete all balances anyway', 'Retry infinitely'], 0],
    ['What is the main issue with an unbounded payout loop?', ['It makes signatures longer', 'It can exceed the block gas limit and block progress', 'It enables free transfers', 'It bypasses all modifiers'], 1],
    ['Which design prevents repeated processing of an oracle authorization?', ['A unique nonce or consumed authorization record', 'A public string', 'A block explorer link', 'A larger integer type'], 0],
    ['What should a time-dependent contract boundary test cover?', ['Only one day before', 'Only a random future date', 'Before, exactly at, and after the boundary', 'Only the deployment block'], 2],
    ['Which is unsafe for determining lottery randomness?', ['A committed secret with later reveal', 'An authenticated randomness oracle', 'A threshold beacon', 'block.timestamp alone'], 3]
  ]
} as const;
async function seed() {
  for (const [level, questions] of Object.entries(banks)) {
    await db.skill.upsert({ where: { id: level }, create: { id: level, name: 'Solidity', level }, update: {} });
    for (const [i, [question, options, correctOption]] of questions.entries()) {
      const data = { skillId: level, question, options: [...options], correctOption };
      await db.skillQuestion.upsert({ where: { id: `${level}-${i}` }, create: { id: `${level}-${i}`, ...data }, update: data });
    }
  }
  await db.ecosystemProgram.upsert({ where: { id: 'monad-builders' }, create: { id: 'monad-builders', title: 'Monad Builders', description: 'Official developer resources and ecosystem entry points.', url: 'https://monad.xyz/developers', program: 'other' }, update: {} });
  await db.communityProject.upsert({ where: { id: 'monad' }, create: { id: 'monad', name: 'Monad', category: 'Infra', description: 'Explore the network powering Quark and its developer ecosystem.', url: 'https://monad.xyz', employer: null }, update: {} });
  console.log('Seeded Solidity Basic + Expert assessments and verified official ecosystem links.');
}
seed().finally(() => db.$disconnect());
