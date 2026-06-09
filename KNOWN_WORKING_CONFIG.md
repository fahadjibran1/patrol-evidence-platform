# Known Working Configuration — Release Freeze

**Snapshot:** 2026-05-19 · **App version:** `0.1.1`  
**See also:** [SYSTEM_STATUS.md](./SYSTEM_STATUS.md) · [RELEASE_FREEZE_NOTES.md](./RELEASE_FREEZE_NOTES.md)

This document records the **exact** dependency and environment matrix verified for the trial release freeze. Treat deviations as **out of support** until re-tested.

---

## Pinned dependency matrix

| Package | Version | How locked |
|---------|---------|------------|
| **whatsapp-web.js** | `1.34.7` | Exact dependency in root `package.json` (no `^`) |
| **puppeteer** | `24.38.0` | Transitive dependency of `whatsapp-web.js@1.34.7` (`package-lock.json`) |
| **puppeteer-core** | `24.38.0` | Transitive (`package-lock.json`) |
| **WhatsApp Web HTML** | `2.3000.1039703269-alpha` | Default in `src/collectors/whatsapp-web-runtime.config.ts` |
| **WA HTML cache** | Remote, non-strict | `type: 'remote'`, `strict: false` unless `PATROL_WHATSAPP_WEB_VERSION_STRICT=true` |
| **Node.js** | `>= 18` | Required by `whatsapp-web.js` engines field |

### WA Web version cache URL (default)

```text
https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/{version}.html
```

`{version}` is replaced with `2.3000.1039703269-alpha`.

### Runtime config source of truth

| File | Purpose |
|------|---------|
| `src/collectors/whatsapp-web-runtime.config.ts` | TypeScript helper + Nest collector |
| `scripts/whatsapp-web-runtime-config.js` | Node smoke/probe scripts (keep in sync manually) |

**Do not change** these without updating both files and re-running collector smoke tests.

---

## Required environment variables

### Always required for a running API

| Variable | Example | Purpose |
|----------|---------|---------|
| `JWT_SECRET` | Long random string (≥16 chars) | API auth signing |
| `STORAGE_ROOT_PATH` | `./Security_Patrols` | Evidence image root |

### Timezone / business

| Variable | Default | Purpose |
|----------|---------|---------|
| `APP_TIMEZONE` or `BUSINESS_TIMEZONE` | `Europe/London` | Patrol date/hour bucketing |
| `SECURITY_COMPANY_NAME` | `Tech Guards Security` | Stamped metadata |
| `TRIAL_DAYS` | `30` | Desktop trial length |
| `LICENSE_SIGNING_SECRET` | (dev default in code) | Trial key generation/validation |

### Database — desktop trial (recommended)

| Variable | Value | Purpose |
|----------|-------|---------|
| `DB_TYPE` | `sqlite` | Local file DB (desktop default when unset in Electron) |
| `SQLITE_DB_PATH` | *(optional)* | Override path; desktop uses AppData when unset |

### Database — PostgreSQL (advanced)

| Variable | Example |
|----------|---------|
| `DB_HOST` | `localhost` |
| `DB_PORT` | `5432` |
| `DB_USER` | `postgres` |
| `DB_PASSWORD` | *(secret)* |
| `DB_NAME` | `patrol_evidence` |

Run migrations after first connect:

```bash
npm run migration:run
```

### WhatsApp collector

| Variable | Freeze default | Purpose |
|----------|----------------|---------|
| `WHATSAPP_ENABLED` | `false` in `.env.example`; **true** in desktop workspace | Master enable |
| `WHATSAPP_AUTO_START` | `false` | Auto-start helper on API boot |
| `WHATSAPP_HEADLESS` | `true` (browser dev); desktop may use visible browser | Puppeteer headless |
| `WHATSAPP_ALLOW_FROM_ME` | `false` | Accept images sent by linked account to self |
| `WHATSAPP_BACKFILL_MESSAGE_LIMIT` | `150` | History backfill cap |
| `WHATSAPP_SESSION_PATH` | `./whatsapp-session` | LocalAuth session dir |
| `WHATSAPP_CHROME_PATH` | *(optional)* | Edge/Chrome executable override on Windows |
| `WHATSAPP_PILOT_GROUP_NAME` | *(empty)* | Fallback routing pilot only |
| `WHATSAPP_PILOT_SITE_CODE` | *(empty)* | Fallback routing pilot only |

### WhatsApp Web pin overrides (avoid unless directed)

| Variable | Default when unset |
|----------|-------------------|
| `PATROL_WHATSAPP_WEB_VERSION` | `2.3000.1039703269-alpha` |
| `PATROL_WHATSAPP_WEB_VERSION_CACHE_URL` | wppconnect `wa-version` URL above |
| `PATROL_WHATSAPP_WEB_VERSION_STRICT` | `false` |

### API server

