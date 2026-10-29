/**
 * jobs.ts — Jobs, scope versions, scope acceptances, criteria, and milestones.
 *
 * A job belongs to an employer (and optionally an organization) within a
 * category. Scope is versioned and immutable; both parties must accept a
 * version before work proceeds. Milestones break a job into fundable
 * and deliverable units with their own state machines.
 */
import { relations } from "drizzle-orm";
import {
  bigint,
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import {
  aiPolicyChoiceEnum,
  jobStateEnum,
  jobVisibilityEnum,
  milestoneStateEnum,
  riskTierEnum,
} from "./enums";
import { users } from "./users";
import { organizations } from "./organizations";
import { categories } from "./skills";

// ── Jobs ───────────────────────────────────────────────────────────

export const jobs = pgTable("jobs", {
  id: uuid("id").defaultRandom().primaryKey(),
  employerId: uuid("employer_id")
    .notNull()
    .references(() => users.id),
  organizationId: uuid("organization_id").references(() => organizations.id),
  categoryId: uuid("category_id")
    .notNull()
    .references(() => categories.id),
  title: varchar("title", { length: 512 }).notNull(),
  description: text("description"),
  riskTier: riskTierEnum("risk_tier").notNull().default("standard"),
  visibility: jobVisibilityEnum("visibility").notNull().default("public"),
  aiPolicy: aiPolicyChoiceEnum("ai_policy").notNull().default("allowed"),
  state: jobStateEnum("state").notNull().default("draft"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const jobsRelations = relations(jobs, ({ one, many }) => ({
  employer: one(users, {
    fields: [jobs.employerId],
    references: [users.id],
  }),
  organization: one(organizations, {
    fields: [jobs.organizationId],
    references: [organizations.id],
  }),
  category: one(categories, {
    fields: [jobs.categoryId],
    references: [categories.id],
  }),
  scopeVersions: many(scopeVersions),
  milestones: many(milestones),
}));

// ── Scope Versions (immutable) ─────────────────────────────────────

export const scopeVersions = pgTable("scope_versions", {
  id: uuid("id").defaultRandom().primaryKey(),
  jobId: uuid("job_id")
    .notNull()
    .references(() => jobs.id),
  version: integer("version").notNull(),
  /** Full scope content — immutable after creation. */
  content: jsonb("content").notNull(),
  contentHash: varchar("content_hash", { length: 64 }).notNull(),
  policyVersion: varchar("policy_version", { length: 32 }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const scopeVersionsRelations = relations(
  scopeVersions,
  ({ one, many }) => ({
    job: one(jobs, {
      fields: [scopeVersions.jobId],
      references: [jobs.id],
    }),
    acceptances: many(scopeAcceptances),
    criteria: many(criteria),
  }),
);

// ── Scope Acceptances ──────────────────────────────────────────────

export const scopeAcceptances = pgTable("scope_acceptances", {
  id: uuid("id").defaultRandom().primaryKey(),
  scopeVersionId: uuid("scope_version_id")
    .notNull()
    .references(() => scopeVersions.id),
  actorId: uuid("actor_id")
    .notNull()
    .references(() => users.id),
  actorRole: varchar("actor_role", { length: 16 }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const scopeAcceptancesRelations = relations(
  scopeAcceptances,
  ({ one }) => ({
    scopeVersion: one(scopeVersions, {
      fields: [scopeAcceptances.scopeVersionId],
      references: [scopeVersions.id],
    }),
    actor: one(users, {
      fields: [scopeAcceptances.actorId],
      references: [users.id],
    }),
  }),
);

// ── Criteria ───────────────────────────────────────────────────────

export const criteria = pgTable("criteria", {
  id: uuid("id").defaultRandom().primaryKey(),
  scopeVersionId: uuid("scope_version_id")
    .notNull()
    .references(() => scopeVersions.id),
  description: text("description").notNull(),
  mandatory: boolean("mandatory").notNull().default(true),
  evidenceType: varchar("evidence_type", { length: 64 }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const criteriaRelations = relations(criteria, ({ one }) => ({
  scopeVersion: one(scopeVersions, {
    fields: [criteria.scopeVersionId],
    references: [scopeVersions.id],
  }),
}));

// ── Milestones ─────────────────────────────────────────────────────

export const milestones = pgTable("milestones", {
  id: uuid("id").defaultRandom().primaryKey(),
  jobId: uuid("job_id")
    .notNull()
    .references(() => jobs.id),
  scopeVersionId: uuid("scope_version_id").references(() => scopeVersions.id),
  orderIndex: integer("order_index").notNull(),
  title: varchar("title", { length: 512 }).notNull(),

  /** All monetary amounts are stored as atomic integer units (e.g. wei, lamports). */
  developerAmount: bigint("developer_amount", { mode: "bigint" }).notNull(),
  platformFee: bigint("platform_fee", { mode: "bigint" }).notNull(),
  totalAmount: bigint("total_amount", { mode: "bigint" }).notNull(),
  surchargeAmount: bigint("surcharge_amount", { mode: "bigint" })
    .notNull()
    .default(BigInt(0)),

  token: varchar("token", { length: 64 }).notNull(),
  network: varchar("network", { length: 32 }).notNull(),
  deadline: timestamp("deadline", { withTimezone: true }),
  state: milestoneStateEnum("state").notNull().default("planned"),
  policyVersion: varchar("policy_version", { length: 32 }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const milestonesRelations = relations(milestones, ({ one }) => ({
  job: one(jobs, {
    fields: [milestones.jobId],
    references: [jobs.id],
  }),
  scopeVersion: one(scopeVersions, {
    fields: [milestones.scopeVersionId],
    references: [scopeVersions.id],
  }),
}));
