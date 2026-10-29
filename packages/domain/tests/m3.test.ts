import { describe, it, expect, beforeEach } from "vitest";
import { LedgerService, DepositEvent } from "../src/ledger/ledger-service.js";
import { registerVerifiedWallet } from "../src/identity/wallet-verification.js";

describe("M3: Double-Entry Ledger & Financial Invariants (Spec §9 & §15.1)", () => {
  let ledger: LedgerService;

  beforeEach(() => {
    ledger = new LedgerService();
  });

  it("handles duplicate and out-of-order funding webhooks with idempotency (Spec §15.1 Scenario 3)", () => {
    const event: DepositEvent = {
      network: "base",
      token: "USDC",
      transactionHash: "0xdeposit_tx_abc123",
      logIndex: 0,
      payerAddress: "0xpayer_wallet",
      amount: 120_000_000n, // 120 USDC
    };

    // First arrival
    const firstResult = ledger.processDeposit({
      milestoneId: "mile-1",
      expectedNetwork: "base",
      expectedToken: "USDC",
      expectedAmount: 120_000_000n,
      event,
    });

    expect(firstResult.ok).toBe(true);
    if (!firstResult.ok) return;
    expect(firstResult.value.isDuplicate).toBe(false);

    const balancesAfterFirst = ledger.getBalances();
    expect(balancesAfterFirst.settlementAsset).toBe(120_000_000n);
    expect(balancesAfterFirst.heldEmployerLiability).toBe(120_000_000n);

    // Duplicate webhook arrival (network retry) -> must produce single credit
    const duplicateResult = ledger.processDeposit({
      milestoneId: "mile-1",
      expectedNetwork: "base",
      expectedToken: "USDC",
      expectedAmount: 120_000_000n,
      event,
    });

    expect(duplicateResult.ok).toBe(true);
    if (!duplicateResult.ok) return;
    expect(duplicateResult.value.isDuplicate).toBe(true);

    const balancesAfterDuplicate = ledger.getBalances();
    expect(balancesAfterDuplicate.settlementAsset).toBe(120_000_000n); // Unchanged!
    expect(balancesAfterDuplicate.heldEmployerLiability).toBe(120_000_000n);
  });

  it("strictly rejects deposits on wrong chain or wrong token without credit (Spec §15.1 Scenario 3)", () => {
    // Expected USDC on Base, but event is on Arbitrum
    const wrongChainEvent: DepositEvent = {
      network: "arbitrum",
      token: "USDC",
      transactionHash: "0xarbitrum_tx",
      logIndex: 0,
      payerAddress: "0xpayer",
      amount: 120_000_000n,
    };

    const result = ledger.processDeposit({
      milestoneId: "mile-1",
      expectedNetwork: "base",
      expectedToken: "USDC",
      expectedAmount: 120_000_000n,
      event: wrongChainEvent,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("WRONG_NETWORK_OR_TOKEN");
    }

    const balances = ledger.getBalances();
    expect(balances.settlementAsset).toBe(0n);
    expect(balances.heldEmployerLiability).toBe(0n);
  });

  it("preserves earlier milestone payability when later milestone enters dispute (Spec §15.1 Scenario 10)", () => {
    // 1. Fund milestone 1 (120 USDC) and milestone 2 (120 USDC)
    ledger.processDeposit({
      milestoneId: "mile-1",
      expectedNetwork: "base",
      expectedToken: "USDC",
      expectedAmount: 120_000_000n,
      event: {
        network: "base",
        token: "USDC",
        transactionHash: "0xtx_fund_1",
        logIndex: 0,
        payerAddress: "0xpayer",
        amount: 120_000_000n,
      },
    });

    ledger.processDeposit({
      milestoneId: "mile-2",
      expectedNetwork: "base",
      expectedToken: "USDC",
      expectedAmount: 120_000_000n,
      event: {
        network: "base",
        token: "USDC",
        transactionHash: "0xtx_fund_2",
        logIndex: 0,
        payerAddress: "0xpayer",
        amount: 120_000_000n,
      },
    });

    // 2. Milestone 1 is accepted -> award 100 dev + 20 platform fee
    const awardM1 = ledger.authorizeAward({
      milestoneId: "mile-1",
      network: "base",
      token: "USDC",
      developerAmount: 100_000_000n,
      platformFee: 20_000_000n,
      idempotencyKey: "award-m1",
    });
    expect(awardM1.ok).toBe(true);

    // 3. Milestone 2 enters dispute -> only M2 liability is held, M1 worker_payable is untouched!
    const balances = ledger.getBalances();
    expect(balances.workerPayable).toBe(100_000_000n); // Milestone 1 payable remains fully intact
    expect(balances.heldEmployerLiability).toBe(120_000_000n); // Milestone 2 still held
  });

  it("enforces 24-hour wallet hold before payout execution (Spec §15.1 Scenario 11)", () => {
    // Fund & award
    ledger.processDeposit({
      milestoneId: "mile-1",
      expectedNetwork: "base",
      expectedToken: "USDC",
      expectedAmount: 120_000_000n,
      event: {
        network: "base",
        token: "USDC",
        transactionHash: "0xtx_fund_payout",
        logIndex: 0,
        payerAddress: "0xpayer",
        amount: 120_000_000n,
      },
    });

    ledger.authorizeAward({
      milestoneId: "mile-1",
      network: "base",
      token: "USDC",
      developerAmount: 100_000_000n,
      platformFee: 20_000_000n,
      idempotencyKey: "award-payout-test",
    });

    const now = new Date("2026-10-28T12:00:00Z");
    const wallet = registerVerifiedWallet({
      userId: "worker-alice",
      network: "base",
      address: "0xalice_payout_addr",
      message: "Quark Auth",
      signature: "0xvalid_sig",
      now,
    });

    // Immediate payout attempt -> blocked by 24h hold
    const prematurePayout = ledger.executePayout({
      transferId: "txf-1",
      wallet,
      network: "base",
      token: "USDC",
      amount: 100_000_000n,
      idempotencyKey: "payout-idem-1",
      now,
    });

    expect(prematurePayout.ok).toBe(false);
    if (!prematurePayout.ok) {
      expect(prematurePayout.error.code).toBe("PAYOUT_LOCKED");
    }

    // 25 hours later -> payout succeeds
    const eligibleTime = new Date(now.getTime() + 25 * 60 * 60 * 1000);
    const validPayout = ledger.executePayout({
      transferId: "txf-1",
      wallet,
      network: "base",
      token: "USDC",
      amount: 100_000_000n,
      idempotencyKey: "payout-idem-1",
      now: eligibleTime,
    });

    expect(validPayout.ok).toBe(true);
    const finalBalances = ledger.getBalances();
    expect(finalBalances.workerPayable).toBe(0n);
    expect(finalBalances.settlementAsset).toBe(20_000_000n); // Platform fee remaining
  });

  it("conserves token amounts and maintains zero discrepancy across partial awards and refunds (Spec §15.1 Scenario 13)", () => {
    // 1. Deposit 120 USDC
    ledger.processDeposit({
      milestoneId: "mile-cancel",
      expectedNetwork: "base",
      expectedToken: "USDC",
      expectedAmount: 120_000_000n,
      event: {
        network: "base",
        token: "USDC",
        transactionHash: "0xtx_fund_cancel",
        logIndex: 0,
        payerAddress: "0xpayer",
        amount: 120_000_000n,
      },
    });

    // 2. Cancellation before work -> 100% refund (120 USDC returned to employer)
    // Platform earns 0 fee on unperformed work (Spec §8)
    const refund = ledger.executeRefund({
      refundId: "ref-1",
      network: "base",
      token: "USDC",
      refundableLiabilityAmount: 120_000_000n,
      idempotencyKey: "refund-idem-1",
    });

    expect(refund.ok).toBe(true);

    // 3. Strict reconciliation: Total Assets == Total Claims (discrepancy == 0)
    const reconciliation = ledger.reconcile();
    expect(reconciliation.ok).toBe(true);
    if (reconciliation.ok) {
      expect(reconciliation.value.isBalanced).toBe(true);
      expect(reconciliation.value.discrepancy).toBe(0n);
      expect(reconciliation.value.totalAssets).toBe(120_000_000n);
      expect(reconciliation.value.balances.refundPayable).toBe(120_000_000n);
      expect(reconciliation.value.balances.platformRevenue).toBe(0n); // Unperformed fee = 0
    }
  });
});
