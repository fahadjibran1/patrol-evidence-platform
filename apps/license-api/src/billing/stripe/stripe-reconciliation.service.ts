import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { AuditService } from '@/audit/audit.service';
import { ApiException } from '@/common/exceptions/api.exception';
import { ERROR_CODES } from '@/common/constants/error-codes';
import type { AuthenticatedAdmin } from '@/auth/interfaces/authenticated-admin.interface';
import { PaymentProviderRegistry } from '../providers/payment-provider.registry';
import { StripeConfigService } from './stripe-config.service';

@Injectable()
export class StripeReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly providers: PaymentProviderRegistry,
    private readonly stripeConfig: StripeConfigService,
  ) {}

  async overview() {
    const livemode = this.stripeConfig.getMode() === 'LIVE';
    const [
      openAlerts,
      deadLetters,
      failedWebhooks,
      lastProcessed,
      priceMappings,
      activeMappings,
    ] = await Promise.all([
      this.prisma.stripeReconciliationAlert.count({ where: { status: 'OPEN' } }),
      this.prisma.stripeWebhookEvent.count({ where: { processingStatus: 'DEAD_LETTER' } }),
      this.prisma.stripeWebhookEvent.count({ where: { processingStatus: 'FAILED' } }),
      this.prisma.stripeWebhookEvent.findFirst({
        where: { processingStatus: 'PROCESSED' },
        orderBy: { processedAt: 'desc' },
      }),
      this.prisma.stripePriceMapping.count(),
      this.prisma.stripePriceMapping.count({ where: { active: true, livemode } }),
    ]);

    return {
      stripe: this.stripeConfig.getSafeStatus(),
      openAlerts,
      deadLetters,
      failedWebhooks,
      lastProcessedWebhookAt: lastProcessed?.processedAt?.toISOString() ?? null,
      priceMappingsTotal: priceMappings,
      activePriceMappingsForMode: activeMappings,
    };
  }

  listAlerts() {
    return this.prisma.stripeReconciliationAlert.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  listWebhooks(status?: string) {
    return this.prisma.stripeWebhookEvent.findMany({
      where: status ? { processingStatus: status as never } : undefined,
      orderBy: { receivedAt: 'desc' },
      take: 100,
      select: {
        id: true,
        stripeEventId: true,
        type: true,
        livemode: true,
        processingStatus: true,
        attempts: true,
        receivedAt: true,
        processedAt: true,
        lastError: true,
        metadata: true,
      },
    });
  }

  listCheckoutSessions() {
    return this.prisma.stripeCheckoutSession.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        organisationId: true,
        stripeCheckoutSessionId: true,
        status: true,
        livemode: true,
        expiresAt: true,
        completedAt: true,
        internalSubscriptionId: true,
        createdAt: true,
      },
    });
  }

  async reconcileOrganisation(admin: AuthenticatedAdmin, organisationId: string) {
    const livemode = this.stripeConfig.getMode() === 'LIVE';
    const mapping = await this.prisma.stripeCustomerMapping.findUnique({
      where: { organisationId_livemode: { organisationId, livemode } },
    });
    if (!mapping) {
      throw new ApiException(ERROR_CODES.STRIPE_CUSTOMER_NOT_FOUND, 'No Stripe customer mapping', 404);
    }
    const customer = await this.providers.getStripe().retrieveCustomer(mapping.stripeCustomerId);
    await this.auditService.record({
      actorAdminId: admin.sub,
      action: 'stripe.reconciliation.customer',
      entityType: 'Customer',
      entityId: organisationId,
      customerId: organisationId,
      metadata: { stripeCustomerId: customer.providerCustomerId },
    });
    return { ok: true, stripeCustomerId: customer.providerCustomerId, livemode: customer.livemode };
  }

  async reconcileSubscription(admin: AuthenticatedAdmin, subscriptionId: string) {
    const mapping = await this.prisma.stripeSubscriptionMapping.findUnique({
      where: { subscriptionId },
    });
    if (!mapping) {
      throw new ApiException(ERROR_CODES.SUBSCRIPTION_NOT_FOUND, 'No Stripe subscription mapping', 404);
    }
    const providerSub = await this.providers.getStripe().retrieveSubscription(mapping.stripeSubscriptionId);
    await this.prisma.subscription.update({
      where: { id: subscriptionId },
      data: {
        currentPeriodStart: providerSub.currentPeriodStart,
        currentPeriodEnd: providerSub.currentPeriodEnd,
        nextBillingDate: providerSub.currentPeriodEnd,
        cancelAtPeriodEnd: providerSub.cancelAtPeriodEnd,
        cancelledAt: providerSub.cancelledAt,
      },
    });
    await this.auditService.record({
      actorAdminId: admin.sub,
      action: 'stripe.subscription.reconciled',
      entityType: 'Subscription',
      entityId: subscriptionId,
      metadata: { stripeSubscriptionId: mapping.stripeSubscriptionId, status: providerSub.status },
    });
    return { ok: true, providerStatus: providerSub.status };
  }

  async reconcileInvoice(admin: AuthenticatedAdmin, invoiceId: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { subscription: { include: { stripeSubscriptionMapping: true } } },
    });
    if (!invoice?.subscription.stripeSubscriptionMapping?.latestStripeInvoiceId) {
      throw new ApiException(ERROR_CODES.INVOICE_NOT_FOUND, 'No Stripe invoice reference', 404);
    }
    const providerInvoice = await this.providers.getStripe().retrieveInvoice(
      invoice.subscription.stripeSubscriptionMapping.latestStripeInvoiceId,
    );
    const mismatch =
      providerInvoice.amountPaid !== invoice.total
      || providerInvoice.currency !== invoice.currency.toUpperCase();
    await this.auditService.record({
      actorAdminId: admin.sub,
      action: 'stripe.reconciliation.invoice',
      entityType: 'Invoice',
      entityId: invoiceId,
      metadata: {
        mismatch,
        stripeInvoiceId: providerInvoice.providerInvoiceId,
        amountPaid: providerInvoice.amountPaid,
        internalTotal: invoice.total,
      },
    });
    return {
      ok: !mismatch,
      mismatch,
      stripe: providerInvoice,
      internal: { total: invoice.total, currency: invoice.currency, status: invoice.status },
    };
  }
}
