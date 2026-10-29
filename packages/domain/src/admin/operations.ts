/**
 * admin/operations.ts — Operational controls and category gate management.
 * Spec §1.1: "All founder-selected categories exist in the taxonomy and UI.
 * Each has draft, evaluation, enabled, paused status."
 * Spec §17: "Admin policy changes prospective and audited."
 * Spec §17: "Emergency pause scope configurable (new funding, new offers,
 * releases) with reason and owner."
 */

import { Result, ok, err, createError } from "../shared/result.js";

// ──────────────────────────────────────────────
//  Category Gate Management
// ──────────────────────────────────────────────

export type CategoryStatus = "draft" | "evaluation" | "enabled" | "paused";

export interface CategoryGate {
  categoryId: string;
  name: string;
  status: CategoryStatus;
  riskTier: "low" | "standard" | "high";
  /** Benchmark evidence requirements (Spec §7.3) */
  benchmarkRequirement: {
    minTotalCases: number;
    minMustRejectCases: number;
    hasBenchmarkEvidence: boolean;
    falseAcceptRate: number | null;
    falseRejectRate: number | null;
  };
  /** Required assets before enabling (Spec §1.1) */
  requirements: {
    hasSkillMap: boolean;
    hasChallengePool: boolean;
    hasScopeTemplate: boolean;
    hasAcceptanceRubric: boolean;
    hasCheckTools: boolean;
    hasBenchmarkEvidence: boolean;
    hasExceptionPath: boolean;
    hasOperationalOwner: boolean;
  };
  /** When the category was last changed */
  lastStatusChange: Date;
  /** Audit trail */
  auditLog: string[];
}

// ──────────────────────────────────────────────
//  Emergency Pause
// ──────────────────────────────────────────────

export type PauseScope = "new_funding" | "new_offers" | "releases" | "all";

export interface EmergencyPause {
  id: string;
  scope: PauseScope;
  reason: string;
  owner: string;
  activatedAt: Date;
  expiresAt?: Date;
  isActive: boolean;
}

// ──────────────────────────────────────────────
//  Audit Event
// ──────────────────────────────────────────────

export interface AuditEvent {
  id: string;
  actor: string;
  action: string;
  target: string;
  reason: string;
  correlationId: string;
  timestamp: Date;
  metadata: Record<string, unknown>;
}

// ──────────────────────────────────────────────
//  Admin Operations Service
// ──────────────────────────────────────────────

export class AdminOperations {
  private categories: Map<string, CategoryGate> = new Map();
  private pauses: EmergencyPause[] = [];
  private auditEvents: AuditEvent[] = [];

  /**
   * Register a new category in the taxonomy.
   * Spec §1.1: Categories start in 'draft' status.
   */
  registerCategory(gate: Omit<CategoryGate, "lastStatusChange" | "auditLog">): CategoryGate {
    const category: CategoryGate = {
      ...gate,
      lastStatusChange: new Date(),
      auditLog: [`[${new Date().toISOString()}] Category registered`],
    };
    this.categories.set(gate.categoryId, category);
    this.logAudit("system", "category.register", gate.categoryId, "Category registered");
    return category;
  }

