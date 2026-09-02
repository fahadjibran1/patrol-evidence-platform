import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { AuditService } from '@/audit/audit.service';
import { ApiException } from '@/common/exceptions/api.exception';
import { ERROR_CODES } from '@/common/constants/error-codes';
import { AuthenticatedCustomer } from '@/customer-auth/interfaces/authenticated-customer.interface';
import { roleHasPermission, CustomerPermission } from './customer-permissions';

@Injectable()
export class CustomerSessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async list(actor: AuthenticatedCustomer) {
    const sessions = await this.prisma.customerSession.findMany({
      where: { customerUserId: actor.sub },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return {
      items: sessions.map((session) => ({
        id: session.id,
        ipAddress: session.ipAddress,
        userAgent: session.userAgent,
        rememberMe: session.rememberMe,
        expiresAt: session.expiresAt.toISOString(),
        revokedAt: session.revokedAt?.toISOString() ?? null,
        createdAt: session.createdAt.toISOString(),
        current: session.id === actor.sessionId,
      })),
    };
  }

  async revoke(
    actor: AuthenticatedCustomer,
    sessionId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ) {
    const session = await this.prisma.customerSession.findFirst({
      where: { id: sessionId, customerUserId: actor.sub },
    });
    if (!session) {
      throw new ApiException(ERROR_CODES.CUSTOMER_SESSION_NOT_FOUND, 'Session not found', 404);
    }

    await this.prisma.customerSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });
    if (session.refreshTokenId) {
      await this.prisma.customerRefreshToken.deleteMany({ where: { id: session.refreshTokenId } });
    }

    await this.auditService.record({
      actorCustomerUserId: actor.sub,
      action: 'customer.session.revoked',
      entityType: 'CustomerSession',
      entityId: session.id,
      customerId: actor.companyId,
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return { success: true };
  }

  async revokeOthers(actor: AuthenticatedCustomer, meta?: { ipAddress?: string; userAgent?: string }) {
    if (!roleHasPermission(actor.role, CustomerPermission.MANAGE_SESSIONS)) {
      throw new ApiException(ERROR_CODES.CUSTOMER_PERMISSION_DENIED, 'Insufficient permissions', 403);
    }

    const sessions = await this.prisma.customerSession.findMany({
      where: {
        customerUserId: actor.sub,
        revokedAt: null,
        ...(actor.sessionId ? { id: { not: actor.sessionId } } : {}),
      },
    });

    for (const session of sessions) {
      await this.prisma.customerSession.update({
        where: { id: session.id },
        data: { revokedAt: new Date() },
      });
      if (session.refreshTokenId) {
        await this.prisma.customerRefreshToken.deleteMany({ where: { id: session.refreshTokenId } });
      }
    }

    await this.auditService.record({
      actorCustomerUserId: actor.sub,
      action: 'customer.session.revoked_others',
      entityType: 'CustomerUser',
      entityId: actor.sub,
      customerId: actor.companyId,
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
      metadata: { count: sessions.length },
    });

    return { success: true, revoked: sessions.length };
  }
}
