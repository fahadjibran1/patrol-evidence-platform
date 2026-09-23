-- Phase 6 closes the paid-order-to-delivery boundary by freezing the
-- operator-approved recipient on the issuance. Existing Phase 4 records
-- retain the verified customer-user fallback.
ALTER TABLE "CommercialLicenceIssuance"
  ADD COLUMN "deliveryRecipient" TEXT;

ALTER TABLE "CommercialLicenceIssuance"
  ADD CONSTRAINT "CommercialLicenceIssuance_deliveryRecipient_format_check"
  CHECK (
    "deliveryRecipient" IS NULL
    OR (
      char_length("deliveryRecipient") BETWEEN 3 AND 254
      AND "deliveryRecipient" = lower("deliveryRecipient")
      AND "deliveryRecipient" ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    )
  );
