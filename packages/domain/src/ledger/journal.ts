/**
 * journal.ts — Double-entry accounting domain logic and balance validation.
 * Spec §9.3: Double-entry accounting.
 * ADR-003: Double-entry ledger design.
 *
 * Invariant: Every journal entry must be strictly balanced (total debits == total credits).
 * Invariant: All amounts are non-negative bigint atomic units.
 */

import { Result, ok, err, createError } from "../shared/result.js";

export type AccountType =
  | "settlement_asset"
  | "held_employer_liability"
  | "worker_payable"
  | "platform_revenue"
  | "refund_payable"
  | "provider_expense"
  | "recovery_suspense";

export interface JournalLine {
  accountType: AccountType;
  accountId?: string;
  network: string;
  token: string;
  debit: bigint;
  credit: bigint;
}

export interface JournalEntry {
  referenceType: string;
  referenceId: string;
  description: string;
  idempotencyKey: string;
  network: string;
  token: string;
  lines: JournalLine[];
}

/**
 * Validates that all lines have identical network/token and sum(debits) === sum(credits).
 */
export const validateJournalBalance = (
  entry: JournalEntry
): Result<void> => {
  if (entry.lines.length === 0) {
    return err(
      createError("EMPTY_JOURNAL", "Journal must have at least one line")
    );
  }

  let totalDebit = 0n;
  let totalCredit = 0n;

  for (const line of entry.lines) {
    if (line.debit < 0n || line.credit < 0n) {
      return err(
        createError(
          "NEGATIVE_AMOUNT",
          "Journal line amounts must be non-negative"
        )
      );
    }

    if (line.debit > 0n && line.credit > 0n) {
      return err(
        createError(
          "INVALID_LINE",
          "A single journal line cannot have both non-zero debit and credit"
        )
      );
    }

    if (line.network !== entry.network || line.token !== entry.token) {
      return err(
        createError(
          "CROSS_TOKEN_NETTING_PROHIBITED",
          "Cross-network or cross-token entries in single journal prohibited"
        )
      );
    }

    totalDebit += line.debit;
    totalCredit += line.credit;
  }

  if (totalDebit !== totalCredit) {
    return err(
      createError(
        "UNBALANCED_JOURNAL",
        `Journal is unbalanced: total debits (${totalDebit.toString()}) != total credits (${totalCredit.toString()})`,
        {
          totalDebit: totalDebit.toString(),
          totalCredit: totalCredit.toString(),
        }
      )
    );
  }

  return ok(undefined);
};

/**
 * Creates deposit journal:
 * On confirmed 120 token deposit:
 *   DR settlement_asset 120
 *   CR held_employer_liability 120
 */
export const createFundingJournal = (params: {
  milestoneId: string;
  idempotencyKey: string;
  network: string;
  token: string;
  amount: bigint;
}): Result<JournalEntry> => {
  if (params.amount <= 0n) {
    return err(
      createError("INVALID_AMOUNT", "Funding amount must be greater than zero")
    );
  }

  const entry: JournalEntry = {
    referenceType: "milestone_funding",
    referenceId: params.milestoneId,
    description: `Confirmed funding deposit for milestone ${params.milestoneId}`,
    idempotencyKey: params.idempotencyKey,
    network: params.network,
    token: params.token,
    lines: [
      {
        accountType: "settlement_asset",
        network: params.network,
        token: params.token,
        debit: params.amount,
        credit: 0n,
      },
      {
        accountType: "held_employer_liability",
        network: params.network,
        token: params.token,
        debit: 0n,
        credit: params.amount,
      },
    ],
  };

  const validation = validateJournalBalance(entry);
  if (!validation.ok) return validation;

  return ok(entry);
};

/**
 * Creates award journal:
 * On accepted 100 developer award (with 20 platform fee):
 *   DR held_employer_liability 120
 *   CR worker_payable 100
 *   CR platform_revenue 20
 */
export const createAwardJournal = (params: {
  milestoneId: string;
  idempotencyKey: string;
  network: string;
  token: string;
  developerAmount: bigint;
  platformFee: bigint;
}): Result<JournalEntry> => {
  const totalLiability = params.developerAmount + params.platformFee;
  if (totalLiability <= 0n) {
    return err(
      createError("INVALID_AMOUNT", "Award total must be greater than zero")
    );
  }

  const entry: JournalEntry = {
    referenceType: "milestone_award",
    referenceId: params.milestoneId,
    description: `Accepted milestone award: ${params.developerAmount.toString()} to worker, ${params.platformFee.toString()} platform fee`,
    idempotencyKey: params.idempotencyKey,
    network: params.network,
    token: params.token,
    lines: [
      {
        accountType: "held_employer_liability",
        network: params.network,
        token: params.token,
        debit: totalLiability,
        credit: 0n,
      },
      {
        accountType: "worker_payable",
        network: params.network,
        token: params.token,
        debit: 0n,
        credit: params.developerAmount,
      },
      {
        accountType: "platform_revenue",
        network: params.network,
        token: params.token,
        debit: 0n,
        credit: params.platformFee,
      },
    ],
  };

  const validation = validateJournalBalance(entry);
  if (!validation.ok) return validation;

  return ok(entry);
};

/**
 * Creates payout withdrawal journal:
 * On worker payout:
 *   DR worker_payable 100
 *   CR settlement_asset 100
 */
export const createPayoutJournal = (params: {
  transferId: string;
  idempotencyKey: string;
  network: string;
  token: string;
  amount: bigint;
}): Result<JournalEntry> => {
  if (params.amount <= 0n) {
    return err(
      createError("INVALID_AMOUNT", "Payout amount must be greater than zero")
    );
  }

  const entry: JournalEntry = {
    referenceType: "worker_payout",
    referenceId: params.transferId,
    description: `Confirmed worker payout withdrawal of ${params.amount.toString()}`,
    idempotencyKey: params.idempotencyKey,
    network: params.network,
    token: params.token,
    lines: [
      {
        accountType: "worker_payable",
        network: params.network,
        token: params.token,
        debit: params.amount,
        credit: 0n,
      },
      {
        accountType: "settlement_asset",
        network: params.network,
        token: params.token,
        debit: 0n,
        credit: params.amount,
      },
    ],
  };

  const validation = validateJournalBalance(entry);
  if (!validation.ok) return validation;

  return ok(entry);
};

/**
 * Creates refund journal:
 * On cancellation or employer refund:
 *   DR held_employer_liability amount
 *   CR refund_payable amount
 */
export const createRefundJournal = (params: {
  refundId: string;
  idempotencyKey: string;
  network: string;
  token: string;
  amount: bigint;
}): Result<JournalEntry> => {
  if (params.amount <= 0n) {
    return err(
      createError("INVALID_AMOUNT", "Refund amount must be greater than zero")
    );
  }

  const entry: JournalEntry = {
    referenceType: "employer_refund",
    referenceId: params.refundId,
    description: `Employer refund authorization of ${params.amount.toString()}`,
    idempotencyKey: params.idempotencyKey,
    network: params.network,
    token: params.token,
    lines: [
      {
        accountType: "held_employer_liability",
        network: params.network,
        token: params.token,
        debit: params.amount,
        credit: 0n,
      },
      {
        accountType: "refund_payable",
        network: params.network,
        token: params.token,
        debit: 0n,
        credit: params.amount,
      },
    ],
  };

  const validation = validateJournalBalance(entry);
  if (!validation.ok) return validation;

  return ok(entry);
};
