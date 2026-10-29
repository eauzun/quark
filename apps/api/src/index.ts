/**
 * apps/api/src/index.ts — Quark API Server (Spec §14.2)
 * Built with Hono for lightweight, edge-compatible, zero-cost deployment.
 */
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import {
  CreateJobRequest,
  CreateScopeVersion,
  AcceptOfferRequest,
  DeclineOfferRequest,
  CreateFundingIntentRequest,
  CreateSubmissionRequest,
  CreateWithdrawalRequest,
  SignUpRequest,
  RequestRoleApproval,
  WalletVerifyRequest,
  CreateOrganization,
} from "@quark/contracts";
import {
  calculatePlatformFee,
  calculateTotal,
  parseTokenAmount,
  formatTokenAmount,
  createWalletChallenge,
  registerVerifiedWallet,
  evaluateEmployerApproval,
  createScopeVersion,
  calculateBudgetHeatmap,
  LedgerService,
  evaluateAssessmentRubric,
  applyRetakeCooldown,
  resetInterruptedAttempt,
  createSessionRecording,
  executeReviewPipeline,
  openDisputeRecord,
  assignHumanReviewer,
} from "@quark/domain";
import { MockSettlementAdapter, NETWORKS } from "@quark/integrations";

const app = new Hono();
const settlement = new MockSettlementAdapter();
const ledgerService = new LedgerService();

// Health check endpoint
app.get("/health", (c) => {
  return c.json({
    status: "healthy",
    service: "quark-api",
    version: "0.1.0",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development",
  });
});

// ============================================================
// M1: Identity, Auth & Approvals (Spec §2)
// ============================================================

app.post("/api/v1/auth/register", async (c) => {
  const json = await c.req.json();
  const parsed = SignUpRequest.safeParse(json);
  if (!parsed.success) {
    return c.json({ error: "VALIDATION_ERROR", details: parsed.error.format() }, 400);
  }

  const user = {
    id: crypto.randomUUID(),
    email: parsed.data.email,
    username: parsed.data.username,
    timezone: parsed.data.timezone,
    account_state: "pending_email",
    email_verified_at: null,
    created_at: new Date().toISOString(),
  };

  return c.json({ data: user }, 201);
});

app.post("/api/v1/roles/request-approval", async (c) => {
  const json = await c.req.json();
  const parsed = RequestRoleApproval.safeParse(json);
  if (!parsed.success) {
    return c.json({ error: "VALIDATION_ERROR", details: parsed.error.format() }, 400);
  }

  const approval = evaluateEmployerApproval({
    userId: crypto.randomUUID(),
    emailVerified: true,
    ageAttested: true,
    intendedUse: parsed.data.intended_use,
    projectDescription: parsed.data.project_description,
    website: parsed.data.website,
  });

  if (!approval.ok) {
    return c.json({ error: approval.error }, 400);
  }

  return c.json({ data: approval.value }, 201);
});

// Spec §2 & §9.3: Wallet challenge & verification with 24h security hold
app.post("/api/v1/wallets/challenge", async (c) => {
  const body = await c.req.json();
  const address = body.address;
  const userId = body.user_id || crypto.randomUUID();

  if (!address) {
    return c.json({ error: "VALIDATION_ERROR", message: "address is required" }, 400);
  }

  const nonce = crypto.randomUUID();
  const challengeMessage = createWalletChallenge({
    address,
    userId,
    nonce,
  });

  return c.json({
    data: {
      address,
      nonce,
      message: challengeMessage,
    },
  });
});

app.post("/api/v1/wallets/verify", async (c) => {
  const json = await c.req.json();
  const parsed = WalletVerifyRequest.safeParse(json);
  if (!parsed.success) {
    return c.json({ error: "VALIDATION_ERROR", details: parsed.error.format() }, 400);
  }

  // Register verified wallet with 24h security hold
  const wallet = registerVerifiedWallet({
    userId: crypto.randomUUID(),
    network: parsed.data.network,
    address: parsed.data.address,
    message: parsed.data.message,
    signature: parsed.data.signature,
    isPrimary: true,
  });

  return c.json({
    data: {
      ...wallet,
      security_hold_hours: 24,
      payout_active_after: wallet.activeAfter.toISOString(),
    },
  }, 201);
});

