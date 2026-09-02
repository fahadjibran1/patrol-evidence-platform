import { BillingInterval } from '@prisma/client';
import { priceForInterval } from './billing.util';

export type PlanRankInput = {
  id: string;
  code: string;
  sortOrder: number;
  monthlyPrice: number;
  annualPrice: number;
};

/** Higher rank = higher tier (Enterprise > Professional > Starter). */
export function planRank(plan: PlanRankInput): number {
  return plan.sortOrder * 1_000_000 + plan.monthlyPrice;
}

export function isUpgrade(from: PlanRankInput, to: PlanRankInput): boolean {
  return planRank(to) > planRank(from);
}

export function isDowngrade(from: PlanRankInput, to: PlanRankInput): boolean {
  return planRank(to) < planRank(from);
}

export function estimateProration(input: {
  currentMonthly: number;
  currentAnnual: number;
  targetMonthly: number;
  targetAnnual: number;
  interval: BillingInterval;
  periodStart: Date | null;
  periodEnd: Date | null;
  now?: Date;
}): {
  currentPrice: number;
  targetPrice: number;
  unusedCredit: number;
  newCharge: number;
  prorationAmount: number;
  daysRemaining: number;
  periodDays: number;
} {
  const now = input.now ?? new Date();
  const currentPrice = priceForInterval(input.currentMonthly, input.currentAnnual, input.interval);
  const targetPrice = priceForInterval(input.targetMonthly, input.targetAnnual, input.interval);

  const start = input.periodStart?.getTime() ?? now.getTime();
  const end = input.periodEnd?.getTime() ?? now.getTime();
  const periodDays = Math.max(1, Math.ceil((end - start) / (24 * 60 * 60 * 1000)));
  const daysRemaining = Math.max(0, Math.ceil((end - now.getTime()) / (24 * 60 * 60 * 1000)));
  const fraction = Math.min(1, daysRemaining / periodDays);

  const unusedCredit = Math.round(currentPrice * fraction);
  const newCharge = Math.round(targetPrice * fraction);
  const prorationAmount = Math.max(0, newCharge - unusedCredit);

  return {
    currentPrice,
    targetPrice,
    unusedCredit,
    newCharge,
    prorationAmount,
    daysRemaining,
    periodDays,
  };
}
