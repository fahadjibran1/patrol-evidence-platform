# PatrolSafe v1.0.3 commercial Phase 3

Status: implementation verification record. No production signing, delivery, Stripe live mode, deployment, or desktop trust-store change is authorised by this phase.

## Approval and authorization model

The new commercial path remains isolated from the legacy TG1 issuer. `ADMIN` and `SUPER_ADMIN` can review the paid approval queue; only `SUPER_ADMIN` has the explicit `commercial.approval.issue`, hold, reject, and release-hold permissions. The API enforces these permissions independently of portal visibility.

Approval requires the operator's active bearer-authenticated admin session plus a recent password reauthentication. Successful reauthentication creates a random 256-bit one-time credential; only its SHA-256 digest is stored. It is bound to the admin and `commercial-approval` purpose, expires after five minutes, and is atomically consumed with the decision. Existing admin MFA is not implemented. Production-grade operator MFA is therefore a hard gate before an internet-facing issuer is enabled.

The portal shows company/customer contact, public order reference, server-owned £299 GBP terms, payment status, product/plan, request age, client app/build, and only an eight-character fingerprint-hash suffix. It never returns the encrypted/raw fingerprint, opaque purchase reference, provider secrets, signing material, or licence bytes.

## Decision and state policy

`APPROVE AND ISSUE` rechecks the Stripe TEST-mode Checkout and PaymentIntent plus persisted payment/order/request data. Product must equal `Patrol Evidence Platform`, plan `annual`, amount 29900, currency GBP, payment settled and unrefunded, request hash valid, customer present, and request no older than the 30-day operator approval window.

The order holds an immutable copy of the canonical request hash. Approval requires it to match the linked purchase request, then the serializable transaction consumes step-up, moves `PAID_AWAITING_APPROVAL` to `ISSUANCE_PENDING`, creates the one-per-order issuance snapshot, writes safe audit evidence, and commits `commercial.issuance.requested` to the durable outbox. Signing is never performed in the HTTP request.

`HOLD` requires a reason and stops progression. An authorised step-up action can release only a hold whose prior state was `PAID_AWAITING_APPROVAL`. `REJECT` uses the explicit terminal `REJECTED` disposition, retains payment evidence, and does not initiate a refund. It is not overloaded onto `FAILED`.

## Licence policy

The issuance snapshot freezes a server-generated licence ID, issue timestamp, exact request hash, all approved feature flags, one-device limit, approved operator, and inclusive UTC date window. An initial licence starts on the issuance date and expires one calendar year minus one day; for example 22 September 2026 through 21 September 2027. An early renewal starts the day after the issued predecessor expires. An expired renewal starts on its new issuance date, so renewal cannot shorten existing entitlement.

The issuer emits the shipping JSON `SignedCommercialLicence` envelope and payload version 1 from `@patrol/license-core`. It never emits TG1 or `.lic`. Company is frozen as order/request display data, while activation remains workstation-bound; no new mutable company-name activation equality or workspace identifier is introduced.

## Issuer and key trust boundary

The issuer receives only an approved issuance command and a `CommercialSigningProvider`. It has no Stripe secret, portal token, customer password, or web session. The provider contract supports a later Key Vault/HSM/non-exportable adapter because private key bytes are never returned to the issuer.

Phase 3 includes only a clearly labelled file-backed TEST adapter. It requires an absolute private-key path outside the repository, a `test-` key ID, explicit enablement, and an Ed25519 key. It refuses `NODE_ENV=production`. No production key was read, copied, moved, generated, or used, and no key is committed. Production must introduce a dedicated online key and secret-manager-backed provider after operator MFA and infrastructure review.

## Idempotency and failure recovery

Database uniqueness enforces one issuance and one artifact per order/issuance. Licence ID, issue time, dates, request binding, features, and device limit are stored before work is queued. Ed25519 signing is deterministic over canonical JSON. Artifact identity and storage key are content-addressed by SHA-256. A retry after a crash before signing, after signing, or after immutable storage therefore converges on identical bytes rather than generating another licence.

The issuance worker independently rechecks authoritative payment and approval state before claiming work and again checks the database before committing the artifact. Transient failures mark the issuance retryable while the order remains `ISSUANCE_PENDING`; the durable outbox retains retry state. A refund/hold race prevents completion. An already issued artifact is returned idempotently.

## Artifact policy

Every generated licence is independently verified before storage using the TEST public key, exact product, plan, installation, fingerprint, company, dates, features, and device count. Verification failure blocks completion.

