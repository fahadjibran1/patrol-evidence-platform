import { Injectable, Logger, Optional } from '@nestjs/common';
import { NotificationType } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { NotificationService } from '@/notifications/notifications.service';

/**
 * Stripe/billing notification helpers.
 * Logical template names map onto existing NotificationType values with dedupe keys
 * so multiple Stripe events for one business outcome do not spam customers.
 */
@Injectable()
export class StripeNotificationsService {
  private readonly logger = new Logger(StripeNotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly notifications?: NotificationService,
  ) {}

  async notifyPaymentSucceeded(input: {
    organisationId: string;
    subscriptionId: string;
    invoiceId: string;
    amount: number;
    currency: string;
  }) {
    await this.sendDeduped({
      dedupeKey: `PAYMENT_SUCCEEDED:${input.invoiceId}`,
      organisationId: input.organisationId,
      notificationType: NotificationType.PAYMENT_RECEIVED,
      subject: 'Payment received',
      body: `Your payment of ${formatMinor(input.amount, input.currency)} was recorded. Subscription ${input.subscriptionId} is being updated.`,
      source: 'stripe.payment.succeeded',
    });
  }

  async notifyPaymentFailed(input: {
    organisationId: string;
    subscriptionId: string;
    stripeInvoiceId: string;
    gracePeriodDays: number;
  }) {
    await this.sendDeduped({
      dedupeKey: `PAYMENT_FAILED:${input.stripeInvoiceId}`,
      organisationId: input.organisationId,
      notificationType: NotificationType.PAYMENT_FAILED,
      subject: 'Payment failed — action required',
      body: `A subscription payment failed. Your access remains available during a ${input.gracePeriodDays}-day grace period. Please update your payment method in Billing.`,
      source: 'stripe.payment.failed',
    });
  }

  async notifyPaymentActionRequired(input: {
    organisationId: string;
    stripeInvoiceId: string;
  }) {
    await this.sendDeduped({
      dedupeKey: `PAYMENT_ACTION_REQUIRED:${input.stripeInvoiceId}`,
      organisationId: input.organisationId,
      notificationType: NotificationType.PAYMENT_FAILED,
      subject: 'Payment action required',
      body: 'Your payment provider requires additional authentication. Open Billing and use Manage payment method to complete the action.',
      source: 'stripe.payment.action_required',
    });
  }

  async notifyCheckoutExpired(input: { organisationId: string; sessionId: string }) {
    await this.sendDeduped({
      dedupeKey: `CHECKOUT_EXPIRED:${input.sessionId}`,
      organisationId: input.organisationId,
      notificationType: NotificationType.ADMIN_ALERT,
      subject: 'Checkout session expired',
      body: 'Your checkout session expired before payment completed. No charge was made. You can restart checkout from Billing.',
      source: 'stripe.checkout.expired',
      customerFacing: true,
    });
  }

  async notifySubscriptionActivated(input: {
    organisationId: string;
    subscriptionId: string;
  }) {
    await this.sendDeduped({
      dedupeKey: `SUBSCRIPTION_ACTIVATED:${input.subscriptionId}`,
      organisationId: input.organisationId,
      notificationType: NotificationType.PAYMENT_RECEIVED,
      subject: 'Subscription activated',
      body: 'Your subscription is active. A licence update will be available shortly from the Licences page.',
      source: 'stripe.subscription.activated',
    });
  }

  async notifyAdminReconciliation(input: {
    organisationId?: string;
    alertType: string;
    message: string;
  }) {
    const adminEmail = process.env.STRIPE_ADMIN_ALERT_EMAIL ?? process.env.LICENSE_ADMIN_EMAIL;
    if (!adminEmail || !this.notifications) return;
    await this.sendDeduped({
      dedupeKey: `BILLING_RECONCILIATION_REQUIRED_ADMIN:${input.alertType}:${input.message}`,
      organisationId: input.organisationId,
      notificationType: NotificationType.ADMIN_ALERT,
      subject: `[Admin] Billing reconciliation required (${input.alertType})`,
      body: input.message,
      source: 'stripe.reconciliation.mismatch',
      recipientOverride: adminEmail,
    });
  }

  async notifyAdminDeadLetter(input: { eventId: string; type: string; error: string }) {
    const adminEmail = process.env.STRIPE_ADMIN_ALERT_EMAIL ?? process.env.LICENSE_ADMIN_EMAIL;
    if (!adminEmail || !this.notifications) return;
    await this.sendDeduped({
      dedupeKey: `STRIPE_WEBHOOK_DEAD_LETTER_ADMIN:${input.eventId}`,
      organisationId: undefined,
      notificationType: NotificationType.ADMIN_ALERT,
      subject: `[Admin] Stripe webhook dead-lettered (${input.type})`,
      body: `Webhook event ${input.eventId} moved to DEAD_LETTER. Last error: ${input.error}`,
      source: 'stripe.webhook.dead_letter',
      recipientOverride: adminEmail,
    });
  }

