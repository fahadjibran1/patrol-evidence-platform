# PatrolSafe v1 backup and recovery

PatrolSafe administrators can use **Backup PatrolSafe data** and **Restore PatrolSafe backup** from Advanced Diagnostics. A backup pauses the local service briefly, checkpoints SQLite through its supported backup mechanism, copies managed evidence, and verifies the result before publishing the completed backup folder.

## Included

- the versioned SQLite database, including companies, users, sites, mappings, evidence records, and monitoring preference;
- every file in the configured managed evidence folder, with size and SHA-256 verification;
- workspace configuration;
- licence/trial files, installation identity, and WhatsApp LocalAuth for same-workstation recovery only.

Logs, temporary/staging files, Windows registry state, desktop login sessions, JWT signing material, and internal desktop API/recovery tokens are excluded and regenerated when needed. The plaintext manifest contains only release/schema information, a hashed workspace identity, checksums, counts, and component names. It contains no passwords, access tokens, cookies, or WhatsApp message content.

## Compatibility and machine replacement

Backup format 1 can be restored by PatrolSafe 1.0.0 or a later version that explicitly supports schema version 2. Restoring a backup created by a newer unsupported schema fails closed.

For a same-workstation restore, PatrolSafe restores the encrypted local session and WhatsApp browser state. Their security remains bound to that workstation. For a replacement PC, PatrolSafe restores the database, evidence, mappings, and workspace configuration but does not import machine-bound secrets, licensing state, or WhatsApp LocalAuth. The administrator must recover the licence and relink WhatsApp; monitoring remains paused until that is complete.

## Supported procedure

1. Sign in as a company administrator.
2. Close other PatrolSafe windows and choose **Backup PatrolSafe data**.
3. Store the completed `PatrolSafe-backup-*` folder on protected storage separate from the evidence disk.
4. On recovery, install the same or a newer supported PatrolSafe release and choose **Restore PatrolSafe backup**.
5. Confirm the replacement warning. PatrolSafe verifies into staging, creates a recovery snapshot of current readable data, and only then activates the restored database/evidence/configuration.
6. Verify sites, mappings, evidence integrity, and monitoring state. On a replacement PC, recover the licence and relink WhatsApp.

Create a verified backup at least weekly and before application upgrades or workstation maintenance. Keep multiple generations on encrypted, access-controlled storage. PatrolSafe v1 does not provide cloud backup.

If startup reports a corrupt database, PatrolSafe does not delete or recreate it. Use a previously verified backup or contact support. If storage is full, free disk space or choose another backup location before retrying; PatrolSafe fails the write rather than silently losing evidence.

The Windows uninstaller removes application shortcuts and binaries but deliberately leaves PatrolSafe user data in AppData and any separately configured evidence folder. Reinstalling the same or a newer supported release discovers that retained data and applies only pending versioned migrations. Administrators should still create a verified backup before uninstalling or upgrading.

If an older database contains two active mappings for the same WhatsApp account/group, the upgrade preserves both rows and all historical evidence but pauses every ambiguous mapping in that set. PatrolSafe records the conflict and asks a company administrator to reactivate only the intended mapping before monitoring resumes; it never guesses a destination site.
