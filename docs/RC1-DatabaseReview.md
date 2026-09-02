# RC1 Database Review

## Index posture

Billing and licence hot paths already carry covering indexes:

- `Subscription(organisationId, status, nextBillingDate, currentPeriodEnd, pendingCheckout, planChangeEffectiveAt)`
- `Invoice(subscriptionId, status, dueAt, issuedAt)` + unique `number`
- `BillingPayment(invoiceId, status, provider, receivedAt)` + unique `(provider, providerReference)`
- `StripeWebhookEvent` unique `stripeEventId` + status/type/receivedAt
- `StripeCheckoutSession` unique session + idempotency key
- `Licence(customerId, status, expiresAt)` + unique `licenseId`
- `NotificationLog(status, recipient, createdAt, customerId)`
- `AuditLog` time/actor indexes (existing)

## Constraints & cascades

| Area | Strategy |
|------|----------|
| Billing graph (Subscription/Invoice/Payment) | Restrict/default deletes — preserve money/audit integrity |
| Licence versions / installations | Cascade from Licence |
| Customer auth tokens / invitations | Cascade with user/org |
| Stripe mappings | No cascade — manual cleanup via support/reconcile |

## Retention recommendations

| Data | Hot retention | Archive |
|------|---------------|---------|
| AuditLog | 24 months online | Export then cold store |
| NotificationLog | 12 months | Truncate SENT older than 12m |
| StripeWebhookEvent | 90 days SUCCESS; retain DEAD_LETTER 12 months | |
| Invoice/Payment | Life of customer + 7 years (finance) | |
| LicenceVersion | Life of licence | Never hard-delete issued versions |

## Growth projections (indicative)

Assumptions: 500 orgs year-1, 1 subscription each, monthly invoice, ~20 audit events/org/month.

| Table | Y1 rows | Y3 rows |
|-------|---------|---------|
| Customer / Subscription | ~0.5k | ~2k |
| Invoice | ~6k | ~70k |
| BillingPayment | ~6k | ~70k |
| AuditLog | ~120k | ~1.5M |
| StripeWebhookEvent | ~50k | ~600k |
| LicenceVersion | ~5k | ~40k |

Postgres sizing: start **20–50 GB** SSD; monitor `pg_stat_user_tables` bloat quarterly.

## Archiving

- Prefer soft status transitions over hard deletes for subscriptions/invoices
- Use existing CSV export caps; stream exports post-v1 if >20k rows needed
- Queue cleanup: prune BullMQ completed jobs >7 days; retain failed 30 days

## RC1 actions completed

- Documented cascade philosophy (restrict on financial graph)
- Confirmed unique constraints for Stripe idempotency
- No blocking missing index for current page sizes (≤100)
