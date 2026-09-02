# RC1 Go-Live Report

**Product:** Patrol Evidence Platform — Licence & Billing SaaS  
**Candidate:** RC1 / v1.0.0 readiness  
**Date:** 2026-07-23

## Launch readiness score

| Area | Score (0–10) | Notes |
|------|--------------|-------|
| Functional completeness | 9 | Billing, Stripe, portals, self-service complete |
| Automated certification | 9 | RC1 integration scenarios 1–5 + support ops |
| Security | 8 | Formal audit; MFA deferred |
| Performance / capacity | 7 | Structural review + load harness; live soak pending |
| Operations | 8 | Runbooks + support tools; alerting wiring environment-specific |
| Documentation | 9 | RC1 pack + cross-links |
| **Overall** | **8.3 / 10** | **Go / No-Go: CONDITIONAL GO** |

**Conditional GO** means: proceed to production cutover after completing [Operations Checklist](RC1-OperationsChecklist.md) and [Stripe Go-Live Checklist](StripeGoLiveChecklist.md) in the target environment.

## Known limitations (v1.0)

- No MFA / SSO
- No Stripe Elements / multi-currency / Connect / usage billing
- Invoice PDF download is placeholder
- Sentry / Prometheus not vendor-wired (stub / in-process metrics)
- Auth rate limits are per-process (not Redis-shared)
- Support notification resend sends a support notice (original HTML/attachments not stored)
- Desktop TG1 cannot be remotely killed; portal status gates downloads

## Risk register

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Stripe livemode misconfiguration | M | H | Go-live checklist; price mapping validate |
| Webhook downtime → delayed activation | M | H | DLQ + reprocess; monitoring |
| Signing key loss | L | Critical | Offline backups; dual custody |
| Grace-period abuse | L | M | Configurable days; admin override |
| Multi-instance auth lockout inconsistency | M | L | Unlock tool; Redis limiter post-v1 |

## Operational checklist (summary)

1. Backup + restore drill  
2. Redis + worker confirmed  
3. Stripe webhook endpoint + secrets  
4. External health probes + DLQ alert  
5. Support ops access for on-call  
6. First customer dry-run in staging  

Full list: [RC1-OperationsChecklist](RC1-OperationsChecklist.md).

## Recommended production sizing

| Component | Starter (≤200 orgs) | Growth (≤2k orgs) |
|-----------|---------------------|-------------------|
| API | 1× 1 vCPU / 1 GB | 2× 2 vCPU / 2 GB |
| Worker | 1× 1 vCPU / 1 GB | 2× 1 vCPU / 2 GB |
| Postgres | 1× 2 vCPU / 4 GB / 50 GB SSD | 2–4 vCPU / 8 GB / 200 GB |
| Redis | 256 MB | 1 GB |
| Nginx | shared edge | shared edge |

## Expected capacity (indicative)

- Concurrent customer portal sessions: **100–250** on starter sizing
- Licence downloads: **20–50 /s** short burst (CPU signing bound)
- Stripe webhooks: **50–100 /s** with Redis queue (dedupe + processor)
- Checkout session creation: **10–30 /s** (Stripe API bound)
- Notification batch: prefer worker replicas; avoid inline mode

Run `node scripts/rc1-load-harness.js` against staging with tokens for measured RPS.

## First customer onboarding guide

1. Create organisation (admin portal)  
2. Invite OWNER / ADMINISTRATOR (customer org)  
3. Map Stripe prices for plan × interval ([StripeConfiguration](StripeConfiguration.md))  
4. Customer completes Checkout → wait for webhook (do not trust redirect alone)  
5. Confirm subscription ACTIVE + licence issued  
6. Customer downloads TG1 from portal  
7. Share [CustomerGuide](CustomerGuide.md) + support contact  
8. Monitor first renewal / payment method portal once  

## Recommended go-live date

**Earliest:** **2026-08-05** (after staging soak ≥ 7 days and restore drill)  
**Target window:** **2026-08-05 → 2026-08-12**

## Remaining work after v1.0

- MFA / SSO  
- Redis-shared auth rate limits  
- Invoice PDFs  
- Prometheus / Sentry production wiring  
- Card-expiring scheduler polish  
- Streamed CSV exports  
- Enterprise contract / exception UI polish  

## Document index (RC1)

| Document | Purpose |
|----------|---------|
| [RC1-SecurityAudit](RC1-SecurityAudit.md) | Formal security findings |
| [RC1-PenetrationTestChecklist](RC1-PenetrationTestChecklist.md) | Pen-test OWASP checklist |
| [RC1-DatabaseReview](RC1-DatabaseReview.md) | Indexes, cascades, growth |
| [RC1-OperationsChecklist](RC1-OperationsChecklist.md) | Day-0/Day-2 ops |
| [RC1-PerformanceAddendum](RC1-PerformanceAddendum.md) | Perf tuning notes |
| [PerformanceReview](PerformanceReview.md) | Baseline performance review |
| [SecurityReview](SecurityReview.md) | Phase 4D security review |
| [AcceptanceChecklist](AcceptanceChecklist.md) | Post-deploy acceptance |
| [StripeGoLiveChecklist](StripeGoLiveChecklist.md) | Live Stripe cutover |
