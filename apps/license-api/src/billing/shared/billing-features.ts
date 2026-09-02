/**
 * Application-level commercial features. Plans reference these codes;
 * runtime checks go through {@link FeatureService} / {@link PlanFeatureResolver}.
 */
export enum BillingFeature {
  HAZARD_DETECTION = 'HAZARD_DETECTION',
  UNLIMITED_DOWNLOADS = 'UNLIMITED_DOWNLOADS',
  MULTI_USER = 'MULTI_USER',
  API_ACCESS = 'API_ACCESS',
  WHITE_LABEL = 'WHITE_LABEL',
  ADVANCED_REPORTING = 'ADVANCED_REPORTING',
  CUSTOM_BRANDING = 'CUSTOM_BRANDING',
  REMOTE_MONITORING = 'REMOTE_MONITORING',
}

export const ALL_BILLING_FEATURES = Object.values(BillingFeature);

/** Maps commercial features onto TG1 licence feature identifiers. */
export const BILLING_TO_LICENCE_FEATURES: Record<BillingFeature, readonly string[]> = {
  [BillingFeature.HAZARD_DETECTION]: ['collector', 'alerts'],
  [BillingFeature.UNLIMITED_DOWNLOADS]: ['evidence'],
  [BillingFeature.MULTI_USER]: ['dashboard'],
  [BillingFeature.API_ACCESS]: ['patrol-ops'],
  [BillingFeature.WHITE_LABEL]: ['dashboard'],
  [BillingFeature.ADVANCED_REPORTING]: ['reports', 'csv-export'],
  [BillingFeature.CUSTOM_BRANDING]: ['dashboard'],
  [BillingFeature.REMOTE_MONITORING]: ['guard-safe', 'alerts'],
};

export function normalizeBillingFeatures(features: unknown): BillingFeature[] {
  if (!Array.isArray(features)) {
    return [];
  }
  const allowed = new Set<string>(ALL_BILLING_FEATURES);
  return Array.from(
    new Set(
      features
        .map((value) => String(value).trim())
        .filter((value): value is BillingFeature => allowed.has(value)),
    ),
  );
}
