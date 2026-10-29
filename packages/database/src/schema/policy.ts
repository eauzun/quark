/**
 * policy.ts — Platform policy versions and consent grants.
 * Spec §11 & §14.1
 */
import {
  pgTable,
  uuid,
  varchar,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";
import { jsonb } from "drizzle-orm/pg-core";
import { consentPurposeEnum } from "./enums.js";
import { users } from "./users.js";

export const policyVersions = pgTable("policy_versions", {
  id: uuid("id").defaultRandom().primaryKey(),
  type: varchar("type", { length: 50 }).notNull(), // 'fee' | 'review' | 'retry' | 'retention' | 'threshold'
  version: integer("version").notNull(),
  content: jsonb("content").notNull(),
  effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const consentGrants = pgTable("consent_grants", {
  id: uuid("id").defaultRandom().primaryKey(),
  actorId: uuid("actor_id")
    .notNull()
    .references(() => users.id),
  purpose: consentPurposeEnum("purpose").notNull(),
  artifactScope: jsonb("artifact_scope"),
  grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  policyVersion: integer("policy_version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
