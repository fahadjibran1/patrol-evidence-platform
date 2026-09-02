# Backup & Recovery — License API

This document covers backing up and restoring the License API's PostgreSQL database, safely
rolling forward/backward across Prisma migrations, and the end-to-end recovery procedure for
a lost or corrupted database. It assumes a Render-hosted Postgres instance, but the `pg_dump`
/ `pg_restore` commands work against any PostgreSQL 13+ target.

## 1. What needs to be backed up

| Item | Where it lives | Backed up by |
| --- | --- | --- |
| Application data (customers, licences, payments, audit log, notification log, admins) | Postgres (`LICENSE_DATABASE_URL`) | `pg_dump` (below) or Render's managed automatic backups |
| Encryption key for stored TG1 licence keys (`LICENCE_STORAGE_ENCRYPTION_KEY`) | Secret manager / Render env vars | Out of band — **never** in the DB dump |
| Ed25519 signing key (`LICENSE_PRIVATE_KEY` / `LICENSE_PRIVATE_KEY_FILE`) | Secret manager / Render env vars | Out of band — **never** in the DB dump |
| SMTP credentials | Render env vars | Out of band |

The database dump alone is **not sufficient** to restore a fully working deployment — the
encryption key and signing key must be restored from your secrets manager alongside it.
Losing `LICENCE_STORAGE_ENCRYPTION_KEY` makes every previously issued TG1 licence key
permanently unrecoverable (the ciphertext in `Licence.signedLicenseEnc` cannot be decrypted).

## 2. Taking a backup

### 2.1 On-demand `pg_dump` (custom format, recommended)

```bash
# From a machine with network access to the DB (Render dashboard exposes an "External
# Database URL" for exactly this purpose).
pg_dump "$LICENSE_DATABASE_URL" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file="license-api-$(date +%Y%m%dT%H%M%S).dump"
```

- `--format=custom` produces a compressed, `pg_restore`-only file that supports selective
  table restore and parallel restore (`-j`).
- Store the resulting `.dump` file in versioned, encrypted object storage (e.g. an S3 bucket
  with server-side encryption and lifecycle rules) — never commit it to git.

### 2.2 Plain-SQL dump (for quick diffing / manual inspection)

```bash
pg_dump "$LICENSE_DATABASE_URL" --no-owner --no-privileges > license-api-$(date +%Y%m%dT%H%M%S).sql
```

### 2.3 Render managed backups

If the database is a Render Postgres instance, Render also takes automatic daily backups
(retention depends on plan) — see the "Backups" tab on the database's dashboard page. Treat
these as a safety net, not a replacement for your own `pg_dump` schedule, since Render backups
are only retrievable through the Render dashboard/API and are deleted when the database is
deleted.

### 2.4 Suggested schedule

- **Daily** automated `pg_dump --format=custom` via a scheduled job (e.g. a Render Cron Job
  running the command above and uploading to object storage).
- **Before every production migration** (`prisma migrate deploy`), take an ad-hoc backup —
  see §4.

## 3. Restoring from a backup

### 3.1 Restore into a **new** database (safest — verify before cutting over)

```bash
# Create a fresh database, then:
pg_restore \
  --no-owner \
  --no-privileges \
  --dbname="$NEW_LICENSE_DATABASE_URL" \
  --jobs=4 \
  license-api-20260722T140000.dump
```

Point a scratch copy of the API at `$NEW_LICENSE_DATABASE_URL` and sanity-check:

```bash
LICENSE_DATABASE_URL="$NEW_LICENSE_DATABASE_URL" npx prisma migrate status
```

### 3.2 Restore in place (disaster recovery)

1. Put the service into maintenance (scale web service to 0 instances, or return 503s).
2. Take a final `pg_dump` of the broken database if it is at all queryable (for forensics).
3. Drop and recreate the target database, or restore into a new one and repoint
   `LICENSE_DATABASE_URL`.
4. `pg_restore --no-owner --no-privileges --dbname="$LICENSE_DATABASE_URL" --jobs=4 <dump-file>`
5. Run `npx prisma migrate status` to confirm the restored schema's migration history matches
   what's checked into `prisma/migrations/`.
6. If the dump predates newer migrations, run `npx prisma migrate deploy` to bring the schema
   up to date.
7. Restart the web service.
8. Verify `/health/ready` reports `database: true` and re-check `/admin/system/status`.

## 4. Migrations: rollout and rollback

Migrations are applied with:

```bash
npx prisma migrate deploy
```

This is **additive-only** by design in this codebase (e.g. `ADD VALUE IF NOT EXISTS` for enum
changes) so a deploy that only adds a migration is safe to leave applied even if the
accompanying code deploy is rolled back — new enum values / nullable columns are ignored by
older code.

### 4.1 If a migration fails partway through

`prisma migrate deploy` records a `_prisma_migrations` row per migration. If one fails partway:

```bash
# Inspect what Prisma thinks happened:
npx prisma migrate status

# If the migration's SQL did NOT actually apply (failed before any DDL ran), mark it as
# rolled back so it can be retried after a fix:
npx prisma migrate resolve --rolled-back <migration_name>

# If the migration's SQL DID apply but Prisma lost track (e.g. deploy was killed mid-way),
# and you've verified the schema state manually, mark it as applied instead:
npx prisma migrate resolve --applied <migration_name>
```

Never hand-edit `_prisma_migrations` directly — always use `prisma migrate resolve`.

### 4.2 Rolling back a bad migration

Prisma has no automatic "down" migration. To roll back:

1. Restore the pre-migration `pg_dump` taken in §2.4, **or**
2. Write and apply a new forward migration that undoes the change (e.g. drop the column that
   was just added) — preferred when the database has already received new writes, since
   restoring from backup would lose them.

Because this schema favours additive changes (new enum values, nullable columns), most
"rollbacks" are simply "don't deploy the code that starts using the new field yet" rather than
an actual schema rollback.

## 5. Recovery checklist (quick reference)

1. Identify the last known-good backup (`.dump` file timestamp) or Render managed backup.
2. Restore into a **new** database first; verify with `prisma migrate status` and a manual
   spot-check of a few `Licence` / `Customer` rows.
3. Confirm `LICENCE_STORAGE_ENCRYPTION_KEY` and `LICENSE_SIGNING_KEY_ID` /
   `LICENSE_PRIVATE_KEY` in the environment match what was in place when the backup was taken
   — otherwise previously issued TG1 keys will fail to decrypt/verify.
4. Repoint `LICENSE_DATABASE_URL` at the restored database (or swap DNS/connection string).
5. Run `npx prisma migrate deploy` if the backup predates the current migration set.
6. Redeploy/restart the API.
7. Verify `GET /health/ready` and `GET /admin/system/status` both report healthy, then resume
   traffic.
8. Post-incident: re-run a fresh `pg_dump` immediately once the service is healthy again.
