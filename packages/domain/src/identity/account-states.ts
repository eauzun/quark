/**
 * @module identity/account-states
 * @description Account lifecycle state machine for Quark.
 *
 * State graph:
 * ```
 *   pending_email ──▶ pending_approval ──▶ active ──▶ restricted
 *                            │                │            │
 *                            ▼                ▼            ▼
 *                          closed         suspended ◀──────┘
 *                                             │
 *                                             ▼
 *                                           active  (reinstate)
 *                                             │
 *                                             ▼
 *                                           closed  (terminal, financial liabilities survive)
 * ```
 *
 * Every arrow is represented by a pure transition function that:
 *   1. Checks the current state (guard).
 *   2. Validates business rules.
 *   3. Returns the next state wrapped in `Result`.
 *
 * @see Spec §3.1 — Account lifecycle
 * @see Spec §3.2 — KYC and approval flow
 */

import { type Result, ok, domainErr } from '../shared/result.js';

// ──────────────────────────────────────────────
//  State enum (discriminant)
// ──────────────────────────────────────────────

/**
 * All possible account states.
 * @see Spec §3.1
 */
export const AccountState = {
  PendingEmail: 'pending_email',
  PendingApproval: 'pending_approval',
  Active: 'active',
  Restricted: 'restricted',
  Suspended: 'suspended',
  Closed: 'closed',
} as const;

export type AccountState = (typeof AccountState)[keyof typeof AccountState];

// ──────────────────────────────────────────────
//  Entity
// ──────────────────────────────────────────────

/**
 * Core Account entity.
 *
 * This is a *value snapshot* — domain functions receive an Account and
 * return a new Account (immutable transitions). Persistence is handled
 * outside the domain layer.
 *
 * @see Spec §3.1
 */
export interface Account {
  /** Unique account identifier (UUID v7). */
  readonly id: string;

  /** Current lifecycle state. */
  readonly state: AccountState;

  /** Email address (verified once state leaves `pending_email`). */
  readonly email: string;

  /** Whether the email has been cryptographically verified. */
  readonly emailVerified: boolean;

  /** Display name chosen during registration. */
  readonly displayName: string;

  /** Role: employer, worker, or dual. */
  readonly role: 'employer' | 'worker' | 'dual';

  /** ISO-8601 creation timestamp. */
  readonly createdAt: string;

  /** ISO-8601 timestamp of last state transition. */
  readonly updatedAt: string;

  /** ID of the admin who approved / rejected the account. */
  readonly approvedBy?: string;

  /** Human-readable reason for the current state (restriction, suspension, closure). */
  readonly stateReason?: string;

  /** ISO-8601 expiry for time-bound restrictions. */
  readonly restrictionExpiry?: string;

  /** Audit trail of state transitions. */
  readonly stateHistory: ReadonlyArray<{
    readonly from: AccountState;
    readonly to: AccountState;
    readonly at: string;
    readonly by?: string;
    readonly reason?: string;
  }>;
}

// ──────────────────────────────────────────────
//  Valid transitions map
// ──────────────────────────────────────────────

/**
 * Exhaustive map of valid state transitions.
 * Used both for runtime guards and documentation.
 *
 * @see Spec §3.1 — Account state graph
 */
export const VALID_ACCOUNT_TRANSITIONS: Readonly<
  Record<AccountState, readonly AccountState[]>
> = {
  [AccountState.PendingEmail]: [AccountState.PendingApproval],
  [AccountState.PendingApproval]: [AccountState.Active, AccountState.Closed],
  [AccountState.Active]: [
    AccountState.Restricted,
    AccountState.Suspended,
    AccountState.Closed,
  ],
  [AccountState.Restricted]: [
    AccountState.Active,
    AccountState.Suspended,
    AccountState.Closed,
  ],
  [AccountState.Suspended]: [AccountState.Active, AccountState.Closed],
  [AccountState.Closed]: [], // terminal
};

// ──────────────────────────────────────────────
//  Internal helpers
// ──────────────────────────────────────────────

/** Generate an ISO-8601 timestamp for "now". */
const now = (): string => new Date().toISOString();

/** Push a history entry and advance state. */
function transition(
  account: Account,
  to: AccountState,
  by?: string,
  reason?: string,
): Account {
  return {
    ...account,
    state: to,
    updatedAt: now(),
    stateReason: reason,
    stateHistory: [
      ...account.stateHistory,
      {
        from: account.state,
        to,
        at: now(),
        by,
        reason,
      },
    ],
  };
}

function guardState(
  account: Account,
  expected: AccountState | AccountState[],
): Result<void> {
  const allowed = Array.isArray(expected) ? expected : [expected];
  if (!allowed.includes(account.state)) {
    return domainErr(
      'invalid-account-state',
      `Account ${account.id} is in state "${account.state}", expected one of [${allowed.join(', ')}]`,
      { accountId: account.id, current: account.state, expected: allowed },
    );
  }
  return ok(undefined);
}

// ──────────────────────────────────────────────
//  Transition functions
// ──────────────────────────────────────────────

/**
 * Verify the account's email address.
 *
 * Transition: `pending_email` → `pending_approval`
 *
 * Guard: account must be in `pending_email` state.
 *
 * @param account - Current account snapshot.
 * @returns Updated account in `pending_approval` state.
 *
 * @see Spec §3.2 — Email verification step
 */
export function verifyEmail(account: Account): Result<Account> {
  const guard = guardState(account, AccountState.PendingEmail);
  if (!guard.ok) return guard;

  return ok({
    ...transition(account, AccountState.PendingApproval),
    emailVerified: true,
  });
}

