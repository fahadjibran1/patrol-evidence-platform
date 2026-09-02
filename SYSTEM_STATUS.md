# System Status — Release Freeze Snapshot

**Product:** Patrol Evidence Platform  
**Freeze label:** `0.1.1` (see `package.json`)  
**Snapshot date:** 2026-05-19  
**Purpose:** Single source of truth for what is working and frozen at trial release.

Related documents:

- [KNOWN_WORKING_CONFIG.md](./KNOWN_WORKING_CONFIG.md) — pinned dependency and environment matrix
- [RELEASE_FREEZE_NOTES.md](./RELEASE_FREEZE_NOTES.md) — freeze rules, scope, and change policy

---

## Executive summary

| Area | Status | Notes |
|------|--------|--------|
| NestJS API + SQLite (desktop) | **Working** | Default desktop trial path; auto DB under AppData |
| NestJS API + PostgreSQL | **Working** | Advanced / server deployments via desktop wizard or `.env` |
| React operations UI (SOC theme) | **Working** | Dashboard, Evidence, Guard Safe, Monitoring, Setup |
| WhatsApp collector (helper process) | **Working** | Pinned `whatsapp-web.js` + pinned WA Web HTML version |
| Evidence ingest + storage | **Working** | Do not modify ingest pipeline during freeze |
| Desktop Electron shell | **Working** | First-run wizard + packaged Windows installer flow |
| Trial licence (local) | **Working** | Blocks collector start when expired; evidence remains readable |

---

## WhatsApp collector stack (frozen)

These versions are **intentionally pinned**. Do not bump without a full regression pass (QR link, live image, backfill, packaged smoke).

| Component | Pinned value | Defined in |
|-----------|--------------|------------|
| `whatsapp-web.js` | **1.34.7** (exact, not caret) | `package.json` |
| `puppeteer` (transitive via wwebjs) | **24.38.0** | `package-lock.json` |
| `puppeteer-core` | **24.38.0** | `package-lock.json` |
| WhatsApp Web HTML version | **2.3000.1040111714-alpha** (local strict cache) | `src/collectors/whatsapp-web-runtime.config.ts` + `src/collectors/wa-web-cache/` |
| WA version cache | **remote** (`wppconnect-team/wa-version`) | same file |

Runtime summary is logged at helper startup via `formatWhatsAppRuntimeConfigSummary()`.

Optional overrides (avoid in production unless support directs):

- `PATROL_WHATSAPP_WEB_VERSION`
- `PATROL_WHATSAPP_WEB_VERSION_CACHE_URL`
- `PATROL_WHATSAPP_WEB_VERSION_STRICT=true`

---

## Application surfaces

| Surface | Route / entry | Role |
|---------|---------------|------|
| Operations dashboard | `/` | Live site compliance, control-room fullscreen |
| Monitoring | `/collector` | WhatsApp QR, start/stop, link status |
| Setup | `/setup` | Guided site → WhatsApp → mapping → schedule |
| Evidence | `/evidence` | Gallery / timeline (read-focused at freeze) |
| Guard Safe | `/guard-safe` | Hourly sender timelines |
| Sites | `/sites` | Site CRUD (Setup also creates sites) |
| Advanced diagnostics | `/settings/diagnostics` | Internal collector diagnostics |
| Desktop first-run | `/desktop/setup` | Installer-only workspace bootstrap |

Polling intervals (UI only, frozen in this release):

- Dashboard / Monitoring: **60s**
- Evidence: **120s**
- Guard Safe: **180s**

---

## Backend health indicators

**Healthy collector**

- `GET /collectors/whatsapp/status` → `ready: true` (or `connected` during link)
- Groups/contacts lists populate after link: `GET /collectors/whatsapp/groups`, `/contacts`
- Live image in mapped group → row in DB + file under `STORAGE_ROOT_PATH`

**Healthy desktop**

- `AppData/Roaming/Patrol Evidence Platform/desktop-runtime.log` shows backend listening and frontend loaded
- `workspace-config.json` present; trial licence `ACTIVE` when using trial key

**Healthy ingest (do not change)**

- Helper emits `PATROL_COLLECTOR_EVENT` lines → `whatsapp-collector.service.ts` → `patrol-image-ingestion.service.ts`

---

## Build verification (minimum)

From repository root:

```powershell
npm run build
npm --prefix web run build
```

For desktop release candidates, additionally:

```powershell
npm run desktop:verify-package
npm run desktop:smoke-backend
```

See [KNOWN_WORKING_CONFIG.md](./KNOWN_WORKING_CONFIG.md) for full test flows.

---

## Known limitations (accepted at freeze)

- Local licence validation only (no cloud licence server)
- WhatsApp Web breakage risk if Meta changes web client (mitigated by pinned `webVersion` + remote cache)
- Single-workstation desktop trial is the primary supported operator path
- PostgreSQL still supported but not required for default SQLite desktop trials

---

## Support artefacts

| Document | Audience |
|----------|----------|
| [CUSTOMER_HANDOVER_GUIDE.md](./CUSTOMER_HANDOVER_GUIDE.md) | Customer / operator |
| [TRIAL_RELEASE_CHECKLIST.md](./TRIAL_RELEASE_CHECKLIST.md) | Internal release QA |
| [RELEASE_NOTES.md](./RELEASE_NOTES.md) | Short release summary |

Log locations:

- Desktop: `%AppData%/Patrol Evidence Platform/desktop-runtime.log`
- Collector live debug: `%TEMP%/patrol-evidence-platform/collector-runtime.log` (when using `npm run collector:live-debug`)
