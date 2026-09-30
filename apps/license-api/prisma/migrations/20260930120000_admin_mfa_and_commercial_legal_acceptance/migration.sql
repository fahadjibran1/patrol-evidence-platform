-- Production operator MFA and immutable commercial legal-acceptance evidence.
ALTER TABLE "Admin"
  ADD COLUMN "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "mfaSecretEnc" TEXT,
  ADD COLUMN "mfaEnrolledAt" TIMESTAMP(3),
  ADD COLUMN "mfaLastTotpCounter" INTEGER;

CREATE TABLE "AdminMfaChallenge" (
  "id" TEXT NOT NULL,
  "adminId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "pendingSecretEnc" TEXT,
  "secretPresentedAt" TIMESTAMP(3),
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  CONSTRAINT "AdminMfaChallenge_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AdminMfaChallenge_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Admin"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "AdminMfaChallenge_tokenHash_key" ON "AdminMfaChallenge"("tokenHash");
CREATE INDEX "AdminMfaChallenge_adminId_purpose_expiresAt_idx" ON "AdminMfaChallenge"("adminId", "purpose", "expiresAt");

CREATE TABLE "AdminMfaRecoveryCode" (
  "id" TEXT NOT NULL,
  "adminId" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "usedAt" TIMESTAMP(3),
  CONSTRAINT "AdminMfaRecoveryCode_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AdminMfaRecoveryCode_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Admin"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "AdminMfaRecoveryCode_codeHash_key" ON "AdminMfaRecoveryCode"("codeHash");
CREATE INDEX "AdminMfaRecoveryCode_adminId_usedAt_idx" ON "AdminMfaRecoveryCode"("adminId", "usedAt");

ALTER TABLE "CommercialOrder" ADD COLUMN "legalAcceptedAt" TIMESTAMP(3);
