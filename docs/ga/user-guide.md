# PatrolSafe by S4 — User Guide

Version 1.0.0
Audience: security-company office administrators and operations managers

## What PatrolSafe does

PatrolSafe receives newly arriving JPEG/PNG patrol images from WhatsApp sources that an administrator maps to sites. It stores the files and searchable metadata locally, calculates patrol status, and provides evidence, operational and recovery views.

PatrolSafe does not send patrol messages in normal production operation, import historical chat content during normal source discovery, provide cloud backup, replace WhatsApp, or provide an emergency response service.

## Navigation

- **Dashboard** — connection, monitoring, site and evidence overview.
- **Monitoring** — WhatsApp connection, source refresh and monitoring controls.
- **Evidence** — review stored images and filter by the controls available in v1.
- **Sites** — create, edit, archive/restore sites and manage WhatsApp group mappings.
- **Guard Safe / Patrol Ops / Alerts / Incidents** — licensed operational views where enabled.
- **Settings → Company** — workspace name and approved company settings.
- **Settings → Licence** — trial status and offline licence request/import.
- **Settings → Backup and restore** — verified local backup and restore.
- **Settings → Support** — customer-safe health summary and support path.
- **Settings → Support → Advanced diagnostics** — technical details for guided support only.

## Status meanings

WhatsApp and Monitoring are independent:

| WhatsApp | Meaning |
|---|---|
| Not linked | No usable linked-device session is present |
| Connecting | The link or saved session is starting |
| Connected | The authenticated session is ready |
| Reconnecting | A saved session is recovering after a temporary interruption |
| Relink required | WhatsApp has invalidated or removed the linked device |
| Error | Connection could not be established; follow the shown action |

| Monitoring | Meaning |
|---|---|
| Active | Production listeners are enabled for active mappings |
| Paused | WhatsApp may remain connected, but new evidence is not being collected |
| No groups configured | Create/activate a group-to-site mapping |
| Error / temporarily unavailable | Monitoring cannot operate until the connection recovers |

**Connected + Paused is a healthy, valid state.** Pausing Monitoring does not log out WhatsApp.

## Company and administrator

First-run creation is separate from post-setup editing. Once setup is complete, a missing or unusable login session should lead to **Login**, not the creation wizard. Use **Settings → Company** after authentication for allowed changes. Changing or recovering an administrator password is a separate security-sensitive action.

Do not share administrator credentials. Create only the accounts required for operations and disable access when no longer needed. PatrolSafe stores salted password hashes rather than plaintext passwords.

## Workspace time zone

PatrolSafe stores absolute event times without changing the event instant, then uses the workspace time zone for patrol schedules, evidence dates, daily grouping, date filters and customer display. First-run setup detects the Windows/Chromium time zone as a convenience; review it before continuing.

All sites in a v1 workspace use the same workspace time zone. If sites operate in different civil time zones, use separate workspaces; per-site timezone operation is not a certified v1 capability.

An administrator can change the setting under **Settings > Company > Time zone**. Read the warning carefully: historical evidence files, hashes, message identities and canonical timestamps remain unchanged, but their displayed date grouping and schedule interpretation can change. Changing the Windows timezone after setup does not change PatrolSafe's saved workspace timezone.

## Sites and mappings

A site is the operational destination for evidence. A mapping links one discovered WhatsApp group/contact identity to one site for future arrivals.

1. Create a site with a meaningful code and name.
2. Connect WhatsApp and refresh sources.
3. Select the group by display name.
4. Confirm the destination site.
5. Activate the mapping and start Monitoring.

Reassignment changes future routing. It does not rewrite the site recorded for historical evidence. Archiving a site preserves historical records and prevents ordinary new use until restored.

## Evidence

Evidence records may contain the image, site, source, sender identifiers/names/numbers, WhatsApp message identity, sent/received times, file information and SHA-256 integrity data.

Use the Evidence screen to open the list, preview an image, move between records and apply the available site/date/time controls. The Guard Safe operational view can export supported CSV reports where licensed. A general ZIP/PDF/range evidence export is not certified as a v1 capability.

If a file is reported missing or its integrity check fails, preserve the database and storage folder, stop altering that evidence set, and contact approved support. Do not replace files manually under an existing record.

## Monitoring operations

Start Monitoring only after checking active mappings. Pause it for deliberate maintenance; the preference persists across restart. When Monitoring was active before a temporary network outage, PatrolSafe makes bounded reconnect attempts and should return to Active when WhatsApp is ready. It preserves LocalAuth and must not require a new QR for a valid saved session.

If automatic recovery stops, choose **Try again** after confirming internet access. Use **Relink** only when the UI says the linked session is invalid or the device was removed; relinking is not a general network retry.

## Trial and licence

The Licence screen presents the current plan/status, remaining trial days or expiry, and actions. The public v1 customer catalogue offers an Annual subscription only: £299 plus VAT where applicable for one Windows workstation per year, with manual annual renewal. A trial or commercial licence applies to one installation identity. The request/import path is offline and customer-controlled; there is no live payment inside the v1 desktop app.

PatrolSafe continues to validate previously issued compatible Three-year and Lifetime licence records, but those legacy types cannot be selected in the normal customer licence-request flow.

If live entitlement expires, existing evidence remains available, but live licensed operations may be blocked. A machine replacement requires supplier-assisted licence recovery or a licence for the new installation.

## Backup, restore and uninstall

Use **Settings → Backup and restore**. PatrolSafe verifies a backup before publishing it and verifies again before restore. Restore replaces current workspace data after confirmation.

The Windows uninstaller removes application files and shortcuts but deliberately preserves customer AppData and separately configured evidence. Reinstalling can rediscover it. To dispose of the workstation, follow an approved secure-erasure process after a verified backup and legal-retention check; uninstall alone is not data deletion.

## Privacy and responsible deployment

The customer controls the purpose, source mappings, users, retention, access, backup destinations and disclosure of operational data. Obtain appropriate authority and inform guards, employees, group participants and other affected people. Do not collect unrelated chat content or use groups that mix operational and personal material.

Images may contain faces, vehicle registrations, locations, access controls or other personal/security information. Apply least privilege, Windows device encryption where approved, locked screens, protected backups and a documented retention/deletion process. See the [customer privacy deployment checklist](customer-privacy-deployment-checklist-draft.md).

## Support information

Use **Settings → Support** first. Advanced diagnostics may contain identifiers and local paths; disclose only the minimum requested through an approved channel. Never send a full database, evidence folder, backup or WhatsApp session unless specifically authorised by your organisation and covered by suitable support/data-processing arrangements.

Product support: **support@sfour.co.uk**. Security or vulnerability reports: **security@sfour.co.uk**. Privacy enquiries: **privacy@sfour.co.uk**. Do not attach sensitive operational data to ordinary email.
