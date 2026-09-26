# Quark — Monad task marketplace

MON-only fixed-price task marketplace for **Monad Testnet, chain 10143**. Next.js/TypeScript frontend, RainbowKit/wagmi wallet integration, Fastify API via Next route handlers, Prisma/PostgreSQL metadata, Envio event indexer, and Solidity escrow/badge/reputation contracts.

## Run the interactive demo

Use Node 22.18+ or Node 24, then:

```sh
npm ci
npm run dev
```

Open http://localhost:3000. The first screen presents account creation and login with Worker or Employer mode. In demo mode, the form opens the interactive preview without requesting a wallet; tasks, badges and payments are simulated and saved in browser local storage. The banner explicitly identifies simulation. Reset demo clears only that browser's demo state.

Try Skills & badges → Solidity Basic assessment → Explore tasks → apply to a Basic task → switch to Employer → assign → switch to Worker → submit an HTTPS delivery → switch to Employer → approve. Inspect the worker profile to see the simulated earnings and reputation. Both assessments in demo teach the workflow; real mode uses the server's Solidity question bank.

## Included

- Wallet-first account creation and login with Worker / Employer mode, unique usernames, company profiles, MetaMask-compatible injected wallets, SIWE sessions, and logout.
- Monad-themed responsive landing page and upper navigation for Tasks, Community tasks, Earnings, Workspace, Skills, and Profile.
- Search, category/skill filters, reward/deadline sorting, task details, workspace.
- Create/fund task, badge-gated applications and assignment, delivery URL hash.
- Approval releases native MON and records reputation atomically.
- One revision; three-day review and resubmission windows.
- Worker can claim payment after an unanswered review; employer can refund open tasks or expired assigned/rejected tasks.
- Profile editing, company names, badges, MON earnings and payment history, completed contributions, ecosystem projects/programs.
- MetaMask wallet connection (connect, install prompt, Monad Testnet switch, live MON balance); MetaMask Mobile via WalletConnect when a project ID is set.
- Shared zod validators (`src/lib/validators.ts`) used by both the browser and the API for tasks, deliveries, ratings, reviews, profiles, registration and addresses.
- Two-way collaboration reviews after approval (1–5 stars + comment) and an overall evaluation on each profile: average, star distribution and filterable review list. Live mode stores reviews in the `Review` table — run `npm run db:push` after upgrading.
- Community projects are external links only: each card opens the project's HTTPS site in a new tab; non-HTTPS URLs are dropped.
- Responsive navigation and installable web-app manifest/icons. Network access is required for real transactions; no offline transaction queue.

## Real testnet setup

1. Copy `.env.example` to `.env`. Use an external PostgreSQL database. Set `APP_ORIGIN` to the exact origin, without a trailing slash, and generate a strong random `JWT_SECRET` of at least 32 characters.
2. Run `npm run db:generate`, `npm run db:push`, `npm run db:seed`. Prisma uses its own `app` schema; the indexer database is managed separately.
3. Set `DEPLOYER_PRIVATE_KEY` for a funded testnet account and `ORACLE_PRIVATE_KEY` for the assessment signer. Run `node --env-file=.env --import tsx scripts/deploy.ts`. It verifies RPC chain 10143 and records addresses/transaction hashes in `deployments/monad-testnet.json`. Do not upload private keys or that environment file. Deployment refuses to overwrite an existing record; partial deployments must be inspected before retrying.
4. Copy the three deployed addresses into the server and matching `NEXT_PUBLIC_*` variables. Do not expose signer/private secrets with a public prefix. The deployer key is unnecessary on Vercel.
5. In `indexer/`, install with `npm ci`, configure `indexer/.env` from its example, use the deployment's first block and addresses, then run `npm run codegen`. Run the indexer with Envio hosting or on a server with Docker. Its event handlers maintain tasks, badges and reputation. Configure `INDEXER_GRAPHQL_URL` and server-side GraphQL credentials in the app.
6. Set `NEXT_PUBLIC_APP_MODE=live`. For mobile wallet connections, supply a WalletConnect project ID. Without it, only injected browser wallets are configured. Rebuild after changing any public variable.
7. Before public testnet launch, verify the entire flow with two funded wallets and the actual RPC, PostgreSQL and indexer. This external integration has not been exercised in this workspace.

Wallet addresses are the account identity: registration and login use a one-time SIWE signature and an HttpOnly session cookie, not a password. Registration stores a unique username and, for employers, a company name. Choose Worker or Employer mode before connecting; the saved mode can be changed later. A wallet may use either mode. The mode is a workspace preference, not a security boundary: contract ownership and task state authorize all MON movements. RainbowKit shows the connected wallet's live network balance; mobile WalletConnect requires the project ID above.

## Shared mode (multi-device, wallet-to-wallet payments)

`NEXT_PUBLIC_APP_MODE=shared` keeps every task in Postgres so all devices see the same board (auto-refresh every 4 s). Workers and employers sign in with MetaMask (SIWE). The employer is notified when work is delivered and can approve or reject from the notification bell. Approve sends the task amount in MON directly from the employer's MetaMask to the worker's wallet on Monad Testnet. The server verifies that exact transfer before marking the task paid. There is no escrow lock in this mode.

Required env: `NEXT_PUBLIC_APP_MODE=shared`, `DATABASE_URL` (Neon via Vercel Storage), `JWT_SECRET` (32+ chars), `APP_ORIGIN` (exact production URL). `npm run build` runs `prisma db push` and the idempotent seed automatically when `DATABASE_URL` is set and the mode is not `demo`.

## Vercel

Import this project's root as a Next.js project. Use `npm ci` and `npm run build`; Node 22 or 24. For a demo deployment, set `NEXT_PUBLIC_APP_MODE=demo`; no external services are needed. For live mode, provision the database/indexer first and configure the variables above in Vercel. `APP_ORIGIN` must match the final deployment domain for SIWE and origin checks. Frontend and Fastify endpoints deploy together; the continuously running Envio indexer is hosted separately, not as a Vercel function. No Vercel deployment has been made yet.

## Verification

```sh
npm run typecheck
npm run build
npm run contracts:build
npm run test:contracts
npx playwright install chromium
npm run test:e2e
```

`test:contracts` compiles actual Solidity bytecode and exercises it on an in-process Ganache EVM. Foundry configuration is also included; Forge is not required for these tests. Browser tests cover the wallet-first registration interface, demo badges, application, assignment, revision, approval, profile persistence, task creation/refund, search, ecosystem, and mobile navigation. Envio types are generated from configured addresses with `npm run codegen` inside `indexer/`.

## MVP boundaries

Testnet only. No ERC-20 payments, multichain, arbitration, milestones, hourly billing, embedded wallets, or automatic ecosystem syncing. Employers can reject submissions within the review window; this is not a dispute-protected freelance service. MON values and badges in demo are simulated. In live mode, metadata/applications are in PostgreSQL and escrow state comes from indexed chain events, so the board can lag a confirmed transaction. Pending task metadata can be recovered from My profile on the same device.

The contracts and API are an MVP implementation, not an independently audited release. Assessments use a small curated question bank and a centralized oracle; they demonstrate credential flow rather than robust professional certification. Add operational rate limits, monitoring and a larger question bank before opening unrestricted usage.
