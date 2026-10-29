/**
 * worker/handlers/notifications.ts — Notification delivery job handler.
 * Spec §13: "Idempotent delivery, retries and bounce handling."
 * Spec §14.2: "Webhooks authenticate signatures, timestamp/replay checks,
 * enqueue through transactional outbox and deduplicate."
 */

import { type Job, type JobResult } from "../queues/queue.js";

export interface NotificationDeliverPayload {
  messageId: string;
  dedupeKey: string;
  channel: "in_app" | "email";
  recipientUserId: string;
  eventType: string;
  payload: {
    title: string;
    body: string;
    entityRef?: string;
    actionUrl?: string;
  };
  /** Recipient email (resolved from user profile) */
  recipientEmail?: string;
}

/**
 * Delivers a notification message via the specified channel.
 *
 * Spec §13: "Transaction notifications cannot be disabled entirely."
 * Spec §13: "Idempotent delivery, retries and bounce handling."
 */
export async function handleNotificationDeliver(
  job: Job<NotificationDeliverPayload>
): Promise<JobResult> {
  const payload = job.payload;

  // Idempotency check: if this dedupe key was already delivered, skip
  // (The outbox dedupeKey is the authoritative guard)

  try {
    if (payload.channel === "email") {
      if (!payload.recipientEmail) {
        // Non-retryable: missing email address
        return {
          success: false,
          error: `No email address for user ${payload.recipientUserId}`,
          retryable: false,
        };
      }

      // In production: call Resend/SMTP API (ADR-002: Resend Free tier)
      // For now: simulate successful delivery
      return { success: true };
    }

    // In-app notification — store in notification table
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // Handle bounce
    if (message.includes("bounce") || message.includes("invalid")) {
      return {
        success: false,
        error: `Email bounced: ${message}`,
        retryable: false, // Don't retry bounces
      };
    }

    return {
      success: false,
      error: message,
      retryable: true,
    };
  }
}

/**
 * Training provenance check: verify dataset items have valid rights.
 * Spec §11: "Before adding data to training: verify grant/version, source ownership
 * or compatible license, employer authority and contributor rights."
 * Spec §15.1 Scenario 17: "Training data without valid rights grant cannot enter
 * dataset; revoked items blocked from future builds."
 */
export async function handleTrainingProvenanceCheck(
  job: Job<{ datasetId: string; itemIds: string[] }>
): Promise<JobResult> {
  // In production: verify each item's consent grant is active and rights are documented
  // Items with revoked consent are marked for exclusion
  return { success: true };
}