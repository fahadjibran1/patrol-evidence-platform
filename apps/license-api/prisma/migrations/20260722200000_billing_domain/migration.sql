-- Phase 4C: Billing Domain & Subscription Engine

DO $$ BEGIN
  CREATE TYPE "PlanStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "BillingInterval" AS ENUM ('MONTHLY', 'ANNUAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED', 'EXPIRED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'OPEN', 'PAID', 'VOID', 'REFUNDED', 'OVERDUE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "BillingPaymentStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "PaymentProvider" AS ENUM ('MANUAL', 'STRIPE', 'PAYPAL', 'GOCARDLESS');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ManualPaymentMethod" AS ENUM ('CASH', 'BANK_TRANSFER', 'CARD', 'CHEQUE', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "SupportLevel" AS ENUM ('STANDARD', 'PRIORITY', 'DEDICATED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "Plan" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "status" "PlanStatus" NOT NULL DEFAULT 'DRAFT',
  "monthlyPrice" INTEGER NOT NULL,
  "annualPrice" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'GBP',
  "billingInterval" "BillingInterval" NOT NULL DEFAULT 'MONTHLY',
  "trialDays" INTEGER NOT NULL DEFAULT 0,
  "maxDevices" INTEGER NOT NULL DEFAULT 1,
  "includedFeatures" JSONB NOT NULL DEFAULT '[]',
  "supportLevel" "SupportLevel" NOT NULL DEFAULT 'STANDARD',
  "sortOrder" INTEGER NOT NULL DEFAULT 100,
  "isPublic" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Plan_code_key" ON "Plan"("code");
CREATE INDEX IF NOT EXISTS "Plan_status_idx" ON "Plan"("status");
CREATE INDEX IF NOT EXISTS "Plan_isPublic_idx" ON "Plan"("isPublic");
CREATE INDEX IF NOT EXISTS "Plan_sortOrder_idx" ON "Plan"("sortOrder");

CREATE TABLE IF NOT EXISTS "Subscription" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "planId" TEXT NOT NULL,
  "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIAL',
  "billingInterval" "BillingInterval" NOT NULL,
  "startedAt" TIMESTAMP(3),
  "currentPeriodStart" TIMESTAMP(3),
  "currentPeriodEnd" TIMESTAMP(3),
  "nextBillingDate" TIMESTAMP(3),
  "autoRenew" BOOLEAN NOT NULL DEFAULT true,
  "trialEndsAt" TIMESTAMP(3),
  "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
  "cancelledAt" TIMESTAMP(3),
  "createdByAdminId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Subscription_organisationId_idx" ON "Subscription"("organisationId");
CREATE INDEX IF NOT EXISTS "Subscription_planId_idx" ON "Subscription"("planId");
CREATE INDEX IF NOT EXISTS "Subscription_status_idx" ON "Subscription"("status");
CREATE INDEX IF NOT EXISTS "Subscription_nextBillingDate_idx" ON "Subscription"("nextBillingDate");
CREATE INDEX IF NOT EXISTS "Subscription_currentPeriodEnd_idx" ON "Subscription"("currentPeriodEnd");

CREATE TABLE IF NOT EXISTS "InvoiceNumberSequence" (
  "year" INTEGER NOT NULL,
  "lastValue" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "InvoiceNumberSequence_pkey" PRIMARY KEY ("year")
);

