import type { LicenseSnapshot, LicenseStatusResponse } from '../types';

export function projectAuthoritativeLicenceStatus(
  current: LicenseSnapshot,
  next: LicenseStatusResponse,
): LicenseSnapshot {
  const licenseType: LicenseSnapshot['licenseType'] =
    next.plan === 'annual'
      ? 'ANNUAL'
      : next.plan === 'monthly'
        ? 'MONTHLY'
        : next.plan === 'trial'
          ? 'TRIAL'
          : current.licenseType;

  return {
    ...current,
    companyName: next.companyName,
    licenseId: next.licenseId,
    licenseType,
    plan: next.plan,
    displayMode: next.displayMode,
    legacy: next.legacy,
    startsAt: next.startsAt,
    expiresAt: next.expiresAt,
    status: next.status,
    daysRemaining: next.daysRemaining,
    installationId: next.installationId,
    maxDevices: next.maxDevices,
    features: [...next.features],
    activatedAt: next.activatedAt,
    lastSuccessfulValidationAt: next.lastSuccessfulValidationAt,
    message: next.message,
    collectorAllowed: next.collectorAllowed,
    operationsAllowed: next.operationsAllowed,
    requiresActivation: next.requiresActivation,
  };
}
