# Stripe Architecture (Phase 5A)

## Principle

The **internal Billing Domain is the source of truth** for plans, subscriptions, invoices, payments, entitlements, and licence status.

Stripe is a **payment-provider adapter** and external event source. It must never bypass billing lifecycle commands.

```
Customer Checkout → pending Subscription + Invoice
                 → Stripe Checkout Session
Webhook (async)  → verify + store + queue
Worker           → reconcile Stripe objects
                 → Billing Domain commands
                 → Domain Events
                 → LicenceBillingSyncHandler → TG1
```

## Provider abstraction

| Type | Path |
|------|------|
| `PaymentProviderPort` | `apps/license-api/src/billing/providers/payment-provider.port.ts` |
| `PaymentProviderRegistry` | `.../payment-provider.registry.ts` |
| `StripePaymentProvider` | `.../stripe/stripe-payment.provider.ts` |
| `ManualPaymentProvider` | `.../providers/manual-payment.provider.ts` |

Billing services depend on the port/registry, not the Stripe SDK.

## Mapping tables

- `StripeCustomerMapping` — one Stripe Customer per organisation (per livemode)
- `StripePriceMapping` — internal Plan + interval → Stripe Price
- `StripeSubscriptionMapping` — internal Subscription ↔ Stripe Subscription
- `StripeCheckoutSession` — checkout attempt tracking
- `StripeWebhookEvent` — idempotent event capture
- `StripeReconciliationAlert` — mismatches that block activation

## Critical rules

1. Never activate from browser redirect or Checkout HTTP response.
2. Never trust browser-supplied amount, currency, or Stripe Price ID.
3. Never process the same `stripeEventId` twice for business effects.
4. Never issue licences from Stripe adapter code — only via domain events.
5. Amount/currency/mapping mismatches create alerts and **block** activation.
6. Never log or expose secret keys, webhook signatures, or client secrets.

## Related docs

- [StripeConfiguration.md](./StripeConfiguration.md)
- [StripeWebhookRunbook.md](./StripeWebhookRunbook.md)
- [StripeReconciliation.md](./StripeReconciliation.md)
- [BillingGracePeriod.md](./BillingGracePeriod.md)