// Spec §2: Organizations
app.post("/api/v1/organizations", async (c) => {
  const json = await c.req.json();
  const parsed = CreateOrganization.safeParse(json);
  if (!parsed.success) {
    return c.json({ error: "VALIDATION_ERROR", details: parsed.error.format() }, 400);
  }

  const orgId = crypto.randomUUID();
  const ownerId = crypto.randomUUID();

  return c.json({
    data: {
      id: orgId,
      name: parsed.data.name,
      owner_id: ownerId,
      created_at: new Date().toISOString(),
    },
  }, 201);
});

// Spec §4.1: Pricing calculation endpoint
app.post("/api/v1/pricing/quote", async (c) => {
  const body = await c.req.json();
  const rawDeveloperAmount = body.developer_amount;
  if (rawDeveloperAmount) {
    const parsed = parseTokenAmount(rawDeveloperAmount, 6);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const dev = parsed.value;
    const fee = calculatePlatformFee(dev);
    const total = calculateTotal(dev);

    return c.json({
      developer_amount: formatTokenAmount(dev, 6),
      platform_fee: formatTokenAmount(fee, 6),
      total: formatTokenAmount(total, 6),
      effective_fee_rate: "20.00%",
    });
  }

  return c.json({ error: "Missing developer_amount or total" }, 400);
});

// Spec §14.2: Representative Job endpoints
app.post("/api/v1/jobs", async (c) => {
  try {
    const json = await c.req.json();
    const parsed = CreateJobRequest.safeParse(json);
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.format() }, 400);
    }

    const job = {
      id: crypto.randomUUID(),
      ...parsed.data,
      state: "draft",
      created_at: new Date().toISOString(),
    };

    return c.json({ data: job }, 201);
  } catch (_e) {
    return c.json({ error: "INTERNAL_ERROR" }, 500);
  }
});

app.post("/api/v1/jobs/:id/scope-versions", async (c) => {
  const jobId = c.req.param("id");
  const json = await c.req.json();
  const parsed = CreateScopeVersion.safeParse(json);
  if (!parsed.success) {
    return c.json({ error: "VALIDATION_ERROR", details: parsed.error.format() }, 400);
  }

  // Create immutable scope version with BLAKE3 hash
  const scope = createScopeVersion({
    jobId,
    version: 1,
    content: {
      ...parsed.data.content,
      mandatoryCriteria: parsed.data.content.mandatory_criteria.map((mc, idx) => ({
        id: `crit-${idx + 1}`,
        description: mc.description,
        evidenceType: mc.evidence_type,
        mandatory: mc.mandatory,
      })),
      milestones: parsed.data.content.milestones.map((m, idx) => ({
        orderIndex: idx,
        title: m.title,
        developerAmount: BigInt(Math.floor(parseFloat(m.developer_amount) * 1_000_000)),
        deadline: m.deadline ? new Date(m.deadline) : undefined,
      })),
      supportedEnvironments: parsed.data.content.supported_environments,
      deliverables: parsed.data.content.deliverables,
      exclusions: parsed.data.content.exclusions,
      dependencies: parsed.data.content.dependencies,
      aiPermission: parsed.data.content.ai_permission,
      defectSupportDays: parsed.data.content.defect_support_days,
      token: parsed.data.content.token,
      network: parsed.data.content.network,
    },
  });

  return c.json({
    data: {
      id: scope.id,
      job_id: scope.jobId,
      version: scope.version,
      content_hash: scope.contentHash, // 64-char BLAKE3 hash
      content: parsed.data.content,
      created_at: scope.createdAt.toISOString(),
    },
  }, 201);
});

// Spec §4: Mutual scope acceptance
app.post("/api/v1/scopes/:id/accept", async (c) => {
  const scopeId = c.req.param("id");
  const body = await c.req.json();
  const actorId = body.actor_id || crypto.randomUUID();
  const actorRole = body.actor_role as "employer" | "worker";
  const providedHash = body.content_hash;

  if (!providedHash) {
    return c.json({ error: "VALIDATION_ERROR", message: "content_hash is required" }, 400);
  }

  return c.json({
    data: {
      acceptance_id: crypto.randomUUID(),
      scope_id: scopeId,
      actor_id: actorId,
      actor_role: actorRole,
      scope_content_hash: providedHash,
      accepted_at: new Date().toISOString(),
    },
  }, 200);
});

