/**
 * reviews.ts — Automated and human review runs, findings, and tool executions.
 *
 * A review run evaluates a submission against the scope criteria.
 * It produces per-criterion results, actionable findings, and logs
 * every tool execution for auditability.
 */
import { relations } from "drizzle-orm";
import {
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import {
  criterionResultEnum,
  findingSeverityEnum,
  reviewStatusEnum,
  riskTierEnum,
} from "./enums";
import { milestones } from "./jobs";
import { criteria } from "./jobs";
import { submissions } from "./delivery";

// ── Review Runs ────────────────────────────────────────────────────

export const reviewRuns = pgTable("review_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  milestoneId: uuid("milestone_id")
    .notNull()
    .references(() => milestones.id),
  submissionId: uuid("submission_id")
    .notNull()
    .references(() => submissions.id),
  submissionHash: varchar("submission_hash", { length: 128 }).notNull(),
  scopeVersion: varchar("scope_version", { length: 32 }).notNull(),
  policyVersion: varchar("policy_version", { length: 32 }),
  /** Versions of all AI models used during the review. */
  modelVersions: jsonb("model_versions"),
  riskTier: riskTierEnum("risk_tier").notNull(),
  status: reviewStatusEnum("status").notNull().default("pending"),
  /** Cost/usage breakdown for billing (token counts, API calls, etc.). */
  costUsage: jsonb("cost_usage"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const reviewRunsRelations = relations(
  reviewRuns,
  ({ one, many }) => ({
    milestone: one(milestones, {
      fields: [reviewRuns.milestoneId],
      references: [milestones.id],
    }),
    submission: one(submissions, {
      fields: [reviewRuns.submissionId],
      references: [submissions.id],
    }),
    criteriaResults: many(reviewCriteriaResults),
    findings: many(findings),
    toolRuns: many(toolRuns),
  }),
);

// ── Review Criteria Results ────────────────────────────────────────

export const reviewCriteriaResults = pgTable("review_criteria_results", {
  id: uuid("id").defaultRandom().primaryKey(),
  reviewRunId: uuid("review_run_id")
    .notNull()
    .references(() => reviewRuns.id),
  criterionId: uuid("criterion_id")
    .notNull()
    .references(() => criteria.id),
  result: criterionResultEnum("result").notNull(),
  /** References to supporting evidence artefacts. */
  evidenceRefs: jsonb("evidence_refs"),
  explanation: text("explanation"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const reviewCriteriaResultsRelations = relations(
  reviewCriteriaResults,
  ({ one }) => ({
    reviewRun: one(reviewRuns, {
      fields: [reviewCriteriaResults.reviewRunId],
      references: [reviewRuns.id],
    }),
    criterion: one(criteria, {
      fields: [reviewCriteriaResults.criterionId],
      references: [criteria.id],
    }),
  }),
);

// ── Findings ───────────────────────────────────────────────────────

export const findings = pgTable("findings", {
  id: uuid("id").defaultRandom().primaryKey(),
  reviewRunId: uuid("review_run_id")
    .notNull()
    .references(() => reviewRuns.id),
  criterionId: uuid("criterion_id").references(() => criteria.id),
  severity: findingSeverityEnum("severity").notNull(),
  filePath: varchar("file_path", { length: 1024 }),
  /** Structured location within the file (line, column, range). */
  location: jsonb("location"),
  observed: text("observed").notNull(),
  expected: text("expected").notNull(),
  reproduction: text("reproduction"),
  requestedCorrection: text("requested_correction"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const findingsRelations = relations(findings, ({ one }) => ({
  reviewRun: one(reviewRuns, {
    fields: [findings.reviewRunId],
    references: [reviewRuns.id],
  }),
  criterion: one(criteria, {
    fields: [findings.criterionId],
    references: [criteria.id],
  }),
}));

// ── Tool Runs ──────────────────────────────────────────────────────

export const toolRuns = pgTable("tool_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  reviewRunId: uuid("review_run_id")
    .notNull()
    .references(() => reviewRuns.id),
  toolName: varchar("tool_name", { length: 128 }).notNull(),
  command: text("command"),
  exitCode: integer("exit_code"),
  outputSummary: text("output_summary").notNull(),
  durationMs: integer("duration_ms").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const toolRunsRelations = relations(toolRuns, ({ one }) => ({
  reviewRun: one(reviewRuns, {
    fields: [toolRuns.reviewRunId],
    references: [reviewRuns.id],
  }),
}));
