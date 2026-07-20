# Patrol Licence Administration API

NestJS backend for the private licence administration portal. Manages customers, TG1 signed licences, payments, installations, and audit logs.

## Prerequisites

- Node.js 22.x (matches monorepo engines)
- PostgreSQL 14+
- Ed25519 signing key pair (`npm run license:generate-keypair` from repo root)

## Quick start

```bash
# From repository root
cp apps/license-api/.env.example apps/license-api/.env
# Edit LICENSE_DATABASE_URL, JWT_SECRET, LICENCE_STORAGE_ENCRYPTION_KEY, signing key paths

npm install
npm run license-db:migrate
npm run license-admin:create
npm run license-db:seed   # optional demo data
npm run license-api:dev
```

API: `http://localhost:3010`  
Swagger: `http://localhost:3010/docs`

The portal dev server (port 5174) proxies `/admin` to this API when using `npm run license-portal:dev`.

## Environment variables

| Variable | Description |
|----------|-------------|
| `LICENSE_API_PORT` | HTTP port (default `3010`) |
| `LICENSE_PORTAL_ORIGIN` | CORS origin for portal (default `http://localhost:5174`) |
| `LICENSE_DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | JWT signing secret (min 32 chars) |
| `JWT_ACCESS_EXPIRES_IN` | Access token TTL (default `15m`) |
| `JWT_REFRESH_EXPIRES_IN` | Refresh token TTL (default `7d`) |
| `LICENCE_STORAGE_ENCRYPTION_KEY` | 64 hex chars (32-byte AES-256-GCM key) |
| `LICENSE_PRIVATE_KEY` | Inline Ed25519 private key PEM |
| `LICENSE_PRIVATE_KEY_FILE` | Path to private key PEM file |
| `LICENSE_SIGNING_KEY_ID` | Key identifier stored on issued licences |

Production startup fails if the signing key is missing or invalid. Tests may inject a key via `SigningService.useTestKey()`.

## Create the first SUPER_ADMIN

```bash
npm run license-admin:create
# or with explicit args:
npm run admin:create --workspace @patrol/license-api -- --email admin@example.com --password 'YourSecurePass123'
```

## Issue a licence

1. Log in via `POST /admin/auth/login`
2. Create a customer: `POST /admin/customers`
3. Issue immediately: `POST /admin/licences/issue` with customer, plan, dates, and max devices
4. The response includes the full `signedLicenseKey` once; list/detail endpoints return masked keys only
5. Admins may reveal a key later via `POST /admin/licences/:id/reveal` with password confirmation (not available to SUPPORT)

## Roles

| Role | Capabilities |
|------|--------------|
| `SUPER_ADMIN` | Full access including admin user management |
| `ADMIN` | Customers, licences, payments, audit (cannot manage SUPER_ADMIN accounts) |
| `SUPPORT` | Read customers/licences, notes, installations; cannot issue/renew/suspend/revoke/reveal keys |

## Integration tests

PostgreSQL-backed tests live under `test/integration/` and use a real database (no Prisma transaction mocks).

```bash
# Uses LICENSE_TEST_DATABASE_URL, or LICENSE_DATABASE_URL, or DB_* + patrol_license_portal_test
npm run test:integration --workspace @patrol/license-api
# or from repo root:
npm run license-api:test:integration
```

These tests:

- issue 20 concurrent licences repeatedly and assert unique `PEL-YYYY-NNNNNN` IDs
- verify issued TG1 keys with `@patrol/license-core` against Phase 1 expiry rules


## Phase 2 limitations

- Suspension/revocation updates portal records only; offline desktop activations are not remotely disabled
- No online activation, Stripe, customer self-service, or automatic emails

## Production notes (Render)

- Bind to `0.0.0.0:$PORT` (handled in `main.ts` via `LICENSE_API_PORT` or platform `PORT`)
- Store secrets in environment variables, not the filesystem
- Use managed PostgreSQL for `LICENSE_DATABASE_URL`
- Never log or expose the Ed25519 private key
