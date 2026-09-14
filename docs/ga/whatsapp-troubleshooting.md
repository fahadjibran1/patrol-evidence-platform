# PatrolSafe v1.0 — WhatsApp connection troubleshooting

## Safety first

- Do not delete or edit the WhatsApp session folder manually.
- Do not repeatedly unlink/relink for ordinary network faults.
- Do not share QR codes, session folders, logs or screenshots publicly.
- Do not disable Defender, SmartScreen or the Windows firewall.
- Use **Advanced diagnostics** only when guided by approved support.

## No QR appears

1. Confirm Microsoft Edge is installed and updated.
2. Confirm the workstation can open `https://web.whatsapp.com/` on the same network.
3. Close ordinary Edge windows only if your organisation permits it; do not terminate Windows WebView processes.
4. In PatrolSafe, select **Try again** once and allow the bounded launch to complete.
5. If the UI reports that another PatrolSafe WhatsApp browser owns the profile, close PatrolSafe normally, wait for shutdown, and reopen it.

Do not complete Edge's consumer first-run wizard as a workaround. PatrolSafe's certified launch supports a clean Windows/Edge profile.

## QR scanned but not connected

Keep the phone online and wait for PatrolSafe to show **Connected**. One scan should normally be sufficient. If WhatsApp on the phone reports that the linked device was rejected or removed, use **Relink** only after the PatrolSafe UI requests it.

Monitoring can remain **Paused** after successful linking. That does not mean WhatsApp is disconnected.

## No groups appear

1. Confirm WhatsApp shows **Connected**.
2. Select **Refresh sources**.
3. Wait for **Sources found** or an explicit empty/error result.
4. Confirm the linked account is a member of the intended group and the group has a display name.
5. Try refresh again after a short wait if WhatsApp has just linked.

Source discovery is designed to work while Monitoring is Paused and uses source metadata; it should not require message history, media access or a raw JID.

## Connection lost

PatrolSafe should show **Reconnecting** and use the saved session. Check internet/DNS/firewall/proxy access to WhatsApp Web and wait for bounded recovery. When connectivity returns, a valid session should reconnect without a QR or phone action, and Monitoring should return to its previous preference.

If recovery ends with **Unable to reconnect**, confirm connectivity and select **Try again**. This is different from **Relink required**.

## Relink required

Relink only when WhatsApp has explicitly invalidated the session, the linked device was removed on the phone, or PatrolSafe instructs you to relink. Relinking creates a new WhatsApp Web session and requires an authorised phone scan. Confirm the existing site mappings after account changes.

## Evidence does not arrive

Check, in order:

1. WhatsApp is **Connected**.
2. Monitoring is **Active**, not Paused.
3. The expected group mapping is active and points to the correct site.
4. The sender is an authorised participant and is not the account linked to PatrolSafe.
5. The new item is a supported JPEG or PNG.
6. The licence/trial permits live monitoring.
7. The Evidence screen is filtered to the correct site/date.

Normal production monitoring processes new mapped arrivals. Do not enable history/backfill or test endpoints as a customer workaround.

## Information to collect for support

Record the local time, action taken, customer-visible state, whether QR/phone interaction occurred, and whether Monitoring was Active or Paused. From **Settings → Support**, copy only the requested diagnostics. Review them for account/source IDs, phone numbers, filenames and local paths before sending.

Contact **support@sfour.co.uk**. Do not attach evidence, databases, backups, passwords or WhatsApp session material to ordinary email. Vesoft will provide a case-specific secure route if such material is strictly necessary.