Test artifacts use an absolute private root outside committed source, restrictive file creation, traversal containment, immutable content checking, and customer-safe filenames. Only metadata (content type, byte count, hash, key ID, storage key) is persisted. No unauthenticated/public download endpoint and no delivery/email path exists in Phase 3.

## Trust-ring compatibility

Synthetic compatibility fixtures prove the future trust-ring behavior: a valid v1.0.2-format licence signed by the old trusted key remains valid, a new current-format licence signed by the explicitly trusted online key is valid, and unknown-key or unsigned content is rejected. Exact product equality is enforced on the new path. Shipping desktop trust assets are unchanged in Phase 3.

## Refund limitation

A refund before issuance blocks issuance. A provider refund observed after issuance moves the commercial record to manual review/hold and flags the issuance. Because `.tglic` is offline, Phase 3 does not falsely claim remote cryptographic revocation; support/commercial handling is required.

## Security and audit

Audited actions include queue/detail view, successful/denied step-up, approval success/denial, hold/release/reject, issuance queued/started/completed/failure/verification failure, artifact metadata, and retry convergence. Audit metadata excludes raw fingerprint, bearer reference, webhook body, Stripe secrets, private keys, signatures, and licence bytes.

The portal uses Authorization bearer headers rather than cookies, so browser cross-site requests cannot authenticate by ambient cookie (CSRF boundary). Existing short-lived access-token validation handles expired operator sessions. Nonexistent/tampered public references return sanitized not-found responses. Internal admins are global operators rather than tenant members; only the explicitly permissioned `SUPER_ADMIN` may approve across customers.

## Migration

`20260922210000_commercial_phase3_operator_issuer` adds one-time operator step-up records, `REJECTED`, an order request-hash snapshot, deterministic issuance policy fields, operator approval FK, and post-issuance refund review flags. It is additive; no production migration was applied. Clean migration and Phase 2-to-Phase 3 upgrade are verified against isolated PostgreSQL databases. Production rollback is a controlled pre-migration database backup/restore (or a reviewed roll-forward); Prisma deploy does not attempt a destructive automatic down migration.

## Deferred Phase 4 and pre-deployment gates

- Production operator MFA and recovery process.
- Dedicated online signing key, secret-manager/HSM provider, rotation/runbook, and offline-key separation.
- Private production object storage with immutability, encryption, access logging, backup, and retention.
- Resend delivery worker, hashed short-lived download tokens, resend/revocation policy, and delivery audit.
- Customer-facing status/download pages and legal/privacy retention approval.
- Production issuer network isolation, service identity, rate limits, alerting, disaster recovery, and penetration/security review.
- Live Stripe/tax configuration remains separately unauthorised.

## Dependency disposition

Phase 3 adds no npm dependency. The known high-severity `lodash` advisory remains transitive through Nest Config/Swagger and is not invoked through the reviewed vulnerable template API in the commercial flow. It remains a must-track pre-internet-deployment item; a breaking Nest upgrade is not included here. Any new runtime-reachable high/critical finding blocks this phase.

The final production audit reports for `license-api`: 0 critical, 1 high, 11 moderate, and 1 low; for `license-portal`: 0 critical, 0 high, and 2 moderate. The portal's two moderate React Router advisories and the API's moderate dependency findings require controlled remediation/review before internet deployment, but Phase 3 introduced none of these packages or advisories.

## Verification record

- Branch baseline: `v1.0.3-commercial-licensing` at `7615eef4c41d9fe0838047aaa5b21f8edfc2e55e`; frozen GA source remains an ancestor.
- Prisma: schema validation passed; all 13 migrations applied cleanly to an isolated PostgreSQL database; the Phase 2 database accepted only the Phase 3 migration.
- API: production build and lint passed; 40 unit suites / 229 tests passed.
- Integration: 16 suites / 65 tests passed across the existing licence API; the final focused Phase 3 run passed 10 / 10 scenarios after the audit-path assertions were added.
- Phase 1/2/3 focused regression: 3 suites / 33 tests passed.
- Portal: production build passed; 11 suites / 66 tests passed.
- Licence core: 2 suites / 12 tests passed.
- Current issuer, test-key boundary, and permission guard: 3 suites / 8 tests passed after the final artifact hash guard.
- Dependency audits and the Phase 3 diff secret scan completed; no production key, Stripe secret, raw licence artifact, or new dependency was introduced.
- `git diff --check` completed without whitespace errors (only the repository's existing Windows line-ending notices).
