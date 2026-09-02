import { Injectable } from '@nestjs/common';
import {
  BillingPaymentStatus,
  InvoiceStatus,
  PaymentProvider,
  type BillingPayment,
} from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { AuditService } from '@/audit/audit.service';
import { EventBus } from '@/domain-events/event-bus.service';
import { createDomainEvent } from '@/domain-events/domain-event';
import { DOMAIN_EVENTS } from '@/domain-events/domain-event.types';
import { ApiException } from '@/common/exceptions/api.exception';
import { ERROR_CODES } from '@/common/constants/error-codes';
import type { AuthenticatedAdmin } from '@/auth/interfaces/authenticated-admin.interface';
import { InvoicesService } from '../invoices/invoices.service';
import { ListBillingPaymentsQueryDto, RecordManualPaymentDto } from './dto/billing-payment.dto';

@Injectable()
export class BillingPaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly eventBus: EventBus,
    private readonly invoicesService: InvoicesService,
  ) {}

  async list(query: ListBillingPaymentsQueryDto = {}) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    const where = {
      ...(query.invoiceId ? { invoiceId: query.invoiceId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.provider ? { provider: query.provider } : {}),
      ...(query.organisationId
        ? { invoice: { subscription: { organisationId: query.organisationId } } }
        : {}),
    };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.billingPayment.count({ where }),
      this.prisma.billingPayment.findMany({
        where,
        include: {
          invoice: {
            include: { subscription: { include: { organisation: true } } },
          },
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
    const row = await this.prisma.billingPayment.findUnique({
      where: { id },
      include: {
        invoice: {
          include: { subscription: { include: { organisation: true } } },
        },
      },
    });
    if (!row) {
      throw new ApiException(ERROR_CODES.BILLING_PAYMENT_NOT_FOUND, 'Payment not found', 404);
    }
    return this.serialize(row);
  }

  async recordManual(admin: AuthenticatedAdmin, dto: RecordManualPaymentDto) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: dto.invoiceId },
      include: { subscription: true },
    });
    if (!invoice) {
      throw new ApiException(ERROR_CODES.INVOICE_NOT_FOUND, 'Invoice not found', 404);
    }
    if (invoice.status === InvoiceStatus.PAID || invoice.status === InvoiceStatus.VOID) {
      throw new ApiException(
        ERROR_CODES.INVOICE_INVALID_STATE,
        `Cannot record payment against ${invoice.status} invoice`,
        400,
      );
    }
    if (dto.amount <= 0) {
      throw new ApiException(ERROR_CODES.BILLING_PAYMENT_INVALID, 'Amount must be positive', 400);
    }

    const receivedAt = new Date();
    const payment = await this.prisma.billingPayment.create({
      data: {
        invoiceId: invoice.id,
        provider: PaymentProvider.MANUAL,
        providerReference: dto.providerReference?.trim() || null,
        status: BillingPaymentStatus.SUCCEEDED,
        amount: dto.amount,
        currency: (dto.currency ?? invoice.currency).toUpperCase(),
        manualMethod: dto.method,
        notes: dto.notes?.trim() || null,
        receivedAt,
        recordedByAdminId: admin.sub,
      },
      include: {
        invoice: {
          include: { subscription: { include: { organisation: true } } },
        },
      },
    });

    await this.invoicesService.markPaid(invoice.id, receivedAt);

    await this.auditService.record({
      actorAdminId: admin.sub,
      action: 'billing.manual_payment_recorded',
      entityType: 'BillingPayment',
      entityId: payment.id,
      customerId: invoice.subscription.organisationId,
      metadata: {
        invoiceId: invoice.id,
        amount: dto.amount,
        method: dto.method,
        providerReference: dto.providerReference,
      },
    });

    const payload = {
      paymentId: payment.id,
      invoiceId: invoice.id,
      subscriptionId: invoice.subscriptionId,
      organisationId: invoice.subscription.organisationId,
      amount: payment.amount,
      currency: payment.currency,
      provider: PaymentProvider.MANUAL,
      providerReference: payment.providerReference,
      method: dto.method,
      actorAdminId: admin.sub,
    };

    await this.eventBus.publish(createDomainEvent(DOMAIN_EVENTS.PaymentSucceeded, payload));
    await this.eventBus.publish(createDomainEvent(DOMAIN_EVENTS.ManualPaymentRecorded, payload));

    return this.serialize(payment);
  }

  /**
   * Idempotent provider payment (Stripe). Same providerReference will not create duplicates.
   * Does not activate subscriptions — caller runs Billing Domain activation after reconciliation.
   */
  async recordProviderPayment(input: {
    invoiceId: string;
    provider: PaymentProvider;
    providerReference: string;
    amount: number;
    currency: string;
    status: BillingPaymentStatus;
    receivedAt?: Date;
    notes?: string;
  }) {
    const existing = await this.prisma.billingPayment.findUnique({
      where: {
        provider_providerReference: {
          provider: input.provider,
          providerReference: input.providerReference,
        },
      },
      include: {
        invoice: {
          include: { subscription: { include: { organisation: true } } },
        },
      },
    });
    if (existing) {
      return { payment: this.serialize(existing), created: false };
    }

    const invoice = await this.prisma.invoice.findUnique({
      where: { id: input.invoiceId },
      include: { subscription: true },
    });
    if (!invoice) {
      throw new ApiException(ERROR_CODES.INVOICE_NOT_FOUND, 'Invoice not found', 404);
    }

    const receivedAt = input.receivedAt ?? new Date();
    const payment = await this.prisma.billingPayment.create({
      data: {
        invoiceId: invoice.id,
        provider: input.provider,
        providerReference: input.providerReference,
        status: input.status,
        amount: input.amount,
        currency: input.currency.toUpperCase(),
        notes: input.notes ?? null,
        receivedAt: input.status === BillingPaymentStatus.SUCCEEDED ? receivedAt : null,
      },
      include: {
        invoice: {
          include: { subscription: { include: { organisation: true } } },
        },
      },
    });

    if (input.status === BillingPaymentStatus.SUCCEEDED && invoice.status !== InvoiceStatus.PAID) {
      await this.invoicesService.markPaid(invoice.id, receivedAt);
      await this.eventBus.publish(
        createDomainEvent(DOMAIN_EVENTS.PaymentSucceeded, {
          paymentId: payment.id,
          invoiceId: invoice.id,
          subscriptionId: invoice.subscriptionId,
          organisationId: invoice.subscription.organisationId,
          amount: payment.amount,
          currency: payment.currency,
          provider: input.provider,
          providerReference: input.providerReference,
        }),
      );
    }

    if (input.status === BillingPaymentStatus.FAILED) {
      await this.eventBus.publish(
        createDomainEvent(DOMAIN_EVENTS.PaymentFailed, {
          paymentId: payment.id,
          invoiceId: invoice.id,
          subscriptionId: invoice.subscriptionId,
          organisationId: invoice.subscription.organisationId,
          amount: payment.amount,
          currency: payment.currency,
          provider: input.provider,
          providerReference: input.providerReference,
        }),
      );
    }

    return { payment: this.serialize(payment), created: true };
  }

  serialize(
    row: BillingPayment & {
      invoice?: {
        number: string;
        subscription: { organisationId: string; organisation: { companyName: string } };
      };
    },
  ) {
    return {
      id: row.id,
      invoiceId: row.invoiceId,
      invoiceNumber: row.invoice?.number ?? null,
      organisationId: row.invoice?.subscription.organisationId ?? null,
      organisationName: row.invoice?.subscription.organisation.companyName ?? null,
      provider: row.provider,
      providerReference: row.providerReference,
      status: row.status,
      amount: row.amount,
      currency: row.currency,
      manualMethod: row.manualMethod,
      notes: row.notes,
      receivedAt: row.receivedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
