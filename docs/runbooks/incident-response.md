# Runbook: Incident Response

**Spec §14.3:** "Alert immediately on ledger mismatch, leaked secret, unauthorized access, stuck payable transfer or category false-accept incident. Incident owner and escalation contact must be configured before launch."

---

## Severity Levels

| Level | Description | Response Time | Examples |
|---|---|---|---|
| **P0 — Critical** | Funds at risk, data breach, system down | Immediate (≤15 min) | Ledger mismatch, leaked secret, unauthorized fund transfer |
| **P1 — High** | Major feature broken, security concern | ≤1 hour | False accept incident, stuck payouts, auth bypass |
| **P2 — Medium** | Feature degraded, no fund impact | ≤4 hours | Review pipeline timeout, notification delivery failure |
| **P3 — Low** | Minor issue, cosmetic | ≤24 hours | UI bug, non-critical alert noise |

---

## P0: Ledger Mismatch

1. **STOP** all payout transfers immediately (emergency pause: `releases`)
2. Capture the reconciliation report snapshot
3. Identify the mismatched journal entries
4. Check for duplicate events `(network, tx_hash, log_index)` — replayed webhooks are the most common cause
5. Verify no cross-token netting occurred
6. If confirmed mismatch: alert operator + finance, investigate chain events
7. **Do NOT adjust balances manually** — append correction entries only
8. Document root cause in incident log

## P0: Leaked Secret

1. **Immediately revoke** the compromised credential
2. If it's a signing key: freeze all transfers via emergency pause
3. If it's an API key: rotate at provider
4. Check logs for unauthorized usage since the suspected leak time
5. Notify affected users if their data was exposed
6. Update `SecretsManager` — never commit the replacement to git
7. Review code for other secrets; run secret scanner on full repository

## P0: Unauthorized Access

1. Revoke all sessions for the compromised account
2. Enable enhanced monitoring
3. Check audit log for actions taken by the compromised account
4. If financial actions were taken: freeze affected wallets, alert operator
5. Reset credentials, require re-verification
6. Document the access pattern for security review

## P1: False Accept Incident

1. **Pause the affected category** (`pauseCategory`)
2. Identify all work accepted under the affected policy version
3. Open incident review for each accepted job
4. Notify affected employers and workers
5. Re-run review with corrected configuration
6. Update benchmark dataset with the false accept case
7. Do NOT re-enable category until benchmark regression passes

## P1: Stuck Payout Transfer

1. Check transfer state in `transfers` table (authorization → pending → confirmed)
2. Verify chain status (gas price, network congestion)
3. If pre-finality: wait — do NOT retry (would create duplicate)
4. If failed: use the same `idempotencyKey` to retry — safe
5. If > 7 days stuck: escalate to operator, notify worker
6. Document delay reason (provider constraint, network outage)

## P2: AI Provider Outage

1. Pipeline automatically returns `inconclusive` (Spec §15.1 Scenario 6)
2. No worker penalty is applied
3. Monitor for recovery
4. If outage > 4 hours: switch to fallback provider (ADR-001 chain)
5. If all providers down: escalate to operator

---

## Escalation Contacts

| Role | Responsibility | Contact |
|---|---|---|
| Incident Owner | Triage, coordination | _Must be configured before launch_ |
| Engineering Lead | Technical investigation | _Must be configured before launch_ |
| Operations | User communication | _Must be configured before launch_ |
| Finance | Ledger/fund issues | _Must be configured before launch_ |

---

## Post-Incident

1. Write incident report within 48 hours
2. Root cause analysis (5 Whys or equivalent)
3. Corrective actions with owners and deadlines
4. Update relevant runbooks if process gaps were found
5. Add regression test if applicable