-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'SUPPORT');

-- CreateEnum
CREATE TYPE "CustomerStatus" AS ENUM ('PROSPECT', 'TRIAL', 'ACTIVE', 'SUSPENDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "LicensePlan" AS ENUM ('TRIAL', 'MONTHLY', 'ANNUAL');

-- CreateEnum
CREATE TYPE "LicenseStatus" AS ENUM ('DRAFT', 'ACTIVE', 'EXPIRED', 'SUSPENDED', 'REVOKED');

-- CreateEnum
CREATE TYPE "InstallationStatus" AS ENUM ('PENDING', 'ACTIVE', 'DEACTIVATED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'REFUNDED', 'WAIVED');

-- CreateTable
CREATE TABLE "Admin" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "role" "AdminRole" NOT NULL DEFAULT 'ADMIN',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Admin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "tradingName" TEXT,
    "contactName" TEXT,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "postcode" TEXT,
    "country" TEXT NOT NULL DEFAULT 'GB',
    "status" "CustomerStatus" NOT NULL DEFAULT 'PROSPECT',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LicenceIdSequence" (
    "year" INTEGER NOT NULL,
    "lastValue" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "LicenceIdSequence_pkey" PRIMARY KEY ("year")
);

-- CreateTable
CREATE TABLE "Licence" (
    "id" TEXT NOT NULL,
    "licenseId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "plan" "LicensePlan" NOT NULL,
    "status" "LicenseStatus" NOT NULL DEFAULT 'DRAFT',
    "issuedAt" TIMESTAMP(3),
    "startsAt" DATE NOT NULL,
    "expiresAt" DATE NOT NULL,
    "maxDevices" INTEGER NOT NULL,
    "features" JSONB NOT NULL DEFAULT '[]',
    "notes" TEXT,
    "signedLicenseEnc" TEXT,
    "payloadHash" TEXT,
    "signingKeyId" TEXT,
    "previousLicenceId" TEXT,
    "createdByAdminId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "suspendedAt" TIMESTAMP(3),
    "suspendedByAdminId" TEXT,
    "suspensionReason" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokedByAdminId" TEXT,
    "revocationReason" TEXT,

    CONSTRAINT "Licence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Installation" (
    "id" TEXT NOT NULL,
    "licenceId" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "deviceLabel" TEXT,
    "customerProvidedAt" TIMESTAMP(3),
    "firstSeenAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "status" "InstallationStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Installation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentRecord" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "licenceId" TEXT,
    "amountPence" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'GBP',
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "paymentMethod" TEXT,
    "paymentReference" TEXT,
    "invoiceReference" TEXT,
    "paidAt" TIMESTAMP(3),
    "periodStart" DATE,
    "periodEnd" DATE,
    "notes" TEXT,
    "recordedByAdminId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorAdminId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "customerId" TEXT,
    "licenceId" TEXT,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Admin_email_key" ON "Admin"("email");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_adminId_idx" ON "RefreshToken"("adminId");

-- CreateIndex
CREATE INDEX "Customer_companyName_idx" ON "Customer"("companyName");

-- CreateIndex
CREATE INDEX "Customer_email_idx" ON "Customer"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Licence_licenseId_key" ON "Licence"("licenseId");

-- CreateIndex
CREATE INDEX "Licence_customerId_idx" ON "Licence"("customerId");

-- CreateIndex
CREATE INDEX "Licence_status_idx" ON "Licence"("status");

-- CreateIndex
CREATE INDEX "Licence_expiresAt_idx" ON "Licence"("expiresAt");

-- CreateIndex
CREATE INDEX "Installation_installationId_idx" ON "Installation"("installationId");

-- CreateIndex
CREATE UNIQUE INDEX "Installation_licenceId_installationId_key" ON "Installation"("licenceId", "installationId");

-- CreateIndex
CREATE INDEX "PaymentRecord_customerId_idx" ON "PaymentRecord"("customerId");

-- CreateIndex
CREATE INDEX "PaymentRecord_licenceId_idx" ON "PaymentRecord"("licenceId");

-- CreateIndex
CREATE INDEX "PaymentRecord_paymentStatus_idx" ON "PaymentRecord"("paymentStatus");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_customerId_idx" ON "AuditLog"("customerId");

-- CreateIndex
CREATE INDEX "AuditLog_licenceId_idx" ON "AuditLog"("licenceId");

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Admin"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Licence" ADD CONSTRAINT "Licence_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Licence" ADD CONSTRAINT "Licence_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "Admin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Licence" ADD CONSTRAINT "Licence_suspendedByAdminId_fkey" FOREIGN KEY ("suspendedByAdminId") REFERENCES "Admin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Licence" ADD CONSTRAINT "Licence_revokedByAdminId_fkey" FOREIGN KEY ("revokedByAdminId") REFERENCES "Admin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Licence" ADD CONSTRAINT "Licence_previousLicenceId_fkey" FOREIGN KEY ("previousLicenceId") REFERENCES "Licence"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Installation" ADD CONSTRAINT "Installation_licenceId_fkey" FOREIGN KEY ("licenceId") REFERENCES "Licence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRecord" ADD CONSTRAINT "PaymentRecord_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRecord" ADD CONSTRAINT "PaymentRecord_licenceId_fkey" FOREIGN KEY ("licenceId") REFERENCES "Licence"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRecord" ADD CONSTRAINT "PaymentRecord_recordedByAdminId_fkey" FOREIGN KEY ("recordedByAdminId") REFERENCES "Admin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorAdminId_fkey" FOREIGN KEY ("actorAdminId") REFERENCES "Admin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_licenceId_fkey" FOREIGN KEY ("licenceId") REFERENCES "Licence"("id") ON DELETE SET NULL ON UPDATE CASCADE;
