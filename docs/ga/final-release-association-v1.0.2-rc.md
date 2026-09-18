# PatrolSafe v1.0.2 signed release-candidate association

Status: **SIGNED PRIVATE RC — READY FOR MANUAL GA UAT — NOT PUBLISHED**

This record binds the focused desktop-startup remediation to one private signed candidate. It does not authorize replacement of the immutable v1.0.1 public artifact, website activation, upload, tagging, or distribution.

| Identity | Certified candidate value |
|---|---|
| Product | PatrolSafe by S4 |
| Version | 1.0.2 |
| Build ID | `2026.09.18.15.37.30` |
| Windows file build | `2026.9.18.937` |
| Exact product-source/build-metadata commit | `53ca9311e430d10c181aeecf7fb4053f6e8d5812` |
| Remediation and release-notes commit | `99a0a76c116f1046b305c59d99eee563fc0c5a9a` |
| Installer filename | `PatrolEvidencePlatformSetup.exe` |
| Installer size | `193825752` bytes |
| Installer SHA-256 | `B3530782002B1F7A7E86B29AC95ACCC67A81AC1EDAD671D26197232AB775A789` |
| Main EXE size | `222819288` bytes |
| Main EXE SHA-256 | `CBCECA11FF39A2B3AACE292C0FA7C6E4FE4E3FE5495F61229009FE6528349B51` |
| Full nupkg SHA-256 | `E7DE2B049C1B2EA33FAF43BF7F79C045B79C95DB3E76466BE9F93E24C9398729` |
| Authenticode publisher | Vesoft Services Limited |
| Signature result | Valid; Microsoft public timestamp present |
| Required-PE verifier | 31 artifacts passed; zero warnings/errors |
| Required-PE manifest SHA-256 | `9393A63E50837F792B31864A3E6286E27B40539814240F036E15C580DBC7E22E` |
| Packaged dependency instances | 403 |
| Unique packaged package/version records | 361 |
| Packaged inventory SHA-256 | `EB51008D54D99B86E5A3A0DF89B3B0270470190B367C097103CD1253DB467821` |
| Third-party notices SHA-256 | `577029656F5B7F386C1F730E2D5218B235406F9DD2DDD9432AE813A562B21880` |
| Candidate location | `out/releases/patrolsafe-v1.0.2-private-rc/` |
| Publication state | Not uploaded; not published |

## Runtime certification evidence

- Full regression: 77 suites / 617 tests passed.
- Clean packaged first run: passed through setup, restart, completion and initialized relaunch; no migration-conflict modal on the clean database.
- Historical-state upgrade drill: passed with workspace, sites, mappings, evidence metadata, backup, LocalAuth, licence state and timezone preserved.
- Hostile local-service test: the v1.0.2 backend used an OS-assigned loopback endpoint; foreign services received zero PatrolSafe requests and zero desktop tokens.
- Authenticated identity test: generic health, a foreign 404 service and an invalid proof were not adopted.
- Slow-backend test: startup succeeded after the former frontend timeout; genuine timeout failed closed with sanitized support output.
- Process lifecycle: no orphaned packaged backend remained after normal shutdown.
- Trial-expiry packaged verification: passed for version 1.0.2 and this build ID.
- WhatsApp packaged smoke: authenticated dynamic endpoint became healthy, the helper used the verified loopback port, QR was produced, and disposable processes/profile were released.

## Open-source delta

The root and web package versions changed from 1.0.1 to 1.0.2, but no production dependency name/version changed in the lockfile. The signed v1.0.2 package reconciles to 403 shipped instances and 361 unique package/version records, matching the v1.0.1 technical inventory counts. Existing LGPL component/source-version correspondence is unchanged; the v1.0.2 inventory and candidate hashes above remain release-specific.

## Required next gate

Manual GA UAT must validate the signed installer on a genuinely clean Windows 11 x64 machine and a controlled copy of historical v1.0.1 state. Public acquisition must remain on hold until separate replacement/publication authorization is granted.
