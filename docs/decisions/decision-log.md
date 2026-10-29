# Decision Log

All architectural and policy decisions, per Spec §0: "New instructions override this document only through an explicit decision record. Keep historical fee, scope and review policies attached to existing contracts."

Spec §18.5: "Add migrations and tests with each meaningful workflow; keep changelog and decision log."

---

## Format

Each entry records: **date**, **decision** (F: founder / D: default / G: gate), **rationale**, **status**.

---

## 2026-10-30 — D: Database migration tooling

- **Decision**: Use `drizzle-kit generate` with committed SQL migrations under `packages/database/src/migrations/`.
- **Rationale**: Spec §15.2 "Documented migrations" + §18.5 "Add migrations with each meaningful workflow." Commit generated SQL so review can inspect DDL before execution.
- **Status**: Implemented.

## 2026-10-30 — D: Changelog discipline

- **Decision**: Maintain `CHANGELOG.md` per milestone using Keep a Changelog format. Each milestone section records what changed, what tests were added, and any bug fixes.
- **Rationale**: Spec §18.5 explicit requirement.
- **Status**: Implemented.

## 2026-10-29 — D: Security scanner regex statefulness fix

- **Decision**: Reset `lastIndex = 0` on `g`-flag regexes before each `.test()` in `security-scanner.ts`.
- **Rationale**: JavaScript `g`-flag regexes are stateful; without the reset, multi-file scanning silently misses findings — a security-critical bug.
- **Status**: Implemented with regression test.

## 2026-10-29 — D: Sandbox runner as simulated executor

- **Decision**: Implement `SandboxRunner` with all resource limits, command/env validation and network isolation enforced logically; actual execution is simulated and clearly marked.
- **Rationale**: Spec §0: "G: production gate requiring external evidence... Build interfaces and test implementations now; do not fake production completion." Real microVM (Firecracker/gVisor) is a production gate. Interface is testable now.
- **Status**: Interface complete. MicroVM integration is a G gate.

## 2026-10-28 — D: Testnet-only settlement in production

- **Decision**: `production` environment defaults to `settlementMode: "testnet"` and `features.realMoney: false`. Real-money settlement requires the GateTracker to clear Gate #1 (Entity), #2 (Custody), #3 (USDC/Network).
- **Rationale**: Spec §0.1 invariant: "Never label testnet transactions or simulated balances as real." Spec §9.1 G gate.
- **Status**: Implemented as enforcement in `environments.ts` + `gate-tracker.ts`.

## 2026-10-28 — F: BLAKE3 for off-chain hashing (ADR-005)

- **Decision**: Use BLAKE3 for off-chain auth, scope hashing, submission archives, and training provenance. Keep Keccak-256/EIP-191 for EVM wallet signatures.
- **Rationale**: 6-12× faster than SHA-256, built-in Merkle tree structure, natural length-extension protection. `@noble/hashes` works in Node + edge runtimes.
- **Status**: Implemented.

## 2026-10-28 — F: Free AI model chain (ADR-001)

- **Decision**: Gemini Flash → Groq Llama → NVIDIA Nemotron → Mistral Codestral fallback chain with circuit breaker + rate limiting.
- **Rationale**: $0 AI cost per job (vs $0.15–$2.32 in spec estimates). Privacy constraints documented — not suitable for real client code without self-hosted fallback.
- **Status**: Implemented as provider chain config.

## 2026-10-28 — F: 20% platform fee on developer compensation (Spec §4.3, §21)

- **Decision**: `T = 1.20 × D + E` where E is separately-disclosed exceptional review surcharge (default 0). Total headline price includes fee. No minimum job fee.
- **Rationale**: Spec §0.1 founder decision + §21 final consistency rule. Platform share of total = 16.6667%, not 20% (fee is on D, not T).
- **Status**: Implemented in `money.ts` with property-based tests.

## 2026-10-28 — D: Two-revision limit (Spec §6)

- **Decision**: Maximum 2 legitimate correction rounds per milestone. Third failed submission escalates to dispute resolution. Infrastructure retries, wrong AI findings, and scope changes do NOT consume revision rounds.
- **Rationale**: Spec §0.1 founder decision. Prevents both worker exploitation and infinite loops.
- **Status**: Implemented in `milestone-states.ts` with tests.

## 2026-10-28 — D: Two-business-day objection window (Spec §7.2)

- **Decision**: After AI acceptance, employer has 2 business days to object with specific criterion IDs and evidence. No objection = milestone becomes `payable`.
- **Rationale**: Spec §0.2 default. Balance between worker payment latency and employer recourse.
- **Status**: Implemented in `milestone-states.ts` + API.

## 2026-10-28 — F: Assessment AI strictly forbidden (Spec §3.1)

- **Decision**: AI use during skill assessment is strictly forbidden and separate from real-work AI policy (which employer controls per job).
- **Rationale**: Spec §0.1 founder decision + §21 rule 5. Assessment tests raw skill; real-work tests collaborative skill with employer's chosen AI policy.
- **Status**: Implemented with separate fields (`aiPermission` vs `assessmentAiPolicy`).

## 2026-10-28 — G: All 8 external production gates (Spec §19)

- **Decision**: Track gates explicitly in `GateTracker`. No gate can be marked "cleared" without `evidence_submitted` first. Real-money launch requires ALL hard-block gates cleared.
- **Rationale**: Spec §0 reading contract: "G: production gate requiring external evidence... do not fake production completion." Spec §19 lists 8 genuine external dependencies.
- **Status**: Tracker implemented. Gates remain `not_started` — awaiting external evidence.

---

## Superseded / Rejected

(None yet.)