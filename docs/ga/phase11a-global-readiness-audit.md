# Phase 11A global readiness and data-flow audit

Status: **GA PREPARATION — INTERNAL REVIEW**
Audit date: 2026-09-14
Source branch: `remediation/hybrid-entitlement-foundation`
Phase 11A baseline source HEAD: `08223e6a5782eed4e1713d42180e9d42dc02a8ab`

## Release identity

| Item | Audited value |
|---|---|
| Product | PatrolSafe by S4 |
| Publisher | Vesoft Services Limited |
| Source package version | 1.0.0 |
| Source package build ID | 2026.09.13.00.15.24 |
| Certified private RC build ID | 2026.09.13.23.14.35 |
| Certified Windows file version | 2026.9.13.1394 |
| Certified installer | `PatrolEvidencePlatformSetup.exe` |
| Certified installer SHA-256 | `7EFC26F22563BD7B71D902D9AFC29BDCE2953060A854547403D2768D4466B338` |
| Installer size | 201,672,672 bytes |
| Certified main EXE SHA-256 | `56081F5ED1B8CB84982D91A33A361567C2FC12A29E18E9E2A86A0811DEB653F2` |
| Signature result | 33/33 required PEs Valid; Vesoft Services Limited; timestamped |
| Dependency lock SHA-256 | `40F6674A415D79F42D3BA19DF0836F9AF48DA1739D9CA8F58DAFDCEBE4FBEE93` |
| Technical UAT | Passed; `out/phase10j3-final-uat-report.md` |
| Publication | No |

The committed package build ID and certified artifact build ID differ because release metadata is generated during the private signing build. Customer documentation must identify the released installer by hash, not by the committed package build ID alone.

## International-readiness findings

| ID | Finding | Classification | GA disposition |
|---|---|---|---|
| GA-GLOBAL-01 | Operational time was implicitly London and not customer-configurable. | **CLOSED — TECHNICALLY CERTIFIED IN PHASE 11B** | IANA workspace timezone is selected at setup, persisted, validated, used for operational dates/schedules/filtering/storage/display, restored from backup and independent of later Windows timezone changes. Initialized legacy workspaces migrate to `Europe/London` to preserve history. |
| GA-GLOBAL-02 | Setup operational copy explicitly said Europe/London was the default. | **CLOSED** | Setup now detects the workstation zone as a reviewable preselection and explains workspace-time usage. |
| GA-GLOBAL-03 | Customer date presentation was inconsistent and sometimes browser-local. | **CLOSED FOR PATROLSAFE DESKTOP** | Customer operational timestamps now use the workspace zone and unambiguous English month-name formatting. Commercial portal locale/pricing policy remains separate. |
| GA-GLOBAL-04 | The UI and documentation are hard-coded English; no translation framework is evident. | Acceptable for v1 if disclosed | State that v1 UI/support documentation are English-only. |
| GA-GLOBAL-05 | Desktop runtime shows no GBP, pound symbol, VAT calculation or payment processing. GBP examples exist in internal Stripe/platform documentation. | Acceptable separation | Do not present those examples as PatrolSafe desktop pricing. Define regional sales/tax policy outside the app. |
| GA-GLOBAL-06 | Historical finding: package/About and Licence used inconsistent legacy support domains. | **CLOSED in Phase 11E** | Customer runtime/docs now use the approved `@sfour.co.uk` role contacts; deterministic tests reject legacy runtime domains. Privacy mailbox delivery still requires operational confirmation. |
| GA-GLOBAL-07 | Legacy-compatible AppData and install paths use “Patrol Evidence Platform”. | Acceptable technical compatibility detail | Keep out of ordinary customer flow; explain only in support material. |
| GA-GLOBAL-08 | Setup defaults include “Tech Guards Security” and “PatrolSafe Workspace”. | Cosmetic/customer-copy issue | Customer replaces values during setup; review before next technical release. |
| GA-GLOBAL-09 | No definitive supported-country, sanctions, export-control, payment or tax matrix exists. | Legal/commercial blocker | Use “available in supported countries/regions”; legal/commercial approval must define launch scope. |

British spelling is acceptable English copy and is not by itself a functional UK restriction. No UK postcode, county, +44 phone validation, GBP price, or UK address requirement was found in the desktop workflow.

## Timestamp and timezone behavior

- Absolute evidence, audit, runtime, licence and backup instants remain UTC/unambiguous.
- One validated IANA `appTimeZone` is authoritative for all sites in the workspace.
- First-run detects the workstation timezone only to preselect the customer-reviewed value. Later Windows timezone changes do not alter it.
- Existing initialized workspaces without `appTimeZone` are atomically assigned `Europe/London`, preserving v1 historical semantics.
- Patrol days/hours, schedule instants (including overnight and DST transitions), dashboard Today, evidence filters, date-derived folders, image overlays and customer timestamp display use the workspace timezone.
- Changing timezone does not mutate stored instants, evidence, SHA-256 values, message identities or historical folder names; it can change display/grouping and schedule interpretation, so the UI requires confirmation.
- Backup and restore preserve the setting, including when restored on a workstation in another timezone.
- v1 uses one workspace timezone. Per-site timezones are not claimed.

