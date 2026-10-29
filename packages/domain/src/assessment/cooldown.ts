/**
 * cooldown.ts — Assessment retake cooldown and platform failure resets.
 * Spec §3.1 & §15.1 Scenario 18:
 * "Retake cooldown exactly 15 days; system failure does not consume attempt."
 */

import { Result, ok, err, createError } from "../shared/result.js";

export const RETAKE_COOLDOWN_DAYS = 15;
export const RETAKE_COOLDOWN_MS =
  RETAKE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;

export interface SkillAttempt {
  userId: string;
  skillId: string;
  attemptedAt: Date;
  status: "qualified" | "not_yet_qualified" | "interrupted";
  cooldownExpiresAt?: Date;
  interruptedByPlatformFailure: boolean;
}

/**
 * Checks whether a worker is eligible to take or retake an assessment.
 */
export const checkRetakeEligibility = (params: {
  lastAttempt?: SkillAttempt;
  now?: Date;
}): Result<{ canTake: boolean; remainingDays?: number }> => {
  const currentTime = params.now ?? new Date();

  if (!params.lastAttempt) {
    return ok({ canTake: true });
  }

  // Invariant (Spec §15.1 Scenario 18): Confirmed platform failure does NOT consume attempt or apply cooldown
  if (params.lastAttempt.interruptedByPlatformFailure) {
    return ok({ canTake: true });
  }

  // Already qualified -> no need to retake
  if (params.lastAttempt.status === "qualified") {
    return ok({ canTake: true });
  }

  // Calculate cooldown from authoritative timestamp
  if (params.lastAttempt.cooldownExpiresAt) {
    if (currentTime < params.lastAttempt.cooldownExpiresAt) {
      const remainingMs =
        params.lastAttempt.cooldownExpiresAt.getTime() - currentTime.getTime();
      const remainingDays = Math.ceil(remainingMs / (24 * 60 * 60 * 1000));

      return err(
        createError(
          "COOLDOWN_ACTIVE",
          `Skill assessment is in 15-day retake cooldown. Next attempt available in ${remainingDays} days.`,
          {
            cooldownExpiresAt: params.lastAttempt.cooldownExpiresAt.toISOString(),
            remainingDays,
          }
        )
      );
    }
  }

  return ok({ canTake: true });
};

/**
 * Applies a 15-day cooldown following a failed attempt.
 */
export const applyRetakeCooldown = (params: {
  userId: string;
  skillId: string;
  completedAt?: Date;
}): SkillAttempt => {
  const attemptedAt = params.completedAt ?? new Date();
  const cooldownExpiresAt = new Date(
    attemptedAt.getTime() + RETAKE_COOLDOWN_MS
  );

  return {
    userId: params.userId,
    skillId: params.skillId,
    attemptedAt,
    status: "not_yet_qualified",
    cooldownExpiresAt,
    interruptedByPlatformFailure: false,
  };
};

/**
 * Resets an attempt caused by confirmed platform failure without consuming cooldown.
 */
export const resetInterruptedAttempt = (params: {
  userId: string;
  skillId: string;
  failureReason: string;
}): SkillAttempt => {
  return {
    userId: params.userId,
    skillId: params.skillId,
    attemptedAt: new Date(),
    status: "interrupted",
    cooldownExpiresAt: undefined, // No cooldown!
    interruptedByPlatformFailure: true,
  };
};
