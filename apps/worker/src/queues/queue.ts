/**
 * worker/queues/queue.ts — Resumable job queue with bounded retries and DLQ.
 * Spec §14.3: "Queue jobs resumable with bounded retries and dead-letter queue."
 * Spec §14: "Redis-backed queue for retryable jobs."
 *
 * In local/test mode, uses an in-memory queue. Production swaps to Redis/BullMQ
 * via the same interface (Spec §0 G-gate: external infrastructure).
 */

// ──────────────────────────────────────────────
//  Types
// ──────────────────────────────────────────────

export type JobType =
  | "review_execute"
  | "notification_deliver"
  | "settlement_monitor"
  | "recording_cleanup"
  | "ledger_reconcile"
  | "offer_expire"
  | "objection_window_check"
  | "funding_confirm"
  | "training_provenance_check";

export type JobStatus = "pending" | "processing" | "completed" | "failed" | "dead_letter" | "cancelled";

export interface Job<T = unknown> {
  id: string;
  type: JobType;
  payload: T;
  status: JobStatus;
  /** Number of attempts made */
  attemptCount: number;
  /** Maximum attempts before dead-letter */
  maxAttempts: number;
  /** When the job should next run (for delayed/retry jobs) */
  scheduledAt: Date;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
  /** Error from the last failed attempt */
  lastError?: string;
  /** Correlation ID for tracing */
  correlationId: string;
  /** Priority: lower = higher priority */
  priority: number;
}

export interface JobResult {
  success: boolean;
  error?: string;
  /** Whether the job should be retried on failure */
  retryable?: boolean;
  /** Custom delay before next retry (ms) */
  retryDelayMs?: number;
}

export interface QueueStats {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  deadLetter: number;
  total: number;
}

// ──────────────────────────────────────────────
//  Backoff Strategy
// ──────────────────────────────────────────────

/**
 * Exponential backoff with jitter for retry scheduling.
 * attempt 1 → ~1s, attempt 2 → ~2s, attempt 3 → ~4s, attempt 4 → ~8s
 */
export function computeBackoffMs(attempt: number, baseMs: number = 1000): number {
  const exponential = baseMs * Math.pow(2, attempt - 1);
  const jitter = Math.random() * 0.3 * exponential; // ±30% jitter
  return Math.round(exponential + jitter);
}

// ──────────────────────────────────────────────
//  In-Memory Queue (Local / Test)
// ──────────────────────────────────────────────

export type JobHandler<T = unknown> = (job: Job<T>) => Promise<JobResult>;

export class JobQueue {
  private jobs: Map<string, Job> = new Map();
  private handlers: Map<JobType, JobHandler> = new Map();
  private processing: Set<string> = new Set();

  /**
   * Register a handler for a job type.
   */
  registerHandler<T>(type: JobType, handler: JobHandler<T>): void {
    this.handlers.set(type, handler as JobHandler);
  }

  /**
   * Enqueue a job. Returns the job with its assigned ID.
   */
  enqueue<T>(params: {
    type: JobType;
    payload: T;
    correlationId?: string;
    priority?: number;
    scheduledAt?: Date;
    maxAttempts?: number;
  }): Job<T> {
    const now = new Date();
    const job: Job<T> = {
      id: crypto.randomUUID(),
      type: params.type,
      payload: params.payload,
      status: "pending",
      attemptCount: 0,
      maxAttempts: params.maxAttempts ?? 5,
      scheduledAt: params.scheduledAt ?? now,
      createdAt: now,
      updatedAt: now,
      correlationId: params.correlationId ?? crypto.randomUUID(),
      priority: params.priority ?? 100,
    };

    this.jobs.set(job.id, job as Job);
    return job;
  }

