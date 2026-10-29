-- Quark initial migration
-- Generated from Drizzle ORM schema (Spec §14.1 Data Model)
-- Spec §15.2: "Documented migrations"
--
-- All amounts are bigint atomic units (USDC: 6 decimals → 1 USDC = 1,000,000)
-- All timestamps are UTC
-- All IDs are UUIDs

-- ═══════════════════════════════════════════════
-- Enums (Spec §14.1)
-- ═══════════════════════════════════════════════

CREATE TYPE account_state AS ENUM ('pending_email', 'pending_approval', 'active', 'restricted', 'suspended', 'closed');
CREATE TYPE role_type AS ENUM ('employer', 'worker', 'reviewer');
CREATE TYPE role_status AS ENUM ('pending', 'approved', 'rejected', 'suspended');
CREATE TYPE org_role AS ENUM ('owner', 'member');
CREATE TYPE skill_status AS ENUM ('draft', 'qualified', 'not_yet_qualified', 'expired', 'manual_exception');
CREATE TYPE category_status AS ENUM ('draft', 'evaluation', 'enabled', 'paused');
CREATE TYPE job_state AS ENUM ('draft', 'scoping', 'ready', 'matching', 'awaiting_funding', 'active', 'completed', 'waiting_for_talent', 'paused', 'cancelled');
CREATE TYPE milestone_state AS ENUM ('planned', 'offer_pending', 'agreed', 'funding_pending', 'funded', 'in_progress', 'submitted', 'reviewing', 'accepted_pending_objection', 'payable', 'paid', 'blocked', 'changes_requested', 'disputed', 'cancelled', 'partially_settled');
CREATE TYPE offer_status AS ENUM ('pending', 'accepted', 'declined', 'expired', 'revoked');
CREATE TYPE review_status AS ENUM ('pending', 'running', 'completed', 'inconclusive', 'failed');
CREATE TYPE dispute_status AS ENUM ('open', 'reviewer_assigned', 'under_review', 'resolved', 'escalated', 'closed');
CREATE TYPE funding_status AS ENUM ('created', 'detected', 'confirmed', 'failed', 'expired');
CREATE TYPE transfer_status AS ENUM ('pending', 'confirmed', 'failed', 'reconciled');

-- ═══════════════════════════════════════════════
-- Users & Identity (Spec §2)
-- ═══════════════════════════════════════════════

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(30) NOT NULL UNIQUE,
  email VARCHAR(255) NOT NULL UNIQUE,
  email_verified_at TIMESTAMPTZ,
  age_attested BOOLEAN NOT NULL DEFAULT FALSE,
  account_state account_state NOT NULL DEFAULT 'pending_email',
  timezone VARCHAR(50) NOT NULL DEFAULT 'UTC',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE role_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  role role_type NOT NULL,
  status role_status NOT NULL DEFAULT 'pending',
  reasons TEXT[],
  policy_version VARCHAR(50) NOT NULL DEFAULT '1.0',
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  owner_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE org_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  user_id UUID NOT NULL REFERENCES users(id),
  role org_role NOT NULL DEFAULT 'member',
  capabilities TEXT[] DEFAULT '{}',
  UNIQUE(org_id, user_id)
);

CREATE TABLE wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  network VARCHAR(50) NOT NULL,
  address VARCHAR(255) NOT NULL,
  ownership_proof TEXT,
  active_after TIMESTAMPTZ NOT NULL,
  is_primary BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, network, address)
);

-- ═══════════════════════════════════════════════
-- Skills & Assessments (Spec §3)
-- ═══════════════════════════════════════════════

CREATE TABLE skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  category_id VARCHAR(50) NOT NULL,
  parent_skill_id UUID REFERENCES skills(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE qualifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  skill_id UUID NOT NULL REFERENCES skills(id),
  status skill_status NOT NULL DEFAULT 'draft',
  score INTEGER,
  evidence JSONB DEFAULT '{}',
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, skill_id)
);

