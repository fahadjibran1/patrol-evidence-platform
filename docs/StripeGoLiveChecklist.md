# Stripe Go-Live Checklist

- [ ] Internal Plans finalized (currency, monthly/annual minor units)
- [ ] Live Stripe Products/Prices created manually (not by app startup)
- [ ] Admin mapped each Plan interval to live Price IDs and validated
- [ ] `STRIPE_ENABLED=true` with **live** secrets only in production
- [ ] Webhook endpoint `https://<api>/webhooks/stripe` registered for live mode
- [ ] Webhook signing secret set; rotation plan documented
- [ ] Success/cancel/portal return URLs use production customer portal hosts
- [ ] Stripe Customer Portal limited to payment method updates
- [ ] `BILLING_GRACE_PERIOD_DAYS` agreed with support
- [ ] `BILLING_TERMS_VERSION` current
- [ ] Admin alert email configured
- [ ] Redis durable queues enabled for `stripe-webhooks`
- [ ] Test-mode keys removed from production env
- [ ] Scenario A–F from AcceptanceChecklist validated in test mode
- [ ] Monitoring: webhook failures, dead-letter, reconciliation alerts
- [ ] Support runbook reviewed
