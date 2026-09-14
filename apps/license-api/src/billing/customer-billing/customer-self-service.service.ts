import { Injectable, Optional } from '@nestjs/common';
import {
  BillingInterval,
  CustomerRole,
  PlanStatus,
  ScheduledPlanChangeType,
  StripeCheckoutPurpose,
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
import { StripeConfigService } from '../stripe/stripe-config.service';
import { InvoicesService } from '../invoices/invoices.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { PlansService } from '../plans/plans.service';
import { PricingService } from '../pricing/pricing.service';
import { BillingPaymentsService } from '../payments/billing-payments.service';
import { MetricsService } from '@/metrics/metrics.service';
import { priceForInterval } from '../shared/billing.util';
import { estimateProration, isDowngrade, isUpgrade } from '../shared/plan-change.util';
import { StripeNotificationsService } from '../stripe/stripe-notifications.service';

@Injectable()
export class CustomerSelfServiceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly providers: PaymentProviderRegistry,
    private readonly stripeConfig: StripeConfigService,
    private readonly invoicesService: InvoicesService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly plansService: PlansService,
    private readonly pricingService: PricingService,
    private readonly billingPaymentsService: BillingPaymentsService,
    private readonly stripeNotifications: StripeNotificationsService,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  async dashboard(actor: AuthenticatedCustomer) {
    this.assertView(actor);
    const subscription = await this.findCurrentSubscription(actor.companyId);
    const organisation = await this.prisma.customer.findUniqueOrThrow({
      where: { id: actor.companyId },
    });
    const plans = await this.plansService.list({ publicOnly: true });
    const invoices = await this.invoicesService.list({
      organisationId: actor.companyId,
      pageSize: 20,
    });
    const payments = await this.billingPaymentsService.list({
      organisationId: actor.companyId,
      pageSize: 20,
    });

    const cfg = this.stripeConfig.getConfig();
    const gracePeriodDays =
      subscription?.gracePeriodDaysOverride ?? cfg.gracePeriodDays;
    const renewalAmount = subscription
      ? priceForInterval(
          subscription.plan.monthlyPrice,
          subscription.plan.annualPrice,
          subscription.billingInterval,
        )
      : null;

    const upcomingInvoice = invoices.items.find((row) =>
      ['OPEN', 'DRAFT', 'OVERDUE'].includes(row.status),
    ) ?? null;

    const paymentMethod = await this.safePaymentMethod(actor.companyId);
    const comparison = this.buildComparison(
      plans.items,
      subscription?.billingInterval ?? BillingInterval.MONTHLY,
      subscription?.planId ?? null,
    );

    return {
      organisation: {
        id: organisation.id,
        companyName: organisation.companyName,
        billingEmail: organisation.billingEmail ?? organisation.email,
        invoiceRecipients: this.parseRecipients(organisation.invoiceRecipients),
        allowFinancePurchases: organisation.allowFinancePurchases,
        taxId: organisation.taxId,
        supportContact: process.env.SUPPORT_EMAIL ?? 'support@sfour.co.uk',
      },
      subscription: subscription
        ? {
            ...this.subscriptionsService.serialize(subscription),
            trialActive:
              subscription.status === SubscriptionStatus.TRIAL
              || Boolean(subscription.trialEndsAt && subscription.trialEndsAt > new Date()),
            renewalAmount,
            gracePeriodDays:
              subscription.status === SubscriptionStatus.PAST_DUE ? gracePeriodDays : null,
            pendingPlan: subscription.pendingPlan
              ? this.plansService.serialize(subscription.pendingPlan)
              : null,
            scheduledChangeType: subscription.scheduledChangeType,
            planChangeEffectiveAt: subscription.planChangeEffectiveAt?.toISOString() ?? null,
            cancellationReason: subscription.cancellationReason,
          }
        : null,
      plan: subscription ? this.plansService.serialize(subscription.plan) : null,
      paymentMethod,
      upcomingInvoice,
      invoices: invoices.items,
      payments: payments.items,
      features: subscription?.plan.includedFeatures ?? [],
      deviceEntitlements: subscription?.plan.maxDevices ?? null,
      planComparison: comparison,
      upgradeAvailable: Boolean(subscription && this.canMutate(actor) && !subscription.pendingCheckout),
      downgradeAvailable: Boolean(subscription && this.canMutate(actor) && !subscription.pendingCheckout),
      canCancel: Boolean(subscription && this.canMutate(actor)),
      canRenew: Boolean(subscription && this.canMutate(actor)),
      stripeCheckoutEnabled: cfg.enabled,
      termsVersion: cfg.currentTermsVersion,
      canPurchase: this.canMutate(actor),
    };
  }

  async comparePlans(actor: AuthenticatedCustomer) {
    this.assertView(actor);
    const subscription = await this.findCurrentSubscription(actor.companyId);
    const plans = await this.plansService.list({ publicOnly: true });
    return {
      currentPlanId: subscription?.planId ?? null,
      interval: subscription?.billingInterval ?? BillingInterval.MONTHLY,
      plans: this.buildComparison(
        plans.items,
        subscription?.billingInterval ?? BillingInterval.MONTHLY,
        subscription?.planId ?? null,
      ),
    };
  }

  async previewUpgrade(
    actor: AuthenticatedCustomer,
    dto: { planId: string; billingInterval?: BillingInterval },
  ) {
    await this.assertPurchase(actor);
    const subscription = await this.requireMutableSubscription(actor.companyId);
    const target = await this.requirePublicPlan(dto.planId);
    const interval = dto.billingInterval ?? subscription.billingInterval;
    if (!isUpgrade(subscription.plan, target)) {
      throw new ApiException(ERROR_CODES.BILLING_UPGRADE_INVALID, 'Target plan is not an upgrade', 400);
    }
    const estimate = estimateProration({
      currentMonthly: subscription.plan.monthlyPrice,
      currentAnnual: subscription.plan.annualPrice,
      targetMonthly: target.monthlyPrice,
      targetAnnual: target.annualPrice,
      interval,
      periodStart: subscription.currentPeriodStart,
      periodEnd: subscription.currentPeriodEnd,
    });
    return {
      currentPlan: this.plansService.serialize(subscription.plan),
      targetPlan: this.plansService.serialize(target),
      billingInterval: interval,
      effectiveDate: new Date().toISOString(),
      featureComparison: {
        current: subscription.plan.includedFeatures,
        target: target.includedFeatures,
        added: (target.includedFeatures as string[]).filter(
          (f) => !(subscription.plan.includedFeatures as string[]).includes(f),
        ),
      },
      deviceIncrease: target.maxDevices - subscription.plan.maxDevices,
      estimate,
    };
  }

  async confirmUpgrade(
    actor: AuthenticatedCustomer,
    dto: { planId: string; billingInterval?: BillingInterval; acceptedTermsVersion: string },
  ) {
    await this.assertPurchase(actor);
    this.assertTerms(dto.acceptedTermsVersion);
    const subscription = await this.requireMutableSubscription(actor.companyId);
    if (subscription.scheduledChangeType || subscription.pendingPlanId) {
      throw new ApiException(ERROR_CODES.BILLING_CHANGE_PENDING, 'A plan change is already pending', 409);
    }
    const target = await this.requirePublicPlan(dto.planId);
    const interval = dto.billingInterval ?? subscription.billingInterval;
    if (!isUpgrade(subscription.plan, target)) {
      throw new ApiException(ERROR_CODES.BILLING_UPGRADE_INVALID, 'Target plan is not an upgrade', 400);
    }

    const estimate = estimateProration({
      currentMonthly: subscription.plan.monthlyPrice,
      currentAnnual: subscription.plan.annualPrice,
      targetMonthly: target.monthlyPrice,
      targetAnnual: target.annualPrice,
      interval,
      periodStart: subscription.currentPeriodStart,
      periodEnd: subscription.currentPeriodEnd,
    });

    await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        pendingPlanId: target.id,
        pendingBillingInterval: interval,
        scheduledChangeType: ScheduledPlanChangeType.UPGRADE,
        planChangeEffectiveAt: new Date(),
      },
    });

    if (estimate.prorationAmount <= 0) {
      await this.subscriptionsService.applyCustomerPlanChange(subscription.id, {
        planId: target.id,
        billingInterval: interval,
        reason: 'upgrade_zero_proration',
      });
      await this.syncStripePrice(subscription.id, target.id, interval);
      await this.stripeNotifications.notifyPlanUpgraded({
        organisationId: actor.companyId,
        subscriptionId: subscription.id,
        planCode: target.code,
      });
      return { appliedImmediately: true, checkoutSessionId: null, checkoutUrl: null, expiresAt: null };
    }

    return this.createPurposeCheckout(actor, {
      purpose: StripeCheckoutPurpose.UPGRADE,
      subscriptionId: subscription.id,
      planId: target.id,
      billingInterval: interval,
      amountMinor: estimate.prorationAmount,
      currency: target.currency,
      description: `Upgrade to ${target.name}`,
      idempotencySeed: `upgrade_${subscription.id}_${target.id}_${interval}`,
    });
  }

  async scheduleDowngrade(
    actor: AuthenticatedCustomer,
    dto: { planId: string; billingInterval?: BillingInterval },
  ) {
    await this.assertPurchase(actor);
    const subscription = await this.requireMutableSubscription(actor.companyId);
    if (subscription.scheduledChangeType || subscription.pendingPlanId) {
      throw new ApiException(ERROR_CODES.BILLING_CHANGE_PENDING, 'A plan change is already pending', 409);
    }
    const target = await this.requirePublicPlan(dto.planId);
    const interval = dto.billingInterval ?? subscription.billingInterval;
    if (!isDowngrade(subscription.plan, target)) {
      throw new ApiException(ERROR_CODES.BILLING_DOWNGRADE_INVALID, 'Target plan is not a downgrade', 400);
    }
    const effectiveAt = subscription.currentPeriodEnd ?? new Date();
    const updated = await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        pendingPlanId: target.id,
        pendingBillingInterval: interval,
        scheduledChangeType: ScheduledPlanChangeType.DOWNGRADE,
        planChangeEffectiveAt: effectiveAt,
      },
      include: { plan: true, pendingPlan: true, organisation: true },
    });

    await this.syncStripePrice(subscription.id, target.id, interval, 'none');
    await this.auditService.record({
      actorCustomerUserId: actor.sub,
      action: 'billing.downgrade_scheduled',
      entityType: 'Subscription',
      entityId: subscription.id,
      customerId: actor.companyId,
      metadata: { pendingPlanId: target.id, effectiveAt: effectiveAt.toISOString() },
    });
    await this.stripeNotifications.notifyPlanDowngradeScheduled({
      organisationId: actor.companyId,
      subscriptionId: subscription.id,
      planCode: target.code,
      effectiveAt,
    });
    return this.subscriptionsService.serialize(updated);
  }

  async cancelScheduledChange(actor: AuthenticatedCustomer) {
    await this.assertPurchase(actor);
    const subscription = await this.requireMutableSubscription(actor.companyId);
    if (!subscription.pendingPlanId) {
      throw new ApiException(ERROR_CODES.BILLING_CHANGE_PENDING, 'No scheduled plan change', 400);
    }
    const updated = await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        pendingPlanId: null,
        pendingBillingInterval: null,
        planChangeEffectiveAt: null,
        scheduledChangeType: null,
      },
      include: { plan: true, organisation: true },
    });
    await this.syncStripePrice(subscription.id, subscription.planId, subscription.billingInterval, 'none');
    await this.auditService.record({
      actorCustomerUserId: actor.sub,
      action: 'billing.plan_change_cancelled',
      entityType: 'Subscription',
      entityId: subscription.id,
      customerId: actor.companyId,
    });
    return this.subscriptionsService.serialize(updated);
  }

  async renew(actor: AuthenticatedCustomer, dto: { acceptedTermsVersion: string }) {
    await this.assertPurchase(actor);
    this.assertTerms(dto.acceptedTermsVersion);
    const subscription = await this.requireMutableSubscription(actor.companyId);
    if (
      subscription.status !== SubscriptionStatus.ACTIVE
      && subscription.status !== SubscriptionStatus.PAST_DUE
      && subscription.status !== SubscriptionStatus.TRIAL
    ) {
      throw new ApiException(ERROR_CODES.BILLING_RENEWAL_INVALID, 'Subscription cannot be renewed', 400);
    }
    if (subscription.cancelAtPeriodEnd) {
      throw new ApiException(
        ERROR_CODES.BILLING_RENEWAL_INVALID,
        'Undo cancellation before renewing',
        400,
      );
    }

    const amount = priceForInterval(
      subscription.plan.monthlyPrice,
      subscription.plan.annualPrice,
      subscription.billingInterval,
    );
    const invoice = await this.invoicesService.createForSubscription(subscription.id);
    return this.createPurposeCheckout(actor, {
      purpose: StripeCheckoutPurpose.RENEWAL,
      subscriptionId: subscription.id,
      planId: subscription.planId,
      billingInterval: subscription.billingInterval,
      amountMinor: amount,
      currency: subscription.plan.currency,
      description: `Renew ${subscription.plan.name}`,
      invoiceId: invoice.id,
      idempotencySeed: `renew_${subscription.id}_${invoice.id}`,
    });
  }

  async cancel(
    actor: AuthenticatedCustomer,
    dto: { atPeriodEnd?: boolean; reason?: string },
  ) {
    await this.assertPurchase(actor);
    const subscription = await this.requireMutableSubscription(actor.companyId);
    const atPeriodEnd = dto.atPeriodEnd !== false;
    const allowImmediate =
      subscription.status === SubscriptionStatus.TRIAL
      || subscription.status === SubscriptionStatus.PAST_DUE
      || process.env.BILLING_ALLOW_IMMEDIATE_CANCEL === 'true';
    if (!atPeriodEnd && !allowImmediate) {
      throw new ApiException(
        ERROR_CODES.BILLING_CANCEL_INVALID,
        'Immediate cancellation is not allowed for this subscription; cancel at period end instead',
        400,
      );
    }

    const updated = await this.subscriptionsService.cancelFromCustomer(subscription.id, {
      atPeriodEnd,
      reason: dto.reason,
    });

    const mapping = await this.prisma.stripeSubscriptionMapping.findUnique({
      where: { subscriptionId: subscription.id },
    });
    if (mapping && this.stripeConfig.getConfig().enabled) {
      const stripe = this.providers.getStripe();
      if (atPeriodEnd) {
        await stripe.setSubscriptionCancelAtPeriodEnd({
          stripeSubscriptionId: mapping.stripeSubscriptionId,
          cancelAtPeriodEnd: true,
          idempotencyKey: `cancel_pe_${subscription.id}`,
        });
      } else {
        await stripe.cancelSubscriptionNow({
          stripeSubscriptionId: mapping.stripeSubscriptionId,
          idempotencyKey: `cancel_now_${subscription.id}`,
        });
      }
    }

    await this.stripeNotifications.notifyCancellationConfirmed({
      organisationId: actor.companyId,
      subscriptionId: subscription.id,
      atPeriodEnd,
      endDate: updated.currentPeriodEnd,
    });

    return {
      subscription: updated,
      remainingAccessUntil: updated.currentPeriodEnd ?? null,
      licenceExpiry: updated.currentPeriodEnd ?? null,
    };
  }

  async undoCancel(actor: AuthenticatedCustomer) {
    await this.assertPurchase(actor);
    const subscription = await this.requireMutableSubscription(actor.companyId);
    if (!subscription.cancelAtPeriodEnd) {
      throw new ApiException(ERROR_CODES.BILLING_CANCEL_INVALID, 'No pending cancellation to undo', 400);
    }
    const updated = await this.subscriptionsService.resumeFromCustomer(subscription.id);
    const mapping = await this.prisma.stripeSubscriptionMapping.findUnique({
      where: { subscriptionId: subscription.id },
    });
    if (mapping && this.stripeConfig.getConfig().enabled) {
      await this.providers.getStripe().setSubscriptionCancelAtPeriodEnd({
        stripeSubscriptionId: mapping.stripeSubscriptionId,
        cancelAtPeriodEnd: false,
        idempotencyKey: `undo_cancel_${subscription.id}`,
      });
    }
    return updated;
  }

  async paymentMethod(actor: AuthenticatedCustomer) {
    this.assertView(actor);
    return {
      paymentMethod: await this.safePaymentMethod(actor.companyId),
      portalAvailable: this.stripeConfig.getConfig().enabled,
    };
  }

  async openPaymentPortal(actor: AuthenticatedCustomer) {
    this.assertView(actor);
    const cfg = this.stripeConfig.assertReadyForCheckout();
    const livemode = this.stripeConfig.getMode() === 'LIVE';
    const mapping = await this.prisma.stripeCustomerMapping.findUnique({
      where: { organisationId_livemode: { organisationId: actor.companyId, livemode } },
    });
    if (!mapping) {
      throw new ApiException(ERROR_CODES.STRIPE_CUSTOMER_NOT_FOUND, 'No Stripe customer', 404);
    }
    const portal = await this.providers.getStripe().createBillingPortalSession({
      stripeCustomerId: mapping.stripeCustomerId,
      returnUrl: cfg.portalReturnUrl,
      flow: 'payment_method_update',
    });
    return { url: portal.url };
  }

  async getSettings(actor: AuthenticatedCustomer) {
    this.assertManageSettings(actor);
    const org = await this.prisma.customer.findUniqueOrThrow({ where: { id: actor.companyId } });
    return {
      billingEmail: org.billingEmail ?? org.email,
      invoiceRecipients: this.parseRecipients(org.invoiceRecipients),
      allowFinancePurchases: org.allowFinancePurchases,
      taxId: org.taxId,
    };
  }

  async updateSettings(
    actor: AuthenticatedCustomer,
    dto: {
      billingEmail?: string;
      invoiceRecipients?: string[];
      allowFinancePurchases?: boolean;
      taxId?: string | null;
    },
  ) {
    this.assertManageSettings(actor);
    const updated = await this.prisma.customer.update({
      where: { id: actor.companyId },
      data: {
        billingEmail: dto.billingEmail,
        invoiceRecipients: dto.invoiceRecipients ?? undefined,
        allowFinancePurchases: dto.allowFinancePurchases,
        taxId: dto.taxId === undefined ? undefined : dto.taxId,
      },
    });
    await this.auditService.record({
      actorCustomerUserId: actor.sub,
      action: 'billing.settings_updated',
      entityType: 'Customer',
      entityId: actor.companyId,
      customerId: actor.companyId,
    });
    return {
      billingEmail: updated.billingEmail ?? updated.email,
      invoiceRecipients: this.parseRecipients(updated.invoiceRecipients),
      allowFinancePurchases: updated.allowFinancePurchases,
      taxId: updated.taxId,
    };
  }

  private async createPurposeCheckout(
    actor: AuthenticatedCustomer,
    input: {
      purpose: StripeCheckoutPurpose;
      subscriptionId: string;
      planId: string;
      billingInterval: BillingInterval;
      amountMinor: number;
      currency: string;
      description: string;
      invoiceId?: string;
      idempotencySeed: string;
    },
  ) {
    const cfg = this.stripeConfig.assertReadyForCheckout();
    const livemode = this.stripeConfig.getMode() === 'LIVE';
    const open = await this.prisma.stripeCheckoutSession.findFirst({
      where: {
        organisationId: actor.companyId,
        status: StripeCheckoutSessionStatus.OPEN,
        purpose: input.purpose,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    });
    if (open) {
      throw new ApiException(ERROR_CODES.STRIPE_CHECKOUT_EXISTS, 'An open checkout session already exists', 409);
    }

    const org = await this.prisma.customer.findUniqueOrThrow({ where: { id: actor.companyId } });
    const stripe = this.providers.getStripe();
    let customerMapping = await this.prisma.stripeCustomerMapping.findUnique({
      where: { organisationId_livemode: { organisationId: actor.companyId, livemode } },
    });
    if (!customerMapping) {
      const created = await stripe.createCustomer({
        email: actor.email || org.email,
        name: org.companyName,
        metadata: { organisationId: org.id, internalCustomerReference: org.id },
        idempotencyKey: `cust_${org.id}_${livemode ? 'live' : 'test'}`,
      });
      customerMapping = await this.prisma.stripeCustomerMapping.create({
        data: {
          organisationId: org.id,
          stripeCustomerId: created.providerCustomerId,
          livemode: created.livemode,
        },
      });
    }

    const idempotencyKey = createHash('sha256').update(input.idempotencySeed).digest('hex').slice(0, 48);
    const session = await stripe.createPaymentCheckoutSession({
      organisationId: actor.companyId,
      stripeCustomerId: customerMapping.stripeCustomerId,
      amountMinor: input.amountMinor,
      currency: input.currency,
      description: input.description,
      successUrl: cfg.successUrl,
      cancelUrl: cfg.cancelUrl,
      clientReferenceId: input.subscriptionId,
      idempotencyKey: `${input.purpose.toLowerCase()}_${idempotencyKey}`,
      metadata: {
        purpose: input.purpose,
        organisationId: actor.companyId,
        internalSubscriptionId: input.subscriptionId,
        internalInvoiceId: input.invoiceId ?? '',
        planId: input.planId,
        billingInterval: input.billingInterval,
      },
    });

    const stored = await this.prisma.stripeCheckoutSession.create({
      data: {
        organisationId: actor.companyId,
        internalSubscriptionId: input.subscriptionId,
        internalInvoiceId: input.invoiceId,
        stripeCheckoutSessionId: session.providerSessionId,
        purpose: input.purpose,
        status: StripeCheckoutSessionStatus.OPEN,
        expiresAt: session.expiresAt,
        livemode: session.livemode,
        acceptedTermsVersion: cfg.currentTermsVersion,
        idempotencyKey,
      },
    });

    this.metrics?.increment('stripeCheckoutCreated');
    await this.auditService.record({
      actorCustomerUserId: actor.sub,
      action: 'stripe.checkout.created',
      entityType: 'StripeCheckoutSession',
      entityId: stored.id,
      customerId: actor.companyId,
      metadata: { purpose: input.purpose, stripeCheckoutSessionId: stored.stripeCheckoutSessionId },
    });

    return {
      appliedImmediately: false,
      checkoutSessionId: stored.stripeCheckoutSessionId,
      checkoutUrl: session.url,
      expiresAt: stored.expiresAt?.toISOString() ?? null,
    };
  }

  private async syncStripePrice(
    subscriptionId: string,
    planId: string,
    interval: BillingInterval,
    prorationBehavior: 'none' | 'create_prorations' | 'always_invoice' = 'none',
  ) {
    if (!this.stripeConfig.getConfig().enabled) return;
    const mapping = await this.prisma.stripeSubscriptionMapping.findUnique({
      where: { subscriptionId },
    });
    if (!mapping) return;
    const livemode = this.stripeConfig.getMode() === 'LIVE';
    const price = await this.prisma.stripePriceMapping.findUnique({
      where: { planId_billingInterval_livemode: { planId, billingInterval: interval, livemode } },
    });
    if (!price?.active) return;
    await this.providers.getStripe().updateSubscriptionPrice({
      stripeSubscriptionId: mapping.stripeSubscriptionId,
      stripePriceId: price.stripePriceId,
      prorationBehavior,
      idempotencyKey: `price_${subscriptionId}_${price.stripePriceId}`,
    });
  }

  private async safePaymentMethod(organisationId: string) {
    try {
      if (!this.stripeConfig.getConfig().enabled) return null;
      const livemode = this.stripeConfig.getMode() === 'LIVE';
      const mapping = await this.prisma.stripeCustomerMapping.findUnique({
        where: { organisationId_livemode: { organisationId, livemode } },
      });
      if (!mapping) return null;
      return await this.providers.getStripe().retrieveDefaultPaymentMethod(mapping.stripeCustomerId);
    } catch {
      return null;
    }
  }

  private buildComparison(
    plans: Array<{
      id: string;
      code: string;
      name: string;
      monthlyPrice: number;
      annualPrice: number;
      currency: string;
      maxDevices: number;
      supportLevel: string;
      includedFeatures: unknown;
      sortOrder: number;
    }>,
    interval: BillingInterval,
    currentPlanId: string | null,
  ) {
    const ranked = [...plans].sort((a, b) => a.sortOrder - b.sortOrder);
    const recommendedCode = 'PROFESSIONAL';
    return ranked.map((plan) => {
      const quote = this.pricingService.quote(plan, interval);
      return {
        id: plan.id,
        code: plan.code,
        name: plan.name,
        ...quote,
        maxDevices: plan.maxDevices,
        supportLevel: plan.supportLevel,
        features: plan.includedFeatures,
        isCurrent: plan.id === currentPlanId,
        isRecommended: plan.code === recommendedCode,
      };
    });
  }

  private async findCurrentSubscription(organisationId: string) {
    return this.prisma.subscription.findFirst({
      where: {
        organisationId,
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
      include: { plan: true, pendingPlan: true, organisation: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async requireMutableSubscription(organisationId: string) {
    const subscription = await this.findCurrentSubscription(organisationId);
    if (!subscription || subscription.pendingCheckout) {
      throw new ApiException(ERROR_CODES.SUBSCRIPTION_NOT_FOUND, 'No active subscription', 404);
    }
    if (
      subscription.status === SubscriptionStatus.CANCELLED
      || subscription.status === SubscriptionStatus.EXPIRED
      || subscription.status === SubscriptionStatus.SUSPENDED
    ) {
      throw new ApiException(ERROR_CODES.SUBSCRIPTION_INVALID_STATE, 'Subscription is not mutable', 400);
    }
    return subscription;
  }

  private async requirePublicPlan(planId: string) {
    const plan = await this.prisma.plan.findUnique({ where: { id: planId } });
    if (!plan || plan.status !== PlanStatus.ACTIVE || !plan.isPublic) {
      throw new ApiException(ERROR_CODES.PLAN_NOT_ACTIVE, 'Plan is not available', 400);
    }
    return plan;
  }

  private assertView(actor: AuthenticatedCustomer) {
    if (!roleHasPermission(actor.role, CustomerPermission.VIEW_BILLING)) {
      throw new ApiException(ERROR_CODES.CUSTOMER_PERMISSION_DENIED, 'Billing access denied', 403);
    }
  }

  private async assertPurchase(actor: AuthenticatedCustomer) {
    if (!this.canMutate(actor)) {
      throw new ApiException(ERROR_CODES.CUSTOMER_PERMISSION_DENIED, 'Purchase not permitted', 403);
    }
    if (!actor.emailVerified) {
      throw new ApiException(ERROR_CODES.CUSTOMER_EMAIL_NOT_VERIFIED, 'Email must be verified', 403);
    }
    if (actor.role === CustomerRole.FINANCE) {
      const org = await this.prisma.customer.findUnique({
        where: { id: actor.companyId },
        select: { allowFinancePurchases: true },
      });
      if (!org?.allowFinancePurchases) {
        throw new ApiException(
          ERROR_CODES.CUSTOMER_PERMISSION_DENIED,
          'Finance purchases are disabled for this organisation',
          403,
        );
      }
    }
  }

  private assertManageSettings(actor: AuthenticatedCustomer) {
    if (actor.role !== CustomerRole.OWNER && actor.role !== CustomerRole.ADMINISTRATOR) {
      throw new ApiException(ERROR_CODES.BILLING_SETTINGS_FORBIDDEN, 'Only owners/admins can manage billing settings', 403);
    }
  }

  private canMutate(actor: AuthenticatedCustomer): boolean {
    if (!roleHasPermission(actor.role, CustomerPermission.PURCHASE_BILLING)) {
      return false;
    }
    return true;
  }

  private assertTerms(version: string) {
    const cfg = this.stripeConfig.getConfig();
    if (version !== cfg.currentTermsVersion) {
      throw new ApiException(ERROR_CODES.STRIPE_TERMS_REQUIRED, 'Accept the current terms version', 400);
    }
  }

  private parseRecipients(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value.filter((entry): entry is string => typeof entry === 'string');
    }
    return [];
  }
}
