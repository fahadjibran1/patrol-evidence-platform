# PatrolSafe v1.0.0 — Known issues and limitations

Status: **GA PREPARATION — UPDATE BEFORE PUBLICATION**

## Resolved global-readiness finding

GA-GLOBAL-01 is technically closed by Phase 11B. New workspaces detect and require review of an IANA workspace timezone; initialized legacy workspaces retain `Europe/London` for compatibility. Operational dates, schedules, filtering, folders and display use the saved workspace timezone.

## Accepted minor issue

- At 1366×768, the lower Settings/user section requires normal sidebar scrolling.

## v1 limitations

- The user interface and support documents are English-only.
- All sites in one v1 workspace use one workspace time zone. Per-site time zones are not supported; use separate workspaces for operations spanning different civil time zones.
- Changing the workspace time zone can change historical display grouping and schedule interpretation. It does not rewrite canonical evidence timestamps, files or hashes.
- Windows 11 x64 is the only customer desktop platform certified by final UAT.
- PatrolSafe does not provide cloud backup or multi-workstation synchronisation.
- Uninstall preserves AppData and separately configured evidence; it is not secure erasure.
- No automatic evidence-retention/purge workflow is present.
- No general ZIP/PDF/site-range evidence export was certified. Supported operational CSV exports may depend on licence features.
- Licence issuance/activation is file-based; the desktop app does not process live payments.
- Replacement-workstation restore requires licence recovery and WhatsApp relinking.
- Live monitoring depends on internet, Microsoft Edge and WhatsApp Web availability.
- PatrolSafe is not an emergency service, alarm receiving centre or substitute for operational supervision.

## Third-party naming and paths

Some compatibility filenames and AppData/install paths retain “Patrol Evidence Platform”. They are not intended as the ordinary customer-facing product name. Technical support may refer to them when locating logs or data.

## Reporting an issue

Approved support contact and secure disclosure method: **[TO BE CONFIRMED BEFORE PUBLICATION]**.
