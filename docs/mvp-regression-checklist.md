# MVP Regression Checklist

Run this checklist before sending any portable ZIP or installer to a customer.

## Setup

- [ ] Install or extract the latest build on a clean Windows user profile.
- [ ] Launch `PatrolEvidencePlatform.exe`.
- [ ] Confirm the setup wizard or setup page opens without a blank screen.
- [ ] Confirm SQLite data is stored under `%AppData%\Patrol Evidence Platform`.
- [ ] Confirm runtime logs/session/cache are not stored inside the installed app folder.

## Trial Key

- [ ] Enter the trial key.
- [ ] Confirm the licence panel shows an active trial.
- [ ] Confirm patrol monitoring can be started.

## WhatsApp QR

- [ ] Open Patrol Monitoring.
- [ ] Click Start monitoring or Reconnect WhatsApp.
- [ ] Confirm a QR code is shown.
- [ ] Scan the QR code from the patrol WhatsApp phone.
- [ ] Confirm the app status becomes authenticated or connected.

## Group Detection

- [ ] Open Setup.
- [ ] Confirm detected WhatsApp groups appear in the group dropdown.
- [ ] Confirm the debug log does not show a fatal browser launch error.

## Group Mapping

- [ ] Create or select a test site.
- [ ] Map one detected WhatsApp group to the test site.
- [ ] Confirm the setup snapshot shows at least one WhatsApp group mapping.

## Send Image

- [ ] Send a fresh image into the mapped WhatsApp group.
- [ ] Confirm the debug log contains:
  - [ ] `whatsapp-message-received`
  - [ ] `group-matched`
  - [ ] `site-matched`
  - [ ] `image-downloaded`
  - [ ] `image-imported`
- [ ] Confirm backend logs contain:
  - [ ] `image-ingest-received`
  - [ ] `image-ingest-site-matched`
  - [ ] `image-ingest-file-saved`
  - [ ] `image-ingest-db-created`
  - [ ] `image-ingest-guard-safe-updated`

## Evidence Visible

- [ ] Open Evidence.
- [ ] Confirm the imported image is visible.
- [ ] Open the image content.
- [ ] Confirm the image file is stored under `Security_Patrols\<siteCode>\<YYYY-MM-DD>\<HH>\`.
- [ ] Confirm the filename includes the site code, date, time, and unique message suffix.

## Guard Safe Reported

- [ ] Open Guard Safe for the same date.
- [ ] Confirm the site/hour for the sent image shows Reported, On time, or Late.
- [ ] Confirm image count is at least `1` for that row/hour.
- [ ] Confirm the latest image field is not `No image`.

## Export Excel

- [ ] Export the Guard Safe or hourly report.
- [ ] Confirm an `.xlsx` file is created.
- [ ] Open the file in Excel.
- [ ] Confirm the exported rows include the test site and reported hour.

## Build Verification

- [ ] Repeat the image import test from the unpacked portable ZIP.
- [ ] Repeat the image import test from the installer-installed app.
- [ ] Capture a screenshot of Evidence showing the imported image.
- [ ] Capture a screenshot of Guard Safe showing the reported hour.
- [ ] Keep the exported Excel file with the release artifacts.