// Spec §4.2: Budget heatmap guidance
app.get("/api/v1/pricing/heatmap", (c) => {
  const categoryId = c.req.query("category_id") || "general-software";
  const riskTier = (c.req.query("risk_tier") as "low" | "standard" | "high") || "standard";
  const scopeSize = (c.req.query("scope_size") as "small" | "standard" | "complex") || "standard";

  // In early phase, no 30+ completed jobs exist -> returns estimated range honest label
  const heatmap = calculateBudgetHeatmap([], {
    categoryId,
    riskTier,
    scopeSize,
  });

  if (!heatmap.ok) return c.json({ error: heatmap.error }, 400);

  return c.json({
    data: {
      ...heatmap.value,
      ranges: {
        belowTypical: { max: heatmap.value.ranges.belowTypical.max.toString() },
        suggested: {
          min: heatmap.value.ranges.suggested.min.toString(),
          max: heatmap.value.ranges.suggested.max.toString(),
        },
        competitive: { min: heatmap.value.ranges.competitive.min.toString() },
      },
      percentiles: {
        p25: heatmap.value.percentiles.p25.toString(),
        medianP50: heatmap.value.percentiles.medianP50.toString(),
        p75: heatmap.value.percentiles.p75.toString(),
      },
    },
  });
});

// Spec §5: Offers endpoints
app.post("/api/v1/offers/:id/accept", async (c) => {
  const offerId = c.req.param("id");
  const json = await c.req.json();
  const parsed = AcceptOfferRequest.safeParse(json);
  if (!parsed.success) {
    return c.json({ error: "VALIDATION_ERROR", details: parsed.error.format() }, 400);
  }

  return c.json({
    data: {
      offer_id: offerId,
      status: "accepted",
      assigned_at: new Date().toISOString(),
      idempotency_key: parsed.data.idempotency_key,
    },
  });
});

app.post("/api/v1/offers/:id/decline", async (c) => {
  const offerId = c.req.param("id");
  const json = await c.req.json();
  const parsed = DeclineOfferRequest.safeParse(json);
  if (!parsed.success) {
    return c.json({ error: "VALIDATION_ERROR", details: parsed.error.format() }, 400);
  }

  return c.json({
    data: {
      offer_id: offerId,
      status: "declined",
      reason: parsed.data.reason,
      responded_at: new Date().toISOString(),
    },
  });
});

// Spec §9.2: Funding intents
app.post("/api/v1/milestones/:id/funding-intents", async (c) => {
  const milestoneId = c.req.param("id");
  const json = await c.req.json();
  const parsed = CreateFundingIntentRequest.safeParse(json);
  if (!parsed.success) {
    return c.json({ error: "VALIDATION_ERROR", details: parsed.error.format() }, 400);
  }

  const intent = await settlement.createFundingIntent({
    milestoneId,
    payerId: crypto.randomUUID(),
    network: parsed.data.network,
    token: parsed.data.token,
    amount: 120_000_000n, // 120 USDC
  });

  return c.json({
    data: {
      ...intent,
      expectedAmount: intent.expectedAmount.toString(),
    },
  }, 201);
});

// Spec §6: Submissions
app.post("/api/v1/milestones/:id/submissions", async (c) => {
  const milestoneId = c.req.param("id");
  const json = await c.req.json();
  const parsed = CreateSubmissionRequest.safeParse(json);
  if (!parsed.success) {
    return c.json({ error: "VALIDATION_ERROR", details: parsed.error.format() }, 400);
  }

  return c.json({
    data: {
      id: crypto.randomUUID(),
      milestone_id: milestoneId,
      commit_hash: parsed.data.commit_hash || "0xcommit_mock",
      status: "reviewing",
      submitted_at: new Date().toISOString(),
    },
  }, 201);
});

// Spec §9.3: Withdrawals
app.post("/api/v1/withdrawals", async (c) => {
  const json = await c.req.json();
  const parsed = CreateWithdrawalRequest.safeParse(json);
  if (!parsed.success) {
    return c.json({ error: "VALIDATION_ERROR", details: parsed.error.format() }, 400);
  }

  return c.json({
    data: {
      id: crypto.randomUUID(),
      status: "pending",
      network: parsed.data.network,
      token: parsed.data.token,
      amount: parsed.data.amount,
      wallet_id: parsed.data.wallet_id,
      initiated_at: new Date().toISOString(),
    },
  }, 202);
});

