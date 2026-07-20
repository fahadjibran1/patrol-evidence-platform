import { LicensePlan, LicenseStatus } from '@prisma/client';
import {
  addDays,
  isLicenseExpiredOnDate,
  maskSignedLicenseKey,
  todayUtcDate,
  type LicensePlan as CoreLicensePlan,
} from '@patrol/license-core';
import { EncryptionService } from '@/crypto/encryption.service';

export type EffectiveLicenceStatus =
  | 'DRAFT'
  | 'SCHEDULED'
  | 'ACTIVE'
  | 'EXPIRING_SOON'
  | 'EXPIRED'
  | 'SUSPENDED'
  | 'REVOKED';

export function mapPlanToCore(plan: LicensePlan): CoreLicensePlan {
  return plan.toLowerCase() as CoreLicensePlan;
}

export function planDurationDays(plan: LicensePlan): number {
  switch (plan) {
    case LicensePlan.TRIAL:
      return 30;
    case LicensePlan.MONTHLY:
      return 30;
    case LicensePlan.ANNUAL:
      return 365;
    default:
      return 30;
  }
}

export function computeExpiresAt(startsAt: string, plan: LicensePlan, explicitExpiresAt?: string): string {
  if (explicitExpiresAt) {
    return explicitExpiresAt;
  }
  return addDays(startsAt, planDurationDays(plan) - 1);
}

export function toDateOnly(value: Date | string): string {
  if (typeof value === 'string') {
    return value.slice(0, 10);
  }
  return value.toISOString().slice(0, 10);
}

export function deriveEffectiveStatus(input: {
  status: LicenseStatus;
  startsAt: Date | string;
  expiresAt: Date | string;
  today?: string;
}): EffectiveLicenceStatus {
  const today = input.today ?? todayUtcDate();
  const startsAt = toDateOnly(input.startsAt);
  const expiresAt = toDateOnly(input.expiresAt);

  if (input.status === LicenseStatus.DRAFT) {
    return 'DRAFT';
  }
  if (input.status === LicenseStatus.SUSPENDED) {
    return 'SUSPENDED';
  }
  if (input.status === LicenseStatus.REVOKED) {
    return 'REVOKED';
  }

  if (isLicenseExpiredOnDate(expiresAt, today) || input.status === LicenseStatus.EXPIRED) {
    return 'EXPIRED';
  }

  if (startsAt > today) {
    return 'SCHEDULED';
  }

  const daysUntilExpiry = Math.floor(
    (new Date(`${expiresAt}T00:00:00.000Z`).getTime() - new Date(`${today}T00:00:00.000Z`).getTime()) /
      86_400_000,
  );

  if (daysUntilExpiry <= 7) {
    return 'EXPIRING_SOON';
  }

  return 'ACTIVE';
}

export function maskStoredLicenceKey(
  signedLicenseEnc: string | null | undefined,
  encryption: EncryptionService,
): string | null {
  if (!signedLicenseEnc) {
    return null;
  }
  try {
    const decrypted = encryption.decrypt(signedLicenseEnc);
    return maskSignedLicenseKey(decrypted);
  } catch {
    return 'TG1.[unavailable]';
  }
}

/**
 * Allocate the next human-readable licence ID using a single atomic PostgreSQL
 * upsert. Concurrent transactions cannot receive the same sequence number.
 */
export async function allocateLicenseId(
  tx: {
    $queryRaw: <T = unknown>(
      query: TemplateStringsArray,
      ...values: unknown[]
    ) => Promise<T>;
  },
  year = new Date().getUTCFullYear(),
): Promise<string> {
  const rows = await tx.$queryRaw<Array<{ lastValue: number }>>`
    INSERT INTO "LicenceIdSequence" ("year", "lastValue")
    VALUES (${year}, 1)
    ON CONFLICT ("year")
    DO UPDATE SET "lastValue" = "LicenceIdSequence"."lastValue" + 1
    RETURNING "lastValue"
  `;

  const lastValue = rows[0]?.lastValue;
  if (!Number.isInteger(lastValue) || lastValue < 1) {
    throw new Error(`Licence ID sequence returned an invalid value for year ${year}`);
  }

  return `PEL-${year}-${lastValue.toString().padStart(6, '0')}`;
}
