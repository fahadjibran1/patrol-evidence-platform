# PatrolSafe v1.0 Microsoft Store readiness

Status: **GO WITH SEPARATE STORE ENGINEERING PHASE — SUBMISSION NOT READY OR AUTHORIZED**

Assessment date: 15 September 2026

This is a release-engineering assessment, not a Store submission or a representation that Microsoft has approved PatrolSafe.

## Current official requirements

Microsoft currently permits traditional EXE/MSI desktop applications in the Store. The installer must be a standalone/offline EXE or MSI, every PE must be trusted-code-signed, the download URL must be HTTPS and versioned, its bytes must not change, and installation must be silent (UAC is allowed). EXE submissions must provide the silent parameters and installer return-code handling. See Microsoft’s [EXE/MSI package requirements](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msi/app-package-requirements) and [package upload fields](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msi/upload-app-packages).

PatrolSafe already satisfies the offline-setup form, x64 identity, immutable version/hash model and signed-PE requirements. Its Squirrel installer was certified through normal UI installation, but its unattended/silent invocation, return codes and Store-controlled install/uninstall lifecycle have not been certified. That is the immediate Store engineering gap.

The current v1.0.0 binary also lacks an in-process boundary that stops an already-running collector when its local trial expires. That is a direct-download and Store blocker independent of packaging.

## Architecture compatibility

| Area | Existing EXE/MSI listing | New MSIX package |
|---|---|---|
| Electron | Accepted as a Win32 framework; no framework-specific exclusion found | Technically packageable, but behavior must be retested |
| Installer | Reuse exact signed Squirrel Setup if Store silent-install requirements pass | Replace Squirrel install packaging |
| Signature | Store does not re-sign EXE/MSI; current Vesoft signature remains essential | Store re-signs the MSIX submission |
| Runtime containment | Same unpackaged Win32 model used in UAT | Package identity/virtualization may change behavior |
| Data paths | Existing AppData, SQLite, evidence, DPAPI and LocalAuth paths retained | AppData/registry virtualization and uninstall cleanup can alter persistence |
| WhatsApp/Edge | Same external Edge/Puppeteer process model as certified direct build | Must prove external Edge launch, profile ownership and localhost behavior |
| Updates | Store does not update existing EXE/MSI users; app/installer remains responsible | Store-managed updates |
| Engineering risk | Medium | High |
| v1 recommendation | **Preferred Store route for investigation** | Defer unless EXE route fails or MSIX benefits justify full recertification |

Microsoft’s current distribution comparison confirms that EXE/MSI Store submissions retain manual/app-managed updates, whereas MSIX gets Store updates. See [Windows app distribution paths](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/choose-distribution-path) and [EXE/MSI updates](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msi/publish-update-to-your-app-on-store).

## Developer and product identity requirements

Vesoft needs a verified Partner Center company developer account enrolled for Windows apps, with company/entity, address, domain and individual company-approver evidence. Microsoft records publisher/seller identifiers and requires the publisher display name. Vesoft must then reserve the product name, create the EXE/MSI product, select x64, markets, pricing/discoverability, age rating and listing metadata, and provide privacy/support/website URLs, logos and screenshots. See [company verification requirements](https://learn.microsoft.com/en-us/windows/apps/publish/store-business-verification-reqs), [Partner Center account management](https://learn.microsoft.com/en-us/partner-center/account-settings/manage-account), and [Store submission steps](https://learn.microsoft.com/en-us/windows/apps/publish/faq/submit-your-app).

Do not create or assume the availability of the `PatrolSafe by S4` reservation in this phase.

## Licensing and commerce

PatrolSafe is a non-game PC application. Current Store policy allows non-game PC products to use secure third-party commerce, including subscriptions, rather than requiring Microsoft commerce. See [Microsoft Store Policies, section 10.8](https://learn.microsoft.com/en-us/windows/apps/publish/store-policies).

Accordingly, the existing local 30-day trial and Vesoft-issued offline Annual licence are not inherently incompatible. The application does not capture payment: it exports a request file and directs the customer to Vesoft. Store listing pricing (`Free`, `Freemium`, `Subscription` or `Paid`) and trial disclosure must accurately explain that acquisition begins an app-managed 30-day trial and continued use of live operations requires a separately supplied £299 Annual workstation licence. Microsoft’s EXE/MSI submission UI supports pricing and market selection, including specific markets and direct-link-only visibility. See [EXE/MSI pricing and availability](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msi/price-and-availability) and [market selection](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msi/market-selection).

The exact presentation and external licence journey still require Partner Center review/certification. Do not add Store commerce or change licensing during readiness work.

## Update policy

For a Store EXE/MSI channel, retain one Squirrel-installed application and one update authority. The present release has no certified automatic Squirrel feed; Microsoft states the Store does not deliver EXE/MSI updates to existing users. A later version should be submitted in Partner Center at a new immutable installer URL and customers must receive an explicit supported upgrade route.

For a future MSIX channel, remove/disable the Squirrel updater and let Store package servicing own updates. Never ship active Squirrel and Store update agents in the same MSIX channel.

## Data-path and WhatsApp risks

MSIX can virtualize AppData and registry writes and remove redirected state on uninstall. That can change the certified behavior of the SQLite database, LocalAuth, HKCU trial marker, DPAPI-bound licence state, evidence paths, backup/restore and uninstall persistence. Microsoft documents the virtualization differences in [flexible virtualization](https://learn.microsoft.com/en-us/windows/msix/desktop/flexible-virtualization) and [packaged desktop app behavior](https://learn.microsoft.com/en-us/windows/msix/desktop/desktop-to-uwp-behind-the-scenes).

The unpackaged EXE route retains the certified full-trust model, so external Edge launch, Puppeteer DevTools connection, LocalAuth profile and localhost backend should remain architecturally unchanged. This is an inference from the unchanged packaging model, not Store certification evidence. The Store-mode installer and a clean Store acquisition still need end-to-end tests for QR link, reconnect, evidence, restart, backup, uninstall/reinstall and signatures.

## Separate Store engineering gate

Before any submission:

1. Verify/create a Vesoft company Partner Center account and reserve the product name.
2. Repair and certify the active-monitoring trial-expiry lifecycle under a new immutable version/build.
3. Host that exact replacement installer at the final immutable versioned HTTPS CDN URL.
4. Determine and certify the Squirrel Setup silent switch, exit codes, already-installed behavior and silent uninstall/update behavior.
5. Run the Microsoft submission package validation and clean Store-equivalent install tests.
6. Prepare privacy/support/website URLs, listing copy, age rating, logos and sanitized screenshots.
7. Select explicit initial markets; do not accept the default all-markets setting without management review.
8. Agree whether the listing is Free/Freemium/Subscription and disclose the app-managed 30-day trial and external Annual licensing accurately.
9. Confirm WhatsApp/Meta dependency wording and policy acceptability during certification.
10. Exercise update and withdrawal behavior without dual updaters.
11. Obtain explicit operator authorization before submitting or publishing.

## Recommendation

- Microsoft Store architecture: **GO WITH SEPARATE STORE ENGINEERING PHASE**.
- First route to test: existing signed unpackaged Win32/Squirrel EXE submission.
- MSIX conversion for v1.0: **NO-GO without a new build and full recertification**.
- Microsoft Store submission today: **NO-GO**.
- Direct website trial should not be delayed by Store work once its separate publication gates close.
