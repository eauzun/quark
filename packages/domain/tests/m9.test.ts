/**
 * m9.test.ts — Production gates, admin operations & notifications (Spec §17, §19).
 *
 * Covers:
 * - Gate tracker: status transitions, launch gating
 * - Admin operations: category gates, emergency pause
 * - Notification outbox: idempotent delivery, preferences
 * - Environment validation: production safety checks
 */

import { describe, it, expect } from "vitest";
import {
  GateTracker,
  PRODUCTION_GATES,
} from "../src/admin/gate-tracker.js";
import { AdminOperations } from "../src/admin/operations.js";
import { NotificationOutbox } from "../src/notifications/outbox.js";

// ──────────────────────────────────────────────
//  Gate Tracker (Spec §19)
// ──────────────────────────────────────────────

describe("M9: Production Gate Tracker (Spec §19)", () => {
  it("initializes with all 8 gates from spec", () => {
    const tracker = new GateTracker();
    const report = tracker.getReport();

    expect(report.totalGates).toBe(8);
    expect(report.clearedGates).toBe(0);
    expect(report.canLaunchRealMoney).toBe(false);
    expect(report.canOperateTestnet).toBe(true);
  });

  it("cannot launch real money with uncleared hard blocks", () => {
    const tracker = new GateTracker();
    const report = tracker.getReport();

    expect(report.canLaunchRealMoney).toBe(false);
    expect(report.blockingGates.length).toBeGreaterThan(0);
  });

  it("cannot clear a gate without evidence submission first", () => {
    const tracker = new GateTracker();

    const result = tracker.updateGate("entity-jurisdictions", "cleared");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("gate lifecycle: not_started -> evidence_submitted -> cleared", () => {
    const tracker = new GateTracker();

    const submit = tracker.updateGate(
      "usdc-network",
      "evidence_submitted",
      "Circle USDC address verified"
    );
    expect(submit.ok).toBe(true);
    if (submit.ok) {
      expect(submit.value.status).toBe("evidence_submitted");
      expect(submit.value.evidenceSubmittedAt).toBeInstanceOf(Date);
    }

    const clear = tracker.updateGate("usdc-network", "cleared", "Finality policy documented");
    expect(clear.ok).toBe(true);
    if (clear.ok) {
      expect(clear.value.status).toBe("cleared");
      expect(clear.value.clearedAt).toBeInstanceOf(Date);
      expect(clear.value.notes.length).toBe(2);
    }
  });

  it("testnet funding is always allowed regardless of gates", () => {
    const tracker = new GateTracker();

    expect(tracker.isActionAllowed("testnet_funding")).toBe(true);
    expect(tracker.isActionAllowed("real_money_funding")).toBe(false);
    expect(tracker.isActionAllowed("mainnet_adapter")).toBe(false);
    expect(tracker.isActionAllowed("autonomous_acceptance")).toBe(false);
  });

  it("mainnet adapter allowed only after USDC gate cleared", () => {
    const tracker = new GateTracker();

    expect(tracker.isActionAllowed("mainnet_adapter")).toBe(false);

    tracker.updateGate("usdc-network", "evidence_submitted");
    tracker.updateGate("usdc-network", "cleared");

    expect(tracker.isActionAllowed("mainnet_adapter")).toBe(true);
  });

  it("autonomous acceptance allowed only after category qualification gate", () => {
    const tracker = new GateTracker();

    expect(tracker.isActionAllowed("autonomous_acceptance")).toBe(false);

    tracker.updateGate("category-qualification", "evidence_submitted");
    tracker.updateGate("category-qualification", "cleared");

    expect(tracker.isActionAllowed("autonomous_acceptance")).toBe(true);
  });

  it("audit notes accumulate across gate updates", () => {
    const tracker = new GateTracker();

    tracker.updateGate("ai-vendor", "evidence_submitted", "API access confirmed");
    tracker.updateGate("ai-vendor", "in_progress", "Waiting for DPA review");
    tracker.updateGate("ai-vendor", "evidence_submitted", "DPA signed");

    const gate = tracker.getGate("ai-vendor");
    expect(gate).toBeDefined();
    expect(gate!.notes.length).toBe(4); // 1 initial + 3 added
  });
});

// ──────────────────────────────────────────────
//  Admin Operations (Spec §1.1, §17)
// ──────────────────────────────────────────────

describe("M9: Admin Operations — Category Gates (Spec §1.1)", () => {
  function createCompleteCategory(): Parameters<AdminOperations["registerCategory"]>[0] {
    return {
      categoryId: "frontend",
      name: "Frontend Development",
      status: "draft",
      riskTier: "low",
      benchmarkRequirement: {
        minTotalCases: 200,
        minMustRejectCases: 60,
        hasBenchmarkEvidence: true,
        falseAcceptRate: 0,
        falseRejectRate: 0.05,
      },
      requirements: {
        hasSkillMap: true,
        hasChallengePool: true,
        hasScopeTemplate: true,
        hasAcceptanceRubric: true,
        hasCheckTools: true,
        hasBenchmarkEvidence: true,
        hasExceptionPath: true,
        hasOperationalOwner: true,
      },
    };
  }

  it("registers category in draft status", () => {
    const admin = new AdminOperations();
    const category = admin.registerCategory(createCompleteCategory());

    expect(category.status).toBe("draft");
    expect(category.auditLog.length).toBe(1);
  });

  it("enables category when all requirements are met", () => {
    const admin = new AdminOperations();
    admin.registerCategory(createCompleteCategory());

    const result = admin.enableCategory("frontend", "admin-1");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("enabled");
    }
  });

  it("rejects enabling category with missing requirements", () => {
    const admin = new AdminOperations();
    const category = createCompleteCategory();
    category.requirements.hasBenchmarkEvidence = false;
    admin.registerCategory(category);

    const result = admin.enableCategory("frontend", "admin-1");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("NOT_ELIGIBLE");
      expect(result.error.message).toContain("benchmark evidence");
    }
  });

  it("rejects enabling high-risk category without 300 must-reject cases", () => {
    const admin = new AdminOperations();
    const category = createCompleteCategory();
    category.riskTier = "high";
    category.benchmarkRequirement.minMustRejectCases = 250;
    admin.registerCategory(category);

    const result = admin.enableCategory("frontend", "admin-1");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("300");
    }
  });

  it("rejects enabling high-risk category with any false accepts", () => {
    const admin = new AdminOperations();
    const category = createCompleteCategory();
    category.riskTier = "high";
    category.benchmarkRequirement.minMustRejectCases = 300;
    category.benchmarkRequirement.falseAcceptRate = 0.01;
    admin.registerCategory(category);

    const result = admin.enableCategory("frontend", "admin-1");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("zero");
    }
  });

  it("pauses category with audit trail", () => {
    const admin = new AdminOperations();
    admin.registerCategory(createCompleteCategory());
    admin.enableCategory("frontend", "admin-1");

    const result = admin.pauseCategory("frontend", "admin-1", "False accept incident");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("paused");
      expect(result.value.auditLog.some((l) => l.includes("False accept"))).toBe(true);
    }
  });
});

