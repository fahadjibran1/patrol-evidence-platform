import type { LicensePlan } from '../types';
import { addDaysIso } from './dates';

/** Inclusive plan durations matching apps/license-api licence.util planDurationDays. */
export function planDurationDays(plan: LicensePlan): number {
  switch (plan) {
    case 'TRIAL':
      return 30;
    case 'MONTHLY':
      return 30;
    case 'ANNUAL':
      return 365;
    default:
      return 30;
  }
}

export function computeExpiresAtIso(startsAt: string, plan: LicensePlan): string {
  return addDaysIso(startsAt, planDurationDays(plan) - 1);
}

export const PLAN_DESCRIPTIONS: Record<LicensePlan, string> = {
  TRIAL: '30-day evaluation licence for onboarding and proof of value.',
  MONTHLY: 'Commercial month licence. Valid through the inclusive UTC expiry day.',
  ANNUAL: 'Commercial annual licence. Default choice for active customers.',
};
