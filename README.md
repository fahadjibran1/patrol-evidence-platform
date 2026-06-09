# Patrol Evidence Platform

Desktop-first patrol evidence software built on a local NestJS backend, an automatic local SQLite database for desktop trial installs, optional PostgreSQL for advanced deployments, and a React operations UI.

This repository supports:

- the existing patrol evidence backend and WhatsApp collector
- an Electron desktop shell for local setup and operations
- a local MVP trial licence flow for customer evaluation

## What This Product Does

The Patrol Evidence Platform is intended for security companies that want to:

- connect a patrol WhatsApp account
- map WhatsApp groups to sites
- receive patrol image evidence automatically
- review hourly site safety and Guard Safe reporting
- keep customer data local during trial operation

## What Stays Intact

This productisation layer does not replace or redesign the existing core platform. The following remain in place:

- WhatsApp collector and evidence ingestion
- evidence storage and exports
- dashboard, Guard Safe, Evidence, Sites, Setup, Alerts, and Incidents pages
- automatic local SQLite support for desktop installs
- local PostgreSQL support for advanced or server deployments
- mapped-group routing using `externalGroupId`
- existing REST APIs

## Trial Licence MVP

The desktop app now uses a simple local licence model stored in the desktop workspace config.

### Stored licence fields

- `companyName`
- `licenseKey`
- `licenseType`
- `trialStartDate`
- `trialEndDate`
- `status`
- `createdAt`
- `updatedAt`

### Environment values

Use these values in desktop/runtime configuration:

```env
BUSINESS_TIMEZONE=Europe/London
SECURITY_COMPANY_NAME=Tech Guards Security
TRIAL_DAYS=30
```

Optional local signing secret for generated keys:

```env
LICENSE_SIGNING_SECRET=patrol-evidence-platform-license-secret
```

### Trial rules

- Trial days default to `30`
- The dashboard shows trial status and days remaining
- Existing evidence remains visible if the trial expires
- Customer data is never deleted on expiry
- The WhatsApp collector start is blocked when the licence is invalid or expired

### Sample development trial key

For local testing you can use:

```text
TG-TRIAL-DEV
```

This activates a local desktop trial immediately and is intended only for MVP evaluation and development.

### Generate a signed trial key

You can generate a simple signed key locally:

```bash
npm run license:generate-trial -- "Tech Guards Security" 2026-05-10 30
```

Output format:

```text
TG-TRIAL-{company-slug}-{YYYYMMDD}-{days}-{signature}
```

Example:

```text
TG-TRIAL-tech-guards-security-20260510-30-XXXXXXXXXXXX
```

The company name used in the app should match the company slug used to generate the key.

## Install And Run

Install backend dependencies:

```bash
npm install
```

Install frontend dependencies:

```bash
npm --prefix web install
```

Clean previous desktop outputs before packaging:

```bash
npm run desktop:clean
```

Run backend only:

```bash
npm run start
```

Run frontend only:

```bash
npm run frontend:dev
```

Run the desktop app in development:

```bash
npm run desktop:dev
```

This starts:

- the Vite frontend dev server
- the Electron shell
- the backend from the Electron process

For extra desktop debugging in development:

```bash
APP_DEBUG=true npm run desktop:dev
```

In the desktop app, `Ctrl+Shift+I` opens DevTools.

## First Setup Flow

The desktop first-run wizard now guides the user through:

1. Welcome
2. Trial key / licence activation
3. Company / workspace details
4. Storage folder
5. Local database ready
6. WhatsApp QR connection
7. Create first site
8. Map WhatsApp group
9. Create patrol schedule
10. Finish

The operator does not need to edit `.env` manually for the normal trial setup flow.

## Local Database Default

The normal desktop trial install now uses a local SQLite database automatically.

Default local database path:

```text
AppData/Roaming/Patrol Evidence Platform/data/patrol-evidence.db
```

For normal customers:

- no PostgreSQL install is required
- no database host, port, username, password, or database name are required
- the data folder is created automatically
- the SQLite database file is created automatically
- the app prepares the database tables automatically

Configuration:

```env
DB_TYPE=sqlite
```

For Electron desktop mode, SQLite is the default when no database type is specified.

## PostgreSQL Helper

The desktop wizard still keeps PostgreSQL support for advanced or server-based deployments and adds customer-friendly guidance.

The advanced helper can:

- check whether PostgreSQL is running
- verify whether the username and password are correct
- check whether the workspace database exists
- create the database if it is missing
- run migrations automatically

