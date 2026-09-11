# Licence Administration Portal (Phase 2)

Private web portal for issuing and managing TG1 offline licences. This is separate from the desktop PatrolSafe application.

## Architecture

| Workspace | Purpose |
|-----------|---------|
| `packages/license-core` | Shared TG1 Ed25519 payload, signing and verification |
| `apps/license-api` | NestJS + Prisma + PostgreSQL admin API |
| `apps/license-portal` | React + Vite internal admin UI |

The desktop app (`src/licensing/`) re-exports `@patrol/license-core` and is **not** modified for online enforcement.

## Quick start

### 1. PostgreSQL

```bash
docker compose -f docker-compose.license-portal.yml up -d
```

### 2. Environment

```bash
cp apps/license-api/.env.example apps/license-api/.env
cp apps/license-portal/.env.example apps/license-portal/.env
```

Set in `apps/license-api/.env`:

- `LICENSE_DATABASE_URL=postgresql://patrol_license:patrol_license_dev@localhost:5433/patrol_license_portal`
- `LICENSE_PRIVATE_KEY_FILE=../../.license-keys/license-private.pem` (or inline `LICENSE_PRIVATE_KEY`)
- `LICENSE_SIGNING_KEY_ID=primary-2026`
- `LICENCE_STORAGE_ENCRYPTION_KEY=` (64 hex chars — `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)
- `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` (32+ chars each)

### 3. Install and migrate

```bash
npm install
npm run license-db:migrate
npm run license-admin:create
npm run license-db:seed
```

### 4. Run

```bash
npm run license-portal:dev
```

- API: http://localhost:3010/docs (Swagger)
- Portal: http://localhost:5174

## Issue first customer licence

1. Sign in as SUPER_ADMIN
2. **Customers** → create customer
3. **Issue licence** → select customer, plan, dates, devices
4. Confirm summary → copy/download TG1 key
5. Deliver key securely to customer for desktop **Licence** page activation

## Production notes

- Private Ed25519 key only on API server (`LICENSE_PRIVATE_KEY` / `LICENSE_PRIVATE_KEY_FILE`)
- Portal never receives signing material
- Suspension/revocation affects portal records only until Phase 3 online activation
- Audit logs are append-only

See [docs/LICENSE_PORTAL.md](../docs/LICENSE_PORTAL.md) for portal setup.

Integration tests (real PostgreSQL, no Prisma mocks):

```bash
npm run license-api:test:integration
```
