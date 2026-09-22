ALTER TYPE "CommercialDeliveryStatus" ADD VALUE IF NOT EXISTS 'BOUNCED';
ALTER TYPE "CommercialDeliveryStatus" ADD VALUE IF NOT EXISTS 'COMPLAINED';

ALTER TABLE "CommercialLicenceArtifact"
  ADD COLUMN "deliveryRecipient" TEXT,
  ADD COLUMN "deliveryGeneration" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastDeliveryQueuedAt" TIMESTAMP(3);

ALTER TABLE "CommercialDeliveryAttempt"
  ADD COLUMN "customerId" TEXT,
  ADD COLUMN "requestKey" TEXT,
  ADD COLUMN "generation" INTEGER,
  ADD COLUMN "provider" TEXT,
  ADD COLUMN "tokenPurpose" TEXT,
  ADD COLUMN "bouncedAt" TIMESTAMP(3),
  ADD COLUMN "complainedAt" TIMESTAMP(3),
  ADD COLUMN "firstDownloadedAt" TIMESTAMP(3),
  ADD COLUMN "lastDownloadedAt" TIMESTAMP(3),
  ADD COLUMN "downloadCount" INTEGER NOT NULL DEFAULT 0;

UPDATE "CommercialDeliveryAttempt" AS delivery
SET
  "customerId" = issuance."customerId",
  "requestKey" = delivery."idempotencyKey",
  "generation" = 1,
  "provider" = 'RESEND',
  "tokenPurpose" = 'licence-download'
FROM "CommercialLicenceArtifact" AS artifact
JOIN "CommercialLicenceIssuance" AS issuance ON issuance."id" = artifact."issuanceId"
WHERE delivery."artifactId" = artifact."id";

ALTER TABLE "CommercialDeliveryAttempt"
  ALTER COLUMN "customerId" SET NOT NULL,
  ALTER COLUMN "requestKey" SET NOT NULL,
  ALTER COLUMN "generation" SET NOT NULL,
  ALTER COLUMN "provider" SET NOT NULL,
  ALTER COLUMN "tokenPurpose" SET NOT NULL;

CREATE UNIQUE INDEX "CommercialDeliveryAttempt_requestKey_key" ON "CommercialDeliveryAttempt"("requestKey");
CREATE UNIQUE INDEX "CommercialDeliveryAttempt_artifactId_generation_key" ON "CommercialDeliveryAttempt"("artifactId", "generation");
CREATE INDEX "CommercialDeliveryAttempt_customerId_idx" ON "CommercialDeliveryAttempt"("customerId");
CREATE INDEX "CommercialDeliveryAttempt_tokenExpiresAt_idx" ON "CommercialDeliveryAttempt"("tokenExpiresAt");

ALTER TABLE "CommercialDeliveryAttempt"
  ADD CONSTRAINT "CommercialDeliveryAttempt_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "CommercialDeliveryProviderEvent" (
  "id" TEXT NOT NULL,
  "providerEventId" TEXT NOT NULL,
  "providerMessageId" TEXT,
  "eventType" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "status" "CommercialProviderEventStatus" NOT NULL DEFAULT 'RECEIVED',
  "safeMetadata" JSONB NOT NULL DEFAULT '{}',
  "correlationId" TEXT NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CommercialDeliveryProviderEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CommercialDeliveryProviderEvent_providerEventId_key" ON "CommercialDeliveryProviderEvent"("providerEventId");
CREATE INDEX "CommercialDeliveryProviderEvent_providerMessageId_idx" ON "CommercialDeliveryProviderEvent"("providerMessageId");
CREATE INDEX "CommercialDeliveryProviderEvent_status_idx" ON "CommercialDeliveryProviderEvent"("status");
