# Trial Release Checklist

This checklist is for the internal team preparing a Windows trial release of the PatrolSafe by S4 desktop app.

## 1. Pre-release checks

- Confirm the app builds successfully:
  - `npm run build`
  - `npm run frontend:build`
- Confirm the desktop package command completes:
  - `npm run desktop:package`
- Confirm the installer command completes:
  - `npm run desktop:make`
- Confirm the trial licence flow still works with:
  - `TG-TRIAL-DEV`
- Confirm the PostgreSQL helper works for:
  - wrong password
  - server not running
  - database missing
  - migrations missing
- Confirm the setup page can:
  - test database
  - copy diagnostic report
  - restart app services
  - retry checks
- Confirm the WhatsApp collector can:
  - show QR code
  - connect
  - detect groups
- Confirm Evidence, Dashboard, Guard Safe, Setup, and Collector pages load correctly.

## 2. Package the Windows installer

Run these commands from:

```powershell
C:\Users\Admin\patrol-evidence-platform
```

Build backend and frontend:

```powershell
cmd /c npm run build
cmd /c npm run frontend:build
```

Create the Windows installer:

```powershell
cmd /c npm run desktop:make
```

Optional packaged app without installer:

```powershell
cmd /c npm run desktop:package
```

## 3. Installer output locations

Installer output is created under:

```text
out/make/
```

Typical Windows installer path:

```text
out/make/squirrel.windows/x64/
```

Packaged desktop app output is created under:

```text
out/
```

Typical packaged app path:

```text
out/PatrolEvidencePlatform-win32-x64/
```

## 4. What to send to a trial customer

Send the customer:

- the Windows installer from `out/make/squirrel.windows/x64/`
- their trial key
- the customer handover guide in [CUSTOMER_HANDOVER_GUIDE.md](C:\Users\Admin\patrol-evidence-platform\CUSTOMER_HANDOVER_GUIDE.md)
- support contact details

Recommended handover bundle:

- `PatrolEvidencePlatformSetup.exe` or equivalent installer output
- customer trial key
- PDF or markdown export of the handover guide
- short email with install and support instructions

## 5. Trial customer system requirements

Minimum recommended requirements:

- Windows 10 or Windows 11
- 8 GB RAM
- 2 CPU cores or better
- At least 5 GB free disk space for app, database, and evidence
- Local administrator access for installation
- PostgreSQL installed locally or reachable on the network
- Internet access for WhatsApp Web login

Recommended operational requirements:

- stable broadband internet connection
- dedicated Windows workstation for the patrol WhatsApp account
- power settings configured to avoid sleep during operation
- enough local storage for retained evidence images

## 6. First-run setup steps to verify before handover

Check that the guide and workflow match the current app:

1. Open the desktop app.
2. Start the first-run setup wizard.
3. Enter the trial key.
4. Enter company and workspace details.
5. Select the storage folder.
6. Test PostgreSQL connection.
7. Create the database and run migrations if needed.
8. Prepare the workspace.
9. Start the WhatsApp collector.
10. Scan the QR code with the patrol phone.
11. Create the first site.
12. Map the WhatsApp group to the site.
13. Create the patrol schedule.
14. Open the dashboard and collector page to confirm the trial is ready.

## 7. Trial key activation checks

- Confirm the key is accepted in the setup wizard.
- Confirm the dashboard shows trial status and days remaining.
- Confirm expired or invalid keys block collector start without removing existing data.

## 8. Diagnostic handover process

If a customer has trouble during setup:

1. Ask them to open the PostgreSQL setup step.
2. Ask them to click `Test Database`.
3. Ask them to click `Copy diagnostic report`.
4. Ask them to paste the report into their support email.

Support should request:

- screenshot of the setup step
- copied diagnostic report
- exact point of failure
- whether PostgreSQL is local or remote

## 9. Common troubleshooting checks before release

### Installer does not appear

- Confirm `npm run desktop:make` completed successfully.
- Check `out/make/`.
- Check antivirus or Windows Defender quarantine if the file is missing.

### PostgreSQL test fails

- Confirm the customer entered the right host, port, user, password, and DB name.
- Confirm PostgreSQL service is running.
- Confirm the database user has permission to create the database if required.

### WhatsApp QR does not appear

- Confirm the workspace was prepared successfully.
- Confirm the trial is active.
- Confirm the collector was started.

### No groups detected

- Confirm WhatsApp is fully connected and ready.
- Confirm the linked account can see the patrol group chats.
- Wait for group discovery and retry.

### No evidence arriving

- Confirm the correct group was mapped.
- Confirm the site code is correct.
- Confirm the collector is ready and not stopped.

## 10. Final release sign-off

- Installer generated
- Trial key prepared
- Handover guide prepared
- Release notes updated
- Customer support contact confirmed
- Internal copy of installer and key archived
