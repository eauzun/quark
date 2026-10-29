import { describe, it, expect } from "vitest";
import { BaseSepoliaSettlementAdapter } from "../src/settlement/base-sepolia.js";
import { MockSettlementAdapter, NETWORKS } from "../src/settlement/adapter.js";

describe("M6: Settlement & Base Sepolia Integration (Spec §9 & §15.1)", () => {
  it("creates valid funding intent with Base Sepolia USDC contract config", async () => {
    const adapter = new BaseSepoliaSettlementAdapter();
    const networkConfig = NETWORKS["base-sepolia"];

    const intent = await adapter.createFundingIntent({
      milestoneId: "mile-sepolia-1",
      payerId: "payer-user-1",
      network: "base-sepolia",
      token: "USDC",
      amount: 120_000_000n, // 120 USDC
    });

    expect(intent.network).toBe("base-sepolia");
    expect(intent.token).toBe("USDC");
    expect(intent.expectedAmount).toBe(120_000_000n);
    expect(intent.recipientAddress.toLowerCase()).toBe(networkConfig.usdcAddress.toLowerCase());
    expect(intent.status).toBe("created");
    expect(intent.expiresAt.getTime()).toBeGreaterThan(intent.createdAt.getTime());
  });

  it("authorizes milestone award with scope hash reference", async () => {
    const adapter = new BaseSepoliaSettlementAdapter();
    const authHash = await adapter.authorizeAward({
      milestoneId: "mile-100",
      recipientId: "worker-alice",
      amount: 100_000_000n,
      feeAmount: 20_000_000n,
      scopeHash: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
    });

    expect(authHash).toContain("base_sepolia_auth_mile-100");
    expect(authHash).toContain("0x1234567890abcd");
  });

  it("reports settlement system status and network parameters", async () => {
    const adapter = new MockSettlementAdapter();
    const status = await adapter.getStatus();
    expect(status.isHealthy).toBe(true);
    expect(status.network).toBe("mock");
  });
});
