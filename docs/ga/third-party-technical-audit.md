# PatrolSafe v1.0.0 third-party package technical audit

Status: **TECHNICALLY COMPLETE FOR CURRENT UNSIGNED PACKAGE — LEGAL REVIEW AND FINAL-ARTIFACT RECONCILIATION REQUIRED**

Audited source commit: `8613fb9e4641ffe93b8d4631e601413acbdb7e1c`<br>
Audited tree: `out/PatrolSafe by S4-win32-x64/resources/app`

## Exact reconciliation

The repository production dependency resolution contains **488** unique package/version records. The unsigned packaged application built from the audited commit contains **403 package instances** and **361 unique package/version records**. The generated notice bundle contains **241 unique licence/notice texts**: 238 direct packaged-dependency texts and three supplemental Electron/Squirrel build-input texts.

The difference is traceable in [the reconciliation CSV](generated/third-party-reconciliation.csv). Dev-only and non-shipped repository records are not presented as shipped components.

| Artifact | SHA-256 |
|---|---|
| Repository production dependency inventory | `3BF3A54CF88767F9961F4078D78A920770066B43B74605AA7EF3CE3A5A605540` |
| Packaged production dependency inventory | `DC45DBF4BC2C5D463597FCC536DACAC6C49A41B74378B2D5436FCB7DB8D2E963` |
| Repository/package reconciliation | `AED6C962727A4AA7BEDCAEB80732C6D2F4ECBA58ED7CE514C6FD1DAC530A5C04` |
| `THIRD_PARTY_NOTICES_DRAFT.txt` | `ED480D05C3164C8D41F28207443DBC96FF79A7E0105709AECAA73442D4B0F371` |

Packaged Electron also carries root `LICENSE` (SHA-256 `5154E165BD6C2CC0CFBCD8916498C7ABAB0497923BAFCD5CB07673FE8480087D`) and `LICENSES.chromium.html` (SHA-256 `C1BC6CFDD6C5844720E5E6332698A6131F5402E77ABF1FDB9646740D38065A65`).

## Release-engineering findings

| Finding | Classification | Resolution |
|---|---|---|
| `beep-boop@1.2.3` | C — PACKAGE NOT SHIPPED | It came from a nested example `node_modules` tree that was incorrectly traversed. Actual package-root enumeration removes the false positive. |
| Generated `.prisma/client` package | C — PACKAGE NOT SHIPPED | It was unnecessary licensing-service payload in the desktop tree. A narrow Forge exclusion removes `.prisma`; packaged backend/trial smoke passes. |
| `@patrol/license-core@0.1.0` missing metadata | D then A — METADATA DEFECT RESOLVED | Private internal workspace now deliberately declares `UNLICENSED`; required runtime files are still verified. |
| Two LGPL findings | B — LEGAL REVIEW REQUIRED | Components and texts are identified; engineering does not decide distribution obligations. |
| Four compound/special expressions | A technically; B legally | All directly available licence texts are collected. Counsel must approve the relied-on alternative/combined obligations. |

There are now **zero shipped missing-metadata gaps**. No AGPL package was identified by declared metadata. This is a factual inventory result, not legal clearance.

## Remaining review queue

| Package | Version | Expression | Technical state | Remaining decision |
|---|---:|---|---|---|
| `@img/sharp-win32-x64` | 0.35.4 | `Apache-2.0 AND LGPL-3.0-or-later` | Text collected | LGPL/libvips obligations — **LEGAL REVIEW REQUIRED** |
| `node-webpmux` | 3.2.1 | `LGPL-3.0-or-later` | `COPYING.LESSER` collected | LGPL obligations — **LEGAL REVIEW REQUIRED** |
| `argparse` | 2.0.1 | `Python-2.0` | Text collected | Notice approval — **LEGAL REVIEW REQUIRED** |
| `expand-template` | 2.0.3 | `MIT OR WTFPL` | Text collected | Approve relied-on alternative |
| `rc` | 1.2.8 | `BSD-2-Clause OR MIT OR Apache-2.0` | All three supplied texts collected | Approve relied-on alternative |
| `sha.js` | 2.4.12 | `MIT AND BSD-3-Clause` | Combined text collected | Confirm notice presentation |

## Reproducible artifacts

- [Repository production inventory](generated/repository-production-dependencies.csv)
- [Exact packaged inventory](generated/third-party-production-dependencies.csv)
- [Repository/package reconciliation](generated/third-party-reconciliation.csv)
- [Machine-readable summary](generated/third-party-inventory-summary.json)
- [Collected licence texts](generated/third-party-license-texts.md)
- [Customer notice bundle draft](THIRD_PARTY_NOTICES_DRAFT.txt)

The generator is `scripts/generate-ga-third-party-inventory.js`. It enumerates actual package roots (including scoped and nested dependency roots), not arbitrary nested example fixtures.

## Gate boundary

The current unsigned-package inventory is **TECHNICALLY COMPLETE**. Publication remains blocked until counsel approves third-party obligations and notice placement, and release engineering reruns the inventory against the exact final signed GA package and binds its hash to the final release association.
