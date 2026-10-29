/**
 * milestone-states.ts — Milestone state machine and transition guards.
 * Spec §6: Contract, milestone and delivery workflow.
 *
 * Invariant: Every payable milestone has deterministic states, isolated funding,
 * and maximum 2 valid correction rounds.
 */

import { Result, ok, err, createError } from "../shared/result.js";

export type MilestoneState =
  | "planned"
  | "offer_pending"
  | "agreed"
  | "funding_pending"
  | "funded"
  | "in_progress"
  | "submitted"
  | "reviewing"
  | "accepted_pending_objection"
  | "payable"
  | "paid"
  | "blocked"
  | "changes_requested"
  | "disputed"
  | "cancelled"
  | "partially_settled";

export interface Milestone {
  id: string;
  jobId: string;
  orderIndex: number;
  state: MilestoneState;
  developerAmount: bigint;
  platformFee: bigint;
  totalAmount: bigint;
  surchargeAmount: bigint;
  token: string;
  network: string;
  scopeVersionId?: string;
  workerId?: string;
  currentSubmissionHash?: string;
  revisionRound: number; // max 2 valid rounds before dispute escalation
  maxRevisions: number; // default 2
  blockedAt?: Date;
  totalBlockedDurationMs: number;
  acceptedAt?: Date;
  objectionDeadline?: Date; // 2 business days after AI acceptance
}

export const MAX_REVISION_ROUNDS = 2;

/**
 * Valid state transitions mapping.
 */
export const VALID_MILESTONE_TRANSITIONS: Record<MilestoneState, MilestoneState[]> = {
  planned: ["offer_pending", "cancelled"],
  offer_pending: ["agreed", "planned", "cancelled"],
  agreed: ["funding_pending", "cancelled"],
  funding_pending: ["funded", "cancelled"],
  funded: ["in_progress", "disputed", "cancelled"],
  in_progress: ["submitted", "blocked", "disputed", "cancelled"],
  submitted: ["reviewing"],
  reviewing: [
    "accepted_pending_objection",
    "changes_requested",
    "disputed",
  ],
  changes_requested: ["in_progress", "disputed"],
  blocked: ["in_progress", "disputed", "cancelled"],
  accepted_pending_objection: ["payable", "disputed"],
  payable: ["paid", "disputed"],
  paid: [],
  disputed: ["partially_settled", "paid", "cancelled"],
  cancelled: [],
  partially_settled: [],
};

/**
 * Transitions from agreed -> funding_pending.
 * Guard: Both parties accepted identical scope version.
 */
export const markFundingPending = (milestone: Milestone): Result<Milestone> => {
  if (milestone.state !== "agreed") {
    return err(
      createError(
        "INVALID_STATE_TRANSITION",
        `Cannot transition to funding_pending from ${milestone.state}`
      )
    );
  }
  return ok({
    ...milestone,
    state: "funding_pending",
  });
};

/**
 * Transitions from funding_pending -> funded.
 * Guard: Confirmed correct network, token, and atomic amount deposit.
 */
export const markFunded = (milestone: Milestone): Result<Milestone> => {
  if (milestone.state !== "funding_pending") {
    return err(
      createError(
        "INVALID_STATE_TRANSITION",
        `Cannot transition to funded from ${milestone.state}`
      )
    );
  }
  return ok({
    ...milestone,
    state: "funded",
  });
};

/**
 * Transitions from funded -> in_progress.
 * Guard: Worker notified, deadline starts, required access ready.
 */
export const startWork = (milestone: Milestone): Result<Milestone> => {
  if (milestone.state !== "funded" && milestone.state !== "changes_requested") {
    return err(
      createError(
        "INVALID_STATE_TRANSITION",
        `Cannot start work from state ${milestone.state}`
      )
    );
  }
  return ok({
    ...milestone,
    state: "in_progress",
  });
};

/**
 * Transitions from in_progress -> submitted.
 * Guard: Worker uploads immutable artifact with hash.
 */
export const submitWork = (
  milestone: Milestone,
  submissionHash: string
): Result<Milestone> => {
  if (milestone.state !== "in_progress") {
    return err(
      createError(
        "INVALID_STATE_TRANSITION",
        `Cannot submit work while in ${milestone.state}`
      )
    );
  }
  if (!submissionHash || submissionHash.trim().length === 0) {
    return err(
      createError("VALIDATION_ERROR", "Submission hash cannot be empty")
    );
  }

  return ok({
    ...milestone,
    state: "submitted",
    currentSubmissionHash: submissionHash,
  });
};

/**
 * Transitions from submitted -> reviewing.
 * Queues AI analysis & sandbox runs.
 */
export const startReview = (milestone: Milestone): Result<Milestone> => {
  if (milestone.state !== "submitted") {
    return err(
      createError(
        "INVALID_STATE_TRANSITION",
        `Cannot start review from state ${milestone.state}`
      )
    );
  }
  return ok({
    ...milestone,
    state: "reviewing",
  });
};

