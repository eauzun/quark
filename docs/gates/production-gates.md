# Production Gates Checklist (Spec §19)

**Status:** All gates `not_started` — testnet/dev mode fully operational.
**Invariant (Spec §0):** "G: production gate requiring external evidence. Build interfaces and test implementations now; do not fake production completion."

---

## Gate Status Tracker

| # | Gate | Blocks | Status | Owner | Hard Block |
|---|---|---|---|---|---|
| 1 | Legal Entity & Jurisdictions | Real-money launch | ⬜ not_started | founder | ✅ |
| 2 | Custody / Fund-Holding Provider | Real-money funding | ⬜ not_started | founder | ✅ |
| 3 | USDC / Network Configuration | Mainnet adapter | ⬜ not_started | engineering | ✅ |
| 4 | AI Vendor Access & Terms | Private production reviews | ⬜ not_started | engineering | ✅ |
| 5 | Category AI Qualification | Autonomous paid acceptance | ⬜ not_started | engineering | ✅ |
| 6 | Exception Handling Capacity | Paid jobs needing recourse | ⬜ not_started | operations | ✅ |
| 7 | Training Data Rights | Model-training dataset | ⬜ not_started | legal | ⬜ |
| 8 | Independent Security Review | Production activation | ⬜ not_started | engineering | ✅ |

---

## What Works Without Gates (Now)

- ✅ Full testnet (Base Sepolia) settlement flow
- ✅ Mock settlement for local development
- ✅ AI review pipeline (free-tier providers, ADR-001)
- ✅ All domain logic (123 tests passing)
- ✅ Assessment, matching, disputes, ledger
- ✅ Adversarial security scanning

## What Gates Block

| Blocked Feature | Gate(s) Required |
|---|---|
| Real-money funding | #1 (Entity), #2 (Custody) |
| Mainnet USDC settlement | #3 (USDC/Network) |
| Production AI on private code | #4 (AI Vendor terms) |
| Unattended paid acceptance | #5 (Category benchmarks) |
| Human dispute resolution | #6 (Reviewer capacity) |
| Training data collection | #7 (Training rights) |
| Full production launch | #8 (Security review) |

---

## Gate Evidence Requirements

### Gate 1: Legal Entity & Jurisdictions
- [ ] Registered legal entity
- [ ] Terms of service reviewed by legal counsel
- [ ] Operating jurisdictions documented
- [ ] Worker classification analysis

### Gate 2: Custody / Fund-Holding Provider
- [ ] Provider approval OR independent audit of custom custody
- [ ] Threat model documented
- [ ] Refund mechanism tested
- [ ] Multisig administration configured

### Gate 3: USDC / Network Configuration
- [ ] Official token address verified from Circle/Coinbase
- [ ] Decimals confirmed (6 for USDC)
- [ ] Finality policy documented per chain
- [ ] Issuer freeze/blocklist handling documented

### Gate 4: AI Vendor Access & Terms
- [ ] API access confirmed for all providers
- [ ] Current pricing verified
- [ ] Data processing agreement reviewed
- [ ] Retention terms documented

### Gate 5: Category AI Qualification
- [ ] ≥200 labelled benchmark cases per category
- [ ] ≥60 must-reject cases per category
- [ ] Zero critical false accepts on held-out set
- [ ] False rejection rate ≤10%
- [ ] Repeated-run disagreement ≤5%

### Gate 6: Exception Handling Capacity
- [ ] ≥2 qualified human reviewers
- [ ] External dispute venue documented
- [ ] Reviewer compensation model approved

### Gate 7: Training Data Rights
- [ ] Consent mechanism tested
- [ ] Rights verification pipeline operational
- [ ] Deletion/withdrawal process documented

### Gate 8: Independent Security Review
- [ ] Third-party audit commissioned
- [ ] No critical findings unresolved
- [ ] Runner isolation verified
- [ ] Signing key management reviewed
- [ ] Ledger integrity reviewed