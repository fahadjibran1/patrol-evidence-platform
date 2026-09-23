# PatrolSafe v1.0.3 commercial Phase 6 verification

Date: 23 September 2026

Branch: `v1.0.3-commercial-licensing`

Starting commit: `bed4811803975fce5375e5346554750ed3fc398f`

Status: automated/local E2E passed; external staging action is still required.

## Scope and isolation

Phase 6 did not alter or deploy the frozen v1.0.2 GA release. The local staging stack used:

- a fresh PostgreSQL 16 container bound to loopback on port 55436;
- all 15 licence-service migrations, including the Phase 6 approved-recipient migration;
- deterministic Stripe and Resend provider harnesses (no external API calls);
- an ephemeral Ed25519 test key written outside the repository and removed after each test;
- private, temporary filesystem artifact storage outside the repository;
- the real durable database outbox, payment reconciliation, operator step-up, issuer, delivery-token and download services;
- customer purchase/status pages in `apps/customer-portal`, disabled unless explicitly built with `VITE_COMMERCIAL_STAGING_ENABLED=true`;
- an explicitly staging-only desktop trust configuration. A key ID beginning `test-` is rejected unless `PATROLSAFE_COMMERCIAL_STAGING=true`.

The non-secret contract is recorded in `.env.phase6-staging.example`. Placeholder values are not credentials and must be replaced through a staging secret store. No production database, Stripe object, Resend account, signing key, customer email or public site was used.

## Database and migration evidence

A clean database accepted 15 migrations in order. A separate database first accepted the 14 Phase 1–5 migrations and then accepted only `20260923090000_commercial_phase6_approved_recipient`, proving the existing-schema upgrade path. FK, state, uniqueness, audit and outbox constraints were exercised by the complete integration suite. A PostgreSQL custom-format dump was restored into a second isolated database and the restored migration ledger contained all 15 entries. Prisma has no generated down migrations; recovery is therefore the documented restore/roll-forward procedure, not destructive ad-hoc rollback.

Phase 6 adds nullable `CommercialLicenceIssuance.deliveryRecipient`. Approval freezes the validated Checkout customer email onto the issuance. Delivery uses this immutable approved recipient; older/synthetic records retain the existing verified `CustomerUser` fallback. The database check constrains format and lowercase representation. This closes the end-to-end gap where a normal Checkout customer did not necessarily have a separate portal-user record.

## Deterministic new-customer E2E

The database-backed E2E test proves:

1. a strict PurchaseRequestV2 is accepted without desktop price authority;
2. an opaque purchase reference creates one server-priced test Checkout for 29,900 GBP pence;
3. a verified test webhook is persisted before durable reconciliation;
4. the order stops at `PAID_AWAITING_APPROVAL`;
5. a `SUPER_ADMIN` performs recent password reauthentication and approves;
6. one durable issuance command creates one current-format `.tglic`;
7. an independent Ed25519 verification checks product, annual plan, company, workstation binding, dates, features and `maxDevices=1`;
8. one immutable private artifact is reused under retry;
9. the delivery worker sends a 24-hour fixed-destination token through the deterministic Resend adapter;
10. the token downloads the exact artifact and SHA-256/size verification succeeds;
11. desktop import with the corresponding staging public key becomes `Licensed` immediately, exposes the monitoring entitlement, and remains `Licensed` after service reconstruction (restart simulation);
12. copying the licence to a different machine fingerprint fails closed.

Generated correlation identifiers remained UUIDs in audit/outbox data. The verification record deliberately does not reproduce bearer references, fingerprints or licence contents.

## Renewal and offline/recovery coverage

- Early renewal starts on the day after the current licence expires, preserving all paid days.
- Expired renewal starts on the new issuance date.
- Phase 5 desktop tests continue to cover the 90/30/7-day UI, `previousLicenceId`, service outage, offline `.tgreq`/`.tglic`, exact 720-hour new trials, old-trial compatibility, same-machine licence backup/restore and replacement-machine non-activation.
- The Phase 6 desktop test additionally proves online-key import, immediate entitlement refresh, restart persistence and wrong-workstation rejection.

No production offline key was used.

## Failure, replay and adversarial coverage

The complete Phase 1–6 integration regression passed. It includes:

- Checkout cancellation/expiry/failure, delayed settlement, duplicate and out-of-order webhooks, amount/currency/order mismatch, pre-issuance refund and post-issuance review flagging;
- provider timeout and database failure after provider creation, webhook database failure, worker crash/retry and duplicate event convergence;
- approval double submission, concurrent operators, missing/expired/replayed step-up, wrong role, hold/release/reject, refund race, signer/key verification failure and artifact-store outage recovery;
- one issuance/artifact under retries; no duplicate licence for one initial paid order;
- delivery provider outage and timeout-after-accept, duplicate jobs/events, bounce, complaint, expiry, revocation, tampered/cross-artifact token, missing/hash-mismatched artifact, repeated download, resend and concurrent resend;
- forged Stripe/Resend events, arbitrary price/currency/plan input, opaque-reference replay, IDOR/cross-artifact access, path traversal, unknown signer, wrong workstation and trial rollback.

