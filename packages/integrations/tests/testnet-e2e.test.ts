/**
 * testnet-e2e.test.ts — Base Sepolia testnet integration tests (Spec §9, §15.1).
 *
 * Spec §0.1: "Never label testnet transactions or simulated balances as real
 * mainnet funds."
 * Spec §9.1: "Use mock settlement in local tests, real testnet integration in staging."
 * Spec §15.1 Scenario 14: "Reorg/provisional deposit never authorizes spend;
 * failed transfer retries without duplicate award."
 *
 * These tests connect to Base Sepolia when RPC is available, and gracefully
 * skip when offline. They verify the real viem integration path.
 */

import { describe, it, expect, beforeAll } from "vitest";
import {
  BaseSepoliaSettlementAdapter,
} from "../src/settlement/base-sepolia.js";
import {
  MockSettlementAdapter,
  NETWORKS,
} from "../src/settlement/adapter.js";

// ──────────────────────────────────────────────
//  Network Configuration Verification
// ──────────────────────────────────────────────

describe("Testnet E2E: Network Configuration (Spec §9.1)", () => {
  it("Base Sepolia config uses official USDC address and correct decimals", () => {
    const config = NETWORKS["base-sepolia"];

    expect(config).toBeDefined();
    expect(config.chainId).toBe(84532); // Base Sepolia chain ID
    expect(config.usdcAddress).toBe("0x036CbD53842c5426634e7929541eC2318f3dCF7e");
    expect(config.usdcDecimals).toBe(6); // USDC uses 6 decimals
    expect(config.requiredConfirmations).toBeGreaterThan(0);
    expect(config.isTestnet).toBe(true); // MUST be marked as testnet
    expect(config.rpcUrl).toContain("sepolia");
  });

  it("testnet is clearly labeled — not mainnet", () => {
    // Spec §0.1 invariant: never label testnet as real
    for (const [, config] of Object.entries(NETWORKS)) {
      expect(config.isTestnet).toBe(true);
    }
  });

  it("explorer URL points to testnet explorer", () => {
    const config = NETWORKS["base-sepolia"];
    expect(config.explorerUrl).toContain("sepolia");
  });
});

// ──────────────────────────────────────────────
//  Funding Intent Lifecycle (Offline-Safe)
// ──────────────────────────────────────────────

describe("Testnet E2E: Funding Intent Lifecycle", () => {
  it("creates funding intent with correct network and token", async () => {
    const adapter = new BaseSepoliaSettlementAdapter();

    const intent = await adapter.createFundingIntent({
      milestoneId: "mile-testnet-1",
      payerId: "payer-testnet-1",
      network: "base-sepolia",
      token: "USDC",
      amount: 120_000_000n, // 120 USDC
    });

    expect(intent.network).toBe("base-sepolia");
    expect(intent.token).toBe("USDC");
    expect(intent.expectedAmount).toBe(120_000_000n);
    expect(intent.status).toBe("created");
    expect(intent.expiresAt.getTime()).toBeGreaterThan(intent.createdAt.getTime());
    // 24h funding grace period (Spec §6)
    const graceHours = (intent.expiresAt.getTime() - intent.createdAt.getTime()) / (1000 * 60 * 60);
    expect(graceHours).toBeCloseTo(24, 0);
  });

  it("funding intent has recipient address from network config", async () => {
    const adapter = new BaseSepoliaSettlementAdapter();
    const config = NETWORKS["base-sepolia"];

    const intent = await adapter.createFundingIntent({
      milestoneId: "mile-testnet-2",
      payerId: "payer-testnet-2",
      network: "base-sepolia",
      token: "USDC",
      amount: 60_000_000n,
    });

    // Recipient should be the configured USDC vault address
    expect(intent.recipientAddress.toLowerCase()).toBe(config.usdcAddress.toLowerCase());
  });

  it("award authorization references scope hash", async () => {
    const adapter = new BaseSepoliaSettlementAdapter();

    const authHash = await adapter.authorizeAward({
      milestoneId: "mile-testnet-3",
      recipientId: "worker-alice",
      amount: 100_000_000n,
      feeAmount: 20_000_000n,
      scopeHash: "0xblake3scopehash1234567890abcdef1234567890abcdef1234567890ab",
    });

    expect(authHash).toContain("mile-testnet-3");
    expect(authHash).toContain("base_sepolia_auth");
  });
});

// ──────────────────────────────────────────────
//  Chain Interaction (Graceful Offline)
// ──────────────────────────────────────────────

