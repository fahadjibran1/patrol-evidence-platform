# PatrolSafe v1.0.0 third-party package technical audit

Status: **TECHNICALLY COMPLETE FOR CURRENT UNSIGNED PACKAGE — LEGAL REVIEW AND FINAL-ARTIFACT RECONCILIATION REQUIRED**

Audit source commit: `b785ac88f69acb285b616623b78eb152172be634`
Audited tree: `out/PatrolSafe by S4-win32-x64/resources/app`

## Reconciliation result

Phase 11B counted 488 unique package/version records in the repository's production dependency resolution. That number is not the shipped package count: it includes workspace/application resolution that Electron packaging prunes or transforms.

The current unsigned packaged application contains:

- 405 package instances with a usable name and version;
- 363 unique package/version records;
- 238 unique collected `LICENSE`, `LICENCE`, `COPYING`, `NOTICE` or `COPYRIGHT` texts;
- Electron's root `LICENSE` (1,096 bytes; SHA-256 `5154E165BD6C2CC0CFBCD8916498C7ABAB0497923BAFCD5CB07673FE8480087D`);
- Electron/Chromium `LICENSES.chromium.html` (19,472,684 bytes; SHA-256 `C1BC6CFDD6C5844720E5E6332698A6131F5402E77ABF1FDB9646740D38065A65`).

The repeatable generator is `scripts/generate-ga-third-party-inventory.js`. Its outputs are:

- [exact packaged dependency inventory](generated/third-party-production-dependencies.csv);
- [collected dependency licence/notice texts](generated/third-party-license-texts.md);
- [machine-readable counts and review queue](generated/third-party-inventory-summary.json).

The CSV records every unique packaged package/version, declared licence, direct licence-text filenames and hashes, packaged paths, repository and homepage metadata. The collected-text file preserves every direct package licence/notice text found and deduplicates identical texts by SHA-256.

## Declared licence metadata

| Declared expression | Unique package/version records |
|---|---:|
| MIT | 283 |
| ISC | 29 |
| Apache-2.0 | 22 |
| BSD-2-Clause | 9 |
| BSD-3-Clause | 5 |
| BlueOak-1.0.0 | 4 |
| Missing | 3 |
| Apache-2.0 AND LGPL-3.0-or-later | 1 |
| LGPL-3.0-or-later | 1 |
| Python-2.0 | 1 |
| MIT OR WTFPL | 1 |
| BSD-2-Clause OR MIT OR Apache-2.0 | 1 |
| MIT AND BSD-3-Clause | 1 |
| Apache 2.0 (non-SPDX form) | 1 |
| 0BSD | 1 |

Metadata describes packages; it does not establish that every obligation is satisfied.

## Mandatory legal/release review queue

| Package | Version | Finding | Technical evidence / decision needed |
|---|---:|---|---|
| `@img/sharp-win32-x64` | 0.35.4 | `Apache-2.0 AND LGPL-3.0-or-later` | Native libvips distribution; counsel must confirm LGPL notices, source/relinking obligations and delivery method |
| `node-webpmux` | 3.2.1 | `LGPL-3.0-or-later` | Copyleft review required; exact use/distribution obligations must be approved |
| `argparse` | 2.0.1 | `Python-2.0` | Special licence text collected; attribution/notice review required |
| `expand-template` | 2.0.3 | `MIT OR WTFPL` | Select/document the relied-on alternative and ship its required text |
| `rc` | 1.2.8 | BSD/MIT/Apache alternatives | Select/document the relied-on alternative; all three supplied texts were collected |
| `sha.js` | 2.4.12 | `MIT AND BSD-3-Clause` | Preserve both applicable notices |
| `@patrol/license-core` | 0.1.0 | Internal package without licence metadata | Confirm proprietary/internal status and set deliberate package metadata before the final artefact inventory |
| `beep-boop` | 1.2.3 | No declared licence or direct licence file | Resolve provenance/licence or remove from shipped runtime through an approved engineering change before GA |
| generated `prisma-client-…` | 5.22.0 | Generated package has no declared licence/direct file | Trace to Prisma generator/runtime notices and document correct attribution |

No AGPL package was identified by declared metadata. LGPL findings exist and are not cleared by this engineering audit. No commercial-use prohibition was concluded from the common permissive metadata, but that is a legal conclusion and remains for counsel. The two packages with missing external/generated metadata are unresolved.

## Other distributable material

The npm inventory does not, by itself, decide rights for:

- Electron, Chromium and Node binaries and their embedded credits;
- Squirrel/Forge installer and updater binaries;
- native libraries included by Sharp/libvips and `better-sqlite3`;
- the approved PatrolSafe icon, fonts and other application assets;
- WhatsApp Web compatibility/cache material and WhatsApp/Meta marks;
- Windows/Microsoft Edge references or marks;
- optional/platform-specific files introduced by the final maker/signing pipeline.

Those items must be reconciled against the exact signed GA installer. The large Chromium credits file is present in the packaged application but is indexed rather than copied into this repository documentation pack.

## Status boundary

The inventory mechanism and current unsigned-package evidence are **TECHNICALLY COMPLETE**. Third-party legal compliance is **REQUIRES LEGAL REVIEW**. Publication remains **BLOCKED** until:

1. the missing, compound, special and LGPL findings are resolved;
2. the final notices/attributions and their in-product/distribution location are approved;
3. the generator is rerun against the exact final signed GA package;
4. package list, licence texts, Electron/Chromium credits, source commit and installer SHA-256 are reconciled and recorded;
5. counsel signs off the final notice bundle.
