# PatrolSafe v1.0.3 commercial backend - Phase 2 verification record

Status: internal TEST-mode payment foundation only. No live Stripe object,
real payment, licence signature, licence delivery, desktop purchase UI, S4
website change, or public deployment is enabled by this phase.

## Baseline and boundaries

- Branch: `v1.0.3-commercial-licensing`
- Starting commit: `f28f7cc26a5719f37c0d80263d7af146bcf023cc`
- Phase 1 persistence, state machine, audit, outbox, and disabled issuer are
  retained. Frozen v1.0.2 GA history and product source were not modified.
- Commercial payment code is isolated in
  `apps/license-api/src/commercial-foundation` and does not use the legacy TG1
  issuer, subscription state as purchase authority, the process-local event
  bus, or an email provider.

## Controlled dependency remediation

The exact pre-change licence-api production audit was reproduced at the Phase
1 commit. It reported 1 critical, 7 high, 11 moderate, and 1 low finding.

| Package/chain | Before | Classification and reviewed operation | Remediation |
| --- | --- | --- | --- |
| `bcrypt -> @mapbox/node-pre-gyp -> tar` | `bcrypt 5.1.1`, `node-pre-gyp 1.0.11`, `tar 6.2.1`; critical/high | `bcrypt` hash/compare is runtime. `node-pre-gyp` and `tar` were native installation/acquisition tooling, not an HTTP runtime archive path. | `bcrypt 6.0.0`; it uses `node-gyp-build` and removes this `tar/node-pre-gyp` chain. Existing auth tests pass. |
| `nodemailer` | `6.10.1`; high | Direct runtime dependency used by existing non-commercial SMTP notification flows. It could not be removed without changing those established flows; the new commercial path does not call it. | `10.0.10`, retaining the tested `createTransport/sendMail` contract. Phase 4 will use Resend for commercial delivery. |
| `glob` | `10.4.5`; high | Runtime tree through TypeORM (via Terminus), plus build tooling. The vulnerable operation is the glob CLI `--cmd` shell feature; the API never invokes that CLI or passes HTTP input to it. | lock/override to `10.5.0`. |
| `brace-expansion` | vulnerable 2.x copy; high | Used beneath `minimatch/glob`; no customer pattern-expansion endpoint exists. | relevant production copy fixed at `2.1.4`. |
| `js-yaml` | `4.1.1`; high | Loaded through Swagger/configuration tooling. No endpoint parses customer YAML. | fixed at `4.3.2`. |
| `lodash` | `4.17.21`; high | Loaded by `@nestjs/config` and `@nestjs/swagger`. Reviewed service code does not expose `_.template` imports or attacker-controlled `_.unset`/`_.omit` paths. | No safe lodash 4.x fix exists. The audit-proposed fix is a breaking Nest/Swagger major upgrade. Classified **NOT REACHABLE IN CURRENT SERVICE FLOW**, with upgrade/design review required before internet deployment. |

The post-change production audit reports 0 critical, 1 high, 11 moderate, and
1 low. The sole high is the documented lodash advisory above. It is not called
a false positive. Critical `tar`, high `bcrypt`, `node-pre-gyp`, `nodemailer`,
`glob`, `brace-expansion`, and `js-yaml` findings are absent from the
licence-api production audit. Full repository findings belonging to other
workspaces are not treated as this service's runtime closure.

## Server-owned commercial policy

The API owns an immutable configuration snapshot:

- product display: `PatrolSafe Annual Licence`
- internal product: `Patrol Evidence Platform`
- plan: `annual`
- base amount: `29900` GBP minor units
- device allowance: one Windows workstation
- payment model: one-off Stripe Checkout `mode=payment`
- tax policy: `NOT_YET_PRODUCTION_AUTHORIZED`

Desktop/browser input cannot set amount, currency, Stripe Price ID, payment
state, tax, or term. The Checkout DTO contains only a billing email and an
optional contact name; company, product, plan, amount, currency, and legal
versions come from persisted/server state. Unknown DTO fields are rejected.
Stripe receives a public order reference and schema marker, not an installation
ID, fingerprint, raw purchase reference, or internal database ID.

Automatic tax, tax-ID collection, invoice creation, promotion codes, recurring
subscriptions, automatic renewal, dunning, and production Stripe Price IDs are
disabled. VAT/tax/accounting decisions remain a production-authorization gate.

## Checkout and reference flow

The internal endpoints are:

- `POST /commercial/purchase-requests` - strict PurchaseRequestV2, five/minute
  default throttle.
- `GET /commercial/purchase` - rate-limited safe preview using an opaque bearer
  reference.
- `POST /commercial/checkout` - rate-limited contact-only Checkout creation
  using the same opaque bearer reference.
- `POST /commercial/webhooks/stripe` - raw-body Stripe signature boundary.

The provider is enabled only with explicit `COMMERCIAL_STRIPE_ENABLED=true`, an
`sk_test_` key, a `whsec_` webhook secret, and approved HTTPS `sfour.co.uk`
redirect templates. Live keys are rejected. No actual credential is committed.
Success/cancel redirects contain only the public order reference and are
non-authoritative: they never settle payment or start issuance.

