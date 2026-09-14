# PatrolSafe by S4 v1.0.0 release notes

Status: **PRIVATE GA CANDIDATE — NOT PUBLISHED**
Tagline: Patrol evidence. Automatically organised.

## Candidate identity

- Source commit: `08223e6a5782eed4e1713d42180e9d42dc02a8ab`
- Private signed build: `2026.09.13.23.14.35`
- Windows file version: `2026.9.13.1394`
- Installer: `PatrolEvidencePlatformSetup.exe`
- Installer SHA-256: `7EFC26F22563BD7B71D902D9AFC29BDCE2953060A854547403D2768D4466B338`
- Publisher: Vesoft Services Limited
- Signature: Authenticode Valid with Microsoft timestamp; 33/33 required PEs verified
- Technical UAT: passed on clean Windows 11 Pro 25H2 x64

The public GA release, if approved, must publish the hash of the exact released installer. Do not reuse this private-candidate hash if the artifact changes.

## v1 capabilities

- Guided local company/workspace and administrator setup.
- Local SQLite database and customer-selected evidence storage.
- 30-day local trial and offline workstation-bound commercial licence request/import.
- Customer-guided WhatsApp Web linking using Microsoft Edge.
- Source discovery by display name and WhatsApp group-to-site mapping.
- Live collection of new mapped JPEG/PNG patrol evidence with deduplication and SHA-256 integrity metadata.
- Dashboard, Monitoring, Evidence, Sites, Guard Safe, Patrol Ops, Alerts and Incidents views subject to licence features.
- Persistent monitoring preference and saved-session reconnect after restart, reboot and bounded network interruption.
- Verified backup/restore with same-machine and replacement-machine safeguards.
- Signed Squirrel Windows installer, application and update components.
- Commercial customer navigation with advanced diagnostics contained under Support.
- A validated workspace time zone selected during setup and editable in Company Settings. Operational dates, patrol schedules, evidence filtering and daily grouping use that saved zone independently of later Windows time-zone changes.

## Acceptance evidence

Final UAT covered signed install, setup persistence, trial, fresh WhatsApp link, source discovery, mapping/reassignment, live four-image ingestion, evidence UX, auto-monitor restart, pause/resume, mapping lifecycle, backup/restore, two network outage/recovery cycles, post-recovery evidence, Windows reboot, reinstall, uninstall/reinstall, signatures and process ownership. No functional Blocker or Major defect remained in that technical UAT.

## Publication status

Technical UAT and Phase 11B operational-time certification are not legal/commercial approval. `GA-GLOBAL-01` is technically closed, but public GA remains blocked by unapproved legal/contact/country/commercial decisions, incomplete final third-party notices, and the need to associate these changed sources with a later approved signed candidate. See [Known issues](known-issues-v1.0.0.md) and the [approval register](publication-approval-register.md).

No GitHub release, public installer, v1.0.0 tag or publication is authorised by these notes.
