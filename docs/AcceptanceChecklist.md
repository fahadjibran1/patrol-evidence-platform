# Production Acceptance Checklist

Use after every staging/production deploy.

## Identity & organisation

- [ ] Create organisation (customer)
- [ ] Invite user (Owner/Admin)
- [ ] Accept invitation + login
- [ ] Change role / disable user
- [ ] Organisation isolation (user B cannot see org A)

## Billing

- [ ] Create subscription (active or trial)
- [ ] Invoice created
- [ ] Record manual payment (bank transfer)
- [ ] Invoice marked PAID
- [ ] Dashboard MRR/ARR updates (admin)

## Stripe Checkout (Phase 5A)

- [ ] Admin maps Plan → Stripe Prices (test mode) and validates
- [ ] Customer Checkout creates pending subscription + open invoice only
- [ ] Completing test payment activates via webhook (not redirect)
- [ ] Duplicate webhook delivery creates one payment / one activation
- [ ] `invoice.paid` renews period + licence via domain events
- [ ] `invoice.payment_failed` → PAST_DUE + grace period (no premature revoke)
- [ ] Amount/currency mismatch blocks activation + admin alert
- [ ] Manage payment method portal opens (payment method only)
- [ ] System Status shows Stripe mode without secrets

## Licensing

- [ ] Licence generated/synced from subscription activation
- [ ] Email licence (SMTP configured)
- [ ] Customer downloads TG1
- [ ] Renew subscription → licence renewed / new version
- [ ] Immutable version history visible on licence detail

## Platform ops

- [ ] Background worker processes email job (Redis mode)
- [ ] NotificationLog shows SENT
- [ ] CSV export downloads (customers / licences / subscriptions)
- [ ] `/health/ready` returns OK
- [ ] `/system/version` shows expected APP_VERSION + migration
- [ ] Admin System Status shows DB/Redis/SMTP/queue/runtime
- [ ] Database backup script succeeds
- [ ] Restore drill on non-prod (CONFIRM_RESTORE=YES)

## Sign-off

| Role | Name | Date |
|------|------|------|
| Engineer | | |
| Reviewer | | |
