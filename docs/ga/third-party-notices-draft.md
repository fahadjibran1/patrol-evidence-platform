# DRAFT — REQUIRES LEGAL REVIEW

# PatrolSafe v1.0.0 third-party software notices register

**This is an audit register, not the final notices file. Do not ship it as a complete attribution notice.** The complete packaged transitive dependency tree, bundled binaries/assets, licence texts, copyrights and notice obligations must be generated from the exact final installer and reviewed before publication.

Direct runtime package metadata currently reports:

| Component | Audited version | Declared licence |
|---|---:|---|
| NestJS common/core/platform-express/config/mapped-types/schedule/typeorm | 10.4.22 / 3.3.0 / 2.1.0 / 4.1.2 / 10.0.2 | MIT |
| better-sqlite3 | 12.9.0 | MIT |
| class-transformer | 0.5.1 | MIT |
| class-validator | 0.14.4 | MIT |
| pg | 8.20.0 | MIT |
| TypeORM | 0.3.28 | MIT |
| qrcode-terminal | 0.12.0 | Apache License 2.0 (metadata form) |
| reflect-metadata | 0.2.2 | Apache-2.0 |
| RxJS | 7.8.2 | Apache-2.0 |
| sharp | 0.35.4 | Apache-2.0 |
| whatsapp-web.js | 1.34.7 | Apache-2.0 |
| `@patrol/license-core` | 0.1.0 | Internal workspace; package metadata has no licence field |

Electron, Chromium, Node.js, Squirrel/Forge packaging components, native libraries, fonts/icons and transitive packages also require review even if not listed as direct runtime dependencies.

## Phase 11B production dependency inventory

The production dependency tree resolved from the current repository contained **488 unique package-name/version records**. Declared metadata included 359 MIT, 55 ISC, 34 Apache-2.0, 9 BSD-2-Clause, 8 BSD-3-Clause and 4 BlueOak-1.0.0 records, plus compound or less common licence expressions that require notice-by-notice review. Counts are an engineering inventory, not a legal conclusion and not a substitute for the licence texts shipped with the exact final package.

Five internal workspace/application package records did not declare a `license` field:

- `@patrol/customer-portal@0.1.0`
- `@patrol/license-api@0.1.0`
- `@patrol/license-core@0.1.0`
- `@patrol/license-portal@0.1.0`
- `patrol-evidence-web@1.0.0`

These internal metadata gaps must be resolved deliberately. The final notice review must also resolve compound expressions, optional/platform-specific packages, bundled Electron/Chromium/Node material, Squirrel binaries, native modules, assets and any dependency that is present in the distributable but absent from an `npm --omit=dev` view.

## Release actions

1. Regenerate and reconcile the inventory from the exact installed/package tree, not only root `package.json` or the current 488-record repository view.
2. Resolve missing/ambiguous/deprecated licence expressions and packages with no metadata.
3. Include full licence and NOTICE text where required, preserving copyright statements.
4. Confirm Electron/Chromium credits and native binary notices are reachable in the installed product or accompanying distribution.
5. Verify the approved PatrolSafe icon, cached WhatsApp Web material and other assets have documented distribution rights.
6. Record the inventory tool/version, source commit, installer hash and legal approval.
7. Place the approved notices in the installer/application and customer distribution as counsel directs.

No proprietary ownership claim over third-party components should conflict with their licences.
