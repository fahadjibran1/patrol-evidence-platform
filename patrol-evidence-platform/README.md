# Patrol Evidence Platform (MVP Foundation)

This repository now contains **Phase 1 + Phase 2 (backend)** for a production-style patrol evidence and compliance platform.

## Assumptions

1. UTC is used for backend slot generation in this MVP; production timezone support should be added per-site later.
2. WhatsApp direct transport integration remains an adapter boundary (Phase 3), while Phase 2 focuses on compliance automation.
3. PostgreSQL is the source of truth for schedules, slots, evidence metadata, and alerts.
4. Local filesystem remains the active evidence storage provider via `STORAGE_ROOT_PATH`.

## Phase Status

1. ✅ **Phase 1:** scaffold app, env config, entities, migration, storage service, seed data, CRUD for sites/groups/schedules.
2. ✅ **Phase 2:** patrol slot generation engine, on-time/late/duplicate logic, missing patrol cron + alerts, unit tests.
3. ⏳ **Phase 3:** collector ingestion pipeline and manual ingest/storage pipeline hardening.
4. ⏳ **Phase 4:** dashboard/report endpoints and admin UI.
5. ⏳ **Phase 5:** deployment docs and guard-app integration technical notes.

## Key Modules (Current)

- `sites`
- `patrol-groups`
- `patrol-schedules`
- `patrol-images`
- `patrol-slots`
- `patrol-alerts`
- `compliance`
- `storage`

## Environment

Copy `.env.example` to `.env` and configure values.

## Run

```bash
npm install
npm run migration:run
npm run seed
npm run start:dev
```

## Implemented API (Phase 1 + 2 backend)

- `GET /health`
- CRUD:
  - `/sites`
  - `/patrol-groups`
  - `/patrol-schedules`
- Patrol image ingest (backend testing path):
  - `POST /patrol-images`
  - `POST /patrol-images/manual-ingest` (multipart: `siteCode`, `timestamp`, `senderName`, `file`)
- Patrol slots query:
  - `GET /patrol-slots?siteCode=OXF01&date=YYYY-MM-DD`
- Compliance operations:
  - `POST /compliance/generate-slots` with `{ "date": "YYYY-MM-DD" }`
  - `POST /compliance/generate-today` -> `{ "slotsCreated": number, "sitesProcessed": number }`
- Dashboard endpoints:
  - `GET /dashboard/live-sites`
  - `GET /dashboard/missing-patrols`
  - `GET /dashboard/daily-report?siteCode=OXF01&date=YYYY-MM-DD`

## Compliance Rules in Phase 2

- Slot generation uses active site + active schedule + active day matching.
- Slot status transitions:
  - `PENDING`
  - `RECEIVED_ON_TIME`
  - `RECEIVED_LATE`
  - `MISSING`
  - `DUPLICATE`
- First valid image resolves a slot and links `imageId`.
- Next image for the same slot is marked `DUPLICATE`.
- Cron job runs every 5 minutes, marks stale unresolved slots as `MISSING`, and raises `MISSING_PATROL` alerts.

## Storage

`StorageService` saves files as:

```text
{STORAGE_ROOT_PATH}/{siteCode}/{YYYY-MM-DD}/{siteCode}_{YYYY-MM-DD}_{HH-MM-SS}.jpg
```

All path segments are sanitized and directories are auto-created.


## Ingestion Test Script

Run a 5-upload manual ingest simulation for one site:

```bash
./scripts/simulate-5-uploads.sh http://localhost:3000 OXF01 ./sample.jpg ManualTester
```

## WhatsApp 1-Site Pilot (Adapter + Mock Harness)

This implementation keeps WhatsApp as a **thin adapter** and does not change core compliance logic.

### Pilot env vars

```env
WHATSAPP_ENABLED=true
WHATSAPP_PILOT_GROUP_NAME=My Site Group
WHATSAPP_PILOT_SITE_CODE=OXF01
WHATSAPP_SESSION_PATH=./.whatsapp-session
```

### Current pilot behavior

- Adapter logs connect/disconnect states.
- Non-media or non-image messages are ignored.
- Only one configured pilot group is mapped to one site code.
- Image bytes are forwarded into existing `PatrolImageIngestionService`.

### Local mock test (no live WhatsApp transport)

Use mock endpoint to simulate a WhatsApp image event into ingestion pipeline:

```bash
curl -X POST http://localhost:3000/collectors/whatsapp/mock-image \
  -F "groupName=My Site Group" \
  -F "senderName=Ali" \
  -F "timestamp=2026-03-21T09:00:00Z" \
  -F "file=@./sample.jpg"
```

This is intentionally scoped to a 1-site pilot until transport reliability is validated.
