import { LicensePlan, LicenseStatus, NotificationStatus, NotificationType, Prisma } from '@prisma/client';
import { todayUtcDate } from '@patrol/license-core';
import { deriveEffectiveStatus, toDateOnly } from '@/licences/licence.util';

export interface CustomerSafeLicenceDto {
  id: string;
  licenseId: string;
  status: LicenseStatus;
  effectiveStatus: string;
  plan: LicensePlan;
  issuedAt: string | null;
  startsAt: string;
  expiresAt: string;
  maxDevices: number;
  currentVersionNumber: number | null;
  downloadCount: number;
  lastDownloadedAt: string | null;
  hasDownloadableFile: boolean;
}

export function toCustomerSafeLicence(licence: {
  id: string;
  licenseId: string;
  status: LicenseStatus;
  plan: LicensePlan;
  issuedAt: Date | null;
  startsAt: Date;
  expiresAt: Date;
  maxDevices: number;
  downloadCount: number;
  lastDownloadedAt: Date | null;
  signedLicenseEnc: string | null;
  currentVersion?: { versionNumber: number } | null;
}): CustomerSafeLicenceDto {
  return {
    id: licence.id,
    licenseId: licence.licenseId,
    status: licence.status,
    effectiveStatus: deriveEffectiveStatus(licence),
    plan: licence.plan,
    issuedAt: licence.issuedAt?.toISOString() ?? null,
    startsAt: toDateOnly(licence.startsAt),
    expiresAt: toDateOnly(licence.expiresAt),
    maxDevices: licence.maxDevices,
    currentVersionNumber: licence.currentVersion?.versionNumber ?? null,
    downloadCount: licence.downloadCount,
    lastDownloadedAt: licence.lastDownloadedAt?.toISOString() ?? null,
    hasDownloadableFile: Boolean(licence.signedLicenseEnc),
  };
}

export function daysUntilExpiry(expiresAt: Date): number {
  const today = todayUtcDate();
  const expiry = toDateOnly(expiresAt);
  const todayMs = Date.parse(`${today}T00:00:00.000Z`);
  const expiryMs = Date.parse(`${expiry}T00:00:00.000Z`);
  return Math.round((expiryMs - todayMs) / 86_400_000);
}

export type NotificationCategory = 'licence' | 'general' | 'system';

const LICENCE_TYPES: NotificationType[] = [
  NotificationType.LICENSE_ISSUED,
  NotificationType.LICENSE_REISSUED,
  NotificationType.LICENSE_RENEWED,
  NotificationType.LICENSE_EXPIRED,
  NotificationType.LICENSE_EXPIRING,
];

const GENERAL_TYPES: NotificationType[] = [
  NotificationType.WELCOME,
  NotificationType.PASSWORD_RESET,
  NotificationType.PAYMENT_RECEIVED,
  NotificationType.PAYMENT_FAILED,
];

const SYSTEM_TYPES: NotificationType[] = [NotificationType.ADMIN_ALERT];

export function notificationTypesForCategory(category?: NotificationCategory): NotificationType[] | undefined {
  if (!category) {
    return undefined;
  }
  if (category === 'licence') {
    return LICENCE_TYPES;
  }
  if (category === 'general') {
    return GENERAL_TYPES;
  }
  return SYSTEM_TYPES;
}

export function categoryForNotificationType(type: NotificationType): NotificationCategory {
  if (LICENCE_TYPES.includes(type)) {
    return 'licence';
  }
  if (SYSTEM_TYPES.includes(type)) {
    return 'system';
  }
  return 'general';
}

export function assertSameCompany(customerId: string, companyId: string): void {
  if (customerId !== companyId) {
    throw new Error('Company scope mismatch');
  }
}

export type { Prisma, NotificationStatus };
