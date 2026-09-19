# PatrolSafe v1.0.2 UAT-05 monitoring-fixed signed release-candidate association

Status: **SIGNED PRIVATE RC - READY FOR FINAL MANUAL GA UAT - NOT PUBLISHED**

This record binds the monitoring-startup remediation to one private signed candidate. It does not authorize replacement of the immutable v1.0.1 public artifact, website activation, upload, tagging, pushing, or distribution. The earlier v1.0.2 release candidates remain preserved as separate evidence.

| Identity | Certified candidate value |
|---|---|
| Product | PatrolSafe by S4 |
| Version | 1.0.2 |
| Build ID | `2026.09.19.11.17.30` |
| Windows file build | `2026.9.19.677` |
| Baseline commit | `b59dfc6b610983e926fa3d6c6f668f517d882b70` |
| Monitoring remediation commit | `c688f4bbc1f807c33dbd6f97bcb89774ba82a6ec` |
| Build-metadata commit | `9ab06a6fea3854b5414eab5131b0cf963e2f9895` |
| Installer filename | `PatrolEvidencePlatformSetup.exe` |
| Installer size | `193837536` bytes |
| Installer SHA-256 | `EA3C6874D3FE66712B43CA3C99559DCEA89E70B1B21919B02616EBFD90F0E969` |
| Main EXE size | `222819296` bytes |
| Main EXE SHA-256 | `01CC25D6EB5AD843E97507122591AE627847589401E7615C2FA8E6FDF1FC9F1C` |
| Full nupkg SHA-256 | `6B2A063C7547592CC55D35A3E759907F8969CF62DED08C4F8D3D083964021F22` |
| Authenticode publisher | Vesoft Services Limited |
| Signature result | Valid; Microsoft public timestamp present |
| Required-PE verifier | 31 artifacts passed; zero warnings/errors |
| Required-PE manifest SHA-256 | `6B0907FA5F018859A8851FC49A6F2EFE642D2B27EC8FFCF5A57DFB39218F0936` |
| Packaged dependency instances | 403 |
| Unique packaged package/version records | 361 |
| Collected licence/notice texts | 241 |
| Packaged dependency inventory SHA-256 | `DC45DBF4BC2C5D463597FCC536DACAC6C49A41B74378B2D5436FCB7DB8D2E963` |
| Third-party notices SHA-256 | `C81F68A73EE81A3B0726E417E785965A59C2588AA0336AC8BCA42F2391FC2CDF` |
| Candidate location | `out/releases/patrolsafe-v1.0.2-private-rc-2026.09.19.11.17.30/` |
| Publication state | Not uploaded; not published |

## Remediation certification evidence

- Packaged collector auto-start remains enabled but helper creation is deferred until the backend has bound an OS-assigned loopback port and Electron has authenticated the spawned backend identity.
- Packaged helper launch rejects unresolved endpoints and port 0. The signed packaged WhatsApp smoke passed with the exact authoritative endpoint `http://127.0.0.1:60312`.
- Runtime-configuration fetch failure now fails closed with a bounded actionable error; it no longer fabricates `monitoringEnabled=false` and an empty mapping set.
- Monitoring enablement uses request-correlated helper acknowledgement. Success requires the expected three production listeners; missing acknowledgement or listener attachment transitions from STARTING to ERROR after a bounded timeout.
- Deterministic integration coverage proved six active mappings, seven excluded paused conflicts, three production listeners, and ACTIVE monitoring. Schedule coverage does not gate global listener attachment.
- Full regression: 81 suites / 639 tests passed.
- Hostile packaged-startup regression: foreign services received zero PatrolSafe requests and zero desktop tokens; OS-assigned loopback startup, forged identity rejection, delayed readiness, genuine timeout and no-orphan normal shutdown passed.
- Signed clean first run passed company/admin setup, restart/resume and initialized reopen.
- Dirty-upgrade/durability drill passed, including mapping-conflict preservation, historical warning suppression, LocalAuth/licence preservation, evidence integrity and atomic restore.
- Signed packaged trial-expiry verification passed for version 1.0.2 and Build ID `2026.09.19.11.17.30`.
- Signed packaged WhatsApp smoke reached the fresh-link QR path and released the disposable helper/managed Edge profile on shutdown.

## Open-source delta

No production dependency name/version changed from the preceding v1.0.2 RC. The signed package retains 403 shipped instances and 361 unique package/version records, with 241 collected licence/notice texts. LGPL and special-licence component versions are unchanged; prior legal-review status remains unchanged.

## Required next gate

Final manual installed GA UAT must validate the preserved real LocalAuth/session state, six active mappings with seven paused conflicts excluded, `productionListenerCount=3`, ACTIVE monitoring, and owned helper/Edge cleanup on normal exit. Public acquisition remains on hold pending separate release authorization.
