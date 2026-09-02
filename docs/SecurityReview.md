# Security Review (Phase 4D)

Scope: Licence API, Admin Portal, Customer Portal, Billing (including Stripe adapter), Queues, Exports.

Stripe controls: webhook signature verification, raw-body handling, no PAN storage, browser amounts/prices rejected, secrets redacted from status endpoints, Checkout redirect never trusted as payment proof.

## Findings

### High

| ID | Finding | Mitigation |
|----|---------|------------|
| H1 | Signing private key + encryption key are single points of catastrophic failure | Store in secret manager / HSM; offline backups; dual-key rotation runbook |
| H2 | Production without `REDIS_URL` runs email inline (weaker durability, shared process load) | Require Redis in production compose; startup warn already present |
| H3 | Manual payment recording is trust-bound to ADMIN role | Keep SUPPORT read-only; audit all payments; dual-control for large amounts (future) |

### Medium

| ID | Finding | Mitigation |
|----|---------|------------|
| M1 | JWT secret rotation invalidates all sessions abruptly | Document maintenance window; consider dual-secret overlap later |
| M2 | CSV exports can include PII (emails, company data) | Role gates on revenue/billing exports; audit download actions (future enhancement) |
| M3 | Invitation / reset tokens returned in non-production responses | Ensure `NODE_ENV=production` never returns raw tokens |
| M4 | Nginx CSP is strict — verify portal assets don't need extra CDNs | Adjust CSP only with security review |
| M5 | Rate limits are nginx + Nest throttler; auth routes need tighter limits | Auth zone `5r/s` in nginx; Nest Throttler 120/min global |

### Low

| ID | Finding | Mitigation |
|----|---------|------------|
| L1 | Swagger can be enabled in staging | Disable in production via `LICENSE_API_ENABLE_SWAGGER=false` |
| L2 | System status exposes hostnames (SMTP host) | Acceptable; never exposes passwords |
| L3 | Error reporter stub for Sentry not yet production-wired | Keep console provider until vendor configured |

## Controls verified

- Authentication: separate admin vs customer JWT audiences
- Authorisation: role + permission guards; org isolation on customer routes
- Headers: helmet + nginx HSTS/CSP/XFO/nosniff
- Passwords: bcrypt hashed; reset tokens hashed at rest
- Logging: redacts password/token/secret/tg1/jwt/smtp
- Downloads: permission + licence status checks
- Queue: Redis network on internal docker network; no public expose

## Residual risk

No MFA/SSO (explicitly out of scope). Compensating controls: strong passwords, session revoke, audit trail.

## RC1

Formal findings pack: [RC1-SecurityAudit](RC1-SecurityAudit.md) · Pen-test: [RC1-PenetrationTestChecklist](RC1-PenetrationTestChecklist.md).