CREATE TABLE assessments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  skill_id UUID NOT NULL REFERENCES skills(id),
  template_version VARCHAR(50) NOT NULL,
  result VARCHAR(50),
  rubric_scores JSONB DEFAULT '{}',
  cooldown_until TIMESTAMPTZ,
  attempt_count INTEGER DEFAULT 0,
  is_accessibility_mode BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE session_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id UUID NOT NULL REFERENCES assessments(id),
  media_type VARCHAR(20) NOT NULL, -- 'screen', 'video', 'audio', 'transcript'
  storage_path TEXT NOT NULL,
  retention_expires_at TIMESTAMPTZ NOT NULL,
  dispute_hold BOOLEAN DEFAULT FALSE,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ═══════════════════════════════════════════════
-- Jobs, Scope & Milestones (Spec §4, §6)
-- ═══════════════════════════════════════════════

CREATE TABLE jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(200) NOT NULL,
  description TEXT NOT NULL,
  category_id VARCHAR(50) NOT NULL,
  risk_tier VARCHAR(20) NOT NULL DEFAULT 'standard',
  employer_user_id UUID NOT NULL REFERENCES users(id),
  org_id UUID REFERENCES organizations(id),
  state job_state NOT NULL DEFAULT 'draft',
  visibility VARCHAR(20) DEFAULT 'public',
  ai_policy VARCHAR(20) DEFAULT 'allowed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE scope_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id),
  version INTEGER NOT NULL,
  content JSONB NOT NULL,
  content_hash VARCHAR(64) NOT NULL, -- BLAKE3 hex (64 chars)
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(job_id, version)
);

CREATE TABLE scope_acceptances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_version_id UUID NOT NULL REFERENCES scope_versions(id),
  actor_id UUID NOT NULL REFERENCES users(id),
  actor_role VARCHAR(20) NOT NULL,
  accepted_hash VARCHAR(64) NOT NULL,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(scope_version_id, actor_id)
);

CREATE TABLE criteria (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_version_id UUID NOT NULL REFERENCES scope_versions(id),
  description TEXT NOT NULL,
  evidence_type VARCHAR(50) NOT NULL,
  mandatory BOOLEAN DEFAULT TRUE,
  order_index INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id),
  order_index INTEGER NOT NULL,
  title VARCHAR(200) NOT NULL,
  state milestone_state NOT NULL DEFAULT 'planned',
  developer_amount BIGINT NOT NULL, -- Atomic units
  platform_fee BIGINT NOT NULL,
  total_amount BIGINT NOT NULL,
  surcharge_amount BIGINT DEFAULT 0,
  token VARCHAR(20) NOT NULL DEFAULT 'USDC',
  network VARCHAR(50) NOT NULL DEFAULT 'base-sepolia',
  policy_version VARCHAR(50) DEFAULT '1.0',
  revision_round INTEGER DEFAULT 0,
  max_revisions INTEGER DEFAULT 2,
  deadline TIMESTAMPTZ,
  objection_deadline TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(job_id, order_index)
);

CREATE TABLE offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  milestone_id UUID NOT NULL REFERENCES milestones(id),
  worker_id UUID NOT NULL REFERENCES users(id),
  status offer_status NOT NULL DEFAULT 'pending',
  expires_at TIMESTAMPTZ NOT NULL,
  responded_at TIMESTAMPTZ,
  idempotency_key UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  milestone_id UUID NOT NULL UNIQUE REFERENCES milestones(id),
  worker_id UUID NOT NULL REFERENCES users(id),
  agreement_snapshot JSONB NOT NULL,
  capacity_slot INTEGER DEFAULT 1,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ═══════════════════════════════════════════════
-- Submissions & Reviews (Spec §7)
-- ═══════════════════════════════════════════════

