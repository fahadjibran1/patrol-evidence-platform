import { BillingInterval } from '@prisma/client';
import { PricingService } from './pricing.service';

describe('PricingService', () => {
  const service = new PricingService();

  it('quotes monthly and annual prices', () => {
    const plan = { monthlyPrice: 9900, annualPrice: 99000, currency: 'GBP' };
    expect(service.quote(plan, BillingInterval.MONTHLY)).toEqual({
      amount: 9900,
      currency: 'GBP',
      interval: BillingInterval.MONTHLY,
      monthlyEquivalent: 9900,
    });
    expect(service.quote(plan, BillingInterval.ANNUAL).monthlyEquivalent).toBe(8250);
  });

  it('compares plans', () => {
    const rows = service.comparePlans(
      [
        { id: '1', code: 'STARTER', name: 'Starter', monthlyPrice: 4900, annualPrice: 49000, currency: 'GBP' },
        { id: '2', code: 'PRO', name: 'Pro', monthlyPrice: 9900, annualPrice: 99000, currency: 'GBP' },
      ],
      BillingInterval.MONTHLY,
    );
    expect(rows).toHaveLength(2);
    expect(rows[1].amount).toBe(9900);
  });
});
