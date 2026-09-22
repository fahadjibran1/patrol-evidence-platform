-- CreateEnum
CREATE TYPE "CommercialPlan" AS ENUM ('ANNUAL');

-- CreateEnum
CREATE TYPE "PurchaseRequestStatus" AS ENUM ('ACTIVE', 'EXCHANGED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PurchaseReferenceStatus" AS ENUM ('ACTIVE', 'CONSUMED', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "CommercialOrderPurpose" AS ENUM ('INITIAL', 'RENEWAL', 'REISSUE');

-- CreateEnum
CREATE TYPE "CommercialOrderState" AS ENUM ('REQUEST_CREATED', 'CHECKOUT_PENDING', 'PAYMENT_PENDING', 'PAID_AWAITING_APPROVAL', 'ISSUANCE_PENDING', 'ISSUED', 'DELIVERY_PENDING', 'DELIVERED', 'FAILED', 'HELD', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "CommercialPaymentStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "CommercialProvider" AS ENUM ('STRIPE', 'MANUAL', 'TEST');

-- CreateEnum
CREATE TYPE "CommercialProviderEventStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'PROCESSED', 'IGNORED', 'FAILED', 'DEAD_LETTER');

-- CreateEnum
CREATE TYPE "CommercialIssuanceType" AS ENUM ('INITIAL', 'RENEWAL', 'REISSUE');

-- CreateEnum
CREATE TYPE "CommercialIssuanceStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'PROCESSING', 'ISSUED', 'FAILED', 'HELD');

-- CreateEnum
CREATE TYPE "CommercialArtifactStatus" AS ENUM ('PENDING', 'AVAILABLE', 'REVOKED');

-- CreateEnum
CREATE TYPE "CommercialDeliveryStatus" AS ENUM ('PENDING', 'QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "CommercialActorType" AS ENUM ('SYSTEM', 'DESKTOP', 'CUSTOMER', 'OPERATOR', 'PROVIDER');

-- CreateEnum
CREATE TYPE "OutboxEventStatus" AS ENUM ('PENDING', 'PROCESSING', 'PUBLISHED', 'FAILED', 'DEAD_LETTER');

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "actorType" "CommercialActorType",
ADD COLUMN     "actorId" TEXT,
ADD COLUMN     "correlationId" TEXT;

-- CreateTable
CREATE TABLE "CommercialPurchaseRequest" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "product" TEXT NOT NULL,
    "plan" "CommercialPlan" NOT NULL,
    "installationId" TEXT NOT NULL,
    "machineFingerprintEnc" TEXT NOT NULL,
    "machineFingerprintHash" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "appVersion" TEXT NOT NULL,
    "buildId" TEXT NOT NULL,
    "clientNonceHash" TEXT NOT NULL,
    "previousLicenceId" TEXT,
    "canonicalRequestHash" TEXT NOT NULL,
    "status" "PurchaseRequestStatus" NOT NULL DEFAULT 'ACTIVE',
    "customerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "exchangedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "CommercialPurchaseRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommercialPurchaseReference" (
    "id" TEXT NOT NULL,
    "purchaseRequestId" TEXT NOT NULL,
    "referenceHash" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "status" "PurchaseReferenceStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "exchangeCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CommercialPurchaseReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommercialOrder" (
    "id" TEXT NOT NULL,
    "publicOrderId" TEXT NOT NULL,
    "purchaseRequestId" TEXT NOT NULL,
    "customerId" TEXT,
    "purpose" "CommercialOrderPurpose" NOT NULL DEFAULT 'INITIAL',
    "state" "CommercialOrderState" NOT NULL DEFAULT 'REQUEST_CREATED',
    "stateVersion" INTEGER NOT NULL DEFAULT 0,
    "failedFromState" "CommercialOrderState",
    "heldFromState" "CommercialOrderState",
    "product" TEXT NOT NULL,
    "plan" "CommercialPlan" NOT NULL,
    "amountMinor" INTEGER,
    "currency" TEXT,
    "taxPolicy" TEXT,
    "termsVersion" TEXT,
    "privacyVersion" TEXT,
    "providerCheckoutSessionId" TEXT,
    "providerPaymentIntentId" TEXT,
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "holdReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),

    CONSTRAINT "CommercialOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommercialPayment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "provider" "CommercialProvider" NOT NULL,
    "providerReference" TEXT NOT NULL,
    "status" "CommercialPaymentStatus" NOT NULL DEFAULT 'PENDING',
    "amountMinor" INTEGER NOT NULL,
    "taxMinor" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommercialPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommercialProviderEvent" (
    "id" TEXT NOT NULL,
    "provider" "CommercialProvider" NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "status" "CommercialProviderEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "safeMetadata" JSONB NOT NULL DEFAULT '{}',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "correlationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommercialProviderEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommercialLicenceIssuance" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "customerId" TEXT,
    "issuanceType" "CommercialIssuanceType" NOT NULL,
    "status" "CommercialIssuanceStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "licenceId" TEXT,
    "predecessorLicenceId" TEXT,
    "reissueReason" TEXT,
    "requestHash" TEXT NOT NULL,
    "payloadHash" TEXT,
    "signingKeyId" TEXT,
    "startsAt" DATE,
    "expiresAt" DATE,
    "approvedByAdminId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "failureCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommercialLicenceIssuance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommercialLicenceArtifact" (
    "id" TEXT NOT NULL,
    "artifactId" TEXT NOT NULL,
    "issuanceId" TEXT NOT NULL,
    "status" "CommercialArtifactStatus" NOT NULL DEFAULT 'PENDING',
    "fileName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "byteSize" BIGINT NOT NULL,
    "contentType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "availableAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "CommercialLicenceArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommercialDeliveryAttempt" (
    "id" TEXT NOT NULL,
    "artifactId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" "CommercialDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "channel" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "tokenHash" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "providerMessageId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "CommercialDeliveryAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommercialOutboxEvent" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OutboxEventStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "publishedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "correlationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommercialOutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CommercialPurchaseRequest_requestId_key" ON "CommercialPurchaseRequest"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "CommercialPurchaseRequest_clientNonceHash_key" ON "CommercialPurchaseRequest"("clientNonceHash");

-- CreateIndex
CREATE UNIQUE INDEX "CommercialPurchaseRequest_canonicalRequestHash_key" ON "CommercialPurchaseRequest"("canonicalRequestHash");

-- CreateIndex
CREATE INDEX "CommercialPurchaseRequest_installationId_idx" ON "CommercialPurchaseRequest"("installationId");

-- CreateIndex
CREATE INDEX "CommercialPurchaseRequest_machineFingerprintHash_idx" ON "CommercialPurchaseRequest"("machineFingerprintHash");

-- CreateIndex
CREATE INDEX "CommercialPurchaseRequest_status_expiresAt_idx" ON "CommercialPurchaseRequest"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "CommercialPurchaseRequest_customerId_idx" ON "CommercialPurchaseRequest"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "CommercialPurchaseReference_referenceHash_key" ON "CommercialPurchaseReference"("referenceHash");

-- CreateIndex
CREATE INDEX "CommercialPurchaseReference_purchaseRequestId_idx" ON "CommercialPurchaseReference"("purchaseRequestId");

-- CreateIndex
CREATE INDEX "CommercialPurchaseReference_status_expiresAt_idx" ON "CommercialPurchaseReference"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "CommercialOrder_publicOrderId_key" ON "CommercialOrder"("publicOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "CommercialOrder_providerCheckoutSessionId_key" ON "CommercialOrder"("providerCheckoutSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "CommercialOrder_providerPaymentIntentId_key" ON "CommercialOrder"("providerPaymentIntentId");

-- CreateIndex
CREATE INDEX "CommercialOrder_customerId_idx" ON "CommercialOrder"("customerId");

-- CreateIndex
CREATE INDEX "CommercialOrder_state_idx" ON "CommercialOrder"("state");

-- CreateIndex
CREATE INDEX "CommercialOrder_createdAt_idx" ON "CommercialOrder"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CommercialOrder_purchaseRequestId_purpose_key" ON "CommercialOrder"("purchaseRequestId", "purpose");

-- CreateIndex
CREATE INDEX "CommercialPayment_orderId_idx" ON "CommercialPayment"("orderId");

-- CreateIndex
CREATE INDEX "CommercialPayment_status_idx" ON "CommercialPayment"("status");

-- CreateIndex
CREATE UNIQUE INDEX "CommercialPayment_provider_providerReference_key" ON "CommercialPayment"("provider", "providerReference");

-- CreateIndex
CREATE INDEX "CommercialProviderEvent_status_idx" ON "CommercialProviderEvent"("status");

-- CreateIndex
CREATE INDEX "CommercialProviderEvent_correlationId_idx" ON "CommercialProviderEvent"("correlationId");

-- CreateIndex
CREATE UNIQUE INDEX "CommercialProviderEvent_provider_providerEventId_key" ON "CommercialProviderEvent"("provider", "providerEventId");

-- CreateIndex
CREATE UNIQUE INDEX "CommercialLicenceIssuance_orderId_key" ON "CommercialLicenceIssuance"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "CommercialLicenceIssuance_licenceId_key" ON "CommercialLicenceIssuance"("licenceId");

-- CreateIndex
CREATE INDEX "CommercialLicenceIssuance_customerId_idx" ON "CommercialLicenceIssuance"("customerId");

-- CreateIndex
CREATE INDEX "CommercialLicenceIssuance_status_idx" ON "CommercialLicenceIssuance"("status");

-- CreateIndex
CREATE INDEX "CommercialLicenceIssuance_predecessorLicenceId_idx" ON "CommercialLicenceIssuance"("predecessorLicenceId");

-- CreateIndex
CREATE UNIQUE INDEX "CommercialLicenceArtifact_artifactId_key" ON "CommercialLicenceArtifact"("artifactId");

-- CreateIndex
CREATE UNIQUE INDEX "CommercialLicenceArtifact_issuanceId_key" ON "CommercialLicenceArtifact"("issuanceId");

-- CreateIndex
CREATE UNIQUE INDEX "CommercialLicenceArtifact_storageKey_key" ON "CommercialLicenceArtifact"("storageKey");

-- CreateIndex
CREATE INDEX "CommercialLicenceArtifact_status_idx" ON "CommercialLicenceArtifact"("status");

-- CreateIndex
CREATE INDEX "CommercialLicenceArtifact_sha256_idx" ON "CommercialLicenceArtifact"("sha256");

-- CreateIndex
CREATE UNIQUE INDEX "CommercialDeliveryAttempt_idempotencyKey_key" ON "CommercialDeliveryAttempt"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "CommercialDeliveryAttempt_tokenHash_key" ON "CommercialDeliveryAttempt"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "CommercialDeliveryAttempt_providerMessageId_key" ON "CommercialDeliveryAttempt"("providerMessageId");

-- CreateIndex
CREATE INDEX "CommercialDeliveryAttempt_artifactId_idx" ON "CommercialDeliveryAttempt"("artifactId");

-- CreateIndex
CREATE INDEX "CommercialDeliveryAttempt_status_idx" ON "CommercialDeliveryAttempt"("status");

-- CreateIndex
CREATE UNIQUE INDEX "CommercialOutboxEvent_eventId_key" ON "CommercialOutboxEvent"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "CommercialOutboxEvent_idempotencyKey_key" ON "CommercialOutboxEvent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "CommercialOutboxEvent_status_availableAt_idx" ON "CommercialOutboxEvent"("status", "availableAt");

-- CreateIndex
CREATE INDEX "CommercialOutboxEvent_aggregateType_aggregateId_idx" ON "CommercialOutboxEvent"("aggregateType", "aggregateId");

-- CreateIndex
CREATE INDEX "CommercialOutboxEvent_correlationId_idx" ON "CommercialOutboxEvent"("correlationId");

-- CreateIndex
CREATE INDEX "AuditLog_correlationId_idx" ON "AuditLog"("correlationId");

-- CreateIndex
CREATE INDEX "AuditLog_actorType_actorId_idx" ON "AuditLog"("actorType", "actorId");

-- AddForeignKey
ALTER TABLE "CommercialPurchaseRequest" ADD CONSTRAINT "CommercialPurchaseRequest_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialPurchaseReference" ADD CONSTRAINT "CommercialPurchaseReference_purchaseRequestId_fkey" FOREIGN KEY ("purchaseRequestId") REFERENCES "CommercialPurchaseRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialOrder" ADD CONSTRAINT "CommercialOrder_purchaseRequestId_fkey" FOREIGN KEY ("purchaseRequestId") REFERENCES "CommercialPurchaseRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialOrder" ADD CONSTRAINT "CommercialOrder_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialPayment" ADD CONSTRAINT "CommercialPayment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "CommercialOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialLicenceIssuance" ADD CONSTRAINT "CommercialLicenceIssuance_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "CommercialOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialLicenceIssuance" ADD CONSTRAINT "CommercialLicenceIssuance_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialLicenceArtifact" ADD CONSTRAINT "CommercialLicenceArtifact_issuanceId_fkey" FOREIGN KEY ("issuanceId") REFERENCES "CommercialLicenceIssuance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialDeliveryAttempt" ADD CONSTRAINT "CommercialDeliveryAttempt_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "CommercialLicenceArtifact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Phase 1 database-level invariants. These supplement DTO validation so
-- workers and future webhook consumers cannot bypass the commercial rules.
ALTER TABLE "CommercialPurchaseRequest"
    ADD CONSTRAINT "CommercialPurchaseRequest_schemaVersion_check" CHECK ("schemaVersion" = 2),
    ADD CONSTRAINT "CommercialPurchaseRequest_product_check" CHECK ("product" = 'Patrol Evidence Platform'),
    ADD CONSTRAINT "CommercialPurchaseRequest_expiry_check" CHECK ("expiresAt" > "createdAt"),
    ADD CONSTRAINT "CommercialPurchaseRequest_hashes_check" CHECK (
        "machineFingerprintHash" ~ '^[0-9a-f]{64}$'
        AND "clientNonceHash" ~ '^[0-9a-f]{64}$'
        AND "canonicalRequestHash" ~ '^[0-9a-f]{64}$'
    );

ALTER TABLE "CommercialPurchaseReference"
    ADD CONSTRAINT "CommercialPurchaseReference_expiry_check" CHECK ("expiresAt" > "createdAt"),
    ADD CONSTRAINT "CommercialPurchaseReference_exchangeCount_check" CHECK ("exchangeCount" >= 0),
    ADD CONSTRAINT "CommercialPurchaseReference_hash_check" CHECK ("referenceHash" ~ '^[0-9a-f]{64}$');

ALTER TABLE "CommercialOrder"
    ADD CONSTRAINT "CommercialOrder_product_check" CHECK ("product" = 'Patrol Evidence Platform'),
    ADD CONSTRAINT "CommercialOrder_stateVersion_check" CHECK ("stateVersion" >= 0),
    ADD CONSTRAINT "CommercialOrder_amount_check" CHECK ("amountMinor" IS NULL OR "amountMinor" >= 0),
    ADD CONSTRAINT "CommercialOrder_currency_check" CHECK ("currency" IS NULL OR "currency" ~ '^[A-Z]{3}$');

ALTER TABLE "CommercialPayment"
    ADD CONSTRAINT "CommercialPayment_amount_check" CHECK ("amountMinor" >= 0 AND "taxMinor" >= 0),
    ADD CONSTRAINT "CommercialPayment_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$');

ALTER TABLE "CommercialProviderEvent"
    ADD CONSTRAINT "CommercialProviderEvent_attempts_check" CHECK ("attempts" >= 0),
    ADD CONSTRAINT "CommercialProviderEvent_payloadHash_check" CHECK ("payloadHash" ~ '^[0-9a-f]{64}$');

ALTER TABLE "CommercialLicenceIssuance"
    ADD CONSTRAINT "CommercialLicenceIssuance_dates_check" CHECK (
        "startsAt" IS NULL OR "expiresAt" IS NULL OR "expiresAt" > "startsAt"
    ),
    ADD CONSTRAINT "CommercialLicenceIssuance_reissueReason_check" CHECK (
        "issuanceType" <> 'REISSUE' OR NULLIF(BTRIM("reissueReason"), '') IS NOT NULL
    ),
    ADD CONSTRAINT "CommercialLicenceIssuance_hashes_check" CHECK (
        "requestHash" ~ '^[0-9a-f]{64}$'
        AND ("payloadHash" IS NULL OR "payloadHash" ~ '^[0-9a-f]{64}$')
    );

ALTER TABLE "CommercialLicenceArtifact"
    ADD CONSTRAINT "CommercialLicenceArtifact_size_check" CHECK ("byteSize" >= 0),
    ADD CONSTRAINT "CommercialLicenceArtifact_sha256_check" CHECK ("sha256" ~ '^[0-9a-f]{64}$');

ALTER TABLE "CommercialDeliveryAttempt"
    ADD CONSTRAINT "CommercialDeliveryAttempt_attempts_check" CHECK ("attempts" >= 0);

ALTER TABLE "CommercialOutboxEvent"
    ADD CONSTRAINT "CommercialOutboxEvent_attempts_check" CHECK ("attempts" >= 0);
