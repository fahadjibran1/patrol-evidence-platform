# PatrolSafe v1.0.0 public trial download readiness

Status: **READINESS ASSESSED — PUBLIC DOWNLOAD NOT AUTHORIZED**

Assessment date: 15 September 2026

This document evaluates a future public 30-day trial download. It does not supersede the controlled B2B pilot authorization, authorize publication, or change the certified binary.

## Certified binary invariant

| Field | Certified value |
|---|---|
| Product | PatrolSafe by S4 |
| Version | 1.0.0 |
| Build ID | `2026.09.14.15.44.41` |
| Source commit | `8c454236feac43823d68f7aafa31b4a4e0f5cbe7` |
| Installer | `PatrolEvidencePlatformSetup.exe` |
| Size | `193817568` bytes |
| SHA-256 | `F9E6EA6765000BECAD8495A96D3C00C63010B28A01D1D1F639CB4D66CE84924B` |
| Publisher | Vesoft Services Limited |
| Authenticode | Valid and timestamped |

Only these exact bytes are eligible for a future v1.0.0 public-trial authorization. A change requires a new version/build identity, signing, certification, release association and authorization.

## Technical trial assessment

| Area | Actual v1.0.0 behavior | Public-download assessment |
|---|---|---|
| Trial issuance | An eligible new desktop installation automatically creates one local 30-day trial; no payment or Vesoft interaction is required. | READY |
| Trial protection | Trial state is DPAPI-protected for the current Windows user. A separate HKCU marker prevents a deleted trial record from creating another trial. | Reasonable per-user local deterrence, not an online entitlement system |
| Workstation identity | A stable random installation ID is combined with a SHA-256 machine fingerprint derived from Windows machine and host characteristics. Raw MachineGuid data is not exported. | READY, with privacy disclosure already required |
| Restart/reinstall | The same trial identity and expiry reopen; deleting the encrypted record while its marker remains does not issue a new trial. | READY |
| Clock rollback | Rollback beyond the allowed tolerance fails closed. | READY |
| Trial expiry evaluation | Licence evaluation disables live features and the UI says live operations are paused and activation is required. New Start, Retry and reconnect operations fail closed. | PARTIAL |
| Already-running monitoring at expiry | No periodic entitlement-expiry timer was found. `getRuntimeConfig()` and helper ingestion do not reassert entitlement, so a helper/listeners already active at expiry can continue until a restart, reconnect or another guarded action. | **PUBLIC-DOWNLOAD BLOCKER** |
| Existing evidence | Evidence remains enabled and `/evidence` remains reachable. Existing data is not deleted. | READY |
| Backup | Backup/restore remains reachable through the trusted desktop bridge. | READY |
| Customer access | Login, Licence, Evidence, Backup/restore, Support and Diagnostics remain reachable. Other operating routes redirect to Licence. | READY |
| Purchase | The Licence page creates an Annual-only workstation-bound request file and routes the customer to `support@sfour.co.uk`. There is no payment checkout. | READY for manual paid issuance; not self-service commerce |
| Paid operation | A valid signed Annual licence restores licensed features. One workstation is allowed and renewal is manual. | READY |
| Unlimited use | A restarted/reconnected trial expires and does not reset, but continuous active monitoring is not stopped at the expiry boundary. Separately, the marker is per Windows user (HKCU); another local account, OS reimage or sufficiently privileged local manipulation can evade a purely local trial control. | Runtime blocker plus commercial risk |
| Updates | No certified public auto-update service is present. Each replacement release must be published and communicated explicitly. | Operational limitation; version tracking required |
| Telemetry | The audited release has no Vesoft telemetry or cloud evidence upload. | Privacy-positive; download-to-paid conversion is not measurable in-app |

Targeted verification on 15 September 2026 passed 4 suites / 30 tests covering 30-day issuance, restart, reinstall-marker protection, expiry evaluation, clock rollback, signed licence validation, retained data/backup contracts and uninstall preservation. The existing expiry test proves `collectorAllowed=false`; it does not prove that an already-running helper is stopped. Full regression also passed 74 suites / 589 tests, confirming this is a missing lifecycle invariant rather than a failing existing assertion.

