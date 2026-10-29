/**
 * ledger.ts — Double-entry accounting, funding intents, chain events, and transfers.
 * Spec §9.3 & §14.1
 */
import {
  pgTable,
  uuid,
  varchar,
  integer,
  bigint,
  boolean,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { jsonb } from "drizzle-orm/pg-core";
import { transferStatusEnum } from "./enums.js";
import { users } from "./users.js";
import { milestones } from "./jobs.js";

export const fundingIntents = pgTable("funding_intents", {
  id: uuid("id").defaultRandom().primaryKey(),
  milestoneId: uuid("milestone_id")
    .notNull()
    .references(() => milestones.id),
  payerId: uuid("payer_id")
    .notNull()
    .references(() => users.id),
  network: varchar("network", { length: 50 }).notNull(),
  token: varchar("token", { length: 20 }).notNull(),
  expectedAmount: bigint("expected_amount", { mode: "bigint" }).notNull(),
  recipientAddress: varchar("recipient_address", { length: 128 }).notNull(),
  status: varchar("status", { length: 30 }).notNull().default("created"), // 'created' | 'detected' | 'confirmed' | 'failed' | 'expired'
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const chainEvents = pgTable(
  "chain_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    network: varchar("network", { length: 50 }).notNull(),
    transactionHash: varchar("transaction_hash", { length: 128 }).notNull(),
    logIndex: integer("log_index").notNull(),
    eventType: varchar("event_type", { length: 100 }).notNull(),
    data: jsonb("data").notNull().default({}),
    processed: boolean("processed").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("chain_events_net_tx_idx").on(
      table.network,
      table.transactionHash,
      table.logIndex
    ),
  ]
);

export const journals = pgTable("journals", {
  id: uuid("id").defaultRandom().primaryKey(),
  referenceType: varchar("reference_type", { length: 50 }).notNull(),
  referenceId: uuid("reference_id").notNull(),
  description: text("description").notNull(),
  idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const journalLines = pgTable("journal_lines", {
  id: uuid("id").defaultRandom().primaryKey(),
  journalId: uuid("journal_id")
    .notNull()
    .references(() => journals.id),
  accountType: varchar("account_type", { length: 50 }).notNull(), // 'settlement_asset' | 'held_employer_liability' | 'worker_payable' | 'platform_revenue' | 'refund_payable'
  accountId: varchar("account_id", { length: 128 }),
  network: varchar("network", { length: 50 }).notNull(),
  token: varchar("token", { length: 20 }).notNull(),
  debit: bigint("debit", { mode: "bigint" }).notNull().default(0n),
  credit: bigint("credit", { mode: "bigint" }).notNull().default(0n),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const transfers = pgTable("transfers", {
  id: uuid("id").defaultRandom().primaryKey(),
  milestoneId: uuid("milestone_id").references(() => milestones.id),
  recipientId: uuid("recipient_id")
    .notNull()
    .references(() => users.id),
  recipientAddress: varchar("recipient_address", { length: 128 }).notNull(),
  network: varchar("network", { length: 50 }).notNull(),
  token: varchar("token", { length: 20 }).notNull(),
  amount: bigint("amount", { mode: "bigint" }).notNull(),
  authorizationHash: varchar("authorization_hash", { length: 128 }).notNull(),
  nonce: varchar("nonce", { length: 128 }).notNull().unique(),
  status: transferStatusEnum("status").notNull().default("pending"),
  initiatedAt: timestamp("initiated_at", { withTimezone: true }),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const refunds = pgTable("refunds", {
  id: uuid("id").defaultRandom().primaryKey(),
  milestoneId: uuid("milestone_id")
    .notNull()
    .references(() => milestones.id),
  recipientId: uuid("recipient_id")
    .notNull()
    .references(() => users.id),
  amount: bigint("amount", { mode: "bigint" }).notNull(),
  network: varchar("network", { length: 50 }).notNull(),
  token: varchar("token", { length: 20 }).notNull(),
  reason: text("reason").notNull(),
  status: transferStatusEnum("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
