import { Injectable } from '@nestjs/common';
import { BillingInterval, SubscriptionStatus } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/prisma/prisma.service';
import { ApiException } from '@/common/exceptions/api.exception';
import { ERROR_CODES } from '@/common/constants/error-codes';
import { AuthenticatedCustomer } from '@/customer-auth/interfaces/authenticated-customer.interface';
import { CustomerPermission, roleHasPermission } from '@/customer-org/customer-permissions';
import { PlansService } from '../plans/plans.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { InvoicesService } from '../invoices/invoices.service';
import { BillingPaymentsService } from '../payments/billing-payments.service';
import { PricingService } from '../pricing/pricing.service';

@Injectable()
export class CustomerBillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly plansService: PlansService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly invoicesService: InvoicesService,
    private readonly billingPaymentsService: BillingPaymentsService,
    private readonly pricingService: PricingService,
    private readonly config: ConfigService,
  ) {}

  async overview(actor: AuthenticatedCustomer) {
    this.assertCanView(actor);
    const subscription = await this.prisma.subscription.findFirst({
      where: {
        organisationId: actor.companyId,
        status: {
          in: [
            SubscriptionStatus.TRIAL,
            SubscriptionStatus.ACTIVE,
            SubscriptionStatus.PAST_DUE,
            SubscriptionStatus.SUSPENDED,
            SubscriptionStatus.CANCELLED,
          ],
        },
      },
      include: { plan: true, organisation: true },
      orderBy: { createdAt: 'desc' },
    });

    const invoices = await this.invoicesService.list({
      organisationId: actor.companyId,
      pageSize: 20,
    });
    const payments = await this.billingPaymentsService.list({
      organisationId: actor.companyId,
      pageSize: 20,
    });
    const plans = await this.plansService.list({ publicOnly: true });

    return {
      subscription: subscription ? this.subscriptionsService.serialize(subscription) : null,
      plan: subscription ? this.plansService.serialize(subscription.plan) : null,
      renewalDate: subscription?.nextBillingDate?.toISOString() ?? null,
      invoices: invoices.items,
      payments: payments.items,
      plans: plans.items,
      planComparison: this.pricingService.comparePlans(
        plans.items.map((plan) => ({
          id: plan.id,
          code: plan.code,
          name: plan.name,
          monthlyPrice: plan.monthlyPrice,
          annualPrice: plan.annualPrice,
          currency: plan.currency,
        })),
        subscription?.billingInterval ?? BillingInterval.MONTHLY,
      ),
      upgradeAvailable: false,
      downgradeAvailable: false,
      selfServeChangeDisabledReason:
        'Customer-initiated plan upgrades and downgrades are not available in this release. Contact support to change plan.',
      stripeCheckoutEnabled: ['1', 'true', 'yes', 'on'].includes(
        String(this.config.get<string>('STRIPE_ENABLED') ?? '').toLowerCase(),
      ),
      termsVersion: this.config.get<string>('BILLING_TERMS_VERSION') ?? '2026-07-01',
      canPurchase: roleHasPermission(actor.role, CustomerPermission.PURCHASE_BILLING),
      paymentActionRequired: subscription?.status === SubscriptionStatus.PAST_DUE,
      gracePeriodDays: Number(this.config.get<string>('BILLING_GRACE_PERIOD_DAYS') ?? '7'),
    };
  }

  async listPlans(actor: AuthenticatedCustomer) {
    this.assertCanView(actor);
    return this.plansService.list({ publicOnly: true });
  }

  async currentSubscription(actor: AuthenticatedCustomer) {
    this.assertCanView(actor);
    const subscription = await this.prisma.subscription.findFirst({
      where: { organisationId: actor.companyId },
      include: { plan: true, organisation: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!subscription) {
      throw new ApiException(ERROR_CODES.SUBSCRIPTION_NOT_FOUND, 'No subscription found', 404);
    }
    return this.subscriptionsService.serialize(subscription);
  }

  async invoices(actor: AuthenticatedCustomer) {
    this.assertCanView(actor);
    return this.invoicesService.list({ organisationId: actor.companyId, pageSize: 100 });
  }

  async payments(actor: AuthenticatedCustomer) {
    this.assertCanView(actor);
    return this.billingPaymentsService.list({ organisationId: actor.companyId, pageSize: 100 });
  }

  private assertCanView(actor: AuthenticatedCustomer) {
    if (!roleHasPermission(actor.role, CustomerPermission.VIEW_BILLING)) {
      throw new ApiException(ERROR_CODES.CUSTOMER_PERMISSION_DENIED, 'Billing access denied', 403);
    }
  }
}
