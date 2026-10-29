/**
 * matching.ts — Availability, offers, assignments, and offer history.
 *
 * Workers declare availability windows and capacity. The matching engine
 * generates offers that are sent to workers with an expiry window.
 * Assignments lock a worker to a milestone once an offer is accepted.
 * Offer history powers the priority/penalty system for unresponsive workers.
 */
import { relations, sql } from "drizzle-orm";
import {
  bigint,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { aiPolicyChoiceEnum, offerStatusEnum } from "./enums";
import { users } from "./users";
import { milestones, scopeVersions } from "./jobs";

// ── Availability ───────────────────────────────────────────────────

export const availability = pgTable("availability", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  status: varchar("status", { length: 16 }).notNull().default("available"),
  /** JSON array of time-window objects describing working hours. */
  windows: jsonb("windows"),
  capacitySlots: integer("capacity_slots").notNull().default(1),
  maxCapacity: integer("max_capacity").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const availabilityRelations = relations(availability, ({ one }) => ({
  user: one(users, {
    fields: [availability.userId],
    references: [users.id],
  }),
}));

// ── Offers ─────────────────────────────────────────────────────────

export const offers = pgTable(
  "offers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workerId: uuid("worker_id")
      .notNull()
      .references(() => users.id),
    milestoneId: uuid("milestone_id")
      .notNull()
      .references(() => milestones.id),
    developerAmount: bigint("developer_amount", { mode: "bigint" }).notNull(),
    token: varchar("token", { length: 64 }).notNull(),
    network: varchar("network", { length: 32 }).notNull(),
    deadline: timestamp("deadline", { withTimezone: true }),
    aiPolicy: aiPolicyChoiceEnum("ai_policy").notNull().default("allowed"),
    scopeVersionId: uuid("scope_version_id")
      .notNull()
      .references(() => scopeVersions.id),
    status: offerStatusEnum("status").notNull().default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    offeredAt: timestamp("offered_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    declineReason: text("decline_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    /**
     * Ensures at most one pending offer exists per milestone.
     * This acts as a "single live lease" — only one offer can be
     * outstanding at a time for a given milestone.
     */
    singlePendingOffer: uniqueIndex("offers_single_pending_idx")
      .on(table.milestoneId)
      .where(sql`${table.status} = 'pending'`),
  }),
);

export const offersRelations = relations(offers, ({ one }) => ({
  worker: one(users, {
    fields: [offers.workerId],
    references: [users.id],
  }),
  milestone: one(milestones, {
    fields: [offers.milestoneId],
    references: [milestones.id],
  }),
  scopeVersion: one(scopeVersions, {
    fields: [offers.scopeVersionId],
    references: [scopeVersions.id],
  }),
}));

// ── Assignments ────────────────────────────────────────────────────

export const assignments = pgTable("assignments", {
  id: uuid("id").defaultRandom().primaryKey(),
  workerId: uuid("worker_id")
    .notNull()
    .references(() => users.id),
  milestoneId: uuid("milestone_id")
    .notNull()
    .references(() => milestones.id),
  offerId: uuid("offer_id")
    .notNull()
    .references(() => offers.id),
  /** Hash of the scope snapshot at assignment time for auditability. */
  scopeSnapshotHash: varchar("scope_snapshot_hash", { length: 64 }).notNull(),
  capacitySlot: integer("capacity_slot").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const assignmentsRelations = relations(assignments, ({ one }) => ({
  worker: one(users, {
    fields: [assignments.workerId],
    references: [users.id],
  }),
  milestone: one(milestones, {
    fields: [assignments.milestoneId],
    references: [milestones.id],
  }),
  offer: one(offers, {
    fields: [assignments.offerId],
    references: [offers.id],
  }),
}));

// ── Offer History ──────────────────────────────────────────────────

export const offerHistory = pgTable("offer_history", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  /** Rolling count of unanswered offers in the last 30 days. */
  unansweredCount30d: integer("unanswered_count_30d").notNull().default(0),
  consecutiveUnanswered: integer("consecutive_unanswered")
    .notNull()
    .default(0),
  /** If set, the worker's matching priority is reduced until this time. */
  priorityPenaltyUntil: timestamp("priority_penalty_until", {
    withTimezone: true,
  }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const offerHistoryRelations = relations(offerHistory, ({ one }) => ({
  user: one(users, {
    fields: [offerHistory.userId],
    references: [users.id],
  }),
}));
