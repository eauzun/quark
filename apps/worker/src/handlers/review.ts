/**
 * worker/handlers/review.ts — Review execution job handler.
 * Spec §7.1: AI review pipeline runs asynchronously.
 * Spec §14.3: "Review provider outage -> pending/inconclusive, no false rejection."
 */

import { executeReviewPipeline, ReviewPipelineOutcome } from "@quark/domain";
import { type Job, type JobResult } from "../queues/queue.js";

export interface ReviewJobPayload {
  reviewId: string;
  jobId: string;
  milestoneId: string;
  submissionHash: string;
  scopeVersion: string;
  policyVersion: string;
  riskTier: "low" | "standard" | "high";
  criteria: Array<{ id: string; description: string; mandatory: boolean }>;
  files: Array<{ path: string; content: string }>;
  toolRuns: Array<{
    toolName: string;
    mandatory: boolean;
    passed: boolean;
    outputSummary: string;
    durationMs: number;
  }>;
}

/**
 * Processes a review execution job.
 *
 * Spec §15.1 Scenario 6: Model outage → inconclusive, no worker penalty.
 * The job itself should NOT retry indefinitely on model outage — it returns
 * a soft-failure result that marks the review as inconclusive.
 */
export async function handleReviewExecute(
  job: Job<ReviewJobPayload>
): Promise<JobResult> {
  const payload = job.payload;

  try {
    const result = executeReviewPipeline({
      reviewId: payload.reviewId,
      jobId: payload.jobId,
      milestoneId: payload.milestoneId,
      submissionHash: payload.submissionHash,
      scopeVersion: payload.scopeVersion,
      policyVersion: payload.policyVersion,
      riskTier: payload.riskTier,
      criteria: payload.criteria,
      files: payload.files,
      toolRuns: payload.toolRuns,
      isModelOutageOrTimeout: false,
    });

    if (!result.ok) {
      return {
        success: false,
        error: result.error.message,
        retryable: result.error.code !== "VALIDATION_ERROR",
      };
    }

    // Review completed (accept, changes_requested, or inconclusive)
    // In production, this would persist the result and trigger notification_deliver
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // If this is a model timeout/outage, don't retry aggressively
    if (message.includes("timeout") || message.includes("rate limit")) {
      return {
        success: false,
        error: `Review inconclusive due to provider issue: ${message}`,
        retryable: true,
        retryDelayMs: 60_000, // Wait 1 minute before retry
      };
    }

    return { success: false, error: message, retryable: true };
  }
}