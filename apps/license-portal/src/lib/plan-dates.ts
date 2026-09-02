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

export type RenewalPeriodOption = 'MONTHLY' | 'ANNUAL' | 'CUSTOM';

export const RENEWAL_PERIOD_DESCRIPTIONS: Record<RenewalPeriodOption, string> = {
  MONTHLY: 'Extends the licence by one calendar month from the renewal start date.',
  ANNUAL: 'Extends the licence by one calendar year from the renewal start date.',
  CUSTOM: 'Choose an exact end date. The start date still continues from the current expiry unless overridden.',
};

/** Calendar-safe month addition (UTC date-only). Clamps day overflow to month end. Mirrors apps/license-api licence.util. */
export function addCalendarMonths(isoDate: string, months: number): string {
  const [year, month, day] = isoDate.slice(0, 10).split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

export function addCalendarYears(isoDate: string, years: number): string {
  return addCalendarMonths(isoDate, years * 12);
}

/** Calendar-safe expiry for lifecycle renewals (inclusive end date). Mirrors apps/license-api licence.util. */
export function computeCalendarExpiresAt(startsAt: string, period: 'MONTHLY' | 'ANNUAL'): string {
  if (period === 'MONTHLY') {
    return addDaysIso(addCalendarMonths(startsAt, 1), -1);
  }
  return addDaysIso(addCalendarYears(startsAt, 1), -1);
}

/** The validFrom date the API expects by default: the day after the current expiry, or today if already expired. */
export function computeRenewalContinuityFrom(sourceExpiresAt: string, todayIso: string): string {
  const source = sourceExpiresAt.slice(0, 10);
  return source >= todayIso ? addDaysIso(source, 1) : todayIso;
}

/** Client-side preview mirror of apps/license-api computeRenewalWindow — the server remains authoritative. */
export function computeRenewalWindow(input: {
  renewalPeriod: RenewalPeriodOption;
  sourceExpiresAt: string;
  today: string;
  validFrom?: string;
  validUntil?: string;
}): { validFrom: string; validUntil: string } {
  const defaultFrom = computeRenewalContinuityFrom(input.sourceExpiresAt, input.today);
  const validFrom = input.validFrom ?? defaultFrom;

  if (input.renewalPeriod === 'CUSTOM') {
    return { validFrom, validUntil: input.validUntil ?? validFrom };
  }

  const validUntil = input.validUntil ?? computeCalendarExpiresAt(validFrom, input.renewalPeriod);
  return { validFrom, validUntil };
}