The UI explains issues using customer-friendly wording such as:

- PostgreSQL server not reachable
- username or password not accepted
- workspace database missing
- app tables still need migrations

The desktop setup page also includes:

- a `Test PostgreSQL` button with a plain-English result
- a `Copy diagnostic report` button for support handover
- `Retry checks` and `Restart app` actions after setup changes

## Connect WhatsApp

The desktop wizard and collector page use the existing collector endpoints:

- `GET /collectors/whatsapp/status`
- `GET /collectors/whatsapp/groups`
- `POST /collectors/whatsapp/start`
- `POST /collectors/whatsapp/stop`
- `POST /collectors/whatsapp/reset-session`

Recommended flow:

1. Open the desktop setup wizard
2. Start the collector
3. Scan the QR code with the patrol WhatsApp account
4. Wait for the collector to report `ready`
5. Return to site/group mapping

## Create Site And Group Mapping

After WhatsApp is connected:

1. Create the first site
2. Open the mapping step
3. Select a detected WhatsApp group or paste the `externalGroupId`
4. Save the mapping

The collector uses `externalGroupId` as the actual routing key for imported WhatsApp evidence.

## Start The Collector

You can start the collector from:

- the setup wizard
- the collector page

The collector will start only when:

- WhatsApp collection is enabled
- the local trial/full licence is active

If the trial has expired, the UI will show a clear activation message and evidence browsing still remains available.

## Trial Expiry Behaviour

When the trial expires:

- the WhatsApp collector start is blocked
- the dashboard shows `Trial expired - activate licence`
- existing evidence remains viewable
- exports continue to work
- local database and stored images are preserved

## Evidence Storage

Evidence is stored as:

```text
{STORAGE_ROOT_PATH}/{siteCode}/{YYYY-MM-DD}/{HH00}/{file}
```

Example:

```text
C:\patrol-storage\SWI01\2026-03-31\1100\SWI01_2026-03-31_11-02-45_wamid_abc123.jpg
```

Stored evidence images are timestamp-stamped on save, using:

- security company name
- site code and site name
- business-timezone date/time
- sender name

## Packaging

Build backend and frontend:

```bash
npm run build
npm run frontend:build
```

Package the desktop app locally:

```bash
npm run desktop:package
```

On Windows, this command now uses a temporary `subst` drive automatically before Electron Forge runs. This keeps the effective working path short enough for native packaging tools.

Portable desktop app output:

```text
out/Patrol Evidence Platform-win32-x64/
```

This is the unpacked portable app folder. It is useful for internal testing or copying the app manually, but it is not the Windows installer.

Electron Forge writes packaged app output under `out/`, and the exact folder name can vary slightly by platform and architecture.

Create installers or distributables:

```bash
npm run desktop:make
```

On Windows, `desktop:make` also uses the same temporary `subst` drive approach automatically so Squirrel can run from the normal repository path without a manual short-path copy.

Create the portable ZIP trial package from the packaged app folder:

```bash
npm run desktop:portable
```

Verify the packaged Windows app contents before sending it to anyone:

```bash
npm run desktop:verify-package
```

Run a packaged-backend smoke test without opening the full UI:

```bash
npm run desktop:smoke-backend
```

Windows installer output path:

```text
out/make/squirrel.windows/x64/
```

Expected Windows installer files include:

```text
out/make/squirrel.windows/x64/PatrolEvidencePlatformSetup.exe
out/make/squirrel.windows/x64/RELEASES
out/make/squirrel.windows/x64/*.nupkg
```

Difference between the two outputs:

- `npm run desktop:package` creates the portable unpacked app folder under `out/`
- `npm run desktop:make` creates the Windows installer and Squirrel.Windows release files under `out/make/squirrel.windows/x64/`

Portable trial package recommendation:

- if you need the fastest customer handover, send the unpacked portable app folder from `out/` after you have verified it runs locally
- if you want a single-file portable customer package, send `out\portable\Patrol Evidence Platform-win32-x64.zip`
- if you need the Windows installer, send `PatrolEvidencePlatformSetup.exe` from `out/make/squirrel.windows/x64/`
- do not send old `Setup.exe` files from earlier builds because Squirrel can reuse the same version unless you rebuild cleanly

## Troubleshooting Blank White Screen

If the packaged Windows app opens but shows a blank or failed screen:

- the packaged frontend is loaded from:

```text
resources/app/web/dist/index.html
```

- the app now writes desktop startup logs to:

