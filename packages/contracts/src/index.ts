/**
 * Quark API Contracts — Zod schemas for API request/response validation
 * Referenced from Spec Section 14.2
 */
import { z } from 'zod';

// ============================================================
// Shared schemas
// ============================================================

export const PaginationParams = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const IdParam = z.object({
  id: z.string().uuid(),
});

export const VersionHeader = z.object({
  'if-match': z.string().optional(),
});

// ============================================================
// Auth & Identity (Spec §2)
// ============================================================

export const SignUpRequest = z.object({
  email: z.string().email().max(255),
  username: z.string().min(3).max(30).regex(/^[a-zA-Z0-9_-]+$/),
  timezone: z.string().default('UTC'),
});

export const RequestRoleApproval = z.object({
  role: z.enum(['employer', 'worker']),
  intended_use: z.string().min(10).max(2000),
  project_description: z.string().min(10).max(5000).optional(),
  website: z.string().url().optional(),
});

export const WalletVerifyRequest = z.object({
  network: z.string().min(1),
  address: z.string().min(1),
  signature: z.string().min(1),
  message: z.string().min(1),
});

// ============================================================
// Organizations (Spec §2)
// ============================================================

export const CreateOrganization = z.object({
  name: z.string().min(2).max(100),
});

export const InviteMember = z.object({
  user_id: z.string().uuid(),
  capabilities: z.array(z.string()).default([]),
});

// ============================================================
// Jobs & Scope (Spec §4)
// ============================================================

export const CreateJobRequest = z.object({
  title: z.string().min(5).max(200),
  description: z.string().min(20).max(10000),
  category_id: z.string().uuid(),
  delivery_artifacts: z.array(z.string().min(1)).min(1),
  budget: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
  request_estimate: z.boolean().default(false),
  deadline: z.string().datetime().optional(),
  flexible_deadline: z.boolean().default(false),
  access_readiness: z.string().max(2000).optional(),
  confidentiality: z.enum(['public', 'private']).default('public'),
  ai_policy: z.enum(['allowed', 'forbidden', 'partial']).default('allowed'),
  acceptance_criteria: z.array(z.string().min(1)).min(1),
  existing_stack: z.string().max(2000).optional(),
  organization_id: z.string().uuid().optional(),
});

export const CreateScopeVersion = z.object({
  content: z.object({
    baseline_commit: z.string().optional(),
    supported_environments: z.array(z.string()),
    deliverables: z.array(z.string().min(1)).min(1),
    exclusions: z.array(z.string()).default([]),
    dependencies: z.array(z.string()).default([]),
    mandatory_criteria: z.array(z.object({
      description: z.string().min(1),
      evidence_type: z.string().min(1),
      mandatory: z.boolean().default(true),
    })).min(1),
    timeline: z.string().optional(),
    milestones: z.array(z.object({
      title: z.string().min(1),
      developer_amount: z.string().regex(/^\d+(\.\d{1,6})?$/),
      deadline: z.string().datetime().optional(),
    })).min(1),
    ai_permission: z.enum(['allowed', 'forbidden', 'partial']),
    licensing: z.string().optional(),
    background_ip: z.string().optional(),
    defect_support_days: z.number().int().min(0).default(14),
    token: z.string().default('USDC'),
    network: z.string().default('base'),
  }),
});

export const AcceptScopeRequest = z.object({
  scope_version_id: z.string().uuid(),
});

// ============================================================
// Offers (Spec §5)
// ============================================================

export const AcceptOfferRequest = z.object({
  // Idempotency key to prevent double acceptance
  idempotency_key: z.string().uuid(),
});

export const DeclineOfferRequest = z.object({
  reason: z.string().max(1000).optional(),
});

// ============================================================
// Milestones & Delivery (Spec §6)
// ============================================================

export const CreateFundingIntentRequest = z.object({
  milestone_id: z.string().uuid(),
  network: z.string().min(1),
  token: z.string().min(1),
  idempotency_key: z.string().uuid(),
});

