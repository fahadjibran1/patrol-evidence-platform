# PatrolSafe v1.0.0 controlled B2B pilot distribution authorization

Status: **DIRECTOR / OPERATOR DISTRIBUTION AUTHORIZATION GRANTED**

Authorization recorded: **15 September 2026**

Release authority: **Vesoft Services Limited / company director**

## Authorized immutable release

| Field | Authorized value |
|---|---|
| Product | PatrolSafe by S4 |
| Version | 1.0.0 |
| Build ID | `2026.09.14.15.44.41` |
| Source commit | `8c454236feac43823d68f7aafa31b4a4e0f5cbe7` |
| Installer | `PatrolEvidencePlatformSetup.exe` |
| Installer SHA-256 | `F9E6EA6765000BECAD8495A96D3C00C63010B28A01D1D1F639CB4D66CE84924B` |
| Publisher | Vesoft Services Limited |
| Authenticode | Valid and timestamped |
| Release type | `CONTROLLED_B2B_PILOT` |

The installer identified above is the only binary authorized under this release action. Any binary change requires a new build identity, complete verification and separate release authorization. Do not overwrite, silently rebuild or silently re-sign this candidate.

## Authorized scope

- Stage 1 Vesoft/internal deployment.
- Individually approved Stage 2 business pilot customers.
- Maximum authorized external Stage 2 cohort: **13 businesses**.
- An international pilot customer may be supplied only after Vesoft records and approves the customer and jurisdiction.

This 15 September 2026 director authorization supersedes the earlier one-to-three operational cohort cap for this release action only. It does not amend the frozen legal-document snapshot, change the unresolved legal-risk categories or authorize unrestricted public GA.

Every external recipient must have an approved `PILOT-###` entry in `pilot-customer-register.md` and a completed `pilot-release-checklist.md` before supply.

## Phased Stage 2 rollout

1. **Wave 1:** supply one to three individually approved businesses.
2. Review installation, first run, WhatsApp reliability, evidence integrity, backup/recovery, support burden, usability and any Critical or High issues.
3. **Wave 2:** if the review supports continuation, approve and supply additional businesses progressively, without exceeding 13 external businesses in total.

Wave assignment does not itself approve a customer. Identification, jurisdiction approval and an approved pilot-register entry remain mandatory for every business.

## Not authorized

- unrestricted public download or unrestricted worldwide GA;
- public software-directory distribution;
- mass customer emailing or uncontrolled redistribution;
- supply to an unrecorded business or jurisdiction;
- substitution of another installer under version 1.0.0; or
- a public release/tag or branch push solely because pilot distribution is authorized.

## Private distribution method

Use a Vesoft-controlled Microsoft OneDrive/SharePoint restricted sharing workflow or another individually controlled Vesoft delivery mechanism. Restrict access to approved recipients, avoid anonymous/public links, verify the uploaded installer hash, record the delivery against the Pilot ID and remove access when no longer required. The repository preparation step creates no public URL and performs no upload.

The customer package contains only the signed installer, checksum file and approved customer documentation. It excludes source code, nupkg/update internals, forensic profiles, logs, signing material, private test data, release-engineering manifests and internal legal-risk documents.

Prepared customer archive: `PatrolSafe-v1.0.0-controlled-pilot-customer-package.zip`

Archive SHA-256: `F8275428A576E9FB5A3B2418B2E0CC4F2FEB0EB0F3CCF68F7A8607A52FBCBDA0`

Archive size: `193868726` bytes

Contained installer SHA-256: `F9E6EA6765000BECAD8495A96D3C00C63010B28A01D1D1F639CB4D66CE84924B`

The archive is prepared locally only. It has not been uploaded and no sharing link has been created. Before each delivery, place this exact archive in a restricted location, verify its archive and contained-installer hashes, and record recipient authorization in the matching pilot record.

## Pilot issue control

| Severity | Meaning | Distribution response |
|---|---|---|
| CRITICAL | Data-integrity/security issue or widespread evidence-capture failure | Pause further pilot distribution; preserve evidence and assess notification/withdrawal before resuming |
| HIGH | Major customer workflow unavailable | Pause affected expansion and investigate before further supply where relevant |
| NORMAL | Operational or support issue | Record, support and review through normal pilot governance |
| LOW | Question, cosmetic issue or enhancement | Record for review; do not silently patch the approved installer |

## Promotion and version control

Public download remains disabled. After the pilot cohort, Vesoft must review installation, reliability, WhatsApp, evidence integrity, backup/recovery, support burden, usability, licensing, jurisdiction experience, defects and feedback. Unrestricted public GA requires separate explicit authorization.

An internal immutable tag named `v1.0.0-pilot.1` may be useful, but it is only a recommendation. It must not be created or pushed without separate authorization.
