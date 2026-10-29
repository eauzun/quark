import { describe, it, expect } from "vitest";
import { app } from "../src/index.js";

describe("API Server Tests (Spec §14.2)", () => {
  it("responds to /health with healthy status", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("healthy");
    expect(json.service).toBe("quark-api");
  });

  it("calculates transparent pricing breakdown with 20% platform fee", async () => {
    const res = await app.request("/api/v1/pricing/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ developer_amount: "100.00" }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.developer_amount).toBe("100");
    expect(json.platform_fee).toBe("20");
    expect(json.total).toBe("120");
    expect(json.effective_fee_rate).toBe("20.00%");
  });

  it("creates a job draft matching Zod schema", async () => {
    const res = await app.request("/api/v1/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Build ERC-20 staking contract tests",
        description: "Need comprehensive fuzzing and unit tests using Foundry.",
        category_id: "00000000-0000-0000-0000-000000000001",
        delivery_artifacts: ["test/Staking.t.sol", "report.md"],
        acceptance_criteria: [
          "100% branch coverage on deposit and withdraw functions",
          "Foundry test suite passes with 0 failures",
        ],
        ai_policy: "allowed",
        confidentiality: "public",
      }),
    });

    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data.state).toBe("draft");
    expect(json.data.title).toBe("Build ERC-20 staking contract tests");
  });

  it("creates an immutable scope version with 64-character BLAKE3 hash", async () => {
    const jobId = "00000000-0000-0000-0000-000000000001";
    const res = await app.request(`/api/v1/jobs/${jobId}/scope-versions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: {
          supported_environments: ["Base Sepolia", "Node 20"],
          deliverables: ["src/Staking.sol"],
          mandatory_criteria: [
            {
              description: "100% test coverage",
              evidence_type: "coverage_report",
              mandatory: true,
            },
          ],
          milestones: [
            {
              title: "Milestone 1",
              developer_amount: "100.00",
            },
          ],
          ai_permission: "allowed",
          defect_support_days: 14,
          token: "USDC",
          network: "base",
        },
      }),
    });

    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data.content_hash).toMatch(/^[0-9a-f]{64}$/); // BLAKE3 256-bit hash
    expect(json.data.version).toBe(1);
  });

  it("serves budget heatmap with honest estimate label when sample < 30", async () => {
    const res = await app.request("/api/v1/pricing/heatmap?category_id=smart-contracts&risk_tier=standard&scope_size=standard");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.isReliableObservedData).toBe(false);
    expect(json.data.label).toBe("Estimated range — limited Quark data");
    expect(json.data.ranges.suggested.min).toBeDefined();
  });

  it("processes settlement deposit webhook with idempotency and double-entry tracking", async () => {
    const depositPayload = {
      milestone_id: "00000000-0000-0000-0000-000000000002",
      expected_network: "base",
      expected_token: "USDC",
      expected_amount: "120000000",
      event: {
        network: "base",
        token: "USDC",
        transaction_hash: "0xtx_api_deposit_1",
        log_index: 0,
        payer_address: "0xpayer_api",
        amount: "120000000",
      },
    };

    // 1. Initial deposit
    const res1 = await app.request("/api/v1/settlement/webhooks/deposit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(depositPayload),
    });
    expect(res1.status).toBe(200);
    const json1 = await res1.json();
    expect(json1.data.status).toBe("processed");
    expect(json1.data.is_duplicate).toBe(false);

    // 2. Duplicate webhook -> idempotency
    const res2 = await app.request("/api/v1/settlement/webhooks/deposit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(depositPayload),
    });
    expect(res2.status).toBe(200);
    const json2 = await res2.json();
    expect(json2.data.is_duplicate).toBe(true);

    // 3. Reject wrong token
    const wrongTokenRes = await app.request("/api/v1/settlement/webhooks/deposit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...depositPayload,
        event: {
          ...depositPayload.event,
          transaction_hash: "0xtx_wrong",
          token: "SHIB",
        },
      }),
    });
    expect(wrongTokenRes.status).toBe(400);

    // 4. Reconcile ledger
    const reconRes = await app.request("/api/v1/ledger/reconciliation");
    expect(reconRes.status).toBe(200);
    const reconJson = await reconRes.json();
    expect(reconJson.data.is_balanced).toBe(true);
    expect(reconJson.data.discrepancy).toBe("0");
    expect(reconJson.data.balances.settlement_asset).toBe("120000000");
  });

  it("executes automated AI review pipeline and returns acceptance recommendation", async () => {
    const milestoneId = "00000000-0000-0000-0000-000000000002";
    const res = await app.request(`/api/v1/milestones/${milestoneId}/reviews/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        submission_hash: "0xblake3_clean_sub_hash",
        risk_tier: "standard",
        criteria: [
          { id: "crit-staking", description: "Deposit function branch coverage", mandatory: true },
        ],
        files: [
          { path: "src/Staking.sol", content: "contract Staking { function deposit() external {} }" },
        ],
        tool_runs: [
          {
            toolName: "forge test",
            mandatory: true,
            passed: true,
            outputSummary: "All tests passed",
            durationMs: 1500,
          },
        ],
      }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.recommended_state).toBe("accepted_pending_objection");
    expect(json.data.models_used.primary).toBe("gemini-flash");
    expect(json.data.models_used.adversarial).toBe("groq-llama-70b");
  });

  it("handles employer objection within 2-business-day window (Spec §7.2 & §15.1 Scenario 9)", async () => {
    const reviewId = "00000000-0000-0000-0000-000000000088";
    const res = await app.request(`/api/v1/reviews/${reviewId}/objections`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        criterion_ids: ["crit-staking"],
        reason: "Contract does not emit Staked event on deposit as explicitly required in scope.",
        evidence: { log_analysis: "no Staked event log emitted in tx 0x123" },
      }),
    });

    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data.status).toBe("dispute_opened");
    expect(json.data.two_business_day_window_held).toBe(true);
  });

  it("initiates skill assessment with 30-day encrypted recording retention", async () => {
    const res = await app.request("/api/v1/assessments/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: "00000000-0000-0000-0000-000000000099",
        skill_id: "skill-foundry-solidity",
        is_accessibility_mode: true,
      }),
    });

    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data.status).toBe("in_progress");
    expect(json.data.is_accessibility_mode).toBe(true);
    expect(json.data.recording_retention_days).toBe(30);
    expect(json.data.ai_assistance_forbidden).toBe(true);
  });

  it("submits assessment and calculates qualification status", async () => {
    const res = await app.request("/api/v1/assessments/00000000-0000-0000-0000-000000000099/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: "00000000-0000-0000-0000-000000000099",
        skill_id: "skill-foundry-solidity",
        is_accessibility_mode: true,
        test_suite: {
          passed: true,
          tests_total: 10,
          tests_passed: 10,
          branch_coverage: 100,
        },
        responses: [
          {
            promptId: "foundry-fuzzing",
            response:
              "Fuzz testing tests properties rather than specific inputs. Invariants must hold across thousands of pseudo-random runs to catch edge-case re-entrancy bugs.",
          },
        ],
        mandatory_requirements_met: true,
      }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.status).toBe("qualified");
    expect(json.data.totalScore).toBeGreaterThanOrEqual(80);
    expect(json.data.cooldown).toBeNull();
  });

  it("resets assessment attempt on platform failure without cooldown (Spec §15.1 Scenario 18)", async () => {
    const res = await app.request("/api/v1/assessments/00000000-0000-0000-0000-000000000099/interrupted", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: "00000000-0000-0000-0000-000000000099",
        skill_id: "skill-foundry-solidity",
        failure_reason: "Runner docker daemon disconnect",
      }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.cooldown_applied).toBe(false);
    expect(json.data.can_immediately_restart).toBe(true);
  });

  it("serves supported settlement networks with mandatory testnet disclaimer (Spec §0.1 & §9.1)", async () => {
    const res = await app.request("/api/v1/settlement/networks");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.networks["base-sepolia"]).toBeDefined();
    expect(json.data.networks["base-sepolia"].isTestnet).toBe(true);
    expect(json.data.disclaimer).toContain("TESTNET PROTOTYPE ONLY");
  });

  it("registers a new user in pending_email state (Spec §2)", async () => {
    const res = await app.request("/api/v1/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "alice@example.com",
        username: "alice_crypto",
        timezone: "UTC",
      }),
    });

    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data.email).toBe("alice@example.com");
    expect(json.data.account_state).toBe("pending_email");
  });

  it("handles employer role approval with automated validation", async () => {
    const res = await app.request("/api/v1/roles/request-approval", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        role: "employer",
        intended_use: "We need automated smart contract reviews and security testing for our protocol.",
      }),
    });

    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data.status).toBe("approved");
    expect(json.data.reviewedBy).toBe("system_rules");
  });

  it("generates wallet challenge and verifies wallet with 24h security hold", async () => {
    // 1. Challenge
    const chalRes = await app.request("/api/v1/wallets/challenge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        address: "0x1234567890123456789012345678901234567890",
      }),
    });
    expect(chalRes.status).toBe(200);
    const chalJson = await chalRes.json();
    expect(chalJson.data.message).toContain("Quark Authentication");

    // 2. Verify
    const verifyRes = await app.request("/api/v1/wallets/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        network: "base",
        address: "0x1234567890123456789012345678901234567890",
        message: chalJson.data.message,
        signature: "0xmock_signature_valid",
      }),
    });
    expect(verifyRes.status).toBe(201);
    const verifyJson = await verifyRes.json();
    expect(verifyJson.data.security_hold_hours).toBe(24);
    expect(verifyJson.data.payout_active_after).toBeDefined();
  });

  it("creates a funding intent for a milestone", async () => {
    const milestoneId = "00000000-0000-0000-0000-000000000002";
    const res = await app.request(`/api/v1/milestones/${milestoneId}/funding-intents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        milestone_id: milestoneId,
        network: "base-sepolia",
        token: "USDC",
        idempotency_key: "00000000-0000-0000-0000-000000000003",
      }),
    });

    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data.status).toBe("created");
    expect(json.data.token).toBe("USDC");
    expect(json.data.expectedAmount).toBe("120000000"); // 120 USDC atomic units
  });
});
