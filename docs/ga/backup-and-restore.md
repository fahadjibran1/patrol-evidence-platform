# PatrolSafe v1.0 — Backup and restore

## What a backup contains

A verified `PatrolSafe-backup-*` folder contains:

- the SQLite database, including company, users, salted password hashes, sites, mappings, schedules, operational records and evidence metadata;
- managed evidence files and integrity hashes;
- workspace configuration, including the authoritative IANA workspace time zone;
- same-workstation recovery material, which can include WhatsApp LocalAuth and machine-bound trial/licence/install identity;
- `manifest.json` with version, schema, file counts, sizes and checksums.

Logs, temporary/staging files, registry state, the desktop login session, JWT secret, desktop API token and desktop recovery authority are excluded.

**A backup is sensitive.** The exclusion of application secrets does not make it anonymous or safe to publish. It can contain personal data, security imagery, password hashes and live WhatsApp session material.

## Create a backup

1. Sign in as an authorised company administrator.
2. Open **Settings → Backup and restore**.
3. Select **Choose backup folder** and choose protected storage separate from the evidence disk.
4. Wait for the verified completion message.
5. Confirm the new folder contains `manifest.json`, `database`, `evidence` and any listed components.
6. Keep the folder intact; editing, renaming individual contents or partial copying can invalidate verification.

Create a backup before upgrades, workstation maintenance, restore tests and uninstall. A weekly schedule is a general operational suggestion, not a universal legal retention policy; the customer must set frequency and retention based on risk and applicable requirements.

## Restore

1. Preserve the current data and confirm you selected the intended backup.
2. Open **Settings → Backup and restore** and select **Choose backup to restore**.
3. Read and accept the replacement warning.
4. PatrolSafe verifies the backup, stages it, creates a rollback snapshot where possible, and only then activates restored data.
5. Verify sites, mappings, evidence integrity and Monitoring preference after restart.

An incomplete, tampered, corrupt or unsupported-newer backup fails closed. Current workspace data should remain unchanged when verification fails.

## Same workstation and replacement workstation

Same-workstation restore can restore the machine-bound WhatsApp and licence/trial state. Those materials rely on the original Windows machine/user protection context and may still require recovery if Windows credentials or DPAPI context changed.

On a replacement workstation, PatrolSafe restores portable company data, sites, mappings and evidence, but machine-bound secrets are not adopted. Recover the licence and relink WhatsApp. Keep Monitoring Paused until the connection and mappings have been checked.

The restored workspace keeps its saved time zone even when the replacement Windows PC uses another zone. For example, a London workspace restored on a Dubai PC remains `Europe/London` until an authenticated administrator deliberately changes it in Company Settings.

## Uninstall and secure disposal

The Windows uninstaller removes the application and shortcuts but preserves AppData and separately configured evidence by design. Uninstall is not erasure.

Before disposal or reassignment:

1. satisfy the customer's retention/legal-hold rules;
2. create and verify any required final backup;
3. unlink the WhatsApp device through an authorised process;
4. remove preserved AppData, evidence and backups using the organisation's approved secure-erasure method;
5. verify removal from all backup copies and storage destinations where required.

PatrolSafe v1 does not automate whole-workspace erasure, retention schedules or cloud backup.

## Backup security

- Use encrypted, access-controlled storage approved by the customer.
- Restrict access to administrators who need recovery capability.
- Do not attach backups to ordinary support tickets or email.
- Test recovery using synthetic or appropriately controlled data.
- Record backup owner, destination, creation time, verification result and disposal date.
- Consider geographic/data-transfer restrictions before using cloud or cross-border storage.

For recovery assistance, contact **support@sfour.co.uk** before sending any backup or diagnostic material. Do not attach backups to ordinary email.

Follow the [secure support-data transfer policy](secure-support-data-transfer.md). Full backups are an exceptional escalation after customer-safe diagnostics and narrower files have proved insufficient.
