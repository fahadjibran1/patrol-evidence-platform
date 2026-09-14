# PatrolSafe by S4 — Quick Start

Version 1.0.0
Patrol evidence. Automatically organised.

## Before you start

You need:

- a supported Windows 11 x64 workstation;
- a Windows account permitted to install desktop applications; organisational policy may require administrator approval;
- Microsoft Edge installed and up to date;
- reliable internet access to WhatsApp Web;
- an eligible WhatsApp account that your organisation is authorised to use;
- a WhatsApp group created for synthetic testing or real patrol operations;
- enough protected local disk space for the evidence you expect to retain.

PatrolSafe v1.0 and its documentation are provided in English. The certified v1.0 environment is listed in [Support and international availability](support-and-availability.md). All sites in one workspace use the workspace time zone.

## 1. Verify and install

1. Obtain `PatrolEvidencePlatformSetup.exe` through the approved Vesoft distribution channel.
2. Compare its SHA-256 with the value published for that exact release. **GA publication placeholder:** `[INSERT SHA-256 FROM THE APPROVED SIGNED GA MANIFEST]`.
3. In Windows, open the file's **Properties → Digital Signatures** and confirm a valid signature from **Vesoft Services Limited**.
4. Double-click the installer. Do not disable Defender or SmartScreen. If Windows warns about reputation, confirm the publisher and release hash before continuing.
5. Start **PatrolSafe by S4** from its customer-facing shortcut.

Stop and contact approved support if the hash or publisher differs, the signature is invalid, or the installer came from an unapproved source. Do not substitute a hash from an earlier private UAT candidate.

Product support: **support@sfour.co.uk**. Support hours are Monday–Friday, 09:00–17:00 UK local time, excluding UK public holidays. Vesoft aims to respond within 1–2 business days; this target is not an SLA.

Moving PatrolSafe to another workstation may require licence recovery. Contact **support@sfour.co.uk** and provide your Installation ID.

## 2. Create the workspace

Follow the guided setup:

1. Enter your company and workspace names.
2. Review the detected **Time zone** and choose the zone used by your sites. PatrolSafe uses it for patrol schedules, evidence dates and daily reporting.
3. Create the local administrator with a unique email and strong password.
4. Choose an evidence folder on protected storage. Do not use a shared folder unless your organisation has assessed its security and reliability.
5. Complete setup and allow PatrolSafe to restart its local service.
6. Close and reopen PatrolSafe once. The workspace and selected time zone should be recognised; the creation wizard must not repeat.

The administrator password cannot be recovered from the database. Store it using your organisation's approved password-management process.

## 3. Check the trial or licence

Open **Settings → Licence**.

- A new eligible installation normally shows a 30-day free trial and its expiry date.
- The public v1 licence is an annual subscription for one Windows workstation at £299 plus VAT where applicable per year, renewed manually.
- To obtain a commercial licence, create the Annual licence request file and send it only through the supplier's approved channel. It contains company, product, installation and hashed machine-identity information, but no password.
- Import the `.tglic` file supplied for this workstation.

Do not post licence request or licence files publicly.

Previously issued Three-year or Lifetime licence files remain supported for compatibility, but those terms are not offered in the normal v1 customer request flow.

## 4. Connect WhatsApp

1. Open **Monitoring** or the WhatsApp step in setup.
2. Select **Connect WhatsApp**.
3. When the QR appears, use the authorised phone's WhatsApp linked-device flow to scan it once.
4. Wait for **WhatsApp: Connected**. Monitoring may correctly remain **Paused**.
5. Select **Refresh sources** and confirm the required group appears by display name.

PatrolSafe lets customers select groups by display name; no technical source identifier is needed in the normal workflow. If a QR or reconnect fails, use [WhatsApp troubleshooting](whatsapp-troubleshooting.md); do not delete the session folder manually.

## 5. Create sites and map a group

1. Open **Sites** and create the required site.
2. Choose the detected WhatsApp group and map it to the site.
3. Check the group and site names carefully before activation.
4. If you reassign or deactivate a mapping, historical evidence remains associated with its original site.

## 6. Start monitoring

1. Open **Monitoring**.
2. Confirm WhatsApp is **Connected** and the intended group mapping is active.
3. Select **Start monitoring**.
4. Confirm **Monitoring: Active**.

PatrolSafe captures newly received supported images from active mapped sources. It is not an emergency service, alarm system, or substitute for your incident-response procedures.

## 7. Verify with synthetic evidence

Before using real operational content:

1. Send one newly created synthetic JPEG or PNG from a different authorised participant in the mapped group.
2. Confirm it appears once, under the correct site, with a sensible time.
3. Open the image and verify it is readable.

Do not use customer or employee content for setup testing unless your organisation has authorised it.

## 8. Protect the data

1. Open **Settings → Backup and restore**.
2. Choose **Backup PatrolSafe data** and store the completed `PatrolSafe-backup-*` folder on separate, access-controlled storage.
3. Keep the entire folder, including `manifest.json`; do not edit its contents.
4. Test restore according to your organisation's recovery plan.

Backups can contain personal data, evidence, password hashes and a machine-bound WhatsApp session. Treat them as highly sensitive. See [Backup and restore](backup-and-restore.md).

## Daily check

At the start of each operational period, confirm:

- PatrolSafe opens without a setup prompt;
- WhatsApp is **Connected**;
- Monitoring is **Active**;
- the expected sites and group mappings are active;
- recent evidence is arriving;
- no customer action is shown on the Dashboard.
