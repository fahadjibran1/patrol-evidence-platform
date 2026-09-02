-- Phase 5A: Stripe Checkout, Webhooks, Reconciliation

DO $$ BEGIN
  CREATE TYPE "StripeCheckoutSessionStatus" AS ENUM ('OPEN', 'COMPLETE', 'EXPIRED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "StripeWebhookProcessingStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'PROCESSED', 'IGNORED', 'FAILED', 'DEAD_LETTER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "StripeReconciliationAlertStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Subscription"
  ADD COLUMN IF NOT EXISTS "pendingCheckout" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "Subscription_pendingCheckout_idx" ON "Subscription"("pendingCheckout");

CREATE TABLE IF NOT EXISTS "StripeCustomerMapping" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "stripeCustomerId" TEXT NOT NULL,
  "livemode" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StripeCustomerMapping_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "StripeCustomerMapping_stripeCustomerId_key" ON "StripeCustomerMapping"("stripeCustomerId");
CREATE UNIQUE INDEX IF NOT EXISTS "StripeCustomerMapping_organisationId_livemode_key" ON "StripeCustomerMapping"("organisationId", "livemode");
CREATE INDEX IF NOT EXISTS "StripeCustomerMapping_organisationId_idx" ON "StripeCustomerMapping"("organisationId");

CREATE TABLE IF NOT EXISTS "StripePriceMapping" (
  "id" TEXT NOT NULL,
  "planId" TEXT NOT NULL,
  "billingInterval" "BillingInterval" NOT NULL,
  "stripeProductId" TEXT NOT NULL,
  "stripePriceId" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "livemode" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StripePriceMapping_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "StripePriceMapping_stripePriceId_key" ON "StripePriceMapping"("stripePriceId");
CREATE UNIQUE INDEX IF NOT EXISTS "StripePriceMapping_planId_billingInterval_livemode_key" ON "StripePriceMapping"("planId", "billingInterval", "livemode");
CREATE INDEX IF NOT EXISTS "StripePriceMapping_planId_idx" ON "StripePriceMapping"("planId");
CREATE INDEX IF NOT EXISTS "StripePriceMapping_active_idx" ON "StripePriceMapping"("active");

CREATE TABLE IF NOT EXISTS "StripeSubscriptionMapping" (
  "id" TEXT NOT NULL,
  "subscriptionId" TEXT NOT NULL,
  "stripeSubscriptionId" TEXT NOT NULL,
  "stripeCustomerId" TEXT NOT NULL,
  "latestStripeInvoiceId" TEXT,
  "livemode" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StripeSubscriptionMapping_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "StripeSubscriptionMapping_subscriptionId_key" ON "StripeSubscriptionMapping"("subscriptionId");
CREATE UNIQUE INDEX IF NOT EXISTS "StripeSubscriptionMapping_stripeSubscriptionId_key" ON "StripeSubscriptionMapping"("stripeSubscriptionId");
CREATE INDEX IF NOT EXISTS "StripeSubscriptionMapping_stripeCustomerId_idx" ON "StripeSubscriptionMapping"("stripeCustomerId");

CREATE TABLE IF NOT EXISTS "StripeCheckoutSession" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "internalSubscriptionId" TEXT,
  "internalInvoiceId" TEXT,
  "stripeCheckoutSessionId" TEXT NOT NULL,
  "status" "StripeCheckoutSessionStatus" NOT NULL DEFAULT 'OPEN',
  "expiresAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "livemode" BOOLEAN NOT NULL DEFAULT false,
  "acceptedTermsVersion" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StripeCheckoutSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "StripeCheckoutSession_stripeCheckoutSessionId_key" ON "StripeCheckoutSession"("stripeCheckoutSessionId");
CREATE UNIQUE INDEX IF NOT EXISTS "StripeCheckoutSession_idempotencyKey_key" ON "StripeCheckoutSession"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "StripeCheckoutSession_organisationId_idx" ON "StripeCheckoutSession"("organisationId");
CREATE INDEX IF NOT EXISTS "StripeCheckoutSession_status_idx" ON "StripeCheckoutSession"("status");
CREATE INDEX IF NOT EXISTS "StripeCheckoutSession_internalSubscriptionId_idx" ON "StripeCheckoutSession"("internalSubscriptionId");

CREATE TABLE IF NOT EXISTS "StripeWebhookEvent" (
  "id" TEXT NOT NULL,
  "stripeEventId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "apiVersion" TEXT,
  "livemode" BOOLEAN NOT NULL DEFAULT false,
  "processingStatus" "StripeWebhookProcessingStatus" NOT NULL DEFAULT 'RECEIVED',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "payloadHash" TEXT NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StripeWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "StripeWebhookEvent_stripeEventId_key" ON "StripeWebhookEvent"("stripeEventId");
CREATE INDEX IF NOT EXISTS "StripeWebhookEvent_processingStatus_idx" ON "StripeWebhookEvent"("processingStatus");
CREATE INDEX IF NOT EXISTS "StripeWebhookEvent_type_idx" ON "StripeWebhookEvent"("type");
CREATE INDEX IF NOT EXISTS "StripeWebhookEvent_receivedAt_idx" ON "StripeWebhookEvent"("receivedAt");

CREATE TABLE IF NOT EXISTS "StripeReconciliationAlert" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT,
  "alertType" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "status" "StripeReconciliationAlertStatus" NOT NULL DEFAULT 'OPEN',
  "stripeObjectId" TEXT,
  "internalRef" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  CONSTRAINT "StripeReconciliationAlert_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "StripeReconciliationAlert_status_idx" ON "StripeReconciliationAlert"("status");
CREATE INDEX IF NOT EXISTS "StripeReconciliationAlert_organisationId_idx" ON "StripeReconciliationAlert"("organisationId");
CREATE INDEX IF NOT EXISTS "StripeReconciliationAlert_alertType_idx" ON "StripeReconciliationAlert"("alertType");

-- Unique provider reference for Stripe payments (nulls allowed for manual)
DO $$ BEGIN
  ALTER TABLE "BillingPayment" ADD CONSTRAINT "BillingPayment_provider_providerReference_key" UNIQUE ("provider", "providerReference");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "StripeCustomerMapping"
    ADD CONSTRAINT "StripeCustomerMapping_organisationId_fkey"
    FOREIGN KEY ("organisationId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "StripePriceMapping"
    ADD CONSTRAINT "StripePriceMapping_planId_fkey"
    FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "StripeSubscriptionMapping"
    ADD CONSTRAINT "StripeSubscriptionMapping_subscriptionId_fkey"
    FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "StripeCheckoutSession"
    ADD CONSTRAINT "StripeCheckoutSession_organisationId_fkey"
    FOREIGN KEY ("organisationId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "StripeCheckoutSession"
    ADD CONSTRAINT "StripeCheckoutSession_internalSubscriptionId_fkey"
    FOREIGN KEY ("internalSubscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "StripeReconciliationAlert"
    ADD CONSTRAINT "StripeReconciliationAlert_organisationId_fkey"
    FOREIGN KEY ("organisationId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
