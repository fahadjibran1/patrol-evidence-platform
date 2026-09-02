# Stripe Reconciliation

## When activation stops

Automatic activation/renewal stops when:

- Amount (integer minor units) mismatches internal invoice
- Currency mismatches
- Required internal references are missing
- Mapped Stripe Price does not match internal plan expectations

Result:

1. `StripeReconciliationAlert` created (`OPEN`)
2. Admin notification (if configured)
3. Audit `stripe.reconciliation.mismatch`
4. Metric `stripe_reconciliation_mismatch_total`
5. **No licence issuance**

## Admin APIs

| Method | Path |
|--------|------|
| POST | `/admin/stripe/reconcile/customer/:organisationId` |
| POST | `/admin/stripe/reconcile/subscription/:subscriptionId` |
| POST | `/admin/stripe/reconcile/invoice/:invoiceId` |
| POST | `/admin/stripe/webhooks/:eventId/reprocess` |

All require elevated admin roles and write audit records.

## Procedure

1. Open Stripe operations → Reconciliation alerts.
2. Compare internal Invoice/Payment/Subscription with Stripe Dashboard (correct mode).
3. Fix mapping or internal draft invoice if the internal side is wrong.
4. Reprocess the webhook or reconcile the entity.
5. Confirm subscription activation only after amounts match.
6. Confirm licence version via domain event path, not Stripe UI.

## Orphans

Detect:

- Stripe customers without organisation mapping
- Active internal subscriptions without valid Stripe subscription state
- Paid Stripe invoices with no internal payment row

Use reconcile endpoints + alerts; do not silently rewrite internal plan prices from Stripe.
