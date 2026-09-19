# PatrolSafe v1.0.2 UAT-03 signed release-candidate association

Status: **SIGNED PRIVATE RC — READY FOR MANUAL GA UAT — NOT PUBLISHED**

This record binds the licence-state synchronisation and WhatsApp recovery remediation to one private signed candidate. It does not authorize replacement of the immutable v1.0.1 public artifact, website activation, upload, tagging, or distribution. The earlier v1.0.2 RC remains preserved as separate evidence.

| Identity | Certified candidate value |
|---|---|
| Product | PatrolSafe by S4 |
| Version | 1.0.2 |
| Build ID | `2026.09.19.00.44.19` |
| Windows file build | `2026.9.19.44` |
| Baseline commit | `d9084c07a4e95ffa746d805ff8f7a905e360dab8` |
| Remediation commit | `88b9fc9607e1feff9c6097f6a71430d27ec225ca` |
| Build-metadata commit | `555f3b31` |
| Installer filename | `PatrolEvidencePlatformSetup.exe` |
| Installer size | `193835488` bytes |
| Installer SHA-256 | `1934FF6A3EC663AB51C023CA269D6F9F1DA5194CC00AD01B459D2E9C49D52272` |
| Main EXE size | `222819296` bytes |
| Main EXE SHA-256 | `01C55641E60CEBAF4C7310AFEA6A59E00635E58DBD812D1F15174D7BA7437E5F` |
| Full nupkg SHA-256 | `465AD1032D9FCDCDC2F968E88B899645FB727C932849570898A1FCF642E430CB` |
| Authenticode publisher | Vesoft Services Limited |
| Signature result | Valid; Microsoft public timestamp present |
| Required-PE verifier | 31 artifacts passed; zero warnings/errors |
| Required-PE manifest SHA-256 | `DFAE9CB1842EF5AD208DD1604DDBD8F560105D67DBC78924518287C59DA40B0F` |
| Packaged dependency instances | 403 |
| Unique packaged package/version records | 361 |
| Packaged dependency inventory SHA-256 | `DC45DBF4BC2C5D463597FCC536DACAC6C49A41B74378B2D5436FCB7DB8D2E963` |
| Packaged dependency set SHA-256 | `C1169F049C23E031B49DF4622049BAF9AEB8976DDE4E310AFC82547653C85A07` |
| Third-party notices SHA-256 | `577029656F5B7F386C1F730E2D5218B235406F9DD2DDD9432AE813A562B21880` |
| Candidate location | `out/releases/patrolsafe-v1.0.2-private-rc-2026.09.19.00.44.19/` |
| Publication state | Not uploaded; not published |

## Remediation certification evidence

- Shared frontend entitlement provider reconciles `/license/status` and `/desktop/bootstrap/status` after licence import or deactivation. Deterministic tests prove live `EXPIRED` to `ACTIVE` and inverse transitions without renderer reload or restart.
- Licence activation distinguishes Step 1 request (`.tgreq`) from Step 2 activation (`.tglic`); the activation picker filters for `.tglic`, while backend validation remains authoritative.
- Unexpected WhatsApp session loss starts a bounded fresh connection generation when recovery remains safe, otherwise settles in `RELINK_REQUIRED`. Obsolete-generation authenticated and ready callbacks remain rejected.
- LocalAuth is preserved during automatic recovery; explicit relink remains the only controlled session-archive path.
- Monitoring now distinguishes active, waiting for WhatsApp, paused/relink-required, and actionable error states.
- Full regression: 81 suites / 633 tests passed.
- Hostile packaged-startup regression: foreign services received zero PatrolSafe requests and zero desktop tokens; the signed app used an OS-assigned loopback endpoint; slow startup and genuine timeout paths passed; no backend orphan remained.
- Signed clean first run: backend and UI flows passed through setup, restart and completion; `Asia/Dubai` workspace timezone and trial/install identity survived restart.
- Dirty-upgrade and durability drill: all checks passed, including historical mapping-conflict notification suppression, LocalAuth/licence preservation, evidence integrity, and atomic restore.
- Signed packaged trial-expiry verification passed for version 1.0.2 and Build ID `2026.09.19.00.44.19`.
- Signed packaged WhatsApp smoke passed through the authenticated dynamic endpoint, fresh-link QR state, and disposable profile/process cleanup.

## Open-source delta

No production dependency name/version changed from the previous v1.0.2 RC. The signed package contains 403 shipped instances and 361 unique package/version records, matching the existing technically reviewed inventory. LGPL and special-licence component versions are unchanged; prior legal-risk status remains unchanged.

## Required next gate

Manual GA UAT must validate in the installed signed RC: immediate same-renderer licence-state synchronisation after importing a workstation-bound Annual licence, preserved-session WhatsApp recovery after unexpected session loss, terminal relink-required UX when recovery is not valid, and successful explicit relink. Public acquisition remains on hold pending separate release authorization.