// ============================================================
// M3: Double-Entry Ledger, Webhooks & Settlement
// ============================================================

app.post("/api/v1/settlement/webhooks/deposit", async (c) => {
  const body = await c.req.json();
  const { milestone_id, expected_network, expected_token, expected_amount, event } = body;

  if (!event || !milestone_id) {
    return c.json({ error: "VALIDATION_ERROR", message: "milestone_id and event required" }, 400);
  }

  const result = ledgerService.processDeposit({
    milestoneId: milestone_id,
    expectedNetwork: expected_network || "base",
    expectedToken: expected_token || "USDC",
    expectedAmount: BigInt(expected_amount || "120000000"),
    event: {
      network: event.network,
      token: event.token,
      transactionHash: event.transaction_hash,
      logIndex: event.log_index,
      payerAddress: event.payer_address,
      amount: BigInt(event.amount),
    },
  });

  if (!result.ok) {
    return c.json({ error: result.error }, 400);
  }

  return c.json({
    data: {
      status: "processed",
      is_duplicate: result.value.isDuplicate,
      journal_id: result.value.journal.idempotencyKey,
    },
  }, 200);
});

app.post("/api/v1/milestones/:id/award", async (c) => {
  const milestoneId = c.req.param("id");
  const body = await c.req.json();
  const devAmount = BigInt(body.developer_amount || "100000000");
  const feeAmount = BigInt(body.platform_fee || "20000000");

  const result = ledgerService.authorizeAward({
    milestoneId,
    network: body.network || "base",
    token: body.token || "USDC",
    developerAmount: devAmount,
    platformFee: feeAmount,
    idempotencyKey: body.idempotency_key || `award-${milestoneId}-${Date.now()}`,
  });

  if (!result.ok) {
    return c.json({ error: result.error }, 400);
  }

  return c.json({
    data: {
      milestone_id: milestoneId,
      status: "awarded",
      developer_amount: devAmount.toString(),
      platform_fee: feeAmount.toString(),
    },
  }, 200);
});

app.get("/api/v1/ledger/reconciliation", (c) => {
  const result = ledgerService.reconcile();
  if (!result.ok) {
    return c.json({ error: result.error }, 500);
  }

  return c.json({
    data: {
      is_balanced: result.value.isBalanced,
      total_assets: result.value.totalAssets.toString(),
      total_claims: result.value.totalClaims.toString(),
      discrepancy: result.value.discrepancy.toString(),
      balances: {
        settlement_asset: result.value.balances.settlementAsset.toString(),
        held_employer_liability: result.value.balances.heldEmployerLiability.toString(),
        worker_payable: result.value.balances.workerPayable.toString(),
        platform_revenue: result.value.balances.platformRevenue.toString(),
        refund_payable: result.value.balances.refundPayable.toString(),
      },
    },
  });
});

// ============================================================
// M4: Skills, Assessments & Accessibility (Spec §3)
// ============================================================

app.post("/api/v1/assessments/start", async (c) => {
  const body = await c.req.json();
  const { user_id, skill_id, is_accessibility_mode } = body;

  if (!user_id || !skill_id) {
    return c.json({ error: "VALIDATION_ERROR", message: "user_id and skill_id required" }, 400);
  }

  // Create session recording entry with default 30-day retention
  const recording = createSessionRecording({
    assessmentId: crypto.randomUUID(),
    mediaType: is_accessibility_mode ? "screen" : "video",
    storagePath: `s3://quark-recordings/${user_id}/${Date.now()}.mp4`,
  });

  return c.json({
    data: {
      assessment_id: recording.assessmentId,
      skill_id,
      user_id,
      status: "in_progress",
      is_accessibility_mode: Boolean(is_accessibility_mode),
      recording_retention_days: 30,
      recording_expires_at: recording.retentionExpiresAt.toISOString(),
      ai_assistance_forbidden: true, // Spec §3.1: AI use strictly forbidden during assessment
    },
  }, 201);
});