export const CreateSubmissionRequest = z.object({
  milestone_id: z.string().uuid(),
  commit_hash: z.string().optional(),
  archive_hash: z.string().optional(),
  evidence_manifest: z.record(z.string(), z.unknown()).default({}),
});

export const CreateBlockerRequest = z.object({
  milestone_id: z.string().uuid(),
  description: z.string().min(10).max(5000),
  evidence: z.record(z.string(), z.unknown()).default({}),
});

// ============================================================
// Reviews (Spec §7)
// ============================================================

export const CreateObjectionRequest = z.object({
  review_id: z.string().uuid(),
  criterion_ids: z.array(z.string().uuid()).min(1),
  reason: z.string().min(10).max(5000),
  evidence: z.record(z.string(), z.unknown()).default({}),
});

// ============================================================
// Disputes (Spec §8)
// ============================================================

export const CreateDisputeRequest = z.object({
  milestone_id: z.string().uuid(),
  reason: z.string().min(10).max(5000),
  evidence: z.record(z.string(), z.unknown()).default({}),
  disputed_amount: z.string().regex(/^\d+(\.\d{1,6})?$/).optional(),
});

// ============================================================
// Withdrawals & Wallet (Spec §9)
// ============================================================

export const CreateWithdrawalRequest = z.object({
  wallet_id: z.string().uuid(),
  amount: z.string().regex(/^\d+(\.\d{1,6})?$/),
  network: z.string().min(1),
  token: z.string().min(1),
  idempotency_key: z.string().uuid(),
});

// ============================================================
// Consent (Spec §11)
// ============================================================

export const CreateConsentRequest = z.object({
  purpose: z.enum(['operational_review', 'model_improvement', 'training_data']),
  artifact_scope: z.record(z.string(), z.unknown()).optional(),
});

export const RevokeConsentRequest = z.object({
  consent_id: z.string().uuid(),
});

// ============================================================
// Change Requests (Spec §6)
// ============================================================

export const CreateChangeRequest = z.object({
  milestone_id: z.string().uuid(),
  description: z.string().min(10).max(5000),
  scope_diff: z.record(z.string(), z.unknown()).default({}),
});

export const AcceptChangeRequest = z.object({
  change_request_id: z.string().uuid(),
});

// ============================================================
// Error codes from spec §14.2
// ============================================================

export const ErrorCode = z.enum([
  'NOT_ELIGIBLE',
  'OFFER_EXPIRED',
  'SCOPE_CHANGED',
  'FUNDING_NOT_FINAL',
  'CATEGORY_DISABLED',
  'REVIEW_INCONCLUSIVE',
  'PAYOUT_LOCKED',
  'INSUFFICIENT_AVAILABLE_FUNDS',
  'CONFLICT_DETECTED',
  'CAPACITY_FULL',
  'COOLDOWN_ACTIVE',
  'INVALID_STATE_TRANSITION',
  'VERSION_CONFLICT',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'VALIDATION_ERROR',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
]);

export type ErrorCode = z.infer<typeof ErrorCode>;

export const ApiError = z.object({
  code: ErrorCode,
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
  retry_after: z.number().optional(),
});

export type ApiError = z.infer<typeof ApiError>;

// ============================================================
// Response wrappers
// ============================================================

export const ApiResponse = <T extends z.ZodType>(dataSchema: T) =>
  z.object({
    data: dataSchema,
    meta: z.object({
      request_id: z.string().uuid(),
      timestamp: z.string().datetime(),
      version: z.string().default('v1'),
    }),
  });

export const PaginatedResponse = <T extends z.ZodType>(itemSchema: T) =>
  z.object({
    data: z.array(itemSchema),
    meta: z.object({
      request_id: z.string().uuid(),
      timestamp: z.string().datetime(),
      version: z.string().default('v1'),
      cursor: z.string().uuid().nullable(),
      has_more: z.boolean(),
      total: z.number().int().optional(),
    }),
  });
