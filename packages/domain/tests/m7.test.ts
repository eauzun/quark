import { describe, it, expect } from "vitest";
import {
  openDisputeRecord,
  assignHumanReviewer,
  resolveDisputeVerdict,
  HumanReviewerCandidate,
} from "../src/disputes/dispute-service.js";
import {
  validateTrainingDataEligibility,
  ingestDatasetItem,
  revokeConsentGrant,
  ConsentGrantRecord,
  CandidateArtifact,
} from "../src/training/provenance-service.js";

describe("M7: Dispute Resolution & Human Reviewer Invariants (Spec §8 & §15.1 Scenario 12)", () => {
  const baseDispute = openDisputeRecord({
    milestoneId: "mile-dispute-1",
    jobId: "job-1",
    employerUserId: "user-employer-alice",
    workerUserId: "user-worker-bob",
    employerOrgMemberIds: ["user-employer-alice", "user-org-carol"],
    disputedAmount: 120_000_000n, // 120 USDC
    reason: "Worker submitted contract lacking specified re-entrancy guard.",
    evidence: { log: "Foundry test re-entered vault successfully" },
  });

  it("strictly prevents reviewer assignment if conflict of interest exists (Spec §15.1 Scenario 12)", () => {
    // 1. Reviewer is the assigned worker
    const workerAsReviewer: HumanReviewerCandidate = {
      userId: "user-worker-bob",
      isQualified: true,
      activeDisputeCount: 0,
      fixedHourlyRateUsdc: 50_000_000n,
    };

    const conflict1 = assignHumanReviewer({
      dispute: baseDispute,
      reviewer: workerAsReviewer,
    });
    expect(conflict1.ok).toBe(false);
    if (!conflict1.ok) {
      expect(conflict1.error.code).toBe("CONFLICT_DETECTED");
    }

    // 2. Reviewer is an employer org member
    const orgMemberAsReviewer: HumanReviewerCandidate = {
      userId: "user-org-carol",
      isQualified: true,
      activeDisputeCount: 0,
      fixedHourlyRateUsdc: 50_000_000n,
    };

    const conflict2 = assignHumanReviewer({
      dispute: baseDispute,
      reviewer: orgMemberAsReviewer,
    });
    expect(conflict2.ok).toBe(false);
    if (!conflict2.ok) {
      expect(conflict2.error.code).toBe("CONFLICT_DETECTED");
    }
  });

  it("guarantees human reviewer fixed compensation independent of verdict outcome", () => {
    const independentReviewer: HumanReviewerCandidate = {
      userId: "user-reviewer-david",
      isQualified: true,
      activeDisputeCount: 0,
      fixedHourlyRateUsdc: 60_000_000n, // $60 fixed compensation
    };

    const assigned = assignHumanReviewer({
      dispute: baseDispute,
      reviewer: independentReviewer,
    });
    expect(assigned.ok).toBe(true);
    if (!assigned.ok) return;

    expect(assigned.value.status).toBe("under_human_review");
    expect(assigned.value.assignedReviewerId).toBe("user-reviewer-david");
    expect(assigned.value.reviewerCompensationFixed).toBe(60_000_000n);

    // Resolve with verdict (e.g. partial split: 80 to worker, 40 refund to employer)
    const resolved = resolveDisputeVerdict({
      dispute: assigned.value,
      verdict: "partial",
      awardToWorker: 80_000_000n,
      refundToEmployer: 40_000_000n,
      reasoning: "Separable tests completed satisfactorily, but secondary integration failed.",
    });

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.value.status).toBe("resolved");
    expect(resolved.value.isReviewerPaid).toBe(true); // Reviewer paid regardless of who won!
    expect(resolved.value.awardToWorker).toBe(80_000_000n);
    expect(resolved.value.refundToEmployer).toBe(40_000_000n);
  });
});

describe("M7: Training Provenance & Consent Revocation (Spec §11 & §15.1 Scenario 17)", () => {
  const activeGrant: ConsentGrantRecord = {
    id: "grant-user-1",
    actorId: "user-employer-alice",
    purpose: "model_improvement",
    grantedAt: new Date(),
    isRevoked: false,
  };

  const cleanArtifact: CandidateArtifact = {
    id: "art-1",
    contentHash: "0xblake3_clean_code_hash",
    sourceType: "submission",
    sourceId: "sub-1",
    isAssessmentAnswerKey: false,
    containsSecrets: false,
    licenseCompatible: true,
  };

  it("blocks training data ingestion if affirmative consent is absent or revoked", () => {
    // 1. No consent provided
    const noConsent = validateTrainingDataEligibility({
      artifact: cleanArtifact,
      consentGrant: undefined,
    });
    expect(noConsent.ok).toBe(false);
    if (!noConsent.ok) {
      expect(noConsent.error.code).toBe("NO_TRAINING_CONSENT");
    }

    // 2. Revoked consent
    const revokedGrant: ConsentGrantRecord = {
      ...activeGrant,
      isRevoked: true,
    };
    const revokedCheck = validateTrainingDataEligibility({
      artifact: cleanArtifact,
      consentGrant: revokedGrant,
    });
    expect(revokedCheck.ok).toBe(false);
    if (!revokedCheck.ok) {
      expect(revokedCheck.error.code).toBe("NO_TRAINING_CONSENT");
    }
  });

  it("prohibits assessment answer keys and secrets from entering training datasets", () => {
    // Answer key prohibition (Spec §11)
    const answerKeyArtifact: CandidateArtifact = {
      ...cleanArtifact,
      isAssessmentAnswerKey: true,
    };
    const check1 = validateTrainingDataEligibility({
      artifact: answerKeyArtifact,
      consentGrant: activeGrant,
    });
    expect(check1.ok).toBe(false);
    if (!check1.ok) {
      expect(check1.error.code).toBe("ANSWER_KEY_PROHIBITED");
    }

    // Secrets detected prohibition
    const secretArtifact: CandidateArtifact = {
      ...cleanArtifact,
      containsSecrets: true,
    };
    const check2 = validateTrainingDataEligibility({
      artifact: secretArtifact,
      consentGrant: activeGrant,
    });
    expect(check2.ok).toBe(false);
    if (!check2.ok) {
      expect(check2.error.code).toBe("SECRETS_DETECTED");
    }
  });

  it("marks dataset items as pending_deletion when consent is revoked (Spec §15.1 Scenario 17)", () => {
    const ingested = ingestDatasetItem({
      datasetId: "quark-v1-code-dataset",
      artifact: cleanArtifact,
      consentGrant: activeGrant,
    });
    expect(ingested.ok).toBe(true);
    if (!ingested.ok) return;
    expect(ingested.value.deletionStatus).toBe("active");

    // Employer revokes consent later
    const { revokedGrant, updatedDatasetItems } = revokeConsentGrant({
      grant: activeGrant,
      associatedDatasetItems: [ingested.value],
    });

    expect(revokedGrant.isRevoked).toBe(true);
    expect(updatedDatasetItems[0].deletionStatus).toBe("pending_deletion");
  });
});
