import { Injectable } from '@nestjs/common';
import { AdminRole, PaymentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { AuditService } from '@/audit/audit.service';
import { ApiException } from '@/common/exceptions/api.exception';
import { ERROR_CODES } from '@/common/constants/error-codes';
import { AuthenticatedAdmin } from '@/auth/interfaces/authenticated-admin.interface';
import { CreatePaymentDto, UpdatePaymentDto } from './dto/payment.dto';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async list(query: {
    page: number;
    pageSize: number;
    customerId?: string;
    licenceId?: string;
    paymentStatus?: PaymentStatus;
  }) {
    const where: Prisma.PaymentRecordWhereInput = {};
    if (query.customerId) where.customerId = query.customerId;
    if (query.licenceId) where.licenceId = query.licenceId;
    if (query.paymentStatus) where.paymentStatus = query.paymentStatus;

    const [total, items] = await Promise.all([
      this.prisma.paymentRecord.count({ where }),
      this.prisma.paymentRecord.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { createdAt: 'desc' },
        include: { customer: true, licence: true },
      }),
    ]);

    return { total, items };
  }

  async create(admin: AuthenticatedAdmin, dto: CreatePaymentDto) {
    this.assertCanWrite(admin.role);
    await this.ensureCustomer(dto.customerId);
    if (dto.licenceId) {
      await this.ensureLicence(dto.licenceId, dto.customerId);
    }

    const payment = await this.prisma.paymentRecord.create({
      data: {
        customerId: dto.customerId,
        licenceId: dto.licenceId,
        amountPence: dto.amountPence,
        currency: dto.currency ?? 'GBP',
        paymentStatus: dto.paymentStatus ?? PaymentStatus.PENDING,
        paymentMethod: dto.paymentMethod,
        paymentReference: dto.paymentReference,
        invoiceReference: dto.invoiceReference,
        paidAt: dto.paidAt ? new Date(dto.paidAt) : null,
        periodStart: dto.periodStart ? new Date(dto.periodStart) : null,
        periodEnd: dto.periodEnd ? new Date(dto.periodEnd) : null,
        notes: dto.notes,
        recordedByAdminId: admin.sub,
      },
    });

    await this.auditService.record({
      actorAdminId: admin.sub,
      action: 'payment.created',
      entityType: 'PaymentRecord',
      entityId: payment.id,
      customerId: payment.customerId,
      licenceId: payment.licenceId ?? undefined,
      metadata: { amountPence: payment.amountPence, paymentStatus: payment.paymentStatus },
    });

    return payment;
  }

  async update(admin: AuthenticatedAdmin, id: string, dto: UpdatePaymentDto) {
    this.assertCanWrite(admin.role);
    const existing = await this.getPaymentOrThrow(id);

    const payment = await this.prisma.paymentRecord.update({
      where: { id },
      data: {
        amountPence: dto.amountPence,
        currency: dto.currency,
        paymentStatus: dto.paymentStatus,
        paymentMethod: dto.paymentMethod,
        paymentReference: dto.paymentReference,
        invoiceReference: dto.invoiceReference,
        paidAt: dto.paidAt ? new Date(dto.paidAt) : undefined,
        periodStart: dto.periodStart ? new Date(dto.periodStart) : undefined,
        periodEnd: dto.periodEnd ? new Date(dto.periodEnd) : undefined,
        notes: dto.notes,
      },
    });

    await this.auditService.record({
      actorAdminId: admin.sub,
      action: 'payment.updated',
      entityType: 'PaymentRecord',
      entityId: id,
      customerId: existing.customerId,
      licenceId: existing.licenceId ?? undefined,
      metadata: { changes: dto },
    });

    return payment;
  }

  private assertCanWrite(role: AdminRole): void {
    if (role === AdminRole.SUPPORT) {
      throw new ApiException(ERROR_CODES.FORBIDDEN_ROLE, 'Support users cannot record payments', 403);
    }
  }

  private async ensureCustomer(customerId: string): Promise<void> {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) {
      throw new ApiException(ERROR_CODES.CUSTOMER_NOT_FOUND, 'Customer not found', 404);
    }
  }

  private async ensureLicence(licenceId: string, customerId: string): Promise<void> {
    const licence = await this.prisma.licence.findFirst({ where: { id: licenceId, customerId } });
    if (!licence) {
      throw new ApiException(ERROR_CODES.LICENCE_NOT_FOUND, 'Licence not found for customer', 404);
    }
  }

  private async getPaymentOrThrow(id: string) {
    const payment = await this.prisma.paymentRecord.findUnique({ where: { id } });
    if (!payment) {
      throw new ApiException(ERROR_CODES.PAYMENT_NOT_FOUND, 'Payment record not found', 404);
    }
    return payment;
  }
}
