# Disaster Recovery

## RPO / RTO targets (recommended)

| Tier | RPO | RTO |
|------|-----|-----|
| Production | ≤ 24h (ideally continuous WAL / daily logical dump) | ≤ 4h |
| Staging | Best effort | Best effort |

## Backup

```bash
export LICENSE_DATABASE_URL=...
npm run db:backup --workspace @patrol/license-api
# → backups/license-db-<timestamp>.sql
```

Also retain:

- Ed25519 signing private key (offline / HSM / secret store)
- `LICENCE_STORAGE_ENCRYPTION_KEY`
- `JWT_SECRET`
- TLS certificates
- `.env.production` (secrets manager)

Schedule daily `pg_dump` + weekly restore drill.

## Restore

```bash
export LICENSE_DATABASE_URL=...
export CONFIRM_RESTORE=YES
npm run db:restore --workspace @patrol/license-api -- path/to/backup.sql
npm run license-db:migrate
npm run db:health --workspace @patrol/license-api
```

## Recovery procedure

1. Declare incident; freeze deploys.
2. Restore Postgres from last known-good dump (or managed snapshot).
3. Restore secrets to the runtime environment.
4. Start Redis (empty is OK — queued emails may need re-drive from `NotificationLog`).
5. Start API + workers; confirm `/health/ready`.
6. Spot-check: admin login, recent licences, subscription list, customer download.
7. If Stripe enabled: confirm webhook secret, reprocess any `FAILED`/`DEAD_LETTER` events, and reconcile open alerts ([StripeReconciliation.md](./StripeReconciliation.md)).
8. Communicate status (see Customer communication checklist in [ReleaseManagement.md](./ReleaseManagement.md)).

## What cannot be recovered from DB alone

- Lost signing private key → cannot issue matching TG1s for that `LICENSE_SIGNING_KEY_ID`
- Lost encryption key → cannot decrypt stored TG1 blobs
- Lost Stripe webhook signing secret → register a new endpoint secret and update `STRIPE_WEBHOOK_SECRET`

Rotate keys only with a documented dual-key period.
