import type { LicenceEvaluation } from '@patrol/license-core';

/** A modest reconciliation interval backs up the exact entitlement boundary timer. */
export const ENTITLEMENT_SAFETY_RECHECK_MS = 5 * 60 * 1000;

export type MonitoringEntitlementRestriction = 'TRIAL_EXPIRED' | 'LICENCE_REQUIRED';

export function monitoringEntitlementRestriction(
  evaluation: Pick<LicenceEvaluation, 'collectorAllowed' | 'mode' | 'status'>,
): MonitoringEntitlementRestriction | null {
  if (evaluation.collectorAllowed && evaluation.status === 'active') {
    return null;
  }

  return evaluation.mode === 'trial' && evaluation.status === 'expired'
    ? 'TRIAL_EXPIRED'
    : 'LICENCE_REQUIRED';
}

/**
 * Returns the first millisecond at which the entitlement must be re-evaluated.
 * Commercial licence dates are inclusive UTC calendar dates. Local trials carry
 * a full ISO instant and are active through that instant.
 */
export function entitlementExpiryBoundaryMs(
  evaluation: Pick<LicenceEvaluation, 'expiresAt'>,
): number | null {
  const expiresAt = evaluation.expiresAt?.trim();
  if (!expiresAt) {
    return null;
  }

  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(expiresAt)
    ? Date.parse(`${expiresAt}T23:59:59.999Z`)
    : Date.parse(expiresAt);
  return Number.isFinite(parsed) ? parsed + 1 : null;
}

export function nextEntitlementRecheckDelayMs(
  evaluation: Pick<LicenceEvaluation, 'expiresAt'>,
  nowMs = Date.now(),
  safetyRecheckMs = ENTITLEMENT_SAFETY_RECHECK_MS,
): number {
  const boundary = entitlementExpiryBoundaryMs(evaluation);
  if (boundary === null) {
    return safetyRecheckMs;
  }

  return Math.max(1, Math.min(safetyRecheckMs, boundary - nowMs));
}