| Variable | Default |
|----------|---------|
| `PORT` | `3000` |
| `NODE_ENV` | `development` |
| `JWT_EXPIRES_IN_HOURS` | `12` |

### Helper process (internal / smoke / live-debug)

| Variable | Typical value |
|----------|----------------|
| `PATROL_HELPER_API_BASE_URL` | `http://localhost:3001` |
| `PATROL_HELPER_INTERNAL_TOKEN` | Must match backend internal token |
| `PATROL_HELPER_SESSION_PATH` | Custom session dir for probes |
| `PATROL_HELPER_LIVE_DEBUG` | `true` for `collector:live-debug` |
| `PATROL_HELPER_BROWSER_LAUNCH_GRACE_MS` | `90000` — first-launch Edge open grace |
| `PATROL_HELPER_QR_TIMEOUT_MS` | `120000` — QR wait after WhatsApp Web page load |
| `PATROL_HELPER_STARTUP_RETRIES` | `2` — retries for blank QR / slow Edge only |
| `PATROL_HELPER_QR_REUSE_MAX_AGE_MS` | `300000` — reuse cached QR file on startup |

Copy baseline from [.env.example](./.env.example).

---

## Startup commands

### One-time install

```bash
npm install
npm --prefix web install
```

### Browser + API development (no Electron)

Terminal 1 — API:

```bash
npm run build
# Copy .env.example to .env and set JWT_SECRET, WHATSAPP_ENABLED=true for collector tests
npm run start:dev
```

Terminal 2 — UI:

```bash
npm run frontend:dev
```

Open: `http://localhost:5173` (Vite proxies API per project config).

### Desktop development (recommended for WhatsApp QR)

```bash
npm run desktop:dev
```

Starts Vite, Electron, and backend. DevTools: `Ctrl+Shift+I`. Debug: `APP_DEBUG=true npm run desktop:dev`.

### Production-style API only

```bash
npm run build
npm run start
```

### Desktop packaging (release team only)

```powershell
npm run build
npm --prefix web run build
npm run desktop:make
```

Outputs: `out/make/squirrel.windows/x64/PatrolEvidencePlatformSetup.exe`

---

## Known working test flows

### A. Operator smoke (manual — primary sign-off)

1. Start app (`desktop:dev` or installed desktop).
2. Log in as admin (or complete desktop first-run with trial key `TG-TRIAL-DEV` for dev).
3. **Setup → Step 1:** Create site (e.g. code `DEMO1`, name `Demo Site`).
4. **Setup → Step 2:** Open **Monitoring**, start collector, scan QR with patrol phone, wait for **Connected/Live**.
5. **Setup → Steps 3–4:** Choose **Group** or **Contact**, **Refresh sources**, map to site, save.
6. **Setup → Step 5:** Save patrol schedule (e.g. hourly, 06:00–22:00, Mon–Fri).
7. **Setup → Step 6:** Confirm monitoring live; open **Dashboard**.
8. Send a **real image** in the mapped WhatsApp chat from a guard phone.
9. Within one refresh cycle, confirm:
   - **Evidence** shows new image
   - **Dashboard** site card updates
   - **Guard Safe** shows sender row for that site/date
10. Confirm scroll does not jump on auto-refresh; manual **Refresh** updates “Last updated”.

### B. API simulate ingest (no WhatsApp browser)

Requires running API, admin JWT, mapped `siteCode` + `externalGroupId`:

```bash
set PATROL_API=http://localhost:3000
set PATROL_TOKEN=<admin-jwt>
node scripts/simulate-whatsapp-live-image.js DEMO1 120363xxxx@g.us
```

### C. Helper live debug (engineering)

```bash
npm run build
# API running on PATROL_HELPER_API_BASE_URL
npm run collector:live-debug
```

Scan QR in opened browser window; send real image to mapped group; watch stdout / `collector-runtime.log`.

### D. Packaged collector smoke (Windows CI / release)

```powershell
npm run desktop:package
npm run desktop:smoke-backend
npm run collector:smoke
npm run desktop:smoke-whatsapp
```

Optional: `PATROL_PACKAGED_APP_DIR` points at `out/PatrolEvidencePlatform-win32-x64`.

### E. Build gate (every change during freeze)

```bash
npm run build
npm --prefix web run build
```

UI-only changes may run only `npm --prefix web run build` if agreed in [RELEASE_FREEZE_NOTES.md](./RELEASE_FREEZE_NOTES.md).

---

## Desktop trial key (development)

```text
TG-TRIAL-DEV
```

Generates signed keys: `npm run license:generate-trial -- "Company Name" 2026-05-19 30`

---

## Evidence path layout (working)

```text
{STORAGE_ROOT_PATH}/{siteCode}/{YYYY-MM-DD}/{HH00}/{filename}.jpg
```

Example:

```text
C:\...\Security_Patrols\DEMO1\2026-05-19\1400\DEMO1_2026-05-19_14-02-30_....jpg
```
