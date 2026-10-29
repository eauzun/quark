/**
 * @module jobs/job-states
 * @description Job lifecycle state machine for Quark.
 *
 * State graph:
 * ```
 *   draft ──▶ scoping ──▶ ready ──▶ matching ──┬──▶ awaiting_funding ──▶ active ──▶ completed
 *                                               │         │                 │
 *                                               ▼         │                 ▼
 *                                       waiting_for_talent │              paused
 *                                               │         │                 │
 *                                               └─────────┴────▶ cancelled ◀┘
 * ```
 *
 * All states except `completed` and `cancelled` can transition to `cancelled`
 * under the appropriate guard conditions.
 *
 * @see Spec §4.1 — Job lifecycle
 */

import { type Result, ok, domainErr } from '../shared/result';

// ──────────────────────────────────────────────
//  State enum
// ──────────────────────────────────────────────

/**
 * Discriminant values for the Job state machine.
 * @see Spec §4.1
 */
export const JobState = {
  Draft: 'draft',
  Scoping: 'scoping',
  Ready: 'ready',
  Matching: 'matching',
  WaitingForTalent: 'waiting_for_talent',
  AwaitingFunding: 'awaiting_funding',
  Active: 'active',
  Paused: 'paused',
  Completed: 'completed',
  Cancelled: 'cancelled',
} as const;

export type JobState = (typeof JobState)[keyof typeof JobState];

// ──────────────────────────────────────────────
//  Entity
// ──────────────────────────────────────────────

/**
 * Core Job entity — an immutable snapshot used by transition functions.
 *
 * @see Spec §4.1
 */
export interface Job {
  /** Unique job identifier (UUID v7). */
  readonly id: string;

  /** Current lifecycle state. */
  readonly state: JobState;

  /** Employer (account ID) who created the job. */
  readonly employerId: string;

  /** Job title. */
  readonly title: string;

  /** Detailed description / requirements (markdown). */
  readonly description: string;

  /** Accepted worker account ID (set after matching). */
  readonly workerId?: string;

  /** Whether the AI scoping review has been completed. */
  readonly scopeFinalized: boolean;

  /** Whether on-chain funding has been confirmed. */
  readonly fundingConfirmed: boolean;

  /** Whether all milestones are in a terminal state. */
  readonly allMilestonesResolved: boolean;

  /** IDs of milestones belonging to this job. */
  readonly milestoneIds: readonly string[];

  /** ISO-8601 creation timestamp. */
  readonly createdAt: string;

  /** ISO-8601 last-updated timestamp. */
  readonly updatedAt: string;

  /** Reason for pause or cancellation. */
  readonly stateReason?: string;

  /** Audit trail. */
  readonly stateHistory: ReadonlyArray<{
    readonly from: JobState;
    readonly to: JobState;
    readonly at: string;
    readonly reason?: string;
  }>;
}

// ──────────────────────────────────────────────
//  Valid transitions map (exhaustive)
// ──────────────────────────────────────────────

/**
 * Exhaustive map of every legal state transition.
 *
 * @see Spec §4.1 — Job state graph
 */
export const VALID_JOB_TRANSITIONS: Readonly<
  Record<JobState, readonly JobState[]>
> = {
  [JobState.Draft]: [JobState.Scoping, JobState.Cancelled],
  [JobState.Scoping]: [JobState.Ready, JobState.Cancelled],
  [JobState.Ready]: [JobState.Matching, JobState.Cancelled],
  [JobState.Matching]: [
    JobState.AwaitingFunding,
    JobState.WaitingForTalent,
    JobState.Cancelled,
  ],
  [JobState.WaitingForTalent]: [JobState.Matching, JobState.Cancelled],
  [JobState.AwaitingFunding]: [JobState.Active, JobState.Cancelled],
  [JobState.Active]: [
    JobState.Completed,
    JobState.Paused,
    JobState.Cancelled,
  ],
  [JobState.Paused]: [JobState.Active, JobState.Cancelled],
  [JobState.Completed]: [], // terminal
  [JobState.Cancelled]: [], // terminal
};

// ──────────────────────────────────────────────
//  Cancellable states
// ──────────────────────────────────────────────

/**
 * States from which a job may be cancelled.
 * `completed` and `cancelled` are terminal and cannot be cancelled again.
 *
 * @see Spec §4.5 — Cancellation eligibility
 */
