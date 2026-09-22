# PatrolSafe v1.0.3 commercial Phase 4

Status: test-only secure licence delivery foundation. No live Resend key, live email, production signing key, live Stripe, deployment, website change, or desktop change is authorised by this phase.

## Delivery architecture and state

Successful Phase 3 issuance commits one immutable `.tglic` artifact and a `commercial.delivery.requested` outbox event in the same database transaction. The delivery worker independently rechecks the issued licence, artifact relationship, payment, customer, hold/refund state, verified recipient, size, and SHA-256 before contacting the provider.

The order progresses from `ISSUED` to `DELIVERY_PENDING` when a delivery attempt is created. Resend API acceptance is recorded as `SENT`; it is not represented as customer delivery. A verified `email.delivered` event or a successful licence download moves the order to `DELIVERED`. Bounce, complaint, provider failure, expiry, and download timestamps remain distinct evidence on the delivery attempt. Delivery failures never change `CommercialLicenceIssuance.status = ISSUED` or regenerate the licence.

## Token policy

Each delivery attempt has a random UUID and derives a 256-bit HMAC-SHA-256 bearer token from a separate server-side delivery-token secret. The raw 43-character base64url token exists only when constructing the email link or resolving a request; only its SHA-256 digest is persisted. Tokens are scoped to `licence-download`, one immutable artifact, one customer, and a fixed server-generated route. They expire after 24 hours and may be revoked.

Tokens are multi-use until expiry. This supports browser retries, interrupted downloads, accidental double-clicks, and antivirus rescans without making recovery fragile. Every successful download is audited and increments a counter. A resend creates a new token for the same artifact and revokes earlier active tokens; it does not create another issuance, change dates, or change workstation binding.

The deterministic HMAC derivation lets an outbox retry reconstruct the same raw token after a worker crash without storing reversible token material. Resend receives a stable per-attempt idempotency key. A provider timeout after acceptance therefore converges on the same provider message and artifact.

## Private artifact boundary

The artifact store supports immutable write and verified read operations. Reads require the database-controlled storage key, expected size, and SHA-256. The test store rejects traversal, symbolic links, non-regular files, containment escapes, missing files, size mismatches, and hash mismatches. The download API never accepts an artifact ID, path, object key, redirect, destination, or customer URL.

Production requires private encrypted object storage with service-identity-only access, immutability/versioning, access logs, backup, retention policy, and no anonymous listing or object URLs. Phase 4 continues to use only the external private test artifact adapter.

## Resend boundary and email

`CommercialDeliveryProvider` isolates provider operations. The Resend adapter is disabled unless explicitly configured and uses a server-only API key, a deterministic `Idempotency-Key`, a ten-second timeout, and the Resend HTTPS API. Tests use a deterministic fake and never perform a network send.

Subject: `Your PatrolSafe licence is ready`. The HTML/text template includes company, annual one-workstation entitlement, licence dates, 24-hour secure link, activation steps, and support guidance. It excludes installation ID, machine fingerprint, raw licence content, signing-key ID, bearer internals, and Stripe data. The licence is not attached.

The recipient is selected only from an active, verified, licence-notification-enabled customer owner/administrator linked to the exact order customer. The first delivery freezes that address on the artifact. Later customer-record edits do not silently redirect resends; changing the authorised recipient requires a separately audited support workflow.

## Provider webhook trust

The Resend webhook endpoint requires the original raw body plus `svix-id`, `svix-timestamp`, and `svix-signature`. Verification uses HMAC-SHA-256, constant-time comparison, a five-minute timestamp window, an allowlist of delivery event types, and a configured server-side webhook secret. Only the provider event ID, message ID, payload hash, type, timestamp, correlation ID, and safe state are stored. Raw webhook bodies are not retained.

Provider event IDs are unique and duplicate delivery events converge. A durable outbox processes sent, delivered, bounced, complained, and failed events. Unknown message IDs are safely ignored and audited. Provider events never alter licence bytes, signature, entitlement dates, or workstation binding.

## Resend and recovery

