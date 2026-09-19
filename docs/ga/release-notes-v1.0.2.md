# PatrolSafe by S4 v1.0.2 — release notes

Status: **RELEASE CANDIDATE — NOT PUBLISHED**

PatrolSafe v1.0.2 is a focused desktop reliability update.

## Improvements

- Improved desktop startup reliability when other local software is running.
- Isolated PatrolSafe's local desktop service and verified it before the application opens.
- Added clearer, customer-safe startup diagnostics when the local service cannot start securely.
- Corrected the WhatsApp mapping migration notice so it appears only when mappings are newly paused during the current upgrade. Historical paused mappings remain visible to administrators for review.
- Licence activation and deactivation status now updates consistently across PatrolSafe without restarting or signing in again.
- Improved recovery when a previously linked WhatsApp session ends unexpectedly, with a clear relink action when automatic recovery is no longer safe.
- Corrected monitoring startup so the WhatsApp helper waits for PatrolSafe's verified local service, loads the current mapped groups, and either becomes active or reports a clear bounded error instead of remaining on "Starting monitoring".
- Improved shutdown cleanup for PatrolSafe-owned local service and managed browser processes.
- Clarified the two-step licence request (`.tgreq`) and activation (`.tglic`) workflow.

## Preserved behaviour

- Existing workspaces, sites, schedules, mappings, evidence metadata, licensing state and backups are preserved during upgrade.
- Existing WhatsApp session data remains supported according to the normal backup and replacement-machine rules.
- PatrolSafe remains a Windows 11 x64 application with an English v1 interface and workspace time-zone support.

This candidate does not replace or alter the immutable PatrolSafe v1.0.1 release evidence. Publication requires separate authorization after manual GA UAT.
