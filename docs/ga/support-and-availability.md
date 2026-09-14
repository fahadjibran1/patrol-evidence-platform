# PatrolSafe v1.0 — Support and international availability

Status: **MANAGEMENT APPROVED CUSTOMER COPY FOR CONTROLLED B2B PILOT**

## Availability statement

PatrolSafe is available internationally in supported countries and regions, subject to applicable law, sanctions and export restrictions, WhatsApp availability, Microsoft Windows availability, and Vesoft commercial availability. It is not represented as available, lawful, licensed or technically operable in every country.

Availability can also depend on WhatsApp/Meta account eligibility, Microsoft Edge availability, local network restrictions, licensing, payment and support capability.

For Stage 1 and Stage 2, Vesoft records and approves each business customer and jurisdiction before supply. This does not create a permanent country allowlist or approve unrestricted worldwide public availability.

## Certified desktop environment

The final private v1.0 release candidate was certified on:

- Windows 11 Pro 25H2 x64, build 26200.9445;
- Microsoft Edge 153.0.4234.32;
- 2 vCPU and 8 GB RAM in the clean UAT VM;
- 1366×768 and 1920×1080 display review;
- internet access to WhatsApp Web;
- local SQLite and customer-selected local evidence storage.

Windows 11 x64 is the supported v1 customer platform evidenced by UAT. Windows 10, Windows Server, Arm64, macOS, Linux, S mode, terminal servers, proxies requiring interactive authentication and remote/network evidence shares are not certified by this release record.

The application installer is about 202 MB; the installed app binary is about 223 MB, but total application and Windows runtime use is higher. Evidence and backups grow with image volume. Vesoft has not approved a fixed customer disk minimum; customers must monitor free capacity and size it to their retention policy.

## Requirements

- A Windows account permitted to install/uninstall desktop software. Organisational policy may require administrator approval.
- Current supported Microsoft Edge for the Windows environment.
- Defender, SmartScreen and firewall enabled.
- Reliable outbound HTTPS/WebSocket connectivity required by WhatsApp Web.
- An eligible, authorised WhatsApp account and linked-device capability.
- Local write access to AppData, evidence and chosen backup folders.
- English-language operator capability for v1.
- A reviewed workspace time zone during first-run. All sites in the workspace use that saved IANA zone; changing the Windows zone later does not change PatrolSafe's operational time.

## Support route

1. Read the Quick Start and WhatsApp troubleshooting guide.
2. Open **Settings → Support** and record the customer-safe health summary.
3. If requested, deliberately open **Advanced diagnostics** and disclose only the minimum required information.
4. If the issue remains, use an approved secure support channel for only the narrowly requested material.

Support escalation follows this data-minimisation order: customer description/redacted screenshots; customer-safe diagnostics; an exported support bundle if available; narrowly requested files; and a full backup/database only as an exceptional authorised escalation. See [secure support-data transfer](secure-support-data-transfer.md).

Product support: **support@sfour.co.uk**<br>
General enquiries: **hello@sfour.co.uk**<br>
Security or vulnerability reports: **security@sfour.co.uk**<br>
Privacy and data-protection enquiries: **privacy@sfour.co.uk**<br>
Legal notices: **legal@sfour.co.uk**

Support is available Monday–Friday, 09:00–17:00 UK local time, excluding UK public holidays. We aim to respond within 1–2 business days. This response target is not a service-level agreement and is not guaranteed. PatrolSafe v1.0 support is currently provided in English.

Do not send evidence, databases, backups, passwords or WhatsApp session material by ordinary email. Contact support first and use only a secure transfer method specifically approved for the case.

Responsible security reports should describe the affected version, observed behavior, reproduction conditions and potential impact without accessing customer data or disrupting service. Vesoft does not currently offer a bug bounty or promise payment for reports.

## Support severity

| Severity | Meaning |
|---|---|
| CRITICAL | PatrolSafe cannot capture evidence across production monitoring, or a serious security/data-integrity issue is suspected |
| HIGH | A major customer workflow is unavailable |
| NORMAL | A usage, configuration or product problem report |
| LOW | A question, cosmetic issue or request |

Severity guides triage and escalation. It does not create a contractual response or resolution time.

## Service dependencies

PatrolSafe's local application can remain available for stored evidence, but live collection depends on WhatsApp Web and internet connectivity. Third-party outages, account restrictions, policy changes and country blocking are outside Vesoft's direct control. PatrolSafe uses bounded reconnect behavior for transient network loss; independent emergency and operational fallback procedures remain the customer's responsibility.