CREATE TABLE submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  milestone_id UUID NOT NULL REFERENCES milestones(id),
  version INTEGER NOT NULL DEFAULT 1,
  commit_hash VARCHAR(255),
  archive_hash VARCHAR(64), -- BLAKE3
  evidence_manifest JSONB DEFAULT '{}',
  frozen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(milestone_id, version)
);

CREATE TABLE review_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  milestone_id UUID NOT NULL REFERENCES milestones(id),
  submission_id UUID NOT NULL REFERENCES submissions(id),
  status review_status NOT NULL DEFAULT 'pending',
  model_versions JSONB NOT NULL,
  policy_version VARCHAR(50) NOT NULL,
  risk_tier VARCHAR(20) NOT NULL,
  criteria_results JSONB DEFAULT '[]',
  cost_usage JSONB DEFAULT '{}',
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE findings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_run_id UUID NOT NULL REFERENCES review_runs(id),
  criterion_id UUID,
  severity VARCHAR(20) NOT NULL,
  file_path TEXT,
  observed TEXT NOT NULL,
  expected TEXT NOT NULL,
  reproduction TEXT,
  requested_correction TEXT
);

CREATE TABLE tool_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_run_id UUID NOT NULL REFERENCES review_runs(id),
  tool_name VARCHAR(100) NOT NULL,
  mandatory BOOLEAN DEFAULT FALSE,
  passed BOOLEAN NOT NULL,
  output_summary TEXT,
  duration_ms INTEGER
);

-- ═══════════════════════════════════════════════
-- Disputes (Spec §8)
-- ═══════════════════════════════════════════════

CREATE TABLE disputes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  milestone_id UUID NOT NULL REFERENCES milestones(id),
  job_id UUID NOT NULL REFERENCES jobs(id),
  employer_user_id UUID NOT NULL REFERENCES users(id),
  worker_user_id UUID NOT NULL REFERENCES users(id),
  status dispute_status NOT NULL DEFAULT 'open',
  disputed_amount BIGINT NOT NULL,
  reason TEXT NOT NULL,
  evidence JSONB DEFAULT '{}',
  assigned_reviewer_id UUID REFERENCES users(id),
  resolution JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

-- ═══════════════════════════════════════════════
-- Settlement & Ledger (Spec §9)
-- ═══════════════════════════════════════════════

CREATE TABLE funding_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  milestone_id UUID NOT NULL REFERENCES milestones(id),
  payer_id UUID NOT NULL REFERENCES users(id),
  network VARCHAR(50) NOT NULL,
  token VARCHAR(20) NOT NULL,
  expected_amount BIGINT NOT NULL,
  recipient_address VARCHAR(255) NOT NULL,
  status funding_status NOT NULL DEFAULT 'created',
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE chain_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  network VARCHAR(50) NOT NULL,
  transaction_hash VARCHAR(255) NOT NULL,
  log_index INTEGER NOT NULL,
  event_type VARCHAR(50) NOT NULL,
  data JSONB DEFAULT '{}',
  processed_at TIMESTAMPTZ,
  UNIQUE(network, transaction_hash, log_index) -- Spec §9.3 idempotency
);

CREATE TABLE journals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key VARCHAR(255) NOT NULL UNIQUE,
  entry_type VARCHAR(50) NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE journal_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_id UUID NOT NULL REFERENCES journals(id),
  account_type VARCHAR(50) NOT NULL, -- settlement_asset, held_employer_liability, etc.
  debit BIGINT DEFAULT 0,
  credit BIGINT DEFAULT 0,
  token VARCHAR(20) NOT NULL,
  network VARCHAR(50) NOT NULL
);

CREATE TABLE transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  milestone_id UUID REFERENCES milestones(id),
  recipient_address VARCHAR(255) NOT NULL,
  network VARCHAR(50) NOT NULL,
  token VARCHAR(20) NOT NULL,
  amount BIGINT NOT NULL,
  authorization_hash VARCHAR(255),
  nonce VARCHAR(100),
  status transfer_status NOT NULL DEFAULT 'pending',
  transaction_hash VARCHAR(255),
  idempotency_key VARCHAR(255) UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ
);

