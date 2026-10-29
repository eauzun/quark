/**
 * review-contract.ts — AI review contract and deterministic acceptance validator.
 * Spec §7.2: Review contract JSON fields and invariants.
 */

import { Result, ok, err, createError } from "../shared/result.js";

export type CriterionResultType = "pass" | "fail" | "unknown" | "not_applicable";
export type FindingSeverity = "info" | "low" | "medium" | "high" | "critical";

export interface CriterionResult {
  id: string;
  mandatory: boolean;
  result: CriterionResultType;
  evidenceRefs: string[];
  explanation: string;
}

export interface Finding {
  id: string;
  criterionId?: string;
  severity: FindingSeverity;
  filePath?: string;
  location?: Record<string, unknown>;
  observed: string;
  expected: string;
  reproduction?: string;
  requestedCorrection?: string;
}

export interface ToolRun {
  toolName: string;
  command?: string;
  exitCode?: number;
  outputSummary: string;
  durationMs: number;
  mandatory: boolean;
  passed: boolean;
}

export interface ReviewRun {
  reviewId: string;
  jobId: string;
  milestoneId: string;
  submissionHash: string;
  scopeVersion: string;
  policyVersion: string;
  modelVersions: Record<string, string>;
  riskTier: "low" | "standard" | "high";
  criteria: CriterionResult[];
  findings: Finding[];
  toolRuns: ToolRun[];
  coverageLimits: string[];
  startedAt: Date;
  completedAt: Date;
}

/**
 * Checks if a review run has unresolved unknown states.
 * Spec §7.2: "unknown must lead to inconclusive or clarification, not fail or pass by default."
 * Invariant: Infrastructure timeout or provider outage causes inconclusive, not test failure.
 */
export const isInconclusive = (review: ReviewRun): boolean => {
  // Any mandatory criterion marked unknown
  const hasUnknownMandatory = review.criteria.some(
    (c) => c.mandatory && c.result === "unknown"
  );

  // Mandatory tool run that crashed, timed out, or had infrastructure failure
  const hasInfrastructureFailure = review.toolRuns.some(
    (t) =>
      t.mandatory &&
      (t.outputSummary.toLowerCase().includes("timeout") ||
        t.outputSummary.toLowerCase().includes("crashed") ||
        t.outputSummary.toLowerCase().includes("outage") ||
        t.outputSummary.toLowerCase().includes("daemon disconnect"))
  );

  return hasUnknownMandatory || hasInfrastructureFailure;
};

/**
 * Deterministic acceptance validation.
 * Spec §7.2:
 * "accept requires all mandatory criteria passed and no unresolved critical/high blocker,
 * no missing mandatory tool run, enabled category and exact artifact match.
 * Model confidence alone cannot accept."
 */
export const canAccept = (review: ReviewRun): Result<boolean> => {
  if (isInconclusive(review)) {
    return err(
      createError(
        "REVIEW_INCONCLUSIVE",
        "Review contains unresolved unknown criteria or incomplete tool runs."
      )
    );
  }

  // 1. All mandatory criteria must pass
  const failedMandatory = review.criteria.filter(
    (c) => c.mandatory && c.result !== "pass"
  );
  if (failedMandatory.length > 0) {
    return ok(false);
  }

  // 2. No unresolved critical or high severity findings
  const blockingFindings = review.findings.filter(
    (f) => f.severity === "critical" || f.severity === "high"
  );
  if (blockingFindings.length > 0) {
    return ok(false);
  }

  // 3. All mandatory tool runs must have passed
  const unpassedMandatoryTools = review.toolRuns.filter(
    (t) => t.mandatory && !t.passed
  );
  if (unpassedMandatoryTools.length > 0) {
    return ok(false);
  }

  return ok(true);
};
