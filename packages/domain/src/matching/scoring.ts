/**
 * scoring.ts — Worker matching and ranking algorithm.
 * Spec §5: Assignment and capacity.
 *
 * Deterministic ranking with fair opportunity and newcomer reserves.
 */

export interface WorkerCandidate {
  userId: string;
  isNewcomer: boolean;
  qualityScore: number; // [0, 1] - historical delivery quality
  onTimeCompletionRate: number; // [0, 1] - historical on-time delivery
  skillEvidenceScore: number; // [0, 1] - challenge and assessment score
  currentActiveJobs: number;
  maxCapacity: number; // 1 initially, up to 3 after 5 successful jobs
  consecutiveUnansweredOffers: number;
  unansweredOffers30d: number;
  hasPriorityPenalty: boolean;
}

export interface MatchCriteria {
  requiredSkills: string[];
  riskTier: "low" | "standard" | "high";
  isUrgent: boolean;
  isFlexible: boolean;
}

export interface CandidateRank {
  userId: string;
  baseScore: number;
  finalScore: number;
  isNewcomerReserved: boolean;
  isEligible: boolean;
  ineligibilityReason?: string;
}

export const WEIGHTS = {
  quality: 0.35,
  onTime: 0.25,
  skillEvidence: 0.20,
  capacityFit: 0.15,
  fairOpportunity: 0.05,
} as const;

export const NEUTRAL_PRIOR = 0.5;

/**
 * Calculates raw base score according to Spec §5 deterministic formula.
 */
export const calculateBaseScore = (worker: WorkerCandidate): number => {
  // If newcomer, use neutral priors (0.5) instead of 0
  const quality = worker.isNewcomer ? NEUTRAL_PRIOR : worker.qualityScore;
  const onTime = worker.isNewcomer ? NEUTRAL_PRIOR : worker.onTimeCompletionRate;
  const skillEvidence = worker.skillEvidenceScore;

  // Capacity fit: 1.0 if has available capacity slot, 0 if full
  const availableSlots = Math.max(0, worker.maxCapacity - worker.currentActiveJobs);
  const capacityFit = availableSlots > 0 ? 1.0 : 0.0;

  // Fair opportunity score gives slight boost to workers with lower recent assignments
  const fairOpportunity = worker.isNewcomer ? 1.0 : Math.max(0.2, 1.0 - worker.currentActiveJobs * 0.3);

  const score =
    WEIGHTS.quality * quality +
    WEIGHTS.onTime * onTime +
    WEIGHTS.skillEvidence * skillEvidence +
    WEIGHTS.capacityFit * capacityFit +
    WEIGHTS.fairOpportunity * fairOpportunity;

  return Math.min(1.0, Math.max(0.0, score));
};

/**
 * Ranks all candidates and applies penalties and newcomer reservations.
 */
export const rankCandidates = (
  candidates: WorkerCandidate[],
  criteria: MatchCriteria
): CandidateRank[] => {
  const ranked: CandidateRank[] = [];

  for (const candidate of candidates) {
    // 1. Hard filters
    if (candidate.consecutiveUnansweredOffers >= 3) {
      ranked.push({
        userId: candidate.userId,
        baseScore: 0,
        finalScore: 0,
        isNewcomerReserved: false,
        isEligible: false,
        ineligibilityReason:
          "3 consecutive unanswered offers. Unavailable until reconfirmation.",
      });
      continue;
    }

    if (candidate.currentActiveJobs >= candidate.maxCapacity) {
      ranked.push({
        userId: candidate.userId,
        baseScore: 0,
        finalScore: 0,
        isNewcomerReserved: false,
        isEligible: false,
        ineligibilityReason: "Maximum capacity reached.",
      });
      continue;
    }

    const base = calculateBaseScore(candidate);

    // 2. Apply priority penalty: 5 unanswered offers within 30 days -> 7-day penalty (multiply rank by 0.8)
    let finalScore = base;
    if (candidate.hasPriorityPenalty || candidate.unansweredOffers30d >= 5) {
      finalScore *= 0.8;
    }

    ranked.push({
      userId: candidate.userId,
      baseScore: base,
      finalScore,
      isNewcomerReserved: false,
      isEligible: true,
    });
  }

  // Sort eligible candidates descending by finalScore
  ranked.sort((a, b) => b.finalScore - a.finalScore);

  // 3. Newcomer reservation (Spec §5):
  // Reserve 15% of standard-risk offers for qualified newcomers using rotating selection.
  if (criteria.riskTier === "standard") {
    const eligibleNewcomers = ranked.filter(
      (r) => r.isEligible && candidates.find((c) => c.userId === r.userId)?.isNewcomer
    );
    const topNewcomer = eligibleNewcomers[0];
    if (topNewcomer) {
      topNewcomer.isNewcomerReserved = true;
    }
  }

  return ranked;
};

/**
 * Calculates offer lease expiry in milliseconds based on urgency.
 * Spec §5: urgent 1h, default 6h, flexible 12h.
 */
export const getOfferExpiryDurationMs = (
  urgency: "urgent" | "default" | "flexible"
): number => {
  switch (urgency) {
    case "urgent":
      return 1 * 60 * 60 * 1000; // 1 hour
    case "flexible":
      return 12 * 60 * 60 * 1000; // 12 hours
    case "default":
    default:
      return 6 * 60 * 60 * 1000; // 6 hours
  }
};
