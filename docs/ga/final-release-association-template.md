# PatrolSafe v1.0.0 final release association

Status: **TEMPLATE — COMPLETE ONLY FOR THE FINAL SIGNED GA BUILD**

This record prevents approval of one source/document set from being transferred to a different installer. Populate every field from the final fail-closed build and verifier output; do not use an earlier private UAT hash.

| Identity | Final value |
|---|---|
| Product | PatrolSafe by S4 |
| Version | 1.0.0 |
| Source commit | `[40-character commit]` |
| Documentation commit | `[40-character commit]` |
| Package/build ID | `[build ID]` |
| Installer filename | `PatrolEvidencePlatformSetup.exe` |
| Installer SHA-256 | `[64 hexadecimal characters]` |
| Main installed EXE SHA-256 | `[64 hexadecimal characters]` |
| Authenticode publisher | `Vesoft Services Limited` |
| Timestamp result | `[valid timestamp authority and time]` |
| Required PE verification | `[manifest/verifier result and hash]` |
| Third-party packaged inventory SHA-256 | `[64 hexadecimal characters]` |
| Third-party notices SHA-256 | `[64 hexadecimal characters]` |
| Release date | `[YYYY-MM-DD]` |
| Supported countries/regions decision | `[approval reference]` |
| Legal/document approval | `[approval reference and date]` |
| Release officer approval | `[name/reference and date]` |

## Required checks

1. Confirm source and documentation commits are immutable and the tracked tree was clean before build.
2. Generate exactly one final GA candidate through the certified signing pipeline.
3. Rerun the package inventory against that exact built/installed tree.
4. Verify installer, main EXE, updater and every required helper PE.
5. Hash installer, installed main EXE, verifier manifest, packaged inventory and notices.
6. Confirm customer documents contain the approved identity, contacts, commercial terms and legal text.
7. Obtain explicit publication approval referring to this completed record.

This template is not publication approval.
