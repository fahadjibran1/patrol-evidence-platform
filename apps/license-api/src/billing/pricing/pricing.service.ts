import { Injectable } from '@nestjs/common';
import { BillingInterval } from '@prisma/client';
import { priceForInterval } from '../shared/billing.util';

export interface PricedPlanInput {
  monthlyPrice: number;
  annualPrice: number;
  currency: string;
  billingInterval?: BillingInterval;
}

@Injectable()
export class PricingService {
  quote(plan: PricedPlanInput, interval: BillingInterval) {
    const amount = priceForInterval(plan.monthlyPrice, plan.annualPrice, interval);
    return {
      amount,
      currency: plan.currency,
      interval,
      monthlyEquivalent:
        interval === BillingInterval.ANNUAL ? Math.round(amount / 12) : amount,
    };
  }

  comparePlans(
    plans: Array<PricedPlanInput & { id: string; code: string; name: string }>,
    interval: BillingInterval,
  ) {
    return plans.map((plan) => ({
      id: plan.id,
      code: plan.code,
      name: plan.name,
      ...this.quote(plan, interval),
    }));
  }
}
