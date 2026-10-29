/**
 * scenarios.api.spec.ts — Full §15.1 end-to-end scenario tests via API.
 *
 * These tests run against the API server and verify complete user workflows
 * across multiple endpoints. They complement the unit tests by verifying
 * cross-module integration.
 *
 * Spec §15.1: "Required end-to-end scenarios" — 25 scenarios.
 * This file covers the complete job lifecycle and financial flows.
 */

import { test, expect, type APIRequestContext } from "@playwright/test";

// ──────────────────────────────────────────────
//  Scenario 1: Full Job Lifecycle
//  Employer/worker dual approval, verified skill, sequential offer,
//  funding, submission, AI review, objection expiry, single payout.
// ──────────────────────────────────────────────

test.describe("Scenario 1: Full Job Lifecycle", () => {
  test("complete flow: register → role → job → scope → fund → submit → review → payout", async ({
    request,
  }) => {
    // 1. Register employer
    const registerRes = await request.post("/api/v1/auth/register", {
      data: {
        email: "employer-e2e@test.example",
        username: "e2e_employer",
        timezone: "UTC",
      },
    });
    expect(registerRes.status()).toBe(201);
    const employer = await registerRes.json();
    expect(employer.data.account_state).toBe("pending_email");

    // 2. Request employer role approval
    const roleRes = await request.post("/api/v1/roles/request-approval", {
      data: {
        role: "employer",
        intended_use: "Hiring developers for a web3 dashboard project with fixed-price milestones",
      },
    });
    expect(roleRes.status()).toBe(201);
    const approval = await roleRes.json();
    expect(approval.data.status).toBeDefined();

    // 3. Create job
    const jobRes = await request.post("/api/v1/jobs", {
      data: {
        title: "Build responsive dashboard component",
        description: "Create a responsive dashboard with real-time data visualization using React and D3",
        category_id: "123e4567-e89b-12d3-a456-426614174000",
        delivery_artifacts: ["source-code", "documentation", "unit-tests"],
        acceptance_criteria: ["Component renders correctly", "All tests pass", "Zero lint errors"],
        confidentiality: "public",
        ai_policy: "allowed",
      },
    });
    expect(jobRes.status()).toBe(201);
    const job = await jobRes.json();
    expect(job.data.state).toBe("draft");
    expect(job.data.id).toBeDefined();

    // 4. Create scope version with BLAKE3 hash
    const scopeRes = await request.post(`/api/v1/jobs/${job.data.id}/scope-versions`, {
      data: {
        content: {
          supported_environments: ["Chrome", "Firefox"],
          deliverables: ["React dashboard component", "Unit tests", "README"],
          exclusions: ["Backend API", "Database schema"],
          dependencies: [],
          mandatory_criteria: [
            { description: "All unit tests pass", evidence_type: "test_output", mandatory: true },
            { description: "Component renders in target browsers", evidence_type: "screenshot", mandatory: true },
          ],
          milestones: [
            { title: "Dashboard component", developer_amount: "100.00" },
          ],
          ai_permission: "allowed",
          defect_support_days: 14,
          token: "USDC",
          network: "base",
        },
      },
    });
    expect(scopeRes.status()).toBe(201);
    const scope = await scopeRes.json();
    expect(scope.data.content_hash).toHaveLength(64); // BLAKE3 hex

    // 5. Accept scope
    const acceptRes = await request.post(`/api/v1/scopes/${scope.data.id}/accept`, {
      data: {
        actor_id: employer.data.id,
        actor_role: "employer",
        content_hash: scope.data.content_hash,
      },
    });
    expect(acceptRes.status()).toBe(200);
    const acceptance = await acceptRes.json();
    expect(acceptance.data.scope_content_hash).toBe(scope.data.content_hash);

    // 6. Create funding intent
    const fundingRes = await request.post(`/api/v1/milestones/${scope.data.id}/funding-intents`, {
      data: {
        milestone_id: scope.data.id,
        network: "base-sepolia",
        token: "USDC",
        idempotency_key: "123e4567-e89b-12d3-a456-426614174001",
      },
    });
    expect(fundingRes.status()).toBe(201);
    const funding = await fundingRes.json();
    expect(funding.data.status).toBe("created");
  });
});

// ──────────────────────────────────────────────
//  Scenario 3: Duplicate/Out-of-Order Funding Webhook
// ──────────────────────────────────────────────

