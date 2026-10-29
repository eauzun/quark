/**
 * seed.ts — Clean seed data for development and testing.
 * Spec §15.2: "clean seed/test data."
 * Spec §14: "Local development via reproducible containers; mock email/AI/payments
 * with prominent environment markers."
 *
 * ⚠️ All data is synthetic. No real user data. No real transactions.
 */

import { z } from "zod";

// ──────────────────────────────────────────────
//  Seed Data Schemas
// ──────────────────────────────────────────────

export const SeedUser = z.object({
  id: z.string().uuid(),
  username: z.string(),
  email: z.string().email(),
  accountState: z.enum(["pending_email", "pending_approval", "active", "restricted", "suspended", "closed"]),
  roles: z.array(z.enum(["employer", "worker", "reviewer"])),
  timezone: z.string(),
});

export const SeedCategory = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(["draft", "evaluation", "enabled", "paused"]),
  riskTier: z.enum(["low", "standard", "high"]),
});

export const SeedJob = z.object({
  id: z.string().uuid(),
  title: z.string(),
  categoryId: z.string(),
  employerUserId: z.string().uuid(),
  state: z.enum(["draft", "scoping", "ready", "matching", "awaiting_funding", "active", "completed", "cancelled"]),
  totalAmount: z.string(), // Atomic units as string (bigint)
  token: z.string(),
  network: z.string(),
});

// ──────────────────────────────────────────────
//  Seed Data
// ──────────────────────────────────────────────

export const SEED_USERS = [
  {
    id: "00000000-0000-0000-0000-000000000001",
    username: "alice_employer",
    email: "alice@example.test",
    accountState: "active",
    roles: ["employer"],
    timezone: "UTC",
  },
  {
    id: "00000000-0000-0000-0000-000000000002",
    username: "bob_worker",
    email: "bob@example.test",
    accountState: "active",
    roles: ["worker"],
    timezone: "Europe/London",
  },
  {
    id: "00000000-0000-0000-0000-000000000003",
    username: "carol_reviewer",
    email: "carol@example.test",
    accountState: "active",
    roles: ["reviewer"],
    timezone: "America/New_York",
  },
  {
    id: "00000000-0000-0000-0000-000000000004",
    username: "dave_dual",
    email: "dave@example.test",
    accountState: "active",
    roles: ["employer", "worker"],
    timezone: "Asia/Tokyo",
  },
] as const;

export const SEED_CATEGORIES = [
  { id: "frontend", name: "Frontend Development", status: "enabled", riskTier: "low" },
  { id: "backend", name: "Backend Development", status: "enabled", riskTier: "standard" },
  { id: "smart-contracts", name: "Smart Contracts", status: "evaluation", riskTier: "high" },
  { id: "docs", name: "Documentation", status: "enabled", riskTier: "low" },
  { id: "tests-bugs", name: "Tests & Bug Fixes", status: "enabled", riskTier: "low" },
  { id: "devops", name: "DevOps", status: "evaluation", riskTier: "high" },
  { id: "audit", name: "Security Audit", status: "draft", riskTier: "high" },
  { id: "indexers", name: "Indexers", status: "draft", riskTier: "standard" },
  { id: "wallet-login-sdk", name: "Wallet/SDK", status: "evaluation", riskTier: "high" },
  { id: "design-content-community", name: "Design & Content", status: "draft", riskTier: "low" },
] as const;

export const SEED_JOBS = [
  {
    id: "10000000-0000-0000-0000-000000000001",
    title: "Build responsive dashboard component",
    categoryId: "frontend",
    employerUserId: "00000000-0000-0000-0000-000000000001",
    state: "draft",
    totalAmount: "120000000", // 120 USDC (atomic units, 6 decimals)
    token: "USDC",
    network: "base-sepolia",
  },
  {
    id: "10000000-0000-0000-0000-000000000002",
    title: "Write API documentation for REST endpoints",
    categoryId: "docs",
    employerUserId: "00000000-0000-0000-0000-000000000001",
    state: "draft",
    totalAmount: "60000000", // 60 USDC
    token: "USDC",
    network: "base-sepolia",
  },
] as const;

// ──────────────────────────────────────────────
//  Seed Runner
// ──────────────────────────────────────────────

export interface SeedResult {
  users: number;
  categories: number;
  jobs: number;
  isMockData: true;
  environmentBanner: string;
}

/**
 * Returns seed data for local/test environments.
 * Spec §0.1: "Never label simulated balances, synthetic market data, mock
 * reviews or testnet transactions as real."
 */
export function getSeedData(): SeedResult {
  return {
    users: SEED_USERS.length,
    categories: SEED_CATEGORIES.length,
    jobs: SEED_JOBS.length,
    isMockData: true,
    environmentBanner: "🌱 SEED DATA — All records are synthetic. No real transactions.",
  };
}

/**
 * Validates that seed data conforms to schemas.
 */
export function validateSeedData(): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];

  for (const user of SEED_USERS) {
    const result = SeedUser.safeParse(user);
    if (!result.success) {
      errors.push(`User ${user.username}: ${result.error.message}`);
    }
  }

  for (const cat of SEED_CATEGORIES) {
    const result = SeedCategory.safeParse(cat);
    if (!result.success) {
      errors.push(`Category ${cat.id}: ${result.error.message}`);
    }
  }

  for (const job of SEED_JOBS) {
    const result = SeedJob.safeParse(job);
    if (!result.success) {
      errors.push(`Job ${job.title}: ${result.error.message}`);
    }
  }

  return { isValid: errors.length === 0, errors };
}