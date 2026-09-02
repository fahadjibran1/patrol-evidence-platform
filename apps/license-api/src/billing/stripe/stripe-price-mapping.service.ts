import { Injectable } from '@nestjs/common';
import { BillingInterval } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { AuditService } from '@/audit/audit.service';
import { ApiException } from '@/common/exceptions/api.exception';
import { ERROR_CODES } from '@/common/constants/error-codes';
import type { AuthenticatedAdmin } from '@/auth/interfaces/authenticated-admin.interface';
import { PaymentProviderRegistry } from '../providers/payment-provider.registry';
import { StripeConfigService } from './stripe-config.service';
import { priceForInterval } from '../shared/billing.util';

@Injectable()
export class StripePriceMappingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly providers: PaymentProviderRegistry,
    private readonly stripeConfig: StripeConfigService,
  ) {}

  list() {
    return this.prisma.stripePriceMapping.findMany({
      include: { plan: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async upsert(
    admin: AuthenticatedAdmin,
    dto: {
      planId: string;
      billingInterval: BillingInterval;
      stripeProductId: string;
      stripePriceId: string;
    },
  ) {
    const plan = await this.prisma.plan.findUnique({ where: { id: dto.planId } });
    if (!plan) {
      throw new ApiException(ERROR_CODES.PLAN_NOT_FOUND, 'Plan not found', 404);
    }
    const livemode = this.stripeConfig.getMode() === 'LIVE';
    const validation = await this.validateAgainstStripe(dto.stripePriceId, plan, dto.billingInterval, livemode);

    const mapping = await this.prisma.stripePriceMapping.upsert({
      where: {
        planId_billingInterval_livemode: {
          planId: dto.planId,
          billingInterval: dto.billingInterval,
          livemode,
        },
      },
      create: {
        planId: dto.planId,
        billingInterval: dto.billingInterval,
        stripeProductId: validation.stripeProductId,
        stripePriceId: dto.stripePriceId,
        currency: validation.currency,
        active: true,
        livemode,
      },
      update: {
        stripeProductId: validation.stripeProductId,
        stripePriceId: dto.stripePriceId,
        currency: validation.currency,
        active: true,
        livemode,
      },
      include: { plan: true },
    });

    await this.auditService.record({
      actorAdminId: admin.sub,
      action: 'stripe.price_mapping.upserted',
      entityType: 'StripePriceMapping',
      entityId: mapping.id,
      metadata: {
        planId: dto.planId,
        billingInterval: dto.billingInterval,
        stripePriceId: dto.stripePriceId,
        livemode,
      },
    });

    return mapping;
  }

  async disable(admin: AuthenticatedAdmin, id: string) {
    const mapping = await this.prisma.stripePriceMapping.update({
      where: { id },
      data: { active: false },
    });
    await this.auditService.record({
      actorAdminId: admin.sub,
      action: 'stripe.price_mapping.disabled',
      entityType: 'StripePriceMapping',
      entityId: id,
    });
    return mapping;
  }

  async validate(id: string) {
    const mapping = await this.prisma.stripePriceMapping.findUnique({
      where: { id },
      include: { plan: true },
    });
    if (!mapping) {
      throw new ApiException(ERROR_CODES.STRIPE_MAPPING_NOT_FOUND, 'Mapping not found', 404);
    }
    return this.validateAgainstStripe(
      mapping.stripePriceId,
      mapping.plan,
      mapping.billingInterval,
      mapping.livemode,
    );
  }

  private async validateAgainstStripe(
    stripePriceId: string,
    plan: { monthlyPrice: number; annualPrice: number; currency: string },
    billingInterval: BillingInterval,
    expectedLivemode: boolean,
  ) {
    const price = await this.providers.getStripe().retrievePrice(stripePriceId);
    const expectedAmount = priceForInterval(plan.monthlyPrice, plan.annualPrice, billingInterval);
    const errors: string[] = [];
    if (!price.active) errors.push('Stripe price is not active');
    if (price.currency !== plan.currency.toUpperCase()) errors.push('Currency mismatch');
    if (price.interval !== billingInterval) errors.push('Billing interval mismatch');
    if (price.unitAmount !== expectedAmount) errors.push('Unit amount mismatch');
    if (price.livemode !== expectedLivemode) errors.push('Livemode mismatch');
    if (errors.length) {
      throw new ApiException(ERROR_CODES.STRIPE_MAPPING_INVALID, errors.join('; '), 400);
    }
    return price;
  }
}
