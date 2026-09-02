import { Injectable, Optional } from '@nestjs/common';
import {
  AdminRole,
  CustomerStatus,
  LicensePlan,
  LicenseStatus,
  NotificationStatus,
  PaymentStatus,
  Prisma,
} from '@prisma/client';
import { addDays, todayUtcDate } from '@patrol/license-core';
import { PrismaService } from '@/prisma/prisma.service';
import { AuthenticatedAdmin } from '@/auth/interfaces/authenticated-admin.interface';
import { deriveEffectiveStatus, toDateOnly } from '@/licences/licence.util';
import { MetricsService } from '@/metrics/metrics.service';
import { BillingMetricsService } from '@/billing/billing-metrics.service';
import type { DashboardSummaryDto } from './dto/dashboard-response.dto';

const RENEWAL_QUEUE_LIMIT = 25;
const RECENT_ACTIVITY_LIMIT = 15;
const RECENT_FAILURE_LIMIT = 10;
const DEFAULT_CURRENCY = 'GBP';
/** In-memory dashboard summary cache TTL — short enough that stale-after-mutation windows are
 * negligible, but long enough to absorb bursts of dashboard polling from the admin portal. */
const CACHE_TTL_MS = 30_000;

interface CacheEntry {
  data: DashboardSummaryDto;
  expiresAt: number;
}