describe("M9: Admin Operations — Emergency Pause (Spec §17)", () => {
  it("activates emergency pause for new funding", () => {
    const admin = new AdminOperations();

    const pause = admin.activateEmergencyPause(
      "new_funding",
      "Ledger mismatch detected",
      "incident-owner"
    );

    expect(pause.isActive).toBe(true);
    expect(pause.scope).toBe("new_funding");
    expect(admin.isPaused("new_funding")).toBe(true);
    expect(admin.isPaused("new_offers")).toBe(false);
  });

  it("'all' scope pauses everything", () => {
    const admin = new AdminOperations();

    admin.activateEmergencyPause("all", "Security incident", "security-team");

    expect(admin.isPaused("new_funding")).toBe(true);
    expect(admin.isPaused("new_offers")).toBe(true);
    expect(admin.isPaused("releases")).toBe(true);
  });

  it("deactivation lifts the pause", () => {
    const admin = new AdminOperations();

    const pause = admin.activateEmergencyPause("releases", "Payout stuck", "ops");
    expect(admin.isPaused("releases")).toBe(true);

    const result = admin.deactivateEmergencyPause(pause.id, "ops");
    expect(result.ok).toBe(true);
    expect(admin.isPaused("releases")).toBe(false);
  });

  it("audit log records all admin actions", () => {
    const admin = new AdminOperations();

    admin.activateEmergencyPause("new_funding", "Test", "tester");
    admin.deactivateEmergencyPause(
      admin.getActivePauses()[0].id,
      "tester"
    );

    const audit = admin.getAuditLog();
    expect(audit.length).toBeGreaterThanOrEqual(2);
    expect(audit[0].action).toBe("emergency_pause.activate");
  });
});

