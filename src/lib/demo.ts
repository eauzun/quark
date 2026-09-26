import type { Exam, Level, Profile, Review, Task } from './types';
export const DEMO_WORKER = '0x2222222222222222222222222222222222222222';
export const DEMO_EMPLOYER = '0x1111111111111111111111111111111111111111';
export type DemoState = { tasks: Task[]; profiles: Record<string, Profile>; reviews: Review[] };
export function initialDemo(): DemoState {
  const now = Math.floor(Date.now() / 1000);
  const examples = [
    ['Review a staking vault contract', 'Security', 'expert', '24', 'Review deposit and withdrawal accounting, identify reentrancy risks, and provide a short report with reproducible tests. Deliver a public repository or a shareable report URL.'],
    ['Build a MON payment component', 'Development', 'basic', '12', 'Build a reusable React component that accepts a recipient and MON amount. Include wallet confirmation, pending and failure states, and a small integration example.'],
    ['Write escrow edge-case tests', 'Testing', 'basic', '8', 'Write Solidity tests for assignment permissions, empty submissions, payment failures, and deadline boundaries. Deliver your repository with a concise README.'],
    ['Audit access-control boundaries', 'Security', 'expert', '32', 'Review role checks and authorization boundaries in a sample Solidity application. Include a threat model, proof-of-concept tests, and actionable remediation notes.'],
    ['Review Solidity documentation', 'Review', 'basic', '6', 'Review the public contract interfaces and document expected state transitions, caller permissions, and revert conditions. Deliver your changes as a pull request.'],
    ['Prototype a badge-gated function', 'Development', 'basic', '15', 'Build a minimal Solidity example restricting a function to a non-transferable skill badge holder. Include positive and negative tests and deployment instructions.']
  ];
  return { tasks: examples.map((e, i) => ({ id: `demo-${i + 1}`, title: e[0], category: e[1], level: e[2] as Level, amount: e[3], description: e[4], employer: DEMO_EMPLOYER, employerName: ['Orbit Labs', 'Vertex Studio', 'Orbit Labs', 'Relay Collective', 'Vertex Studio', 'Relay Collective'][i], status: 'open', deadline: now + (i + 2) * 86400, createdAt: now - i * 14400, applicants: [], rejections: 0 })), profiles: {
    [DEMO_WORKER]: { address: DEMO_WORKER, name: 'Alex Chen', badges: [], completed: 0, rating: 0, earned: '0', spent: '0' },
    [DEMO_EMPLOYER]: { address: DEMO_EMPLOYER, name: 'Orbit Labs', badges: [], completed: 0, rating: 0, earned: '0', spent: '0' }
  }, reviews: [] };
}
export function demoExam(): Exam {
  return { attemptId: 'demo', expiresAt: Date.now() + 300000, questions: [
    { id: 'd1', question: 'Which token is used for Quark task payments?', options: ['MON', 'USDC', 'ETH', 'BTC'] },
    { id: 'd2', question: 'What must a worker earn before accepting a skill-gated task?', options: ['A verified skill badge', 'A paid subscription', 'A transferable NFT', 'An invitation code'] },
    { id: 'd3', question: 'Where is the task budget held before approval?', options: ['In an escrow contract', 'In the worker browser', 'In a credit card account', 'In a spreadsheet'] },
    { id: 'd4', question: 'Who approves a submitted delivery?', options: ['The task employer', 'Any visitor', 'The browser', 'Another applicant'] },
    { id: 'd5', question: 'Does this demo transfer real tokens?', options: ['No, it simulates the workflow locally', 'Yes, mainnet MON', 'Yes, USDC', 'Yes, ETH'] }
  ] };
}