CREATE TABLE IF NOT EXISTS "Invoice" (
  "id" TEXT NOT NULL,
  "subscriptionId" TEXT NOT NULL,
  "number" TEXT NOT NULL,
  "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
  "subtotal" INTEGER NOT NULL,
  "tax" INTEGER NOT NULL DEFAULT 0,
  "discount" INTEGER NOT NULL DEFAULT 0,
  "total" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'GBP',
  "issuedAt" TIMESTAMP(3),
  "dueAt" TIMESTAMP(3),
  "paidAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Invoice_number_key" ON "Invoice"("number");
CREATE INDEX IF NOT EXISTS "Invoice_subscriptionId_idx" ON "Invoice"("subscriptionId");
CREATE INDEX IF NOT EXISTS "Invoice_status_idx" ON "Invoice"("status");
CREATE INDEX IF NOT EXISTS "Invoice_dueAt_idx" ON "Invoice"("dueAt");
CREATE INDEX IF NOT EXISTS "Invoice_issuedAt_idx" ON "Invoice"("issuedAt");

CREATE TABLE IF NOT EXISTS "BillingPayment" (
  "id" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "provider" "PaymentProvider" NOT NULL DEFAULT 'MANUAL',
  "providerReference" TEXT,
  "status" "BillingPaymentStatus" NOT NULL DEFAULT 'PENDING',
  "amount" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'GBP',
  "manualMethod" "ManualPaymentMethod",
  "notes" TEXT,
  "receivedAt" TIMESTAMP(3),
  "recordedByAdminId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BillingPayment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "BillingPayment_invoiceId_idx" ON "BillingPayment"("invoiceId");
CREATE INDEX IF NOT EXISTS "BillingPayment_status_idx" ON "BillingPayment"("status");
CREATE INDEX IF NOT EXISTS "BillingPayment_provider_idx" ON "BillingPayment"("provider");
CREATE INDEX IF NOT EXISTS "BillingPayment_receivedAt_idx" ON "BillingPayment"("receivedAt");

DO $$ BEGIN
  ALTER TABLE "Subscription"
    ADD CONSTRAINT "Subscription_organisationId_fkey"
    FOREIGN KEY ("organisationId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Subscription"
    ADD CONSTRAINT "Subscription_planId_fkey"
    FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Subscription"
    ADD CONSTRAINT "Subscription_createdByAdminId_fkey"
    FOREIGN KEY ("createdByAdminId") REFERENCES "Admin"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Invoice"
    ADD CONSTRAINT "Invoice_subscriptionId_fkey"
    FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "BillingPayment"
    ADD CONSTRAINT "BillingPayment_invoiceId_fkey"
    FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "BillingPayment"
    ADD CONSTRAINT "BillingPayment_recordedByAdminId_fkey"
    FOREIGN KEY ("recordedByAdminId") REFERENCES "Admin"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Seed catalogue plans (idempotent)
INSERT INTO "Plan" (
  "id", "code", "name", "description", "status",
  "monthlyPrice", "annualPrice", "currency", "billingInterval",
  "trialDays", "maxDevices", "includedFeatures", "supportLevel", "sortOrder", "isPublic",
  "createdAt", "updatedAt"
) VALUES
(
  'plan-starter-0000000000000001',
  'STARTER',
  'Starter',
  'Essential patrol evidence licensing for small teams.',
  'ACTIVE',
  4900, 49000, 'GBP', 'MONTHLY',
  14, 2,
  '["MULTI_USER","HAZARD_DETECTION"]'::jsonb,
  'STANDARD', 10, true,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
),
(
  'plan-professional-0000000001',
  'PROFESSIONAL',
  'Professional',
  'Advanced reporting and multi-device deployments.',
  'ACTIVE',
  9900, 99000, 'GBP', 'MONTHLY',
  14, 10,
  '["MULTI_USER","HAZARD_DETECTION","UNLIMITED_DOWNLOADS","ADVANCED_REPORTING","API_ACCESS","REMOTE_MONITORING"]'::jsonb,
  'PRIORITY', 20, true,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
),
(
  'plan-enterprise-00000000001',
  'ENTERPRISE',
  'Enterprise',
  'Full platform access with dedicated support. Custom pricing available.',
  'ACTIVE',
  24900, 249000, 'GBP', 'ANNUAL',
  30, 100,
  '["MULTI_USER","HAZARD_DETECTION","UNLIMITED_DOWNLOADS","ADVANCED_REPORTING","API_ACCESS","REMOTE_MONITORING","WHITE_LABEL","CUSTOM_BRANDING"]'::jsonb,
  'DEDICATED', 30, true,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
)
ON CONFLICT ("code") DO NOTHING;
