import { describe, it, expect } from "vitest";
import {
  createScopeVersion,
  acceptScope,
  canProceedToFunding,
  ScopeContent,
} from "../src/jobs/scope.js";
import {
  calculateBudgetHeatmap,
  CompletedJobRecord,
  BudgetHeatmapRequest,
} from "../src/jobs/budget-heatmap.js";
import {
  initializeMatchingSession,
  dispatchNextOffer,
  processOfferOutcome,
} from "../src/matching/matcher.js";
import { WorkerCandidate, MatchCriteria } from "../src/matching/scoring.js";

describe("M2: Scope Versioning & BLAKE3 Agreement (Spec §4 & §15.1 Scenario 4)", () => {
  const baseContent: ScopeContent = {
    baselineCommit: "0x123",
    supportedEnvironments: ["Node 20", "Base Sepolia"],
    deliverables: ["contracts/Staking.sol", "test/Staking.t.sol"],
    exclusions: ["Frontend UI integration"],
    dependencies: ["OpenZeppelin v5"],
    mandatoryCriteria: [
      {
        id: "crit-1",
        description: "100% branch test coverage",
        evidenceType: "test_report",
        mandatory: true,
      },
    ],
    milestones: [
      {
        orderIndex: 0,
        title: "Contract implementation & tests",
        developerAmount: 100_000_000n,
      },
    ],
    aiPermission: "allowed",
    defectSupportDays: 14,
    token: "USDC",
    network: "base",
  };

  it("creates immutable scope with 64-character BLAKE3 content hash", () => {
    const scope = createScopeVersion({
      jobId: "j-1",
      version: 1,
      content: baseContent,
    });

    expect(scope.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(scope.version).toBe(1);
  });

  it("achieves mutual agreement when employer and worker accept identical hash", () => {
    const scope = createScopeVersion({
      jobId: "j-1",
      version: 1,
      content: baseContent,
    });

    // 1. Employer accepts
    const empAccept = acceptScope({
      scopeVersion: scope,
      actorId: "emp-1",
      actorRole: "employer",
      providedContentHash: scope.contentHash,
    });
    expect(empAccept.ok).toBe(true);
    if (!empAccept.ok) return;
    expect(empAccept.value.isMutuallyAgreed).toBe(false);

    // 2. Worker accepts
    const workerAccept = acceptScope({
      scopeVersion: scope,
      actorId: "work-1",
      actorRole: "worker",
      providedContentHash: scope.contentHash,
      existingEmployerAcceptance: empAccept.value.employerAcceptance,
    });
    expect(workerAccept.ok).toBe(true);
    if (!workerAccept.ok) return;
    expect(workerAccept.value.isMutuallyAgreed).toBe(true);

    // 3. Can proceed to funding
    const canFund = canProceedToFunding(workerAccept.value, scope);
    expect(canFund.ok).toBe(true);
  });

  it("blocks funding if scope was modified after agreement (Spec §15.1 Scenario 4)", () => {
    const scopeV1 = createScopeVersion({
      jobId: "j-1",
      version: 1,
      content: baseContent,
    });

    // Agreement on V1
    const emp = acceptScope({
      scopeVersion: scopeV1,
      actorId: "emp-1",
      actorRole: "employer",
      providedContentHash: scopeV1.contentHash,
    });
    if (!emp.ok) return;

    const agreement = acceptScope({
      scopeVersion: scopeV1,
      actorId: "work-1",
      actorRole: "worker",
      providedContentHash: scopeV1.contentHash,
      existingEmployerAcceptance: emp.value.employerAcceptance,
    });
    if (!agreement.ok) return;

    // Scope edited to V2 (e.g. extra deliverable added)
    const modifiedContent: ScopeContent = {
      ...baseContent,
      deliverables: [...baseContent.deliverables, "extra-audit.pdf"],
    };
    const scopeV2 = createScopeVersion({
      jobId: "j-1",
      version: 2,
      content: modifiedContent,
    });

    // Must block funding on V1 agreement with V2 active
    const fundingCheck = canProceedToFunding(agreement.value, scopeV2);
    expect(fundingCheck.ok).toBe(false);
    if (!fundingCheck.ok) {
      expect(fundingCheck.error.code).toBe("SCOPE_CHANGED");
    }
  });
});

describe("M2: Budget Heatmap & Market Guidance (Spec §4.2 & §15.1 Scenario 20)", () => {
  const sampleRequest: BudgetHeatmapRequest = {
    categoryId: "cat-smart-contracts",
    riskTier: "standard",
    scopeSize: "standard",
    referenceDate: new Date("2026-10-28T12:00:00Z"),
  };

  it("labels estimates honestly and does not invent data when sample < 30", () => {
    // Only 5 completed jobs in database
    const sparseData: CompletedJobRecord[] = Array.from({ length: 5 }, (_, i) => ({
      jobId: `job-${i}`,
      categoryId: "cat-smart-contracts",
      riskTier: "standard",
      scopeSize: "standard",
      developerAmount: 150_000_000n,
      completedAt: new Date("2026-10-01T12:00:00Z"),
      isSelfDealingOrAbnormal: false,
    }));

    const result = calculateBudgetHeatmap(sparseData, sampleRequest);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.isReliableObservedData).toBe(false);
    expect(result.value.sampleCount).toBe(5);
    expect(result.value.label).toBe("Estimated range — limited Quark data");
    expect(result.value.estimatedTimeToMatchHours).toBeUndefined(); // Cannot fabricate match duration
  });

  it("calculates accurate percentiles when sample >= 30", () => {
    // 35 completed jobs with ascending compensation: 100 USDC to 440 USDC
    const denseData: CompletedJobRecord[] = Array.from({ length: 35 }, (_, i) => ({
      jobId: `job-${i}`,
      categoryId: "cat-smart-contracts",
      riskTier: "standard",
      scopeSize: "standard",
      developerAmount: BigInt((100 + i * 10) * 1_000_000), // 100 USDC, 110 USDC, ...
      completedAt: new Date("2026-10-01T12:00:00Z"),
      matchDurationHours: 4,
      isSelfDealingOrAbnormal: false,
    }));

    const result = calculateBudgetHeatmap(denseData, sampleRequest);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.isReliableObservedData).toBe(true);
    expect(result.value.sampleCount).toBe(35);
    expect(result.value.label).toContain("Observed market data");
    expect(result.value.percentiles.medianP50).toBeGreaterThan(150_000_000n);
    expect(result.value.estimatedTimeToMatchHours).toBe(4);
  });
});

