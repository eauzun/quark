import { describe, it, expect } from "vitest";
import {
  evaluateAssessmentRubric,
  AssessmentSubmission,
  QUALIFICATION_THRESHOLD,
} from "../src/assessment/assessment-rubric.js";
import {
  checkRetakeEligibility,
  applyRetakeCooldown,
  resetInterruptedAttempt,
  RETAKE_COOLDOWN_DAYS,
} from "../src/assessment/cooldown.js";
import {
  createSessionRecording,
  extendRetentionForDispute,
  removeDisputeExtension,
  shouldPurgeRecording,
  purgeRecording,
  DEFAULT_RETENTION_DAYS,
} from "../src/assessment/session-media.js";

describe("M4: Assessment Rubric & Accessibility Alternative (Spec §3.1 & §15.1 Scenario 24)", () => {
  it("qualifies candidate via equivalent written accessibility mode without voice/camera", () => {
    // Spec §15.1 Scenario 24: Accessibility alternative completes equivalent qualification without microphone/camera
    const submission: AssessmentSubmission = {
      assessmentId: "asm-access-1",
      userId: "user-deaf-candidate",
      skillId: "skill-typescript",
      isAccessibilityWrittenMode: true,
      codeSolution: "export const solve = () => { /* correct solution */ };",
      testSuiteOutput: {
        passed: true,
        testsTotal: 10,
        testsPassed: 10, // 45/45 correctness
        branchCoveragePercent: 95, // 19/20 testing
      },
      writtenOrVoiceResponses: [
        {
          promptId: "arch-1",
          response:
            "I chose an immutable functional pipeline to avoid side-effects and guarantee deterministic execution across distributed nodes, ensuring the state machine cannot drift.",
        },
      ],
      tabDepartureEventsCount: 0,
      mandatorySkillRequirementsMet: true,
    };

    const evalResult = evaluateAssessmentRubric(submission);
    expect(evalResult.ok).toBe(true);
    if (!evalResult.ok) return;

    expect(evalResult.value.status).toBe("qualified");
    expect(evalResult.value.totalScore).toBeGreaterThanOrEqual(QUALIFICATION_THRESHOLD);
    expect(evalResult.value.isAccessibilityMode).toBe(true);
    expect(evalResult.value.scores.correctness).toBe(45);
    expect(evalResult.value.scores.reasoning).toBe(25);
  });

  it("fails qualification if mandatory skill requirement is not met, even with high score", () => {
    const submission: AssessmentSubmission = {
      assessmentId: "asm-failed-mand",
      userId: "u-dev-1",
      skillId: "skill-solidity",
      isAccessibilityWrittenMode: false,
      codeSolution: "contract Staking {}",
      testSuiteOutput: {
        passed: true,
        testsTotal: 10,
        testsPassed: 10,
        branchCoveragePercent: 90,
      },
      writtenOrVoiceResponses: [
        {
          promptId: "reentrancy",
          response: "Re-entrancy happens when external call triggers execution before state balance updates.",
        },
      ],
      tabDepartureEventsCount: 0,
      mandatorySkillRequirementsMet: false, // FAILED mandatory requirement
    };

    const result = evaluateAssessmentRubric(submission);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.status).toBe("not_yet_qualified");
    expect(result.value.passedMandatoryRequirements).toBe(false);
  });
});

describe("M4: Retake Cooldown & Platform Failure Reset (Spec §3.1 & §15.1 Scenario 18)", () => {
  it("strictly enforces 15 calendar days retake cooldown on failed attempt", () => {
    const completedAt = new Date("2026-10-01T12:00:00Z");
    const attempt = applyRetakeCooldown({
      userId: "u-worker",
      skillId: "skill-rust",
      completedAt,
    });

    // 14 days later -> must be in cooldown
    const day14 = new Date(
      completedAt.getTime() + (RETAKE_COOLDOWN_DAYS - 1) * 24 * 60 * 60 * 1000
    );
    const checkDay14 = checkRetakeEligibility({
      lastAttempt: attempt,
      now: day14,
    });
    expect(checkDay14.ok).toBe(false);
    if (!checkDay14.ok) {
      expect(checkDay14.error.code).toBe("COOLDOWN_ACTIVE");
    }

    // 15 days + 1 hour later -> cooldown expired, can retake
    const day16 = new Date(
      completedAt.getTime() + (RETAKE_COOLDOWN_DAYS + 1) * 24 * 60 * 60 * 1000
    );
    const checkDay16 = checkRetakeEligibility({
      lastAttempt: attempt,
      now: day16,
    });
    expect(checkDay16.ok).toBe(true);
  });

  it("does not consume attempt or apply cooldown on platform failure (Spec §15.1 Scenario 18)", () => {
    // Interrupted by platform crash/network outage
    const resetAttempt = resetInterruptedAttempt({
      userId: "u-worker",
      skillId: "skill-rust",
      failureReason: "Sandbox node timeout caused by platform infrastructure outage",
    });

    expect(resetAttempt.status).toBe("interrupted");
    expect(resetAttempt.interruptedByPlatformFailure).toBe(true);
    expect(resetAttempt.cooldownExpiresAt).toBeUndefined();

    // Worker can immediately restart without 15-day wait
    const check = checkRetakeEligibility({
      lastAttempt: resetAttempt,
      now: new Date(),
    });
    expect(check.ok).toBe(true);
  });
});

describe("M4: Session Recording Retention & Dispute Exception (Spec §3.2 & §15.1 Scenario 16)", () => {
  it("purges media recordings after 30 days unless dispute extension is active", () => {
    const createdAt = new Date("2026-09-01T12:00:00Z");
    const recording = createSessionRecording({
      assessmentId: "asm-screen-1",
      mediaType: "screen",
      storagePath: "s3://quark-recordings/screen-1.mp4",
      now: createdAt,
    });

    expect(recording.isEncrypted).toBe(true);
    expect(recording.neverTrainOnThisMedia).toBe(true); // Invariant

    // 29 days later -> should NOT purge yet
    const day29 = new Date(
      createdAt.getTime() + (DEFAULT_RETENTION_DAYS - 1) * 24 * 60 * 60 * 1000
    );
    expect(shouldPurgeRecording(recording, day29)).toBe(false);

    // 31 days later -> should purge
    const day31 = new Date(
      createdAt.getTime() + (DEFAULT_RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000
    );
    expect(shouldPurgeRecording(recording, day31)).toBe(true);

    // Now declare an active dispute exception
    const disputeExtended = extendRetentionForDispute(
      recording,
      "Worker opened technical dispute regarding assessment compiler flag behavior"
    );
    expect(disputeExtended.ok).toBe(true);
    if (!disputeExtended.ok) return;

    // With dispute active, purge is BLOCKED even after 31 days
    expect(shouldPurgeRecording(disputeExtended.value, day31)).toBe(false);
    const failedPurge = purgeRecording(disputeExtended.value, day31);
    expect(failedPurge.ok).toBe(false);
    if (!failedPurge.ok) {
      expect(failedPurge.error.code).toBe("PURGE_BLOCKED_BY_DISPUTE");
    }

    // Resolve dispute -> remove exception -> now purge succeeds
    const resolvedRecording = removeDisputeExtension(disputeExtended.value);
    expect(shouldPurgeRecording(resolvedRecording, day31)).toBe(true);

    const purged = purgeRecording(resolvedRecording, day31);
    expect(purged.ok).toBe(true);
    if (purged.ok) {
      expect(purged.value.isDeleted).toBe(true);
      expect(purged.value.deletedAt).toBeDefined();
    }
  });
});