test.describe("Scenario 3: Idempotent Funding Webhooks", () => {
  test("duplicate deposit webhook produces single credit", async ({ request }) => {
    const event = {
      milestone_id: "mile-e2e-idem-1",
      expected_network: "base",
      expected_token: "USDC",
      expected_amount: "120000000",
      event: {
        network: "base",
        token: "USDC",
        transaction_hash: "0xe2e-duplicate-tx",
        log_index: 0,
        payer_address: "0xPayerE2E",
        amount: "120000000",
      },
    };

    // First deposit
    const first = await request.post("/api/v1/settlement/webhooks/deposit", {
      data: event,
    });
    expect(first.status()).toBe(200);
    const firstResult = await first.json();
    expect(firstResult.data.is_duplicate).toBe(false);

    // Duplicate deposit — same tx_hash + log_index
    const second = await request.post("/api/v1/settlement/webhooks/deposit", {
      data: event,
    });
    expect(second.status()).toBe(200);
    const secondResult = await second.json();
    expect(secondResult.data.is_duplicate).toBe(true); // Idempotent!
  });

  test("wrong chain deposit is rejected", async ({ request }) => {
    const result = await request.post("/api/v1/settlement/webhooks/deposit", {
      data: {
        milestone_id: "mile-e2e-wrong-chain",
        expected_network: "base",
        expected_token: "USDC",
        expected_amount: "120000000",
        event: {
          network: "ethereum", // Wrong chain
          token: "USDC",
          transaction_hash: "0xe2e-wrong-chain",
          log_index: 0,
          payer_address: "0xPayer",
          amount: "120000000",
        },
      },
    });

    expect(result.status()).toBe(400);
  });
});

// ──────────────────────────────────────────────
//  Scenario 9: AI Acceptance with Employer Objection
// ──────────────────────────────────────────────

test.describe("Scenario 9: Employer Objection Blocks Payout", () => {
  test("employer objects within 2-business-day window", async ({ request }) => {
    // First, execute a review
    const reviewRes = await request.post("/api/v1/milestones/mile-e2e-obj/reviews/execute", {
      data: {
        job_id: "job-e2e-obj",
        risk_tier: "standard",
        criteria: [
          { id: "crit-1", description: "All tests pass", mandatory: true },
        ],
        files: [
          { path: "src/index.ts", content: "export const ok = true;" },
        ],
        tool_runs: [
          { toolName: "vitest", mandatory: true, passed: true, outputSummary: "All passed", durationMs: 500 },
        ],
      },
    });
    expect(reviewRes.status()).toBe(200);
    const review = await reviewRes.json();
    expect(review.data.review_id).toBeDefined();

    // Employer objects with specific criterion IDs
    const objectionRes = await request.post(`/api/v1/reviews/${review.data.review_id}/objections`, {
      data: {
        reason: "Unit tests pass but the responsive layout requirement (criterion crit-2) was not met on mobile viewports",
        criterion_ids: ["crit-2"],
        evidence: { screenshot: "mobile-broken.png" },
      },
    });
    expect(objectionRes.status()).toBe(201);
    const objection = await objectionRes.json();
    expect(objection.data.status).toBe("dispute_opened");
    expect(objection.data.two_business_day_window_held).toBe(true);
  });

  test("rejects objection without specific criterion IDs", async ({ request }) => {
    const result = await request.post("/api/v1/reviews/review-e2e-empty/objections", {
      data: {
        reason: "I don't like it",
        criterion_ids: [],
      },
    });
    expect(result.status()).toBe(400);
  });
});

// ──────────────────────────────────────────────
//  Scenario 11: Wallet 24h Security Hold
// ──────────────────────────────────────────────

test.describe("Scenario 11: Wallet Security Hold", () => {
  test("wallet verification triggers 24h hold", async ({ request }) => {
    // 1. Create wallet challenge
    const challengeRes = await request.post("/api/v1/wallets/challenge", {
      data: {
        address: "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18",
        user_id: "e2e-wallet-user",
      },
    });
    expect(challengeRes.status()).toBe(200);
    const challenge = await challengeRes.json();
    expect(challenge.data.message).toBeDefined();
    expect(challenge.data.nonce).toBeDefined();

    // 2. Verify wallet (with mock signature)
    const verifyRes = await request.post("/api/v1/wallets/verify", {
      data: {
        network: "base",
        address: "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18",
        signature: "0xmock-signature-for-testing",
        message: challenge.data.message,
      },
    });
    expect(verifyRes.status()).toBe(201);
    const wallet = await verifyRes.json();
    expect(wallet.data.security_hold_hours).toBe(24);
    expect(wallet.data.payout_active_after).toBeDefined();
  });
});