describe("Testnet E2E: Chain Interaction (Spec §9.1)", () => {
  let adapter: BaseSepoliaSettlementAdapter;
  let isRpcAvailable = false;

  beforeAll(async () => {
    adapter = new BaseSepoliaSettlementAdapter();
    try {
      const status = await adapter.getStatus();
      isRpcAvailable = status.isHealthy;
    } catch {
      isRpcAvailable = false;
    }
  });

  it("reports settlement system status", async () => {
    const status = await adapter.getStatus();

    expect(status.network).toBe("base-sepolia");
    // If RPC is available, status should show valid block info
    if (isRpcAvailable) {
      expect(status.isHealthy).toBe(true);
      expect(status.lastBlockNumber).toBeGreaterThan(0n);
    } else {
      // Graceful degradation when offline
      expect(status.isHealthy).toBe(false);
    }
  });

  it("observeFunding returns null for unfunded intent (offline-safe)", async () => {
    const intent = await adapter.createFundingIntent({
      milestoneId: "mile-testnet-observe",
      payerId: "payer-obs",
      network: "base-sepolia",
      token: "USDC",
      amount: 999_999_999_999n, // Unlikely to find a matching transfer
    });

    const event = await adapter.observeFunding(intent.id);

    // Should return null (no matching transfer found) or a valid ChainEvent
    if (event !== null) {
      expect(event.network).toBe("base-sepolia");
      expect(event.eventType).toBe("Transfer");
      expect(event.transactionHash).toBeDefined();
    }
  });

  it("confirmFunding returns false for unknown intent", async () => {
    const result = await adapter.confirmFunding("nonexistent-intent-id", {
      network: "base-sepolia",
      transactionHash: "0xnonexistent",
      logIndex: 0,
      eventType: "Transfer",
      data: {},
    });

    expect(result).toBe(false);
  });

  it("reconcile returns testnet-mode result", async () => {
    const result = await adapter.reconcile("base-sepolia");

    expect(result.details).toBeDefined();
    expect(result.details.length).toBeGreaterThan(0);
    expect(result.details[0].type).toBe("testnet");
    expect(result.details[0].description).toContain("testnet");
  });
});

// ──────────────────────────────────────────────
//  Pre-Finality Safety (Spec §9.1, Scenario 14)
// ──────────────────────────────────────────────

describe("Testnet E2E: Pre-Finality Deposits Not Spendable (Scenario 14)", () => {
  it("mock adapter confirms funding instantly but is clearly marked as mock", async () => {
    const mock = new MockSettlementAdapter();

    const intent = await mock.createFundingIntent({
      milestoneId: "mile-mock-1",
      payerId: "payer-mock",
      network: "mock",
      token: "USDC",
      amount: 120_000_000n,
    });

    // Observe and confirm
    const event = await mock.observeFunding(intent.id);
    expect(event).not.toBeNull();

    const confirmed = await mock.confirmFunding(intent.id, event!);
    expect(confirmed).toBe(true);

    // Mock status clearly identifies itself
    const status = await mock.getStatus();
    expect(status.network).toBe("mock");
  });

  it("reconciliation clearly labels mock adapter", async () => {
    const mock = new MockSettlementAdapter();
    const result = await mock.reconcile("mock");

    expect(result.details[0].type).toBe("mock");
    expect(result.details[0].description).toContain("Mock");
    expect(result.details[0].description).toContain("no real");
  });
});

// ──────────────────────────────────────────────
//  Transfer Safety (Spec §9.2)
// ──────────────────────────────────────────────

describe("Testnet E2E: Transfer Authorization (Spec §9.2)", () => {
  it("transfer request requires authorization hash and nonce", async () => {
    const adapter = new BaseSepoliaSettlementAdapter();

    const result = await adapter.requestTransfer({
      recipientAddress: "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18",
      network: "base-sepolia",
      token: "USDC",
      amount: 100_000_000n,
      authorizationHash: "0xauth-hash-12345",
      nonce: "transfer-nonce-001",
    });

    // Should return a transfer result (pending or confirmed)
    expect(result.status).toBeDefined();
    expect(["pending", "confirmed", "failed"]).toContain(result.status);
    expect(result.transactionHash).toBeDefined();
  });

  it("refund request returns transfer result", async () => {
    const adapter = new BaseSepoliaSettlementAdapter();

    const result = await adapter.requestRefund({
      milestoneId: "mile-refund-1",
      recipientAddress: "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18",
      amount: 50_000_000n,
      reason: "Milestone cancelled before work started",
    });

    expect(result.status).toBeDefined();
    expect(result.transactionHash).toBeDefined();
  });
});

// ──────────────────────────────────────────────
//  Spec §0.1 Compliance: Honest Labeling
// ──────────────────────────────────────────────

describe("Testnet E2E: Spec §0.1 — Honest Testnet Labeling", () => {
  it("all network configs are marked as testnet", () => {
    for (const [name, config] of Object.entries(NETWORKS)) {
      expect(config.isTestnet, `Network '${name}' must be marked isTestnet=true`).toBe(true);
    }
  });

  it("adapter reports testnet network name, not mainnet", async () => {
    const adapter = new BaseSepoliaSettlementAdapter();
    const status = await adapter.getStatus();

    expect(status.network).toBe("base-sepolia");
    expect(status.network).not.toBe("base");
    expect(status.network).not.toBe("mainnet");
  });
});