Checkout creation uses a deterministic provider idempotency key derived from
the internal order and generation. A partial PostgreSQL unique index permits
only one active Checkout per order. A still-open session is returned on retry;
an expired session is closed and replaced by the next generation. A provider
success followed by a database failure is recoverable because retry uses the
same provider idempotency key.

## Webhook trust boundary and reconciliation

Nest preserves the exact raw request body. The commercial Stripe provider
verifies the Stripe signature before any event is stored. Missing/invalid
signatures and live-mode events fail closed. The webhook route is exempt from
ordinary request throttling so legitimate Stripe retries cannot be dropped;
its authentication boundary is the signature. Abuse controls at ingress may
shape traffic but must not acknowledge an unpersisted event.

The webhook transaction stores a unique Stripe event ID, SHA-256 payload hash,
normalized safe metadata, audit row, and durable outbox row. Raw webhook bodies
are not retained. Same-ID/same-payload retries converge; same-ID/different-body
retries are rejected as a reconciliation mismatch.

The worker resolves the persisted Checkout/payment relationship first, then
retrieves authoritative Checkout Session and PaymentIntent snapshots. It
reconciles test/live mode, public order, amount, currency, customer/provider
references, and server policy. Metadata alone is never payment authority.
Mismatches move the order to `HELD` with a sanitized reason.

Authoritative states are recomputed, not blindly advanced by event ordering:

```text
REQUEST_CREATED -> CHECKOUT_PENDING
CHECKOUT_PENDING -> PAYMENT_PENDING
confirmed paid -> PAID_AWAITING_APPROVAL
pre-issuance refund -> REFUNDED
mismatch or settlement after a protected later state -> HELD
```

Failed, cancelled, expired, or delayed payment never becomes paid. A customer
cancel redirect changes no state; an expired Checkout may be safely replaced.
Delayed settlement remains `PAYMENT_PENDING`. Duplicate and stale events
converge on authoritative provider state. Phase 2 has no route from payment to
`ISSUANCE_PENDING`; production issuer binding remains disabled and no licence,
artifact, or delivery attempt is created.

## Durable processing and failure recovery

Webhook receipt and `commercial.provider_event.received` outbox creation commit
atomically. The optional worker claims pending/failed or stale-processing rows,
records ownership, retries with bounded exponential backoff, and marks provider
event plus outbox terminal state in the same reconciliation transaction.
Worker crashes leave durable retryable work. No Redis or process-local event
bus is a payment correctness boundary.

Audits cover Checkout creation/replacement/provider failure, provider event
receipt/rejection, payment pending/settled/mismatch/refund, unknown event, and
worker failure/retry. Correlation IDs are retained. Raw webhook bodies,
fingerprints, opaque references, Stripe secrets, card data, and signing data are
excluded.

## Migration and recovery

Migration: `20260922154500_commercial_phase2_payments`.

It adds provider mode and Checkout/payment linkage, provider event mode/time,
`CommercialCheckoutSession`, uniqueness constraints, a partial one-active-
session index, foreign keys, and money/currency/generation checks. Both a clean
database and a Phase 1 database upgraded successfully. Phase 1 synthetic
payments receive a temporary TEST backfill during migration; new rows must set
mode explicitly.

Migrations remain forward-only. Before any future environment deployment, take
and verify a PostgreSQL backup. Recovery is restore to the pre-migration backup
or a reviewed forward corrective migration. No production database was touched.

## Verification

- Strict server policy and Stripe adapter unit tests: PASS.
- Authentic test-signature verification and forged signature rejection: PASS.
- Phase 2 database/integration scenarios: PASS, including duplicate events,
  delayed/out-of-order settlement, amount/currency/order mismatch, pre-issuance
  refund, provider outage, post-provider DB failure, webhook DB failure, worker
  crash/retry, and one-active-Checkout enforcement.
- Successful payment stopped exactly at `PAID_AWAITING_APPROVAL`; issuance,
  artifact, delivery, real signing, and email counts remained zero.
- Stripe test-mode result: deterministic provider fake plus local signature
  verification only. No Stripe API call, Stripe CLI payment, or real money.
- Clean and Phase 1 upgrade migrations: PASS.
- Full licence-api build, lint, unit, integration, Phase 1 regression, secret
  scan, dependency audit, and diff checks: recorded in the final task report.

## Deferred Phase 3 and production gates

- Operator authentication/authorization and `PAID_AWAITING_APPROVAL` queue.
- Explicit approve/hold/reject/reissue operations with audit and concurrency
  controls.
- An isolated issuer service that emits the existing GA `.tglic` schema; key
  architecture and operator separation must be approved before any key access.
- A dedicated test signing key and environment, never the current offline key.
- A reviewed approach for refunds after issuance (offline licences cannot be
  remotely revoked).
- Resolve or formally approve the lodash/Nest major-upgrade residual risk and
  all moderate internet-facing findings before deployment.
- Production VAT/tax, legal versions, Stripe account/Product/Price, webhook
  secret rotation, ingress limits, observability, alerts, and runbooks.
- Phase 4 Resend delivery; no Nodemailer dependency for the new commercial flow.
- Desktop/S4 customer UX and legal/privacy changes remain later phases.
