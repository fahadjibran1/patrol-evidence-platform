import { BillingInterval } from '@prisma/client';
import { estimateProration, isDowngrade, isUpgrade, type PlanRankInput } from './plan-change.util';

describe('plan-change.util', () => {
  const starter: PlanRankInput = {
    id: '1',
    code: 'STARTER',
    sortOrder: 10,
    monthlyPrice: 4900,
    annualPrice: 49000,
  };
  const pro: PlanRankInput = {
    id: '2',
    code: 'PROFESSIONAL',
    sortOrder: 20,
    monthlyPrice: 9900,
    annualPrice: 99000,
  };

  it('detects upgrades and downgrades by rank', () => {
    expect(isUpgrade(starter, pro)).toBe(true);
    expect(isDowngrade(pro, starter)).toBe(true);
    expect(isUpgrade(pro, starter)).toBe(false);
  });

  it('estimates non-negative upgrade proration', () => {
    const now = new Date('2026-07-15T00:00:00.000Z');
    const periodStart = new Date('2026-07-01T00:00:00.000Z');
    const periodEnd = new Date('2026-08-01T00:00:00.000Z');
    const estimate = estimateProration({
      currentMonthly: starter.monthlyPrice,
      currentAnnual: starter.annualPrice,
      targetMonthly: pro.monthlyPrice,
      targetAnnual: pro.annualPrice,
      interval: BillingInterval.MONTHLY,
      periodStart,
      periodEnd,
      now,
    });
    expect(estimate.prorationAmount).toBeGreaterThan(0);
    expect(estimate.prorationAmount).toBe(estimate.newCharge - estimate.unusedCredit);
  });
});
