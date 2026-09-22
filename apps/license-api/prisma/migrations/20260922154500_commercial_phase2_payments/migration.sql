-- Phase 2 remains Stripe TEST mode only. The LIVE enum value is reserved so
-- future production enablement requires an explicit configuration gate rather
-- than another data migration.
CREATE TYPE "CommercialProviderMode" AS ENUM ('TEST', 'LIVE');

ALTER TABLE "CommercialOrder"
  ADD COLUMN "checkoutExpiresAt" TIMESTAMP(3),
  ADD COLUMN "checkoutGeneration" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "checkoutStatus" TEXT,
  ADD COLUMN "providerCustomerId" TEXT,
  ADD COLUMN "providerMode" "CommercialProviderMode";

-- The temporary default makes Phase 1 -> Phase 2 upgrades deterministic even
-- for isolated development databases containing synthetic Phase 1 payments.
ALTER TABLE "CommercialPayment"
  ADD COLUMN "checkoutSessionId" TEXT,
  ADD COLUMN "providerCustomerId" TEXT,
  ADD COLUMN "providerMode" "CommercialProviderMode" NOT NULL DEFAULT 'TEST';
ALTER TABLE "CommercialPayment" ALTER COLUMN "providerMode" DROP DEFAULT;

ALTER TABLE "CommercialProviderEvent"
  ADD COLUMN "livemode" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "providerCreatedAt" TIMESTAMP(3);

CREATE TABLE "CommercialCheckoutSession" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "provider" "CommercialProvider" NOT NULL,
  "providerMode" "CommercialProviderMode" NOT NULL,
  "providerSessionId" TEXT NOT NULL,
  "providerCustomerId" TEXT,
  "providerPaymentIntentId" TEXT,
  "generation" INTEGER NOT NULL,
  "status" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "amountMinor" INTEGER NOT NULL,
  "currency" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "closedAt" TIMESTAMP(3),
  CONSTRAINT "CommercialCheckoutSession_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CommercialCheckoutSession_generation_check" CHECK ("generation" >= 1),
  CONSTRAINT "CommercialCheckoutSession_amount_check" CHECK ("amountMinor" > 0),
  CONSTRAINT "CommercialCheckoutSession_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$')
);

CREATE UNIQUE INDEX "CommercialCheckoutSession_providerSessionId_key"
  ON "CommercialCheckoutSession"("providerSessionId");
CREATE INDEX "CommercialCheckoutSession_orderId_isActive_idx"
  ON "CommercialCheckoutSession"("orderId", "isActive");
CREATE INDEX "CommercialCheckoutSession_providerPaymentIntentId_idx"
  ON "CommercialCheckoutSession"("providerPaymentIntentId");
CREATE UNIQUE INDEX "CommercialCheckoutSession_orderId_generation_key"
  ON "CommercialCheckoutSession"("orderId", "generation");
-- A provider retry may reuse its session, but an order may never have two
-- concurrently active Checkout sessions.
CREATE UNIQUE INDEX "CommercialCheckoutSession_one_active_per_order_key"
  ON "CommercialCheckoutSession"("orderId") WHERE "isActive" = true;

CREATE UNIQUE INDEX "CommercialPayment_provider_checkoutSessionId_key"
  ON "CommercialPayment"("provider", "checkoutSessionId");

ALTER TABLE "CommercialCheckoutSession"
  ADD CONSTRAINT "CommercialCheckoutSession_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "CommercialOrder"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CommercialOrder"
  ADD CONSTRAINT "CommercialOrder_checkoutGeneration_check" CHECK ("checkoutGeneration" >= 0);
