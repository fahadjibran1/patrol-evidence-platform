# PatrolSafe v1.0.3 commercial Phase 6B lean staging record

Date: 23 September 2026

Source baseline: `959eb89ba30e10c0230ece8d3c8267c98b459d60`

Branch: `v1.0.3-commercial-licensing`

## Decision

Phase 6 external staging will use one free Render Docker web service and one
isolated Supabase Free PostgreSQL project. The single web process hosts the
licence API, customer staging pages, operator portal, and the PostgreSQL-backed
outbox worker. It does not use Redis, a second worker, separate portal services,
a custom staging domain, or paid monitoring.

This is a staging cost optimisation, not a claim that a free sleeping service
is the final production-scale architecture. Cold starts are acceptable for the
first Stripe test. Early live sales may retain operator-controlled manual/offline
production `.tglic` signing rather than putting the production signing key in an
internet-facing service.

## Existing infrastructure inventory

- Vercel: the existing `s4-website` and `sfour-app` projects are on a Hobby
  account. The live v1.0.2 acquisition remains untouched. Hobby is not selected
  for the commercial service because its terms are for personal/non-commercial
  use.
- Supabase: the visible `S4Security` organisation is Pro and contains existing
  projects. A further project in that organisation reports a $10/month cost, so
  none was created. A separate Free organisation/project is required to avoid
  both incremental cost and data/blast-radius mixing.
- Render: no authenticated CLI/API connection is available. A free Blueprint is
  prepared but no service exists yet.
- Azure: the production installer storage account exists. Its current container
  is public and legally preserved. It was not changed and is not used for
  confidential licence artifacts.
- Stripe: the sandbox Product, one-time Price, and lookup key were verified in
  test mode. No Product, Price, webhook, Checkout Session, or charge was created.
- Resend: the existing S4 website has a configured Resend integration. No key was
  read and no email was sent. Staging requires a separate/restricted key and an
  authorised Vesoft test recipient.

## Monthly incremental cost

| Component | Provider | Existing/new | Incremental monthly cost | Why required | Defer? |
|---|---|---:|---:|---|---|
| Consolidated API, portals, worker | Render free web service | New | £0 | Public HTTPS and webhook receiver | No |
| Isolated PostgreSQL | Supabase Free project | New | £0 | Durable commercial state/outbox/audit | No |
| Private `.tglic` storage | Encrypted rows in the isolated database | New | £0 | Tiny immutable staging artifacts | No |
| Stripe Checkout/webhook | Existing Stripe sandbox | Existing | £0 | Genuine test payment | No |
| Staging email | Existing Resend/free allowance | Existing | £0 | Controlled test delivery | Can use deterministic provider until configured |
| DNS/TLS | Render `onrender.com` hostname and managed TLS | Included | £0 | HTTPS staging URL | Custom DNS deferred |
| Logs/monitoring | Render logs plus commercial audit records | Included | £0 | Initial diagnostics and traceability | Paid monitoring deferred |
| Redis | None | Removed | £0 | PostgreSQL outbox is authoritative | Yes |

Expected new recurring cost: **£0/month**. No billing upgrade, paid subscription,
or paid add-on was created. Usage must remain within provider free allowances.

## Consolidated runtime

`docker/commercial-staging/Dockerfile` builds the API and both portals, then runs
as the unprivileged `patrol` user. `render.yaml` requests exactly one free Docker
web service with automatic deploy disabled. The customer portal is served from
the root staging origin and the authenticated operator portal from `/operator`.
The existing server-side RBAC and step-up checks remain authoritative.

The commercial worker runs in the same process using the existing durable
PostgreSQL outbox and database claim/locking logic. A process interruption leaves
work retryable; Redis and a separately billed worker are unnecessary at this
volume.

## Private artifact strategy

`COMMERCIAL_ARTIFACT_STORE=database` selects the lean staging store. It:

- accepts only server-generated immutable storage identities;
- verifies the artifact SHA-256 before persistence and on every read;
- AES-256-GCM encrypts the `.tglic` bytes using the externally supplied storage
  encryption key;
- stores no public URL or customer-controlled object key;
- converges safely when a duplicate immutable write races;
- enables PostgreSQL RLS on the blob table and revokes Supabase `anon` and
  `authenticated` access where those roles exist.

The server database role remains the only reader. This avoids Render ephemeral
disk and avoids granting the web service access to the production Azure storage
account.

## Stripe and VAT staging policy

- Product: `prod_VJZKhQacoagUlL`
- Price: `price_1UIwCVH2l2t3kuR0CHN6zOaX`
- Lookup key: `patrolsafe_annual_gbp_v1`
- Amount: GBP 299.00, one-time
- Price tax behaviour: inclusive
- Live credentials are rejected. Test secret keys and restricted test keys are
  accepted; a restricted key is preferred where its permissions suffice.

The Price being tax-inclusive does not calculate, register, or report VAT by
itself. The Stripe sandbox currently has no head-office address, default tax code,
or tax registration. Before the genuine test Checkout, the product owner/accountant
must approve and configure the sandbox head-office address, the correct product tax
code, and any applicable UK test tax registration. Only then should Stripe Tax be
enabled and its £299 gross/net/VAT presentation verified. The application still
has `automatic_tax`, tax-ID collection, and invoice creation disabled; this is
intentional until that approval.

## Required external environment (names only)

