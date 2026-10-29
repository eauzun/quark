/**
 * skills.ts — Skill categories, individual skills, and user qualifications.
 *
 * Categories form a tree (via parent_id). Each category carries its own
 * risk tier and skill requirements. Qualifications track a user's
 * proficiency status per skill with optional cooldowns and expiry.
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
  categoryStatusEnum,
  riskTierEnum,
  skillStatusEnum,
} from "./enums";
import { users } from "./users";

// ── Categories ─────────────────────────────────────────────────────

export const categories = pgTable("categories", {
  id: uuid("id").defaultRandom().primaryKey(),
  slug: varchar("slug", { length: 128 }).notNull().unique(),
  name: varchar("name", { length: 256 }).notNull(),
  status: categoryStatusEnum("status").notNull().default("draft"),
  riskTier: riskTierEnum("risk_tier").notNull().default("standard"),
  /** Self-referencing FK for hierarchical categories. */
  parentId: uuid("parent_id").references((): any => categories.id),
  /** JSON blob describing what qualifications are needed. */
  skillRequirements: jsonb("skill_requirements"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const categoriesRelations = relations(categories, ({ one, many }) => ({
  parent: one(categories, {
    fields: [categories.parentId],
    references: [categories.id],
    relationName: "categoryParent",
  }),
  children: many(categories, { relationName: "categoryParent" }),
  skills: many(skills),
}));

// ── Skills ─────────────────────────────────────────────────────────

export const skills = pgTable("skills", {
  id: uuid("id").defaultRandom().primaryKey(),
  categoryId: uuid("category_id")
    .notNull()
    .references(() => categories.id),
  name: varchar("name", { length: 256 }).notNull(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const skillsRelations = relations(skills, ({ one, many }) => ({
  category: one(categories, {
    fields: [skills.categoryId],
    references: [categories.id],
  }),
  qualifications: many(qualifications),
}));

// ── Qualifications ─────────────────────────────────────────────────

export const qualifications = pgTable("qualifications", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  skillId: uuid("skill_id")
    .notNull()
    .references(() => skills.id),
  status: skillStatusEnum("status").notNull().default("draft"),
  score: integer("score"),
  /** Evidence used to derive the score (e.g. assessment refs). */
  scoreEvidence: jsonb("score_evidence"),
  qualifiedAt: timestamp("qualified_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  cooldownUntil: timestamp("cooldown_until", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const qualificationsRelations = relations(
  qualifications,
  ({ one }) => ({
    user: one(users, {
      fields: [qualifications.userId],
      references: [users.id],
    }),
    skill: one(skills, {
      fields: [qualifications.skillId],
      references: [skills.id],
    }),
  }),
);
