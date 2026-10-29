import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit configuration — Quark database schema management.
 * Spec §18.5: "Add migrations and tests with each meaningful workflow."
 * Spec §15.2: "Documented migrations."
 */
export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./src/migrations",
  dialect: "postgresql",
  dbCredentials: {
    // Supabase Free (ADR-002) — never commit real credentials
    url: process.env.DATABASE_URL || "postgresql://quark:quark@localhost:5432/quark",
  },
  verbose: true,
  strict: false,
});