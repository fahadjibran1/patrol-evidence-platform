# Release Freeze Notes

**Freeze ID:** `v0.1.1-trial-freeze`  
**Date:** 2026-05-19  
**Branch intent:** Trial-ready desktop + SOC control-room UI; **no collector/ingest/schema/installer changes**

Companion docs:

- [SYSTEM_STATUS.md](./SYSTEM_STATUS.md)
- [KNOWN_WORKING_CONFIG.md](./KNOWN_WORKING_CONFIG.md)

---

## What this freeze covers

### In scope (frozen behaviour, UI polish allowed only where noted)

- Desktop-first trial with SQLite default
- WhatsApp QR linking and live image ingest
- Site → WhatsApp source mapping → patrol schedule → monitoring
- SOC-themed operations UI (Dashboard, Monitoring, Setup wizard, Evidence, Guard Safe)
- Local trial licence (collector blocked when expired; evidence retained)

### Explicitly frozen (no changes without release manager approval)

| Layer | Rule |
|-------|------|
| **WhatsApp helper** | No edits to helper main process, event protocol, or QR/auth lifecycle |
| **Backend ingest** | No changes to collector service ingest path or internal ingest APIs |
| **Database** | No new migrations, entity changes, or seed logic changes |
| **Installer / Electron** | No Forge, Squirrel, `desktop/main.js`, or packaging script changes |
| **Pinned WA stack** | No `whatsapp-web.js`, `puppeteer`, or `webVersion` bumps |

### Allowed during freeze (with build verification)

- Copy, layout, and spacing on **Setup** (`web/src/pages/setup-page.tsx`) and other **non-ingest** UI pages
- Control-room UX on Dashboard / Evidence / Guard Safe / Monitoring **only if already approved** — default policy: **no further Dashboard/Evidence/Guard Safe edits** during freeze unless hotfix
- Documentation and release checklists
- Customer handover wording

---

## Pinned versions (do not bump)

| Item | Value |
|------|-------|
| App | `0.1.1` |
| `whatsapp-web.js` | `1.34.7` |
| `puppeteer` / `puppeteer-core` | `24.38.0` |
| WhatsApp Web HTML | `2.3000.1040111714-alpha` (local vendored cache; previous remote pin 404'd) |

Details: [KNOWN_WORKING_CONFIG.md](./KNOWN_WORKING_CONFIG.md).

---

## Files that must not be touched

### WhatsApp collector (critical)

```
src/collectors/whatsapp-helper.main.ts
src/collectors/whatsapp-helper.types.ts
src/collectors/whatsapp-web-runtime.config.ts
scripts/whatsapp-web-runtime-config.js
src/collectors/whatsapp-collector.service.ts
src/collectors/whatsapp-collector.service.spec.ts
src/collectors/collectors.internal.controller.ts   # internal ingest hooks — verify before any edit
src/collectors/whatsapp-message.util.ts
```

### Evidence ingest pipeline

```
src/patrol-images/patrol-image-ingestion.service.ts
src/patrol-images/patrol-image-ingestion.service.spec.ts
```

*Controllers may receive read-only fixes only if they do not alter ingest contracts.*

### Database

```
src/database/migrations/**
src/database/data-source.ts
src/database/seeds/**
src/**/entities/**
```

### Installer / desktop shell

```
desktop/main.js
desktop/preload.js
desktop/run-migrations.js
forge.config.js
scripts/run-desktop-forge.js
scripts/create-portable-zip.js
scripts/verify-packaged-app.js
scripts/clean-desktop-build.js
web/src/pages/desktop-setup-page.tsx
```

### Package pins (require full WA regression if changed)

```
package.json          # whatsapp-web.js line
package-lock.json     # only via controlled npm install of pinned version
```

---

## Files safe for UI/docs-only hotfixes

```
web/src/pages/setup-page.tsx
web/src/styles.css                    # prefer setup-* / shared tokens; avoid global regressions
web/src/components/refresh-bar.tsx
web/src/lib/use-live-refresh.ts
web/src/lib/operator-ui.ts
web/src/components/operator-ui.tsx
CUSTOMER_HANDOVER_GUIDE.md
TRIAL_RELEASE_CHECKLIST.md
RELEASE_NOTES.md
SYSTEM_STATUS.md
KNOWN_WORKING_CONFIG.md
RELEASE_FREEZE_NOTES.md
```

**Policy:** Dashboard, Evidence, Guard Safe, and Monitoring pages are **feature-frozen** for this snapshot unless a P0 display bug is approved.

---

## Pre-freeze UI state (reference)

Recent operator-facing work (presentation only):

- Slower polling + “Last updated” + manual refresh (no scroll jump on silent refresh)
- Dashboard control-room fullscreen mode
- Guard Safe: all senders per site, grouped by site → sender → hour
- Setup: six-step guided wizard with Advanced sections for technical fields

---

## Release checklist (abbreviated)

Full list: [TRIAL_RELEASE_CHECKLIST.md](./TRIAL_RELEASE_CHECKLIST.md).

1. `npm run build` && `npm --prefix web run build`
2. `npm run desktop:make` (Windows installer)
3. `npm run desktop:verify-package`
4. Trial key activation (`TG-TRIAL-DEV` or customer key)
5. WhatsApp QR → ready → group detection
6. Setup mapping + schedule
7. Live image → Dashboard / Evidence / Guard Safe
8. Archive installer + key + these three freeze docs

---

## Hotfix process during freeze

1. Classify: **UI** vs **ingest** vs **installer** — ingest/installer need explicit approval.
2. Run build gates from [KNOWN_WORKING_CONFIG.md](./KNOWN_WORKING_CONFIG.md).
3. For any WhatsApp change: run `collector:live-debug` or packaged `collector:smoke` / `desktop:smoke-whatsapp`.
4. Update `SYSTEM_STATUS.md` if behaviour or pins change.
5. Bump freeze ID in this file only when releasing a new snapshot.

---

## Out of scope for this freeze (future)

- Cloud licence server
- Auto-update pipeline
- Multi-workstation sync
- Online billing
- Bumping `whatsapp-web.js` / WA Web HTML without dedicated regression sprint

---

## Document history

| Date | Note |
|------|------|
| 2026-05-19 | Initial release freeze snapshot (`v0.1.1-trial-freeze`) |
