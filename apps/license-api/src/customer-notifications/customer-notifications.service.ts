import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { AuthenticatedCustomer } from '@/customer-auth/interfaces/authenticated-customer.interface';
import {
  categoryForNotificationType,
  notificationTypesForCategory,
  type NotificationCategory,
} from '@/customer-portal/customer-portal.util';

@Injectable()
export class CustomerNotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    actor: AuthenticatedCustomer,
    options?: { category?: NotificationCategory; page?: number; pageSize?: number },
  ) {
    const page = Math.max(1, options?.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, options?.pageSize ?? 25));
    const types = notificationTypesForCategory(options?.category);

    const where: Prisma.NotificationLogWhereInput = {
      customerId: actor.companyId,
      ...(types ? { notificationType: { in: types } } : {}),
    };

    const [total, rows] = await Promise.all([
      this.prisma.notificationLog.count({ where }),
      this.prisma.notificationLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      items: rows.map((row) => ({
        id: row.id,
        category: categoryForNotificationType(row.notificationType),
        notificationType: row.notificationType,
        subject: row.subject,
        status: row.status,
        createdAt: row.createdAt.toISOString(),
        sentAt: row.sentAt?.toISOString() ?? null,
        licenceId: row.licenceId,
      })),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }
}