@Injectable()
export class DashboardService {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly metricsService?: MetricsService,
    @Optional() private readonly billingMetricsService?: BillingMetricsService,
  ) {}

  /** Clears the entire in-memory cache. Called by DashboardCacheHandler on domain events. */
  invalidateAll(): void {
    this.cache.clear();
  }

  /** Test/diagnostic helper — number of currently cached role buckets. */
  get cacheSize(): number {
    return this.cache.size;
  }

  async getSummary(admin: AuthenticatedAdmin): Promise<DashboardSummaryDto> {
    const cacheKey = `dashboard:${admin.role}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    const startedAt = Date.now();
    const summary = await this.computeSummary(admin);
    this.metricsService?.recordDashboardLoad(Date.now() - startedAt);

    this.cache.set(cacheKey, { data: summary, expiresAt: Date.now() + CACHE_TTL_MS });
    return summary;
  }

  private async computeSummary(admin: AuthenticatedAdmin): Promise<DashboardSummaryDto> {
    const today = todayUtcDate();
    const in7 = addDays(today, 7);
    const in30 = addDays(today, 30);
    const todayStart = new Date(`${today}T00:00:00.000Z`);
    const todayEnd = new Date(`${today}T23:59:59.999Z`);
    const monthStart = startOfUtcMonth(todayStart);
    const includeRevenue = admin.role === AdminRole.SUPER_ADMIN || admin.role === AdminRole.ADMIN;

    const activeLicenceWhere: Prisma.LicenceWhereInput = {
      status: LicenseStatus.ACTIVE,
      expiresAt: { gte: new Date(today) },
    };

    const [
      activeCustomers,
      activeLicences,
      planGroups,
      expiredLicences,
      expiringIn7Days,
      expiringIn30Days,
      suspendedLicences,
      revokedLicences,
      renewedThisMonth,
      notificationTodayGroups,
      renewalQueueRows,
      recentActivityRows,
      recentFailures,
      revenue,
    ] = await Promise.all([
      this.prisma.customer.count({ where: { status: CustomerStatus.ACTIVE } }),
      this.prisma.licence.count({ where: activeLicenceWhere }),
      this.prisma.licence.groupBy({
        by: ['plan'],
        where: activeLicenceWhere,
        _count: { _all: true },
      }),
      this.prisma.licence.count({
        where: {
          OR: [
            { status: LicenseStatus.EXPIRED },
            { status: LicenseStatus.ACTIVE, expiresAt: { lt: new Date(today) } },
          ],
        },
      }),
      this.prisma.licence.count({
        where: {
          status: LicenseStatus.ACTIVE,
          expiresAt: { gte: new Date(today), lte: new Date(in7) },
        },
      }),
      this.prisma.licence.count({
        where: {
          status: LicenseStatus.ACTIVE,
          expiresAt: { gte: new Date(today), lte: new Date(in30) },
        },
      }),
      this.prisma.licence.count({ where: { status: LicenseStatus.SUSPENDED } }),
      this.prisma.licence.count({ where: { status: LicenseStatus.REVOKED } }),
      this.prisma.licenceVersion.count({
        where: { actionType: 'RENEWED', createdAt: { gte: monthStart } },
      }),
      this.prisma.notificationLog.groupBy({
        by: ['status'],
        where: {
          createdAt: { gte: todayStart, lte: todayEnd },
        },
        _count: { _all: true },
      }),
      this.prisma.licence.findMany({
        where: {
          status: LicenseStatus.ACTIVE,
          NOT: { status: LicenseStatus.REVOKED },
          expiresAt: { gte: new Date(today), lte: new Date(in30) },
        },
        orderBy: { expiresAt: 'asc' },
        take: RENEWAL_QUEUE_LIMIT,
        select: {
          id: true,
          licenseId: true,
          customerId: true,
          plan: true,
          status: true,
          startsAt: true,
          expiresAt: true,
          customer: { select: { companyName: true } },
        },
      }),
      this.prisma.auditLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: RECENT_ACTIVITY_LIMIT,
        select: {
          id: true,
          action: true,
          entityType: true,
          entityId: true,
          customerId: true,
          licenceId: true,
          createdAt: true,
          actor: { select: { displayName: true } },
        },
      }),
      this.prisma.notificationLog.findMany({
        where: { status: NotificationStatus.FAILED },
        orderBy: { createdAt: 'desc' },
        take: RECENT_FAILURE_LIMIT,
        select: {
          id: true,
          notificationType: true,
          provider: true,
          recipient: true,
          subject: true,
          status: true,
          errorMessage: true,
          createdAt: true,
        },
      }),
      includeRevenue ? this.loadRevenueSummary(todayStart, todayEnd, monthStart) : Promise.resolve(undefined),
    ]);

    const planCounts = {
      trialLicences: 0,
      monthlyLicences: 0,
      annualLicences: 0,
    };
    for (const group of planGroups) {
      if (group.plan === LicensePlan.TRIAL) {
        planCounts.trialLicences = group._count._all;
      } else if (group.plan === LicensePlan.MONTHLY) {
        planCounts.monthlyLicences = group._count._all;
      } else if (group.plan === LicensePlan.ANNUAL) {
        planCounts.annualLicences = group._count._all;
      }
    }

    let emailsSentToday = 0;
    let failedEmailsToday = 0;
    let pendingEmailsToday = 0;
    for (const group of notificationTodayGroups) {
      if (group.status === NotificationStatus.SENT) {
        emailsSentToday = group._count._all;
      } else if (group.status === NotificationStatus.FAILED) {
        failedEmailsToday = group._count._all;
      } else if (group.status === NotificationStatus.PENDING) {
        pendingEmailsToday = group._count._all;
      }
    }

    const summary: DashboardSummaryDto = {
      generatedAt: new Date().toISOString(),
      kpis: {
        activeCustomers,
        activeLicences,
        trialLicences: planCounts.trialLicences,
        monthlyLicences: planCounts.monthlyLicences,
        annualLicences: planCounts.annualLicences,
        expiredLicences,
        expiringIn7Days,
        expiringIn30Days,
        suspendedLicences,
        revokedLicences,
        renewedThisMonth,
        emailsSentToday,
        failedEmailsToday,
      },
      renewalQueue: renewalQueueRows.map((licence) => {
        const expiresAt = toDateOnly(licence.expiresAt);
        return {
          id: licence.id,
          licenseId: licence.licenseId,
          customerId: licence.customerId,
          customerName: licence.customer.companyName,
          plan: licence.plan,
          status: licence.status,
          effectiveStatus: deriveEffectiveStatus({
            status: licence.status,
            startsAt: licence.startsAt,
            expiresAt: licence.expiresAt,
            today,
          }),
          expiresAt,
          daysUntilExpiry: daysBetween(today, expiresAt),
          // Renewal queue only ever contains ACTIVE licences, so SUPPORT is the only role
          // that can never act and reactivation is never applicable here.
          canRenew: admin.role !== AdminRole.SUPPORT,
          canReactivate: false,
        };
      }),
      recentActivity: recentActivityRows.map((entry) => ({
        id: entry.id,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        customerId: entry.customerId,
        licenceId: entry.licenceId,
        actorDisplayName: entry.actor?.displayName ?? null,
        createdAt: entry.createdAt.toISOString(),
      })),
      notificationHealth: {
        sentToday: emailsSentToday,
        failedToday: failedEmailsToday,
        pendingToday: pendingEmailsToday,
        recentFailures: recentFailures.map((row) => ({
          id: row.id,
          notificationType: row.notificationType,
          provider: row.provider,
          recipient: row.recipient,
          subject: row.subject,
          status: row.status,
          errorMessage: row.errorMessage,
          createdAt: row.createdAt.toISOString(),
        })),
      },
    };

    if (revenue) {
      summary.revenue = revenue;
    }

    if (includeRevenue && this.billingMetricsService) {
      summary.billing = await this.billingMetricsService.getMetrics();
    }

    return summary;
  }

  private async loadRevenueSummary(todayStart: Date, todayEnd: Date, monthStart: Date) {
    const [outstanding, paidToday, paidThisMonth] = await Promise.all([
      this.prisma.paymentRecord.aggregate({
        where: { paymentStatus: PaymentStatus.PENDING },
        _count: { _all: true },
        _sum: { amountPence: true },
      }),
      this.prisma.paymentRecord.aggregate({
        where: {
          paymentStatus: PaymentStatus.PAID,
          OR: [
            { paidAt: { gte: todayStart, lte: todayEnd } },
            { paidAt: null, createdAt: { gte: todayStart, lte: todayEnd } },
          ],
        },
        _count: { _all: true },
        _sum: { amountPence: true },
      }),
      this.prisma.paymentRecord.aggregate({
        where: {
          paymentStatus: PaymentStatus.PAID,
          OR: [
            { paidAt: { gte: monthStart } },
            { paidAt: null, createdAt: { gte: monthStart } },
          ],
        },
        _count: { _all: true },
        _sum: { amountPence: true },
      }),
    ]);

    return {
      currency: DEFAULT_CURRENCY,
      outstandingPaymentsCount: outstanding._count._all,
      outstandingPaymentsAmountPence: outstanding._sum.amountPence ?? 0,
      paidTodayCount: paidToday._count._all,
      paidTodayAmountPence: paidToday._sum.amountPence ?? 0,
      paidThisMonthCount: paidThisMonth._count._all,
      paidThisMonthAmountPence: paidThisMonth._sum.amountPence ?? 0,
    };
  }
}

function startOfUtcMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0, 0));
}

function daysBetween(fromIsoDate: string, toIsoDate: string): number {
  const from = new Date(`${fromIsoDate}T00:00:00.000Z`).getTime();
  const to = new Date(`${toIsoDate}T00:00:00.000Z`).getTime();
  return Math.max(0, Math.round((to - from) / 86_400_000));
}
