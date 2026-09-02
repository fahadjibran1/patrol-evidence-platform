# RC1 Operations Checklist

Cross-references: [Deployment](Deployment.md) · [ReleaseManagement](ReleaseManagement.md) · [DisasterRecovery](DisasterRecovery.md) · [Runbook](Runbook.md) · [StripeWebhookRunbook](StripeWebhookRunbook.md) · [BACKUP_AND_RECOVERY](../apps/license-api/docs/BACKUP_AND_RECOVERY.md)

## Backups & restore

- [ ] Automated Postgres backup schedule verified (`npm run db:backup` / managed provider snapshots)
- [ ] Restore drill completed in staging within RTO target
- [ ] Signing key + encryption key sealed backups offline
- [ ] Backup encryption and access list documented

## Monitoring & alerts

- [ ] `/health` and `/admin/system/status` probed externally
- [ ] Alert: API 5xx rate
- [ ] Alert: Stripe webhook dead-letter count > 0
- [ ] Alert: queue failed jobs
- [ ] Alert: SMTP send failures
- [ ] Alert: disk / Postgres connections

## Logs & retention

- [ ] Central log shipping configured (or host journal retention ≥ 30 days)
- [ ] PII/redaction policy confirmed
- [ ] AuditLog retention policy agreed (see Database Review)

## Queues

- [ ] Redis required in production
- [ ] Dedicated worker process running (`license-api:worker`)
- [ ] Dead-letter recovery: Stripe admin UI / `POST /admin/support/webhooks/:id/reprocess`
- [ ] Failed notification resend via Support ops

## Release & rollback

- [ ] Tag `v1.0.0-rc1` (or release candidate tag) cut from green CI
- [ ] Migrations applied with backup taken first
- [ ] Rollback plan reviewed ([ReleaseManagement](ReleaseManagement.md))
- [ ] Feature flags / Stripe livemode checklist ([StripeGoLiveChecklist](StripeGoLiveChecklist.md))

## Support readiness

- [ ] Support ops page accessible to ADMIN/SUPPORT
- [ ] Runbook links shared with on-call
- [ ] First-customer onboarding guide reviewed ([RC1-GoLiveReport](RC1-GoLiveReport.md))
