# RC1 Security Audit — Formal Findings

**Scope:** Licence API, Admin Portal, Customer Portal, Billing Domain, Stripe adapter, queues, exports, support ops.  
**Date:** 2026-07-23  
**Classification:** Release Candidate RC1 (production readiness)

## Executive summary

Controls for authentication, organisation isolation, Stripe webhook verification, and billing amount authority are in place and covered by automated tests. Residual risks are concentrated in operational secret handling, Redis-backed durability, and post-v1 MFA/SSO.

## Findings register

### Critical

None open for RC1 launch criteria.

### High

| ID | Finding | Status | Mitigation |
|----|---------|--------|------------|
| H1 | Signing private key + encryption key are catastrophic single points of failure | Accepted with controls | Secret manager / HSM; offline sealed backups; documented rotation |
| H2 | Production without Redis runs email inline | Mitigated in compose | Require `REDIS_URL` + worker in production compose; startup warning |
| H3 | Manual payment recording is trust-bound to ADMIN | Accepted | SUPPORT read-only; full audit; dual-control deferred to post-v1 |

### Medium

| ID | Finding | Status | Mitigation |
|----|---------|--------|------------|
| M1 | JWT secret rotation invalidates all sessions | Documented | Maintenance window; dual-secret overlap post-v1 |
| M2 | CSV exports may include PII | Accepted | Role gates + audit; row caps |
| M3 | Invitation / reset tokens in non-prod responses | Mitigated | `NODE_ENV=production` omits raw tokens |
| M4 | Auth login rate limits are in-process Maps | Accepted for RC1 | Unlock support tool; Redis shared limiter post-v1 |
| M5 | Sentry stub not production-wired | Accepted | Console reporter until vendor configured |

### Low

| ID | Finding | Status | Mitigation |
|----|---------|--------|------------|
| L1 | Swagger may be enabled in staging | Mitigated | Disable via `LICENSE_API_ENABLE_SWAGGER=false` in production |
| L2 | System status exposes SMTP hostname | Accepted | Never exposes credentials |
| L3 | Support resend cannot reconstruct original HTML attachments | Accepted | Portal download + licence reissue paths |

## Control verification matrix

| Control | Result |
|---------|--------|
| Authentication (admin vs customer JWT audiences) | Pass |
| Authorisation (roles + customer permissions) | Pass |
| Organisation isolation on customer routes | Pass (integration) |
| Stripe webhook signature + raw body | Pass |
| Browser amount/price/plan not authoritative | Pass |
| Helmet + nginx HSTS/CSP | Pass (config) |
| Rate limiting (Nest throttler + nginx zones) | Pass |
| Secrets redaction in logs/status | Pass |
| Licence download permission checks | Pass |
| Audit logging for lifecycle + support ops | Pass |

## Stripe-specific

- Webhook signature verification required; unsigned rejected
- Checkout redirect never activates subscription
- Idempotent `stripeEventId` uniqueness
- Dead-letter + admin reprocess path
- No PAN storage; Billing Portal for card updates only

## Residual risk statement

No MFA/SSO in v1.0 (explicit non-goal). Compensating controls: strong passwords, session revoke, rate limits, audit trail, support unlock tooling.
