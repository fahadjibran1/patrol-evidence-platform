# PatrolSafe v1.0.3 private commercial staging candidate

## Scope

- Purpose: first external commercial sandbox end-to-end UAT only.
- Source baseline: `432bd6e98d6a4c28a280fd75a17fc0b421b84233` on `v1.0.3-commercial-licensing`.
- Version: `1.0.3`.
- Build ID: `2026.09.24.23.00.34`.
- Windows build: `2026.9.24.1380`.
- Display/installer identity: `PatrolSafe by S4 STAGING` / `PatrolSafe-v1.0.3-Commercial-Staging-Setup.exe`.
- This is not a GA build and is not authorized for publication.

## Commercial staging binding

- Service origin: `https://patrolsafe-commercial-staging.onrender.com`.
- Purchase origin: `https://patrolsafe-commercial-staging.onrender.com`.
- Packaged runtime flags: `PATROLSAFE_COMMERCIAL_STAGING=true` and `PATROLSAFE_COMMERCIAL_STAGING_BUILD=true`.
- Both origins must match the exact HTTPS origin. There is no wildcard `onrender.com` allowance and no production endpoint fallback.
- Online issuer key ID: `test-phase6-online-key`.
- Staging public-key SPKI SHA-256: `688340412959FBC23E8C3F0CB17BC6CFC2EE121254ACE2256D66216B2A512582`.
- Legacy production/manual verifier key ID remains `vesoft-offline-v1`.
- Legacy public-key SPKI SHA-256: `B5A5BAC26845548A84B01A76817AE0EBD54DB1E205F8D224153BB5694926777D`.

The staging public key was packaged from the authorized public PEM under the local temporary staging-key directory. The corresponding private PEM was not read or packaged. Package scanning found only public PEM files and no private-key marker, Stripe key, Stripe webhook secret, PostgreSQL URL, or Resend API-key pattern.

## Pricing copy

The desktop and staging customer purchase page say `£299 total (VAT included)`. The server-owned Stripe Price, amount, currency, payment mode, and tax configuration were not changed. Render has `autoDeploy: false`; the staging service must be manually redeployed from the final source commit before the first browser E2E so this copy is live. No public S4 website was changed.

## Artifact identity

- Installer bytes: `194047456`.
- Installer SHA-256: `D302C34521B12C7C666A8A6A0595477690BFE0931ADF5A2E914C1CEF58E82DE5`.
- Main EXE SHA-256: `9DFA5BE21C096248D20A88D19B24E1F81A108E67BFBD95F97647E03A829D3DC6`.
- Authenticode: valid; publisher `Vesoft Services Limited`; Microsoft timestamp verified.
- Required signed PE verification: 31 artifacts, zero verification errors.
- Packaged `ws`: `8.21.3` only.

## Verification

- Root regression: 94 suites / 717 tests passed.
- Licence API unit regression: 46 suites / 265 tests passed.
- Licence API integration regression: 19 suites / 79 tests passed against disposable PostgreSQL with all 16 migrations.
- Licence portal: 11 files / 66 tests passed.
- Customer portal: 3 files / 9 tests passed.
- Licence core: 2 suites / 14 tests passed.
- Backend, frontend, customer portal, licence API, licence portal, and licence-core builds passed.
- Packaged backend and exact 720-hour clean trial smoke passed.
- First-run/restart durability smoke passed.
- Packaged WhatsApp/managed Edge smoke passed and released its disposable process tree.
- Production dependency audits: desktop/repository 0 critical; licence API 0 critical with the previously reviewed transitive lodash high remaining. No new production dependency was introduced.

## Manual E2E checklist

1. Verify the installer SHA-256 above.
2. Ensure the Render staging service is manually deployed from the final source commit and remains connected only to sandbox resources.
3. Install `PatrolSafe by S4 STAGING`; do not replace or publish the v1.0.2 GA artifact.
4. Open **Licence** and select **Buy annual licence**.
5. Confirm PatrolSafe submits an authenticated `PurchaseRequestV2`; do not fabricate a reference or seed an order.
6. Confirm the system browser opens only the exact Render staging origin with an opaque reference.
7. Confirm Checkout shows **PatrolSafe Annual Licence**, **£299.00 total**, **GBP**, **one-time**, and Stripe sandbox/test mode.
8. Complete the approved Stripe test payment and follow the staging operator approval, test issuance, secure delivery, download, and `.tglic` import flow.
9. Confirm PatrolSafe changes to Licensed immediately and remains Licensed after restart.
