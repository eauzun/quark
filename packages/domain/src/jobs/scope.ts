/**
 * scope.ts — Immutable scope versioning, BLAKE3 content hashing, and mutual acceptance.
 * Spec §4: Task authoring, scope and pricing guidance.
 * Spec §15.1 Scenario 4: Scope changes after agreement block old-scope funding/acceptance.
 */

import { Result, ok, err, createError } from "../shared/result.js";
import { hashScopeContent } from "../shared/crypto.js";

export interface ScopeCriterion {
  id: string;
  description: string;
  evidenceType: string;
  mandatory: boolean;
}

export interface ScopeMilestonePlan {
  orderIndex: number;
  title: string;
  developerAmount: bigint;
  deadline?: Date;
}

export interface ScopeContent {
  baselineCommit?: string;
  supportedEnvironments: string[];
  deliverables: string[];
  exclusions: string[];
  dependencies: string[];
  mandatoryCriteria: ScopeCriterion[];
  milestones: ScopeMilestonePlan[];
  aiPermission: "allowed" | "forbidden" | "partial";
  licensing?: string;
  backgroundIp?: string;
  defectSupportDays: number; // default 14 calendar days (Spec §0.2)
  token: string;
  network: string;
}

export interface ScopeVersion {
  id: string;
  jobId: string;
  version: number;
  content: ScopeContent;
  contentHash: string; // 64-char BLAKE3 hex hash
  policyVersion: number;
  createdAt: Date;
}

export interface ScopeAcceptance {
  id: string;
  scopeVersionId: string;
  scopeContentHash: string;
  actorId: string;
  actorRole: "employer" | "worker";
  acceptedAt: Date;
}

export interface ScopeAgreementState {
  scopeVersion: ScopeVersion;
  employerAcceptance?: ScopeAcceptance;
  workerAcceptance?: ScopeAcceptance;
  isMutuallyAgreed: boolean;
}

/**
 * Creates an immutable scope version with BLAKE3 content hashing.
 */
export const createScopeVersion = (params: {
  jobId: string;
  version: number;
  content: ScopeContent;
  policyVersion?: number;
}): ScopeVersion => {
  // Convert BigInts to string representations for serializable JSON hashing
  const serializableContent = {
    ...params.content,
    milestones: params.content.milestones.map((m) => ({
      ...m,
      developerAmount: m.developerAmount.toString(),
      deadline: m.deadline?.toISOString(),
    })),
  };

  const blake3Hash = hashScopeContent(serializableContent as unknown as Record<string, unknown>);

  return {
    id: crypto.randomUUID(),
    jobId: params.jobId,
    version: params.version,
    content: params.content,
    contentHash: blake3Hash,
    policyVersion: params.policyVersion ?? 1,
    createdAt: new Date(),
  };
};

/**
 * Validates and records an acceptance of a specific scope version.
 * Invariant (Spec §4): Both parties must accept the identical version AND BLAKE3 hash.
 */
export const acceptScope = (params: {
  scopeVersion: ScopeVersion;
  actorId: string;
  actorRole: "employer" | "worker";
  providedContentHash: string;
  existingEmployerAcceptance?: ScopeAcceptance;
  existingWorkerAcceptance?: ScopeAcceptance;
}): Result<ScopeAgreementState> => {
  // 1. Exact BLAKE3 hash match guard
  if (params.providedContentHash !== params.scopeVersion.contentHash) {
    return err(
      createError(
        "SCOPE_HASH_MISMATCH",
        "The scope content hash you accepted does not match the active scope version (scope was modified).",
        {
          expectedHash: params.scopeVersion.contentHash,
          providedHash: params.providedContentHash,
        }
      )
    );
  }

  const acceptance: ScopeAcceptance = {
    id: crypto.randomUUID(),
    scopeVersionId: params.scopeVersion.id,
    scopeContentHash: params.scopeVersion.contentHash,
    actorId: params.actorId,
    actorRole: params.actorRole,
    acceptedAt: new Date(),
  };

  const employerAcceptance =
    params.actorRole === "employer"
      ? acceptance
      : params.existingEmployerAcceptance;

  const workerAcceptance =
    params.actorRole === "worker"
      ? acceptance
      : params.existingWorkerAcceptance;

  const isMutuallyAgreed = Boolean(
    employerAcceptance &&
      workerAcceptance &&
      employerAcceptance.scopeContentHash === workerAcceptance.scopeContentHash
  );

  return ok({
    scopeVersion: params.scopeVersion,
    employerAcceptance,
    workerAcceptance,
    isMutuallyAgreed,
  });
};

/**
 * Guard: Prevents funding if scope was changed after either party accepted.
 * Spec §15.1 Scenario 4.
 */
export const canProceedToFunding = (
  agreement: ScopeAgreementState,
  latestScopeVersion: ScopeVersion
): Result<boolean> => {
  if (!agreement.isMutuallyAgreed) {
    return err(
      createError(
        "SCOPE_NOT_MUTUALLY_AGREED",
        "Both employer and worker must accept the scope before funding can proceed."
      )
    );
  }

  if (agreement.scopeVersion.contentHash !== latestScopeVersion.contentHash) {
    return err(
      createError(
        "SCOPE_CHANGED",
        "Scope was modified after agreement. Both parties must re-accept the new scope before funding.",
        {
          agreedHash: agreement.scopeVersion.contentHash,
          currentHash: latestScopeVersion.contentHash,
        }
      )
    );
  }

  return ok(true);
};
