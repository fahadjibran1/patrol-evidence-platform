import { Injectable } from '@nestjs/common';
import { LicenseStatus, LicensePlan, NotificationStatus, Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { toCsv } from './csv.util';

export interface DateRangeFilter {
  dateFrom?: string;
  dateTo?: string;
}

function dateRangeWhere(field: string, filter: DateRangeFilter): Prisma.DateTimeFilter | undefined {
  if (!filter.dateFrom && !filter.dateTo) {
    return undefined;
  }
  const where: Prisma.DateTimeFilter = {};
  if (filter.dateFrom) {
    where.gte = new Date(filter.dateFrom);
  }
  if (filter.dateTo) {
    where.lte = new Date(filter.dateTo);
  }
  return where;
}

/**
 * Produces CSV exports for the admin portal. Every query is capped at EXPORT_ROW_LIMIT rows
 * to keep exports bounded, and never selects secret-bearing columns (signedLicenseEnc,
 * payloadHash, admin passwordHash, notification message bodies, etc).
 */
const EXPORT_ROW_LIMIT = 20_000;

@Injectable()
export class ExportsService {
  constructor(private readonly prisma: PrismaService) {}

  async customersCsv(filters: { status?: string; search?: string } & DateRangeFilter): Promise<string> {
    const where: Prisma.CustomerWhereInput = {};
    if (filters.status) {
      where.status = filters.status as never;
    }
    if (filters.search?.trim()) {
      const term = filters.search.trim();
      where.OR = [
        { companyName: { contains: term, mode: 'insensitive' } },
        { email: { contains: term, mode: 'insensitive' } },
        { contactName: { contains: term, mode: 'insensitive' } },
      ];
    }
    const createdAt = dateRangeWhere('createdAt', filters);
    if (createdAt) {
      where.createdAt = createdAt;
    }

    const rows = await this.prisma.customer.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: EXPORT_ROW_LIMIT,
      select: {
        id: true,
        companyName: true,
        tradingName: true,
        contactName: true,
        email: true,
        phone: true,
        city: true,
        postcode: true,
        country: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return toCsv(
      ['id', 'companyName', 'tradingName', 'contactName', 'email', 'phone', 'city', 'postcode', 'country', 'status', 'createdAt', 'updatedAt'],
      rows,
    );
  }

  async licencesCsv(
    filters: { status?: string; plan?: string; customerId?: string } & DateRangeFilter,
  ): Promise<string> {
    const where: Prisma.LicenceWhereInput = {};
    if (filters.status) {
      where.status = filters.status as LicenseStatus;
    }
    if (filters.plan) {
      where.plan = filters.plan as LicensePlan;
    }
    if (filters.customerId) {
      where.customerId = filters.customerId;
    }
    const createdAt = dateRangeWhere('createdAt', filters);
    if (createdAt) {
      where.createdAt = createdAt;
    }

    const rows = await this.prisma.licence.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: EXPORT_ROW_LIMIT,
      select: {
        id: true,
        licenseId: true,
        customerId: true,
        plan: true,
        status: true,
        startsAt: true,
        expiresAt: true,
        maxDevices: true,
        issuedAt: true,
        createdAt: true,
        customer: { select: { companyName: true } },
      },
    });

    return toCsv(
      ['id', 'licenseId', 'customerId', 'companyName', 'plan', 'status', 'startsAt', 'expiresAt', 'maxDevices', 'issuedAt', 'createdAt'],
      rows.map((row) => ({ ...row, companyName: row.customer?.companyName ?? '' })),
    );
  }

  async renewalsCsv(filters: DateRangeFilter = {}): Promise<string> {
    const where: Prisma.LicenceVersionWhereInput = { actionType: 'RENEWED' };
    const createdAt = dateRangeWhere('createdAt', filters);
    if (createdAt) {
      where.createdAt = createdAt;
    }

    const rows = await this.prisma.licenceVersion.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: EXPORT_ROW_LIMIT,
      select: {
        id: true,
        licenceId: true,
        versionNumber: true,
        plan: true,
        maxDevices: true,
        validFrom: true,
        validUntil: true,
        reason: true,
        createdAt: true,
        licence: { select: { licenseId: true, customerId: true } },
      },
    });

    return toCsv(
      ['id', 'licenceId', 'licenseId', 'customerId', 'versionNumber', 'plan', 'maxDevices', 'validFrom', 'validUntil', 'reason', 'createdAt'],
      rows.map((row) => ({
        ...row,
        licenseId: row.licence?.licenseId ?? '',
        customerId: row.licence?.customerId ?? '',
      })),
    );
  }

  /** ADMIN/SUPER_ADMIN only — enforced by the controller's @Roles guard. */
  async revenueCsv(filters: { paymentStatus?: string } & DateRangeFilter): Promise<string> {
    const where: Prisma.PaymentRecordWhereInput = {};
    if (filters.paymentStatus) {
      where.paymentStatus = filters.paymentStatus as never;
    }
    const createdAt = dateRangeWhere('createdAt', filters);
    if (createdAt) {
      where.createdAt = createdAt;
    }

    const rows = await this.prisma.paymentRecord.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: EXPORT_ROW_LIMIT,
      select: {
        id: true,
        customerId: true,
        licenceId: true,
        amountPence: true,
        currency: true,
        paymentStatus: true,
        paymentMethod: true,
        paymentReference: true,
        invoiceReference: true,
        paidAt: true,
        periodStart: true,
        periodEnd: true,
        createdAt: true,
        customer: { select: { companyName: true } },
      },
    });

    return toCsv(
      [
        'id',
        'customerId',
        'companyName',
        'licenceId',
        'amountPence',
        'currency',
        'paymentStatus',
        'paymentMethod',
        'paymentReference',
        'invoiceReference',
        'paidAt',
        'periodStart',
        'periodEnd',
        'createdAt',
      ],
      rows.map((row) => ({ ...row, companyName: row.customer?.companyName ?? '' })),
    );
  }

  async notificationsCsv(filters: { status?: string } & DateRangeFilter): Promise<string> {
    const where: Prisma.NotificationLogWhereInput = {};
    if (filters.status) {
      where.status = filters.status as NotificationStatus;
    }
    const createdAt = dateRangeWhere('createdAt', filters);
    if (createdAt) {
      where.createdAt = createdAt;
    }

    const rows = await this.prisma.notificationLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: EXPORT_ROW_LIMIT,
      select: {
        id: true,
        notificationType: true,
        provider: true,
        recipient: true,
        subject: true,
        status: true,
        attempts: true,
        sentAt: true,
        errorMessage: true,
        licenceId: true,
        customerId: true,
        createdAt: true,
      },
    });

    return toCsv(
      ['id', 'notificationType', 'provider', 'recipient', 'subject', 'status', 'attempts', 'sentAt', 'errorMessage', 'licenceId', 'customerId', 'createdAt'],
      rows,
    );
  }

  async auditCsv(filters: { customerId?: string } & DateRangeFilter): Promise<string> {
    const where: Prisma.AuditLogWhereInput = {};
    if (filters.customerId) {
      where.customerId = filters.customerId;
    }
    const createdAt = dateRangeWhere('createdAt', filters);
    if (createdAt) {
      where.createdAt = createdAt;
    }

    const rows = await this.prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: EXPORT_ROW_LIMIT,
      select: {
        id: true,
        actorAdminId: true,
        action: true,
        entityType: true,
        entityId: true,
        customerId: true,
        licenceId: true,
        createdAt: true,
        actor: { select: { displayName: true, email: true } },
      },
    });

    return toCsv(
      ['id', 'actorAdminId', 'actorDisplayName', 'action', 'entityType', 'entityId', 'customerId', 'licenceId', 'createdAt'],
      rows.map((row) => ({ ...row, actorDisplayName: row.actor?.displayName ?? '' })),
    );
  }

  async subscriptionsCsv(filters: { organisationId?: string; status?: string } & DateRangeFilter): Promise<string> {
    const where: Prisma.SubscriptionWhereInput = {};
    if (filters.organisationId) {
      where.organisationId = filters.organisationId;
    }
    if (filters.status) {
      where.status = filters.status as never;
    }
    const createdAt = dateRangeWhere('createdAt', filters);
    if (createdAt) {
      where.createdAt = createdAt;
    }

    const rows = await this.prisma.subscription.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: EXPORT_ROW_LIMIT,
      include: {
        plan: { select: { code: true, name: true } },
        organisation: { select: { companyName: true, email: true } },
      },
    });

    return toCsv(
      [
        'id',
        'organisationId',
        'organisationName',
        'planCode',
        'status',
        'billingInterval',
        'currentPeriodStart',
        'currentPeriodEnd',
        'nextBillingDate',
        'autoRenew',
        'cancelAtPeriodEnd',
        'createdAt',
      ],
      rows.map((row) => ({
        id: row.id,
        organisationId: row.organisationId,
        organisationName: row.organisation.companyName,
        planCode: row.plan.code,
        status: row.status,
        billingInterval: row.billingInterval,
        currentPeriodStart: row.currentPeriodStart,
        currentPeriodEnd: row.currentPeriodEnd,
        nextBillingDate: row.nextBillingDate,
        autoRenew: row.autoRenew,
        cancelAtPeriodEnd: row.cancelAtPeriodEnd,
        createdAt: row.createdAt,
      })),
    );
  }

  async invoicesCsv(filters: { organisationId?: string; status?: string } & DateRangeFilter): Promise<string> {
    const where: Prisma.InvoiceWhereInput = {};
    if (filters.status) {
      where.status = filters.status as never;
    }
    if (filters.organisationId) {
      where.subscription = { organisationId: filters.organisationId };
    }
    const createdAt = dateRangeWhere('createdAt', filters);
    if (createdAt) {
      where.createdAt = createdAt;
    }

    const rows = await this.prisma.invoice.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: EXPORT_ROW_LIMIT,
      include: {
        subscription: {
          select: {
            organisationId: true,
            organisation: { select: { companyName: true } },
          },
        },
      },
    });

    return toCsv(
      ['id', 'number', 'organisationId', 'organisationName', 'status', 'subtotal', 'tax', 'discount', 'total', 'currency', 'issuedAt', 'dueAt', 'paidAt', 'createdAt'],
      rows.map((row) => ({
        id: row.id,
        number: row.number,
        organisationId: row.subscription.organisationId,
        organisationName: row.subscription.organisation.companyName,
        status: row.status,
        subtotal: row.subtotal,
        tax: row.tax,
        discount: row.discount,
        total: row.total,
        currency: row.currency,
        issuedAt: row.issuedAt,
        dueAt: row.dueAt,
        paidAt: row.paidAt,
        createdAt: row.createdAt,
      })),
    );
  }

  async billingPaymentsCsv(filters: { organisationId?: string; status?: string } & DateRangeFilter): Promise<string> {
    const where: Prisma.BillingPaymentWhereInput = {};
    if (filters.status) {
      where.status = filters.status as never;
    }
    if (filters.organisationId) {
      where.invoice = { subscription: { organisationId: filters.organisationId } };
    }
    const createdAt = dateRangeWhere('createdAt', filters);
    if (createdAt) {
      where.createdAt = createdAt;
    }

    const rows = await this.prisma.billingPayment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: EXPORT_ROW_LIMIT,
      include: {
        invoice: {
          select: {
            number: true,
            subscription: {
              select: {
                organisationId: true,
                organisation: { select: { companyName: true } },
              },
            },
          },
        },
      },
    });

    return toCsv(
      ['id', 'invoiceNumber', 'organisationId', 'organisationName', 'provider', 'status', 'amount', 'currency', 'manualMethod', 'providerReference', 'receivedAt', 'createdAt'],
      rows.map((row) => ({
        id: row.id,
        invoiceNumber: row.invoice.number,
        organisationId: row.invoice.subscription.organisationId,
        organisationName: row.invoice.subscription.organisation.companyName,
        provider: row.provider,
        status: row.status,
        amount: row.amount,
        currency: row.currency,
        manualMethod: row.manualMethod,
        providerReference: row.providerReference,
        receivedAt: row.receivedAt,
        createdAt: row.createdAt,
      })),
    );
  }

  async plansCsv(): Promise<string> {
    const rows = await this.prisma.plan.findMany({
      orderBy: { sortOrder: 'asc' },
      take: EXPORT_ROW_LIMIT,
    });

    return toCsv(
      ['id', 'code', 'name', 'status', 'monthlyPrice', 'annualPrice', 'currency', 'billingInterval', 'trialDays', 'maxDevices', 'supportLevel', 'isPublic', 'sortOrder', 'createdAt'],
      rows,
    );
  }
}
