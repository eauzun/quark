/**
 * Quark Settlement Adapter Interface
 * Spec §9.2 — Settlement adapter operations
 * 
 * ADR-004: Base USDC testnet as engineering default.
 * Mock implementation for development, testnet for staging.
 */

// ============================================================
// Types
// ============================================================

export interface FundingIntent {
  id: string;
  milestoneId: string;
  payerId: string;
  network: string;
  token: string;
  expectedAmount: bigint;
  recipientAddress: string;
  status: 'created' | 'detected' | 'confirmed' | 'failed' | 'expired';
  createdAt: Date;
  expiresAt: Date;
}

export interface ChainEvent {
  network: string;
  transactionHash: string;
  logIndex: number;
  eventType: string;
  data: Record<string, unknown>;
}

export interface TransferRequest {
  recipientAddress: string;
  network: string;
  token: string;
  amount: bigint;
  authorizationHash: string;
  nonce: string;
}

export interface TransferResult {
  transactionHash: string;
  status: 'pending' | 'confirmed' | 'failed';
  confirmedAt?: Date;
}

export interface SettlementStatus {
  network: string;
  isHealthy: boolean;
  lastBlockNumber: bigint;
  lastBlockTime: Date;
  pendingTransactions: number;
}

// ============================================================
// Settlement Adapter Interface (Spec §9.2)
// ============================================================

export interface SettlementAdapter {
  /** Create a funding intent for a milestone */
  createFundingIntent(params: {
    milestoneId: string;
    payerId: string;
    network: string;
    token: string;
    amount: bigint;
  }): Promise<FundingIntent>;

  /** Observe blockchain for funding events */
  observeFunding(intentId: string): Promise<ChainEvent | null>;

  /** Confirm funding after finality requirements met */
  confirmFunding(intentId: string, event: ChainEvent): Promise<boolean>;

  /** Authorize award (no actual transfer yet) */
  authorizeAward(params: {
    milestoneId: string;
    recipientId: string;
    amount: bigint;
    feeAmount: bigint;
    scopeHash: string;
  }): Promise<string>; // returns authorization hash

  /** Request actual token transfer */
  requestTransfer(request: TransferRequest): Promise<TransferResult>;

  /** Request refund */
  requestRefund(params: {
    milestoneId: string;
    recipientAddress: string;
    amount: bigint;
    reason: string;
  }): Promise<TransferResult>;

  /** Get settlement system status */
  getStatus(): Promise<SettlementStatus>;

  /** Reconcile ledger with on-chain state */
  reconcile(network: string): Promise<{
    matched: number;
    mismatched: number;
    missing: number;
    details: Array<{ type: string; description: string }>;
  }>;
}

// ============================================================
// Network Configuration
// ============================================================

export interface NetworkConfig {
  chainId: number;
  name: string;
  rpcUrl: string;
  explorerUrl: string;
  usdcAddress: string;
  usdcDecimals: number;
  requiredConfirmations: number;
  isTestnet: boolean;
}

/** 
 * Supported networks — testnet only in initial implementation.
 * Production addresses are G (gate) — never hardcode mainnet defaults.
 */
export const NETWORKS: Record<string, NetworkConfig> = {
  'base-sepolia': {
    chainId: 84532,
    name: 'Base Sepolia',
    rpcUrl: 'https://sepolia.base.org',
    explorerUrl: 'https://sepolia.basescan.org',
    usdcAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', // Base Sepolia USDC
    usdcDecimals: 6,
    requiredConfirmations: 12,
    isTestnet: true,
  },
};

// ============================================================
// Mock Settlement Adapter (Development)
// ============================================================

/**
 * Mock settlement adapter for local development.
 * ⚠️ NEVER use in production — clearly marked as mock.
 * 
 * All responses are simulated. No real blockchain interaction.
 */
export class MockSettlementAdapter implements SettlementAdapter {
  private intents: Map<string, FundingIntent> = new Map();
  private transferCount = 0;

  async createFundingIntent(params: {
    milestoneId: string;
    payerId: string;
    network: string;
    token: string;
    amount: bigint;
  }): Promise<FundingIntent> {
    const intent: FundingIntent = {
      id: crypto.randomUUID(),
      milestoneId: params.milestoneId,
      payerId: params.payerId,
      network: params.network,
      token: params.token,
      expectedAmount: params.amount,
      recipientAddress: '0x' + '0'.repeat(40), // Mock address
      status: 'created',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h grace
    };
    this.intents.set(intent.id, intent);
    return intent;
  }

  async observeFunding(intentId: string): Promise<ChainEvent | null> {
    const intent = this.intents.get(intentId);
    if (!intent) return null;

    // Simulate instant funding in mock mode
    return {
      network: intent.network,
      transactionHash: '0x' + crypto.randomUUID().replace(/-/g, '') + '0'.repeat(32).slice(0, 32),
      logIndex: 0,
      eventType: 'Transfer',
      data: {
        from: '0x' + '1'.repeat(40),
        to: intent.recipientAddress,
        amount: intent.expectedAmount.toString(),
        mock: true,
      },
    };
  }

  async confirmFunding(intentId: string, _event: ChainEvent): Promise<boolean> {
    const intent = this.intents.get(intentId);
    if (!intent) return false;
    intent.status = 'confirmed';
    return true;
  }

  async authorizeAward(params: {
    milestoneId: string;
    recipientId: string;
    amount: bigint;
    feeAmount: bigint;
    scopeHash: string;
  }): Promise<string> {
    // Return mock authorization hash
    return `mock_auth_${params.milestoneId}_${Date.now()}`;
  }

  async requestTransfer(_request: TransferRequest): Promise<TransferResult> {
    this.transferCount++;
    return {
      transactionHash: `0xmock_transfer_${this.transferCount}`,
      status: 'confirmed',
      confirmedAt: new Date(),
    };
  }

  async requestRefund(_params: {
    milestoneId: string;
    recipientAddress: string;
    amount: bigint;
    reason: string;
  }): Promise<TransferResult> {
    this.transferCount++;
    return {
      transactionHash: `0xmock_refund_${this.transferCount}`,
      status: 'confirmed',
      confirmedAt: new Date(),
    };
  }

  async getStatus(): Promise<SettlementStatus> {
    return {
      network: 'mock',
      isHealthy: true,
      lastBlockNumber: 0n,
      lastBlockTime: new Date(),
      pendingTransactions: 0,
    };
  }

  async reconcile(_network: string) {
    return {
      matched: 0,
      mismatched: 0,
      missing: 0,
      details: [{ type: 'mock', description: 'Mock adapter — no real reconciliation' }],
    };
  }
}