Detailed evidence: [Phase 11B operational-time inventory](phase11b-timezone-inventory.md).

## Runtime data-flow inventory

The complete column-by-column Phase 11B inventory is maintained in [PatrolSafe v1.0.0 data-flow inventory](phase11b-data-flow-inventory.md). It records source, purpose, location, local/remote status, retention, deletion, backup, Vesoft/third-party transmission, likely role and legal-review requirement for every audited category.

| Data category | Examples | Origin and purpose | Stored/processed at | External disclosure | Retention/deletion behavior |
|---|---|---|---|---|---|
| Company/workspace | company and workspace names | Customer setup and organisation display | Workspace config and local SQLite | None automatically found | Remains until customer removes local data; uninstall preserves it |
| Administrator/user | name, email, role, active/approved state, salted scrypt password hash | Local authentication and permissions | Local SQLite | None automatically found | No self-service erasure workflow found; uninstall preserves DB |
| Login/session | hashed refresh token, expiry/revocation; desktop session material | Keep authorised local UI session | Local SQLite/OS-protected desktop state | None automatically found | Token expiry/revocation applies; excluded from backup |
| Sites and customers | site code/name, optional client name, active/archive state | Route and review evidence | Local SQLite | None automatically found | Site archive preserves historical evidence; no automatic purge found |
| WhatsApp account/session | linked account ID, browser LocalAuth profile/cookies/session | Link WhatsApp Web and reconnect | Local workstation profile | WhatsApp/Meta necessarily processes account and traffic | Persists until relink/reset or local data removal; uninstall preserves it |
| Source discovery/mapping | group/contact display name, stable source ID, type, linked account ID, site mapping | Let admin select a group and route future evidence | Memory, workspace config/local SQLite | Source metadata comes from WhatsApp Web | Mapping can be deactivated/archived; history remains |
| Patrol evidence | JPEG/PNG, filenames, MIME/size/path, SHA-256, integrity state | Preserve and verify patrol image evidence | Customer-selected evidence folder plus local SQLite metadata | Image is received through WhatsApp/Meta; no Vesoft upload found | No automated evidence retention/purge found |
| Message/sender metadata | external message ID, linked account, sender name/number/external ID, sent/received times | Deduplication, attribution and integrity | Local SQLite; some values appear in local logs | Originates from WhatsApp/Meta | Retained with evidence; no automated purge found |
| Patrol operations | schedules, active days/hours, expected guards, assignments, slots/status | Monitor expected patrol activity | Local SQLite | None automatically found | No automatic purge found |
| Alerts/incidents | site/guard references, description, severity/status, timestamps | Operational review | Local SQLite | None automatically found | No automatic purge found |
| Diagnostics/logs | timestamps, states, versions, executable/session/storage paths, source/message/account IDs, sender/site/file details, errors | Troubleshooting and audit | Local log files | Only if customer deliberately copies/exports/sends them | Collector log rotates at 20 MiB with 3 retained files; desktop/backend log rotation was not found |
| Licence/install identity | random installation ID, SHA-256 machine fingerprint, company, plan, version/build, request time; signed licence | Offline request/import and entitlement enforcement | Local files; customer-exported `.tgreq`/imported `.tglic` | Sent to supplier only when customer chooses to send request | Local licence state persists; replacement-machine recovery required |
| Trial identity | start/end/last-seen and machine-bound anti-tamper state | Provide/enforce 30-day trial | DPAPI-protected local file and local marker/registry state | None automatically found | Survives normal reinstall; not portable to replacement machine |
| Backup | database, evidence, workspace config, LocalAuth and machine-bound licence/trial material | Customer-controlled recovery | Customer-chosen folder | Wherever customer stores or transmits the folder | Customer-controlled; no automatic backup deletion |
| Support material | copied diagnostics, screenshots, backup or licence request if supplied | Support at customer's request | Customer-selected channel and Vesoft support systems (not implemented in app) | Vesoft/approved support recipients only after deliberate disclosure | **Policy not yet approved** |
| Network/IP | destination connection metadata naturally visible to networks/WhatsApp; no app IP field found | Internet connectivity | OS/network/WhatsApp infrastructure | Network providers and WhatsApp/Meta | Governed by those providers; no PatrolSafe IP database found |

## External services and data residency

