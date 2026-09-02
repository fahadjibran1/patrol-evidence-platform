import { Injectable } from '@nestjs/common';
import {
  BillingPaymentStatus,
  InvoiceStatus,
  SubscriptionStatus,
} from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';

export interface BillingDashboardMetrics {
  mrrPence: number;
  arrPence: number;
  activeSubscriptions: number;
  trialSubscriptions: number;
  pastDueSubscriptions: number;
  cancelledSubscriptions: number;
  revenueThisMonthPence: number;
  revenueThisYearPence: number;
  invoicesDue: number;
  invoicesOverdue: number;
  currency: string;
}

@Injectable()
export class BillingMetricsService {
  constructor(private readonly prisma: PrismaService) {}

  async getMetrics(): Promise<BillingDashboardMetrics> {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));

    const [
      active,
      trial,
      pastDue,
      cancelled,
      activeSubs,
      revenueMonth,
      revenueYear,
      invoicesDue,
      invoicesOverdue,
    ] = await Promise.all([
      this.prisma.subscription.count({ where: { status: SubscriptionStatus.ACTIVE } }),
      this.prisma.subscription.count({ where: { status: SubscriptionStatus.TRIAL } }),
      this.prisma.subscription.count({ where: { status: SubscriptionStatus.PAST_DUE } }),
      this.prisma.subscription.count({ where: { status: SubscriptionStatus.CANCELLED } }),
      this.prisma.subscription.findMany({
        where: { status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIAL] } },
        include: { plan: true },
      }),
      this.prisma.billingPayment.aggregate({
        where: {
          status: BillingPaymentStatus.SUCCEEDED,
          receivedAt: { gte: monthStart },
        },
        _sum: { amount: true },
      }),
      this.prisma.billingPayment.aggregate({
        where: {
          status: BillingPaymentStatus.SUCCEEDED,
          receivedAt: { gte: yearStart },
        },
        _sum: { amount: true },
      }),
      this.prisma.invoice.count({
        where: {
          status: InvoiceStatus.OPEN,
          dueAt: { gte: now },
        },
      }),
      this.prisma.invoice.count({
        where: {
          OR: [
            { status: InvoiceStatus.OVERDUE },
            { status: InvoiceStatus.OPEN, dueAt: { lt: now } },
          ],
        },
      }),
    ]);

    let mrrPence = 0;
    for (const sub of activeSubs) {
      if (sub.status === SubscriptionStatus.TRIAL) {
        continue;
      }
      if (sub.billingInterval === 'ANNUAL') {
        mrrPence += Math.round(sub.plan.annualPrice / 12);
      } else {
        mrrPence += sub.plan.monthlyPrice;
      }
    }

    return {
      mrrPence,
      arrPence: mrrPence * 12,
      activeSubscriptions: active,
      trialSubscriptions: trial,
      pastDueSubscriptions: pastDue,
      cancelledSubscriptions: cancelled,
      revenueThisMonthPence: revenueMonth._sum.amount ?? 0,
      revenueThisYearPence: revenueYear._sum.amount ?? 0,
      invoicesDue,
      invoicesOverdue,
      currency: 'GBP',
    };
  }
}
