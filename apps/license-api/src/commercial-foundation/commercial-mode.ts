export const COMMERCIAL_MODES = ['DISABLED', 'STAGING_TEST', 'PRODUCTION_LIVE'] as const;

export type CommercialMode = typeof COMMERCIAL_MODES[number];
export type CommercialProviderRuntimeMode = 'DISABLED' | 'TEST' | 'LIVE';

export interface CommercialModeSource {
  COMMERCIAL_MODE?: string;
  COMMERCIAL_STRIPE_ENABLED?: string;
  NODE_ENV?: string;
  PATROLSAFE_COMMERCIAL_STAGING?: string;
}

export function isTruthy(value: unknown): boolean {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').toLowerCase());
}

export function configuredCommercialMode(source: CommercialModeSource): CommercialMode {
  const explicit = source.COMMERCIAL_MODE?.trim();
  if (explicit) {
    if ((COMMERCIAL_MODES as readonly string[]).includes(explicit)) return explicit as CommercialMode;
    throw new Error('[commercial-mode] COMMERCIAL_MODE must be DISABLED, STAGING_TEST, or PRODUCTION_LIVE.');
  }

  // Compatibility for the already-proven Phase 6 staging deployment and deterministic tests.
  // Production deliberately has no inference path: it must declare PRODUCTION_LIVE explicitly.
  if (
    isTruthy(source.COMMERCIAL_STRIPE_ENABLED)
    && (
      source.NODE_ENV === 'test'
      || (source.NODE_ENV === 'staging' && isTruthy(source.PATROLSAFE_COMMERCIAL_STAGING))
    )
  ) {
    return 'STAGING_TEST';
  }
  return 'DISABLED';
}

export function effectiveCommercialMode(source: CommercialModeSource): CommercialMode {
  if (!isTruthy(source.COMMERCIAL_STRIPE_ENABLED)) return 'DISABLED';
  return configuredCommercialMode(source);
}

export function providerModeFor(mode: CommercialMode): CommercialProviderRuntimeMode {
  if (mode === 'STAGING_TEST') return 'TEST';
  if (mode === 'PRODUCTION_LIVE') return 'LIVE';
  return 'DISABLED';
}

export function expectedLivemodeFor(mode: CommercialMode): boolean {
  if (mode === 'PRODUCTION_LIVE') return true;
  if (mode === 'STAGING_TEST') return false;
  throw new Error('[commercial-mode] Disabled commercial mode has no Stripe livemode expectation.');
}
