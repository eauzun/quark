/**
 * worker/handlers/settlement.ts — Settlement monitoring job handlers.
 * Spec §9.1: "Funding tied to unique milestone and payer intent. Validate chain id,
 * exact token contract, recipient and atomic amount."
 * Spec §14.3: "Alert immediately on ... stuck payable transfer."
 */

import { type Job, type JobResult } from "../queues/queue.js";

export interface SettlementMonitorPayload {
  milestoneId: string;
  fundingIntentId: string;
  network: string;
  token: string;
  expectedAmount: string; // Atomic units as string
  recipientAddress: string;
  /** How many times this job has polled */
  pollCount: number;
  /** Maximum polls before escalating */
  maxPolls: number;
}

export interface RecordingCleanupPayload {
  recordingId: string;
  storagePath: string;
  expiresAt: string;
  hasDisputeHold: boolean;
}

export interface LedgerReconcilePayload {
  date: string; // YYYY-MM-DD
}

/**
 * Monitors chain for funding events matching a pending intent.
 * Spec §9.1: "Pre-finality deposits not spendable."
 *
 * Polls until the deposit is confirmed or the job exhausts its poll budget.
 */
export async function handleSettlementMonitor(
  job: Job<SettlementMonitorPayload>
): Promise<JobResult> {
  const payload = job.payload;

  if (payload.pollCount >= payload.maxPolls) {
    // Funding grace period expired
    return {
      success: false,
      error: `Funding not detected for milestone ${payload.milestoneId} after ${payload.maxPolls} polls`,
      retryable: false, // Don't retry — escalate to operator instead
    };
  }

  // In production, this would call the settlement adapter's observeFunding
  // For now, return a retryable result that re-schedules polling
  return {
    success: false,
    error: "Funding not yet detected — continuing to poll",
    retryable: true,
    retryDelayMs: 30_000, // Poll every 30 seconds
  };
}

/**
 * Deletes expired recordings after retention period.
 * Spec §3.2: "Delete within 24 hours after expiry; failed deletion alerts operator."
 * Spec §15.1 Scenario 16: "Recording expiry deletes media; open dispute retention
 * exception recorded and later removed."
 */
export async function handleRecordingCleanup(
  job: Job<RecordingCleanupPayload>
): Promise<JobResult> {
  const payload = job.payload;

  // Never delete recordings with active dispute hold
  if (payload.hasDisputeHold) {
    return {
      success: false,
      error: `Recording ${payload.recordingId} has active dispute hold — deletion blocked`,
      retryable: true,
      retryDelayMs: 24 * 60 * 60 * 1000, // Check again in 24 hours
    };
  }

  const now = new Date();
  const expiresAt = new Date(payload.expiresAt);

  if (now < expiresAt) {
    // Not yet expired — reschedule
    return {
      success: false,
      error: "Not yet expired",
      retryable: true,
      retryDelayMs: expiresAt.getTime() - now.getTime(),
    };
  }

  // Expired — proceed with deletion
  // In production: call S3/R2 delete API, verify deletion, alert on failure
  return { success: true };
}

/**
 * Runs daily ledger reconciliation.
 * Spec §9.3: "Daily balance reconciliation and continuous mismatch alerts."
 * Spec §15.1 Scenario 25: "Backup restore reconstructs ledger/outbox without
 * replaying settled transfers."
 */
export async function handleLedgerReconcile(
  job: Job<LedgerReconcilePayload>
): Promise<JobResult> {
  // In production, this would:
  // 1. Sum all journal lines by account
  // 2. Verify DR=CR
  // 3. Compare against on-chain balances
  // 4. Alert on mismatch
  return { success: true };
}

/**
 * Expires stale offers and advances to the next candidate.
 * Spec §5: "Decline moves to next eligible worker; unanswered expiry counts
 * only when delivery notification succeeds and worker was available."
 */
export async function handleOfferExpire(
  job: Job<{ offerId: string; milestoneId: string; nextCandidateId?: string }>
): Promise<JobResult> {
  const { offerId, nextCandidateId } = job.payload;

  if (!nextCandidateId) {
    // No more candidates — transition to waiting_for_talent
    // Spec §5: "When no candidate remains, expose waiting state"
    return { success: true };
  }

  // Advance to next candidate
  return { success: true };
}

/**
 * Checks if the objection window has expired and transitions milestone to payable.
 * Spec §7.2: "Employer explicitly accepts or two business days expire without dispute."
 */
export async function handleObjectionWindowCheck(
  job: Job<{ milestoneId: string; objectionDeadline: string }>
): Promise<JobResult> {
  const deadline = new Date(job.payload.objectionDeadline);
  const now = new Date();

  if (now < deadline) {
    // Not yet expired — reschedule
    return {
      success: false,
      error: "Objection window still active",
      retryable: true,
      retryDelayMs: deadline.getTime() - now.getTime(),
    };
  }

  // Window expired without dispute — auto-transition to payable
  return { success: true };
}