app.post("/api/v1/assessments/:id/submit", async (c) => {
  const assessmentId = c.req.param("id");
  const body = await c.req.json();

  const evalResult = evaluateAssessmentRubric({
    assessmentId,
    userId: body.user_id || crypto.randomUUID(),
    skillId: body.skill_id || "skill-general",
    isAccessibilityWrittenMode: Boolean(body.is_accessibility_mode),
    codeSolution: body.code_solution || "",
    testSuiteOutput: {
      passed: Boolean(body.test_suite?.passed),
      testsTotal: body.test_suite?.tests_total || 10,
      testsPassed: body.test_suite?.tests_passed || 10,
      branchCoveragePercent: body.test_suite?.branch_coverage || 90,
    },
    writtenOrVoiceResponses: body.responses || [
      {
        promptId: "arch",
        response: "Technical explanation of architectural design and trade-offs.",
      },
    ],
    tabDepartureEventsCount: body.tab_departures || 0,
    mandatorySkillRequirementsMet: body.mandatory_requirements_met !== false,
  });

  if (!evalResult.ok) {
    return c.json({ error: evalResult.error }, 400);
  }

  let cooldownInfo = null;
  if (evalResult.value.status === "not_yet_qualified") {
    // Apply 15 calendar days retake cooldown
    const attempt = applyRetakeCooldown({
      userId: body.user_id,
      skillId: body.skill_id,
    });
    cooldownInfo = {
      cooldown_days: 15,
      next_retake_available_at: attempt.cooldownExpiresAt?.toISOString(),
    };
  }

  return c.json({
    data: {
      assessment_id: assessmentId,
      ...evalResult.value,
      cooldown: cooldownInfo,
    },
  }, 200);
});

app.post("/api/v1/assessments/:id/interrupted", async (c) => {
  const assessmentId = c.req.param("id");
  const body = await c.req.json();

  // Reset attempt without consuming attempt or applying cooldown (Spec §15.1 Scenario 18)
  resetInterruptedAttempt({
    userId: body.user_id || crypto.randomUUID(),
    skillId: body.skill_id || "skill-interrupted",
    failureReason: body.failure_reason || "Platform infrastructure outage",
  });

  return c.json({
    data: {
      assessment_id: assessmentId,
      status: "interrupted_reset",
      cooldown_applied: false,
      can_immediately_restart: true,
      message: "Attempt reset due to confirmed platform failure. No cooldown consumed.",
    },
  }, 200);
});

// ============================================================
// M5: Automated AI Reviewer Pipeline (Spec §7)
// ============================================================

app.post("/api/v1/milestones/:id/reviews/execute", async (c) => {
  const milestoneId = c.req.param("id");
  const body = await c.req.json();

  const reviewOutcome = executeReviewPipeline({
    reviewId: crypto.randomUUID(),
    jobId: body.job_id || crypto.randomUUID(),
    milestoneId,
    submissionHash: body.submission_hash || "0xblake3_mock_submission",
    scopeVersion: body.scope_version || "v1",
    policyVersion: "1.0",
    riskTier: body.risk_tier || "standard",
    criteria: body.criteria || [
      { id: "crit-1", description: "Unit tests pass with zero failures", mandatory: true },
    ],
    files: body.files || [
      { path: "src/index.ts", content: "export const ok = true;" },
    ],
    toolRuns: body.tool_runs || [
      {
        toolName: "vitest",
        mandatory: true,
        passed: true,
        outputSummary: "All tests passed",
        durationMs: 800,
      },
    ],
    isModelOutageOrTimeout: Boolean(body.is_outage),
  });

  if (!reviewOutcome.ok) {
    return c.json({ error: reviewOutcome.error }, 400);
  }

  return c.json({
    data: {
      review_id: reviewOutcome.value.reviewRun.reviewId,
      milestone_id: milestoneId,
      recommended_state: reviewOutcome.value.recommendedStateTransition,
      criteria_results: reviewOutcome.value.reviewRun.criteria,
      findings_count: reviewOutcome.value.reproducibleFindings.length,
      findings: reviewOutcome.value.reproducibleFindings,
      models_used: reviewOutcome.value.reviewRun.modelVersions,
    },
  }, 200);
});

