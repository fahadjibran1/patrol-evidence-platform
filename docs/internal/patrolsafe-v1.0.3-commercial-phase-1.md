# PatrolSafe v1.0.3 commercial backend — Phase 1 verification record

Status: internal development foundation only. No public controller, payment,
signing, email delivery, desktop flow, or S4 website flow is enabled by this
phase.

## Baseline and isolation

- Development branch: `v1.0.3-commercial-licensing`
- Starting commit: `5f23dac0e1234ceb1edfea40ca1592b6cf634534`
- Frozen v1.0.2 GA commit `339e23af60ef449882d148b5a14a9fd00d32d2b9`
  is an ancestor and was not modified.
- The new path lives in `apps/license-api/src/commercial-foundation` and does
  not call the legacy TG1 issuer, subscription authority, Stripe integration,
  process-local event bus, or email delivery.

## PurchaseRequestV2 contract

The server accepts an exact JSON object with:

| Field | Rule |
| --- | --- |
| `requestId` | UUID v4 |
| `schemaVersion` | integer `2` |
| `product` | exact `Patrol Evidence Platform` |
| `plan` | exact `annual` |
| `installationId` | UUID v4 |
| `machineFingerprint` | 64-character SHA-256 hexadecimal digest |
| `companyName` | trimmed/collapsed whitespace, 1–160 characters, no control characters |
| `appVersion` | semantic version, maximum 40 characters |
| `buildId` | 1–80 safe identifier characters |
| `clientNonce` | 32–128 base64url characters |
| `previousLicenceId` | optional `lic-<UUID v4>` renewal reference |

Unknown properties are rejected. Price, currency, tax, payment/provider state,
term dates, and signing information are not accepted from the desktop.
Identifiers and the fingerprint are normalized to lower case before canonical
JSON and SHA-256 hashing. The raw fingerprint is encrypted at rest; a tagged
digest supports matching without routine decryption. The raw nonce is not
stored.

## Opaque purchase reference

Creation generates 32 random bytes and returns the base64url bearer reference
once. Only a purpose-tagged SHA-256 digest, the `patrolsafe.purchase` scope,
creation/expiry, and consumption state are stored. The reference expires after
30 minutes and exchange is one-time. Invalid, expired, and replayed references
fail closed. The future browser URL can therefore contain only this opaque
reference, never workstation data or internal database identifiers.

No HTTP controller exposes this service in Phase 1. A future internet-facing
controller must apply the existing Nest throttling facility and request-size
limits before calling it.

## Persistence model

The migration adds:

- `CommercialPurchaseRequest` and `CommercialPurchaseReference`
- `CommercialOrder` as the future immutable product/plan/amount/currency/tax/
  legal-version/provider snapshot
- `CommercialPayment` and `CommercialProviderEvent`
- `CommercialLicenceIssuance` and `CommercialLicenceArtifact`
- `CommercialDeliveryAttempt`
- `CommercialOutboxEvent`
- commercial actor/correlation fields on the existing `AuditLog`, which is the
  Phase 1 `AuditEvent` equivalent

The existing `Customer` entity is reused. Provider and monetary fields remain
nullable until Phase 2 deliberately creates a server-side order snapshot. No
Stripe Product or Price identifier is hard-coded.

## State machine

Normal transitions are explicit:

```text
REQUEST_CREATED -> CHECKOUT_PENDING | HELD | CANCELLED | FAILED
CHECKOUT_PENDING -> PAYMENT_PENDING | PAID_AWAITING_APPROVAL | HELD | CANCELLED | FAILED
PAYMENT_PENDING -> PAID_AWAITING_APPROVAL | HELD | CANCELLED | FAILED | REFUNDED
PAID_AWAITING_APPROVAL -> ISSUANCE_PENDING | HELD | FAILED | REFUNDED
ISSUANCE_PENDING -> ISSUED | HELD | FAILED | REFUNDED
ISSUED -> DELIVERY_PENDING | REFUNDED
DELIVERY_PENDING -> DELIVERED | FAILED | REFUNDED
DELIVERED -> REFUNDED
```

`FAILED` and `HELD` can be left only through explicit recovery operations that
restore the recorded prior state. `CANCELLED` and `REFUNDED` are terminal.
Every accepted transition updates an optimistic state version and writes its
audit and outbox records in one serializable transaction. Illegal transitions
fail closed and are audited.

## Idempotency and database enforcement