| Variable/resource | Status |
|---|---|
| `LICENSE_DATABASE_URL` | Awaiting isolated Supabase Free project |
| `JWT_SECRET` | Render-generated on creation |
| `LICENCE_STORAGE_ENCRYPTION_KEY` | Awaiting 32-byte external secret |
| `COMMERCIAL_STRIPE_SECRET_KEY` | Awaiting restricted Stripe sandbox key |
| `COMMERCIAL_STRIPE_WEBHOOK_SECRET` | Awaiting real HTTPS endpoint/webhook |
| `COMMERCIAL_STRIPE_PRODUCT_ID` | Prepared |
| `COMMERCIAL_STRIPE_PRICE_ID` | Prepared |
| `COMMERCIAL_STRIPE_PRICE_LOOKUP_KEY` | Prepared |
| `COMMERCIAL_CHECKOUT_SUCCESS_URL` | Awaiting actual Render hostname |
| `COMMERCIAL_CHECKOUT_CANCEL_URL` | Awaiting actual Render hostname |
| `LICENSE_PORTAL_ORIGIN` | Awaiting actual Render hostname |
| `CUSTOMER_PORTAL_ORIGIN` | Awaiting actual Render hostname |
| `COMMERCIAL_TEST_SIGNING_PRIVATE_KEY_FILE` | Awaiting Render secret file |
| `COMMERCIAL_DELIVERY_TOKEN_SECRET` | Render-generated on creation |
| `COMMERCIAL_LICENCE_DOWNLOAD_BASE_URL` | Awaiting actual Render hostname |
| `COMMERCIAL_RESEND_API_KEY` | Awaiting restricted staging key |
| `COMMERCIAL_RESEND_FROM` | Awaiting approved staging sender |
| `COMMERCIAL_RESEND_WEBHOOK_SECRET` | Awaiting real HTTPS endpoint/webhook |

No secret value belongs in source, Blueprint, logs, or this record.

## Public routes after deployment

Until the Render service exists there is no actual URL and no Stripe webhook may
be created. With an assigned base URL `https://<actual-render-host>` the Stripe
endpoint will be exactly:

`https://<actual-render-host>/commercial/webhooks/stripe`

The Resend event endpoint will be:

`https://<actual-render-host>/commercial/webhooks/resend`

Customer pages will use `/patrolsafe/buy/<opaque-reference>` and
`/patrolsafe/licence/status/<opaque-reference>`. Operator pages use `/operator/`.
No custom DNS is required for Phase 6 staging.

## Security and production isolation

- `livemode=false` is reconciled at Checkout and webhook boundaries.
- `sk_live_` and `rk_live_` commercial credentials fail configuration validation.
- the fixed sandbox Product/Price/lookup/tax-behaviour binding remains
  server-authoritative;
- the staging test signing key is an external secret file and can be enabled only
  in staging/test mode; no production signing key was read or moved;
- production v1.0.2 source, acquisition, data, Azure artifacts, and licence keys
  were not changed;
- the remaining production audit high is lodash through Nest Config/Swagger. Its
  vulnerable template/unset operations are not called by the commercial request
  path, Swagger is disabled in staging, and resolving it requires a breaking Nest
  upgrade. It remains recorded, not dismissed; 0 critical findings remain.

Free Render is suitable for this controlled test despite cold starts. It is not
the approved hosting basis for automated production signing. The first real
customers can use verified Stripe payment plus operator approval and the existing
manual/offline production issuer, followed by controlled delivery.

## Verification

- Prisma schema generation and validation: pass.
- Clean migration to isolated PostgreSQL, including the Phase 6B artifact table:
  pass.
- Licence API build and lint: pass.
- Customer and operator portal production builds: pass.
- Licence API unit: 46 suites / 248 tests pass (full run plus the final focused
  staging-marker validation).
- Commercial integration: 19 suites / 79 tests pass across the completed run and
  targeted rerun after the first disposable database container was externally
  removed. The rerun used a fresh isolated PostgreSQL 17 container.
- Customer portal: 3 files / 9 tests pass.
- Operator portal: 11 files / 66 tests pass.
- Consolidated Docker image: pass, runs as non-root `patrol`. A local container
  smoke returned HTTP 200 for health, customer purchase, and operator routes.
- Production dependency audit: 0 critical, 1 high, 11 moderate, 1 low. No new
  dependency was introduced by Phase 6B.

## Product-owner action required

1. Create or nominate a separate Supabase Free organisation and Free PostgreSQL
   project; do not add the project to the current Pro organisation unless the
   product owner explicitly accepts its $10/month cost.
2. Authorise/connect a Render free workspace to the repository and confirm the
   service remains on `plan: free`; do not enter a paid plan merely to avoid cold
   starts.
3. Supply the environment secrets listed above through Render, including an
   unmistakably staging-only Ed25519 secret file. Never supply the production
   offline signing key.
4. Complete the Stripe sandbox VAT configuration decision (head office, approved
   tax code, applicable test registration, automatic-tax authorisation).
5. Once Render returns the actual HTTPS hostname, bind all origins/redirects,
   create the Stripe test webhook at the exact route above, and configure only the
   required test events.
6. Configure a staging-specific Resend credential/sender and authorised Vesoft
   recipient, then perform the first real Stripe TEST Checkout. No Windows RC is
   built before that transaction passes.