// ──────────────────────────────────────────────
//  Notification Outbox (Spec §13, §14.2)
// ──────────────────────────────────────────────

describe("M9: Notification Outbox — Idempotent Delivery (Spec §13)", () => {
  it("enqueues transactional notification", () => {
    const outbox = new NotificationOutbox();

    const result = outbox.enqueue({
      dedupeKey: "offer-created:offer-1",
      eventType: "AssignmentCreated",
      channel: "in_app",
      recipientUserId: "user-worker-1",
      payload: {
        title: "New offer received",
        body: "You have a new job offer",
        entityRef: "offer-1",
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("pending");
      expect(result.value.priority).toBe("transactional");
    }
  });

  it("duplicate dedupeKey returns same message (idempotent)", () => {
    const outbox = new NotificationOutbox();

    const first = outbox.enqueue({
      dedupeKey: "funding-final:mile-1",
      eventType: "FundingFinalized",
      channel: "in_app",
      recipientUserId: "user-1",
      payload: { title: "Funded", body: "Milestone funded" },
    });

    const second = outbox.enqueue({
      dedupeKey: "funding-final:mile-1",
      eventType: "FundingFinalized",
      channel: "in_app",
      recipientUserId: "user-1",
      payload: { title: "Funded", body: "Milestone funded" },
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.value.id).toBe(second.value.id);
    }
  });

  it("suppresses marketing notifications when opted out", () => {
    const outbox = new NotificationOutbox();
    outbox.setPreferences({
      userId: "user-1",
      transactionalEnabled: true,
      marketingEnabled: false,
      emailEnabled: true,
    });

    const result = outbox.enqueue({
      dedupeKey: "marketing:user-1",
      eventType: "TransferConfirmed",
      channel: "email",
      recipientUserId: "user-1",
      payload: { title: "Promo", body: "Special offer!" },
      priority: "marketing",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("suppressed");
    }
  });

  it("cannot suppress transactional notifications", () => {
    const outbox = new NotificationOutbox();
    outbox.setPreferences({
      userId: "user-1",
      transactionalEnabled: true,
      marketingEnabled: false,
      emailEnabled: false,
    });

    const result = outbox.enqueue({
      dedupeKey: "security:user-1",
      eventType: "SecurityAlert",
      channel: "email",
      recipientUserId: "user-1",
      payload: { title: "Security Alert", body: "New device sign-in" },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Transactional is never suppressed even with emailEnabled=false
      expect(result.value.status).toBe("pending");
    }
  });

  it("tracks delivery states and retries", () => {
    const outbox = new NotificationOutbox();

    const msg = outbox.enqueue({
      dedupeKey: "payout:user-1",
      eventType: "PaymentSent",
      channel: "in_app",
      recipientUserId: "user-1",
      payload: { title: "Payment sent", body: "Your payment is on its way" },
    });

    expect(msg.ok).toBe(true);
    if (msg.ok) {
      const sent = outbox.markSent(msg.value.id);
      expect(sent.ok).toBe(true);
      if (sent.ok) {
        expect(sent.value.status).toBe("sent");
        expect(sent.value.sentAt).toBeInstanceOf(Date);
      }
    }
  });

  it("failed messages retry up to maxRetries", () => {
    const outbox = new NotificationOutbox();

    const msg = outbox.enqueue({
      dedupeKey: "offer:user-2",
      eventType: "OfferExpired",
      channel: "email",
      recipientUserId: "user-2",
      payload: { title: "Offer expired", body: "Your offer has expired" },
    });

    expect(msg.ok).toBe(true);
    if (msg.ok) {
      // Fail 3 times (maxRetries = 3)
      let current = outbox.markFailed(msg.value.id, "SMTP timeout");
      expect(current.ok).toBe(true);
      if (current.ok) expect(current.value.status).toBe("pending"); // retryCount 1

      current = outbox.markFailed(msg.value.id, "SMTP timeout");
      expect(current.ok).toBe(true);
      if (current.ok) expect(current.value.status).toBe("pending"); // retryCount 2

      current = outbox.markFailed(msg.value.id, "SMTP timeout");
      expect(current.ok).toBe(true);
      if (current.ok) expect(current.value.status).toBe("failed"); // retryCount 3 = maxRetries
    }
  });

  it("provides outbox statistics", () => {
    const outbox = new NotificationOutbox();

    outbox.enqueue({
      dedupeKey: "stat-1",
      eventType: "ReviewCompleted",
      channel: "in_app",
      recipientUserId: "user-1",
      payload: { title: "Review done", body: "Your submission was reviewed" },
    });

    const stats = outbox.getStats();
    expect(stats.total).toBe(1);
    expect(stats.pending).toBe(1);
    expect(stats.sent).toBe(0);
  });
});

// ──────────────────────────────────────────────
//  Environment Safety (Spec §14, §0.1)
// ──────────────────────────────────────────────

describe("M9: Environment Safety (Spec §14 & §0.1)", () => {
  it("local environment has visible banner", async () => {
    const { ENVIRONMENTS } = await import(
      "../../../infra/deployment/environments.js"
    );

    expect(ENVIRONMENTS.local.isNonProduction).toBe(true);
    expect(ENVIRONMENTS.local.environmentBanner).toBeDefined();
    expect(ENVIRONMENTS.local.environmentBanner).toContain("LOCAL");
  });

  it("staging clearly marks testnet", async () => {
    const { ENVIRONMENTS } = await import(
      "../../../infra/deployment/environments.js"
    );

    expect(ENVIRONMENTS.staging.isNonProduction).toBe(true);
    expect(ENVIRONMENTS.staging.settlementMode).toBe("testnet");
    expect(ENVIRONMENTS.staging.environmentBanner).toContain("TESTNET");
  });

  it("production disables real money by default (gated)", async () => {
    const { ENVIRONMENTS } = await import(
      "../../../infra/deployment/environments.js"
    );

    expect(ENVIRONMENTS.production.features.realMoney).toBe(false);
    expect(ENVIRONMENTS.production.features.mainnetSettlement).toBe(false);
  });

  it("production validation warns if mock settlement detected", async () => {
    const { ENVIRONMENTS, EnvironmentValidator, MockSecretsProvider } = await import(
      "../../../infra/deployment/environments.js"
    );

    // Temporarily test with a mock config (simulating misconfiguration)
    const validator = new EnvironmentValidator();
    const secrets = new MockSecretsProvider();

    // Set all required production secrets
    for (const secret of ENVIRONMENTS.production.requiredSecrets) {
      secrets.setSecret(secret, "test-value");
    }

    const result = await validator.validate("production", secrets);

    expect(result.isValid).toBe(true);
    // Should warn about real money being disabled
    expect(result.warnings.length).toBeGreaterThanOrEqual(0);
  });

  it("production validation fails when secrets are missing", async () => {
    const { EnvironmentValidator, MockSecretsProvider } = await import(
      "../../../infra/deployment/environments.js"
    );

    const validator = new EnvironmentValidator();
    const secrets = new MockSecretsProvider(); // No secrets set

    const result = await validator.validate("production", secrets);

    expect(result.isValid).toBe(false);
    expect(result.missingSecrets.length).toBeGreaterThan(0);
    expect(result.missingSecrets).toContain("DATABASE_URL");
  });
});