/**
 * Approve an account after manual review.
 *
 * Transition: `pending_approval` → `active`
 *
 * Guards:
 *   - Account must be in `pending_approval`.
 *   - An `approver` ID must be provided (human review required).
 *
 * @param account  - Current account snapshot.
 * @param approver - ID of the reviewing admin.
 * @returns Updated account in `active` state.
 *
 * @see Spec §3.2 — Approval gate
 */
export function approveAccount(
  account: Account,
  approver: string,
): Result<Account> {
  const guard = guardState(account, AccountState.PendingApproval);
  if (!guard.ok) return guard;

  if (!approver || approver.trim().length === 0) {
    return domainErr(
      'missing-approver',
      'Account approval requires a human reviewer ID',
      { accountId: account.id },
    );
  }

  return ok({
    ...transition(account, AccountState.Active, approver, 'Account approved'),
    approvedBy: approver,
  });
}

/**
 * Reject an account during the approval phase.
 *
 * Transition: `pending_approval` → `closed`
 *
 * The user may appeal through a separate out-of-band process; the
 * appeal path is tracked but does not have its own state in this machine.
 *
 * @param account - Current account snapshot.
 * @param reason  - Human-readable rejection reason (stored for audit).
 * @returns Updated account in `closed` state.
 *
 * @see Spec §3.2 — Rejection with appeal path
 */
export function rejectAccount(
  account: Account,
  reason: string,
): Result<Account> {
  const guard = guardState(account, AccountState.PendingApproval);
  if (!guard.ok) return guard;

  if (!reason || reason.trim().length === 0) {
    return domainErr(
      'missing-rejection-reason',
      'A reason is required when rejecting an account',
      { accountId: account.id },
    );
  }

  return ok(transition(account, AccountState.Closed, undefined, reason));
}

/**
 * Restrict an active account (e.g. rate-limit violations, policy warnings).
 *
 * Transition: `active` → `restricted`
 *
 * Restrictions may be time-bound (auto-lifted by infrastructure) or
 * indefinite until manual review.
 *
 * @param account - Current account snapshot.
 * @param reason  - Why the restriction was imposed.
 * @param expiry  - Optional ISO-8601 expiry timestamp.
 * @returns Updated account in `restricted` state.
 *
 * @see Spec §3.3 — Restriction policy
 */
export function restrictAccount(
  account: Account,
  reason: string,
  expiry?: string,
): Result<Account> {
  const guard = guardState(account, AccountState.Active);
  if (!guard.ok) return guard;

  if (!reason || reason.trim().length === 0) {
    return domainErr(
      'missing-restriction-reason',
      'A reason is required when restricting an account',
      { accountId: account.id },
    );
  }

  return ok({
    ...transition(account, AccountState.Restricted, undefined, reason),
    restrictionExpiry: expiry,
  });
}

/**
 * Suspend an account (severe policy violation or legal hold).
 *
 * Transition: `active` | `restricted` → `suspended`
 *
 * Suspension requires human action and blocks all platform activity.
 *
 * @param account - Current account snapshot.
 * @param reason  - Why the suspension was imposed.
 * @returns Updated account in `suspended` state.
 *
 * @see Spec §3.4 — Suspension
 */
export function suspendAccount(
  account: Account,
  reason: string,
): Result<Account> {
  const guard = guardState(account, [
    AccountState.Active,
    AccountState.Restricted,
  ]);
  if (!guard.ok) return guard;

  if (!reason || reason.trim().length === 0) {
    return domainErr(
      'missing-suspension-reason',
      'A reason is required when suspending an account',
      { accountId: account.id },
    );
  }

  return ok(transition(account, AccountState.Suspended, undefined, reason));
}

/**
 * Close an account permanently.
 *
 * Transition: any non-closed state → `closed`
 *
 * **Financial liabilities survive closure.** Outstanding payables,
 * refundables, and ledger entries are preserved and must be settled
 * through the normal payout / refund flow.
 *
 * @param account - Current account snapshot.
 * @param reason  - Why the account is being closed.
 * @returns Updated account in `closed` state.
 *
 * @see Spec §3.5 — Account closure and surviving liabilities
 */
export function closeAccount(
  account: Account,
  reason: string,
): Result<Account> {
  if (account.state === AccountState.Closed) {
    return domainErr(
      'already-closed',
      `Account ${account.id} is already closed`,
      { accountId: account.id },
    );
  }

  if (!reason || reason.trim().length === 0) {
    return domainErr(
      'missing-closure-reason',
      'A reason is required when closing an account',
      { accountId: account.id },
    );
  }

  return ok(transition(account, AccountState.Closed, undefined, reason));
}

/**
 * Reinstate a suspended account.
 *
 * Transition: `suspended` → `active`
 *
 * Requires human authorization (the reinstating admin's ID is recorded).
 *
 * @param account - Current account snapshot.
 * @param reinstatedBy - ID of the admin authorizing reinstatement.
 * @returns Updated account in `active` state.
 *
 * @see Spec §3.4 — Reinstatement
 */
export function reinstateAccount(
  account: Account,
  reinstatedBy?: string,
): Result<Account> {
  const guard = guardState(account, AccountState.Suspended);
  if (!guard.ok) return guard;

  return ok(
    transition(
      account,
      AccountState.Active,
      reinstatedBy,
      'Account reinstated after suspension review',
    ),
  );
}
