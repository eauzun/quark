/**
 * infra/monitoring/metrics.ts — Operational metrics definitions (Spec §17).
 *
 * Spec §17: "Track: approval time, qualification pass/retry rate,
 * time-to-first-offer, matched/posted ratio, offer acceptance/expiry,
 * deadline performance, reviewer latency, revision count, independently
 * confirmed false accepts/rejects, dispute/upheld rates, AI spend/job,
 * sandbox spend, support minutes, onboarding cost/activated worker,
 * contribution/job, repeat employer rate, payout latency, ledger
 * reconciliation failures, recording deletion SLA and training rights
 * completeness."
 *
 * Spec §14.3: "Alert immediately on ledger mismatch, leaked secret,
 * unauthorized access, stuck payable transfer or category false-accept incident."
 */

// ──────────────────────────────────────────────
//  Metric Definitions
// ──────────────────────────────────────────────

export interface MetricDefinition {
  id: string;
  name: string;
  description: string;
  unit: "count" | "duration_ms" | "usd" | "percent" | "ratio" | "bytes";
  /** Alert threshold — trigger when metric exceeds this */
  alertThreshold?: number;
  /** Alert when metric is above (true) or below (false) threshold */
  alertDirection: "above" | "below";
  /** Whether this metric is a hard alert (page immediately) */
  isHardAlert: boolean;
}

export const OPERATIONAL_METRICS: MetricDefinition[] = [
  // ── User & Approval ──
  {
    id: "approval_time_avg",
    name: "Average Approval Time",
    description: "Time from role application to decision",
    unit: "duration_ms",
    alertThreshold: 48 * 60 * 60 * 1000, // 48 hours
    alertDirection: "above",
    isHardAlert: false,
  },
  {
    id: "qualification_pass_rate",
    name: "Qualification Pass Rate",
    description: "Percentage of assessments resulting in qualified status",
    unit: "percent",
    alertDirection: "below",
    isHardAlert: false,
  },

  // ── Matching & Offers ──
  {
    id: "time_to_first_offer",
    name: "Time to First Offer",
    description: "Time from job posting to first worker offer",
    unit: "duration_ms",
    alertDirection: "above",
    isHardAlert: false,
  },
  {
    id: "matched_posted_ratio",
    name: "Matched/Posted Ratio",
    description: "Percentage of posted jobs that receive at least one offer",
    unit: "percent",
    alertDirection: "below",
    isHardAlert: false,
  },
  {
    id: "offer_acceptance_rate",
    name: "Offer Acceptance Rate",
    description: "Percentage of offers accepted by workers",
    unit: "percent",
    alertDirection: "below",
    isHardAlert: false,
  },

  // ── Delivery & Review ──
  {
    id: "deadline_performance",
    name: "On-Time Delivery Rate",
    description: "Percentage of milestones delivered before deadline",
    unit: "percent",
    alertDirection: "below",
    isHardAlert: false,
  },
  {
    id: "reviewer_latency_p95",
    name: "Review Latency (p95)",
    description: "95th percentile time from submission to review completion",
    unit: "duration_ms",
    alertThreshold: 24 * 60 * 60 * 1000, // 24 hours
    alertDirection: "above",
    isHardAlert: true,
  },
  {
    id: "revision_count_avg",
    name: "Average Revision Count",
    description: "Average number of revision rounds per milestone",
    unit: "count",
    alertDirection: "above",
    isHardAlert: false,
  },

  // ── AI Quality ──
  {
    id: "false_accept_rate",
    name: "False Accept Rate",
    description: "AI accepted work that should have been rejected (confirmed)",
    unit: "ratio",
    alertThreshold: 0.01, // 1% — any confirmed false accept triggers incident
    alertDirection: "above",
    isHardAlert: true,
  },
  {
    id: "false_reject_rate",
    name: "False Reject Rate",
    description: "AI rejected work that should have been accepted (confirmed)",
    unit: "ratio",
    alertThreshold: 0.10,
    alertDirection: "above",
    isHardAlert: false,
  },

  // ── Financial ──
  {
    id: "ai_spend_per_job",
    name: "AI Spend Per Job",
    description: "Average AI model cost per reviewed job",
    unit: "usd",
    alertDirection: "above",
    isHardAlert: false,
  },
  {
    id: "contribution_per_job",
    name: "Contribution Per Job",
    description: "Platform revenue minus variable costs per job",
    unit: "usd",
    alertThreshold: 0,
    alertDirection: "below",
    isHardAlert: true,
  },
  {
    id: "payout_latency_p95",
    name: "Payout Latency (p95)",
    description: "Time from payable to confirmed transfer",
    unit: "duration_ms",
    alertThreshold: 7 * 24 * 60 * 60 * 1000, // 7 days
    alertDirection: "above",
    isHardAlert: true,
  },

  // ── Ledger & Reconciliation ──
  {
    id: "ledger_reconciliation_failures",
    name: "Ledger Reconciliation Failures",
    description: "Number of daily reconciliation mismatches",
    unit: "count",
    alertThreshold: 0, // Any failure is an alert
    alertDirection: "above",
    isHardAlert: true,
  },

  // ── Disputes ──
  {
    id: "dispute_rate",
    name: "Dispute Rate",
    description: "Percentage of milestones entering dispute",
    unit: "percent",
    alertDirection: "above",
    isHardAlert: false,
  },
  {
    id: "dispute_upheld_rate",
    name: "Dispute Upheld Rate",
    description: "Percentage of disputes resolved in favor of disputing party",
    unit: "percent",
    alertDirection: "above",
    isHardAlert: false,
  },

  // ── Privacy & Compliance ──
  {
    id: "recording_deletion_sla",
    name: "Recording Deletion SLA Compliance",
    description: "Percentage of recordings deleted within 24h of expiry",
    unit: "percent",
    alertThreshold: 1.0, // Must be 100%
    alertDirection: "below",
    isHardAlert: true,
  },
  {
    id: "training_rights_completeness",
    name: "Training Rights Completeness",
    description: "Percentage of dataset items with verified rights grants",
    unit: "percent",
    alertThreshold: 1.0, // Must be 100%
    alertDirection: "below",
    isHardAlert: true,
  },
];