## Trial-expiry customer answer

- After a restart/reconnect or another guarded action, Monitoring and other licensed live operations cannot start while expired.
- **Defect:** if Monitoring is already active when expiry occurs, no in-process watchdog currently stops its helper/listeners at that boundary.
- Existing evidence remains viewable.
- Backup and restore remain available.
- The local database, evidence files, company configuration and mappings are preserved.
- The customer can still open Licence and Support, create an Annual licence request, and import a supplied licence.
- Uninstall preserves customer data under the certified v1.0.0 behavior.
- The customer is not locked out of stored evidence merely because the trial expires.

Existing evidence/backup access is customer-safe, but the active-helper expiry gap is unacceptable for a publicly downloadable commercial trial. The current binary must not be authorized for public trial download.

## Customer journey

1. Visit the S4 PatrolSafe page.
2. Download the immutable signed Windows installer without payment or sales approval.
3. Optionally verify the SHA-256 and Vesoft Services Limited signature.
4. Install PatrolSafe.
5. Create the local company workspace and administrator.
6. Review the detected workspace time zone and evidence location.
7. Receive the eligible 30-day local trial.
8. Link an authorized WhatsApp account.
9. Create a site.
10. Refresh sources and map an authorized group.
11. Start monitoring.
12. Evaluate the evidence workflow.
13. Create and protect a backup.
14. Before or after expiry, request the £299 + VAT-where-applicable Annual licence from Vesoft and activate the supplied file.

## Operational changes and risks

Public availability removes Vesoft's customer/jurisdiction pre-approval before download. It increases install, Edge/WhatsApp-link, timezone, privacy and licensing enquiries and may expose the software to unsupported Windows variants and jurisdictions. It does not materially change the software's attack surface: a commercially distributed desktop installer must be assumed obtainable and inspectable.

Installer secrecy is not a security or licensing control. Continue code signing, immutable hashes, dependency review and fail-closed licence validation. Monitor unusually repeated licence-recovery requests, but do not collect invasive device or evidence telemetry.

## Authorization blockers

The current binary needs a narrowly scoped production repair before public trial download. Publication is **NO-GO today** until the runtime repair is certified and the non-binary gates also close:

**GA-DIST-01 — ACTIVE TRIAL EXPIRY NOT ENFORCED:** `LicenceEvaluationService` correctly returns expired features, but `WhatsAppCollectorService` checks entitlement on start/retry/recovery rather than at the expiry boundary or on helper ingestion. Severity for public trial distribution: **BLOCKER**.

1. Add and certify a fail-closed runtime expiry transition that stops production listeners/helper promptly when entitlement expires, preserves data and monitoring preference, and does not require network activity to notice expiry.
2. Add deterministic tests for active-at-expiry, paused-at-expiry, restart-after-expiry, exact-once listener shutdown, evidence/backup retention and activation recovery.
3. Build, sign and UAT a new immutable candidate (normally v1.0.1); never replace the authorized v1.0.0 bytes.
4. Vesoft management explicitly authorizes public 30-day trial acquisition and states whether it remains B2B-focused.
5. Management extends or replaces the current controlled-pilot-only legal risk acceptance. The frozen legal documents expressly do not authorize unrestricted public download or consumer marketing.
6. Vesoft records the initially supported markets/regions and sanctions/export decision; absence of geoblocking is not a substitute for an approved availability policy.
7. The public Privacy Notice, Software Licence Terms and download wording are approved for this wider audience and hosted at stable HTTPS URLs.
8. The immutable download origin, withdrawal control, owner and access roles are operationally approved and tested.
9. The new exact certified installer, public manifest and adjacent checksum are independently verified at the production URL.
10. Self-service FAQ/support capacity and incident ownership are accepted.
11. Download analytics are either disabled or separately privacy-approved and documented.

## Proposed authorization model

After a replacement candidate and all gates above close, use a separate recorded decision substantially in this form, inserting that candidate's new identity and hash:

