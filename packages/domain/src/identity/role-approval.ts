/**
 * role-approval.ts — Role requests, dual-role isolation, and approval state machine.
 * Spec §2: Dual roles allowed with separate approvals and conflict/abuse controls.
 */

import { Result, ok, err, createError } from "../shared/result.js";

export type RoleType = "employer" | "worker" | "reviewer";
export type RoleStatus = "pending" | "approved" | "rejected" | "suspended";

export interface RoleApproval {
  id: string;
  userId: string;
  role: RoleType;
  status: RoleStatus;
  reasons: string[];
  policyVersion: number;
  reviewedBy?: string; // 'system_rules' | 'ai_evaluator' | admin user id
  appealNotes?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface EmployerApprovalInput {
  userId: string;
  emailVerified: boolean;
  ageAttested: boolean;
  intendedUse: string;
  projectDescription?: string;
  website?: string;
  policyVersion?: number;
}

/**
 * Evaluates an employer application.
 * Rules + AI may approve; suspicious/spammy applications route to human review.
 */
export const evaluateEmployerApproval = (
  input: EmployerApprovalInput
): Result<RoleApproval> => {
  if (!input.emailVerified) {
    return err(
      createError(
        "EMAIL_NOT_VERIFIED",
        "Email verification is mandatory before requesting employer status."
      )
    );
  }

  if (!input.ageAttested) {
    return err(
      createError(
        "AGE_ATTESTATION_REQUIRED",
        "Adult age attestation is required to use Quark."
      )
    );
  }

  if (!input.intendedUse || input.intendedUse.trim().length < 10) {
    return err(
      createError(
        "VALIDATION_ERROR",
        "Please provide a meaningful intended use statement (minimum 10 characters)."
      )
    );
  }

  // Basic spam / abuse heuristic
  const isSuspicious =
    input.intendedUse.toLowerCase().includes("free crypto") ||
    input.intendedUse.toLowerCase().includes("airdrop") ||
    input.intendedUse.toLowerCase().includes("telegram bot pump");

  const status: RoleStatus = isSuspicious ? "pending" : "approved";
  const reviewedBy = isSuspicious ? undefined : "system_rules";

  return ok({
    id: crypto.randomUUID(),
    userId: input.userId,
    role: "employer",
    status,
    reasons: isSuspicious
      ? ["Flagged for manual review due to automated risk signals."]
      : ["Meets initial employer acceptance criteria."],
    policyVersion: input.policyVersion ?? 1,
    reviewedBy,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
};

/**
 * Suspends or restricts a role.
 */
export const suspendRole = (
  role: RoleApproval,
  reason: string
): Result<RoleApproval> => {
  if (role.status === "suspended") {
    return err(createError("ALREADY_SUSPENDED", "Role is already suspended."));
  }

  return ok({
    ...role,
    status: "suspended",
    reasons: [...role.reasons, `Suspension reason: ${reason}`],
    updatedAt: new Date(),
  });
};

/**
 * Appeals a rejected or suspended role.
 */
export const appealRoleDecision = (
  role: RoleApproval,
  appealNotes: string
): Result<RoleApproval> => {
  if (role.status !== "rejected" && role.status !== "suspended") {
    return err(
      createError(
        "NOT_ELIGIBLE_FOR_APPEAL",
        `Only rejected or suspended roles can be appealed. Current status: ${role.status}`
      )
    );
  }

  return ok({
    ...role,
    status: "pending",
    appealNotes,
    reasons: [...role.reasons, `Appeal submitted: ${appealNotes}`],
    reviewedBy: undefined, // Requires human re-review
    updatedAt: new Date(),
  });
};
