import { defineChain, keccak256, parseAbi, toHex, type Address } from 'viem';

export const monad = defineChain({ id: 10143, name: 'Monad Testnet', nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 }, rpcUrls: { default: { http: [process.env.NEXT_PUBLIC_RPC_URL || 'https://testnet-rpc.monad.xyz'] } }, blockExplorers: { default: { name: 'Monadscan', url: 'https://testnet.monadscan.com' } }, testnet: true });
export const skillIds = { basic: keccak256(toHex('solidity:basic')), expert: keccak256(toHex('solidity:expert')) };
export const addresses = {
  escrow: process.env.NEXT_PUBLIC_ESCROW_ADDRESS as Address | undefined,
  badge: process.env.NEXT_PUBLIC_BADGE_ADDRESS as Address | undefined,
  reputation: process.env.NEXT_PUBLIC_REPUTATION_ADDRESS as Address | undefined
};
export const escrowAbi = parseAbi([
  'function createTask(bytes32 requiredSkillId, uint256 amount, uint256 deadline) payable returns (uint256)',
  'function assignWorker(uint256 taskId, address worker)', 'function submitDelivery(uint256 taskId, bytes32 deliveryHash)',
  'function approve(uint256 taskId, uint8 rating)', 'function reject(uint256 taskId, string reason)',
  'function refund(uint256 taskId)', 'function claimAfterReview(uint256 taskId)',
  'function tasks(uint256) view returns (address employer, address worker, bytes32 requiredSkillId, uint256 amount, uint256 deadline, uint256 reviewDeadline, bytes32 deliveryHash, uint8 status, uint8 rejections)',
  'event TaskCreated(uint256 indexed taskId, address indexed employer, bytes32 requiredSkillId, uint256 amount, uint256 deadline)',
  'event WorkerAssigned(uint256 indexed taskId, address indexed worker)',
  'event DeliverySubmitted(uint256 indexed taskId, bytes32 deliveryHash, uint256 reviewDeadline)',
  'event TaskApproved(uint256 indexed taskId, address indexed worker, uint8 rating, uint256 amount)',
  'event TaskRejected(uint256 indexed taskId, string reason, uint8 rejections, uint256 deadline)',
  'event TaskRefunded(uint256 indexed taskId, address indexed employer, uint256 amount)'
]);
export const badgeAbi = parseAbi(['function mintBadge(address worker, bytes32 skillId, bytes signature)', 'function hasBadge(address worker, bytes32 skillId) view returns (bool)', 'event BadgeMinted(address indexed worker, bytes32 indexed skillId)']);
export const reputationAbi = parseAbi(['function getScore(address user) view returns ((uint256 completedTasks, uint256 ratingSum, uint256 totalEarned, uint256 totalSpent))', 'function setEscrow(address escrow)', 'event CompletionRecorded(address indexed worker, address indexed employer, uint8 rating, uint256 amount)']);
