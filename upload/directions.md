# QUARK — MVP Build Guideline Prompt

> This is written in English on the assumption it will be fed directly to a build agent (GPT-6/Astra) — prompts in English perform more reliably for code generation. Say if you want a Turkish version too.

You are the build agent responsible for implementing **Quark**, a Web3 task marketplace on the Monad blockchain. This document is your full spec. Follow it exactly. Where something is ambiguous, prefer the simplest option that satisfies the constraints below — do not introduce extra services, chains, or abstractions.

---

## 1. What Quark Is

Quark is a task marketplace where **employers** (Monad project owners) post paid tasks (audits, development, reviews, testing, design) and **workers** (developers) complete them for escrowed on-chain payment. Workers must hold a verified **skill badge** (earned via an on-chain-attested exam) before they can accept a task requiring that skill. Completed work builds an on-chain, non-transferable **reputation score**. A secondary **Ecosystem** tab has two sub-sections: **Programs** (Monad's official programs — MOST and others) and **Projects** (a curated directory of live Monad community projects, e.g. DEXs/protocols like DeltaV). A project card shows a "Hiring on Quark" badge and links to its open tasks when its wallet matches a known employer on Quark — this feeds ecosystem discovery back into the task marketplace instead of being a static list.

### Reference products (borrow the mechanics, not the business model)

- **Outlier (outlier.ai):** task-level pay rates that vary independently of the platform account; a single dashboard showing earnings per task, task status, and history; gated task access via unpaid skill assessments taken before a contributor can see certain task lanes; weekly, transparent payouts. → Quark equivalent: per-task pay set by the employer, a worker dashboard, skill-gated task visibility, cashout on approval instead of a payout cycle.
- **Mercor (mercor.com):** AI/algorithmic matching of vetted candidates to open roles based on a structured skill profile built from an assessment; a single verified profile that is reused across many opportunities instead of re-vetting per job. → Quark equivalent: a soulbound skill-badge profile that is reused across every task requiring that skill, so a worker is vetted once per skill, not once per task.

Do not copy their UI, branding, or literal business model (recruiting fees, AI interviews, etc.) — only the two mechanics above.

---

## 2. Non-Negotiable Constraints

- **Chain:** Monad Testnet only. Chain ID `10143`, RPC `https://testnet-rpc.monad.xyz`. No multi-chain support, no chain switcher in the UI. Every contract call and wallet connection targets this chain exclusively.
- **Language:** TypeScript everywhere — contracts' test/deploy scripts, backend, frontend, indexer handlers. No plain JavaScript files.
- **Database:** A single Postgres instance. No secondary databases, no vector DB, no Redis unless a later performance need is proven.
- **Auth:** SIWE (Sign-In with Ethereum) only. No embedded-wallet providers (Privy/Dynamic/etc.) in the MVP — those are explicitly out of scope.
- **Indexing:** Envio HyperIndex for on-chain event sync into Postgres. Do not hand-write a polling indexer.
- **Simplicity bias:** if a feature can be cut without breaking the core loop (post task → escrow → deliver → approve → cashout), cut it for the MVP and note it as a stretch item instead of building it.

---

## 3. Architecture (5 layers — implement in this order)

1. **L1 — Contracts** (Solidity + Foundry): `TaskEscrow.sol`, `Reputation.sol`, `SkillBadge.sol`.
2. **L2 — Indexer** (Envio HyperIndex, TypeScript handlers): syncs contract events into Postgres.
3. **L3 — Backend API** (Node.js + TypeScript + Fastify + Prisma): serves the frontend, owns the off-chain tables (exam questions, exam attempts, Ecosystem programs/projects), and runs the "assessment oracle" that signs exam results for `SkillBadge`.
4. **L4 — Auth** (SIWE): wallet-signature login verified by the backend, session issued as a JWT.
5. **L5 — Frontend** (Next.js + TypeScript + wagmi/viem + RainbowKit): single-chain UI (Monad Testnet only).

---

## 4. Data Model (Postgres — via Prisma)

Core tables. Field lists are the minimum needed for the MVP loop — add nothing beyond this without a reason tied to a must-have feature below.

- `users`: wallet_address (PK), display_name, created_at
- `tasks`: id, employer_address, title, description, category, pay_type (`fixed` | `hourly`), amount, required_skill, required_skill_level, status (`open` | `assigned` | `delivered` | `approved` | `rejected`), escrow_tx_hash, created_at
- `task_applications`: id, task_id, worker_address, status (`pending` | `accepted` | `rejected`), created_at
- `deliveries`: id, task_id, worker_address, submission_url_or_hash, submitted_at
- `reviews`: id, task_id, reviewer_address, reviewee_address, rating, comment, created_at
- `skills`: id, name, level (`basic` | `expert`)
- `skill_questions`: id, skill_id, question, options (jsonb), correct_option
- `skill_attempts`: id, worker_address, skill_id, score, passed (bool), attempted_at
- `skill_badges`: worker_address, skill_id, mint_tx_hash, minted_at (mirrors on-chain state; source of truth is the contract, this is a read cache)
- `reputation` (indexer-populated, mirrors `Reputation.sol`): wallet_address, completed_tasks, avg_rating, total_earned, total_spent
- `ecosystem_programs`: id, title, description, url, program (`MOST` | `other`), active (bool)
- `community_projects`: id, name, category (`DeFi` | `NFT` | `Gaming` | `Infra` | `Other`), description, url, logo_url, employer_address (nullable — set when the project's wallet is a known Quark employer, used to compute the "Hiring on Quark" badge)

---

## 5. Smart Contracts

### `TaskEscrow.sol`
- `createTask(bytes32 requiredSkillId, uint256 amount, uint256 deadline)` — employer calls with `amount` in MON attached; locks funds.
- `assignWorker(uint256 taskId, address worker)` — employer only; MUST revert if `worker` does not hold the required `SkillBadge`.
- `submitDelivery(uint256 taskId, bytes32 deliveryHash)` — assigned worker only.
- `approve(uint256 taskId, uint8 rating)` — employer only; transfers escrowed funds to worker, calls `Reputation.recordCompletion(...)`.
- `reject(uint256 taskId, string reason)` — employer only; MVP behavior: funds stay locked, worker can resubmit once, then a timeout releases funds back to the employer.
- Events: `TaskCreated`, `WorkerAssigned`, `DeliverySubmitted`, `TaskApproved`, `TaskRejected`.

### `Reputation.sol`
- `recordCompletion(address worker, address employer, uint8 rating)` — callable only by `TaskEscrow`. Updates soulbound counters for both addresses. No transfer function exists (soulbound by omission).
- View: `getScore(address user)`.

### `SkillBadge.sol`
- `mintBadge(address worker, bytes32 skillId, bytes signature)` — verifies `signature` was produced by the backend's assessment-oracle key over `(worker, skillId)`, then mints a non-transferable badge. Reverts on invalid signature or if a badge already exists for that (worker, skill) pair.
- View: `hasBadge(address worker, bytes32 skillId) returns (bool)`.

Keep all three contracts small and auditable. No upgradability pattern for the MVP — deploy plain, redeploy if needed on testnet.

---

## 6. Backend API (REST, Fastify)

- `POST /auth/nonce`, `POST /auth/verify` — SIWE flow.
- `GET /tasks`, `POST /tasks`, `GET /tasks/:id`
- `POST /tasks/:id/apply`, `POST /tasks/:id/assign`
- `POST /tasks/:id/deliver`
- `POST /tasks/:id/approve`, `POST /tasks/:id/reject`
- `GET /skills`, `GET /skills/:id/questions` (randomized subset, no `correct_option` field returned)
- `POST /skills/:id/attempt` — scores the attempt server-side, and on pass, signs and returns the payload the frontend needs to call `SkillBadge.mintBadge`.
- `GET /reputation/:address`
- `GET /ecosystem/programs`
- `GET /ecosystem/projects` — each item includes a `hiringOnQuark: boolean` computed from whether `employer_address` has any `open` tasks

Write endpoints that mutate on-chain state (assign, deliver, approve, reject, mint) do not write directly to Postgres — they return the calldata/tx for the frontend to send via the connected wallet, or accept an already-broadcast tx hash and let the L2 indexer be the source of truth for confirmed state. The API's own Postgres writes are for off-chain-only data (exam content, attempts, ecosystem programs/projects) and for optimistic UI state before indexing confirms it.

---

## 7. Frontend Screens

1. **Connect wallet / SIWE login** — Monad Testnet only; if the wallet is on another chain, prompt a network switch to Monad Testnet, don't silently proceed.
2. **Task board** — list/filter open tasks by category and required skill; show pay and required skill level per task.
3. **Task detail** — apply / accept flow; shows escrow status.
4. **Skill exam** — timed question flow; on pass, triggers the `mintBadge` wallet transaction.
5. **My profile** — skill badges held, reputation score, task history.
6. **Task workspace** (assigned task) — submit delivery; employer view shows approve/reject with rating.
7. **Ecosystem** — two sub-tabs: **Programs** (from `GET /ecosystem/programs`) and **Projects** (from `GET /ecosystem/projects`), the latter showing a "Hiring on Quark" badge that links to that project's open tasks on the task board.

---

## 8. MVP Scope

**Build (must-have):**
- Everything in sections 5–7 above, for exactly one skill category (e.g. Solidity, Basic + Expert levels) end to end.
- Full loop: create task → escrow → skill-gated assign → deliver → approve → cashout → reputation update.

**Explicitly out of scope for MVP (do not build):**
- Dispute resolution / arbitration
- Hourly/milestone-based escrow (fixed-price only)
- Multiple concurrent skills/categories beyond the one used for the demo
- Any embedded-wallet or social-login provider
- Automatic sync of Ecosystem programs/projects (static seed data is fine)
- Mobile-responsive polish beyond basic usability

---

## 9. Definition of Done (MVP)

- A user can connect a wallet on Monad Testnet, sign in via SIWE, and see their session persist.
- A user can pass a skill exam and receive an on-chain, non-transferable badge.
- An employer can create a task with locked escrow.
- Only a badge-holding worker can be assigned to a skill-gated task.
- A full create → deliver → approve → cashout cycle completes on Monad Testnet with a visible tx hash at each step.
- Reputation numbers update after approval and are visible on both parties' profiles.
- Ecosystem tab renders the seeded Programs and Projects lists, with the "Hiring on Quark" badge correctly showing on any project whose wallet has an open task.

If a build decision would violate section 2's constraints to hit this list faster, stop and flag it instead of proceeding.
