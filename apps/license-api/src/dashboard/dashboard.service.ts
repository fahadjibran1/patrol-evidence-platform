import { Injectable } from '@nestjs/common';
import { LicensePlan, LicenseStatus, PaymentStatus } from '@prisma/client';
import { addDays, todayUtcDate } from '@patrol/license-core';
import { PrismaService } from '@/prisma/prisma.service';
import { toDateOnly } from '@/licences/licence.util';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary() {
    const today = todayUtcDate();
    const in7 = addDays(today, 7);
    const in30 = addDays(today, 30);

    const [
      totalCustomers,
      activeLicences,
      trials,
      expiredLicences,
      suspendedLicences,
      expiring7,
      expiring30,
      outstandingPayments,
      recentActivity,
      upcomingRenewals,
      signingKeyReady,
    ] = await Promise.all([
      this.prisma.customer.count(),
      this.prisma.licence.count({
        where: {
          status: LicenseStatus.ACTIVE,
          expiresAt: { gte: new Date(today) },
        },
      }),
      this.prisma.licence.count({ where: { plan: LicensePlan.TRIAL, status: LicenseStatus.ACTIVE } }),
      this.prisma.licence.count({
        where: {
          OR: [{ status: LicenseStatus.EXPIRED }, { status: LicenseStatus.ACTIVE, expiresAt: { lt: new Date(today) } }],
        },
      }),
      this.prisma.licence.count({ where: { status: LicenseStatus.SUSPENDED } }),
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
      this.prisma.paymentRecord.count({ where: { paymentStatus: PaymentStatus.PENDING } }),
      this.prisma.auditLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: { actor: { select: { email: true, displayName: true } } },
      }),
      this.prisma.licence.findMany({
        where: {
          status: LicenseStatus.ACTIVE,
          expiresAt: { gte: new Date(today), lte: new Date(in30) },
        },
        orderBy: { expiresAt: 'asc' },
        take: 10,
        include: { customer: { select: { companyName: true } } },
      }),
      Promise.resolve(process.env.LICENSE_SIGNING_KEY_ID ? true : false),
    ]);

    return {
      totalCustomers,
      activeLicences,
      trials,
      expiredLicences,
      suspendedLicences,
      expiringIn7Days: expiring7,
      expiringIn30Days: expiring30,
      outstandingPayments,
      signingKeyConfigured: signingKeyReady,
      recentActivity,
      upcomingRenewals: upcomingRenewals.map((licence) => ({
        id: licence.id,
        licenseId: licence.licenseId,
        companyName: licence.customer.companyName,
        expiresAt: toDateOnly(licence.expiresAt),
      })),
    };
  }
}
