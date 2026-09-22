-- Phase 3: operator step-up, explicit paid rejection, and deterministic
-- current-format commercial licence issuance snapshots.
ALTER TYPE "CommercialOrderState" ADD VALUE 'REJECTED';

ALTER TABLE "CommercialOrder" ADD COLUMN "requestHashSnapshot" TEXT;
UPDATE "CommercialOrder" AS o
SET "requestHashSnapshot" = r."canonicalRequestHash"
FROM "CommercialPurchaseRequest" AS r
WHERE r."id" = o."purchaseRequestId";
ALTER TABLE "CommercialOrder" ALTER COLUMN "requestHashSnapshot" SET NOT NULL;
ALTER TABLE "CommercialOrder" ADD CONSTRAINT "CommercialOrder_requestHashSnapshot_check"
  CHECK ("requestHashSnapshot" ~ '^[a-f0-9]{64}$');

CREATE TABLE "CommercialOperatorStepUp" (
  "id" TEXT NOT NULL,
  "adminId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  CONSTRAINT "CommercialOperatorStepUp_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CommercialOperatorStepUp_tokenHash_key" ON "CommercialOperatorStepUp"("tokenHash");
CREATE INDEX "CommercialOperatorStepUp_adminId_purpose_expiresAt_idx" ON "CommercialOperatorStepUp"("adminId", "purpose", "expiresAt");
ALTER TABLE "CommercialOperatorStepUp" ADD CONSTRAINT "CommercialOperatorStepUp_adminId_fkey"
  FOREIGN KEY ("adminId") REFERENCES "Admin"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CommercialLicenceIssuance"
  ADD COLUMN "issuedAt" TIMESTAMP(3),
  ADD COLUMN "featuresSnapshot" JSONB,
  ADD COLUMN "maxDevices" INTEGER,
  ADD COLUMN "commercialReviewRequired" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "postIssuanceRefundAt" TIMESTAMP(3);
ALTER TABLE "CommercialLicenceIssuance" ADD CONSTRAINT "CommercialLicenceIssuance_approvedByAdminId_fkey"
  FOREIGN KEY ("approvedByAdminId") REFERENCES "Admin"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CommercialLicenceIssuance" ADD CONSTRAINT "CommercialLicenceIssuance_maxDevices_check"
  CHECK ("maxDevices" IS NULL OR "maxDevices" = 1);
