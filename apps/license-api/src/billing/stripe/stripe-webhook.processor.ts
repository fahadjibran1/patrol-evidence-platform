import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  BillingPaymentStatus,
  InvoiceStatus,
  PaymentProvider,
  Prisma,
  StripeCheckoutSessionStatus,
  StripeReconciliationAlertStatus,
  StripeWebhookProcessingStatus,
} from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { AuditService } from '@/audit/audit.service';
import { PaymentProviderRegistry } from '../providers/payment-provider.registry';
import { StripeConfigService } from './stripe-config.service';
import { BillingPaymentsService } from '../payments/billing-payments.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { InvoicesService } from '../invoices/invoices.service';
import { MetricsService } from '@/metrics/metrics.service';
import { StripeNotificationsService } from './stripe-notifications.service';

const AUTHORITATIVE_TYPES = new Set([
  'checkout.session.completed',
  'checkout.session.expired',
  'invoice.paid',
  'invoice.payment_failed',
  'invoice.payment_action_required',
  'customer.subscription.deleted',
  'customer.subscription.updated',
  'customer.subscription.created',
  'invoice.created',
  'invoice.finalized',
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'charge.refunded',
  'charge.dispute.created',
]);

@Injectable()
export class StripeWebhookProcessor {
  private readonly logger = new Logger(StripeWebhookProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly providers: PaymentProviderRegistry,
    private readonly stripeConfig: StripeConfigService,
    private readonly payments: BillingPaymentsService,
    private readonly subscriptions: SubscriptionsService,
    private readonly invoices: InvoicesService,
    private readonly stripeNotifications: StripeNotificationsService,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  async processStoredEvent(webhookEventId: string): Promise<void> {
    const started = Date.now();
    const event = await this.prisma.stripeWebhookEvent.findUnique({ where: { id: webhookEventId } });
    if (!event) {
      return;
    }
    if (
      event.processingStatus === StripeWebhookProcessingStatus.PROCESSED
      || event.processingStatus === StripeWebhookProcessingStatus.IGNORED
    ) {
      return;
    }

    await this.prisma.stripeWebhookEvent.update({
      where: { id: webhookEventId },
      data: {
        processingStatus: StripeWebhookProcessingStatus.PROCESSING,
        attempts: { increment: 1 },
      },
    });

    try {
      if (!AUTHORITATIVE_TYPES.has(event.type)) {
        await this.finish(webhookEventId, StripeWebhookProcessingStatus.IGNORED);
        return;
      }

      switch (event.type) {
        case 'checkout.session.completed':
          await this.handleCheckoutCompleted(event.stripeEventId, event.metadata as Record<string, unknown>);
          break;
        case 'checkout.session.expired':
          await this.handleCheckoutExpired(event.metadata as Record<string, unknown>);
          break;
        case 'invoice.paid':
          await this.handleInvoicePaid(event.metadata as Record<string, unknown>);
          break;
        case 'invoice.payment_failed':
          await this.handleInvoicePaymentFailed(event.metadata as Record<string, unknown>);
          break;
        case 'invoice.payment_action_required':
          await this.handlePaymentActionRequired(event.metadata as Record<string, unknown>);
          break;
        case 'customer.subscription.deleted':
          await this.handleSubscriptionDeleted(event.metadata as Record<string, unknown>);
          break;
        case 'customer.subscription.updated':
        case 'customer.subscription.created':
          await this.handleSubscriptionSync(event.metadata as Record<string, unknown>);
          break;
        case 'charge.refunded':
        case 'charge.dispute.created':
        case 'invoice.created':
        case 'invoice.finalized':
        case 'payment_intent.succeeded':
        case 'payment_intent.payment_failed':
          // Informational / handled via invoice.paid for activation
          break;
        default:
          await this.finish(webhookEventId, StripeWebhookProcessingStatus.IGNORED);
          return;
      }

      await this.finish(webhookEventId, StripeWebhookProcessingStatus.PROCESSED);
      await this.auditService.record({
        action: 'stripe.webhook.processed',
        entityType: 'StripeWebhookEvent',
        entityId: webhookEventId,
        metadata: {
          type: event.type,
          durationMs: Date.now() - started,
          attempts: event.attempts + 1,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Webhook processing failed: ${message}`);
      this.metrics?.increment('stripeWebhookFailed');

      const maxAttempts = this.stripeConfig.getConfig().webhookMaxAttempts;
      const attempts = event.attempts + 1;
      const dead = attempts >= maxAttempts;
      await this.prisma.stripeWebhookEvent.update({
        where: { id: webhookEventId },
        data: {
          processingStatus: dead
            ? StripeWebhookProcessingStatus.DEAD_LETTER
            : StripeWebhookProcessingStatus.FAILED,
          lastError: message.slice(0, 2000),
        },
      });
      if (dead) {
        this.metrics?.increment('stripeWebhookDeadLetter');
        await this.stripeNotifications.notifyAdminDeadLetter({
          eventId: webhookEventId,
          type: event.type,
          error: message,
        });
      }
      await this.auditService.record({
        action: 'stripe.webhook.failed',
        entityType: 'StripeWebhookEvent',
        entityId: webhookEventId,
        metadata: { type: event.type, error: message, dead },
      });
      if (!dead) {
        throw error;
      }
    }
  }

  private async finish(id: string, status: StripeWebhookProcessingStatus) {
    await this.prisma.stripeWebhookEvent.update({
      where: { id },
      data: {
        processingStatus: status,
        processedAt: new Date(),
        lastError: null,
      },
    });
  }

  private async handleCheckoutCompleted(
    _stripeEventId: string,
    meta: Record<string, unknown>,
  ) {
    const sessionId = typeof meta.objectId === 'string' ? meta.objectId : null;
    if (!sessionId) {
      return;
    }

    const stripe = this.providers.getStripe();
    const session = await stripe.retrieveCheckoutSession(sessionId);
    const stored = await this.prisma.stripeCheckoutSession.findUnique({
      where: { stripeCheckoutSessionId: sessionId },
    });
    const purpose = session.metadata.purpose || stored?.purpose || 'INITIAL';
    const internalSubscriptionId =
      session.metadata.internalSubscriptionId || stored?.internalSubscriptionId || null;
    const internalInvoiceId =
      session.metadata.internalInvoiceId || stored?.internalInvoiceId || null;

    if (!internalSubscriptionId) {
      await this.raiseAlert({
        alertType: 'CHECKOUT_MISSING_INTERNAL_REFS',
        message: `Checkout ${sessionId} missing internal subscription`,
        stripeObjectId: sessionId,
      });
      throw new Error('Checkout session missing internal references');
    }

    await this.prisma.stripeCheckoutSession.updateMany({
      where: { stripeCheckoutSessionId: sessionId },
      data: {
        status: StripeCheckoutSessionStatus.COMPLETE,
        completedAt: new Date(),
      },
    });

    if (purpose === 'UPGRADE') {
      await this.handleUpgradeCheckoutCompleted(session, internalSubscriptionId);
      return;
    }
    if (purpose === 'RENEWAL') {
      await this.handleRenewalCheckoutCompleted(session, internalSubscriptionId, internalInvoiceId);
      return;
    }

    if (!internalInvoiceId) {
      throw new Error('Checkout session missing internal invoice');
    }
    if (!session.subscriptionId) {
      throw new Error('Checkout completed without Stripe subscription');
    }

    const providerSub = await stripe.retrieveSubscription(session.subscriptionId);
    const providerInvoice = providerSub.latestInvoiceId
      ? await stripe.retrieveInvoice(providerSub.latestInvoiceId)
      : null;

    const invoice = await this.prisma.invoice.findUnique({
      where: { id: internalInvoiceId },
      include: { subscription: { include: { plan: true } } },
    });
    if (!invoice) {
      throw new Error('Internal invoice not found');
    }

    if (providerInvoice) {
      const amountOk = providerInvoice.amountPaid === invoice.total;
      const currencyOk = providerInvoice.currency === invoice.currency.toUpperCase();
      if (!amountOk || !currencyOk) {
        this.metrics?.increment('stripeReconciliationMismatch');
        await this.raiseAlert({
          organisationId: invoice.subscription.organisationId,
          alertType: 'AMOUNT_OR_CURRENCY_MISMATCH',
          message: `Stripe invoice ${providerInvoice.providerInvoiceId} amount/currency mismatch`,
          stripeObjectId: providerInvoice.providerInvoiceId,
          internalRef: invoice.id,
          metadata: {
            expectedAmount: invoice.total,
            actualAmount: providerInvoice.amountPaid,
            expectedCurrency: invoice.currency,
            actualCurrency: providerInvoice.currency,
          },
        });
        await this.stripeNotifications.notifyAdminReconciliation({
          organisationId: invoice.subscription.organisationId,
          alertType: 'AMOUNT_OR_CURRENCY_MISMATCH',
          message: `Stripe invoice ${providerInvoice.providerInvoiceId} amount/currency mismatch`,
        });
        throw new Error('Reconciliation mismatch — activation blocked');
      }

      const paymentRef = providerInvoice.paymentIntentId ?? providerInvoice.providerInvoiceId;
      const { created } = await this.payments.recordProviderPayment({
        invoiceId: invoice.id,
        provider: PaymentProvider.STRIPE,
        providerReference: paymentRef,
        amount: providerInvoice.amountPaid,
        currency: providerInvoice.currency,
        status: BillingPaymentStatus.SUCCEEDED,
      });
      if (created) {
        this.metrics?.increment('stripePaymentSucceeded');
        await this.stripeNotifications.notifyPaymentSucceeded({
          organisationId: invoice.subscription.organisationId,
          subscriptionId: internalSubscriptionId,
          invoiceId: invoice.id,
          amount: providerInvoice.amountPaid,
          currency: providerInvoice.currency,
        });
      }
    }

    await this.prisma.stripeSubscriptionMapping.upsert({
      where: { subscriptionId: internalSubscriptionId },
      create: {
        subscriptionId: internalSubscriptionId,
        stripeSubscriptionId: providerSub.providerSubscriptionId,
        stripeCustomerId: providerSub.providerCustomerId,
        latestStripeInvoiceId: providerSub.latestInvoiceId,
        livemode: providerSub.livemode,
      },
      update: {
        stripeSubscriptionId: providerSub.providerSubscriptionId,
        stripeCustomerId: providerSub.providerCustomerId,
        latestStripeInvoiceId: providerSub.latestInvoiceId,
        livemode: providerSub.livemode,
      },
    });

    const sub = await this.prisma.subscription.findUnique({ where: { id: internalSubscriptionId } });
    if (sub && sub.status !== 'ACTIVE') {
      await this.subscriptions.activateFromProvider(internalSubscriptionId, {
        periodStart: providerSub.currentPeriodStart ?? undefined,
        periodEnd: providerSub.currentPeriodEnd ?? undefined,
      });
      await this.stripeNotifications.notifySubscriptionActivated({
        organisationId: invoice.subscription.organisationId,
        subscriptionId: internalSubscriptionId,
      });
    }

    this.metrics?.increment('stripeCheckoutCompleted');
    await this.auditService.record({
      action: 'stripe.checkout.completed',
      entityType: 'Subscription',
      entityId: internalSubscriptionId,
      customerId: invoice.subscription.organisationId,
      metadata: {
        stripeCheckoutSessionId: sessionId,
        stripeSubscriptionId: providerSub.providerSubscriptionId,
        purpose: 'INITIAL',
      },
    });
  }

  private async handleUpgradeCheckoutCompleted(
    session: {
      providerSessionId: string;
      amountTotal: number | null;
      metadata: Record<string, string>;
      paymentStatus: string | null;
    },
    internalSubscriptionId: string,
  ) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id: internalSubscriptionId },
      include: { plan: true, pendingPlan: true, organisation: true },
    });
    if (!subscription?.pendingPlanId || subscription.scheduledChangeType !== 'UPGRADE') {
      throw new Error('Upgrade checkout completed without pending upgrade');
    }
    if (session.paymentStatus && session.paymentStatus !== 'paid') {
      throw new Error('Upgrade checkout not paid');
    }

    const planId = session.metadata.planId || subscription.pendingPlanId;
    const interval = (session.metadata.billingInterval as 'MONTHLY' | 'ANNUAL')
      || subscription.pendingBillingInterval
      || subscription.billingInterval;

    await this.subscriptions.applyCustomerPlanChange(internalSubscriptionId, {
      planId,
      billingInterval: interval,
      reason: 'customer_upgrade_checkout',
    });

    const livemode = this.stripeConfig.getMode() === 'LIVE';
    const price = await this.prisma.stripePriceMapping.findUnique({
      where: {
        planId_billingInterval_livemode: {
          planId,
          billingInterval: interval,
          livemode,
        },
      },
    });
    const mapping = await this.prisma.stripeSubscriptionMapping.findUnique({
      where: { subscriptionId: internalSubscriptionId },
    });
    if (mapping && price?.active) {
      await this.providers.getStripe().updateSubscriptionPrice({
        stripeSubscriptionId: mapping.stripeSubscriptionId,
        stripePriceId: price.stripePriceId,
        prorationBehavior: 'none',
        idempotencyKey: `upgrade_apply_${internalSubscriptionId}_${price.stripePriceId}`,
      });
    }

    const plan = await this.prisma.plan.findUnique({ where: { id: planId } });
    await this.stripeNotifications.notifyPlanUpgraded({
      organisationId: subscription.organisationId,
      subscriptionId: internalSubscriptionId,
      planCode: plan?.code ?? planId,
    });
    this.metrics?.increment('stripeCheckoutCompleted');
    await this.auditService.record({
      action: 'stripe.checkout.completed',
      entityType: 'Subscription',
      entityId: internalSubscriptionId,
      customerId: subscription.organisationId,
      metadata: { purpose: 'UPGRADE', stripeCheckoutSessionId: session.providerSessionId },
    });
  }

  private async handleRenewalCheckoutCompleted(
    session: {
      providerSessionId: string;
      amountTotal: number | null;
      metadata: Record<string, string>;
      paymentStatus: string | null;
    },
    internalSubscriptionId: string,
    internalInvoiceId: string | null,
  ) {
    if (!internalInvoiceId) {
      throw new Error('Renewal checkout missing invoice');
    }
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: internalInvoiceId },
      include: { subscription: true },
    });
    if (!invoice) {
      throw new Error('Renewal invoice not found');
    }
    const amount = session.amountTotal ?? invoice.total;
    if (amount !== invoice.total) {
      this.metrics?.increment('stripeReconciliationMismatch');
      await this.raiseAlert({
        organisationId: invoice.subscription.organisationId,
        alertType: 'RENEWAL_AMOUNT_MISMATCH',
        message: `Renewal checkout amount mismatch for ${session.providerSessionId}`,
        stripeObjectId: session.providerSessionId,
        internalRef: invoice.id,
      });
      throw new Error('Renewal reconciliation mismatch');
    }

    const { created } = await this.payments.recordProviderPayment({
      invoiceId: invoice.id,
      provider: PaymentProvider.STRIPE,
      providerReference: `renewal_${session.providerSessionId}`,
      amount,
      currency: invoice.currency,
      status: BillingPaymentStatus.SUCCEEDED,
    });
    if (created) {
      this.metrics?.increment('stripePaymentSucceeded');
      await this.stripeNotifications.notifyPaymentSucceeded({
        organisationId: invoice.subscription.organisationId,
        subscriptionId: internalSubscriptionId,
        invoiceId: invoice.id,
        amount,
        currency: invoice.currency,
      });
    }

    await this.subscriptions.renewFromProvider(internalSubscriptionId);
    this.metrics?.increment('stripeCheckoutCompleted');
    await this.auditService.record({
      action: 'stripe.checkout.completed',
      entityType: 'Subscription',
      entityId: internalSubscriptionId,
      customerId: invoice.subscription.organisationId,
      metadata: { purpose: 'RENEWAL', stripeCheckoutSessionId: session.providerSessionId },
    });
  }

  private async handleCheckoutExpired(meta: Record<string, unknown>) {
    const sessionId = typeof meta.objectId === 'string' ? meta.objectId : null;
    if (!sessionId) return;
    const session = await this.prisma.stripeCheckoutSession.findUnique({
      where: { stripeCheckoutSessionId: sessionId },
    });
    if (!session) return;
    await this.prisma.stripeCheckoutSession.update({
      where: { id: session.id },
      data: { status: StripeCheckoutSessionStatus.EXPIRED },
    });
    if (session.internalSubscriptionId) {
      await this.prisma.subscription.updateMany({
        where: { id: session.internalSubscriptionId, pendingCheckout: true },
        data: { status: 'EXPIRED', pendingCheckout: false },
      });
    }
    await this.auditService.record({
      action: 'stripe.checkout.expired',
      entityType: 'StripeCheckoutSession',
      entityId: session.id,
      customerId: session.organisationId,
    });
    await this.stripeNotifications.notifyCheckoutExpired({
      organisationId: session.organisationId,
      sessionId,
    });
  }

  private async handleInvoicePaid(meta: Record<string, unknown>) {
    const stripeInvoiceId = typeof meta.objectId === 'string' ? meta.objectId : null;
    if (!stripeInvoiceId) return;
    const providerInvoice = await this.providers.getStripe().retrieveInvoice(stripeInvoiceId);
    if (!providerInvoice.providerSubscriptionId) return;

    const mapping = await this.prisma.stripeSubscriptionMapping.findUnique({
      where: { stripeSubscriptionId: providerInvoice.providerSubscriptionId },
      include: { subscription: { include: { plan: true, invoices: { orderBy: { createdAt: 'desc' }, take: 5 } } } },
    });
    if (!mapping) {
      // Initial purchase is handled by checkout.session.completed
      return;
    }

    await this.prisma.stripeSubscriptionMapping.update({
      where: { id: mapping.id },
      data: { latestStripeInvoiceId: providerInvoice.providerInvoiceId },
    });

    // Find open invoice or create one for renewal
    let invoice = mapping.subscription.invoices.find((i) => i.status !== 'PAID')
      ?? null;
    if (!invoice) {
      const created = await this.invoices.createForSubscription(mapping.subscriptionId);
      invoice = await this.prisma.invoice.findUnique({ where: { id: created.id } });
    }
    if (!invoice) return;

    if (
      providerInvoice.amountPaid !== invoice.total
      || providerInvoice.currency !== invoice.currency.toUpperCase()
    ) {
      this.metrics?.increment('stripeReconciliationMismatch');
      await this.raiseAlert({
        organisationId: mapping.subscription.organisationId,
        alertType: 'RENEWAL_AMOUNT_MISMATCH',
        message: `Renewal invoice mismatch for ${stripeInvoiceId}`,
        stripeObjectId: stripeInvoiceId,
        internalRef: invoice.id,
      });
      throw new Error('Renewal reconciliation mismatch');
    }

    const paymentRef = providerInvoice.paymentIntentId ?? providerInvoice.providerInvoiceId;
    const { created } = await this.payments.recordProviderPayment({
      invoiceId: invoice.id,
      provider: PaymentProvider.STRIPE,
      providerReference: paymentRef,
      amount: providerInvoice.amountPaid,
      currency: providerInvoice.currency,
      status: BillingPaymentStatus.SUCCEEDED,
    });
    if (created) {
      this.metrics?.increment('stripePaymentSucceeded');
    }

    const providerSub = await this.providers.getStripe().retrieveSubscription(
      providerInvoice.providerSubscriptionId,
    );
    // Initial activation may already be ACTIVE from checkout — renew advances period
    if (mapping.subscription.status === 'ACTIVE' || mapping.subscription.status === 'PAST_DUE') {
      await this.subscriptions.renewFromProvider(mapping.subscriptionId, {
        periodStart: providerSub.currentPeriodStart ?? undefined,
        periodEnd: providerSub.currentPeriodEnd ?? undefined,
      });
    } else if (mapping.subscription.pendingCheckout || mapping.subscription.status === 'TRIAL') {
      await this.subscriptions.activateFromProvider(mapping.subscriptionId, {
        periodStart: providerSub.currentPeriodStart ?? undefined,
        periodEnd: providerSub.currentPeriodEnd ?? undefined,
      });
    }
  }

  private async handleInvoicePaymentFailed(meta: Record<string, unknown>) {
    const stripeInvoiceId = typeof meta.objectId === 'string' ? meta.objectId : null;
    if (!stripeInvoiceId) return;
    const providerInvoice = await this.providers.getStripe().retrieveInvoice(stripeInvoiceId);
    if (!providerInvoice.providerSubscriptionId) return;
    const mapping = await this.prisma.stripeSubscriptionMapping.findUnique({
      where: { stripeSubscriptionId: providerInvoice.providerSubscriptionId },
    });
    if (!mapping) return;

    const openInvoice = await this.prisma.invoice.findFirst({
      where: {
        subscriptionId: mapping.subscriptionId,
        status: { in: [InvoiceStatus.OPEN, InvoiceStatus.OVERDUE] },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (openInvoice) {
      await this.payments.recordProviderPayment({
        invoiceId: openInvoice.id,
        provider: PaymentProvider.STRIPE,
        providerReference: `failed_${providerInvoice.paymentIntentId ?? providerInvoice.providerInvoiceId}`,
        amount: providerInvoice.amountDue,
        currency: providerInvoice.currency,
        status: BillingPaymentStatus.FAILED,
      });
      this.metrics?.increment('stripePaymentFailed');
    }

    await this.subscriptions.markPastDue(mapping.subscriptionId, 'stripe.invoice.payment_failed');
    const gracePeriodDays = this.stripeConfig.getConfig().gracePeriodDays;
    await this.auditService.record({
      action: 'stripe.payment.failed',
      entityType: 'Subscription',
      entityId: mapping.subscriptionId,
      metadata: { stripeInvoiceId, gracePeriodDays },
    });
    const sub = await this.prisma.subscription.findUnique({
      where: { id: mapping.subscriptionId },
      select: { organisationId: true },
    });
    if (sub) {
      await this.stripeNotifications.notifyPaymentFailed({
        organisationId: sub.organisationId,
        subscriptionId: mapping.subscriptionId,
        stripeInvoiceId,
        gracePeriodDays,
      });
    }
  }

  private async handlePaymentActionRequired(meta: Record<string, unknown>) {
    const stripeInvoiceId = typeof meta.objectId === 'string' ? meta.objectId : null;
    if (!stripeInvoiceId) return;
    await this.raiseAlert({
      alertType: 'PAYMENT_ACTION_REQUIRED',
      message: `Payment action required for Stripe invoice ${stripeInvoiceId}`,
      stripeObjectId: stripeInvoiceId,
    });
    const providerInvoice = await this.providers.getStripe().retrieveInvoice(stripeInvoiceId);
    if (!providerInvoice.providerSubscriptionId) return;
    const mapping = await this.prisma.stripeSubscriptionMapping.findUnique({
      where: { stripeSubscriptionId: providerInvoice.providerSubscriptionId },
      include: { subscription: { select: { organisationId: true } } },
    });
    if (mapping) {
      await this.stripeNotifications.notifyPaymentActionRequired({
        organisationId: mapping.subscription.organisationId,
        stripeInvoiceId,
      });
    }
  }

  private async handleSubscriptionDeleted(meta: Record<string, unknown>) {
    const stripeSubId = typeof meta.objectId === 'string' ? meta.objectId : null;
    if (!stripeSubId) return;
    const mapping = await this.prisma.stripeSubscriptionMapping.findUnique({
      where: { stripeSubscriptionId: stripeSubId },
    });
    if (!mapping) return;
    const providerSub = await this.providers.getStripe().retrieveSubscription(stripeSubId);
    await this.subscriptions.cancelFromProvider(
      mapping.subscriptionId,
      providerSub.cancelAtPeriodEnd,
    );
  }

  private async handleSubscriptionSync(meta: Record<string, unknown>) {
    const stripeSubId = typeof meta.objectId === 'string' ? meta.objectId : null;
    if (!stripeSubId) return;
    const mapping = await this.prisma.stripeSubscriptionMapping.findUnique({
      where: { stripeSubscriptionId: stripeSubId },
      include: { subscription: true },
    });
    if (!mapping) return;
    const providerSub = await this.providers.getStripe().retrieveSubscription(stripeSubId);

    // Unexpected price change → alert, do not silently change plan
    if (providerSub.priceId) {
      const priceMapping = await this.prisma.stripePriceMapping.findFirst({
        where: { stripePriceId: providerSub.priceId, active: true },
      });
      if (priceMapping && priceMapping.planId !== mapping.subscription.planId) {
        await this.raiseAlert({
          organisationId: mapping.subscription.organisationId,
          alertType: 'UNEXPECTED_PRICE_CHANGE',
          message: `Stripe subscription ${stripeSubId} price maps to a different plan`,
          stripeObjectId: stripeSubId,
          internalRef: mapping.subscriptionId,
        });
      }
    }

    await this.prisma.subscription.update({
      where: { id: mapping.subscriptionId },
      data: {
        cancelAtPeriodEnd: providerSub.cancelAtPeriodEnd,
        currentPeriodStart: providerSub.currentPeriodStart,
        currentPeriodEnd: providerSub.currentPeriodEnd,
        nextBillingDate: providerSub.currentPeriodEnd,
        cancelledAt: providerSub.cancelledAt,
      },
    });
    await this.prisma.stripeSubscriptionMapping.update({
      where: { id: mapping.id },
      data: { latestStripeInvoiceId: providerSub.latestInvoiceId },
    });
    await this.auditService.record({
      action: 'stripe.subscription.reconciled',
      entityType: 'Subscription',
      entityId: mapping.subscriptionId,
      metadata: { stripeSubscriptionId: stripeSubId, status: providerSub.status },
    });
  }

  private async raiseAlert(input: {
    organisationId?: string;
    alertType: string;
    message: string;
    stripeObjectId?: string;
    internalRef?: string;
    metadata?: Record<string, unknown>;
  }) {
    await this.prisma.stripeReconciliationAlert.create({
      data: {
        organisationId: input.organisationId,
        alertType: input.alertType,
        message: input.message,
        status: StripeReconciliationAlertStatus.OPEN,
        stripeObjectId: input.stripeObjectId,
        internalRef: input.internalRef,
        metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
      },
    });
    await this.auditService.record({
      action: 'stripe.reconciliation.mismatch',
      entityType: 'StripeReconciliationAlert',
      customerId: input.organisationId,
      metadata: { alertType: input.alertType, stripeObjectId: input.stripeObjectId },
    });
  }
}