  async notifyPlanUpgraded(input: {
    organisationId: string;
    subscriptionId: string;
    planCode: string;
  }) {
    await this.sendDeduped({
      dedupeKey: `PLAN_UPGRADED:${input.subscriptionId}:${input.planCode}`,
      organisationId: input.organisationId,
      notificationType: NotificationType.PAYMENT_RECEIVED,
      subject: 'Plan upgraded',
      body: `Your subscription was upgraded to ${input.planCode}. Updated licence entitlements will appear shortly.`,
      source: 'billing.plan.upgraded',
    });
  }

  async notifyPlanDowngradeScheduled(input: {
    organisationId: string;
    subscriptionId: string;
    planCode: string;
    effectiveAt: Date;
  }) {
    await this.sendDeduped({
      dedupeKey: `PLAN_DOWNGRADED:${input.subscriptionId}:${input.planCode}:${input.effectiveAt.toISOString()}`,
      organisationId: input.organisationId,
      notificationType: NotificationType.ADMIN_ALERT,
      subject: 'Plan downgrade scheduled',
      body: `Your plan will change to ${input.planCode} on ${input.effectiveAt.toISOString().slice(0, 10)}. Current entitlements remain until then.`,
      source: 'billing.plan.downgrade_scheduled',
      customerFacing: true,
    });
  }

  async notifyCancellationConfirmed(input: {
    organisationId: string;
    subscriptionId: string;
    atPeriodEnd: boolean;
    endDate: string | null;
  }) {
    await this.sendDeduped({
      dedupeKey: `CANCELLATION_CONFIRMED:${input.subscriptionId}:${input.atPeriodEnd ? 'pe' : 'now'}`,
      organisationId: input.organisationId,
      notificationType: NotificationType.ADMIN_ALERT,
      subject: 'Cancellation confirmed',
      body: input.atPeriodEnd
        ? `Your subscription will end on ${input.endDate ?? 'the period end date'}. You can undo cancellation from Billing before then.`
        : 'Your subscription has been cancelled immediately.',
      source: 'billing.cancellation.confirmed',
      customerFacing: true,
    });
  }

  async notifyUpcomingRenewal(input: {
    organisationId: string;
    subscriptionId: string;
    renewalDate: Date;
    amount: number;
    currency: string;
  }) {
    await this.sendDeduped({
      dedupeKey: `UPCOMING_RENEWAL:${input.subscriptionId}:${input.renewalDate.toISOString().slice(0, 10)}`,
      organisationId: input.organisationId,
      notificationType: NotificationType.PAYMENT_RECEIVED,
      subject: 'Upcoming renewal',
      body: `Your subscription renews on ${input.renewalDate.toISOString().slice(0, 10)} for ${formatMinor(input.amount, input.currency)}.`,
      source: 'billing.renewal.upcoming',
    });
  }

  async notifyGracePeriodEnding(input: {
    organisationId: string;
    subscriptionId: string;
    daysRemaining: number;
  }) {
    await this.sendDeduped({
      dedupeKey: `GRACE_PERIOD_ENDING:${input.subscriptionId}:${input.daysRemaining}`,
      organisationId: input.organisationId,
      notificationType: NotificationType.PAYMENT_FAILED,
      subject: 'Grace period ending',
      body: `Your billing grace period ends in ${input.daysRemaining} day(s). Update your payment method to avoid interruption.`,
      source: 'billing.grace.ending',
    });
  }

  private async sendDeduped(input: {
    dedupeKey: string;
    organisationId?: string;
    notificationType: NotificationType;
    subject: string;
    body: string;
    source: string;
    recipientOverride?: string;
    customerFacing?: boolean;
  }) {
    if (!this.notifications) return;

    const existing = await this.prisma.notificationLog.findFirst({
      where: {
        source: input.source,
        metadata: { path: ['dedupeKey'], equals: input.dedupeKey },
      },
      select: { id: true },
    });
    if (existing) {
      return;
    }

    let recipient = input.recipientOverride ?? null;
    if (!recipient && input.organisationId) {
      const org = await this.prisma.customer.findUnique({
        where: { id: input.organisationId },
        select: { email: true, billingEmail: true },
      });
      recipient = org?.billingEmail ?? org?.email ?? null;
    }
    if (!recipient) {
      this.logger.warn(`Skipping notification ${input.dedupeKey}: no recipient`);
      return;
    }

    try {
      await this.notifications.send({
        notificationType: input.notificationType,
        to: recipient,
        subject: input.subject,
        html: `<p>${escapeHtml(input.body)}</p>`,
        text: input.body,
        customerId: input.organisationId ?? null,
        source: input.source,
        metadata: {
          dedupeKey: input.dedupeKey,
          template: input.dedupeKey.split(':')[0],
        },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to queue notification ${input.dedupeKey}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

function formatMinor(amount: number, currency: string): string {
  return `${(amount / 100).toFixed(2)} ${currency.toUpperCase()}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