- The packaged UI talks to a backend bound to `127.0.0.1` and guarded by desktop/JWT boundaries.
- WhatsApp integration opens `web.whatsapp.com` in a managed Microsoft Edge profile. WhatsApp/Meta is an independent external service with its own terms, processing and availability. PatrolSafe source discovery uses source metadata; certified production monitoring processes new mapped image events and did not backfill history during UAT.
- No PatrolSafe product telemetry, analytics, crash-report upload, Vesoft cloud evidence upload or cloud backup client was found.
- Licence issuance is file-based: the user exports a request and deliberately sends it to the supplier. The request contains a pseudonymous but device-specific installation ID and hashed machine fingerprint; it is not anonymous.
- Azure Artifact Signing and Microsoft timestamping are release-time operations, not customer evidence flows.
- Windows SmartScreen, certificate validation, Edge and Windows Update may communicate with Microsoft independently of PatrolSafe's local data store.

## Security and sensitivity observations

- User passwords are not stored in plaintext; salted scrypt hashes are stored in SQLite.
- Evidence and the SQLite database are not encrypted by PatrolSafe at rest. Protection depends on Windows account controls, device encryption where deployed, file permissions and customer backup handling.
- LocalAuth contains live authentication material. A same-machine backup can contain it. A backup is therefore sensitive even though application secrets, logs and desktop login sessions are excluded.
- The backup manifest contains checksums and metadata, but the backup database contains password hashes and personal/operational data. “No plaintext secrets” must not be misunderstood as “not sensitive”.
- Diagnostics can include personal identifiers and detailed local paths. Customers should review and minimise them before sending to support.

## Controller/processor assessment for legal review

This is a factual product assessment, not a final legal determination:

- The customer normally decides why guards, participants, sites and patrol evidence are monitored and is likely the controller (or analogous responsible party) for that operational processing.
- Vesoft does not receive ordinary operational data automatically in the audited desktop design. Vesoft may act as an independent controller for sales, licensing and support administration data it receives.
- If Vesoft accesses or receives customer operational data solely to provide support on the customer's instructions, a processor/service-provider role and written data-processing terms may apply.
- WhatsApp/Meta and Microsoft have separate roles and terms that must be assessed for each deployment and country.
- The customer must provide its own workforce/participant privacy information, choose lawful bases, set retention, handle rights requests, secure endpoints/backups and assess monitoring/DPIA obligations.

## Legal/privacy gaps before publication

- Phase 11E operator approval establishes the publication identity as Vesoft Services Limited, company number `08707130`, 241 Manningham Lane, Bradford, BD8 7ER, United Kingdom. Approved role contacts are recorded in the publication register; `privacy@sfour.co.uk` still requires operational mailbox confirmation. Any DPO or non-UK representative requirement remains for legal review.
- No approved operational-data retention schedule or support-data retention schedule exists.
- No approved launch-country/sanctions/export screening record exists.
- No approved controller/processor position or customer data-processing agreement exists.
- No approved EULA governing law, jurisdiction, warranty, liability, support level, update policy or commercial order terms exist.
- No consolidated final-runtime third-party notices file exists. Direct runtime dependencies identify MIT and Apache-2.0 licences, but the complete shipped transitive tree and required attribution texts need release-specific generation/review.
- Support addresses are inconsistent and their ownership/monitoring has not been confirmed.

## Evidence-based platform support

Certified: Windows 11 Pro 25H2 x64, build 26200.9445; 2 vCPU/8 GB UAT VM; Microsoft Edge 153.0.4234.32; 1366×768 and 1920×1080 UI review; internet access to WhatsApp Web; local write access for AppData and the chosen evidence/backup folders.

Not certified by this release evidence: macOS, Linux, Windows Server, Windows 10, Windows on Arm, Windows S mode, multi-user terminal servers, remote network evidence storage, proxy-authenticated/restricted networks, or a fixed minimum disk capacity. Evidence storage capacity depends on image volume and retention policy.

## Authoritative references for legal review

- ICO, privacy information requirements: <https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/the-right-to-be-informed/what-privacy-information-should-we-provide/>
- ICO, international transfers: <https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/international-transfers/a-guide-to-international-transfers/>
- ICO, DPIAs: <https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/accountability-and-governance/data-protection-impact-assessments-dpias/>
- WhatsApp legal resources: <https://www.whatsapp.com/legal/>
- WhatsApp Business terms: <https://www.whatsapp.com/legal/business-terms/>
- Microsoft Windows 11 requirements: <https://support.microsoft.com/en-us/windows/experience/compatibility/windows-11-system-requirements>
- UK strategic export controls: <https://www.gov.uk/guidance/uk-strategic-export-controls>
- UK trade sanctions guidance: <https://www.gov.uk/guidance/trade-sanctions-arms-embargoes-and-other-trade-restrictions>
- Companies House, Vesoft Services Limited: <https://find-and-update.company-information.service.gov.uk/company/08707130>
- ICO, controllers and processors: <https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/controllers-and-processors/controllers-and-processors/>
- CMA, fair customer contracts: <https://www.gov.uk/guidance/writing-a-fair-contract-for-customers>

These sources are current-review inputs, not proof that the draft documents or any deployment comply with every applicable law.
