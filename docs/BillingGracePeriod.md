# Billing Grace Period

Configured by `BILLING_GRACE_PERIOD_DAYS` (default **7**).

## Licence behaviour by subscription status

| Status | Billing meaning | Licence behaviour (Phase 5A) |
|--------|-----------------|------------------------------|
| `PAST_DUE` | Renewal payment failed | Licence **not** immediately revoked. Existing grace rules apply; customer notified to update payment method. |
| `SUSPENDED` | Admin or policy suspension | Licence sync handlers apply suspension rules already defined in Billing → Licence event flow. |
| `CANCELLED` | Ended by provider/admin | Immediate cancel → licence **SUSPENDED**. Cancel-at-period-end keeps licence until expire. |
| `EXPIRED` | Period ended without renewal | Licence → **EXPIRED** (portal downloads blocked; desktop TG1 remains offline-crypto until natural date). |

## Failed renewal flow

1. `invoice.payment_failed` recorded
2. Subscription → `PAST_DUE`
3. Customer notification (`PAYMENT_FAILED` dedupe key)
4. Portal shows past-due warning + Manage payment method
5. Licence remains usable during grace unless existing suspend/expire jobs intervene later

Do **not** revoke solely because Stripe emitted `payment_failed` once.
