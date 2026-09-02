# Stripe Testing

## Automated (CI)

- Unit tests: adapter status mapping, payload hash dedupe, amount/currency rules
- Integration tests: invalid webhook signature rejection, unique `stripeEventId`, pending checkout not active
- Stripe SDK calls are doubled / not required for CI
- CI must not depend on Stripe network availability

Optional smoke (local only):

```bash
# set STRIPE_SMOKE=1 and real test-mode keys, then run a dedicated smoke script if present
```

## Local Stripe CLI

```bash
stripe login
stripe listen --forward-to localhost:3010/webhooks/stripe
# copy the printed whsec_… into STRIPE_WEBHOOK_SECRET

stripe products create --name "Patrol Starter"
stripe prices create --product prod_xxx --unit-amount 1000 --currency gbp --recurring interval=month

stripe trigger checkout.session.completed
stripe events resend evt_xxx
```

Map the test Price IDs in Admin → Stripe operations (or `POST /admin/stripe/price-mappings`).

Complete Checkout with Stripe test cards (`4242…`). Confirm:

1. Webhook stored
2. Internal payment + paid invoice
3. Subscription ACTIVE
4. Licence version via domain event
5. Customer notification (deduped)

## Duplicate delivery

Resend the same event twice. Expect one internal payment and one activation transition.