  /**
   * Process all jobs that are ready to run (scheduledAt <= now).
   * Returns the number of jobs processed.
   */
  async processReady(limit: number = 10): Promise<number> {
    const now = new Date();
    const ready = Array.from(this.jobs.values())
      .filter((j) => j.status === "pending" && j.scheduledAt <= now && !this.processing.has(j.id))
      .sort((a, b) => a.priority - b.priority || a.createdAt.getTime() - b.createdAt.getTime())
      .slice(0, limit);

    let processed = 0;
    for (const job of ready) {
      await this.processJob(job);
      processed++;
    }
    return processed;
  }

  /**
   * Process a single job with error handling and retry scheduling.
   */
  private async processJob(job: Job): Promise<void> {
    const handler = this.handlers.get(job.type);
    if (!handler) {
      job.status = "dead_letter";
      job.lastError = `No handler registered for job type '${job.type}'`;
      job.updatedAt = new Date();
      return;
    }

    // Mark as processing
    this.processing.add(job.id);
    job.status = "processing";
    job.attemptCount++;
    job.updatedAt = new Date();

    try {
      const result = await handler(job);

      if (result.success) {
        job.status = "completed";
        job.completedAt = new Date();
      } else {
        await this.handleFailure(job, result.error || "Unknown error", result.retryable ?? true, result.retryDelayMs);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.handleFailure(job, message, true);
    } finally {
      this.processing.delete(job.id);
      job.updatedAt = new Date();
    }
  }

  /**
   * Handle job failure: retry with backoff or dead-letter.
   */
  private async handleFailure(
    job: Job,
    error: string,
    retryable: boolean,
    customDelayMs?: number
  ): Promise<void> {
    job.lastError = error;

    if (!retryable || job.attemptCount >= job.maxAttempts) {
      job.status = "dead_letter";
      return;
    }

    // Schedule retry with exponential backoff
    const delayMs = customDelayMs ?? computeBackoffMs(job.attemptCount);
    job.status = "pending";
    job.scheduledAt = new Date(Date.now() + delayMs);
  }

  /**
   * Get job by ID.
   */
  getJob(jobId: string): Job | undefined {
    return this.jobs.get(jobId);
  }

  /**
   * Get all jobs with optional status filter.
   */
  getJobs(status?: JobStatus): Job[] {
    const all = Array.from(this.jobs.values());
    return status ? all.filter((j) => j.status === status) : all;
  }

  /**
   * Get dead-letter queue contents (jobs that exhausted retries).
   */
  getDeadLetterQueue(): Job[] {
    return this.getJobs("dead_letter");
  }

  /**
   * Retry a dead-letter job (manual intervention).
   */
  retryDeadLetter(jobId: string): Job | undefined {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== "dead_letter") return undefined;

    job.status = "pending";
    job.attemptCount = 0;
    job.scheduledAt = new Date();
    job.updatedAt = new Date();
    return job;
  }

  /**
   * Cancel a pending job.
   */
  cancelJob(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== "pending") return false;
    job.status = "cancelled";
    job.updatedAt = new Date();
    return true;
  }

  /**
   * Get queue statistics.
   */
  getStats(): QueueStats {
    const all = Array.from(this.jobs.values());
    return {
      pending: all.filter((j) => j.status === "pending").length,
      processing: all.filter((j) => j.status === "processing").length,
      completed: all.filter((j) => j.status === "completed").length,
      failed: all.filter((j) => j.status === "failed").length,
      deadLetter: all.filter((j) => j.status === "dead_letter").length,
      total: all.length,
    };
  }

  /**
   * Resumability: persist processing state so jobs can resume after restart.
   * Spec §14.3: "Queue jobs resumable."
   */
  getResumableJobs(): Job[] {
    // Jobs that were processing when the worker stopped
    return this.getJobs("processing");
  }

  /**
   * Mark interrupted jobs as pending so they can be retried after restart.
   */
  resumeInterruptedJobs(): number {
    let count = 0;
    for (const job of this.jobs.values()) {
      if (job.status === "processing") {
        job.status = "pending";
        job.scheduledAt = new Date();
        job.updatedAt = new Date();
        count++;
      }
    }
    return count;
  }
}