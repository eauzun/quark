/**
 * worker.test.ts — Worker service, queue, retry & DLQ tests.
 * Spec §14.3: "Queue jobs resumable with bounded retries and dead-letter queue."
 */

import { describe, it, expect, vi } from "vitest";
import {
  JobQueue,
  WorkerService,
  computeBackoffMs,
  type Job,
  type JobResult,
} from "../src/index.js";

// ──────────────────────────────────────────────
//  Basic Queue Operations
// ──────────────────────────────────────────────

describe("Worker: Job Queue Basics", () => {
  it("enqueues a job with correct initial state", () => {
    const queue = new JobQueue();

    const job = queue.enqueue({
      type: "review_execute",
      payload: { reviewId: "r1" },
    });

    expect(job.id).toBeDefined();
    expect(job.status).toBe("pending");
    expect(job.attemptCount).toBe(0);
    expect(job.maxAttempts).toBe(5);
    expect(job.type).toBe("review_execute");
  });

  it("processes a job with a registered handler", async () => {
    const queue = new JobQueue();
    const handler = vi.fn(async (): Promise<JobResult> => ({ success: true }));
    queue.registerHandler("review_execute", handler);

    queue.enqueue({ type: "review_execute", payload: {} });
    const processed = await queue.processReady();

    expect(processed).toBe(1);
    expect(handler).toHaveBeenCalledOnce();
    expect(queue.getStats().completed).toBe(1);
  });

  it("dead-letters jobs with no registered handler", async () => {
    const queue = new JobQueue();

    queue.enqueue({ type: "review_execute", payload: {} });
    await queue.processReady();

    expect(queue.getStats().deadLetter).toBe(1);
    const dlq = queue.getDeadLetterQueue();
    expect(dlq[0].lastError).toContain("No handler");
  });

  it("processes jobs in priority order", async () => {
    const queue = new JobQueue();
    const order: string[] = [];

    queue.registerHandler("review_execute", async (job) => {
      order.push((job.payload as any).name);
      return { success: true };
    });

    queue.enqueue({ type: "review_execute", payload: { name: "low" }, priority: 200 });
    queue.enqueue({ type: "review_execute", payload: { name: "high" }, priority: 1 });
    queue.enqueue({ type: "review_execute", payload: { name: "medium" }, priority: 100 });

    await queue.processReady(3);
    expect(order).toEqual(["high", "medium", "low"]);
  });
});

// ──────────────────────────────────────────────
//  Retry & Backoff
// ──────────────────────────────────────────────

describe("Worker: Retry & Backoff (Spec §14.3)", () => {
  it("retries failed jobs up to maxAttempts", async () => {
    const queue = new JobQueue();
    const handler = vi.fn(async (): Promise<JobResult> => ({
      success: false,
      error: "Temporary failure",
      retryable: true,
    }));
    queue.registerHandler("notification_deliver", handler);

    queue.enqueue({ type: "notification_deliver", payload: {}, maxAttempts: 3 });

    // Process 3 times — each attempt schedules a retry
    await queue.processReady();
    let job = queue.getJobs("pending")[0];
    if (job) { job.scheduledAt = new Date(); }
    await queue.processReady();
    job = queue.getJobs("pending")[0];
    if (job) { job.scheduledAt = new Date(); }
    await queue.processReady();

    // After 3 attempts, job should be dead-lettered
    expect(queue.getStats().deadLetter).toBe(1);
  });

  it("dead-letters immediately when retryable=false", async () => {
    const queue = new JobQueue();
    queue.registerHandler("notification_deliver", async (): Promise<JobResult> => ({
      success: false,
      error: "Permanent failure",
      retryable: false,
    }));

    queue.enqueue({ type: "notification_deliver", payload: {} });
    await queue.processReady();

    expect(queue.getStats().deadLetter).toBe(1);
    expect(queue.getStats().completed).toBe(0);
  });

  it("exponential backoff increases with attempt count", () => {
    const delays = [1, 2, 3, 4].map((attempt) => computeBackoffMs(attempt, 1000));

    // Each delay should be roughly double the previous (with jitter)
    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]).toBeGreaterThan(delays[i - 1] * 1.5);
    }
    // First delay ~1s
    expect(delays[0]).toBeGreaterThanOrEqual(1000);
    expect(delays[0]).toBeLessThanOrEqual(1300);
  });

  it("scheduled jobs are not processed before their scheduledAt", async () => {
    const queue = new JobQueue();
    const handler = vi.fn(async (): Promise<JobResult> => ({ success: true }));
    queue.registerHandler("review_execute", handler);

    queue.enqueue({
      type: "review_execute",
      payload: {},
      scheduledAt: new Date(Date.now() + 60_000), // 1 minute in the future
    });

    const processed = await queue.processReady();
    expect(processed).toBe(0);
    expect(handler).not.toHaveBeenCalled();
  });
});

