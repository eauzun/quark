/**
 * assessments.ts — Assessment templates, sessions, and recordings.
 *
 * Assessment templates define the prompt, reference solution, and test
 * suite for a given category/skill combination. Assessment sessions
 * track a user's attempt and outcome. Recordings capture screen,
 * audio, and video with mandatory encryption and retention policies.
 */
import { relations } from "drizzle-orm";
import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { assessmentSessionTypeEnum } from "./enums";
import { users } from "./users";
import { categories } from "./skills";
import { skills } from "./skills";

// ── Assessment Templates ───────────────────────────────────────────

export const assessmentTemplates = pgTable("assessment_templates", {
  id: uuid("id").defaultRandom().primaryKey(),
  categoryId: uuid("category_id")
    .notNull()
    .references(() => categories.id),
  skillId: uuid("skill_id")
    .notNull()
    .references(() => skills.id),
  promptArtifact: text("prompt_artifact").notNull(),
  referenceSolution: text("reference_solution"),
  testSuite: text("test_suite"),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const assessmentTemplatesRelations = relations(
  assessmentTemplates,
  ({ one, many }) => ({
    category: one(categories, {
      fields: [assessmentTemplates.categoryId],
      references: [categories.id],
    }),
    skill: one(skills, {
      fields: [assessmentTemplates.skillId],
      references: [skills.id],
    }),
    assessments: many(assessments),
  }),
);

// ── Assessments (Sessions) ─────────────────────────────────────────

export const assessments = pgTable("assessments", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  templateId: uuid("template_id")
    .notNull()
    .references(() => assessmentTemplates.id),
  sessionType: assessmentSessionTypeEnum("session_type").notNull(),
  status: varchar("status", { length: 32 }).notNull().default("pending"),
  score: integer("score"),
  /** Rubric-level breakdown of the score. */
  scoreBreakdown: jsonb("score_breakdown"),
  result: varchar("result", { length: 32 }),
  recordingConsent: boolean("recording_consent").notNull().default(false),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  cooldownExpiresAt: timestamp("cooldown_expires_at", {
    withTimezone: true,
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const assessmentsRelations = relations(
  assessments,
  ({ one, many }) => ({
    user: one(users, {
      fields: [assessments.userId],
      references: [users.id],
    }),
    template: one(assessmentTemplates, {
      fields: [assessments.templateId],
      references: [assessmentTemplates.id],
    }),
    recordings: many(assessmentRecordings),
  }),
);

// ── Assessment Recordings ──────────────────────────────────────────

export const assessmentRecordings = pgTable("assessment_recordings", {
  id: uuid("id").defaultRandom().primaryKey(),
  assessmentId: uuid("assessment_id")
    .notNull()
    .references(() => assessments.id),
  /** Type of media captured: 'screen', 'audio', 'video'. */
  mediaType: varchar("media_type", { length: 16 }).notNull(),
  storagePath: varchar("storage_path", { length: 1024 }).notNull(),
  encrypted: boolean("encrypted").notNull().default(true),
  retentionExpiresAt: timestamp("retention_expires_at", {
    withTimezone: true,
  }),
  /** Whether retention was extended due to an active dispute. */
  disputeExtension: boolean("dispute_extension").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const assessmentRecordingsRelations = relations(
  assessmentRecordings,
  ({ one }) => ({
    assessment: one(assessments, {
      fields: [assessmentRecordings.assessmentId],
      references: [assessments.id],
    }),
  }),
);
