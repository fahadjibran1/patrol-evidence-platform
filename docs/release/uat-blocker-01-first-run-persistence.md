# UAT-BLOCKER-01 — first-run initialization persistence

## Clean-machine evidence

- Environment: clean Azure Windows 11 Pro 25H2 x64 VM (build 26200.9445).
- Signed RC: version 1.0.0, Authenticode valid, publisher Vesoft Services Limited.
- Installation and first launch passed; the local backend became ready in approximately 4.7 seconds.
- Trial initialization persisted as Active with 30 days remaining.
- After the operator submitted synthetic company/admin details, the packaged app displayed its backend-restart surface and returned to `/desktop/setup`.
- Customer-safe logs repeatedly recorded `SETUP_COMPLETED_LOADED false`; no `SETUP_COMPLETED_SAVED true` or `desktop-setup-completed` event occurred.
- A normal close and reopen reproduced the first-run route.

No passwords, authentication tokens, WhatsApp identifiers, or customer data are recorded here.

## Root cause

The first company step previously called the Electron configuration bridge with an explicit backend restart before calling `POST /desktop/bootstrap/initialize`. In a packaged build, a backend restart intentionally navigates the BrowserWindow to a restart page. That navigation destroys the setup renderer and aborts the remaining handler before company/admin creation and setup progress can be committed. Development mode did not reproduce the same interruption because it does not use the packaged restart surface.

The Electron shell and backend used the same absolute `DESKTOP_CONFIG_PATH`, SQLite path, and user-data root. Schema migration and trial persistence did not reset setup state. The failure was operation ordering across a packaged renderer replacement, not a split storage root.

Classification: `G. PACKAGED_PATH_ASSUMPTION` plus restart sequencing/context destruction (`H. OTHER`).

## Repair contract

- Create and verify the company/admin before any restart-capable desktop IPC operation.
- Persist incomplete wizard progress in the authoritative workspace configuration, not renderer storage.
- Write workspace configuration by same-directory temporary file plus atomic rename.
- Resume an interrupted setup at the persisted step.
- Mark setup complete only through the authenticated completion endpoint.
- Keep initialized bootstrap protection and desktop IPC sender validation unchanged.
