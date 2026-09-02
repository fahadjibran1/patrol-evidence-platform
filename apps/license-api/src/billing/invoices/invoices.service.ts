import { Injectable } from '@nestjs/common';
import { InvoiceStatus, type Invoice, type Subscription, type Plan } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { AuditService } from '@/audit/audit.service';
import { EventBus } from '@/domain-events/event-bus.service';
import { createDomainEvent } from '@/domain-events/domain-event';
import { DOMAIN_EVENTS } from '@/domain-events/domain-event.types';
import { ApiException } from '@/common/exceptions/api.exception';
import { ERROR_CODES } from '@/common/constants/error-codes';
import type { AuthenticatedAdmin } from '@/auth/interfaces/authenticated-admin.interface';
import { priceForInterval } from '../shared/billing.util';
import { ListInvoicesQueryDto } from './dto/invoice.dto';

@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly eventBus: EventBus,
  ) {}

  async list(query: ListInvoicesQueryDto = {}) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    const where = {
      ...(query.subscriptionId ? { subscriptionId: query.subscriptionId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.organisationId
        ? { subscription: { organisationId: query.organisationId } }
        : {}),
    };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.invoice.count({ where }),
      this.prisma.invoice.findMany({
        where,
        include: {
          subscription: { include: { organisation: true, plan: true } },
          payments: true,
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      items: rows.map((row) => this.serialize(row)),
      total,
      page,
      pageSize,
    };
  }

  async getById(id: string) {
    const row = await this.prisma.invoice.findUnique({
      where: { id },
      include: {
        subscription: { include: { organisation: true, plan: true } },
        payments: true,
      },
    });
    if (!row) {
      throw new ApiException(ERROR_CODES.INVOICE_NOT_FOUND, 'Invoice not found', 404);
    }
    return this.serialize(row);
  }

  async createForSubscription(subscriptionId: string, admin?: AuthenticatedAdmin) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: { plan: true, organisation: true },
    });
    if (!subscription) {
      throw new ApiException(ERROR_CODES.SUBSCRIPTION_NOT_FOUND, 'Subscription not found', 404);
    }

    const subtotal = priceForInterval(
      subscription.plan.monthlyPrice,
      subscription.plan.annualPrice,
      subscription.billingInterval,
    );
    const now = new Date();
    const dueAt = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    const number = await this.allocateInvoiceNumber(now.getUTCFullYear());

    const invoice = await this.prisma.invoice.create({
      data: {
        subscriptionId,
        number,
        status: InvoiceStatus.OPEN,
        subtotal,
        tax: 0,
        discount: 0,
        total: subtotal,
        currency: subscription.plan.currency,
        issuedAt: now,
        dueAt,
      },
      include: {
        subscription: { include: { organisation: true, plan: true } },
        payments: true,
      },
    });

    if (admin) {
      await this.auditService.record({
        actorAdminId: admin.sub,
        action: 'billing.invoice_created',
        entityType: 'Invoice',
        entityId: invoice.id,
        customerId: subscription.organisationId,
        metadata: { number: invoice.number, total: invoice.total },
      });
    }

    await this.eventBus.publish(
      createDomainEvent(DOMAIN_EVENTS.InvoiceCreated, {
        invoiceId: invoice.id,
        subscriptionId,
        organisationId: subscription.organisationId,
        number: invoice.number,
        total: invoice.total,
        currency: invoice.currency,
      }),
    );

    return this.serialize(invoice);
  }

  async markPaid(invoiceId: string, paidAt = new Date()) {
    const invoice = await this.prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        status: InvoiceStatus.PAID,
        paidAt,
      },
      include: {
        subscription: { include: { organisation: true, plan: true } },
        payments: true,
      },
    });

    await this.eventBus.publish(
      createDomainEvent(DOMAIN_EVENTS.InvoicePaid, {
        invoiceId: invoice.id,
        subscriptionId: invoice.subscriptionId,
        organisationId: invoice.subscription.organisationId,
        number: invoice.number,
        total: invoice.total,
        currency: invoice.currency,
        paidAt: paidAt.toISOString(),
      }),
    );

    return this.serialize(invoice);
  }

  async markOverdue(invoiceId: string) {
    const invoice = await this.prisma.invoice.update({
      where: { id: invoiceId },
      data: { status: InvoiceStatus.OVERDUE },
      include: {
        subscription: { include: { organisation: true, plan: true } },
        payments: true,
      },
    });

    await this.eventBus.publish(
      createDomainEvent(DOMAIN_EVENTS.InvoiceOverdue, {
        invoiceId: invoice.id,
        subscriptionId: invoice.subscriptionId,
        organisationId: invoice.subscription.organisationId,
        number: invoice.number,
        total: invoice.total,
      }),
    );

    return this.serialize(invoice);
  }

  private async allocateInvoiceNumber(year: number): Promise<string> {
    const seq = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.invoiceNumberSequence.findUnique({ where: { year } });
      if (!existing) {
        await tx.invoiceNumberSequence.create({ data: { year, lastValue: 1 } });
        return 1;
      }
      const updated = await tx.invoiceNumberSequence.update({
        where: { year },
        data: { lastValue: { increment: 1 } },
      });
      return updated.lastValue;
    });
    return `INV-${year}-${String(seq).padStart(6, '0')}`;
  }

  serialize(
    row: Invoice & {
      subscription: Subscription & {
        organisation: { id: string; companyName: string };
        plan: Plan;
      };
      payments?: Array<{ id: string; status: string; amount: number }>;
    },
  ) {
    return {
      id: row.id,
      subscriptionId: row.subscriptionId,
      organisationId: row.subscription.organisationId,
      organisationName: row.subscription.organisation.companyName,
      planCode: row.subscription.plan.code,
      number: row.number,
      status: row.status,
      subtotal: row.subtotal,
      tax: row.tax,
      discount: row.discount,
      total: row.total,
      currency: row.currency,
      issuedAt: row.issuedAt?.toISOString() ?? null,
      dueAt: row.dueAt?.toISOString() ?? null,
      paidAt: row.paidAt?.toISOString() ?? null,
      paymentCount: row.payments?.length ?? 0,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
