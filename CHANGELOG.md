# Changelog

All notable changes to Quark are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/), versioning per milestone.

Spec §18.5: "Add migrations and tests with each meaningful workflow; keep changelog and decision log."

---

## [0.9.0] — M9: Production Gates & Limited Launch (2026-10-30)

### Added
- Gate tracker (Spec §19): 8 production gates with lifecycle (`not_started` → `evidence_submitted` → `cleared`)
- Admin operations: category gate management (draft/evaluation/enabled/paused), benchmark enforcement
- Emergency pause (Spec §17): scope (`new_funding` / `new_offers` / `releases` / `all`) + audit trail
- Notification outbox (Spec §13, §14.2): transactional/marketing split, dedupe key, retry, bounce handling
- Monitoring metrics (Spec §17): 17 operational metrics with alert thresholds (hard alerts on ledger mismatch, false accept, stuck payout, deletion SLA)
- Deployment config (Spec §14): 4 environments (local/test/staging/production) with secrets interface
- Runbooks: incident response (P0-P3), ledger mismatch, leaked secret, unauthorized access, false accept, stuck payout
- Production gates checklist with evidence requirements per gate
- 30 new tests → **153 total**

---

## [0.8.0] — M8: Adversarial Testing & Sandbox (2026-10-29)

### Added
- Sandbox runner (Spec §14.3): 2 vCPU / 4GB / 15min / 2GB caps, network blocked by default
- Artifact validator (Spec §12): path traversal, symlink escape, decompression bomb, executable, sensitive file detection
- Benchmark framework (Spec §7.3): 20 must-reject adversarial cases, Wilson confidence interval, threshold enforcement
- Adversarial fixtures: prompt injection, secret exposure, broken builds, supply chain attacks
- E2E scenario tests (Spec §15.1 Scenarios 7, 8, 14, 21, 23) + property-based money & state machine invariants
- 47 new tests → 123 total

### Fixed
- **Security scanner regex statefulness bug**: `g`-flag regexes in `security-scanner.ts` advanced `lastIndex` across calls, causing missed findings in multi-file scans. Fixed by resetting `lastIndex` before each `.test()`.

---

## [0.7.0] — M7: Disputes & Training Provenance (2026-10-28)

### Added
- Dispute lifecycle: open → assign reviewer → resolve verdict (Spec §8)
- Human reviewer conflict check: worker/org-member/related-party blocked (Spec §15.1 Scenario 12)
- Training provenance (Spec §11): rights verification, consent grant/revoke, dataset eligibility
- 8 tests → 76 total

---

## [0.6.0] — M6: Base Sepolia Settlement (2026-10-28)

### Added
- BaseSepoliaSettlementAdapter (Spec §9.2): viem integration, ERC-20 Transfer logs
- Chain-specific finality (12 confirmations), pre-finality not spendable (Spec §9.1)
- Network allowlist with testnet USDC config (ADR-004)
- Mock adapter for local dev with clear mock markers
- 3 tests

---

## [0.5.0] — M5: AI Reviewer Pipeline (2026-10-28)

### Added
- Prompt injection defense (Spec §7.1): repo instructions cannot alter system policy, wallet, fee
- Secret scanning: EVM private keys, AWS keys, GitHub tokens (critical severity)
- Multi-model review chain (ADR-001): Gemini Flash primary, Groq adversarial
- Deterministic aggregator: schema validation + rule checks (Spec §7.1 step 8)
- Model outage → `inconclusive` (never false rejection) (Spec §15.1 Scenario 6)
- 8 tests

---

## [0.4.0] — M4: Assessment & Recording (2026-10-28)

### Added
- Assessment rubric: correctness 45 / reasoning 25 / testing 20 / adherence 10 (Spec §3.1)
- 15-day retake cooldown per failed skill (Spec §15.1 Scenario 18)
- Platform failure protection: attempt reset without cooldown consumption
- Session media: 30-day encrypted retention, dispute extension (Spec §3.2)
- Recording never used as training data (invariant)
- 8 tests

---

## [0.3.0] — M3: Ledger & Milestone Lifecycle (2026-10-28)

### Added
- Double-entry ledger (ADR-003): balanced journals, 5 accounts, append-only
- Idempotent deposit processing: `(network, tx_hash, log_index)` uniqueness (Spec §15.1 Scenario 3)
- Milestone state machine (Spec §6): 13 states + guards, max 2 revision rounds
- Wallet 24h security hold (Spec §15.1 Scenario 11)
- 12 tests

---

## [0.2.0] — M2: Scope & Matching (2026-10-28)

### Added
- Immutable scope versions with BLAKE3 content hash (ADR-005, Spec §4)
- Mutual acceptance: both parties accept identical hash before funding
- Scope change invalidation (Spec §15.1 Scenario 4)
- Budget heatmap with honest "estimated range" label (Spec §4.2, §15.1 Scenario 20)
- Deterministic matching (Spec §5): sequential offers, single live lease
- 9 tests

---

## [0.1.0] — M1: Identity & Organizations (2026-10-28)

### Added
- Account state machine (Spec §2): `pending_email → pending_approval → active`
- EIP-191 wallet challenge + signature verification (viem)
- 24h wallet security hold (Spec §9.3, §15.1 Scenario 11)
- Role approval engine: auto-approve vs manual review
- Organization permissions (Spec §2): owner/member, last-owner protection
- Conflict detection: self-dealing, org conflict, review conflict
- 10 tests

---

## [0.0.1] — M0: Scaffold & Primitives (2026-10-28)

### Added
- Monorepo: npm workspaces + Turborepo + strict TypeScript
- 5 ADRs (ADR-001 through ADR-005)
- PostgreSQL schema (Drizzle ORM): 15 table groups, 30+ enums (Spec §14.1)
- API contracts (Zod, Spec §14.2)
- Shared domain: bigint money math (20% fee), `Result<T>`, BLAKE3 crypto
- 15 tests