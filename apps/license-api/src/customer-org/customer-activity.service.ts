import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { AuthenticatedCustomer } from '@/customer-auth/interfaces/authenticated-customer.interface';

/** Organisation-visible customer portal audit actions only — never admin-internal events. */
const CUSTOMER_ACTION_PREFIX = 'customer.';

@Injectable()
export class CustomerActivityService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    actor: AuthenticatedCustomer,
    options?: { page?: number; pageSize?: number },
  ) {
    const page = Math.max(1, options?.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, options?.pageSize ?? 25));

    const where: Prisma.AuditLogWhereInput = {
      customerId: actor.companyId,
      action: { startsWith: CUSTOMER_ACTION_PREFIX },
      // Exclude pure admin-actor events that happen to share a customerId (e.g. admin issued licence).
      OR: [
        { actorCustomerUserId: { not: null } },
        { actorAdminId: null },
      ],
    };

    const [total, rows] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          actorCustomerUser: { select: { displayName: true, email: true } },
        },
      }),
    ]);

    return {
      items: rows
        .filter((row) => row.action.startsWith(CUSTOMER_ACTION_PREFIX) && !row.actorAdminId)
        .map((row) => ({
          id: row.id,
          action: row.action,
          entityType: row.entityType,
          entityId: row.entityId,
          createdAt: row.createdAt.toISOString(),
          actor: row.actorCustomerUser
            ? {
                displayName: row.actorCustomerUser.displayName,
                email: row.actorCustomerUser.email,
              }
            : null,
          metadata: row.metadata,
        })),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }
}
