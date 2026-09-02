import { Injectable } from '@nestjs/common';
import {
  BillingInterval,
  CustomerStatus,
  PlanStatus,
  StripeCheckoutSessionStatus,
  SubscriptionStatus,
} from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '@/prisma/prisma.service';
import { AuditService } from '@/audit/audit.service';
import { ApiException } from '@/common/exceptions/api.exception';
import { ERROR_CODES } from '@/common/constants/error-codes';
import { AuthenticatedCustomer } from '@/customer-auth/interfaces/authenticated-customer.interface';
import { CustomerPermission, roleHasPermission } from '@/customer-org/customer-permissions';
import { PaymentProviderRegistry } from '../providers/payment-provider.registry';
import { StripeConfigService } from './stripe-config.service';
import { InvoicesService } from '../invoices/invoices.service';
import { MetricsService } from '@/metrics/metrics.service';
import { Optional } from '@nestjs/common';

@Injectable()
export class StripeCheckoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly providers: PaymentProviderRegistry,
    private readonly stripeConfig: StripeConfigService,
    private readonly invoicesService: InvoicesService,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  async createCheckout(
    actor: AuthenticatedCustomer,
    dto: { planId: string; billingInterval: BillingInterval; acceptedTermsVersion: string },
  ) {
    if (!roleHasPermission(actor.role, CustomerPermission.PURCHASE_BILLING)) {
      throw new ApiException(ERROR_CODES.CUSTOMER_PERMISSION_DENIED, 'Purchase not permitted', 403);
    }
    if (!actor.emailVerified) {
      throw new ApiException(ERROR_CODES.CUSTOMER_EMAIL_NOT_VERIFIED, 'Email must be verified', 403);
    }

    const cfg = this.stripeConfig.assertReadyForCheckout();
    if (dto.acceptedTermsVersion !== cfg.currentTermsVersion) {
      throw new ApiException(ERROR_CODES.STRIPE_TERMS_REQUIRED, 'Accept the current terms version', 400);
    }

    const organisation = await this.prisma.customer.findUnique({ where: { id: actor.companyId } });
    if (!organisation || organisation.status === CustomerStatus.CLOSED || organisation.status === CustomerStatus.SUSPENDED) {
      throw new ApiException(ERROR_CODES.CUSTOMER_NOT_FOUND, 'Organisation not eligible', 400);
    }

    const plan = await this.prisma.plan.findUnique({ where: { id: dto.planId } });
    if (!plan || plan.status !== PlanStatus.ACTIVE || !plan.isPublic) {
      throw new ApiException(ERROR_CODES.PLAN_NOT_ACTIVE, 'Plan is not available', 400);
    }

    const livemode = this.stripeConfig.getMode() === 'LIVE';
    const priceMapping = await this.prisma.stripePriceMapping.findUnique({
      where: {
        planId_billingInterval_livemode: {
          planId: plan.id,
          billingInterval: dto.billingInterval,
          livemode,
        },
      },
    });
    if (!priceMapping || !priceMapping.active) {
      throw new ApiException(ERROR_CODES.STRIPE_MAPPING_NOT_FOUND, 'Stripe price mapping not configured', 400);
    }

    const activeSub = await this.prisma.subscription.findFirst({
      where: {
        organisationId: actor.companyId,
        status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIAL, SubscriptionStatus.PAST_DUE] },
        pendingCheckout: false,
      },
    });
    if (activeSub) {
      throw new ApiException(
        ERROR_CODES.SUBSCRIPTION_ALREADY_EXISTS,
        'Organisation already has an active subscription',
        409,
      );
    }

    const openCheckout = await this.prisma.stripeCheckoutSession.findFirst({
      where: {
        organisationId: actor.companyId,
        status: StripeCheckoutSessionStatus.OPEN,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    });
    if (openCheckout) {
      throw new ApiException(
        ERROR_CODES.STRIPE_CHECKOUT_EXISTS,
        'An open checkout session already exists',
        409,
      );
    }

    const stripe = this.providers.getStripe();
    const customerMapping = await this.ensureStripeCustomer(actor, organisation, livemode);

    const pendingSub = await this.prisma.subscription.create({
      data: {
        organisationId: actor.companyId,
        planId: plan.id,
        status: SubscriptionStatus.TRIAL,
        billingInterval: dto.billingInterval,
        pendingCheckout: true,
        autoRenew: true,
      },
    });

    const invoice = await this.invoicesService.createForSubscription(pendingSub.id);

    const idempotencyKey = createHash('sha256')
      .update([actor.companyId, plan.id, dto.billingInterval, pendingSub.id].join(':'))
      .digest('hex')
      .slice(0, 48);

    const session = await stripe.createCheckoutSession({
      organisationId: actor.companyId,
      stripeCustomerId: customerMapping.stripeCustomerId,
      stripePriceId: priceMapping.stripePriceId,
      successUrl: cfg.successUrl,
      cancelUrl: cfg.cancelUrl,
      clientReferenceId: pendingSub.id,
      idempotencyKey: `checkout_${idempotencyKey}`,
      metadata: {
        organisationId: actor.companyId,
        internalSubscriptionId: pendingSub.id,
        internalInvoiceId: invoice.id,
        planId: plan.id,
        billingInterval: dto.billingInterval,
      },
    });

    const stored = await this.prisma.stripeCheckoutSession.create({
      data: {
        organisationId: actor.companyId,
        internalSubscriptionId: pendingSub.id,
        internalInvoiceId: invoice.id,
        stripeCheckoutSessionId: session.providerSessionId,
        purpose: 'INITIAL',
        status: StripeCheckoutSessionStatus.OPEN,
        expiresAt: session.expiresAt,
        livemode: session.livemode,
        acceptedTermsVersion: dto.acceptedTermsVersion,
        idempotencyKey,
      },
    });

    await this.auditService.record({
      actorCustomerUserId: actor.sub,
      action: 'stripe.checkout.created',
      entityType: 'StripeCheckoutSession',
      entityId: stored.id,
      customerId: actor.companyId,
      metadata: {
        stripeCheckoutSessionId: stored.stripeCheckoutSessionId,
        subscriptionId: pendingSub.id,
        livemode: stored.livemode,
      },
    });

    this.metrics?.increment('stripeCheckoutCreated');

    return {
      checkoutSessionId: stored.stripeCheckoutSessionId,
      checkoutUrl: session.url,
      expiresAt: stored.expiresAt?.toISOString() ?? null,
    };
  }

  async getCheckoutStatus(actor: AuthenticatedCustomer, sessionId: string) {
    const session = await this.prisma.stripeCheckoutSession.findUnique({
      where: { stripeCheckoutSessionId: sessionId },
      include: {
        subscription: { include: { plan: true } },
      },
    });
    if (!session || session.organisationId !== actor.companyId) {
      throw new ApiException(ERROR_CODES.STRIPE_SESSION_NOT_FOUND, 'Checkout session not found', 404);
    }

    const invoice = session.internalInvoiceId
      ? await this.prisma.invoice.findUnique({ where: { id: session.internalInvoiceId } })
      : null;

    return {
      checkoutSessionId: session.stripeCheckoutSessionId,
      status: session.status,
      subscription: session.subscription
        ? {
            id: session.subscription.id,
            status: session.subscription.status,
            pendingCheckout: session.subscription.pendingCheckout,
            planCode: session.subscription.plan.code,
            currentPeriodEnd: session.subscription.currentPeriodEnd?.toISOString() ?? null,
          }
        : null,
      invoice: invoice
        ? {
            id: invoice.id,
            number: invoice.number,
            status: invoice.status,
            total: invoice.total,
            currency: invoice.currency,
          }
        : null,
      completedAt: session.completedAt?.toISOString() ?? null,
    };
  }

  async createPortalSession(actor: AuthenticatedCustomer) {
    if (!roleHasPermission(actor.role, CustomerPermission.VIEW_BILLING)) {
      throw new ApiException(ERROR_CODES.CUSTOMER_PERMISSION_DENIED, 'Billing access denied', 403);
    }
    const cfg = this.stripeConfig.assertReadyForCheckout();
    const livemode = this.stripeConfig.getMode() === 'LIVE';
    const mapping = await this.prisma.stripeCustomerMapping.findUnique({
      where: { organisationId_livemode: { organisationId: actor.companyId, livemode } },
    });
    if (!mapping) {
      throw new ApiException(ERROR_CODES.STRIPE_CUSTOMER_NOT_FOUND, 'No Stripe customer for organisation', 404);
    }
    const portal = await this.providers.getStripe().createBillingPortalSession({
      stripeCustomerId: mapping.stripeCustomerId,
      returnUrl: cfg.portalReturnUrl,
    });
    return { url: portal.url };
  }

  private async ensureStripeCustomer(
    actor: AuthenticatedCustomer,
    organisation: { id: string; companyName: string; email: string },
    livemode: boolean,
  ) {
    const existing = await this.prisma.stripeCustomerMapping.findUnique({
      where: { organisationId_livemode: { organisationId: organisation.id, livemode } },
    });
    const stripe = this.providers.getStripe();
    if (existing) {
      try {
        await stripe.retrieveCustomer(existing.stripeCustomerId);
        return existing;
      } catch {
        // recreate below
      }
    }

    const created = await stripe.createCustomer({
      email: actor.email || organisation.email,
      name: organisation.companyName,
      metadata: {
        organisationId: organisation.id,
        internalCustomerReference: organisation.id,
      },
      idempotencyKey: `cust_${organisation.id}_${livemode ? 'live' : 'test'}`,
    });

    return this.prisma.stripeCustomerMapping.upsert({
      where: { organisationId_livemode: { organisationId: organisation.id, livemode } },
      create: {
        organisationId: organisation.id,
        stripeCustomerId: created.providerCustomerId,
        livemode: created.livemode,
      },
      update: {
        stripeCustomerId: created.providerCustomerId,
        livemode: created.livemode,
      },
    });
  }
}