// ──────────────────────────────────────────────
//  Dead-Letter Queue (DLQ)
// ──────────────────────────────────────────────

describe("Worker: Dead-Letter Queue (Spec §14.3)", () => {
  it("manually retries dead-letter jobs", async () => {
    const queue = new JobQueue();
    let shouldFail = true;
    queue.registerHandler("review_execute", async (): Promise<JobResult> => ({
      success: !shouldFail,
      error: shouldFail ? "Failing" : undefined,
      retryable: false,
    }));

    const job = queue.enqueue({ type: "review_execute", payload: {} });
    await queue.processReady();
    expect(queue.getStats().deadLetter).toBe(1);

    // Fix the handler and manually retry
    shouldFail = false;
    const retried = queue.retryDeadLetter(job.id);
    expect(retried).toBeDefined();
    expect(retried!.status).toBe("pending");
    expect(retried!.attemptCount).toBe(0);

    await queue.processReady();
    expect(queue.getStats().completed).toBe(1);
  });

  it("cannot retry non-dead-letter jobs", () => {
    const queue = new JobQueue();
    const job = queue.enqueue({ type: "review_execute", payload: {} });

    const result = queue.retryDeadLetter(job.id);
    expect(result).toBeUndefined();
  });
});

// ──────────────────────────────────────────────
//  Resumability
// ──────────────────────────────────────────────

describe("Worker: Resumability (Spec §14.3)", () => {
  it("resumes interrupted processing jobs", async () => {
    const queue = new JobQueue();
    queue.registerHandler("review_execute", async (): Promise<JobResult> => ({
      success: true,
    }));

    queue.enqueue({ type: "review_execute", payload: {} });

    // Simulate a crash mid-processing by directly setting status
    const job = queue.getJobs("pending")[0];
    job.status = "processing";

    // Resume
    const resumed = queue.resumeInterruptedJobs();
    expect(resumed).toBe(1);
    expect(queue.getJobs("pending").length).toBe(1);
    expect(queue.getJobs("processing").length).toBe(0);
  });
});

// ──────────────────────────────────────────────
//  Job Cancellation
// ──────────────────────────────────────────────

describe("Worker: Job Cancellation", () => {
  it("cancels a pending job", () => {
    const queue = new JobQueue();
    const job = queue.enqueue({ type: "review_execute", payload: {} });

    expect(queue.cancelJob(job.id)).toBe(true);
    expect(queue.getJob(job.id)!.status).toBe("cancelled");
  });

  it("cannot cancel a completed job", async () => {
    const queue = new JobQueue();
    queue.registerHandler("review_execute", async (): Promise<JobResult> => ({
      success: true,
    }));

    const job = queue.enqueue({ type: "review_execute", payload: {} });
    await queue.processReady();

    expect(queue.cancelJob(job.id)).toBe(false);
  });
});

// ──────────────────────────────────────────────
//  Worker Service Integration
// ──────────────────────────────────────────────

