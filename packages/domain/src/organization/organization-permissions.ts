/**
 * organization-permissions.ts — Organization roles, capability gates, and conflict detection.
 * Spec §2: Roles, approvals and organization permissions.
 *
 * Invariant: Never remove the last owner of an organization.
 * Invariant: Members cannot spend or change payout destinations by default.
 * Invariant: Never assign a person their own job, an organization job they belong to,
 *            or a review they or a known related party worked on.
 */

import { Result, ok, err, createError } from "../shared/result.js";

export type OrgRole = "owner" | "member";

export type OrgCapability =
  | "spend_funds"
  | "approve_scope"
  | "cancel_job"
  | "manage_members"
  | "view_assigned_jobs"
  | "communicate";

export interface Organization {
  id: string;
  name: string;
  ownerId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrganizationMembership {
  id: string;
  organizationId: string;
  userId: string;
  role: OrgRole;
  capabilities: OrgCapability[];
  createdAt: Date;
}

export const OWNER_DEFAULT_CAPABILITIES: OrgCapability[] = [
  "spend_funds",
  "approve_scope",
  "cancel_job",
  "manage_members",
  "view_assigned_jobs",
  "communicate",
];

export const MEMBER_DEFAULT_CAPABILITIES: OrgCapability[] = [
  "view_assigned_jobs",
  "communicate",
];

/**
 * Checks if a member has a specific capability.
 */
export const hasCapability = (
  membership: OrganizationMembership,
  capability: OrgCapability
): boolean => {
  if (membership.role === "owner") return true;
  return membership.capabilities.includes(capability);
};

/**
 * Validates ownership transfer.
 * Guard: Requires valid target member and target must not already be the owner.
 */
export const transferOwnership = (
  org: Organization,
  currentMemberships: OrganizationMembership[],
  newOwnerUserId: string
): Result<{ org: Organization; updatedMemberships: OrganizationMembership[] }> => {
  if (org.ownerId === newOwnerUserId) {
    return err(
      createError("ALREADY_OWNER", "Target user is already the owner of this organization")
    );
  }

  const targetMembership = currentMemberships.find(
    (m) => m.userId === newOwnerUserId
  );
  if (!targetMembership) {
    return err(
      createError(
        "NOT_A_MEMBER",
        "Target user must be an accepted member before ownership can be transferred"
      )
    );
  }

  const updatedMemberships = currentMemberships.map((m) => {
    if (m.userId === newOwnerUserId) {
      return {
        ...m,
        role: "owner" as OrgRole,
        capabilities: OWNER_DEFAULT_CAPABILITIES,
      };
    }
    if (m.userId === org.ownerId) {
      return {
        ...m,
        role: "member" as OrgRole,
        capabilities: MEMBER_DEFAULT_CAPABILITIES,
      };
    }
    return m;
  });

  return ok({
    org: {
      ...org,
      ownerId: newOwnerUserId,
      updatedAt: new Date(),
    },
    updatedMemberships,
  });
};

/**
 * Guard against removing the last owner.
 */
export const removeMember = (
  org: Organization,
  membership: OrganizationMembership
): Result<void> => {
  if (membership.role === "owner" && membership.userId === org.ownerId) {
    return err(
      createError(
        "LAST_OWNER_REMOVAL_FORBIDDEN",
        "Cannot remove the owner of an organization. Transfer ownership first."
      )
    );
  }

  return ok(undefined);
};

/**
 * Strict conflict of interest detector (Spec §2 & §5):
 * 1. Worker cannot be the employer.
 * 2. Worker cannot be a member of the employer organization.
 * 3. Reviewer cannot be the assigned worker or employer.
 */
export const detectConflictOfInterest = (params: {
  candidateUserId: string;
  employerUserId: string;
  employerOrgMemberIds?: string[];
  assignedWorkerUserId?: string;
  role: "worker_candidate" | "reviewer_candidate";
}): Result<void> => {
  // Self-dealing rule
  if (params.candidateUserId === params.employerUserId) {
    return err(
      createError(
        "CONFLICT_DETECTED",
        "A user cannot accept or review their own job (self-dealing prohibited)."
      )
    );
  }

  // Employer organization member conflict
  if (
    params.employerOrgMemberIds &&
    params.employerOrgMemberIds.includes(params.candidateUserId)
  ) {
    return err(
      createError(
        "CONFLICT_DETECTED",
        "A member of the employer organization cannot accept this job as a worker."
      )
    );
  }

  // Reviewer conflict
  if (params.role === "reviewer_candidate") {
    if (params.candidateUserId === params.assignedWorkerUserId) {
      return err(
        createError(
          "CONFLICT_DETECTED",
          "The assigned worker cannot act as reviewer on their own delivery."
        )
      );
    }
  }

  return ok(undefined);
};