Customer purchase redirect validation accepts only the Stripe Checkout host, and only permits the synthetic `checkout.stripe.test` host while tests run. Customer pages never expose installation ID, fingerprint, request JSON, internal IDs or signing details. They send only customer contact data to Checkout; price and currency remain server-owned.

## Privacy and log review

The E2E assertion searched persisted orders, references, delivery attempts and audit records and confirmed that they did not contain the raw purchase bearer, raw delivery token, raw machine fingerprint or `.tglic` bytes. Source/diff scanning found no committed private key, Stripe/Resend credential, database password or bearer token. Test values are visibly synthetic.

Commercial processing legitimately introduces customer/contact name, email, company, Stripe customer/payment identifiers, hashed workstation/request material, licence metadata, delivery evidence and operator/audit history. Before production, the Privacy Notice and retention schedule must explicitly cover these categories and their processors. Card data is never stored by PatrolSafe.

## Dependency and internet-exposure gate

Fresh `npm audit --omit=dev --workspace @patrol/license-api` result: **0 critical, 1 high, 11 moderate, 1 low**. The remaining high is `lodash@4.17.21`, transitively declared by Nest Config/Swagger. The affected APIs are `_.template` imports keys and prototype-path operations in `_.unset`/`_.omit`. Neither the licence API source nor these installed Nest packages invoke those vulnerable APIs in the current service flow; searches of source and built output found no call site. Classification: **not reachable in the reviewed current staging flow**, not a false positive. Remediation offered by npm is a breaking Nest/Swagger major upgrade, so production exposure requires an explicit security disposition or controlled framework upgrade.

Customer and operator portal audits contain **0 critical / 0 high**; two React Router moderate findings remain for production review. No Phase 6 production dependency was introduced.

## Verification results

- Licence API build and lint: PASS.
- Licence API unit tests: 43 suites / 235 tests PASS.
- Licence API database integrations: 18 suites / 78 tests PASS.
- PatrolSafe backend and frontend production builds: PASS.
- PatrolSafe regression: 93 suites / 709 tests PASS.
- Licence core: 2 suites / 14 tests PASS.
- Licence portal: build PASS; 11 files / 66 tests PASS.
- Customer portal: build PASS; 3 files / 9 tests PASS.
- Prisma validation/generation and fresh migration: PASS.
- Database dump/restore recovery: PASS, 15 migration records restored.
- Secret-safe diff scan and `git diff --check`: required before commit and recorded in the final task report.

## External staging status

The workstation has no authorised Stripe test secret/webhook configuration, no Resend staging key/domain/recipient, no deployed S4 staging purchase origin, and no externally reachable staging API/worker/private object store. Therefore these claims are intentionally **not** made:

- a real Stripe test-mode transaction;
- real signed Stripe webhook ingress over HTTPS;
- a real Resend test email and authenticated provider webhook;
- browser UAT against deployed S4 staging pages;
- an installed Windows staging candidate.

No Windows candidate was built or signed because it could not yet be bound to a provisioned staging service and an authorised persistent staging public key. Building one now would not prove the external customer journey.

## Production gates for Phase 7

1. Provision isolated staging DNS/TLS, API, worker, PostgreSQL, private immutable artifact storage and portal resources.
2. Authorise/inject Stripe **test** credentials and webhook secret; prove a real 29,900 GBP one-off test transaction and replay handling.
3. Authorise/inject a Resend staging key, verified staging sender/domain, webhook secret and Vesoft-controlled test recipient; prove receipt and secure download.
4. Authorise one persistent staging Ed25519 keypair outside source and bind its public key to an explicitly staging desktop build.
5. Deploy the staged customer/operator pages and run the real browser/operator/download/import journey.
6. Build a private v1.0.3 staging Windows candidate only after items 1–5, then run the concise installed-machine checklist (upgrade compatibility, fresh 720-hour trial, buy/import/restart, offline fallback, backup/recovery, WhatsApp/Monitoring/evidence, clean shutdown).
7. Replace recent-password-only production step-up with real operator MFA before internet production deployment.
8. Select and implement a managed/non-exportable or tightly isolated production online Ed25519 provider and private production artifact store; never promote the test adapters/key.
9. Decide VAT/Stripe Tax, invoices, commercial Terms, Privacy Notice, retention, refund/cancellation and support policies.
10. Resolve or explicitly accept the remaining non-reachable lodash high before production exposure, and review current moderate advisories.

Until these gates are complete, the correct status is **automated/local E2E pass; external staging action required**.