  /**
   * Attempt to enable a category for paid autonomous acceptance.
   * Spec §1.1: "Every enabled category requires: skill map, challenge pool,
   * scope template, acceptance rubric, execution/check tools, benchmark
   * evidence, an exception path, and operational ownership."
   * Spec §7.3: "Paid autonomous activation requires benchmark evidence."
   */
  enableCategory(categoryId: string, actor: string): Result<CategoryGate> {
    const category = this.categories.get(categoryId);
    if (!category) {
      return err(createError("NOT_FOUND", `Category '${categoryId}' not found`));
    }

    // Check all requirements are met
    const missing: string[] = [];
    const req = category.requirements;
    if (!req.hasSkillMap) missing.push("skill map");
    if (!req.hasChallengePool) missing.push("challenge pool");
    if (!req.hasScopeTemplate) missing.push("scope template");
    if (!req.hasAcceptanceRubric) missing.push("acceptance rubric");
    if (!req.hasCheckTools) missing.push("check tools");
    if (!req.hasBenchmarkEvidence) missing.push("benchmark evidence");
    if (!req.hasExceptionPath) missing.push("exception path");
    if (!req.hasOperationalOwner) missing.push("operational owner");

    if (missing.length > 0) {
      return err(
        createError(
          "NOT_ELIGIBLE",
          `Category '${categoryId}' cannot be enabled — missing: ${missing.join(", ")}`
        )
      );
    }

    // Check benchmark thresholds for high-risk categories
    if (category.riskTier === "high") {
      const bench = category.benchmarkRequirement;
      if (bench.minMustRejectCases < 300) {
        return err(
          createError(
            "NOT_ELIGIBLE",
            `High-risk category requires ≥300 critical negative cases (has ${bench.minMustRejectCases})`
          )
        );
      }
      if (bench.falseAcceptRate !== null && bench.falseAcceptRate > 0) {
        return err(
          createError(
            "NOT_ELIGIBLE",
            `High-risk category has ${bench.falseAcceptRate} false accepts — must be zero`
          )
        );
      }
    }

    category.status = "enabled";
    category.lastStatusChange = new Date();
    category.auditLog.push(`[${new Date().toISOString()}] Enabled by ${actor}`);
    this.logAudit(actor, "category.enable", categoryId, "Category enabled for paid autonomous acceptance");
    return ok({ ...category, auditLog: [...category.auditLog] });
  }

  /**
   * Pause a category (e.g., after severe false accept incident).
   * Spec §7.3: "A severe confirmed false accept pauses affected policy/category."
   */
  pauseCategory(categoryId: string, actor: string, reason: string): Result<CategoryGate> {
    const category = this.categories.get(categoryId);
    if (!category) {
      return err(createError("NOT_FOUND", `Category '${categoryId}' not found`));
    }

    category.status = "paused";
    category.lastStatusChange = new Date();
    category.auditLog.push(`[${new Date().toISOString()}] Paused by ${actor}: ${reason}`);
    this.logAudit(actor, "category.pause", categoryId, reason);
    return ok({ ...category, auditLog: [...category.auditLog] });
  }

  /**
   * Activate emergency pause.
   * Spec §17: "Emergency pause scope configurable with reason and owner."
   */
  activateEmergencyPause(
    scope: PauseScope,
    reason: string,
    owner: string
  ): EmergencyPause {
    const pause: EmergencyPause = {
      id: crypto.randomUUID(),
      scope,
      reason,
      owner,
      activatedAt: new Date(),
      isActive: true,
    };
    this.pauses.push(pause);
    this.logAudit(owner, "emergency_pause.activate", scope, reason);
    return pause;
  }

  /**
   * Deactivate emergency pause.
   * Spec §17: "Payment pause does not delete liabilities."
   */
  deactivateEmergencyPause(pauseId: string, actor: string): Result<EmergencyPause> {
    const pause = this.pauses.find((p) => p.id === pauseId);
    if (!pause) {
      return err(createError("NOT_FOUND", `Pause '${pauseId}' not found`));
    }
    pause.isActive = false;
    this.logAudit(actor, "emergency_pause.deactivate", pauseId, "Emergency pause lifted");
    return ok({ ...pause });
  }

  /**
   * Check if an action is currently paused.
   */
  isPaused(action: "new_funding" | "new_offers" | "releases"): boolean {
    return this.pauses.some(
      (p) => p.isActive && (p.scope === action || p.scope === "all")
    );
  }

  /**
   * Get category gate status.
   */
  getCategory(categoryId: string): CategoryGate | undefined {
    return this.categories.get(categoryId);
  }

  /**
   * Get all categories.
   */
  getAllCategories(): CategoryGate[] {
    return Array.from(this.categories.values());
  }

  /**
   * Get active pauses.
   */
  getActivePauses(): EmergencyPause[] {
    return this.pauses.filter((p) => p.isActive);
  }

  /**
   * Get audit trail.
   */
  getAuditLog(): AuditEvent[] {
    return [...this.auditEvents];
  }

  /**
   * Append-only audit event.
   * Spec §14.1: "audit_events — actor, action, target, reason, correlation id; append-only."
   */
  private logAudit(actor: string, action: string, target: string, reason: string): void {
    this.auditEvents.push({
      id: crypto.randomUUID(),
      actor,
      action,
      target,
      reason,
      correlationId: crypto.randomUUID(),
      timestamp: new Date(),
      metadata: {},
    });
  }
}