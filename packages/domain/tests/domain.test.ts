import { describe, it, expect } from "vitest";
import {
  calculatePlatformFee,
  calculateTotal,
  solveDeveloperFromTotal,
  parseTokenAmount,
  formatTokenAmount,
  validateAmounts,
} from "../src/shared/money.js";
import {
  markFundingPending,
  markFunded,
  startWork,
  submitWork,
  startReview,
  requestChanges,
  acceptPendingObjection,
  markPayable,
  markPaid,
  Milestone,
} from "../src/jobs/milestone-states.js";
import {
  createFundingJournal,
  createAwardJournal,
  validateJournalBalance,
} from "../src/ledger/journal.js";
import {
  calculateBaseScore,
  rankCandidates,
  WorkerCandidate,
  MatchCriteria,
} from "../src/matching/scoring.js";
import {
  canAccept,
  isInconclusive,
  ReviewRun,
} from "../src/reviews/review-contract.js";

describe("Domain: Money Invariants (Spec §4.1 & §10)", () => {
  it("calculates 20% platform fee on developer compensation", () => {
    // 100 USDC (6 decimals = 100_000_000n)
    const developerAmount = 100_000_000n;
    const fee = calculatePlatformFee(developerAmount);
    expect(fee).toBe(20_000_000n);

    const total = calculateTotal(developerAmount);
    expect(total).toBe(120_000_000n);
  });

  it("solves developer amount from total budget correctly", () => {
    const total = 120_000_000n;
    const developerAmount = solveDeveloperFromTotal(total);
    expect(developerAmount).toBe(100_000_000n);

    const fee = calculatePlatformFee(developerAmount);
    expect(validateAmounts(developerAmount, fee, total).ok).toBe(true);
  });

  it("handles decimal conversion without binary float issues", () => {
    const parsed = parseTokenAmount("100.50", 6);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value).toBe(100_500_000n);
      expect(formatTokenAmount(parsed.value, 6)).toBe("100.5");
    }
  });
});

describe("Domain: Milestone State Machine (Spec §6)", () => {
  const baseMilestone: Milestone = {
    id: "m-1",
    jobId: "j-1",
    orderIndex: 0,
    state: "agreed",
    developerAmount: 100_000_000n,
    platformFee: 20_000_000n,
    totalAmount: 120_000_000n,
    surchargeAmount: 0n,
    token: "USDC",
    network: "base",
    revisionRound: 0,
    maxRevisions: 2,
    totalBlockedDurationMs: 0,
  };

  it("advances through normal successful milestone lifecycle", () => {
    const step1 = markFundingPending(baseMilestone);
    expect(step1.ok).toBe(true);
    if (!step1.ok) return;

    const step2 = markFunded(step1.value);
    expect(step2.ok).toBe(true);
    if (!step2.ok) return;

    const step3 = startWork(step2.value);
    expect(step3.ok).toBe(true);
    if (!step3.ok) return;

    const step4 = submitWork(step3.value, "0xhash123");
    expect(step4.ok).toBe(true);
    if (!step4.ok) return;

    const step5 = startReview(step4.value);
    expect(step5.ok).toBe(true);
    if (!step5.ok) return;

    const step6 = acceptPendingObjection(step5.value, 48);
    expect(step6.ok).toBe(true);
    if (!step6.ok) return;

    // Fast-forward or explicit acceptance
    const step7 = markPayable(step6.value, true);
    expect(step7.ok).toBe(true);
    if (!step7.ok) return;

    const step8 = markPaid(step7.value);
    expect(step8.ok).toBe(true);
    if (!step8.ok) return;
    expect(step8.value.state).toBe("paid");
  });

  it("strictly enforces maximum 2 revision rounds", () => {
    let m: Milestone = { ...baseMilestone, state: "reviewing", revisionRound: 0 };

    // Round 1
    const r1 = requestChanges(m);
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    expect(r1.value.revisionRound).toBe(1);

    // Round 2
    m = { ...r1.value, state: "reviewing" };
    const r2 = requestChanges(m);
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.value.revisionRound).toBe(2);

    // Round 3 -> Must fail with MAX_REVISIONS_EXCEEDED
    m = { ...r2.value, state: "reviewing" };
    const r3 = requestChanges(m);
    expect(r3.ok).toBe(false);
    if (!r3.ok) {
      expect(r3.error.code).toBe("MAX_REVISIONS_EXCEEDED");
    }
  });
});

describe("Domain: Double-Entry Ledger (Spec §9.3 & ADR-003)", () => {
  it("creates strictly balanced funding journal", () => {
    const journal = createFundingJournal({
      milestoneId: "m-1",
      idempotencyKey: "idem-fund-1",
      network: "base",
      token: "USDC",
      amount: 120_000_000n,
    });

    expect(journal.ok).toBe(true);
    if (journal.ok) {
      expect(validateJournalBalance(journal.value).ok).toBe(true);
      expect(journal.value.lines.length).toBe(2);
      expect(journal.value.lines[0].debit).toBe(120_000_000n);
      expect(journal.value.lines[1].credit).toBe(120_000_000n);
    }
  });

  it("creates balanced award journal debiting liability and crediting worker & platform", () => {
    const journal = createAwardJournal({
      milestoneId: "m-1",
      idempotencyKey: "idem-award-1",
      network: "base",
      token: "USDC",
      developerAmount: 100_000_000n,
      platformFee: 20_000_000n,
    });

    expect(journal.ok).toBe(true);
    if (journal.ok) {
      expect(validateJournalBalance(journal.value).ok).toBe(true);
      expect(journal.value.lines[0].debit).toBe(120_000_000n); // liability
      expect(journal.value.lines[1].credit).toBe(100_000_000n); // worker payable
      expect(journal.value.lines[2].credit).toBe(20_000_000n); // platform fee
    }
  });
});