describe("M2: Sequential Offer Dispatching & Capacity (Spec §5)", () => {
  const candidate1: WorkerCandidate = {
    userId: "worker-alice",
    isNewcomer: false,
    qualityScore: 0.95,
    onTimeCompletionRate: 0.95,
    skillEvidenceScore: 0.95,
    currentActiveJobs: 0,
    maxCapacity: 1,
    consecutiveUnansweredOffers: 0,
    unansweredOffers30d: 0,
    hasPriorityPenalty: false,
  };

  const candidate2: WorkerCandidate = {
    userId: "worker-bob",
    isNewcomer: false,
    qualityScore: 0.85,
    onTimeCompletionRate: 0.85,
    skillEvidenceScore: 0.85,
    currentActiveJobs: 0,
    maxCapacity: 1,
    consecutiveUnansweredOffers: 0,
    unansweredOffers30d: 0,
    hasPriorityPenalty: false,
  };

  const criteria: MatchCriteria = {
    requiredSkills: ["solidity"],
    riskTier: "standard",
    isUrgent: false,
    isFlexible: false,
  };

  it("dispatches offer lease to top-ranked candidate first", () => {
    const session = initializeMatchingSession({
      jobId: "job-101",
      milestoneId: "mile-101",
      candidates: [candidate2, candidate1], // passed out-of-order
      criteria,
      urgency: "default",
    });

    expect(session.status).toBe("matching");
    // Alice has higher scores, should be at index 0
    expect(session.candidatesQueue[0].userId).toBe("worker-alice");

    const dispatch = dispatchNextOffer(session, {
      developerAmount: 200_000_000n,
      token: "USDC",
      network: "base",
      deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      aiPolicy: "allowed",
    });

    expect(dispatch.ok).toBe(true);
    if (!dispatch.ok) return;
    expect(dispatch.value.offer.workerId).toBe("worker-alice");
    expect(dispatch.value.offer.status).toBe("pending");
  });

  it("advances sequentially to next candidate if first candidate declines", () => {
    const session = initializeMatchingSession({
      jobId: "job-101",
      milestoneId: "mile-101",
      candidates: [candidate1, candidate2],
      criteria,
    });

    const dispatch1 = dispatchNextOffer(session, {
      developerAmount: 200_000_000n,
      token: "USDC",
      network: "base",
      deadline: new Date(),
      aiPolicy: "allowed",
    });
    if (!dispatch1.ok) return;

    // Alice declines
    const outcome = processOfferOutcome(
      dispatch1.value.session,
      dispatch1.value.offer.id,
      "declined",
      new Date(),
      "Too busy with another project"
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.currentCandidateIndex).toBe(1);
    expect(outcome.value.status).toBe("matching");

    // Next offer goes to Bob
    const dispatch2 = dispatchNextOffer(outcome.value, {
      developerAmount: 200_000_000n,
      token: "USDC",
      network: "base",
      deadline: new Date(),
      aiPolicy: "allowed",
    });

    expect(dispatch2.ok).toBe(true);
    if (!dispatch2.ok) return;
    expect(dispatch2.value.offer.workerId).toBe("worker-bob");
  });

  it("transitions to waiting_for_talent when all candidates decline", () => {
    // Only 1 candidate
    const session = initializeMatchingSession({
      jobId: "job-101",
      milestoneId: "mile-101",
      candidates: [candidate1],
      criteria,
    });

    const dispatch = dispatchNextOffer(session, {
      developerAmount: 200_000_000n,
      token: "USDC",
      network: "base",
      deadline: new Date(),
      aiPolicy: "allowed",
    });
    if (!dispatch.ok) return;

    // Sole candidate declines
    const outcome = processOfferOutcome(
      dispatch.value.session,
      dispatch.value.offer.id,
      "declined"
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.status).toBe("waiting_for_talent");
  });
});