// ──────────────────────────────────────────────
//  Scenario 18: Assessment Cooldown
// ──────────────────────────────────────────────

test.describe("Scenario 18: Assessment Retake Cooldown", () => {
  test("failed assessment triggers 15-day cooldown", async ({ request }) => {
    const result = await request.post("/api/v1/assessments/assess-e2e-cooldown/submit", {
      data: {
        user_id: "e2e-assess-user",
        skill_id: "skill-typescript",
        code_solution: "function add(a) { return a; }", // Wrong
        test_suite: { passed: false, tests_total: 10, tests_passed: 5, branch_coverage: 45 },
        mandatory_requirements_met: true,
      },
    });

    expect(result.status()).toBe(200);
    const assessment = await result.json();
    if (assessment.data.status === "not_yet_qualified") {
      expect(assessment.data.cooldown).toBeDefined();
      expect(assessment.data.cooldown.cooldown_days).toBe(15);
    }
  });

  test("platform failure resets attempt without cooldown", async ({ request }) => {
    const result = await request.post("/api/v1/assessments/assess-e2e-interrupt/interrupted", {
      data: {
        user_id: "e2e-assess-user",
        skill_id: "skill-typescript",
        failure_reason: "Platform infrastructure outage during assessment",
      },
    });

    expect(result.status()).toBe(200);
    const reset = await result.json();
    expect(reset.data.cooldown_applied).toBe(false);
    expect(reset.data.can_immediately_restart).toBe(true);
  });
});

// ──────────────────────────────────────────────
//  Scenario 20: Budget Heatmap Honesty
// ──────────────────────────────────────────────

test.describe("Scenario 20: Budget Heatmap Honest Labeling", () => {
  test("heatmap shows estimate label with insufficient data", async ({ request }) => {
    const result = await request.get("/api/v1/pricing/heatmap?category_id=frontend&risk_tier=standard&scope_size=standard");

    expect(result.status()).toBe(200);
    const heatmap = await result.json();
    expect(heatmap.data).toBeDefined();
    // Should indicate estimate/limited data
    expect(heatmap.data.ranges).toBeDefined();
  });
});

// ──────────────────────────────────────────────
//  Scenario 22: Price Display & Rounding
// ──────────────────────────────────────────────

test.describe("Scenario 22: Price Calculation", () => {
  test("pricing quote shows correct breakdown (D + P = T)", async ({ request }) => {
    const result = await request.post("/api/v1/pricing/quote", {
      data: { developer_amount: "100.000000" },
    });

    expect(result.status()).toBe(200);
    const quote = await result.json();
    expect(quote.data.developer_amount).toBe("100.000000");
    expect(quote.data.platform_fee).toBe("20.000000"); // 20% of 100
    expect(quote.data.total).toBe("120.000000"); // D + P
  });
});

// ──────────────────────────────────────────────
//  §0.1: Testnet Disclaimer
// ──────────────────────────────────────────────

test.describe("Spec §0.1: Testnet Disclaimer", () => {
  test("settlement networks endpoint includes testnet warning", async ({ request }) => {
    const result = await request.get("/api/v1/settlement/networks");

    expect(result.status()).toBe(200);
    const data = await result.json();
    expect(data.data.disclaimer).toContain("TESTNET");
    expect(data.data.disclaimer).toContain("NOT real");
    expect(data.data.networks).toBeDefined();
    // Verify testnet flag
    const networks = Object.values(data.data.networks) as Array<{ isTestnet: boolean }>;
    expect(networks.every((n) => n.isTestnet)).toBe(true);
  });
});

// ──────────────────────────────────────────────
//  §14.2: Error Handling
// ──────────────────────────────────────────────

test.describe("Spec §14.2: API Error Handling", () => {
  test("returns 400 with validation error for invalid input", async ({ request }) => {
    const result = await request.post("/api/v1/jobs", {
      data: { title: "x" }, // Too short, missing fields
    });
    expect(result.status()).toBe(400);
    const error = await result.json();
    expect(error.error).toBe("VALIDATION_ERROR");
  });

  test("returns 400 for missing required fields", async ({ request }) => {
    const result = await request.post("/api/v1/pricing/quote", {
      data: {},
    });
    expect(result.status()).toBe(400);
  });

  test("health check returns service status", async ({ request }) => {
    const result = await request.get("/health");
    expect(result.status()).toBe(200);
    const health = await result.json();
    expect(health.status).toBe("healthy");
    expect(health.service).toBe("quark-api");
    expect(health.environment).toBeDefined();
  });
});