# Administrator Guide

## Daily ops

1. Review Dashboard KPIs + billing metrics (MRR/ARR).
2. Process renewal queue.
3. Record manual payments against open invoices.
4. Monitor System Status (DB, Redis, SMTP, queues).

## Issuing commercial licences

Preferred path (Phase 4C+):

1. Ensure customer/organisation exists.
2. Create subscription on a plan (trial or active).
3. Record payment when invoice is paid.
4. Licence sync issues/renews TG1 from billing events.

Legacy path: Issue licence directly from Licences UI (still supported).

## Users

- Create customer portal users via invitations or `license-customer-user:create`.
- Never share SUPER_ADMIN credentials.

## Exports

System Status → CSV exports (customers, licences, renewals, revenue, notifications, audit, billing CSVs via `/admin/exports/*`).

## Stripe operations

1. Map each public Plan’s monthly/annual prices to Stripe Price IDs (Admin → Stripe operations).
2. Validate mappings (currency, interval, amount, livemode).
3. Monitor webhook backlog, failures, dead-letters, and reconciliation alerts.
4. Reprocess failed webhooks only after reviewing the alert cause.
5. Never paste secret keys into the portal; secrets stay in environment configuration.

See [StripeArchitecture.md](./StripeArchitecture.md) and [StripeGoLiveChecklist.md](./StripeGoLiveChecklist.md).

## Support operations (RC1)

Admin portal → **Support ops**:

- Resend failed notifications
- Unlock admin/customer login rate limits (+ reactivate)
- Rebuild licence from subscription (publishes plan-change sync)
- Stripe organisation resync
- Webhook reprocess
- Reset customer billing flags (SUPER_ADMIN)

## Security

- SUPPORT cannot record payments or issue licences.
- All lifecycle actions are audited.

## RC1 readiness

See [RC1-GoLiveReport](RC1-GoLiveReport.md).
