import { Injectable } from '@nestjs/common';
import { AdminRole } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { AuthService } from '@/auth/auth.service';
import { AuditService } from '@/audit/audit.service';
import { ApiException } from '@/common/exceptions/api.exception';
import { ERROR_CODES } from '@/common/constants/error-codes';
import { AuthenticatedAdmin } from '@/auth/interfaces/authenticated-admin.interface';
import { CreateAdminDto, ResetAdminPasswordDto, UpdateAdminDto } from './dto/admin.dto';

@Injectable()
export class AdminsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    private readonly auditService: AuditService,
  ) {}

  async list(query: { page: number; pageSize: number }) {
    const [total, items] = await Promise.all([
      this.prisma.admin.count(),
      this.prisma.admin.findMany({
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          displayName: true,
          role: true,
          isActive: true,
          lastLoginAt: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
    ]);
    return { total, items };
  }

  async create(actor: AuthenticatedAdmin, dto: CreateAdminDto) {
    this.assertCanManageTarget(actor, dto.role);
    const passwordHash = await this.authService.hashPassword(dto.password);
    const admin = await this.prisma.admin.create({
      data: {
        email: dto.email.trim().toLowerCase(),
        passwordHash,
        displayName: dto.displayName,
        role: dto.role,
      },
      select: {
        id: true,
        email: true,
        displayName: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
    });

    await this.auditService.record({
      actorAdminId: actor.sub,
      action: 'admin.created',
      entityType: 'Admin',
      entityId: admin.id,
      metadata: { email: admin.email, role: admin.role },
    });

    return admin;
  }

  async update(actor: AuthenticatedAdmin, id: string, dto: UpdateAdminDto) {
    const existing = await this.getAdminOrThrow(id);
    if (dto.role) {
      this.assertCanManageTarget(actor, dto.role);
    }
    if (existing.role === AdminRole.SUPER_ADMIN && actor.role !== AdminRole.SUPER_ADMIN) {
      throw new ApiException(ERROR_CODES.FORBIDDEN_ROLE, 'Only SUPER_ADMIN can modify SUPER_ADMIN accounts', 403);
    }

    const admin = await this.prisma.admin.update({
      where: { id },
      data: {
        displayName: dto.displayName,
        role: dto.role,
        isActive: dto.isActive,
      },
      select: {
        id: true,
        email: true,
        displayName: true,
        role: true,
        isActive: true,
        updatedAt: true,
      },
    });

    await this.auditService.record({
      actorAdminId: actor.sub,
      action: 'admin.updated',
      entityType: 'Admin',
      entityId: id,
      metadata: { changes: dto },
    });

    return admin;
  }

  async resetPassword(actor: AuthenticatedAdmin, id: string, dto: ResetAdminPasswordDto) {
    const existing = await this.getAdminOrThrow(id);
    if (existing.role === AdminRole.SUPER_ADMIN && actor.role !== AdminRole.SUPER_ADMIN) {
      throw new ApiException(ERROR_CODES.FORBIDDEN_ROLE, 'Only SUPER_ADMIN can reset SUPER_ADMIN passwords', 403);
    }

    await this.prisma.admin.update({
      where: { id },
      data: { passwordHash: await this.authService.hashPassword(dto.password) },
    });

    await this.prisma.refreshToken.deleteMany({ where: { adminId: id } });

    await this.auditService.record({
      actorAdminId: actor.sub,
      action: 'admin.password_reset',
      entityType: 'Admin',
      entityId: id,
    });

    return { success: true };
  }

  async deactivate(actor: AuthenticatedAdmin, id: string) {
    const existing = await this.getAdminOrThrow(id);
    if (existing.role === AdminRole.SUPER_ADMIN && actor.role !== AdminRole.SUPER_ADMIN) {
      throw new ApiException(ERROR_CODES.FORBIDDEN_ROLE, 'Only SUPER_ADMIN can deactivate SUPER_ADMIN accounts', 403);
    }
    if (existing.id === actor.sub) {
      throw new ApiException(ERROR_CODES.FORBIDDEN_ROLE, 'You cannot deactivate your own account', 403);
    }

    await this.prisma.admin.update({ where: { id }, data: { isActive: false } });
    await this.prisma.refreshToken.deleteMany({ where: { adminId: id } });

    await this.auditService.record({
      actorAdminId: actor.sub,
      action: 'admin.deactivated',
      entityType: 'Admin',
      entityId: id,
    });

    return { success: true };
  }

  private assertCanManageTarget(actor: AuthenticatedAdmin, targetRole: AdminRole): void {
    if (actor.role !== AdminRole.SUPER_ADMIN && targetRole === AdminRole.SUPER_ADMIN) {
      throw new ApiException(ERROR_CODES.FORBIDDEN_ROLE, 'Only SUPER_ADMIN can manage SUPER_ADMIN accounts', 403);
    }
    if (actor.role === AdminRole.SUPPORT) {
      throw new ApiException(ERROR_CODES.FORBIDDEN_ROLE, 'Support users cannot manage administrators', 403);
    }
  }

  private async getAdminOrThrow(id: string) {
    const admin = await this.prisma.admin.findUnique({ where: { id } });
    if (!admin) {
      throw new ApiException(ERROR_CODES.ADMIN_NOT_FOUND, 'Administrator not found', 404);
    }
    return admin;
  }
}
