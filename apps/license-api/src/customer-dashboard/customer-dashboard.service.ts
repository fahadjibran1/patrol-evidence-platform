import { Injectable } from '@nestjs/common';
import { LicenseStatus, NotificationStatus } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { AuthenticatedCustomer } from '@/customer-auth/interfaces/authenticated-customer.interface';
import {
  daysUntilExpiry,
  toCustomerSafeLicence,
} from '@/customer-portal/customer-portal.util';

@Injectable()
export class CustomerDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary(actor: AuthenticatedCustomer) {
    const companyId = actor.companyId;

    const [company, licences, latestNotification] = await Promise.all([
      this.prisma.customer.findUniqueOrThrow({ where: { id: companyId } }),
      this.prisma.licence.findMany({
        where: { customerId: companyId },
        include: { currentVersion: true },
        orderBy: [{ expiresAt: 'desc' }, { createdAt: 'desc' }],
      }),
      this.prisma.notificationLog.findFirst({
        where: { customerId: companyId },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const currentLicence =
      licences.find((licence) => licence.status === LicenseStatus.ACTIVE)
      ?? licences[0]
      ?? null;

    const safeCurrent = currentLicence ? toCustomerSafeLicence(currentLicence) : null;
    const renewalCountdownDays = currentLicence ? daysUntilExpiry(currentLicence.expiresAt) : null;

    const latestDownload = licences
      .filter((licence) => licence.lastDownloadedAt)
      .sort((a, b) => (b.lastDownloadedAt!.getTime() - a.lastDownloadedAt!.getTime()))[0];

    return {
      company: {
        id: company.id,
        companyName: company.companyName,
        tradingName: company.tradingName,
        status: company.status,
        email: company.email,
      },
      currentLicence: safeCurrent,
      status: safeCurrent?.effectiveStatus ?? null,
      plan: safeCurrent?.plan ?? null,
      expiry: safeCurrent?.expiresAt ?? null,
      deviceAllowance: safeCurrent?.maxDevices ?? null,
      latestDownload: latestDownload
        ? {
            licenceId: latestDownload.id,
            licenseId: latestDownload.licenseId,
            downloadedAt: latestDownload.lastDownloadedAt!.toISOString(),
            downloadCount: latestDownload.downloadCount,
          }
        : null,
      latestNotification: latestNotification
        ? {
            id: latestNotification.id,
            subject: latestNotification.subject,
            status: latestNotification.status as NotificationStatus,
            createdAt: latestNotification.createdAt.toISOString(),
            notificationType: latestNotification.notificationType,
          }
        : null,
      renewalCountdownDays,
    };
  }
}