An authorised `SUPER_ADMIN` with the commercial resend permission and a fresh one-time step-up may request `RESEND EXISTING LICENCE`. The endpoint requires a UUID idempotency key and reason, enforces a five-minute per-artifact queue interval, and is throttled to three requests per hour. Same-key concurrent requests converge on one outbox event.

Recovery reuses the exact artifact. A new delivery attempt/token may be created, but issuance and artifact counts remain one. Lost or expired links are handled through this operator-assisted first-iteration workflow. No arbitrary recipient override is accepted.

## Customer-safe API states

The token-scoped status contract returns only: `Licence ready`, `Email sent`, `Delivered`, `Download link expired`, `Delivery problem`, or `Support required`. Invalid tokens receive a generic not-found response. It exposes no internal ID, storage key, provider error, or database state.

## Rate limiting and audit

Download resolution, status lookup, resend, delivery initiation, and purchase endpoints have throttling hooks. Provider webhooks bypass ordinary throttling only after cryptographic signature verification and durable deduplication, so legitimate retries are not lost.

Audits cover delivery queued, token minted/expired/revoked by replacement, provider acceptance, sent/delivered/bounced/complained/failed events, artifact integrity failure, download, resend request, and send failure. Metadata excludes raw tokens, licence bytes, fingerprints, private paths, keys, and provider secrets. Optional IP/user-agent metadata is recorded only for successful downloads.

## Privacy and retention

Phase 4 introduces recipient email, provider message/event IDs, delivery state, token hash and expiry, download timestamps/count, and optional download IP/user-agent. Card data and raw provider payloads are not stored. Before go-live the Privacy Notice and internal retention schedule must cover commercial delivery, security logs, provider event evidence, download metadata, access requests, deletion constraints, and incident handling. No final retention durations or legal wording are set here.

## Failure handling

Provider outage, timeout-after-accept, worker crash, duplicate outbox delivery, duplicate provider event, expired/revoked/tampered token, bounce, complaint, unverified recipient, and missing/tampered artifact are deterministic and fail closed. Retry uses the same artifact and provider idempotency key. Delivery never calls the signer.

## Migration and verification

`20260922230000_commercial_phase4_delivery` adds frozen recipient/generation metadata, token/download/provider evidence, customer linkage, and a deduplicated delivery-provider event table. All 14 migrations passed on a clean isolated PostgreSQL database; the Phase 3 database accepted the Phase 4 migration alone. No production database was touched. Rollback is controlled backup/restore or reviewed roll-forward rather than an automatic destructive down migration.

Focused Phase 4 verification passed 10 integration scenarios plus token, Resend signature/idempotency, and private artifact tests. The final API unit run passed 43 suites / 235 tests; the complete isolated PostgreSQL integration run passed 17 suites / 75 tests. API production build, lint, Prisma validation/generation, clean migration, and Phase 3-to-4 migration passed.

Production dependency inventory is unchanged because Phase 4 added no package. The final API audit remains 0 critical / 1 high / 11 moderate / 1 low. The known high is transitive lodash through Nest Config/Swagger; the reviewed Phase 4 path does not call the vulnerable template/import, unset, or omit operations. The portal remains 0 critical / 0 high / 2 moderate and was not changed in this phase. No new runtime-reachable high or critical finding was introduced. Controlled dependency review remains mandatory before internet deployment.

## Exact Phase 5 prerequisites and blockers

- Add the desktop `Buy licence` and `Renew` flow using opaque PurchaseRequestV2 references; retain offline/manual `.tgreq` and `.tglic` activation.
- Add the old-plus-new public-key trust ring and exact product validation to v1.0.3 desktop without invalidating existing v1.0.2 licences.
- Add customer-facing purchase/status/link-expired guidance and activation instructions without exposing workstation data in URLs.
- Test checkout success/cancel/delay, delivery failure/recovery, wrong workstation, replay, renewal, existing v1.0.2 licences, and offline activation end to end.
- Production operator MFA, dedicated managed online signing key, isolated issuer identity, private production object storage, Resend domain/key/webhook setup, alerting, retention/privacy approval, and security review remain hard pre-deployment gates.
- Resolve or formally disposition all internet-facing dependency findings; no live Stripe/tax, email, signing, website, or licence service deployment is authorised yet.
