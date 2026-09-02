# Runbook

## Common operations

### Restart API / workers

```bash
docker compose -f docker-compose.production.yml restart api worker
```

### Check health

```bash
curl -fsS https://example.com/health/ready
curl -fsS https://example.com/system/version
```

### Queue stuck / failed emails

1. Admin → System Status — note pending/failed counts.
2. Inspect Redis queues if `REDIS_URL` set.
3. Re-drive failed rows from `NotificationLog` (status `FAILED`) via admin email actions.
4. Confirm SMTP credentials on System Status (host/from only).

### Database migration

```bash
npm run license-db:migrate
npm run db:health --workspace @patrol/license-api
```

### Rotate JWT secret

1. Schedule maintenance window (all sessions invalidate).
2. Update `JWT_SECRET`, restart API + workers.
3. Users re-login.

### Stripe webhooks failing

1. Admin → Stripe operations — failed / dead-letter counts.
2. Confirm `STRIPE_WEBHOOK_SECRET` matches the endpoint in the correct mode (test vs live).
3. Reprocess event or resend from Stripe Dashboard.
4. See [StripeWebhookRunbook.md](./StripeWebhookRunbook.md).

### Disk / memory pressure

System Status → Runtime resources. Scale API/worker replicas; investigate large CSV exports and log volume.

## Alerts to wire (future)

- `/health/ready` failing
- Queue `failed` > threshold
- SMTP misconfigured in production
- Disk free < 15%
- Error reporter spike

## Escalation

1. On-call engineer
2. Platform owner
3. Customer communications (SupportGuide)