describe("Domain: Matching & Capacity (Spec §5)", () => {
  it("gives neutral prior (0.5) to newcomers instead of zero", () => {
    const newcomer: WorkerCandidate = {
      userId: "u-new",
      isNewcomer: true,
      qualityScore: 0,
      onTimeCompletionRate: 0,
      skillEvidenceScore: 0.8,
      currentActiveJobs: 0,
      maxCapacity: 1,
      consecutiveUnansweredOffers: 0,
      unansweredOffers30d: 0,
      hasPriorityPenalty: false,
    };

    const score = calculateBaseScore(newcomer);
    expect(score).toBeGreaterThan(0.3); // With neutral priors, score is substantial
  });

  it("applies priority penalty (0.8x) for 5 unanswered offers in 30 days", () => {
    const regularWorker: WorkerCandidate = {
      userId: "u-reg",
      isNewcomer: false,
      qualityScore: 0.9,
      onTimeCompletionRate: 0.9,
      skillEvidenceScore: 0.9,
      currentActiveJobs: 0,
      maxCapacity: 1,
      consecutiveUnansweredOffers: 0,
      unansweredOffers30d: 5,
      hasPriorityPenalty: true,
    };

    const criteria: MatchCriteria = {
      requiredSkills: ["typescript"],
      riskTier: "standard",
      isUrgent: false,
      isFlexible: false,
    };

    const ranks = rankCandidates([regularWorker], criteria);
    expect(ranks[0].isEligible).toBe(true);
    expect(ranks[0].finalScore).toBeCloseTo(ranks[0].baseScore * 0.8, 4);
  });

  it("marks worker unavailable on 3 consecutive unanswered offers", () => {
    const unresponsiveWorker: WorkerCandidate = {
      userId: "u-unresponsive",
      isNewcomer: false,
      qualityScore: 0.9,
      onTimeCompletionRate: 0.9,
      skillEvidenceScore: 0.9,
      currentActiveJobs: 0,
      maxCapacity: 1,
      consecutiveUnansweredOffers: 3,
      unansweredOffers30d: 3,
      hasPriorityPenalty: false,
    };

    const criteria: MatchCriteria = {
      requiredSkills: ["typescript"],
      riskTier: "standard",
      isUrgent: false,
      isFlexible: false,
    };

    const ranks = rankCandidates([unresponsiveWorker], criteria);
    expect(ranks[0].isEligible).toBe(false);
    expect(ranks[0].ineligibilityReason).toContain("reconfirmation");
  });
});

describe("Domain: AI Reviewer Contract (Spec §7.2)", () => {
  const baseReview: ReviewRun = {
    reviewId: "r-1",
    jobId: "j-1",
    milestoneId: "m-1",
    submissionHash: "0xabc",
    scopeVersion: "v1",
    policyVersion: "v1",
    modelVersions: { primary: "gemini-flash" },
    riskTier: "standard",
    criteria: [
      {
        id: "c-1",
        mandatory: true,
        result: "pass",
        evidenceRefs: ["test.ts#L10"],
        explanation: "All mandatory criteria passed",
      },
    ],
    findings: [],
    toolRuns: [
      {
        toolName: "vitest",
        mandatory: true,
        passed: true,
        outputSummary: "10/10 passed",
        durationMs: 1200,
      },
    ],
    coverageLimits: [],
    startedAt: new Date(),
    completedAt: new Date(),
  };

  it("accepts review when all mandatory criteria and tools pass without critical findings", () => {
    const check = canAccept(baseReview);
    expect(check.ok).toBe(true);
    if (check.ok) {
      expect(check.value).toBe(true);
    }
  });

  it("rejects acceptance if a mandatory criterion fails", () => {
    const failingReview: ReviewRun = {
      ...baseReview,
      criteria: [
        {
          id: "c-1",
          mandatory: true,
          result: "fail",
          evidenceRefs: [],
          explanation: "Unit tests failed",
        },
      ],
    };
    const check = canAccept(failingReview);
    expect(check.ok).toBe(true);
    if (check.ok) {
      expect(check.value).toBe(false);
    }
  });

  it("marks review inconclusive if any mandatory criterion is unknown", () => {
    const inconclusiveReview: ReviewRun = {
      ...baseReview,
      criteria: [
        {
          id: "c-1",
          mandatory: true,
          result: "unknown",
          evidenceRefs: [],
          explanation: "Could not evaluate due to timeout",
        },
      ],
    };
    expect(isInconclusive(inconclusiveReview)).toBe(true);
    const check = canAccept(inconclusiveReview);
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.error.code).toBe("REVIEW_INCONCLUSIVE");
    }
  });
});
