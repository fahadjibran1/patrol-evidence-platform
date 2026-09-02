import { Injectable } from '@nestjs/common';
import { CustomerRole } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { AuditService } from '@/audit/audit.service';
import { ApiException } from '@/common/exceptions/api.exception';
import { ERROR_CODES } from '@/common/constants/error-codes';
import { AuthenticatedCustomer } from '@/customer-auth/interfaces/authenticated-customer.interface';
import { canAssignRole, permissionsForRole } from './customer-permissions';
import { UpdateMemberActiveDto, UpdateMemberRoleDto } from './dto/org.dto';

@Injectable()
export class CustomerMembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async list(actor: AuthenticatedCustomer) {
    const members = await this.prisma.customerUser.findMany({
      where: { customerId: actor.companyId },
      orderBy: [{ role: 'asc' }, { email: 'asc' }],
    });
    return {
      items: members.map((member) => ({
        id: member.id,
        email: member.email,
        displayName: member.displayName,
        phone: member.phone,
        role: member.role,
        permissions: permissionsForRole(member.role),
        isActive: member.isActive,
        emailVerified: Boolean(member.emailVerifiedAt),
        lastLoginAt: member.lastLoginAt?.toISOString() ?? null,
        createdAt: member.createdAt.toISOString(),
      })),
      total: members.length,
    };
  }

  async updateRole(
    actor: AuthenticatedCustomer,
    memberId: string,
    dto: UpdateMemberRoleDto,
    meta?: { ipAddress?: string; userAgent?: string },
  ) {
    const member = await this.requireSameOrgMember(actor.companyId, memberId);
    if (!canAssignRole(actor.role, dto.role)) {
      throw new ApiException(ERROR_CODES.CUSTOMER_PERMISSION_DENIED, 'Cannot assign this role', 403);
    }
    if (member.role === CustomerRole.OWNER && dto.role !== CustomerRole.OWNER) {
      await this.assertNotLastOwner(actor.companyId, member.id);
    }

    const updated = await this.prisma.customerUser.update({
      where: { id: member.id },
      data: { role: dto.role },
    });

    await this.auditService.record({
      actorCustomerUserId: actor.sub,
      action: 'customer.member.role_changed',
      entityType: 'CustomerUser',
      entityId: member.id,
      customerId: actor.companyId,
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
      metadata: { from: member.role, to: dto.role, email: member.email },
    });

    return {
      id: updated.id,
      role: updated.role,
      permissions: permissionsForRole(updated.role),
    };
  }

  async setActive(
    actor: AuthenticatedCustomer,
    memberId: string,
    dto: UpdateMemberActiveDto,
    meta?: { ipAddress?: string; userAgent?: string },
  ) {
    const member = await this.requireSameOrgMember(actor.companyId, memberId);
    if (member.id === actor.sub && !dto.isActive) {
      throw new ApiException(ERROR_CODES.CUSTOMER_PERMISSION_DENIED, 'You cannot disable your own account', 400);
    }
    if (member.role === CustomerRole.OWNER && !dto.isActive) {
      await this.assertNotLastOwner(actor.companyId, member.id);
    }

    const updated = await this.prisma.customerUser.update({
      where: { id: member.id },
      data: { isActive: dto.isActive },
    });

    if (!dto.isActive) {
      await this.prisma.customerSession.updateMany({
        where: { customerUserId: member.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.prisma.customerRefreshToken.deleteMany({ where: { customerUserId: member.id } });
    }

    await this.auditService.record({
      actorCustomerUserId: actor.sub,
      action: dto.isActive ? 'customer.member.enabled' : 'customer.member.disabled',
      entityType: 'CustomerUser',
      entityId: member.id,
      customerId: actor.companyId,
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
      metadata: { email: member.email },
    });

    return { id: updated.id, isActive: updated.isActive };
  }

  async remove(
    actor: AuthenticatedCustomer,
    memberId: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ) {
    const member = await this.requireSameOrgMember(actor.companyId, memberId);
    if (member.id === actor.sub) {
      throw new ApiException(ERROR_CODES.CUSTOMER_PERMISSION_DENIED, 'You cannot remove yourself', 400);
    }
    if (member.role === CustomerRole.OWNER) {
      await this.assertNotLastOwner(actor.companyId, member.id);
    }

    await this.prisma.customerUser.delete({ where: { id: member.id } });
    await this.auditService.record({
      actorCustomerUserId: actor.sub,
      action: 'customer.member.removed',
      entityType: 'CustomerUser',
      entityId: member.id,
      customerId: actor.companyId,
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
      metadata: { email: member.email, role: member.role },
    });

    return { success: true };
  }

  private async requireSameOrgMember(companyId: string, memberId: string) {
    const member = await this.prisma.customerUser.findFirst({
      where: { id: memberId, customerId: companyId },
    });
    if (!member) {
      throw new ApiException(ERROR_CODES.CUSTOMER_USER_NOT_FOUND, 'Organisation member not found', 404);
    }
    return member;
  }

  private async assertNotLastOwner(companyId: string, excludingUserId: string): Promise<void> {
    const owners = await this.prisma.customerUser.count({
      where: {
        customerId: companyId,
        role: CustomerRole.OWNER,
        isActive: true,
        id: { not: excludingUserId },
      },
    });
    if (owners === 0) {
      throw new ApiException(
        ERROR_CODES.CUSTOMER_LAST_OWNER,
        'Cannot remove or demote the last Owner',
        400,
      );
    }
  }
}
