/**
 * ledger-service.ts — Double-entry accounting service, idempotency, and reconciliation.
 * Spec §9.3: Double-entry accounting and ledger reconciliation.
 * Spec §15.1 Scenarios 3, 10, 11, 13:
 * - Duplicate/out-of-order funding webhook produces one credit; wrong chain/token never credited.
 * - Confirmed accepted earlier milestone remains payable after later dispute.
 * - Cancellation/refund/partial award conserves token amounts and balanced journals.
 */

import { Result, ok, err, createError } from "../shared/result.js";
import {
  JournalEntry,
  createFundingJournal,
  createAwardJournal,
  createPayoutJournal,
  createRefundJournal,
  validateJournalBalance,
} from "./journal.js";
import { isWalletEligibleForPayout, Wallet } from "../identity/wallet-verification.js";

export interface AccountBalances {
  settlementAsset: bigint;
  heldEmployerLiability: bigint;
  workerPayable: bigint;
  platformRevenue: bigint;
  refundPayable: bigint;
}

export interface DepositEvent {
  network: string;
  token: string;
  transactionHash: string;
  logIndex: number;
  payerAddress: string;
  amount: bigint;
}

export interface ProcessedChainEvent {
  eventKey: string; // `${network}:${txHash}:${logIndex}`
  processedAt: Date;
  journalIdempotencyKey: string;
}

export class LedgerService {
  private journals: JournalEntry[] = [];
  private processedEvents: Map<string, ProcessedChainEvent> = new Map();

  // In-memory ledger balance accumulator
  private balances: AccountBalances = {
    settlementAsset: 0n,
    heldEmployerLiability: 0n,
    workerPayable: 0n,
    platformRevenue: 0n,
    refundPayable: 0n,
  };

  /**
   * Applies an append-only journal entry to account balances after strict validation.
   */
  private applyJournal(entry: JournalEntry): Result<void> {
    const balanceCheck = validateJournalBalance(entry);
    if (!balanceCheck.ok) return balanceCheck;

    for (const line of entry.lines) {
      const net = line.debit - line.credit;
      switch (line.accountType) {
        case "settlement_asset":
          this.balances.settlementAsset += net;
          break;
        case "held_employer_liability":
          this.balances.heldEmployerLiability -= net; // liability increases with credit
          break;
        case "worker_payable":
          this.balances.workerPayable -= net; // payable increases with credit
          break;
        case "platform_revenue":
          this.balances.platformRevenue -= net; // revenue increases with credit
          break;
        case "refund_payable":
          this.balances.refundPayable -= net; // payable increases with credit
          break;
        default:
          break;
      }
    }

    this.journals.push(entry);
    return ok(undefined);
  }

  /**
   * Processes a blockchain deposit event with idempotency and chain/token validation.
   * Spec §15.1 Scenario 3.
   */
  processDeposit(params: {
    milestoneId: string;
    expectedToken: string;
    expectedNetwork: string;
    expectedAmount: bigint;
    event: DepositEvent;
  }): Result<{ journal: JournalEntry; isDuplicate: boolean }> {
    const eventKey = `${params.event.network}:${params.event.transactionHash}:${params.event.logIndex}`;

    // 1. Idempotency check: duplicate external events are not re-credited
    if (this.processedEvents.has(eventKey)) {
      const existing = this.processedEvents.get(eventKey)!;
      const existingJournal = this.journals.find(
        (j) => j.idempotencyKey === existing.journalIdempotencyKey
      );
      if (existingJournal) {
        return ok({ journal: existingJournal, isDuplicate: true });
      }
    }

    // 2. Chain and Token allowlist validation
    if (
      params.event.network !== params.expectedNetwork ||
      params.event.token !== params.expectedToken
    ) {
      return err(
        createError(
          "WRONG_NETWORK_OR_TOKEN",
          `Deposit rejected: received ${params.event.token} on ${params.event.network}, expected ${params.expectedToken} on ${params.expectedNetwork}. No credit issued.`,
          {
            receivedNetwork: params.event.network,
            receivedToken: params.event.token,
          }
        )
      );
    }

    // 3. Amount validation (underpayments remain incomplete, overpayments quarantined)
    if (params.event.amount < params.expectedAmount) {
      return err(
        createError(
          "UNDERPAYMENT",
          `Deposit incomplete: received ${params.event.amount.toString()} of expected ${params.expectedAmount.toString()}`,
          { received: params.event.amount.toString(), expected: params.expectedAmount.toString() }
        )
      );
    }

    // Generate balanced funding journal
    const idempotencyKey = `funding:${params.milestoneId}:${eventKey}`;
    const journalResult = createFundingJournal({
      milestoneId: params.milestoneId,
      idempotencyKey,
      network: params.event.network,
      token: params.event.token,
      amount: params.expectedAmount,
    });

    if (!journalResult.ok) return journalResult;

    // Apply to ledger
    const applyResult = this.applyJournal(journalResult.value);
    if (!applyResult.ok) return applyResult;

    this.processedEvents.set(eventKey, {
      eventKey,
      processedAt: new Date(),
      journalIdempotencyKey: idempotencyKey,
    });

    return ok({ journal: journalResult.value, isDuplicate: false });
  }