export const CANCELLABLE_STATES: readonly JobState[] = [
  JobState.Draft,
  JobState.Scoping,
  JobState.Ready,
  JobState.Matching,
  JobState.WaitingForTalent,
  JobState.AwaitingFunding,
  JobState.Active,
  JobState.Paused,
];

// ──────────────────────────────────────────────
//  Helpers
// ──────────────────────────────────────────────

const now = (): string => new Date().toISOString();

function transitionJob(
  job: Job,
  to: JobState,
  reason?: string,
): Job {
  return {
    ...job,
    state: to,
    updatedAt: now(),
    stateReason: reason,
    stateHistory: [
      ...job.stateHistory,
      { from: job.state, to, at: now(), reason },
    ],
  };
}

function guardJobState(
  job: Job,
  expected: JobState | JobState[],
): Result<void> {
  const allowed = Array.isArray(expected) ? expected : [expected];
  if (!allowed.includes(job.state)) {
    return domainErr(
      'invalid-job-state',
      `Job ${job.id} is in state "${job.state}", expected one of [${allowed.join(', ')}]`,
      { jobId: job.id, current: job.state, expected: allowed },
    );
  }
  return ok(undefined);
}

// ──────────────────────────────────────────────
//  Transition functions
// ──────────────────────────────────────────────

/**
 * Submit a draft job for AI scoping review.
 *
 * Transition: `draft` → `scoping`
 *
 * @param job - Current job snapshot.
 * @returns Updated job in `scoping` state.
 *
 * @see Spec §4.2 — Scoping phase
 */
export function submitForScoping(job: Job): Result<Job> {
  const guard = guardJobState(job, JobState.Draft);
  if (!guard.ok) return guard;

  if (!job.title || job.title.trim().length === 0) {
    return domainErr('missing-title', 'Job must have a title before scoping', {
      jobId: job.id,
    });
  }

  if (!job.description || job.description.trim().length === 0) {
    return domainErr(
      'missing-description',
      'Job must have a description before scoping',
      { jobId: job.id },
    );
  }

  return ok(transitionJob(job, JobState.Scoping, 'Submitted for AI scoping'));
}

/**
 * Mark the job's scope as finalized after AI review.
 *
 * Transition: `scoping` → `ready`
 *
 * Guard: `scopeFinalized` must be true (AI review completed and accepted).
 *
 * @param job - Current job snapshot.
 * @returns Updated job in `ready` state.
 *
 * @see Spec §4.2 — Scope finalization gate
 */
export function markReady(job: Job): Result<Job> {
  const guard = guardJobState(job, JobState.Scoping);
  if (!guard.ok) return guard;

  if (!job.scopeFinalized) {
    return domainErr(
      'scope-not-finalized',
      'Job scope must be finalized by AI review before marking ready',
      { jobId: job.id },
    );
  }

  return ok(transitionJob(job, JobState.Ready, 'Scope finalized'));
}

/**
 * Begin the matching phase — the system will search for candidates.
 *
 * Transition: `ready` → `matching`
 *
 * @param job - Current job snapshot.
 * @returns Updated job in `matching` state.
 *
 * @see Spec §5.1 — Matching initiation
 */
export function startMatching(job: Job): Result<Job> {
  const guard = guardJobState(job, JobState.Ready);
  if (!guard.ok) return guard;

  return ok(transitionJob(job, JobState.Matching, 'Matching started'));
}

/**
 * A worker has accepted the offer; await employer funding.
 *
 * Transition: `matching` → `awaiting_funding`
 *
 * Guard: `workerId` must be set (a worker accepted the offer).
 *
 * @param job - Current job snapshot.
 * @returns Updated job in `awaiting_funding` state.
 *
 * @see Spec §5.3 — Offer acceptance → funding
 */
export function awaitFunding(job: Job): Result<Job> {
  const guard = guardJobState(job, JobState.Matching);
  if (!guard.ok) return guard;

  if (!job.workerId) {
    return domainErr(
      'no-worker-assigned',
      'A worker must accept an offer before moving to awaiting_funding',
      { jobId: job.id },
    );
  }

  return ok(transitionJob(job, JobState.AwaitingFunding, 'Worker accepted, awaiting funding'));
}

/**
 * On-chain funding confirmed — job becomes active.
 *
 * Transition: `awaiting_funding` → `active`
 *
 * Guard: `fundingConfirmed` must be true (on-chain event verified).
 *
 * @param job - Current job snapshot.
 * @returns Updated job in `active` state.
 *
 * @see Spec §4.4 — Funding confirmation
 */
