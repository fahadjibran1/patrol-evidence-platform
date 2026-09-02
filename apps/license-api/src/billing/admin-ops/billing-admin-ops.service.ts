import { Injectable } from '@nestjs/common';
import { BillingInterval, SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { AuditService } from '@/audit/audit.service';
import { ApiException } from '@/common/exceptions/api.exception';
import { ERROR_CODES } from '@/common/constants/error-codes';
import type { AuthenticatedAdmin } from '@/auth/interfaces/authenticated-admin.interface';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';

@Injectable()
export class BillingAdminOpsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  async overrideCancel(
    admin: AuthenticatedAdmin,
    subscriptionId: string,
    dto: { resume?: boolean; atPeriodEnd?: boolean; reason?: string },
  ) {
    if (dto.resume) {
      const result = await this.subscriptions.resume(admin, subscriptionId);
      await this.auditService.record({
        actorAdminId: admin.sub,
        action: 'billing.admin_override_resume',
        entityType: 'Subscription',
        entityId: subscriptionId,
        metadata: { reason: dto.reason ?? null },
      });
      return result;
    }
    return this.subscriptions.cancel(admin, subscriptionId, {
      atPeriodEnd: dto.atPeriodEnd,
      reason: dto.reason ?? 'admin_override',
    });
  }

  async adjustGracePeriod(
    admin: AuthenticatedAdmin,
    subscriptionId: string,
    gracePeriodDays: number,
  ) {
    if (gracePeriodDays < 0 || gracePeriodDays > 90) {
      throw new ApiException(ERROR_CODES.VALIDATION_ERROR, 'Grace period must be 0-90 days', 400);
    }
    const updated = await this.prisma.subscription.update({
      where: { id: subscriptionId },
      data: { gracePeriodDaysOverride: gracePeriodDays },
      include: { plan: true, organisation: true },
    });
    await this.auditService.record({
      actorAdminId: admin.sub,
      action: 'billing.grace_period_adjusted',
      entityType: 'Subscription',
      entityId: subscriptionId,
      customerId: updated.organisationId,
      metadata: { gracePeriodDays },
    });
    return this.subscriptions.serialize(updated);
  }

  async changeBillingCycle(
    admin: AuthenticatedAdmin,
    subscriptionId: string,
    billingInterval: BillingInterval,
  ) {
    return this.subscriptions.changePlan(admin, subscriptionId, {
      planId: (await this.prisma.subscription.findUniqueOrThrow({ where: { id: subscriptionId } })).planId,
      billingInterval,
      reason: 'admin_billing_cycle_change',
    });
  }

  async transferSubscription(
    admin: AuthenticatedAdmin,
    subscriptionId: string,
    targetOrganisationId: string,
  ) {
    const target = await this.prisma.customer.findUnique({ where: { id: targetOrganisationId } });
    if (!target) {
      throw new ApiException(ERROR_CODES.CUSTOMER_NOT_FOUND, 'Target organisation not found', 404);
    }
    const existing = await this.prisma.subscription.findFirst({
      where: {
        organisationId: targetOrganisationId,
        status: {
          in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIAL, SubscriptionStatus.PAST_DUE],
        },
      },
    });
    if (existing) {
      throw new ApiException(
        ERROR_CODES.SUBSCRIPTION_ALREADY_EXISTS,
        'Target organisation already has an active subscription',
        409,
      );
    }
    const current = await this.prisma.subscription.findUniqueOrThrow({ where: { id: subscriptionId } });
    const previousOrganisationId = current.organisationId;
    const updated = await this.prisma.subscription.update({
      where: { id: subscriptionId },
      data: { organisationId: targetOrganisationId },
      include: { plan: true, organisation: true },
    });
    await this.auditService.record({
      actorAdminId: admin.sub,
      action: 'billing.subscription_transferred',
      entityType: 'Subscription',
      entityId: subscriptionId,
      customerId: targetOrganisationId,
      metadata: { previousOrganisationId },
    });
    return this.subscriptions.serialize(updated);
  }

  async issueCredit(
    admin: AuthenticatedAdmin,
    dto: {
      organisationId: string;
      subscriptionId?: string;
      amount: number;
      currency?: string;
      reason: string;
    },
  ) {
    if (dto.amount <= 0) {
      throw new ApiException(ERROR_CODES.VALIDATION_ERROR, 'Credit amount must be positive', 400);
    }
    const credit = await this.prisma.billingCredit.create({
      data: {
        organisationId: dto.organisationId,
        subscriptionId: dto.subscriptionId,
        amount: dto.amount,
        currency: dto.currency ?? 'GBP',
        reason: dto.reason,
        issuedByAdminId: admin.sub,
      },
    });
    await this.auditService.record({
      actorAdminId: admin.sub,
      action: 'billing.credit_issued',
      entityType: 'BillingCredit',
      entityId: credit.id,
      customerId: dto.organisationId,
      metadata: { amount: dto.amount, reason: dto.reason },
    });
    return credit;
  }

  async reporting() {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

    const [
      upgrades,
      downgrades,
      renewals,
      cancellations,
      active,
      pastDue,
      credits,
      avgLength,
    ] = await Promise.all([
      this.prisma.auditLog.count({
        where: {
          action: 'billing.subscription_plan_changed',
          createdAt: { gte: monthStart },
          metadata: { path: ['reason'], string_contains: 'upgrade' },
        },
      }).catch(() => 0),
      this.prisma.auditLog.count({
        where: {
          action: 'billing.downgrade_scheduled',
          createdAt: { gte: monthStart },
        },
      }),
      this.prisma.auditLog.count({
        where: {
          action: 'billing.subscription_renewed',
          createdAt: { gte: monthStart },
        },
      }),
      this.prisma.auditLog.count({
        where: {
          action: 'billing.subscription_cancelled',
          createdAt: { gte: monthStart },
        },
      }),
      this.prisma.subscription.count({ where: { status: SubscriptionStatus.ACTIVE } }),
      this.prisma.subscription.count({ where: { status: SubscriptionStatus.PAST_DUE } }),
      this.prisma.billingCredit.aggregate({ _sum: { amount: true } }),
      this.prisma.$queryRaw<Array<{ avg_days: number | null }>>`
        SELECT AVG(EXTRACT(EPOCH FROM (COALESCE("cancelledAt", NOW()) - COALESCE("startedAt", "createdAt"))) / 86400.0) AS avg_days
        FROM "Subscription"
        WHERE "startedAt" IS NOT NULL OR "createdAt" IS NOT NULL
      `,
    ]);

    const churnRate = active + cancellations > 0
      ? Number(((cancellations / Math.max(active + cancellations, 1)) * 100).toFixed(2))
      : 0;

    return {
      periodStart: monthStart.toISOString(),
      upgradeRateEvents: upgrades,
      downgradeRateEvents: downgrades,
      renewalSuccessEvents: renewals,
      renewalFailureCandidates: pastDue,
      averageSubscriptionLengthDays: Number(avgLength[0]?.avg_days ?? 0).toFixed(1),
      monthlyChurnPercent: churnRate,
      gracePeriodRecoveryCandidates: pastDue,
      activeSubscriptions: active,
      creditsIssuedMinor: credits._sum.amount ?? 0,
    };
  }
}
