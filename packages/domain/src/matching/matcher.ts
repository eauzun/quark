/**
 * matcher.ts — Sequential offer dispatching, single live lease, and matching state transitions.
 * Spec §5: Platform selects; sequential offers; employer cannot shop for a worker.
 * Spec §15.1 Scenario 2: Two concurrent offer accept calls produce one assignment and one capacity use.
 */

import { Result, ok, err, createError } from "../shared/result.js";
import {
  WorkerCandidate,
  MatchCriteria,
  CandidateRank,
  rankCandidates,
  getOfferExpiryDurationMs,
} from "./scoring.js";
import { Offer, OfferStatus } from "./offer-states.js";

export interface MatchingSession {
  id: string;
  jobId: string;
  milestoneId: string;
  status: "matching" | "waiting_for_talent" | "matched" | "cancelled";
  candidatesQueue: CandidateRank[];
  currentCandidateIndex: number;
  activeOffer?: Offer;
  matchedWorkerId?: string;
  urgency: "urgent" | "default" | "flexible";
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Initializes a new matching session by evaluating and ranking all candidates.
 */
export const initializeMatchingSession = (params: {
  jobId: string;
  milestoneId: string;
  candidates: WorkerCandidate[];
  criteria: MatchCriteria;
  urgency?: "urgent" | "default" | "flexible";
}): MatchingSession => {
  const ranked = rankCandidates(params.candidates, params.criteria);
  const eligibleCandidates = ranked.filter((c) => c.isEligible);

  const status =
    eligibleCandidates.length > 0 ? "matching" : "waiting_for_talent";

  return {
    id: crypto.randomUUID(),
    jobId: params.jobId,
    milestoneId: params.milestoneId,
    status,
    candidatesQueue: eligibleCandidates,
    currentCandidateIndex: 0,
    urgency: params.urgency ?? "default",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
};

/**
 * Dispatches an exclusive offer lease to the next eligible candidate in the queue.
 * Invariant (Spec §5): Exactly one active offer lease per milestone.
 */
export const dispatchNextOffer = (
  session: MatchingSession,
  offerDetails: {
    developerAmount: bigint;
    token: string;
    network: string;
    deadline: Date;
    aiPolicy: "allowed" | "forbidden" | "partial";
  },
  now: Date = new Date()
): Result<{ session: MatchingSession; offer: Offer }> => {
  if (session.status !== "matching") {
    return err(
      createError(
        "INVALID_SESSION_STATUS",
        `Cannot dispatch offer while session is in status ${session.status}`
      )
    );
  }

  // Ensure no conflicting active offer already exists
  if (session.activeOffer && session.activeOffer.status === "pending") {
    return err(
      createError(
        "ACTIVE_OFFER_EXISTS",
        "A pending offer lease is already active. Only one live lease permitted at a time."
      )
    );
  }

  const currentCandidate =
    session.candidatesQueue[session.currentCandidateIndex];
  if (!currentCandidate) {
    return err(
      createError(
        "NO_MORE_CANDIDATES",
        "No further eligible candidates in the queue. Transition to waiting_for_talent."
      )
    );
  }

  const durationMs = getOfferExpiryDurationMs(session.urgency);
  const expiresAt = new Date(now.getTime() + durationMs);

  const offer: Offer = {
    id: crypto.randomUUID(),
    milestoneId: session.milestoneId,
    workerId: currentCandidate.userId,
    developerAmount: offerDetails.developerAmount,
    token: offerDetails.token,
    network: offerDetails.network,
    deadline: offerDetails.deadline,
    aiPolicy: offerDetails.aiPolicy,
    status: "pending",
    offeredAt: now,
    expiresAt,
  };

  const updatedSession: MatchingSession = {
    ...session,
    activeOffer: offer,
    updatedAt: now,
  };

  return ok({ session: updatedSession, offer });
};

/**
 * Handles worker response to an offer.
 * If accepted: session transitions to 'matched'.
 * If declined or expired: advances to the next candidate in the queue.
 */
export const processOfferOutcome = (
  session: MatchingSession,
  offerId: string,
  outcome: "accepted" | "declined" | "expired",
  now: Date = new Date(),
  declineReason?: string
): Result<MatchingSession> => {
  if (!session.activeOffer || session.activeOffer.id !== offerId) {
    return err(
      createError(
        "OFFER_NOT_FOUND",
        "Offer does not match the active offer lease in this matching session"
      )
    );
  }

  if (session.activeOffer.status !== "pending") {
    return err(
      createError(
        "OFFER_ALREADY_RESOLVED",
        `Offer is already in status ${session.activeOffer.status}`
      )
    );
  }

  if (outcome === "accepted") {
    // Spec §15.1 Scenario 2: Double acceptance guard
    if (now > session.activeOffer.expiresAt) {
      return err(
        createError("OFFER_EXPIRED", "Offer has expired and cannot be accepted.")
      );
    }

    const updatedOffer: Offer = {
      ...session.activeOffer,
      status: "accepted",
      respondedAt: now,
    };

    return ok({
      ...session,
      status: "matched",
      activeOffer: updatedOffer,
      matchedWorkerId: updatedOffer.workerId,
      updatedAt: now,
    });
  }

  // Outcome is declined or expired -> advance to next candidate
  const resolvedOffer: Offer = {
    ...session.activeOffer,
    status: outcome as OfferStatus,
    respondedAt: now,
    declineReason,
  };

  const nextIndex = session.currentCandidateIndex + 1;
  const hasMoreCandidates = nextIndex < session.candidatesQueue.length;

  return ok({
    ...session,
    status: hasMoreCandidates ? "matching" : "waiting_for_talent",
    currentCandidateIndex: nextIndex,
    activeOffer: resolvedOffer,
    updatedAt: now,
  });
};