export function activateJob(job: Job): Result<Job> {
  const guard = guardJobState(job, JobState.AwaitingFunding);
  if (!guard.ok) return guard;

  if (!job.fundingConfirmed) {
    return domainErr(
      'funding-not-confirmed',
      'On-chain funding must be confirmed before activating the job',
      { jobId: job.id },
    );
  }

  return ok(transitionJob(job, JobState.Active, 'Funding confirmed, job active'));
}

/**
 * Complete a job after all milestones are resolved.
 *
 * Transition: `active` → `completed`
 *
 * Guard: `allMilestonesResolved` must be true.
 *
 * @param job - Current job snapshot.
 * @returns Updated job in `completed` state.
 *
 * @see Spec §4.6 — Job completion
 */
export function completeJob(job: Job): Result<Job> {
  const guard = guardJobState(job, JobState.Active);
  if (!guard.ok) return guard;

  if (!job.allMilestonesResolved) {
    return domainErr(
      'milestones-unresolved',
      'All milestones must be resolved before completing the job',
      { jobId: job.id },
    );
  }

  return ok(transitionJob(job, JobState.Completed, 'All milestones resolved'));
}

/**
 * Pause an active job.
 *
 * Transition: `active` → `paused`
 *
 * @param job    - Current job snapshot.
 * @param reason - Why the job is being paused.
 * @returns Updated job in `paused` state.
 *
 * @see Spec §4.5 — Job pause
 */
export function pauseJob(job: Job, reason: string): Result<Job> {
  const guard = guardJobState(job, JobState.Active);
  if (!guard.ok) return guard;

  if (!reason || reason.trim().length === 0) {
    return domainErr('missing-pause-reason', 'A reason is required to pause a job', {
      jobId: job.id,
    });
  }

  return ok(transitionJob(job, JobState.Paused, reason));
}

/**
 * Resume a paused job.
 *
 * Transition: `paused` → `active`
 *
 * @param job - Current job snapshot.
 * @returns Updated job back in `active` state.
 *
 * @see Spec §4.5 — Job resume
 */
export function resumeJob(job: Job): Result<Job> {
  const guard = guardJobState(job, JobState.Paused);
  if (!guard.ok) return guard;

  return ok(transitionJob(job, JobState.Active, 'Job resumed'));
}

/**
 * Cancel a job. Eligible from most non-terminal states.
 *
 * Transition: eligible states → `cancelled`
 *
 * @param job    - Current job snapshot.
 * @param reason - Cancellation reason (required).
 * @returns Updated job in `cancelled` state.
 *
 * @see Spec §4.5 — Cancellation rules
 */
export function cancelJob(job: Job, reason: string): Result<Job> {
  if (!CANCELLABLE_STATES.includes(job.state)) {
    return domainErr(
      'not-cancellable',
      `Job ${job.id} in state "${job.state}" cannot be cancelled`,
      { jobId: job.id, current: job.state },
    );
  }

  if (!reason || reason.trim().length === 0) {
    return domainErr(
      'missing-cancel-reason',
      'A reason is required to cancel a job',
      { jobId: job.id },
    );
  }

  return ok(transitionJob(job, JobState.Cancelled, reason));
}

/**
 * Move a job to waiting_for_talent when no suitable candidates are found.
 *
 * Transition: `matching` → `waiting_for_talent`
 *
 * @param job - Current job snapshot.
 * @returns Updated job in `waiting_for_talent` state.
 *
 * @see Spec §5.2 — No candidates fallback
 */
export function waitForTalent(job: Job): Result<Job> {
  const guard = guardJobState(job, JobState.Matching);
  if (!guard.ok) return guard;

  return ok(
    transitionJob(job, JobState.WaitingForTalent, 'No suitable candidates found'),
  );
}

/**
 * Re-enter matching from waiting_for_talent (e.g. new workers available).
 *
 * Transition: `waiting_for_talent` → `matching`
 *
 * @param job - Current job snapshot.
 * @returns Updated job back in `matching` state.
 *
 * @see Spec §5.2 — Re-match trigger
 */
export function retryMatching(job: Job): Result<Job> {
  const guard = guardJobState(job, JobState.WaitingForTalent);
  if (!guard.ok) return guard;

  return ok(transitionJob(job, JobState.Matching, 'Retrying matching'));
}
