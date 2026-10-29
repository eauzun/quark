/**
 * audit.ts — Append-only audit log for sensitive system and financial actions.
 * Spec §14.1
 */
import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { jsonb } from "drizzle-orm/pg-core";
import { users } from "./users.js";

export const auditEvents = pgTable("audit_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  actorId: uuid("actor_id").references(() => users.id),
  actorType: varchar("actor_type", { length: 20 }).notNull(), // 'user' | 'system' | 'ai'
  action: varchar("action", { length: 100 }).notNull(),
  targetType: varchar("target_type", { length: 50 }).notNull(),
  targetId: uuid("target_id"),
  reason: text("reason"),
  correlationId: uuid("correlation_id"),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
