/**
 * enums.ts — PostgreSQL enum definitions for the Quark platform.
 *
 * Every state machine, classification, and tagged-union discriminator
 * used across the schema is defined here so that column declarations
 * can reference a single source of truth.
 */
import { pgEnum } from "drizzle-orm/pg-core";

// ── User & Identity ────────────────────────────────────────────────

/** Lifecycle state of a user account. */
export const accountStateEnum = pgEnum("account_state", [
  "pending_email",
  "pending_approval",
  "active",
  "restricted",
  "suspended",
  "closed",
]);

/** Top-level roles a user may hold on the platform. */
export const roleTypeEnum = pgEnum("role_type", [
  "employer",
  "worker",
  "reviewer",
]);

/** Approval status for a requested role. */
export const roleStatusEnum = pgEnum("role_status", [
  "pending",
  "approved",
  "rejected",
  "suspended",
]);

/** Role within an organization. */
export const orgRoleEnum = pgEnum("org_role", ["owner", "member"]);

// ── Skills & Qualifications ────────────────────────────────────────

/** Status of a user's qualification for a skill. */
export const skillStatusEnum = pgEnum("skill_status", [
  "draft",
  "qualified",
  "not_yet_qualified",
  "expired",
  "manual_exception",
]);

/** Lifecycle state of a skill category. */
export const categoryStatusEnum = pgEnum("category_status", [
  "draft",
  "evaluation",
  "enabled",
  "paused",
]);

// ── Risk & Compliance ──────────────────────────────────────────────

/** Risk tier assigned to categories and jobs. */
export const riskTierEnum = pgEnum("risk_tier", [
  "low",
  "standard",
  "high",
]);

// ── Jobs & Milestones ──────────────────────────────────────────────

/** State machine for a job. */
export const jobStateEnum = pgEnum("job_state", [
  "draft",
  "scoping",
  "ready",
  "matching",
  "awaiting_funding",
  "active",
  "waiting_for_talent",
  "paused",
  "cancelled",
  "completed",
]);

/** State machine for individual milestones within a job. */
export const milestoneStateEnum = pgEnum("milestone_state", [
  "planned",
  "offer_pending",
  "agreed",
  "funding_pending",
  "funded",
  "in_progress",
  "submitted",
  "reviewing",
  "accepted_pending_objection",
  "payable",
  "paid",
  "blocked",
  "changes_requested",
  "disputed",
  "cancelled",
  "partially_settled",
]);

/** Visibility of a job listing. */
export const jobVisibilityEnum = pgEnum("job_visibility", [
  "public",
  "private",
]);

/** Employer's policy on AI-assisted deliverables. */
export const aiPolicyChoiceEnum = pgEnum("ai_policy_choice", [
  "allowed",
  "forbidden",
  "partial",
]);

// ── Matching & Offers ──────────────────────────────────────────────

/** Status of a work offer sent to a worker. */
export const offerStatusEnum = pgEnum("offer_status", [
  "pending",
  "accepted",
  "declined",
  "expired",
  "cancelled",
]);

// ── Reviews ────────────────────────────────────────────────────────

/** Status of an automated / human review run. */
export const reviewStatusEnum = pgEnum("review_status", [
  "pending",
  "in_progress",
  "accept",
  "changes_requested",
  "inconclusive",
]);

/** Result of evaluating a single criterion. */
export const criterionResultEnum = pgEnum("criterion_result", [
  "pass",
  "fail",
  "unknown",
  "not_applicable",
]);

/** Severity classification for review findings. */
export const findingSeverityEnum = pgEnum("finding_severity", [
  "info",
  "low",
  "medium",
  "high",
  "critical",
]);

// ── Disputes ───────────────────────────────────────────────────────

/** Lifecycle state of a dispute. */
export const disputeStatusEnum = pgEnum("dispute_status", [
  "open",
  "investigating",
  "resolved",
  "escalated",
  "closed",
]);

// ── Ledger & Finance ───────────────────────────────────────────────

/** Status of an on-chain transfer. */
export const transferStatusEnum = pgEnum("transfer_status", [
  "pending",
  "confirming",
  "confirmed",
  "failed",
  "retrying",
]);

// ── Policy & Consent ───────────────────────────────────────────────

/** Purpose for which a user grants data-use consent. */
export const consentPurposeEnum = pgEnum("consent_purpose", [
  "operational_review",
  "model_improvement",
  "training_data",
]);

// ── Notifications ──────────────────────────────────────────────────

/** Delivery channel for a notification. */
export const notificationChannelEnum = pgEnum("notification_channel", [
  "in_app",
  "email",
]);

// ── Assessments ────────────────────────────────────────────────────

/** Type of assessment session. */
export const assessmentSessionTypeEnum = pgEnum("assessment_session_type", [
  "challenge",
  "interview",
  "defense",
]);
