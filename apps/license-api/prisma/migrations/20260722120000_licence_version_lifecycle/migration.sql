-- Phase 3D: LicenceVersion history for immutable entitlement snapshots

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE "LicenceVersionAction" AS ENUM (
  'ISSUED',
  'RENEWED',
  'REISSUED',
  'PLAN_CHANGED',
  'DEVICE_LIMIT_CHANGED',
  'REACTIVATED',
  'SUSPENDED',
  'REVOKED'
);

ALTER TABLE "Licence" ADD COLUMN "currentVersionId" TEXT;

CREATE TABLE "LicenceVersion" (
  "id" TEXT NOT NULL,
  "licenceId" TEXT NOT NULL,
  "versionNumber" INTEGER NOT NULL,
  "actionType" "LicenceVersionAction" NOT NULL,
  "plan" "LicensePlan" NOT NULL,
  "maxDevices" INTEGER NOT NULL,
  "features" JSONB NOT NULL DEFAULT '[]',
  "validFrom" DATE NOT NULL,
  "validUntil" DATE NOT NULL,
  "statusSnapshot" "LicenseStatus" NOT NULL,
  "signedLicenseEnc" TEXT,
  "payloadHash" TEXT,
  "signingKeyId" TEXT,
  "issuedByAdminId" TEXT NOT NULL,
  "previousVersionId" TEXT,
  "reason" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LicenceVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LicenceVersion_licenceId_versionNumber_key" ON "LicenceVersion"("licenceId", "versionNumber");
CREATE INDEX "LicenceVersion_licenceId_versionNumber_idx" ON "LicenceVersion"("licenceId", "versionNumber");
CREATE INDEX "LicenceVersion_statusSnapshot_idx" ON "LicenceVersion"("statusSnapshot");
CREATE INDEX "LicenceVersion_validUntil_idx" ON "LicenceVersion"("validUntil");
CREATE INDEX "LicenceVersion_createdAt_idx" ON "LicenceVersion"("createdAt");
CREATE INDEX "LicenceVersion_actionType_idx" ON "LicenceVersion"("actionType");

ALTER TABLE "LicenceVersion" ADD CONSTRAINT "LicenceVersion_licenceId_fkey" FOREIGN KEY ("licenceId") REFERENCES "Licence"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LicenceVersion" ADD CONSTRAINT "LicenceVersion_issuedByAdminId_fkey" FOREIGN KEY ("issuedByAdminId") REFERENCES "Admin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LicenceVersion" ADD CONSTRAINT "LicenceVersion_previousVersionId_fkey" FOREIGN KEY ("previousVersionId") REFERENCES "LicenceVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill version 1 for every existing issued licence (and drafts with no key as ISSUED-less skipped)
INSERT INTO "LicenceVersion" (
  "id",
  "licenceId",
  "versionNumber",
  "actionType",
  "plan",
  "maxDevices",
  "features",
  "validFrom",
  "validUntil",
  "statusSnapshot",
  "signedLicenseEnc",
  "payloadHash",
  "signingKeyId",
  "issuedByAdminId",
  "previousVersionId",
  "reason",
  "metadata",
  "createdAt"
)
SELECT
  gen_random_uuid()::text,
  l."id",
  1,
  'ISSUED',
  l."plan",
  l."maxDevices",
  COALESCE(l."features", '[]'::jsonb),
  l."startsAt",
  l."expiresAt",
  l."status",
  l."signedLicenseEnc",
  l."payloadHash",
  l."signingKeyId",
  l."createdByAdminId",
  NULL,
  CASE
    WHEN l."status" = 'REVOKED' THEN l."revocationReason"
    WHEN l."status" = 'SUSPENDED' THEN l."suspensionReason"
    ELSE NULL
  END,
  jsonb_build_object('backfilled', true, 'humanLicenseId', l."licenseId"),
  COALESCE(l."issuedAt", l."createdAt")
FROM "Licence" l
WHERE l."signedLicenseEnc" IS NOT NULL;

UPDATE "Licence" l
SET "currentVersionId" = v."id"
FROM "LicenceVersion" v
WHERE v."licenceId" = l."id"
  AND v."versionNumber" = 1
  AND l."signedLicenseEnc" IS NOT NULL;

CREATE UNIQUE INDEX "Licence_currentVersionId_key" ON "Licence"("currentVersionId");

ALTER TABLE "Licence" ADD CONSTRAINT "Licence_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "LicenceVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
