# Stripe Webhook Runbook

## Endpoint

`POST /webhooks/stripe`

- No JWT
- Requires `Stripe-Signature`
- Uses Nest `rawBody: true` for exact body verification
- Returns 2xx quickly after durable `StripeWebhookEvent` insert + enqueue
- Queue: `stripe-webhooks`

## Processing statuses

`RECEIVED` → `PROCESSING` → `PROCESSED` | `IGNORED` | `FAILED` → `DEAD_LETTER`

Duplicates of the same `stripeEventId` return `{ duplicate: true }` without re-running business commands.

## Supported events (Phase 5A)

| Event | Role | Internal effect |
|-------|------|-----------------|
| `checkout.session.completed` | Authoritative for first purchase | Payment + invoice paid + activate subscription |
| `checkout.session.expired` | Authoritative | Expire pending checkout intent |
| `invoice.paid` | Authoritative for renewals | Idempotent payment + renew period |
| `invoice.payment_failed` | Authoritative | Failed payment + PAST_DUE |
| `invoice.payment_action_required` | Authoritative notify | Alert + customer notice |
| `customer.subscription.updated` | Reconciliation facts | Period / cancel-at-period-end sync |
| `customer.subscription.deleted` | Authoritative cancel | Cancel/expire internal subscription |
| `customer.subscription.created` | Informational / sync | Mapping refresh |
| `invoice.created` / `finalized` | Informational | Stored, no activation |
| `payment_intent.*` | Informational | Prefer invoice events for money |
| `charge.refunded` / `dispute.created` | Informational alert | Admin visibility; no auto-refund loop |

Unknown events: stored metadata, marked `IGNORED`.

## Recovery

1. Admin Portal → Stripe operations → Failed / Dead-letter webhooks.
2. `POST /admin/stripe/webhooks/:eventId/reprocess` (elevated role, audited).
3. Or Stripe Dashboard → Webhooks → Resend.
4. Confirm internal invoice/payment/subscription converge without duplicates.

## Do not

- Process full billing inside the HTTP request thread
- Trust event payload alone when current Stripe state is required — re-fetch objects
- Assume delivery order