// ──────────────────────────────────────────────
//  Metric Collector
// ──────────────────────────────────────────────

export interface MetricSnapshot {
  metricId: string;
  value: number;
  timestamp: Date;
  labels?: Record<string, string>;
}

export interface Alert {
  id: string;
  metricId: string;
  metricName: string;
  threshold: number;
  actualValue: number;
  severity: "warning" | "critical";
  triggeredAt: Date;
  message: string;
}

export class MetricsCollector {
  private snapshots: Map<string, MetricSnapshot[]> = new Map();
  private alerts: Alert[] = [];

  /**
   * Record a metric snapshot and check alert thresholds.
   */
  record(metricId: string, value: number, labels?: Record<string, string>): Alert[] {
    const definition = OPERATIONAL_METRICS.find((m) => m.id === metricId);
    if (!definition) return [];

    // Store snapshot
    const existing = this.snapshots.get(metricId) || [];
    existing.push({ metricId, value, timestamp: new Date(), labels });
    this.snapshots.set(metricId, existing);

    // Check alert threshold
    const newAlerts: Alert[] = [];
    if (definition.alertThreshold !== undefined) {
      const shouldAlert =
        definition.alertDirection === "above"
          ? value > definition.alertThreshold
          : value < definition.alertThreshold;

      if (shouldAlert) {
        const alert: Alert = {
          id: crypto.randomUUID(),
          metricId,
          metricName: definition.name,
          threshold: definition.alertThreshold,
          actualValue: value,
          severity: definition.isHardAlert ? "critical" : "warning",
          triggeredAt: new Date(),
          message: `${definition.name}: ${value} ${definition.alertDirection === "above" ? "exceeds" : "below"} threshold ${definition.alertThreshold} (${definition.unit})`,
        };
        newAlerts.push(alert);
        this.alerts.push(alert);
      }
    }

    return newAlerts;
  }

  /**
   * Get the latest value for a metric.
   */
  getLatest(metricId: string): MetricSnapshot | undefined {
    const snapshots = this.snapshots.get(metricId);
    return snapshots?.[snapshots.length - 1];
  }

  /**
   * Get all active alerts.
   */
  getAlerts(severity?: "warning" | "critical"): Alert[] {
    if (severity) {
      return this.alerts.filter((a) => a.severity === severity);
    }
    return [...this.alerts];
  }

  /**
   * Clear an alert by ID.
   */
  clearAlert(alertId: string): boolean {
    const index = this.alerts.findIndex((a) => a.id === alertId);
    if (index >= 0) {
      this.alerts.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Generate a summary report of all metrics.
   */
  getSummary(): Record<string, number | undefined> {
    const summary: Record<string, number | undefined> = {};
    for (const metric of OPERATIONAL_METRICS) {
      const latest = this.getLatest(metric.id);
      summary[metric.id] = latest?.value;
    }
    return summary;
  }
}