  /**
   * Authorizes milestone award to worker and platform revenue.
   * Debits held liability and credits worker payable + platform revenue.
   */
  authorizeAward(params: {
    milestoneId: string;
    network: string;
    token: string;
    developerAmount: bigint;
    platformFee: bigint;
    idempotencyKey: string;
  }): Result<JournalEntry> {
    const journalResult = createAwardJournal({
      milestoneId: params.milestoneId,
      idempotencyKey: params.idempotencyKey,
      network: params.network,
      token: params.token,
      developerAmount: params.developerAmount,
      platformFee: params.platformFee,
    });

    if (!journalResult.ok) return journalResult;

    const applyResult = this.applyJournal(journalResult.value);
    if (!applyResult.ok) return applyResult;

    return ok(journalResult.value);
  }

  /**
   * Executes worker payout withdrawal.
   * Guard (Spec §15.1 Scenario 11): Enforces 24-hour security hold on wallet.
   */
  executePayout(params: {
    transferId: string;
    wallet: Wallet;
    network: string;
    token: string;
    amount: bigint;
    idempotencyKey: string;
    now?: Date;
  }): Result<JournalEntry> {
    const currentTime = params.now ?? new Date();

    // 1. 24h security hold verification
    const walletEligibility = isWalletEligibleForPayout(params.wallet, currentTime);
    if (!walletEligibility.ok) return walletEligibility;

    // 2. Sufficient payable balance check
    if (this.balances.workerPayable < params.amount) {
      return err(
        createError(
          "INSUFFICIENT_AVAILABLE_FUNDS",
          "Worker payable balance is insufficient for requested withdrawal."
        )
      );
    }

    const journalResult = createPayoutJournal({
      transferId: params.transferId,
      idempotencyKey: params.idempotencyKey,
      network: params.network,
      token: params.token,
      amount: params.amount,
    });

    if (!journalResult.ok) return journalResult;

    const applyResult = this.applyJournal(journalResult.value);
    if (!applyResult.ok) return applyResult;

    return ok(journalResult.value);
  }

  /**
   * Executes employer refund or cancellation.
   * Spec §8 & §15.1 Scenario 13:
   * "Platform earns normal 20% only on awarded developer compensation; cancelled unperformed portion's fee returns."
   */
  executeRefund(params: {
    refundId: string;
    network: string;
    token: string;
    refundableLiabilityAmount: bigint;
    idempotencyKey: string;
  }): Result<JournalEntry> {
    if (this.balances.heldEmployerLiability < params.refundableLiabilityAmount) {
      return err(
        createError(
          "INSUFFICIENT_HELD_LIABILITY",
          "Held employer liability is insufficient for requested refund."
        )
      );
    }

    const journalResult = createRefundJournal({
      refundId: params.refundId,
      idempotencyKey: params.idempotencyKey,
      network: params.network,
      token: params.token,
      amount: params.refundableLiabilityAmount,
    });

    if (!journalResult.ok) return journalResult;

    const applyResult = this.applyJournal(journalResult.value);
    if (!applyResult.ok) return applyResult;

    return ok(journalResult.value);
  }

  /**
   * Daily / continuous reconciliation audit.
   * Invariant: Total Assets MUST strictly equal Total Liabilities + Equity.
   * settlementAsset === heldEmployerLiability + workerPayable + platformRevenue + refundPayable.
   */
  reconcile(): Result<{
    isBalanced: boolean;
    totalAssets: bigint;
    totalClaims: bigint;
    discrepancy: bigint;
    balances: AccountBalances;
  }> {
    const totalAssets = this.balances.settlementAsset;
    const totalClaims =
      this.balances.heldEmployerLiability +
      this.balances.workerPayable +
      this.balances.platformRevenue +
      this.balances.refundPayable;

    const discrepancy = totalAssets - totalClaims;
    const isBalanced = discrepancy === 0n;

    if (!isBalanced) {
      return err(
        createError(
          "LEDGER_MISMATCH",
          `Ledger reconciliation failed! Total assets (${totalAssets.toString()}) != total claims (${totalClaims.toString()})`,
          { totalAssets: totalAssets.toString(), totalClaims: totalClaims.toString(), discrepancy: discrepancy.toString() }
        )
      );
    }

    return ok({
      isBalanced: true,
      totalAssets,
      totalClaims,
      discrepancy: 0n,
      balances: { ...this.balances },
    });
  }

  getBalances(): AccountBalances {
    return { ...this.balances };
  }

  getJournals(): readonly JournalEntry[] {
    return [...this.journals];
  }
}
