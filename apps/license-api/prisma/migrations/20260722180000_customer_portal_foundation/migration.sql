-- Phase 4A: Customer portal identity, sessions, download counters, audit actor

ALTER TABLE "Customer"
  ADD COLUMN IF NOT EXISTS "technicalContactName" TEXT,
  ADD COLUMN IF NOT EXISTS "technicalContactEmail" TEXT,
  ADD COLUMN IF NOT EXISTS "technicalContactPhone" TEXT;

ALTER TABLE "Licence"
  ADD COLUMN IF NOT EXISTS "downloadCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "lastDownloadedAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "CustomerUser" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "phone" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
  "mfaSecretEnc" TEXT,
  "notifyLicence" BOOLEAN NOT NULL DEFAULT true,
  "notifyGeneral" BOOLEAN NOT NULL DEFAULT true,
  "notifySystem" BOOLEAN NOT NULL DEFAULT true,
  "lastLoginAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CustomerUser_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CustomerUser_email_key" ON "CustomerUser"("email");
CREATE INDEX IF NOT EXISTS "CustomerUser_customerId_idx" ON "CustomerUser"("customerId");
CREATE INDEX IF NOT EXISTS "CustomerUser_email_idx" ON "CustomerUser"("email");

CREATE TABLE IF NOT EXISTS "CustomerRefreshToken" (
  "id" TEXT NOT NULL,
  "customerUserId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CustomerRefreshToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CustomerRefreshToken_tokenHash_key" ON "CustomerRefreshToken"("tokenHash");
CREATE INDEX IF NOT EXISTS "CustomerRefreshToken_customerUserId_idx" ON "CustomerRefreshToken"("customerUserId");

CREATE TABLE IF NOT EXISTS "CustomerSession" (
  "id" TEXT NOT NULL,
  "customerUserId" TEXT NOT NULL,
  "refreshTokenId" TEXT,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "mfaVerifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CustomerSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CustomerSession_refreshTokenId_key" ON "CustomerSession"("refreshTokenId");
CREATE INDEX IF NOT EXISTS "CustomerSession_customerUserId_idx" ON "CustomerSession"("customerUserId");
CREATE INDEX IF NOT EXISTS "CustomerSession_expiresAt_idx" ON "CustomerSession"("expiresAt");

ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "actorCustomerUserId" TEXT;
CREATE INDEX IF NOT EXISTS "AuditLog_actorCustomerUserId_idx" ON "AuditLog"("actorCustomerUserId");

DO $$ BEGIN
  ALTER TABLE "CustomerUser"
    ADD CONSTRAINT "CustomerUser_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "CustomerRefreshToken"
    ADD CONSTRAINT "CustomerRefreshToken_customerUserId_fkey"
    FOREIGN KEY ("customerUserId") REFERENCES "CustomerUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "CustomerSession"
    ADD CONSTRAINT "CustomerSession_customerUserId_fkey"
    FOREIGN KEY ("customerUserId") REFERENCES "CustomerUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "CustomerSession"
    ADD CONSTRAINT "CustomerSession_refreshTokenId_fkey"
    FOREIGN KEY ("refreshTokenId") REFERENCES "CustomerRefreshToken"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AuditLog"
    ADD CONSTRAINT "AuditLog_actorCustomerUserId_fkey"
    FOREIGN KEY ("actorCustomerUserId") REFERENCES "CustomerUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
