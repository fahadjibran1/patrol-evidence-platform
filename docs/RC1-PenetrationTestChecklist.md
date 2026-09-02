# RC1 Penetration Test Checklist

Use this checklist for independent or internal pen-test engagements before and after go-live.

## OWASP Top 10 mapping

| OWASP | Focus areas | Pass criteria |
|-------|-------------|---------------|
| A01 Broken Access Control | Org isolation, role escalation, IDOR on licences/invoices | Cross-org IDs return 403/404 |
| A02 Cryptographic Failures | JWT secrets, TG1 signing key, encryption key at rest | No secrets in repo/logs; TLS everywhere |
| A03 Injection | Prisma queries, CSV export fields, search filters | Parameterised queries only; no raw string concat with user input |
| A04 Insecure Design | Checkout amount trust, plan spoofing, duplicate renewals | Server-side plan/price; webhook-only activation |
| A05 Security Misconfiguration | Swagger, CORS, Helmet, nginx headers | Production swagger off; secure headers present |
| A06 Vulnerable Components | npm audit, Stripe SDK, Nest | No critical unpatched deps at freeze |
| A07 Identification/Auth Failures | Brute force, refresh reuse, inactive accounts | Rate limits; refresh rotation; inactive blocked |
| A08 Software/Data Integrity | Webhook replay, unsigned webhooks | Signature required; event id unique |
| A09 Logging/Monitoring Failures | Audit gaps, DLQ alerts | Support ops + Stripe DLQ visible |
| A10 SSRF | Outbound Stripe/SMTP only | No user-controlled fetch URLs |

## Broken authentication

- [ ] Admin login brute force → 429
- [ ] Customer login brute force → 429
- [ ] Unlock via support ops clears lockout
- [ ] Refresh token reuse after logout fails
- [ ] Inactive admin/customer cannot authenticate
- [ ] JWT with wrong audience rejected

## Broken access control

- [ ] Customer A cannot read Customer B licences
- [ ] Customer A cannot mutate Customer B billing
- [ ] SUPPORT cannot record manual payments / rebuild licences (as designed)
- [ ] FINANCE cannot invite owners without permission
- [ ] Admin cannot spoof `organisationId` on customer routes via JWT claims

## Business logic abuse

- [ ] Plan upgrade to cheaper plan rejected as upgrade
- [ ] Downgrade does not reduce entitlements until effective date
- [ ] Duplicate renewal while pendingCheckout blocked
- [ ] Duplicate cancel / undo cancel race safe
- [ ] Checkout success URL alone does not activate
- [ ] Proration/preview amounts not trusted on confirm

## Webhook / payment integrity

- [ ] Missing Stripe signature → reject
- [ ] Replay same `stripeEventId` → idempotent no-op
- [ ] Amount/currency mismatch → block activation + alert
- [ ] Dead-letter reprocess requires admin auth
- [ ] Fake `session_id` status poll does not grant access

## Organisation isolation

- [ ] Invoices, payments, subscriptions scoped
- [ ] Notification history scoped
- [ ] Downloads scoped + status gated
- [ ] Support reset-state requires SUPER_ADMIN

## XSS / CSRF

- [ ] Portals escape user-provided company names in UI
- [ ] API is Bearer-token (not cookie session) — CSRF risk low
- [ ] CSP blocks inline scripts in nginx production config

## Sign-off

| Role | Name | Date | Result |
|------|------|------|--------|
| Security reviewer | | | |
| Engineering lead | | | |
| Operations | | | |
