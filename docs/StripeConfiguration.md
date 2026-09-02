# Stripe Configuration

## Environment variables

| Variable | Required when enabled | Notes |
|----------|----------------------|-------|
| `STRIPE_ENABLED` | — | `true`/`false`. Disabled cleanly when unset/false. |
| `STRIPE_SECRET_KEY` | yes | `sk_test_…` or `sk_live_…` |
| `STRIPE_PUBLISHABLE_KEY` | yes | Never used for server authority |
| `STRIPE_WEBHOOK_SECRET` | yes | `whsec_…` |
| `STRIPE_API_VERSION` | no | Default `2024-11-20.acacia` |
| `STRIPE_CHECKOUT_SUCCESS_URL` | no | Must include `{CHECKOUT_SESSION_ID}` |
| `STRIPE_CHECKOUT_CANCEL_URL` | no | Customer cancel page |
| `STRIPE_BILLING_PORTAL_RETURN_URL` | no | Return from payment-method portal |
| `BILLING_GRACE_PERIOD_DAYS` | no | Default `7` |
| `BILLING_TERMS_VERSION` | no | Default `2026-07-01` |
| `STRIPE_WEBHOOK_MAX_ATTEMPTS` | no | Default `8` then DEAD_LETTER |
| `STRIPE_ADMIN_ALERT_EMAIL` | no | Reconciliation / dead-letter alerts |

## Startup behaviour

- Development: Stripe may be disabled with no secrets.
- Production: if `STRIPE_ENABLED=true`, missing secrets **fail startup**.
- Test and live keys must not be mixed. Mode is derived from secret key prefix.
- System status exposes `TEST` / `LIVE` / `DISABLED` only — never secrets.

## Stripe Billing Portal (Dashboard)

Phase 5A allows payment-method update only. In Stripe Dashboard → Settings → Billing → Customer portal:

- Enable **payment method update**
- Disable plan changes, cancellations, and subscription upgrades/downgrades

## Secret rotation

1. Create new key / webhook secret in Stripe Dashboard.
2. Update environment / secrets store.
3. Redeploy API + worker together.
4. For webhook secrets, run dual-secret period if using Stripe’s rolling secret support; otherwise briefly pause traffic and cut over.
5. Revoke old secret after verification.

Never commit secrets. See `.env.example` and `.env.production.example`.
