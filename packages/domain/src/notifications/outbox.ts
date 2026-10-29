/**
 * notifications/outbox.ts — Transactional notification outbox with idempotent delivery.
 * Spec §13: "In-app + email for offer, funding, assignment, blocker, delivery,
 * revisions, acceptance, objections, payout, security and recording notices.
 * Transactional notifications cannot be disabled entirely; marketing opt-in
 * separate. Idempotent delivery, retries and bounce handling."
 * Spec §14.2: "Internal events: OfferExpired, ScopeAccepted, FundingFinalized,
 * SubmissionFrozen, ReviewCompleted, ObjectionOpened, AwardAuthorized,
 * TransferConfirmed, ConsentRevoked. Events contain references, not secrets."
 * Spec §14.1: "notifications / outbox — channel, dedupe key, retry state."
 */

import { Result, ok, err, createError } from "../shared/result.js";

// ──────────────────────────────────────────────
//  Types
// ──────────────────────────────────────────────

export type NotificationChannel = "in_app" | "email";
export type NotificationPriority = "transactional" | "marketing";

export type NotificationEventType =
  | "OfferExpired"
  | "ScopeAccepted"
  | "FundingFinalized"
  | "SubmissionFrozen"
  | "ReviewCompleted"
  | "ObjectionOpened"
  | "AwardAuthorized"
  | "TransferConfirmed"
  | "ConsentRevoked"
  | "AssignmentCreated"
  | "BlockerDeclared"
  | "RevisionRequested"
  | "PaymentSent"
  | "SecurityAlert"
  | "RecordingNotice";

export interface OutboxMessage {
  id: string;
  /** Deduplication key — prevents duplicate sends */
  dedupeKey: string;
  eventType: NotificationEventType;
  channel: NotificationChannel;
  priority: NotificationPriority;
  /** Recipient user ID (reference, not PII) */
  recipientUserId: string;
  /** Message body — contains references, NOT secrets */
  payload: {
    title: string;
    body: string;
    /** Reference to the related entity (job, milestone, etc.) */
    entityRef?: string;
    /** Action URL for the recipient */
    actionUrl?: string;
  };
  /** Delivery state */
  status: "pending" | "sent" | "failed" | "bounced" | "suppressed";
  /** Retry count */
  retryCount: number;
  /** Maximum retries before marking as failed */
  maxRetries: number;
  createdAt: Date;
  sentAt?: Date;
  lastRetryAt?: Date;
  /** Error message if failed */
  error?: string;
}

export interface NotificationPreferences {
  userId: string;
  /** Transactional notifications CANNOT be disabled (Spec §13) */
  transactionalEnabled: true;
  /** Marketing notifications are opt-in */
  marketingEnabled: boolean;
  /** Email notifications */
  emailEnabled: boolean;
}

// ──────────────────────────────────────────────
//  Notification Outbox
// ──────────────────────────────────────────────

export class NotificationOutbox {
  private messages: Map<string, OutboxMessage> = new Map();
  private dedupeIndex: Map<string, string> = new Map(); // dedupeKey -> messageId
  private preferences: Map<string, NotificationPreferences> = new Map();

  /**
   * Enqueue a notification message.
   * Idempotent: same dedupeKey produces the same message.
   */
  enqueue(params: {
    dedupeKey: string;
    eventType: NotificationEventType;
    channel: NotificationChannel;
    recipientUserId: string;
    payload: OutboxMessage["payload"];
    priority?: NotificationPriority;
  }): Result<OutboxMessage> {
    // Idempotency check
    const existingId = this.dedupeIndex.get(params.dedupeKey);
    if (existingId) {
      const existing = this.messages.get(existingId);
      if (existing) {
        return ok({ ...existing });
      }
    }

    // Check notification preferences
    const prefs = this.preferences.get(params.recipientUserId);
    const priority = params.priority || "transactional";

    // Transactional notifications cannot be suppressed (Spec §13)
    let status: OutboxMessage["status"] = "pending";
    if (priority === "marketing" && prefs && !prefs.marketingEnabled) {
      status = "suppressed";
    }
    if (params.channel === "email" && prefs && !prefs.emailEnabled && priority !== "transactional") {
      status = "suppressed";
    }

    const message: OutboxMessage = {
      id: crypto.randomUUID(),
      dedupeKey: params.dedupeKey,
      eventType: params.eventType,
      channel: params.channel,
      priority,
      recipientUserId: params.recipientUserId,
      payload: params.payload,
      status,
      retryCount: 0,
      maxRetries: 3,
      createdAt: new Date(),
    };

    this.messages.set(message.id, message);
    this.dedupeIndex.set(params.dedupeKey, message.id);
    return ok({ ...message });
  }

  /**
   * Mark a message as sent (called by delivery adapter).
   */
  markSent(messageId: string): Result<OutboxMessage> {
    const message = this.messages.get(messageId);
    if (!message) {
      return err(createError("NOT_FOUND", `Message '${messageId}' not found`));
    }
    message.status = "sent";
    message.sentAt = new Date();
    return ok({ ...message });
  }

  /**
   * Mark a message as failed and schedule retry.
   * Spec §13: "Idempotent delivery, retries and bounce handling."
   */
  markFailed(messageId: string, error: string): Result<OutboxMessage> {
    const message = this.messages.get(messageId);
    if (!message) {
      return err(createError("NOT_FOUND", `Message '${messageId}' not found`));
    }
    message.retryCount++;
    message.lastRetryAt = new Date();
    message.error = error;

    if (message.retryCount >= message.maxRetries) {
      message.status = "failed";
    }

    return ok({ ...message });
  }

  /**
   * Get pending messages for delivery.
   */
  getPending(limit: number = 50): OutboxMessage[] {
    return Array.from(this.messages.values())
      .filter((m) => m.status === "pending")
      .slice(0, limit)
      .map((m) => ({ ...m }));
  }

  /**
   * Set notification preferences for a user.
   */
  setPreferences(prefs: NotificationPreferences): void {
    this.preferences.set(prefs.userId, { ...prefs, transactionalEnabled: true });
  }

  /**
   * Get messages for a specific user.
   */
  getMessagesForUser(userId: string, limit: number = 50): OutboxMessage[] {
    return Array.from(this.messages.values())
      .filter((m) => m.recipientUserId === userId)
      .slice(0, limit)
      .map((m) => ({ ...m }));
  }

  /**
   * Get outbox statistics.
   */
  getStats(): {
    total: number;
    pending: number;
    sent: number;
    failed: number;
    suppressed: number;
    bounced: number;
  } {
    const all = Array.from(this.messages.values());
    return {
      total: all.length,
      pending: all.filter((m) => m.status === "pending").length,
      sent: all.filter((m) => m.status === "sent").length,
      failed: all.filter((m) => m.status === "failed").length,
      suppressed: all.filter((m) => m.status === "suppressed").length,
      bounced: all.filter((m) => m.status === "bounced").length,
    };
  }
}