import { Injectable } from '@nestjs/common';
import { CustomerStatus, Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { AuditService } from '@/audit/audit.service';
import { ApiException } from '@/common/exceptions/api.exception';
import { ERROR_CODES } from '@/common/constants/error-codes';
import { AuthenticatedAdmin } from '@/auth/interfaces/authenticated-admin.interface';
import { CreateCustomerDto, UpdateCustomerDto } from './dto/customer.dto';
import { deriveEffectiveStatus, toDateOnly } from '@/licences/licence.util';

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async list(query: { page: number; pageSize: number; search?: string; status?: CustomerStatus }) {
    const where = this.buildSearchWhere(query.search, query.status);
    const [total, customers] = await Promise.all([
      this.prisma.customer.count({ where }),
      this.prisma.customer.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { updatedAt: 'desc' },
        include: {
          licences: { orderBy: { expiresAt: 'desc' }, take: 1 },
          payments: { where: { paymentStatus: 'PENDING' }, take: 1 },
          _count: { select: { licences: true } },
        },
      }),
    ]);

    return {
      total,
      items: customers.map((customer) => ({
        id: customer.id,
        companyName: customer.companyName,
        contactName: customer.contactName,
        email: customer.email,
        status: customer.status,
        currentPlan: customer.licences[0]?.plan ?? null,
        licenceExpiry: customer.licences[0] ? toDateOnly(customer.licences[0].expiresAt) : null,
        hasOutstandingPayment: customer.payments.length > 0,
        licenceCount: customer._count.licences,
        updatedAt: customer.updatedAt.toISOString(),
      })),
    };
  }

  async create(admin: AuthenticatedAdmin, dto: CreateCustomerDto) {
    const customer = await this.prisma.customer.create({
      data: {
        companyName: dto.companyName,
        tradingName: dto.tradingName,
        contactName: dto.contactName,
        email: dto.email.trim().toLowerCase(),
        phone: dto.phone,
        addressLine1: dto.addressLine1,
        addressLine2: dto.addressLine2,
        city: dto.city,
        postcode: dto.postcode,
        country: dto.country ?? 'GB',
        status: dto.status ?? CustomerStatus.PROSPECT,
        notes: dto.notes,
      },
    });

    await this.auditService.record({
      actorAdminId: admin.sub,
      action: 'customer.created',
      entityType: 'Customer',
      entityId: customer.id,
      customerId: customer.id,
      metadata: { companyName: customer.companyName },
    });

    return customer;
  }

  async findOne(id: string) {
    const customer = await this.getCustomerOrThrow(id);
    const licences = await this.prisma.licence.findMany({
      where: { customerId: id },
      orderBy: { createdAt: 'desc' },
    });

    return {
      ...customer,
      licences: licences.map((licence) => ({
        id: licence.id,
        licenseId: licence.licenseId,
        plan: licence.plan,
        status: licence.status,
        effectiveStatus: deriveEffectiveStatus(licence),
        expiresAt: toDateOnly(licence.expiresAt),
      })),
    };
  }

  async update(admin: AuthenticatedAdmin, id: string, dto: UpdateCustomerDto) {
    await this.getCustomerOrThrow(id);
    const customer = await this.prisma.customer.update({
      where: { id },
      data: {
        ...dto,
        email: dto.email?.trim().toLowerCase(),
      },
    });

    await this.auditService.record({
      actorAdminId: admin.sub,
      action: dto.status ? 'customer.status_changed' : 'customer.updated',
      entityType: 'Customer',
      entityId: id,
      customerId: id,
      metadata: { changes: dto },
    });

    return customer;
  }

  async listLicences(customerId: string) {
    await this.getCustomerOrThrow(customerId);
    return this.prisma.licence.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listPayments(customerId: string) {
    await this.getCustomerOrThrow(customerId);
    return this.prisma.paymentRecord.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listAudit(customerId: string) {
    await this.getCustomerOrThrow(customerId);
    return this.prisma.auditLog.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  private buildSearchWhere(search?: string, status?: CustomerStatus): Prisma.CustomerWhereInput {
    const where: Prisma.CustomerWhereInput = {};
    if (status) {
      where.status = status;
    }
    if (!search?.trim()) {
      return where;
    }

    const term = search.trim();
    where.OR = [
      { companyName: { contains: term, mode: 'insensitive' } },
      { contactName: { contains: term, mode: 'insensitive' } },
      { email: { contains: term, mode: 'insensitive' } },
      { licences: { some: { licenseId: { contains: term, mode: 'insensitive' } } } },
      { licences: { some: { installations: { some: { installationId: { contains: term, mode: 'insensitive' } } } } } },
      { payments: { some: { paymentReference: { contains: term, mode: 'insensitive' } } } },
      { payments: { some: { invoiceReference: { contains: term, mode: 'insensitive' } } } },
    ];
    return where;
  }

  private async getCustomerOrThrow(id: string) {
    const customer = await this.prisma.customer.findUnique({ where: { id } });
    if (!customer) {
      throw new ApiException(ERROR_CODES.CUSTOMER_NOT_FOUND, 'Customer not found', 404);
    }
    return customer;
  }
}
