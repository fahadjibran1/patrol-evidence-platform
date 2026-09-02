import { Injectable, Optional } from '@nestjs/common';
import { NotificationStatus, NotificationType } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { AuditService } from '@/audit/audit.service';
import { ApiException } from '@/common/exceptions/api.exception';
import { ERROR_CODES } from '@/common/constants/error-codes';
import { NotificationService } from '@/notifications/notifications.service';
import { AuthService } from '@/auth/auth.service';
import { CustomerAuthService } from '@/customer-auth/customer-auth.service';
import { StripeReconciliationService } from '@/billing/stripe/stripe-reconciliation.service';
import { StripeWebhookService } from '@/billing/stripe/stripe-webhook.service';
import type { AuthenticatedAdmin } from '@/auth/interfaces/authenticated-admin.interface';
import { EventBus } from '@/domain-events/event-bus.service';
import { createDomainEvent } from '@/domain-events/domain-event';
import { DOMAIN_EVENTS } from '@/domain-events/domain-event.types';

@Injectable()
export class SupportOpsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly notifications: NotificationService,
    private readonly authService: AuthService,
    private readonly customerAuthService: CustomerAuthService,
    private readonly eventBus: EventBus,
    @Optional() private readonly stripeReconciliation?: StripeReconciliationService,
    @Optional() private readonly stripeWebhooks?: StripeWebhookService,
  ) {}

  async resendNotification(admin: AuthenticatedAdmin, logId: string) {
    const log = await this.prisma.notificationLog.findUnique({ where: { id: logId } });
    if (!log) {
      throw new ApiException(
        ERROR_CODES.SUPPORT_NOTIFICATION_NOT_FOUND,
        'Notification log not found',
        404,
      );
    }

    const result = await this.notifications.send({
      to: log.recipient,
      subject: `[Resend] ${log.subject}`,
      html: `<p>This is a support-driven resend of a previous notification.</p><p><strong>Original subject:</strong> ${escapeHtml(log.subject)}</p><p>If you expected an attachment or licence file, contact support or download from the Customer Portal.</p>`,
      text: `This is a support-driven resend of a previous notification.\nOriginal subject: ${log.subject}\nIf you expected an attachment, contact support or download from the Customer Portal.`,
      notificationType: NotificationType.ADMIN_ALERT,
      customerId: log.customerId ?? undefined,
      licenceId: log.licenceId ?? undefined,
      actorAdminId: admin.sub,
      source: 'support.resend',
      metadata: {
        originalLogId: log.id,
        originalStatus: log.status,
      },
    });

    await this.auditService.record({
      actorAdminId: admin.sub,
      action: 'support.notification_resent',
      entityType: 'NotificationLog',
      entityId: log.id,
      customerId: log.customerId,
      licenceId: log.licenceId,
      metadata: { newLogId: result.logId, recipient: log.recipient },
    });

    return { originalLogId: log.id, resend: result };
  }

  async reprocessWebhook(admin: AuthenticatedAdmin, eventId: string) {
    if (!this.stripeWebhooks) {
      throw new ApiException(
        ERROR_CODES.SUPPORT_OPERATION_INVALID,
        'Stripe webhook service unavailable',
        503,
      );
    }
    return this.stripeWebhooks.reprocess(eventId, admin.sub);
  }

  async rebuildLicence(admin: AuthenticatedAdmin, subscriptionId: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: { plan: true },
    });
    if (!subscription) {
      throw new ApiException(ERROR_CODES.SUBSCRIPTION_NOT_FOUND, 'Subscription not found', 404);
    }

    await this.eventBus.publish(
      createDomainEvent(DOMAIN_EVENTS.PlanChanged, {
        subscriptionId: subscription.id,
        organisationId: subscription.organisationId,
        previousPlanId: subscription.planId,
        planId: subscription.planId,
        maxDevices: subscription.plan.maxDevices,
        billingInterval: subscription.billingInterval,
        currentPeriodStart: subscription.currentPeriodStart?.toISOString() ?? null,
        currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() ?? null,
        actorAdminId: admin.sub,
        reason: 'support.rebuild_licence',
      }),
    );

    await this.auditService.record({
      actorAdminId: admin.sub,
      action: 'support.licence_rebuilt',
      entityType: 'Subscription',
      entityId: subscription.id,
      customerId: subscription.organisationId,
      metadata: { planId: subscription.planId },
    });

    const licence = await this.prisma.licence.findFirst({
      where: { customerId: subscription.organisationId },
      orderBy: { createdAt: 'desc' },
      include: { currentVersion: true },
    });

    return {
      subscriptionId: subscription.id,
      organisationId: subscription.organisationId,
      licenceId: licence?.id ?? null,
      licenseId: licence?.licenseId ?? null,
      versionNumber: licence?.currentVersion?.versionNumber ?? null,
      status: licence?.status ?? null,
    };
  }

  async resynchroniseStripe(admin: AuthenticatedAdmin, organisationId: string) {
    if (!this.stripeReconciliation) {
      throw new ApiException(
        ERROR_CODES.SUPPORT_OPERATION_INVALID,
        'Stripe reconciliation unavailable',
        503,
      );
    }
    const result = await this.stripeReconciliation.reconcileOrganisation(admin, organisationId);
    await this.auditService.record({
      actorAdminId: admin.sub,
      action: 'support.stripe_resync',
      entityType: 'Customer',
      entityId: organisationId,
      customerId: organisationId,
    });
    return result;
  }

  async unlockAccount(
    admin: AuthenticatedAdmin,
    dto: { accountType: 'admin' | 'customer'; email: string; reactivate?: boolean },
  ) {
    const email = dto.email.trim().toLowerCase();
    if (dto.accountType === 'admin') {
      const record = await this.prisma.admin.findUnique({ where: { email } });
      if (!record) {
        throw new ApiException(ERROR_CODES.SUPPORT_ACCOUNT_NOT_FOUND, 'Admin not found', 404);
      }
      const cleared = this.authService.clearLoginRateLimit(email);
      if (dto.reactivate !== false && !record.isActive) {
        await this.prisma.admin.update({ where: { id: record.id }, data: { isActive: true } });
      }
      await this.auditService.record({
        actorAdminId: admin.sub,
        action: 'support.account_unlocked',
        entityType: 'Admin',
        entityId: record.id,
        metadata: { email, clearedRateLimitKeys: cleared, reactivate: dto.reactivate !== false },
      });
      return { accountType: 'admin', id: record.id, email, clearedRateLimitKeys: cleared };
    }

    const user = await this.prisma.customerUser.findFirst({ where: { email } });
    if (!user) {
      throw new ApiException(ERROR_CODES.SUPPORT_ACCOUNT_NOT_FOUND, 'Customer user not found', 404);
    }
    const cleared = this.customerAuthService.clearLoginRateLimit(email);
    if (dto.reactivate !== false && !user.isActive) {
      await this.prisma.customerUser.update({ where: { id: user.id }, data: { isActive: true } });
    }
    await this.auditService.record({
      actorAdminId: admin.sub,
      action: 'support.account_unlocked',
      entityType: 'CustomerUser',
      entityId: user.id,
      customerId: user.customerId,
      metadata: { email, clearedRateLimitKeys: cleared, reactivate: dto.reactivate !== false },
    });
    return {
      accountType: 'customer',
      id: user.id,
      email,
      organisationId: user.customerId,
      clearedRateLimitKeys: cleared,
    };
  }

  async resetCustomerState(
    admin: AuthenticatedAdmin,
    organisationId: string,
    dto: {
      clearPendingCheckout?: boolean;
      clearScheduledPlanChange?: boolean;
      clearCancellation?: boolean;
      clearPastDue?: boolean;
    },
  ) {
    const org = await this.prisma.customer.findUnique({ where: { id: organisationId } });
    if (!org) {
      throw new ApiException(ERROR_CODES.CUSTOMER_NOT_FOUND, 'Organisation not found', 404);
    }

    const subscriptions = await this.prisma.subscription.findMany({
      where: { organisationId },
    });

    const updates: string[] = [];
    for (const sub of subscriptions) {
      const data: Record<string, unknown> = {};
      if (dto.clearPendingCheckout) {
        data.pendingCheckout = false;
      }
      if (dto.clearScheduledPlanChange) {
        data.pendingPlanId = null;
        data.pendingBillingInterval = null;
        data.planChangeEffectiveAt = null;
        data.scheduledChangeType = null;
      }
      if (dto.clearCancellation) {
        data.cancelAtPeriodEnd = false;
        data.cancelledAt = null;
        data.cancellationReason = null;
        data.autoRenew = true;
      }
      if (dto.clearPastDue && sub.status === 'PAST_DUE') {
        data.status = 'ACTIVE';
      }
      if (Object.keys(data).length === 0) {
        continue;
      }
      await this.prisma.subscription.update({ where: { id: sub.id }, data });
      updates.push(sub.id);
    }

    await this.auditService.record({
      actorAdminId: admin.sub,
      action: 'support.customer_state_reset',
      entityType: 'Customer',
      entityId: organisationId,
      customerId: organisationId,
      metadata: { updatedSubscriptions: updates, options: dto },
    });

    return {
      organisationId,
      updatedSubscriptions: updates,
      options: dto,
    };
  }

  /** Convenience: list recent failed notifications for support tooling. */
  async listFailedNotifications(limit = 50) {
    const items = await this.prisma.notificationLog.findMany({
      where: { status: NotificationStatus.FAILED },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 200),
    });
    return {
      items: items.map((row) => ({
        id: row.id,
        notificationType: row.notificationType,
        recipient: row.recipient,
        subject: row.subject,
        status: row.status,
        errorMessage: row.errorMessage,
        customerId: row.customerId,
        licenceId: row.licenceId,
        createdAt: row.createdAt.toISOString(),
      })),
      total: items.length,
    };
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
