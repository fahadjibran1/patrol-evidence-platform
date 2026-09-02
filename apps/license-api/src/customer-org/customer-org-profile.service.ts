import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { AuditService } from '@/audit/audit.service';
import { ApiException } from '@/common/exceptions/api.exception';
import { ERROR_CODES } from '@/common/constants/error-codes';
import { AuthenticatedCustomer } from '@/customer-auth/interfaces/authenticated-customer.interface';
import { permissionsForRole } from './customer-permissions';
import { UpdateOrgProfileDto, UpdateOwnProfileDto } from './dto/org.dto';

@Injectable()
export class CustomerOrgProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async getOrganisation(actor: AuthenticatedCustomer) {
    const [user, company] = await Promise.all([
      this.prisma.customerUser.findUnique({ where: { id: actor.sub } }),
      this.prisma.customer.findUnique({ where: { id: actor.companyId } }),
    ]);
    if (!user || !company) {
      throw new ApiException(ERROR_CODES.CUSTOMER_USER_NOT_FOUND, 'Organisation not found', 404);
    }

    return {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        phone: user.phone,
        role: user.role,
        permissions: permissionsForRole(user.role),
        emailVerified: Boolean(user.emailVerifiedAt),
        mfaEnabled: user.mfaEnabled,
        notificationPreferences: {
          licence: user.notifyLicence,
          general: user.notifyGeneral,
          system: user.notifySystem,
        },
      },
      company: {
        id: company.id,
        companyName: company.companyName,
        tradingName: company.tradingName,
        contactName: company.contactName,
        email: company.email,
        phone: company.phone,
        technicalContactName: company.technicalContactName,
        technicalContactEmail: company.technicalContactEmail,
        technicalContactPhone: company.technicalContactPhone,
        status: company.status,
      },
      billing: {
        addressLine1: company.addressLine1,
        addressLine2: company.addressLine2,
        city: company.city,
        postcode: company.postcode,
        country: company.country,
        readOnly: true,
      },
    };
  }

  async updateOwnProfile(
    actor: AuthenticatedCustomer,
    dto: UpdateOwnProfileDto,
    meta?: { ipAddress?: string; userAgent?: string },
  ) {
    await this.prisma.customerUser.update({
      where: { id: actor.sub },
      data: {
        displayName: dto.displayName?.trim(),
        phone: dto.phone === undefined ? undefined : dto.phone,
        notifyLicence: dto.notifyLicence,
        notifyGeneral: dto.notifyGeneral,
        notifySystem: dto.notifySystem,
      },
    });

    await this.auditService.record({
      actorCustomerUserId: actor.sub,
      action: 'customer.profile.updated',
      entityType: 'CustomerUser',
      entityId: actor.sub,
      customerId: actor.companyId,
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
      metadata: { fields: Object.keys(dto) },
    });

    return this.getOrganisation(actor);
  }

  async updateOrganisation(
    actor: AuthenticatedCustomer,
    dto: UpdateOrgProfileDto,
    meta?: { ipAddress?: string; userAgent?: string },
  ) {
    await this.prisma.customer.update({
      where: { id: actor.companyId },
      data: {
        contactName: dto.contactName,
        phone: dto.phone === undefined ? undefined : dto.phone,
        technicalContactName: dto.technicalContactName,
        technicalContactEmail: dto.technicalContactEmail?.trim().toLowerCase(),
        technicalContactPhone: dto.technicalContactPhone,
      },
    });

    // Optional org-wide notification defaults applied to the actor only as template;
    // full org-wide default propagation can be added later.
    if (
      dto.defaultNotifyLicence !== undefined
      || dto.defaultNotifyGeneral !== undefined
      || dto.defaultNotifySystem !== undefined
    ) {
      await this.prisma.customerUser.update({
        where: { id: actor.sub },
        data: {
          notifyLicence: dto.defaultNotifyLicence,
          notifyGeneral: dto.defaultNotifyGeneral,
          notifySystem: dto.defaultNotifySystem,
        },
      });
    }

    await this.auditService.record({
      actorCustomerUserId: actor.sub,
      action: 'customer.organisation.updated',
      entityType: 'Customer',
      entityId: actor.companyId,
      customerId: actor.companyId,
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
      metadata: { fields: Object.keys(dto) },
    });

    return this.getOrganisation(actor);
  }
}
