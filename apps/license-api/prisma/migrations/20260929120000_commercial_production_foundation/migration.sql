-- Minimal production commercial linkage. VAT calculation remains provider-owned and
-- live payments stay disabled until the approved Stripe tax/invoice configuration exists.
ALTER TABLE "CommercialOrder"
  ADD COLUMN "billingCountry" TEXT,
  ADD COLUMN "providerInvoiceId" TEXT;

CREATE UNIQUE INDEX "CommercialOrder_providerInvoiceId_key"
  ON "CommercialOrder"("providerInvoiceId");
