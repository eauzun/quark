/**
 * session-media.ts — Session recording retention, privacy, and dispute extension rules.
 * Spec §3.2 & §15.1 Scenario 16:
 * "Recording expiry deletes media; open dispute retention exception recorded and later removed."
 * Invariant: Session recordings are NEVER training data.
 */

import { Result, ok, err, createError } from "../shared/result.js";

export const DEFAULT_RETENTION_DAYS = 30;

export interface SessionRecording {
  id: string;
  assessmentId: string;
  mediaType: "screen" | "audio" | "video";
  storagePath: string;
  isEncrypted: boolean;
  retentionExpiresAt: Date;
  disputeExtensionActive: boolean;
  disputeReason?: string;
  isDeleted: boolean;
  deletedAt?: Date;
  neverTrainOnThisMedia: true; // Invariant
}

export const createSessionRecording = (params: {
  assessmentId: string;
  mediaType: "screen" | "audio" | "video";
  storagePath: string;
  now?: Date;
}): SessionRecording => {
  const currentTime = params.now ?? new Date();
  const retentionExpiresAt = new Date(
    currentTime.getTime() + DEFAULT_RETENTION_DAYS * 24 * 60 * 60 * 1000
  );

  return {
    id: crypto.randomUUID(),
    assessmentId: params.assessmentId,
    mediaType: params.mediaType,
    storagePath: params.storagePath,
    isEncrypted: true,
    retentionExpiresAt,
    disputeExtensionActive: false,
    isDeleted: false,
    neverTrainOnThisMedia: true,
  };
};

/**
 * Extends retention specifically for an active dispute with declared reason.
 */
export const extendRetentionForDispute = (
  recording: SessionRecording,
  reason: string
): Result<SessionRecording> => {
  if (recording.isDeleted) {
    return err(
      createError(
        "RECORDING_ALREADY_DELETED",
        "Cannot extend retention on a recording that has already been purged."
      )
    );
  }

  return ok({
    ...recording,
    disputeExtensionActive: true,
    disputeReason: reason,
  });
};

/**
 * Removes dispute exception once dispute is resolved.
 */
export const removeDisputeExtension = (
  recording: SessionRecording
): SessionRecording => {
  return {
    ...recording,
    disputeExtensionActive: false,
    disputeReason: undefined,
  };
};

/**
 * Purge policy evaluator:
 * Deletes recording if 30 days expired AND no dispute extension is active.
 */
export const shouldPurgeRecording = (
  recording: SessionRecording,
  currentTime: Date = new Date()
): boolean => {
  if (recording.isDeleted) return false;
  if (recording.disputeExtensionActive) return false;
  return currentTime >= recording.retentionExpiresAt;
};

/**
 * Marks recording as purged.
 */
export const purgeRecording = (
  recording: SessionRecording,
  now: Date = new Date()
): Result<SessionRecording> => {
  if (recording.disputeExtensionActive) {
    return err(
      createError(
        "PURGE_BLOCKED_BY_DISPUTE",
        "Cannot purge recording while active dispute retention exception is active."
      )
    );
  }

  return ok({
    ...recording,
    isDeleted: true,
    deletedAt: now,
  });
};
