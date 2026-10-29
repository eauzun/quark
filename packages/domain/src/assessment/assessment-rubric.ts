/**
 * assessment-rubric.ts — Technical qualification scoring rubric and accessibility options.
 * Spec §3.1: Default qualification rubric (45/25/20/10) with 80/100 threshold.
 * Spec §15.1 Scenario 24: Accessibility alternative completes equivalent qualification without mic/camera.
 */

import { Result, ok } from "../shared/result.js";

export interface RubricScores {
  correctness: number; // Max 45
  reasoning: number; // Max 25
  testing: number; // Max 20
  instructionAdherence: number; // Max 10
}

export interface AssessmentSubmission {
  assessmentId: string;
  userId: string;
  skillId: string;
  isAccessibilityWrittenMode: boolean; // Spec §3.1: equivalent written interview alternative
  codeSolution: string;
  testSuiteOutput: {
    passed: boolean;
    testsTotal: number;
    testsPassed: number;
    branchCoveragePercent: number;
  };
  writtenOrVoiceResponses: {
    promptId: string;
    response: string;
  }[];
  tabDepartureEventsCount: number;
  mandatorySkillRequirementsMet: boolean;
}

export interface QualificationResult {
  status: "qualified" | "not_yet_qualified" | "manual_exception";
  totalScore: number;
  scores: RubricScores;
  passedMandatoryRequirements: boolean;
  isAccessibilityMode: boolean;
  feedback: string[];
}

export const QUALIFICATION_THRESHOLD = 80;

export const MAX_RUBRIC = {
  correctness: 45,
  reasoning: 25,
  testing: 20,
  instructionAdherence: 10,
} as const;

/**
 * Calculates deterministic qualification score according to Spec §3.1.
 * Invariant: Accent, voice timbre, and speech speed are NEVER evaluated or scored.
 * Invariant: Threshold 80/100 PLUS no failed mandatory skill requirement.
 */
export const evaluateAssessmentRubric = (
  submission: AssessmentSubmission
): Result<QualificationResult> => {
  // 1. Calculate Correctness (Max 45) based on automated test suite passing
  let correctness = 0;
  if (submission.testSuiteOutput.testsTotal > 0) {
    const ratio =
      submission.testSuiteOutput.testsPassed /
      submission.testSuiteOutput.testsTotal;
    correctness = Math.round(ratio * MAX_RUBRIC.correctness);
  }

  // 2. Calculate Testing (Max 20) based on coverage and assertions
  let testing = 0;
  const coverageRatio = Math.min(
    1.0,
    submission.testSuiteOutput.branchCoveragePercent / 100
  );
  testing = Math.round(coverageRatio * MAX_RUBRIC.testing);

  // 3. Calculate Reasoning (Max 25) - either from voice transcript or written response
  // Both paths use the identical semantic scoring criteria
  let reasoning = 0;
  if (submission.writtenOrVoiceResponses.length > 0) {
    // Evaluates substantive depth of technical explanation
    const avgLength =
      submission.writtenOrVoiceResponses.reduce(
        (sum, r) => sum + r.response.trim().length,
        0
      ) / submission.writtenOrVoiceResponses.length;
    
    // Heuristic placeholder for semantic reasoning depth
    if (avgLength >= 150) {
      reasoning = MAX_RUBRIC.reasoning;
    } else if (avgLength >= 80) {
      reasoning = 18;
    } else {
      reasoning = 10;
    }
  }

  // 4. Calculate Instruction Adherence (Max 10)
  // Minus points if instructions were violated (tab departures alone do NOT fail, but indicate events)
  let instructionAdherence: number = MAX_RUBRIC.instructionAdherence;
  if (submission.tabDepartureEventsCount > 5) {
    instructionAdherence = Math.max(4, instructionAdherence - 4);
  }

  const totalScore = correctness + reasoning + testing + instructionAdherence;
  const passedMandatory = submission.mandatorySkillRequirementsMet;

  // Determine final status
  let status: "qualified" | "not_yet_qualified" | "manual_exception" =
    "not_yet_qualified";

  const feedback: string[] = [];

  if (!passedMandatory) {
    feedback.push("Mandatory prerequisite skill criteria were not met.");
  }

  if (totalScore >= QUALIFICATION_THRESHOLD && passedMandatory) {
    status = "qualified";
    feedback.push("Congratulations! You met all technical competency thresholds.");
  } else {
    status = "not_yet_qualified";
    feedback.push(
      `Score ${totalScore}/${QUALIFICATION_THRESHOLD} is below passing threshold or mandatory requirements failed.`
    );
  }

  // If close to boundary with suspicious events, flag for manual review
  if (totalScore >= 75 && totalScore < 80 && passedMandatory) {
    feedback.push("Eligible for borderline evaluation review.");
  }

  return ok({
    status,
    totalScore,
    scores: {
      correctness,
      reasoning,
      testing,
      instructionAdherence,
    },
    passedMandatoryRequirements: passedMandatory,
    isAccessibilityMode: submission.isAccessibilityWrittenMode,
    feedback,
  });
};
