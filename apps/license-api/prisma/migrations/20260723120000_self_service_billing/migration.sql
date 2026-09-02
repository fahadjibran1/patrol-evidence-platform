-- Phase 5B: Customer self-service billing

CREATE TYPE "StripeCheckoutPurpose" AS ENUM ('INITIAL', 'RENEWAL', 'UPGRADE');
CREATE TYPE "ScheduledPlanChangeType" AS ENUM ('UPGRADE', 'DOWNGRADE');

ALTER TABLE "Customer"
  ADD COLUMN IF NOT EXISTS "billingEmail" TEXT,
  ADD COLUMN IF NOT EXISTS "invoiceRecipients" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS "allowFinancePurchases" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "taxId" TEXT;

ALTER TABLE "Subscription"
  ADD COLUMN IF NOT EXISTS "cancellationReason" TEXT,
  ADD COLUMN IF NOT EXISTS "pendingPlanId" TEXT,
  ADD COLUMN IF NOT EXISTS "pendingBillingInterval" "BillingInterval",
  ADD COLUMN IF NOT EXISTS "planChangeEffectiveAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "scheduledChangeType" "ScheduledPlanChangeType",
  ADD COLUMN IF NOT EXISTS "gracePeriodDaysOverride" INTEGER;

-- Recreate plan FKs with named relations (pending plan)
ALTER TABLE "Subscription" DROP CONSTRAINT IF EXISTS "Subscription_planId_fkey";
ALTER TABLE "Subscription"
  ADD CONSTRAINT "Subscription_planId_fkey"
  FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Subscription"
  ADD CONSTRAINT "Subscription_pendingPlanId_fkey"
  FOREIGN KEY ("pendingPlanId") REFERENCES "Plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "Subscription_pendingPlanId_idx" ON "Subscription"("pendingPlanId");
CREATE INDEX IF NOT EXISTS "Subscription_planChangeEffectiveAt_idx" ON "Subscription"("planChangeEffectiveAt");

ALTER TABLE "StripeCheckoutSession"
  ADD COLUMN IF NOT EXISTS "purpose" "StripeCheckoutPurpose" NOT NULL DEFAULT 'INITIAL';

CREATE INDEX IF NOT EXISTS "StripeCheckoutSession_purpose_idx" ON "StripeCheckoutSession"("purpose");

CREATE TABLE IF NOT EXISTS "BillingCredit" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "subscriptionId" TEXT,
  "amount" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'GBP',
  "reason" TEXT NOT NULL,
  "issuedByAdminId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BillingCredit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "BillingCredit_organisationId_idx" ON "BillingCredit"("organisationId");
CREATE INDEX IF NOT EXISTS "BillingCredit_subscriptionId_idx" ON "BillingCredit"("subscriptionId");

ALTER TABLE "BillingCredit"
  ADD CONSTRAINT "BillingCredit_organisationId_fkey"
  FOREIGN KEY ("organisationId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BillingCredit"
  ADD CONSTRAINT "BillingCredit_subscriptionId_fkey"
  FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BillingCredit"
  ADD CONSTRAINT "BillingCredit_issuedByAdminId_fkey"
  FOREIGN KEY ("issuedByAdminId") REFERENCES "Admin"("id") ON DELETE SET NULL ON UPDATE CASCADE;
