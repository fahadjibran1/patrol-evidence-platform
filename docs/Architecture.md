# Architecture

Patrol Evidence Platform — commercial licensing SaaS stack.

## Bounded contexts

| Context | Location | Responsibility |
|---------|----------|----------------|
| Licence | `apps/license-api/src/licences` | TG1 signing, immutable versions, installations |
| Billing | `apps/license-api/src/billing` | Plans, subscriptions, invoices, payments (manual + Stripe adapter) |
| Customer Org | `apps/license-api/src/customer-*` | Auth, members, invitations, sessions |
| Notifications | `apps/license-api/src/notifications` | Email templates + queue delivery |
| Admin Portal | `apps/license-portal` | Internal licence, billing & Stripe ops |
| Customer Portal | `apps/customer-portal` | Customer self-service + Stripe Checkout |
| Desktop | `desktop/`, `web/` | Electron patrol evidence client |

## Commercial flow

```
Subscription → Billing Domain Event → LicenceBillingSyncHandler → TG1
```

Billing never generates TG1. Licence never owns subscription lifecycle.

Stripe Checkout / webhooks are an adapter only. Activation and renewals run through Billing Domain commands after webhook reconciliation. See [StripeArchitecture.md](./StripeArchitecture.md).

## Runtime topology

- **API** — NestJS HTTP (`0.0.0.0:$PORT`)
- **Worker** — Nest application context + BullMQ consumers (`dist/worker.main.js`)
- **Postgres** — source of truth
- **Redis** — durable queues (optional locally; recommended in production)
- **Nginx** — TLS termination, rate limits, `/admin` + `/` + `/api` routing

## Cross-cutting

- Domain events (`EventBus`) — in-process pub/sub
- Audit log — admin + customer actors
- Metrics + health — `/health/*`, `/admin/metrics`, `/admin/system/status`
- Version — `/system/version`
- Error reporting — provider abstraction (console today)

See also: [Deployment.md](./Deployment.md), [Runbook.md](./Runbook.md).
