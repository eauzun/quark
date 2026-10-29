/**
 * offer-states.ts — Offer lifecycle and transactional lease guards.
 * Spec §5: Single active offer lease per job.
 */

import { Result, ok, err, createError } from "../shared/result.js";

export type OfferStatus =
  | "pending"
  | "accepted"
  | "declined"
  | "expired"
  | "cancelled";

export interface Offer {
  id: string;
  milestoneId: string;
  workerId: string;
  developerAmount: bigint;
  token: string;
  network: string;
  deadline: Date;
  aiPolicy: "allowed" | "forbidden" | "partial";
  status: OfferStatus;
  offeredAt: Date;
  expiresAt: Date;
  respondedAt?: Date;
  declineReason?: string;
}

export const acceptOffer = (
  offer: Offer,
  currentTime: Date = new Date()
): Result<Offer> => {
  if (offer.status !== "pending") {
    return err(
      createError(
        "INVALID_STATE_TRANSITION",
        `Cannot accept offer with status ${offer.status}`
      )
    );
  }

  if (currentTime > offer.expiresAt) {
    return err(
      createError("OFFER_EXPIRED", "Offer has expired and can no longer be accepted")
    );
  }

  return ok({
    ...offer,
    status: "accepted",
    respondedAt: currentTime,
  });
};

export const declineOffer = (
  offer: Offer,
  reason?: string,
  currentTime: Date = new Date()
): Result<Offer> => {
  if (offer.status !== "pending") {
    return err(
      createError(
        "INVALID_STATE_TRANSITION",
        `Cannot decline offer with status ${offer.status}`
      )
    );
  }

  return ok({
    ...offer,
    status: "declined",
    declineReason: reason,
    respondedAt: currentTime,
  });
};

export const expireOffer = (
  offer: Offer,
  currentTime: Date = new Date()
): Result<Offer> => {
  if (offer.status !== "pending") {
    return err(
      createError(
        "INVALID_STATE_TRANSITION",
        `Cannot expire offer with status ${offer.status}`
      )
    );
  }

  return ok({
    ...offer,
    status: "expired",
    respondedAt: currentTime,
  });
};

export const cancelOffer = (offer: Offer): Result<Offer> => {
  if (offer.status !== "pending") {
    return err(
      createError(
        "INVALID_STATE_TRANSITION",
        `Cannot cancel offer with status ${offer.status}`
      )
    );
  }

  return ok({
    ...offer,
    status: "cancelled",
  });
};
