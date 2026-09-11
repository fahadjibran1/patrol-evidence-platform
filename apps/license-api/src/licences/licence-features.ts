/**
 * Administratively recorded TG1 feature identifiers.
 * These match product surfaces in PatrolSafe by S4.
 * Phase 2 stores them on the signed payload; online enforcement is Phase 3.
 */
export const SUPPORTED_LICENCE_FEATURES = [
  'collector',
  'dashboard',
  'evidence',
  'guard-safe',
  'reports',
  'csv-export',
  'patrol-ops',
  'alerts',
] as const;

export type SupportedLicenceFeature = (typeof SUPPORTED_LICENCE_FEATURES)[number];

/** Minimum features required for a usable desktop installation. */
export const REQUIRED_LICENCE_FEATURES: SupportedLicenceFeature[] = ['collector'];

export function normalizeLicenceFeatures(features: string[] | undefined | null): string[] {
  const unique = Array.from(new Set((features ?? []).map((feature) => feature.trim()).filter(Boolean)));
  return unique;
}

export function assertSupportedLicenceFeatures(features: string[]): void {
  const unsupported = features.filter(
    (feature) => !(SUPPORTED_LICENCE_FEATURES as readonly string[]).includes(feature),
  );
  if (unsupported.length > 0) {
    throw new Error(`Unsupported licence features: ${unsupported.join(', ')}`);
  }
}

export function hasRequiredLicenceFeatures(features: string[]): boolean {
  return REQUIRED_LICENCE_FEATURES.every((required) => features.includes(required));
}
