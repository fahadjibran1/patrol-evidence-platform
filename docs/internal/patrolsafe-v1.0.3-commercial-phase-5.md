# PatrolSafe v1.0.3 commercial Phase 5

Status: source-only desktop integration. No service deployment, live payment, production signing, email, packaging or publication occurred.

## Customer journey

The Licence page now leads with the current entitlement state: `TRIAL`, `LICENSED`, `EXPIRING`, `EXPIRED`, or `ACTIVATION REQUIRED`. A trial shows whole days remaining and its precise local expiry time. The normal commercial action is **Buy annual licence** (or **Renew licence**) with informational copy for £299 plus VAT where applicable, one Windows workstation, and a 12-month manually renewed licence. Manual `.tgreq` export and signed `.tglic` import remain available under **Manual / Offline activation**.

Import continues through the existing authoritative backend and `EntitlementProvider`. A successful import refreshes licence/bootstrap state in the running renderer; no restart or re-login is required.

## Trial policy and compatibility

New local trials created by v1.0.3 expire exactly 720 hours after the authoritative `startedAt` instant. Existing trial records are read without recalculating `expiresAt`, so v1.0.2 records retain their recorded end. DPAPI/test encryption, registry/file marker protection, clock-rollback checks, reinstall semantics, corruption failure and the existing expiry feature policy are unchanged.

Trial reminders are shown at 7, 3 and 1 day. Annual reminders are shown at 90, 30 and 7 days. Neither flow implies automatic renewal.

## PurchaseRequestV2 and trust boundaries

The local authenticated desktop backend constructs the canonical request using:

- a renderer-generated UUID request ID and 256-bit client nonce;
- server-known installation ID and SHA-256 machine fingerprint;
- configured workspace company name;
- exact product `Patrol Evidence Platform` and plan `annual`;
- application version/build;
- predecessor licence ID only for renewal.

The desktop sends no price, currency, Stripe Price ID, payment state, term dates or signing material. The licensing API remains authoritative for price, payment and renewal dates.

`PATROLSAFE_COMMERCIAL_SERVICE_ORIGIN` and `PATROLSAFE_COMMERCIAL_PURCHASE_ORIGIN` are fixed process configuration, never caller input. Production requires HTTPS and an `sfour.co.uk` host. Local HTTP is accepted only for a loopback licensing-service harness outside production. Missing or invalid configuration fails closed without changing local entitlement.

The Phase 1 service returns a 256-bit opaque purchase reference. PatrolSafe constructs `/patrolsafe/buy/<reference>` under the configured purchase origin and opens it through dedicated Electron IPC. Electron independently requires the exact configured HTTPS origin, exact route shape, no credentials, query or fragment. Installation ID, fingerprint and request JSON never enter the browser URL.

The reference is retained only in Electron `safeStorage` for its short server lifetime so an interrupted desktop session can reopen the purchase and check status without creating a second Order. Packaged production refuses plaintext fallback if OS encryption is unavailable. The reference is excluded from logs, diagnostics and backups.

## Status and failure handling

The desktop does not treat browser success as payment. It queries the existing authenticated commercial inspect contract and maps internal state to:

- Awaiting payment;
- Payment received — awaiting approval;
- Licence being prepared;
- Licence ready — check your email;
- Delivery problem — contact support.

No status activates PatrolSafe. Activation still requires importing a supplied signed `.tglic`. A timeout, malformed response or service outage leaves the trial/licence and evidence unchanged and keeps manual activation available.

## Trusted public-key ring

The verifier now uses explicit trust entries and requires exactly one matching Ed25519 signature:

- `vesoft-offline-v1` / `legacy-v1` preserves current v1.0.2 `.tglic` semantics;
- the future managed online entry uses `online-annual-v1` and additionally requires exact product `Patrol Evidence Platform` and plan `annual`.

Unknown/unsigned material is rejected. No fallback accepts an invalid signature. No Phase 3 test key is included or trusted. The production online public key is intentionally absent until the managed issuer key is authorized; the loader supports an explicit public-key value/file and future packaged `license-online-public.pem` only.

Company display-name equality was not added to activation. Existing licences remain primarily installation/workstation bound.

## Backup and recovery

`commercial-licence.tglic` is now a `SAME_MACHINE_ONLY` backup component. Before same-machine restore, PatrolSafe verifies the signed file against the trusted ring and the backed installation identity. Corrupt, untrusted or mismatched material is not activated and produces a licence-recovery requirement. A replacement-machine restore retains workspace/evidence but does not restore the old machine-bound licence. Backup v1/v2 and mixed evidence layouts remain supported.

The `.tglic` is treated like other sensitive same-machine state: it remains inside the verified customer backup, is not exported to public folders, and raw contents are not logged.

## Verification

Focused verification covers exact 720-hour creation, legacy expiry preservation, PurchaseRequestV2 field minimization, renewal context, fixed-origin handoff, status mapping, missing configuration, malformed responses, trust-ring compatibility, unknown signer rejection, immediate entitlement reconciliation, same/replacement-machine backup rules, corrupt licence recovery, and existing durability/security contracts.

Full verification is recorded in the Phase 5 completion report/commit evidence.

## Phase 6 prerequisites and blockers

Before end-to-end commercial UAT:

1. Authorize a dedicated managed online Ed25519 signing key and its public key ID; add only the public key to the v1.0.3 candidate trust resources.
2. Deploy isolated non-production licensing API/database/outbox/worker infrastructure and run Phase 1–4 migrations there.
3. Configure Stripe test-mode Checkout/webhook, test operator step-up/approval, test-only issuer storage and Resend test provider; keep production keys disabled.
4. Implement the S4 test purchase/status pages against the agreed opaque-reference contracts and configure their exact HTTPS origins.
5. Run one complete synthetic journey: new trial → browser Checkout → webhook → operator approval → managed test signature → email/token download → `.tglic` import → entitlement refresh.
6. Exercise cancellation, delayed/duplicate webhooks, approval races, delivery failure/resend, expired references, wrong workstation, unknown signer, service outage and renewal continuity.
7. Authorize Privacy/Terms changes and retention configuration before any internet-facing production launch.
8. Update v1.0.3 build identity/package resources and run packaged Windows security/regression certification only after the online public key and staging endpoints are frozen.

There is no Phase 5 source blocker. The missing authorized online production key and undeployed S4/licensing environment are deliberate Phase 6 gates, not bypasses.