```text
AppData/Roaming/Patrol Evidence Platform/desktop-runtime.log
```

- if frontend loading fails, the app shows a visible fallback page instead of a blank white window
- if you launch with `APP_DEBUG=true`, the app opens DevTools automatically when frontend loading fails
- you can also use `Ctrl+Shift+I` in the desktop app to open DevTools manually

Common causes:

- frontend assets were built with absolute `/assets/...` paths instead of relative file-safe paths
- the packaged app could not find `web/dist/index.html`
- the renderer crashed before the main window finished loading
- the backend started, but the frontend bundle did not load correctly from disk

## Packaged Runtime Diagnostics

For packaged Windows builds the app now writes startup diagnostics to:

```text
AppData/Roaming/Patrol Evidence Platform/desktop-runtime.log
```

The log is intended to show:

- Electron app ready
- backend start path
- backend stdout and stderr
- backend health check result
- frontend load path
- frontend load failures

If you want to launch the unpacked portable app with debug mode enabled:

1. Open the packaged app folder under `out/`
2. Place [Start-PatrolEvidence-Debug.bat](C:\Users\Admin\patrol-evidence-platform\scripts\windows\Start-PatrolEvidence-Debug.bat) beside `PatrolEvidencePlatform.exe`
3. Double-click the batch file

Debug mode does the following:

- sets `APP_DEBUG=true`
- keeps writing `desktop-runtime.log`
- opens DevTools automatically on frontend load failure
- still shows the visible fallback page instead of a blank white screen

## Clean-Machine Trial Test

Recommended clean-machine verification steps:

1. Uninstall any old Patrol Evidence Platform install first
2. Delete:

```text
%LocalAppData%\patrol_evidence_platform
%AppData%\Patrol Evidence Platform
```

3. Build fresh:

```bash
npm run desktop:make
npm run desktop:verify-package
```

4. Launch the unpacked portable app first from:

```text
out\Patrol Evidence Platform-win32-x64\PatrolEvidencePlatform.exe
```

5. Confirm `desktop-runtime.log` shows:

- `Electron app ready`
- `Starting backend`
- `Backend health check ready`
- `Frontend finished load`

6. Confirm `backend-runtime.log` shows:

- `bootstrap:start`
- `bootstrap:nest-created`
- `bootstrap:pipes-ready`
- `bootstrap:listening`

7. Only after the unpacked app works, test the installer:

```text
out\make\squirrel.windows\x64\PatrolEvidencePlatformSetup.exe
```

8. After install, open the app and re-check the same log file under AppData

## App Data And Customer Files

Desktop runtime data is stored under:

```text
AppData/Roaming/Patrol Evidence Platform/
```

Typical files and folders:

- `workspace-config.json`
- `desktop-runtime.log`
- `data\patrol-evidence.db`
- `data\Security_Patrols\`

Files to send to a trial customer:

- `PatrolEvidencePlatformSetup.exe` for installer delivery
- or the unpacked portable app folder from `out\Patrol Evidence Platform-win32-x64\`
- optionally [Start-PatrolEvidence-Debug.bat](C:\Users\Admin\patrol-evidence-platform\scripts\windows\Start-PatrolEvidence-Debug.bat) beside the portable app for support-assisted diagnostics
- plus any customer handover notes from [CUSTOMER_HANDOVER_GUIDE.md](C:\Users\Admin\patrol-evidence-platform\CUSTOMER_HANDOVER_GUIDE.md)

## Trial Release Documents

Internal release preparation checklist:

- [TRIAL_RELEASE_CHECKLIST.md](C:\Users\Admin\patrol-evidence-platform\TRIAL_RELEASE_CHECKLIST.md)

Customer-facing setup and handover guide:

- [CUSTOMER_HANDOVER_GUIDE.md](C:\Users\Admin\patrol-evidence-platform\CUSTOMER_HANDOVER_GUIDE.md)

Short internal trial release notes:

- [RELEASE_NOTES.md](C:\Users\Admin\patrol-evidence-platform\RELEASE_NOTES.md)

## MVP Notes

Included in this MVP:

- local desktop setup flow
- automatic local SQLite desktop setup
- advanced PostgreSQL helper
- simple local trial licence
- WhatsApp QR setup
- site and group mapping
- patrol schedule setup
- customer-facing dashboard polish

Future enhancements:

- cloud licence server
- online billing and payments
- encrypted secret storage hardening
- multi-workstation sync
- auto-update pipeline
- richer installer branding
