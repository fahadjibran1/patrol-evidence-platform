import { BillingInterval } from '@prisma/client';

export function addBillingPeriod(from: Date, interval: BillingInterval): Date {
  const next = new Date(from);
  if (interval === BillingInterval.ANNUAL) {
    next.setUTCFullYear(next.getUTCFullYear() + 1);
  } else {
    next.setUTCMonth(next.getUTCMonth() + 1);
  }
  return next;
}

export function priceForInterval(
  monthlyPrice: number,
  annualPrice: number,
  interval: BillingInterval,
): number {
  return interval === BillingInterval.ANNUAL ? annualPrice : monthlyPrice;
}

export function formatMoneyMinor(amount: number, currency = 'GBP'): string {
  const major = (amount / 100).toFixed(2);
  return `${currency} ${major}`;
}
