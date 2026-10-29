/**
 * provenance-service.ts — Training data provenance, consent verification, and unlearning tracking.
 * Spec §11: Code rights and model improvement.
 * Spec §15.1 Scenario 17:
 * "Training data without valid rights grant cannot enter dataset; revoked items blocked from future builds."
 */

import { Result, ok, err, createError } from "../shared/result.js";

export interface ConsentGrantRecord {
  id: string;
  actorId: string;
  purpose: "operational_review" | "model_improvement" | "training_data";
  grantedAt: Date;
  revokedAt?: Date;
  isRevoked: boolean;
}

export interface CandidateArtifact {
  id: string;
  contentHash: string; // BLAKE3 hash
  sourceType: "submission" | "assessment";
  sourceId: string;
  isAssessmentAnswerKey: boolean; // Spec §11: Assessment answer keys NEVER enter training data
  containsSecrets: boolean;
  licenseCompatible: boolean;
}

export interface DatasetItemRecord {
  id: string;
  datasetId: string;
  contentHash: string;
  consentGrantId: string;
  rightsVerified: boolean;
  secretsScanned: boolean;
  deletionStatus: "active" | "pending_deletion" | "deleted";
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Validates whether an artifact is eligible to enter the Quark training dataset pipeline.
 * Spec §11 & §15.1 Scenario 17.
 */
export const validateTrainingDataEligibility = (params: {
  artifact: CandidateArtifact;
  consentGrant?: ConsentGrantRecord;
}): Result<boolean> => {
  // 1. Mandatory affirmative consent grant check
  if (!params.consentGrant || params.consentGrant.isRevoked) {
    return err(
      createError(
        "NO_TRAINING_CONSENT",
        "Artifact lacks an active affirmative model improvement consent grant. Cannot enter dataset."
      )
    );
  }

  // 2. Prohibition on assessment answer keys
  if (params.artifact.isAssessmentAnswerKey) {
    return err(
      createError(
        "ANSWER_KEY_PROHIBITED",
        "Assessment answer keys or diagnostic benchmarks can NEVER enter training data."
      )
    );
  }

  // 3. Secrets / Credential filter
  if (params.artifact.containsSecrets) {
    return err(
      createError(
        "SECRETS_DETECTED",
        "Artifact contains detected credentials or sensitive secrets. Excluded from dataset."
      )
    );
  }

  // 4. Open-source license compatibility
  if (!params.artifact.licenseCompatible) {
    return err(
      createError(
        "INCOMPATIBLE_LICENSE",
        "Artifact contains third-party components with incompatible training license terms."
      )
    );
  }

  return ok(true);
};

/**
 * Ingests an eligible artifact into a versioned training dataset.
 */
export const ingestDatasetItem = (params: {
  datasetId: string;
  artifact: CandidateArtifact;
  consentGrant: ConsentGrantRecord;
}): Result<DatasetItemRecord> => {
  const eligibility = validateTrainingDataEligibility({
    artifact: params.artifact,
    consentGrant: params.consentGrant,
  });

  if (!eligibility.ok) return eligibility;

  const item: DatasetItemRecord = {
    id: crypto.randomUUID(),
    datasetId: params.datasetId,
    contentHash: params.artifact.contentHash,
    consentGrantId: params.consentGrant.id,
    rightsVerified: true,
    secretsScanned: true,
    deletionStatus: "active",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  return ok(item);
};

/**
 * Handles revocation of a previously granted consent.
 * Invariant (Spec §15.1 Scenario 17):
 * Revoking consent transitions dataset items to 'pending_deletion' and blocks them from future model releases.
 */
export const revokeConsentGrant = (params: {
  grant: ConsentGrantRecord;
  associatedDatasetItems: DatasetItemRecord[];
  now?: Date;
}): {
  revokedGrant: ConsentGrantRecord;
  updatedDatasetItems: DatasetItemRecord[];
} => {
  const currentTime = params.now ?? new Date();

  const revokedGrant: ConsentGrantRecord = {
    ...params.grant,
    isRevoked: true,
    revokedAt: currentTime,
  };

  const updatedDatasetItems = params.associatedDatasetItems.map((item) => {
    if (item.consentGrantId === params.grant.id) {
      return {
        ...item,
        deletionStatus: "pending_deletion" as const,
        updatedAt: currentTime,
      };
    }
    return item;
  });

  return { revokedGrant, updatedDatasetItems };
};
