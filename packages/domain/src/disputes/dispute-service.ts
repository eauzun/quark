/**
 * dispute-service.ts — Dispute resolution, human reviewer conflict checks, and fixed compensation.
 * Spec §8: Appeals, reviewers and conduct.
 * Spec §15.1 Scenario 12:
 * "Reviewer conflict prevents assignment; human reviewer paid for valid review independent of verdict."
 */

import { Result, ok, err, createError } from "../shared/result.js";
import { detectConflictOfInterest } from "../organization/organization-permissions.js";

export type DisputeStatus =
  | "opened"
  | "technical_rerun"
  | "under_human_review"
  | "resolved"
  | "escalated_external";

export type DisputeVerdict = "upheld" | "rejected" | "partial" | "settled";

export interface HumanReviewerCandidate {
  userId: string;
  isQualified: boolean;
  activeDisputeCount: number;
  fixedHourlyRateUsdc: bigint; // Budgeting default $40–60/h (atomic units)
}

export interface DisputeRecord {
  id: string;
  milestoneId: string;
  jobId: string;
  employerUserId: string;
  workerUserId: string;
  employerOrgMemberIds?: string[];
  disputedAmount: bigint;
  status: DisputeStatus;
  openedAt: Date;
  reason: string;
  evidence: Record<string, unknown>;
  technicalRerunCompleted: boolean;
  assignedReviewerId?: string;
  reviewerCompensationFixed: bigint; // Invariant: fixed before review, never contingent on verdict
  isReviewerPaid: boolean;
  verdict?: DisputeVerdict;
  awardToWorker?: bigint;
  refundToEmployer?: bigint;
  resolvedAt?: Date;
}

export const DEFAULT_REVIEWER_FIXED_FEE = 50_000_000n; // 50 USDC fixed review compensation

/**
 * Opens a new technical dispute following failed mutual resolution.
 */
export const openDisputeRecord = (params: {
  milestoneId: string;
  jobId: string;
  employerUserId: string;
  workerUserId: string;
  employerOrgMemberIds?: string[];
  disputedAmount: bigint;
  reason: string;
  evidence: Record<string, unknown>;
}): DisputeRecord => {
  return {
    id: crypto.randomUUID(),
    milestoneId: params.milestoneId,
    jobId: params.jobId,
    employerUserId: params.employerUserId,
    workerUserId: params.workerUserId,
    employerOrgMemberIds: params.employerOrgMemberIds,
    disputedAmount: params.disputedAmount,
    status: "opened",
    openedAt: new Date(),
    reason: params.reason,
    evidence: params.evidence,
    technicalRerunCompleted: false,
    reviewerCompensationFixed: DEFAULT_REVIEWER_FIXED_FEE,
    isReviewerPaid: false,
  };
};

/**
 * Assigns an independent human reviewer to the dispute.
 * Invariant (Spec §8 & §15.1 Scenario 12):
 * Reviewer must be conflict-free (cannot be worker, employer, or org member).
 * Reviewer compensation is fixed and quoted BEFORE review, never contingent on verdict or money withheld.
 */
export const assignHumanReviewer = (params: {
  dispute: DisputeRecord;
  reviewer: HumanReviewerCandidate;
}): Result<DisputeRecord> => {
  if (
    params.dispute.status !== "opened" &&
    params.dispute.status !== "technical_rerun"
  ) {
    return err(
      createError(
        "INVALID_DISPUTE_STATE",
        `Cannot assign reviewer when dispute is in status ${params.dispute.status}`
      )
    );
  }

  // 1. Conflict of interest check (Spec §8 & §15.1 Scenario 12)
  const conflictCheck = detectConflictOfInterest({
    candidateUserId: params.reviewer.userId,
    employerUserId: params.dispute.employerUserId,
    employerOrgMemberIds: params.dispute.employerOrgMemberIds,
    assignedWorkerUserId: params.dispute.workerUserId,
    role: "reviewer_candidate",
  });

  if (!conflictCheck.ok) {
    return conflictCheck;
  }

  if (!params.reviewer.isQualified) {
    return err(
      createError(
        "REVIEWER_NOT_QUALIFIED",
        "Reviewer has not completed technical reviewer qualification rubric."
      )
    );
  }

  return ok({
    ...params.dispute,
    status: "under_human_review",
    assignedReviewerId: params.reviewer.userId,
    reviewerCompensationFixed:
      params.reviewer.fixedHourlyRateUsdc || DEFAULT_REVIEWER_FIXED_FEE,
  });
};

/**
 * Resolves dispute with binding verdict and balanced award breakdown.
 * Invariant (Spec §8):
 * - Reviewer is paid fixed fee independent of whether verdict is upheld, rejected, or partial.
 * - Total awarded + refunded MUST strictly equal disputed amount (conservation of funds).
 */
export const resolveDisputeVerdict = (params: {
  dispute: DisputeRecord;
  verdict: DisputeVerdict;
  awardToWorker: bigint;
  refundToEmployer: bigint;
  reasoning: string;
}): Result<DisputeRecord> => {
  if (params.dispute.status !== "under_human_review") {
    return err(
      createError(
        "INVALID_DISPUTE_STATE",
        `Cannot submit verdict when dispute is in status ${params.dispute.status}`
      )
    );
  }

  // Conservation of funds invariant (Spec §8 & §15.1 Scenario 13)
  const totalResolution = params.awardToWorker + params.refundToEmployer;
  if (totalResolution !== params.dispute.disputedAmount) {
    return err(
      createError(
        "RESOLUTION_AMOUNT_MISMATCH",
        `Award to worker (${params.awardToWorker.toString()}) + refund to employer (${params.refundToEmployer.toString()}) must equal total disputed amount (${params.dispute.disputedAmount.toString()})`,
        {
          totalResolution: totalResolution.toString(),
          disputedAmount: params.dispute.disputedAmount.toString(),
        }
      )
    );
  }

  return ok({
    ...params.dispute,
    status: "resolved",
    verdict: params.verdict,
    awardToWorker: params.awardToWorker,
    refundToEmployer: params.refundToEmployer,
    isReviewerPaid: true, // Reviewer compensation guaranteed regardless of verdict outcome
    resolvedAt: new Date(),
  });
};