// Spec §7.2: Employer objection endpoint
app.post("/api/v1/reviews/:id/objections", async (c) => {
  const reviewId = c.req.param("id");
  const body = await c.req.json();

  if (!body.reason || !body.criterion_ids || body.criterion_ids.length === 0) {
    return c.json(
      { error: "VALIDATION_ERROR", message: "Specific criterion_ids and reason are mandatory for objections" },
      400
    );
  }

  return c.json({
    data: {
      objection_id: crypto.randomUUID(),
      review_id: reviewId,
      status: "dispute_opened",
      criterion_ids: body.criterion_ids,
      reason: body.reason,
      evidence_attached: Boolean(body.evidence),
      two_business_day_window_held: true,
      opened_at: new Date().toISOString(),
    },
  }, 201);
});

// ============================================================
// M7: Disputes, Human Reviewers & Training Provenance (Spec §8 & §11)
// ============================================================

app.post("/api/v1/disputes", async (c) => {
  const body = await c.req.json();
  const dispute = openDisputeRecord({
    milestoneId: body.milestone_id || crypto.randomUUID(),
    jobId: body.job_id || crypto.randomUUID(),
    employerUserId: body.employer_user_id || "u-emp",
    workerUserId: body.worker_user_id || "u-worker",
    employerOrgMemberIds: body.employer_org_member_ids,
    disputedAmount: BigInt(body.disputed_amount || "120000000"),
    reason: body.reason || "Dispute reason",
    evidence: body.evidence || {},
  });

  return c.json({
    data: {
      ...dispute,
      disputedAmount: dispute.disputedAmount.toString(),
      reviewerCompensationFixed: dispute.reviewerCompensationFixed.toString(),
    },
  }, 201);
});

app.post("/api/v1/disputes/:id/assign-reviewer", async (c) => {
  const disputeId = c.req.param("id");
  const body = await c.req.json();

  const dummyDispute = openDisputeRecord({
    milestoneId: body.milestone_id || crypto.randomUUID(),
    jobId: body.job_id || crypto.randomUUID(),
    employerUserId: body.employer_user_id || "u-emp",
    workerUserId: body.worker_user_id || "u-worker",
    employerOrgMemberIds: body.employer_org_member_ids,
    disputedAmount: BigInt(body.disputed_amount || "120000000"),
    reason: "Reason",
    evidence: {},
  });
  dummyDispute.id = disputeId;

  const result = assignHumanReviewer({
    dispute: dummyDispute,
    reviewer: {
      userId: body.reviewer_user_id,
      isQualified: body.is_qualified !== false,
      activeDisputeCount: 0,
      fixedHourlyRateUsdc: BigInt(body.fixed_rate || "50000000"),
    },
  });

  if (!result.ok) {
    return c.json({ error: result.error }, 400);
  }

  return c.json({
    data: {
      dispute_id: disputeId,
      status: result.value.status,
      assigned_reviewer_id: result.value.assignedReviewerId,
      fixed_compensation_usdc: result.value.reviewerCompensationFixed.toString(),
      conflict_free_verified: true,
    },
  }, 200);
});

app.post("/api/v1/consents", async (c) => {
  const body = await c.req.json();
  const grantId = crypto.randomUUID();

  return c.json({
    data: {
      id: grantId,
      actor_id: body.actor_id || crypto.randomUUID(),
      purpose: body.purpose || "model_improvement",
      granted_at: new Date().toISOString(),
      is_revoked: false,
    },
  }, 201);
});

app.post("/api/v1/consents/:id/revoke", async (c) => {
  const consentId = c.req.param("id");

  return c.json({
    data: {
      consent_id: consentId,
      is_revoked: true,
      revoked_at: new Date().toISOString(),
      unlearning_manifest: {
        deletion_status: "pending_deletion",
        future_model_releases_excluded: true,
      },
    },
  }, 200);
});

app.get("/api/v1/settlement/networks", (c) => {
  return c.json({
    data: {
      networks: NETWORKS,
      disclaimer: "⚠️ TESTNET PROTOTYPE ONLY — Never label testnet transactions or simulated balances as real mainnet funds (Spec §0.1).",
    },
  });
});

const port = Number(process.env.PORT) || 4000;
console.log(`Quark API running on port ${port}`);

if (process.env.NODE_ENV !== "test") {
  serve({ fetch: app.fetch, port });
}

export { app };