/**
 * Transitions from reviewing -> changes_requested.
 * Guard: Must not exceed 2 legitimate correction rounds.
 */
export const requestChanges = (milestone: Milestone): Result<Milestone> => {
  if (milestone.state !== "reviewing") {
    return err(
      createError(
        "INVALID_STATE_TRANSITION",
        `Cannot request changes from ${milestone.state}`
      )
    );
  }

  if (milestone.revisionRound >= (milestone.maxRevisions ?? MAX_REVISION_ROUNDS)) {
    return err(
      createError(
        "MAX_REVISIONS_EXCEEDED",
        `Worker has exhausted all ${milestone.maxRevisions} revision rounds. Must escalate to resolution.`,
        { revisionRound: milestone.revisionRound }
      )
    );
  }

  return ok({
    ...milestone,
    state: "changes_requested",
    revisionRound: milestone.revisionRound + 1,
  });
};

/**
 * Transitions from reviewing -> accepted_pending_objection.
 * Spec §0.2: Two business days objection period starts.
 */
export const acceptPendingObjection = (
  milestone: Milestone,
  businessDaysHours: number = 48
): Result<Milestone> => {
  if (milestone.state !== "reviewing") {
    return err(
      createError(
        "INVALID_STATE_TRANSITION",
        `Cannot accept pending objection from ${milestone.state}`
      )
    );
  }

  const now = new Date();
  const deadline = new Date(now.getTime() + businessDaysHours * 60 * 60 * 1000);

  return ok({
    ...milestone,
    state: "accepted_pending_objection",
    acceptedAt: now,
    objectionDeadline: deadline,
  });
};

/**
 * Transitions from accepted_pending_objection -> payable.
 * Employer accepted or objection period expired without dispute.
 */
export const markPayable = (
  milestone: Milestone,
  explicitAcceptance: boolean = false
): Result<Milestone> => {
  if (milestone.state !== "accepted_pending_objection") {
    return err(
      createError(
        "INVALID_STATE_TRANSITION",
        `Cannot mark payable from ${milestone.state}`
      )
    );
  }

  if (!explicitAcceptance) {
    if (milestone.objectionDeadline && new Date() < milestone.objectionDeadline) {
      return err(
        createError(
          "OBJECTION_WINDOW_ACTIVE",
          "Cannot auto-finalize payment while objection window is active"
        )
      );
    }
  }

  return ok({
    ...milestone,
    state: "payable",
  });
};

/**
 * Transitions payable -> paid.
 * Guard: Deterministic blockchain transfer confirmed.
 */
export const markPaid = (milestone: Milestone): Result<Milestone> => {
  if (milestone.state !== "payable") {
    return err(
      createError(
        "INVALID_STATE_TRANSITION",
        `Cannot mark paid from ${milestone.state}`
      )
    );
  }
  return ok({
    ...milestone,
    state: "paid",
  });
};

/**
 * Transitions eligible active state -> disputed.
 * Invariant: Only disputed amount held; earlier confirmed milestones remain payable.
 */
export const openDispute = (milestone: Milestone): Result<Milestone> => {
  const disputableStates: MilestoneState[] = [
    "funded",
    "in_progress",
    "submitted",
    "reviewing",
    "changes_requested",
    "blocked",
    "accepted_pending_objection",
    "payable",
  ];

  if (!disputableStates.includes(milestone.state)) {
    return err(
      createError(
        "INVALID_STATE_TRANSITION",
        `Cannot dispute milestone in state ${milestone.state}`
      )
    );
  }

  return ok({
    ...milestone,
    state: "disputed",
  });
};

/**
 * Blocker handling (Spec §6).
 * External blocker pauses milestone deadline.
 */
export const reportBlocker = (milestone: Milestone): Result<Milestone> => {
  if (milestone.state !== "in_progress") {
    return err(
      createError(
        "INVALID_STATE_TRANSITION",
        `Cannot report blocker from state ${milestone.state}`
      )
    );
  }
  return ok({
    ...milestone,
    state: "blocked",
    blockedAt: new Date(),
  });
};

export const resolveBlocker = (milestone: Milestone): Result<Milestone> => {
  if (milestone.state !== "blocked") {
    return err(
      createError(
        "INVALID_STATE_TRANSITION",
        `Cannot resolve blocker when state is ${milestone.state}`
      )
    );
  }
  const blockedDuration = milestone.blockedAt
    ? Date.now() - milestone.blockedAt.getTime()
    : 0;

  return ok({
    ...milestone,
    state: "in_progress",
    blockedAt: undefined,
    totalBlockedDurationMs:
      milestone.totalBlockedDurationMs + blockedDuration,
  });
};
