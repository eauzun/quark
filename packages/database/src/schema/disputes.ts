/**
 * disputes.ts — Disputes and arbitration records.
 * Spec §8 — Appeals, reviewers, and conduct.
 */
import {
  pgTable,
  uuid,
  text,
  varchar,
  bigint,
  timestamp,
} from "drizzle-orm/pg-core";
import { jsonb } from "drizzle-orm/pg-core";
import { disputeStatusEnum } from "./enums.js";
import { users } from "./users.js";
import { milestones } from "./jobs.js";

export const disputes = pgTable("disputes", {
  id: uuid("id").defaultRandom().primaryKey(),
  milestoneId: uuid("milestone_id")
    .notNull()
    .references(() => milestones.id),
  initiatorId: uuid("initiator_id")
    .notNull()
    .references(() => users.id),
  initiatorRole: varchar("initiator_role", { length: 20 }).notNull(), // 'employer' | 'worker'
  status: disputeStatusEnum("status").notNull().default("open"),
  reason: text("reason").notNull(),
  evidence: jsonb("evidence").notNull().default({}),
  disputedAmount: bigint("disputed_amount", { mode: "bigint" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const disputeDecisions = pgTable("dispute_decisions", {
  id: uuid("id").defaultRandom().primaryKey(),
  disputeId: uuid("dispute_id")
    .notNull()
    .references(() => disputes.id),
  reviewerId: uuid("reviewer_id").references(() => users.id),
  decision: varchar("decision", { length: 30 }).notNull(), // 'upheld' | 'rejected' | 'partial' | 'settled'
  reasoning: text("reasoning").notNull(),
  awardWorker: bigint("award_worker", { mode: "bigint" }),
  awardEmployerRefund: bigint("award_employer_refund", { mode: "bigint" }),
  scopeHashAtDecision: varchar("scope_hash_at_decision", { length: 64 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
