# DRAFT — REQUIRES LEGAL REVIEW

# PatrolSafe v1.0.0 third-party software notices register

This register explains the technical evidence behind the generated customer notice bundle. It is not legal approval and must be reconciled against the exact final signed GA package.

## Current unsigned-package evidence

- repository production resolution: **488 unique package/version records**;
- packaged application: **403 package instances / 361 unique package/version records**;
- notice bundle: **241 unique texts** (238 direct packaged-dependency texts plus three supplemental Electron/Squirrel texts);
- shipped packages with missing licence metadata: **0**;
- exact inventory SHA-256: `DC45DBF4BC2C5D463597FCC536DACAC6C49A41B74378B2D5436FCB7DB8D2E963`;
- draft notice bundle SHA-256: `B7FDD1EF9C8543B326681FC99B7C102C3665F2ECEC1B32CD3828418D5A4B0C17`.

The distributable draft is [THIRD_PARTY_NOTICES_DRAFT.txt](THIRD_PARTY_NOTICES_DRAFT.txt). The [technical audit](third-party-technical-audit.md), exact [packaged inventory](generated/third-party-production-dependencies.csv), [repository inventory](generated/repository-production-dependencies.csv), and [reconciliation](generated/third-party-reconciliation.csv) provide traceability.

## Review boundary

Two LGPL-related packages and four special/compound expressions remain **LEGAL REVIEW REQUIRED**. Their directly available texts are collected. The engineering corrections removed a nested-example false positive, excluded an unnecessary generated Prisma payload from the desktop package, and deliberately marked the private internal `@patrol/license-core` package `UNLICENSED`.

The final review must also cover Electron/Chromium/Node material, Squirrel/Forge installer/updater binaries, native library obligations, application assets and marks. The packaged Electron root `LICENSE` and `LICENSES.chromium.html` are hashed in the technical audit; the full Chromium credits remain in the packaged application rather than being duplicated into this documentation repository.

## Final release actions

1. Counsel approves the LGPL, special/compound, attribution, asset and trademark treatment.
2. Counsel approves where notices and any source/relinking information must be accessible.
3. Release engineering reruns the inventory against the exact final signed GA package.
4. The approved notice bundle, inventory hash, source/docs commits, installer hash, publisher and timestamp are bound in the final release association.

Do not state that third-party legal compliance is complete until those actions are recorded.