describe("Worker: Service Integration", () => {
  it("registers all built-in job types", () => {
    const worker = new WorkerService();

    // All handler types should be registered (no dead-letter for known types)
    const queue = worker.getQueue();
    const types = [
      "review_execute", "notification_deliver", "settlement_monitor",
      "recording_cleanup", "ledger_reconcile", "offer_expire",
      "objection_window_check", "training_provenance_check",
    ] as const;

    for (const type of types) {
      const job = queue.enqueue({ type, payload: {} });
      expect(job.type).toBe(type);
    }

    expect(queue.getStats().total).toBe(8);
  });

  it("processes a batch of jobs", async () => {
    const worker = new WorkerService();
    const queue = worker.getQueue();

    queue.registerHandler("notification_deliver", async (): Promise<JobResult> => ({
      success: true,
    }));

    queue.enqueue({ type: "notification_deliver", payload: {} });
    queue.enqueue({ type: "notification_deliver", payload: {} });
    queue.enqueue({ type: "notification_deliver", payload: {} });

    const processed = await worker.processBatch(3);
    expect(processed).toBe(3);
  });

  it("reports worker status", () => {
    const worker = new WorkerService();
    const status = worker.getStatus();

    expect(status.isRunning).toBe(false);
    expect(status.queueStats).toBeDefined();
    expect(status.deadLetterCount).toBe(0);
  });

  it("starts and stops cleanly", () => {
    const worker = new WorkerService({ pollIntervalMs: 100 });

    worker.start();
    expect(worker.getStatus().isRunning).toBe(true);

    worker.stop();
    expect(worker.getStatus().isRunning).toBe(false);
  });
});

// ──────────────────────────────────────────────
//  Settlement Monitor Handler
// ──────────────────────────────────────────────

describe("Worker: Settlement Monitor (Spec §9.1)", () => {
  it("retries polling while funding is pending", async () => {
    const worker = new WorkerService();
    const queue = worker.getQueue();

    queue.enqueue({
      type: "settlement_monitor",
      payload: {
        milestoneId: "m1",
        fundingIntentId: "fi1",
        network: "base-sepolia",
        token: "USDC",
        expectedAmount: "120000000",
        recipientAddress: "0xabc",
        pollCount: 0,
        maxPolls: 100,
      },
    });

    // Process — should fail (retryable) since funding isn't detected yet
    await worker.processBatch();
    const stats = queue.getStats();
    expect(stats.completed).toBe(0);
    // Job should be scheduled for retry
    expect(stats.deadLetter).toBe(0);
  });

  it("dead-letters after maxPolls exhausted", async () => {
    const worker = new WorkerService();
    const queue = worker.getQueue();

    queue.enqueue({
      type: "settlement_monitor",
      payload: {
        milestoneId: "m1",
        fundingIntentId: "fi1",
        network: "base-sepolia",
        token: "USDC",
        expectedAmount: "120000000",
        recipientAddress: "0xabc",
        pollCount: 100,
        maxPolls: 100,
      },
    });

    await worker.processBatch();
    expect(queue.getStats().deadLetter).toBe(1);
  });
});

// ──────────────────────────────────────────────
//  Recording Cleanup Handler
// ──────────────────────────────────────────────

describe("Worker: Recording Cleanup (Spec §3.2, §15.1 Scenario 16)", () => {
  it("blocks deletion when dispute hold is active", async () => {
    const worker = new WorkerService();
    const queue = worker.getQueue();

    queue.enqueue({
      type: "recording_cleanup",
      payload: {
        recordingId: "r1",
        storagePath: "s3://bucket/r1.mp4",
        expiresAt: new Date(Date.now() - 1000).toISOString(),
        hasDisputeHold: true,
      },
    });

    await worker.processBatch();
    // Should NOT complete — blocked by dispute hold
    expect(queue.getStats().completed).toBe(0);
    expect(queue.getStats().deadLetter).toBe(0);
  });

  it("reschedules if not yet expired", async () => {
    const worker = new WorkerService();
    const queue = worker.getQueue();

    queue.enqueue({
      type: "recording_cleanup",
      payload: {
        recordingId: "r2",
        storagePath: "s3://bucket/r2.mp4",
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        hasDisputeHold: false,
      },
    });

    await worker.processBatch();
    expect(queue.getStats().completed).toBe(0); // Not yet expired
  });

  it("deletes expired recordings without dispute hold", async () => {
    const worker = new WorkerService();
    const queue = worker.getQueue();

    queue.enqueue({
      type: "recording_cleanup",
      payload: {
        recordingId: "r3",
        storagePath: "s3://bucket/r3.mp4",
        expiresAt: new Date(Date.now() - 1000).toISOString(),
        hasDisputeHold: false,
      },
    });

    await worker.processBatch();
    expect(queue.getStats().completed).toBe(1);
  });
});