> Vesoft Services Limited authorizes public acquisition of the exact certified PatrolSafe by S4 `[VERSION]` installer, SHA-256 `[NEW CERTIFIED HASH]`, for an eligible 30-day trial in the supported countries and regions recorded for this release. No payment or pre-sales approval is required to download or begin an eligible trial. Paid Annual licences remain manually issued by Vesoft at £299 plus VAT where applicable per Windows workstation per year. This authorization is not unrestricted paid commercial GA and does not authorize a different binary.

## Paid-licence control

Public trial acquisition does not alter the Annual-only catalogue. Paid licences remain workstation-bound, manually issued and cryptographically signed by Vesoft after a request file is received. Renewal remains manual. Three-year and Lifetime types remain validation-compatible only for historical licences and are not public offers.

## Support preparation

Before enabling the button, add concise self-service answers for:

- supported Windows 11 x64 and Microsoft Edge requirements;
- SmartScreen and publisher verification without bypass instructions;
- eligible-trial and prior-trial behavior;
- WhatsApp QR, group discovery and Connected/Paused states;
- network reconnect and Relink-required distinctions;
- timezone selection and cross-midnight patrol schedules;
- trial expiry, retained evidence and Annual activation;
- backup responsibility, replacement-PC restore and licence recovery;
- what diagnostics to send and what evidence/WhatsApp files not to send routinely.

The published support target remains Monday–Friday, 09:00–17:00 UK local time excluding UK public holidays, aiming to respond within 1–2 business days; it is not an SLA.

## Screenshot readiness

No publishable Dashboard, Monitoring, Evidence, Setup or Backup/restore screenshots are tracked in the repository at this HEAD. Screenshot publication is therefore **NOT READY**. Capture a fresh set from the certified application using a synthetic workspace, synthetic site/group names and synthetic images; crop out Windows account details and review every frame for WhatsApp identifiers, personal data, diagnostics, local paths, licence IDs, QR codes and secrets. Product/management approval is required before upload. This is a website-content gate, not a binary blocker.

## Minimal analytics recommendation

Start with privacy-minimal server/CDN aggregate request logs only: timestamp, requested version, HTTP outcome and coarse operational totals. Do not fingerprint devices, add in-app telemetry, log query tokens, or collect customer evidence. Country/region aggregation and retention require an approved purpose, retention period and Privacy Notice disclosure before activation. Paid conversion can initially be measured by aggregate licence issuance against aggregate downloads, without linking browsing identifiers to installations.

## Withdrawal

1. Disable the website CTA and CDN route; retain the certified object privately.
2. Record affected version/hash, reason, authority, time and known impact.
3. Do not delete the release evidence or replace bytes at the v1.0.0 URL.
4. Publish a customer advisory when warranted and continue support for installed users.
5. Preserve valid trials, licences and customer data.
6. Repair and certify a new `v1.0.1` binary and URL if code changes are required.
7. Re-enable acquisition only after new technical, legal/management and release authorization.

## Release-record changes after approval

The following records must be revised or supplemented only after explicit authorization:

- `publication-approval-register.md` — public trial scope, markets, legal-document and download-hosting approvals;
- `legal-risk-acceptance.md` and its frozen hash manifest — wider acquisition/audience risk acceptance;
- Privacy Notice and Software Licence Terms — applicable public-trial status and hosted URLs;
- `website-download-page-copy.md` — replace pilot-disabled CTA and insert exact hash/size;
- release association — add a public-trial distribution authorization record without changing the binary identity;
- a public download manifest and `SHA256SUMS.txt` copied from the certified release record;
- support, rollback and incident runbooks — public acquisition owner and withdrawal exercise evidence.

The controlled pilot authorization and its customer register remain historical evidence; they must not be silently rewritten as if public authorization existed at release certification time.

## Decision

- Binary suitability for public 30-day trial: **NO-GO — active monitoring is not stopped at the expiry boundary**.
- Public-download operational readiness: **NO-GO for the current v1.0.0 binary**.
- Authorization to enable public download today: **NO-GO**.
- Binary repair/rebuild/re-sign required: **YES; publish under a new immutable version/build after certification**.
