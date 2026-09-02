-- Phase 4B: Organisation roles, invitations, email verification, password reset, remember-me

DO $$ BEGIN
  CREATE TYPE "CustomerRole" AS ENUM ('OWNER', 'ADMINISTRATOR', 'TECHNICAL', 'FINANCE', 'VIEWER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "OrganisationInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'CANCELLED', 'EXPIRED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "CustomerUser"
  ADD COLUMN IF NOT EXISTS "role" "CustomerRole" NOT NULL DEFAULT 'OWNER',
  ADD COLUMN IF NOT EXISTS "emailVerifiedAt" TIMESTAMP(3);

-- Existing portal users become verified Owners of their company.
UPDATE "CustomerUser"
SET "role" = 'OWNER',
    "emailVerifiedAt" = COALESCE("emailVerifiedAt", CURRENT_TIMESTAMP)
WHERE "emailVerifiedAt" IS NULL;

ALTER TABLE "CustomerRefreshToken"
  ADD COLUMN IF NOT EXISTS "rememberMe" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "CustomerSession"
  ADD COLUMN IF NOT EXISTS "rememberMe" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "OrganisationInvitation" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "role" "CustomerRole" NOT NULL,
  "status" "OrganisationInvitationStatus" NOT NULL DEFAULT 'PENDING',
  "tokenHash" TEXT NOT NULL,
  "invitedByUserId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "acceptedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "acceptedUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OrganisationInvitation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "OrganisationInvitation_tokenHash_key" ON "OrganisationInvitation"("tokenHash");
CREATE INDEX IF NOT EXISTS "OrganisationInvitation_customerId_idx" ON "OrganisationInvitation"("customerId");
CREATE INDEX IF NOT EXISTS "OrganisationInvitation_email_idx" ON "OrganisationInvitation"("email");
CREATE INDEX IF NOT EXISTS "OrganisationInvitation_status_idx" ON "OrganisationInvitation"("status");
CREATE INDEX IF NOT EXISTS "OrganisationInvitation_expiresAt_idx" ON "OrganisationInvitation"("expiresAt");

CREATE TABLE IF NOT EXISTS "CustomerPasswordResetToken" (
  "id" TEXT NOT NULL,
  "customerUserId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CustomerPasswordResetToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CustomerPasswordResetToken_tokenHash_key" ON "CustomerPasswordResetToken"("tokenHash");
CREATE INDEX IF NOT EXISTS "CustomerPasswordResetToken_customerUserId_idx" ON "CustomerPasswordResetToken"("customerUserId");
CREATE INDEX IF NOT EXISTS "CustomerPasswordResetToken_expiresAt_idx" ON "CustomerPasswordResetToken"("expiresAt");

CREATE TABLE IF NOT EXISTS "CustomerEmailVerificationToken" (
  "id" TEXT NOT NULL,
  "customerUserId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CustomerEmailVerificationToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CustomerEmailVerificationToken_tokenHash_key" ON "CustomerEmailVerificationToken"("tokenHash");
CREATE INDEX IF NOT EXISTS "CustomerEmailVerificationToken_customerUserId_idx" ON "CustomerEmailVerificationToken"("customerUserId");
CREATE INDEX IF NOT EXISTS "CustomerEmailVerificationToken_expiresAt_idx" ON "CustomerEmailVerificationToken"("expiresAt");

CREATE INDEX IF NOT EXISTS "CustomerUser_role_idx" ON "CustomerUser"("role");

DO $$ BEGIN
  ALTER TABLE "OrganisationInvitation"
    ADD CONSTRAINT "OrganisationInvitation_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "OrganisationInvitation"
    ADD CONSTRAINT "OrganisationInvitation_invitedByUserId_fkey"
    FOREIGN KEY ("invitedByUserId") REFERENCES "CustomerUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "CustomerPasswordResetToken"
    ADD CONSTRAINT "CustomerPasswordResetToken_customerUserId_fkey"
    FOREIGN KEY ("customerUserId") REFERENCES "CustomerUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "CustomerEmailVerificationToken"
    ADD CONSTRAINT "CustomerEmailVerificationToken_customerUserId_fkey"
    FOREIGN KEY ("customerUserId") REFERENCES "CustomerUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
