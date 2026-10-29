/**
 * training.ts — Datasets, training data items, and model release provenance.
 * Spec §11 & §14.1
 */
import {
  pgTable,
  uuid,
  varchar,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";
import { jsonb } from "drizzle-orm/pg-core";
import { consentGrants } from "./policy.js";

export const datasets = pgTable("datasets", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  version: varchar("version", { length: 50 }).notNull(),
  description: varchar("description", { length: 500 }),
  licenseInfo: jsonb("license_info").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const datasetItems = pgTable("dataset_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  datasetId: uuid("dataset_id")
    .notNull()
    .references(() => datasets.id),
  sourceType: varchar("source_type", { length: 50 }).notNull(), // 'submission' | 'assessment'
  sourceId: uuid("source_id").notNull(),
  consentGrantId: uuid("consent_grant_id").references(() => consentGrants.id),
  contentHash: varchar("content_hash", { length: 64 }).notNull(),
  rightsVerified: boolean("rights_verified").notNull().default(false),
  secretsScanned: boolean("secrets_scanned").notNull().default(false),
  licenseCompatible: boolean("license_compatible").notNull().default(false),
  deletionStatus: varchar("deletion_status", { length: 30 }).notNull().default("active"), // 'active' | 'pending_deletion' | 'deleted'
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const modelReleases = pgTable("model_releases", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  version: varchar("version", { length: 50 }).notNull(),
  datasetVersions: jsonb("dataset_versions").notNull().default([]),
  evaluationResults: jsonb("evaluation_results").notNull().default({}),
  status: varchar("status", { length: 30 }).notNull().default("training"), // 'training' | 'evaluating' | 'shadow' | 'promoted' | 'retired'
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
