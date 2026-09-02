# Developer Setup

## Requirements

- Node.js 22.x
- npm 10+
- Docker (for Postgres/Redis/MailHog)
- PostgreSQL client tools (`pg_dump`/`psql`) for backup scripts

## Bootstrap

```bash
npm ci
npm run docker:dev
cp .env.development apps/license-api/.env
# Generate signing key if needed:
npm run license:generate-keypair
npm run license-db:migrate
npm run license-db:seed
npm run license-admin:create
```

## Run locally

```bash
npm run license-api:dev          # :3010
npm run license-portal:web:dev   # :5174
npm run customer-portal:dev      # :5175
```

Worker (requires Redis):

```bash
npm run license-api:build
REDIS_URL=redis://localhost:6379 npm run license-api:worker
```

## Tests

```bash
npm test --workspace @patrol/license-api
npm run license-api:test:integration
npm test --workspace @patrol/license-portal
npm test --workspace @patrol/customer-portal
npm test
npm run build
```

## Useful docs

- [Architecture.md](./Architecture.md)
- [Deployment.md](./Deployment.md)
- `apps/license-api/.env.example`