- Unique request ID, nonce digest, and canonical request hash.
- One order of a given purpose per purchase request; initial creation is
  therefore unique.
- Unique checkout-session and payment-intent fields for Phase 2.
- Unique provider/payment references and provider event IDs.
- One issuance per order and one artifact per issuance.
- Unique licence ID, artifact ID/storage key, delivery idempotency key,
  delivery token digest/provider message, outbox event ID, and outbox
  idempotency key.
- Foreign keys restrict deletion of commercial history.
- PostgreSQL checks enforce product/schema, digest shapes, non-negative money
  and retry counters, currency shape, date order, and explicit reissue reason.

Duplicate worker calls converge on the same issuance/artifact. An outbox
insertion failure rolls back the domain state rather than leaving an ambiguous
commercial transition.

## Audit and trust boundaries

Audit records support actor type, applicable safe actor ID, admin/customer
actor foreign keys, entity, correlation ID, network context, timestamp, and
sanitized metadata. Fingerprints, bearer values, tokens, payment secrets,
private/signing material, and licence artifact content are excluded by key.

The raw opaque reference exists only in the creation response. The private
fingerprint exists only at request validation and, after decryption, inside the
future issuer command boundary. It is not placed in an outbox event or audit.

## Isolated issuer boundary

`CommercialLicenceIssuer` accepts only a frozen, validated command after the
order is paid, operator-approved, and moved to `ISSUANCE_PENDING`. Its result
describes the existing GA `.tglic` artifact identity, payload hash, and signing
key ID. The production Phase 1 binding is `DisabledCommercialLicenceIssuer`,
which always fails closed. Tests inject a recording fake; no key is loaded,
created, copied, or used, and TG1 is not connected.

## Migration and recovery

Migration: `20260922115901_commercial_phase1_foundation`.

Verified paths:

- upgrade of an isolated database containing all prior migrations;
- clean deployment of all migrations into an empty isolated database;
- Prisma schema validation/client generation;
- foreign-key, uniqueness, check-constraint, transaction rollback, and outbox
  atomicity tests.

Prisma migrations are forward-only. Before a future production deployment,
take and verify a PostgreSQL backup. Recovery is restore-to-predeployment
backup or forward corrective migration; the application must not write to the
new tables until the migration succeeds. This Phase 1 migration only adds
tables, enums, indexes, and nullable audit columns, so the existing service can
continue operating during rollback coordination.

## Dependency security disposition

Fresh `npm audit --omit=dev --workspace @patrol/license-api` result on
2026-09-22: 1 critical, 7 high, 11 moderate, 1 low.

Phase 1 introduces no dependency. Findings are pre-existing:

- Critical `tar@6.2.1` is shipped through `bcrypt@5.1.1` ->
  `@mapbox/node-pre-gyp@1.0.11`; its reviewed function is native-package
  acquisition/install tooling, not this new request path.
- High `@mapbox/node-pre-gyp@1.0.11` and `bcrypt@5.1.1` inherit that chain.
- High `nodemailer@6.10.1` is a direct runtime dependency. Email is disabled
  in Phase 1, but this must be remediated and recertified before an
  internet-facing commercial deployment.
- High `glob@10.4.5`, `brace-expansion@1.1.12/2.0.2`,
  `js-yaml@4.1.0/4.1.1`, and `lodash@4.17.21` are existing transitive findings.
  They require controlled dependency remediation/reachability review before
  deployment; broad or forced audit fixes were not applied.

These findings do not block development of the isolated, unexposed Phase 1
foundation. The critical/high set is a hard pre-internet-deployment gate.

## Deferred work

- Phase 2: server price policy (£299 before applicable VAT), immutable priced
  order snapshot, Stripe Checkout, verified/idempotent webhooks, payment
  reconciliation, and outbox workers.
- Later phases: operator approval UI, isolated real `.tglic` signing service,
  delivery tokens/Resend, desktop purchase/renewal UI, S4 pages, legal/privacy
  updates, rate-limit controller policy, and production operations.
- No production database, customer data, S4 website, Stripe account, Resend,
  desktop licence verification, public key, or v1.0.2 artifact was changed.

## Verification summary

- Licence API build/typecheck: PASS
- Prisma validation/generation: PASS
- Clean and upgrade migrations: PASS
- Licence API unit tests: 35 suites / 215 tests PASS
- Licence API integration tests: 14 suites / 38 tests PASS
- Shared GA licence-core build/tests: 2 suites / 12 tests PASS
- Lint and `git diff --check`: PASS
