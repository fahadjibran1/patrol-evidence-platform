-- Phase 6B lean staging: tiny immutable .tglic artifacts are encrypted in
-- PostgreSQL so a free web service never relies on ephemeral local storage.
CREATE TABLE "CommercialArtifactBlob" (
    "storageKey" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "byteSize" BIGINT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommercialArtifactBlob_pkey" PRIMARY KEY ("storageKey")
);

CREATE INDEX "CommercialArtifactBlob_sha256_idx" ON "CommercialArtifactBlob"("sha256");

-- The licence API uses a direct server-side database role. Prevent Supabase's
-- client-facing anon/authenticated roles from reading licence material even if
-- the public schema is exposed through the Data API.
ALTER TABLE "CommercialArtifactBlob" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "CommercialArtifactBlob" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "CommercialArtifactBlob" FROM authenticated;
  END IF;
END $$;
