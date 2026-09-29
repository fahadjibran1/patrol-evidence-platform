# PatrolSafe production commercial foundation

The proposed public origin is `https://licensing.sfour.co.uk`. The production
Blueprint is deliberately disabled and must not be deployed as a payment-taking
service until every release blocker below is closed.

## Mode boundary

- `DISABLED`: no Stripe Checkout or webhook processing.
- `STAGING_TEST`: existing explicit staging gates, test credentials, and
  `livemode=false` Stripe objects only.
- `PRODUCTION_LIVE`: explicit production mode, a restricted `rk_live_` key,
  `livemode=true` objects, isolated production configuration, UK-only policy,
  approved inclusive VAT TaxRate and one-time invoice creation.

Production has no inferred Stripe mode and never accepts `COMMERCIAL_TEST_*`
signing configuration, staging URLs, or a database URL identifiable as staging,
sandbox, test, or local.

## Manual resources

Create an isolated production PostgreSQL database with point-in-time or tested
scheduled backups; the independently named production Render service; the
`licensing.sfour.co.uk` DNS record; live Stripe Product, one-off Price,
restricted key and webhook; a production Ed25519 signing provider and offline
recovery backup; and production Resend credentials/sender/webhook.

The service runs Prisma migrations before startup, processes the durable
PostgreSQL outbox in the same process for the initial low-volume launch, stores
encrypted licence artifacts in PostgreSQL, and uses provider logs plus the
application audit trail. `/health/live` is process liveness. `/health/ready`
returns HTTP 503 only when PostgreSQL is unavailable; email and queue provider
status remains operational telemetry rather than core process readiness.

## Live-payment blockers

Live mode is compile-time fail-closed until a production signing provider is
implemented and approved. It also requires accountant approval, an inclusive
Stripe TaxRate, invoice creation, exact live Stripe objects, production terms
and privacy versions, operator MFA approval, database backup/restore proof, and
a controlled clean-machine production UAT.

## Recovery and rollback

Take and verify a database backup before every migration. Retain the previous
immutable image digest and configuration version. Roll back application code to
that digest only when its schema is forward-compatible; database restoration is
an explicit incident procedure and must never be attempted over a live database.
Keep commercial mode disabled during restoration and reconcile Stripe events
before re-enabling traffic.
