/**
 * worker/index.ts — Quark background worker service.
 * Spec §14: "Modular monolith plus isolated execution workers."
 * Spec §14.3: "Queue jobs resumable with bounded retries and dead-letter queue."
 *
 * Processes async jobs: reviews, notifications, settlement monitoring,
 * recording cleanup, ledger reconciliation, offer expiry, objection windows.
 */

export * from "./queues/queue.js";
export * from "./handlers/review.js";
export * from "./handlers/settlement.js";
export * from "./handlers/notifications.js";

import { JobQueue, type JobType, type JobHandler } from "./queues/queue.js";
import { handleReviewExecute } from "./handlers/review.js";
import {
  handleSettlementMonitor,
  handleRecordingCleanup,
  handleLedgerReconcile,
  handleOfferExpire,
  handleObjectionWindowCheck,
} from "./handlers/settlement.js";
import {
  handleNotificationDeliver,
  handleTrainingProvenanceCheck,
} from "./handlers/notifications.js";

// ──────────────────────────────────────────────
//  Worker Service
// ──────────────────────────────────────────────

export interface WorkerConfig {
  /** How many jobs to process per batch */
  batchSize: number;
  /** Poll interval in milliseconds */
  pollIntervalMs: number;
  /** Maximum concurrent jobs */
  maxConcurrency: number;
}

export const DEFAULT_WORKER_CONFIG: WorkerConfig = {
  batchSize: 10,
  pollIntervalMs: 5000,
  maxConcurrency: 5,
};

export class WorkerService {
  private queue: JobQueue;
  private config: WorkerConfig;
  private isRunning: boolean = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config?: Partial<WorkerConfig>) {
    this.config = { ...DEFAULT_WORKER_CONFIG, ...config };
    this.queue = new JobQueue();
    this.registerAllHandlers();
  }

  /**
   * Register all built-in job handlers.
   */
  private registerAllHandlers(): void {
    const handlers: Array<[JobType, JobHandler]> = [
      ["review_execute", handleReviewExecute as JobHandler],
      ["notification_deliver", handleNotificationDeliver as JobHandler],
      ["settlement_monitor", handleSettlementMonitor as JobHandler],
      ["recording_cleanup", handleRecordingCleanup as JobHandler],
      ["ledger_reconcile", handleLedgerReconcile as JobHandler],
      ["offer_expire", handleOfferExpire as JobHandler],
      ["objection_window_check", handleObjectionWindowCheck as JobHandler],
      ["training_provenance_check", handleTrainingProvenanceCheck as JobHandler],
    ];

    for (const [type, handler] of handlers) {
      this.queue.registerHandler(type, handler);
    }
  }

  /**
   * Access the underlying queue for enqueueing jobs.
   */
  getQueue(): JobQueue {
    return this.queue;
  }

  /**
   * Start processing jobs in a loop.
   */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    // Resume any interrupted jobs
    const resumed = this.queue.resumeInterruptedJobs();
    if (resumed > 0) {
      console.log(`[Worker] Resumed ${resumed} interrupted jobs`);
    }

    console.log(`[Worker] Started — batchSize=${this.config.batchSize}, pollInterval=${this.config.pollIntervalMs}ms`);

    // In production: this would be a persistent loop with graceful shutdown
    // For test: use processReady() manually
    this.pollTimer = setInterval(async () => {
      if (!this.isRunning) return;
      await this.queue.processReady(this.config.batchSize);
    }, this.config.pollIntervalMs);
  }

  /**
   * Stop processing jobs.
   */
  stop(): void {
    this.isRunning = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    console.log("[Worker] Stopped");
  }

  /**
   * Process a single batch of ready jobs (for tests and one-shot processing).
   */
  async processBatch(limit?: number): Promise<number> {
    return this.queue.processReady(limit ?? this.config.batchSize);
  }

  /**
   * Get worker status and queue statistics.
   */
  getStatus(): {
    isRunning: boolean;
    queueStats: ReturnType<JobQueue["getStats"]>;
    deadLetterCount: number;
  } {
    return {
      isRunning: this.isRunning,
      queueStats: this.queue.getStats(),
      deadLetterCount: this.queue.getDeadLetterQueue().length,
    };
  }
}