-- ═══════════════════════════════════════════════
-- Notifications & Outbox (Spec §13, §14.2)
-- ═══════════════════════════════════════════════

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dedupe_key VARCHAR(255) NOT NULL UNIQUE,
  event_type VARCHAR(50) NOT NULL,
  channel VARCHAR(20) NOT NULL, -- 'in_app', 'email'
  priority VARCHAR(20) NOT NULL DEFAULT 'transactional',
  recipient_user_id UUID NOT NULL REFERENCES users(id),
  payload JSONB NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ
);

CREATE TABLE outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type VARCHAR(100) NOT NULL,
  aggregate_id UUID NOT NULL,
  aggregate_type VARCHAR(50) NOT NULL,
  payload JSONB NOT NULL,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ═══════════════════════════════════════════════
-- Training & Provenance (Spec §11)
-- ═══════════════════════════════════════════════

CREATE TABLE consent_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID NOT NULL REFERENCES users(id),
  purpose VARCHAR(50) NOT NULL,
  artifact_scope JSONB,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);

CREATE TABLE datasets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  version VARCHAR(50) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE dataset_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id UUID NOT NULL REFERENCES datasets(id),
  source_type VARCHAR(50) NOT NULL,
  source_ref TEXT NOT NULL,
  blake3_hash VARCHAR(64) NOT NULL,
  license VARCHAR(100),
  rights_verified BOOLEAN DEFAULT FALSE,
  consent_grant_id UUID REFERENCES consent_grants(id),
  deletion_status VARCHAR(20) DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE model_releases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version VARCHAR(50) NOT NULL,
  training_dataset_id UUID REFERENCES datasets(id),
  evaluation_results JSONB DEFAULT '{}',
  promoted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ═══════════════════════════════════════════════
-- Policy & Audit (Spec §14.1)
-- ═══════════════════════════════════════════════

CREATE TABLE policy_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_type VARCHAR(50) NOT NULL, -- 'fee', 'review', 'retry', 'retention'
  version VARCHAR(50) NOT NULL,
  content JSONB NOT NULL,
  effective_from TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor VARCHAR(100) NOT NULL,
  action VARCHAR(100) NOT NULL,
  target VARCHAR(255) NOT NULL,
  reason TEXT,
  correlation_id UUID NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ═══════════════════════════════════════════════
-- Indexes for common queries
-- ═══════════════════════════════════════════════

CREATE INDEX idx_users_account_state ON users(account_state);
CREATE INDEX idx_role_approvals_user ON role_approvals(user_id, role);
CREATE INDEX idx_wallets_user ON wallets(user_id);
CREATE INDEX idx_jobs_state ON jobs(state);
CREATE INDEX idx_jobs_category ON jobs(category_id);
CREATE INDEX idx_milestones_job ON milestones(job_id);
CREATE INDEX idx_milestones_state ON milestones(state);
CREATE INDEX idx_offers_worker ON offers(worker_id, status);
CREATE INDEX idx_submissions_milestone ON submissions(milestone_id);
CREATE INDEX idx_review_runs_milestone ON review_runs(milestone_id);
CREATE INDEX idx_disputes_status ON disputes(status);
CREATE INDEX idx_funding_intents_milestone ON funding_intents(milestone_id);
CREATE INDEX idx_chain_events_unique ON chain_events(network, transaction_hash, log_index);
CREATE INDEX idx_journals_idempotency ON journals(idempotency_key);
CREATE INDEX idx_notifications_dedupe ON notifications(dedupe_key);
CREATE INDEX idx_audit_events_correlation ON audit_events(correlation_id);
CREATE INDEX idx_dataset_items_hash ON dataset_items(blake3_hash);