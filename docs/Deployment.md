# Deployment

## Environments

| Env | Compose file | Notes |
|-----|--------------|-------|
| Development | `docker-compose.dev.yml` | Postgres + Redis + MailHog only; run API/portals via npm |
| Staging | `docker-compose.staging.yml` | Full stack, HTTP nginx |
| Production | `docker-compose.production.yml` | TLS nginx, internal network, worker replicas |

## Prerequisites

- Docker Engine 24+
- Node 22.x (local builds / CI)
- TLS certificates in `docker/nginx/certs/` for production (`fullchain.pem`, `privkey.pem`)
- Populated `.env.staging` or `.env.production` from `.env.production.example`

## Deploy steps (production)

1. **Backup** database (`npm run db:backup --workspace @patrol/license-api`).
2. Pull release tag / build images: `npm run docker:production`.
3. Run migrations against production DB: `npm run license-db:migrate` (or one-shot migrate container).
4. Start/roll: `postgres` → `redis` → `api` → `worker` → portals → `nginx`.
5. Verify:
   - `GET /health/live`
   - `GET /health/ready`
   - `GET /system/version`
   - Admin login + System Status page (Stripe mode if enabled)
6. If Stripe enabled: confirm webhook endpoint + `STRIPE_WEBHOOK_SECRET`, price mappings, and queue `stripe-webhooks`.
7. Smoke acceptance checklist (see [AcceptanceChecklist.md](./AcceptanceChecklist.md)).

Stripe env vars: [StripeConfiguration.md](./StripeConfiguration.md).

## CI/CD

- **CI** — `.github/workflows/ci.yml` (install, lint, test, prisma validate, build, artifacts)
- **Release** — `.github/workflows/release.yml` (tag `vX.Y.Z`, desktop package, GitHub release)
- **Deploy** — `.github/workflows/deploy-prepare.yml` (manual prepare only; wire secrets before enabling auto-deploy)

## Rollback

1. Point nginx/API to previous image tag.
2. If a migration is irreversible, restore from the pre-deploy backup (see [DisasterRecovery.md](./DisasterRecovery.md)).
3. Prefer forward-fix migrations; keep rollback SQL notes in the PR.

## Render / PaaS note

API binds `0.0.0.0:$PORT`. Filesystem is ephemeral — use Postgres + object storage; never rely on local disk for TG1 or uploads.
