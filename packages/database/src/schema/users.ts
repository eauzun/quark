/**
 * users.ts — User accounts, role approvals, and wallet bindings.
 *
 * A user is the root identity. Roles (employer / worker / reviewer) are
 * granted through an approval flow. Wallets link on-chain addresses for
 * payments and identity verification.
 */
import { relations } from "drizzle-orm";
import {
  boolean,
  jsonb,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { accountStateEnum, roleStatusEnum, roleTypeEnum } from "./enums";

// ── Users ──────────────────────────────────────────────────────────

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  username: varchar("username", { length: 64 }).notNull().unique(),
  email: varchar("email", { length: 320 }).notNull().unique(),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  ageAttestation: boolean("age_attestation").notNull().default(false),
  accountState: accountStateEnum("account_state")
    .notNull()
    .default("pending_email"),
  timezone: varchar("timezone", { length: 64 }).notNull().default("UTC"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const usersRelations = relations(users, ({ many }) => ({
  roleApprovals: many(roleApprovals),
  wallets: many(wallets),
}));

// ── Role Approvals ─────────────────────────────────────────────────

export const roleApprovals = pgTable("role_approvals", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  role: roleTypeEnum("role").notNull(),
  status: roleStatusEnum("status").notNull().default("pending"),
  /** Structured reasons for approval / rejection. */
  reasons: jsonb("reasons"),
  policyVersion: varchar("policy_version", { length: 32 }),
  reviewedBy: uuid("reviewed_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const roleApprovalsRelations = relations(roleApprovals, ({ one }) => ({
  user: one(users, {
    fields: [roleApprovals.userId],
    references: [users.id],
  }),
  reviewer: one(users, {
    fields: [roleApprovals.reviewedBy],
    references: [users.id],
  }),
}));

// ── Wallets ────────────────────────────────────────────────────────

export const wallets = pgTable("wallets", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  network: varchar("network", { length: 32 }).notNull(),
  address: varchar("address", { length: 128 }).notNull(),
  /** Proof payload (signed message, signature, etc.). */
  ownershipProof: jsonb("ownership_proof"),
  activeAfter: timestamp("active_after", { withTimezone: true }),
  isPrimary: boolean("is_primary").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const walletsRelations = relations(wallets, ({ one }) => ({
  user: one(users, {
    fields: [wallets.userId],
    references: [users.id],
  }),
}));
