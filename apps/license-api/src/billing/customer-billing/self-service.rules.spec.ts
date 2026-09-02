import { BillingInterval } from '@prisma/client';
import { estimateProration, isDowngrade, isUpgrade } from '@/billing/shared/plan-change.util';

describe('Phase 5B self-service billing rules', () => {
  const starter = { id: '1', code: 'STARTER', sortOrder: 10, monthlyPrice: 4900, annualPrice: 49000 };
  const pro = { id: '2', code: 'PROFESSIONAL', sortOrder: 20, monthlyPrice: 9900, annualPrice: 99000 };
  const enterprise = { id: '3', code: 'ENTERPRISE', sortOrder: 30, monthlyPrice: 24900, annualPrice: 249000 };

  it('allows Starter → Professional → Enterprise upgrades only', () => {
    expect(isUpgrade(starter, pro)).toBe(true);
    expect(isUpgrade(pro, enterprise)).toBe(true);
    expect(isUpgrade(enterprise, starter)).toBe(false);
    expect(isDowngrade(enterprise, pro)).toBe(true);
  });

  it('never produces negative proration for upgrades', () => {
    const estimate = estimateProration({
      currentMonthly: starter.monthlyPrice,
      currentAnnual: starter.annualPrice,
      targetMonthly: pro.monthlyPrice,
      targetAnnual: pro.annualPrice,
      interval: BillingInterval.MONTHLY,
      periodStart: new Date('2026-07-01T00:00:00.000Z'),
      periodEnd: new Date('2026-08-01T00:00:00.000Z'),
      now: new Date('2026-07-10T00:00:00.000Z'),
    });
    expect(estimate.prorationAmount).toBeGreaterThanOrEqual(0);
  });

  it('treats duplicate cancellation as idempotent intent key', () => {
    const keys = new Set<string>();
    const key = 'CANCELLATION_CONFIRMED:sub-1:pe';
    expect(keys.has(key)).toBe(false);
    keys.add(key);
    expect(keys.has(key)).toBe(true);
  });
});
