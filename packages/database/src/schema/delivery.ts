/**
 * delivery.ts — Submissions, blockers, change requests, and messages.
 *
 * Submissions are immutable records of delivered work.
 * Blockers pause milestone progress. Change requests propose scope
 * adjustments. Messages enable communication within a job context.
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
import { users } from "./users";
import { jobs, milestones } from "./jobs";

// ── Submissions (immutable) ────────────────────────────────────────

export const submissions = pgTable("submissions", {
  id: uuid("id").defaultRandom().primaryKey(),
  milestoneId: uuid("milestone_id")
    .notNull()
    .references(() => milestones.id),
  version: integer("version").notNull(),
  commitHash: varchar("commit_hash", { length: 128 }),
  archiveHash: varchar("archive_hash", { length: 128 }),
  /** Manifest listing all evidence files and their hashes. */
  evidenceManifest: jsonb("evidence_manifest"),
  storagePath: varchar("storage_path", { length: 1024 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const submissionsRelations = relations(submissions, ({ one }) => ({
  milestone: one(milestones, {
    fields: [submissions.milestoneId],
    references: [milestones.id],
  }),
}));

// ── Blockers ───────────────────────────────────────────────────────

export const blockers = pgTable("blockers", {
  id: uuid("id").defaultRandom().primaryKey(),
  milestoneId: uuid("milestone_id")
    .notNull()
    .references(() => milestones.id),
  reporterId: uuid("reporter_id")
    .notNull()
    .references(() => users.id),
  description: text("description").notNull(),
  evidence: jsonb("evidence"),
  pausedAt: timestamp("paused_at", { withTimezone: true }),
  resumedAt: timestamp("resumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const blockersRelations = relations(blockers, ({ one }) => ({
  milestone: one(milestones, {
    fields: [blockers.milestoneId],
    references: [milestones.id],
  }),
  reporter: one(users, {
    fields: [blockers.reporterId],
    references: [users.id],
  }),
}));

// ── Change Requests ────────────────────────────────────────────────

export const changeRequests = pgTable("change_requests", {
  id: uuid("id").defaultRandom().primaryKey(),
  milestoneId: uuid("milestone_id")
    .notNull()
    .references(() => milestones.id),
  requesterId: uuid("requester_id")
    .notNull()
    .references(() => users.id),
  description: text("description").notNull(),
  /** JSON diff describing proposed scope changes. */
  scopeDiff: jsonb("scope_diff"),
  status: varchar("status", { length: 16 }).notNull().default("proposed"),
  acceptedBy: uuid("accepted_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const changeRequestsRelations = relations(
  changeRequests,
  ({ one }) => ({
    milestone: one(milestones, {
      fields: [changeRequests.milestoneId],
      references: [milestones.id],
    }),
    requester: one(users, {
      fields: [changeRequests.requesterId],
      references: [users.id],
    }),
    acceptor: one(users, {
      fields: [changeRequests.acceptedBy],
      references: [users.id],
    }),
  }),
);

// ── Messages (immutable) ──────────────────────────────────────────

export const messages = pgTable("messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  jobId: uuid("job_id")
    .notNull()
    .references(() => jobs.id),
  senderId: uuid("sender_id")
    .notNull()
    .references(() => users.id),
  content: text("content").notNull(),
  /** References to external attachments (object storage keys, etc.). */
  attachmentRefs: jsonb("attachment_refs"),
  scanStatus: varchar("scan_status", { length: 16 })
    .notNull()
    .default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const messagesRelations = relations(messages, ({ one }) => ({
  job: one(jobs, {
    fields: [messages.jobId],
    references: [jobs.id],
  }),
  sender: one(users, {
    fields: [messages.senderId],
    references: [users.id],
  }),
}));
