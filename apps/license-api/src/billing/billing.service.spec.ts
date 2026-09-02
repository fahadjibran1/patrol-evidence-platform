import {
  BillingInterval,
  BillingPaymentStatus,
  InvoiceStatus,
  ManualPaymentMethod,
  PaymentProvider,
  PlanStatus,
  SubscriptionStatus,
} from '@prisma/client';
import { Test } from '@nestjs/testing';
import { EventBus } from '@/domain-events/event-bus.service';
import { DOMAIN_EVENTS } from '@/domain-events/domain-event.types';
import { PrismaService } from '@/prisma/prisma.service';
import { AuditService } from '@/audit/audit.service';
import { PlansService } from './plans/plans.service';
import { InvoicesService } from './invoices/invoices.service';
import { BillingPaymentsService } from './payments/billing-payments.service';
import { SubscriptionsService } from './subscriptions/subscriptions.service';
import { FeatureService } from './shared/feature.service';
import { PlanFeatureResolver } from './shared/plan-feature-resolver';
import { ApiException } from '@/common/exceptions/api.exception';

describe('Billing domain unit flows', () => {
  const admin = {
    sub: 'admin-1',
    email: 'admin@test',
    role: 'SUPER_ADMIN' as const,
    displayName: 'Admin',
  };

  const plan = {
    id: 'plan-1',
    code: 'STARTER',
    name: 'Starter',
    description: null,
    status: PlanStatus.ACTIVE,
    monthlyPrice: 4900,
    annualPrice: 49000,
    currency: 'GBP',
    billingInterval: BillingInterval.MONTHLY,
    trialDays: 0,
    maxDevices: 2,
    includedFeatures: ['MULTI_USER'],
    supportLevel: 'STANDARD',
    sortOrder: 10,
    isPublic: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  let prisma: any;
  let eventBus: { publish: jest.Mock };
  let subscriptionsService: SubscriptionsService;
  let paymentsService: BillingPaymentsService;
  let plansService: PlansService;

  beforeEach(async () => {
    eventBus = { publish: jest.fn().mockResolvedValue(undefined) };
    prisma = {
      plan: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      customer: { findUnique: jest.fn() },
      subscription: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
      invoice: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
      billingPayment: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        count: jest.fn(),
      },
      invoiceNumberSequence: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn(async (arg: unknown) => {
        if (typeof arg === 'function') {
          return (arg as (tx: typeof prisma) => Promise<unknown>)(prisma);
        }
        return Promise.all(arg as Promise<unknown>[]);
      }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        PlansService,
        InvoicesService,
        BillingPaymentsService,
        SubscriptionsService,
        FeatureService,
        PlanFeatureResolver,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: { record: jest.fn() } },
        { provide: EventBus, useValue: eventBus },
      ],
    }).compile();

    plansService = moduleRef.get(PlansService);
    paymentsService = moduleRef.get(BillingPaymentsService);
    subscriptionsService = moduleRef.get(SubscriptionsService);
  });

  it('creates an active subscription and publishes lifecycle events', async () => {
    prisma.customer.findUnique.mockResolvedValue({ id: 'org-1', companyName: 'Acme', email: 'a@b.c' });
    prisma.plan.findUnique.mockResolvedValue(plan);
    prisma.subscription.findFirst.mockResolvedValue(null);
    const created = {
      ...plan,
      id: 'sub-1',
      organisationId: 'org-1',
      planId: plan.id,
      status: SubscriptionStatus.ACTIVE,
      billingInterval: BillingInterval.MONTHLY,
      startedAt: new Date(),
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(),
      nextBillingDate: new Date(),
      autoRenew: true,
      trialEndsAt: null,
      cancelAtPeriodEnd: false,
      cancelledAt: null,
      createdByAdminId: admin.sub,
      createdAt: new Date(),
      updatedAt: new Date(),
      plan,
      organisation: { id: 'org-1', companyName: 'Acme', email: 'a@b.c' },
    };
    prisma.subscription.create.mockResolvedValue(created);
    prisma.subscription.findUnique.mockResolvedValue({
      ...created,
      plan,
      organisation: { id: 'org-1', companyName: 'Acme', email: 'a@b.c' },
    });
    prisma.invoiceNumberSequence.findUnique.mockResolvedValue(null);
    prisma.invoiceNumberSequence.create.mockResolvedValue({ year: 2026, lastValue: 1 });
    prisma.invoice.create.mockResolvedValue({
      id: 'inv-1',
      subscriptionId: 'sub-1',
      number: 'INV-2026-000001',
      status: InvoiceStatus.OPEN,
      subtotal: 4900,
      tax: 0,
      discount: 0,
      total: 4900,
      currency: 'GBP',
      issuedAt: new Date(),
      dueAt: new Date(),
      paidAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      subscription: {
        organisationId: 'org-1',
        organisation: { id: 'org-1', companyName: 'Acme' },
        plan,
      },
      payments: [],
    });

    const result = await subscriptionsService.create(admin as never, {
      organisationId: 'org-1',
      planId: plan.id,
      startTrial: false,
    });

    expect(result.status).toBe(SubscriptionStatus.ACTIVE);
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: DOMAIN_EVENTS.SubscriptionCreated }),
    );
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: DOMAIN_EVENTS.SubscriptionActivated }),
    );
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: DOMAIN_EVENTS.InvoiceCreated }),
    );
  });

  it('records manual payment, marks invoice paid, and publishes payment events', async () => {
    prisma.invoice.findUnique.mockResolvedValue({
      id: 'inv-1',
      status: InvoiceStatus.OPEN,
      currency: 'GBP',
      subscriptionId: 'sub-1',
      subscription: { organisationId: 'org-1' },
    });
    prisma.billingPayment.create.mockResolvedValue({
      id: 'pay-1',
      invoiceId: 'inv-1',
      provider: PaymentProvider.MANUAL,
      providerReference: 'REF-1',
      status: BillingPaymentStatus.SUCCEEDED,
      amount: 4900,
      currency: 'GBP',
      manualMethod: ManualPaymentMethod.BANK_TRANSFER,
      notes: null,
      receivedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      invoice: {
        number: 'INV-2026-000001',
        subscription: { organisationId: 'org-1', organisation: { companyName: 'Acme' } },
      },
    });
    prisma.invoice.update.mockResolvedValue({
      id: 'inv-1',
      subscriptionId: 'sub-1',
      number: 'INV-2026-000001',
      status: InvoiceStatus.PAID,
      subtotal: 4900,
      tax: 0,
      discount: 0,
      total: 4900,
      currency: 'GBP',
      issuedAt: new Date(),
      dueAt: new Date(),
      paidAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      subscription: {
        organisationId: 'org-1',
        organisation: { id: 'org-1', companyName: 'Acme' },
        plan,
      },
      payments: [],
    });

    const payment = await paymentsService.recordManual(admin as never, {
      invoiceId: 'inv-1',
      amount: 4900,
      method: ManualPaymentMethod.BANK_TRANSFER,
      providerReference: 'REF-1',
    });

    expect(payment.status).toBe(BillingPaymentStatus.SUCCEEDED);
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: DOMAIN_EVENTS.PaymentSucceeded }),
    );
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: DOMAIN_EVENTS.ManualPaymentRecorded }),
    );
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: DOMAIN_EVENTS.InvoicePaid }),
    );
  });

  it('prevents creating a second active subscription for an organisation', async () => {
    prisma.customer.findUnique.mockResolvedValue({ id: 'org-1' });
    prisma.plan.findUnique.mockResolvedValue(plan);
    prisma.subscription.findFirst.mockResolvedValue({ id: 'existing' });

    await expect(
      subscriptionsService.create(admin as never, { organisationId: 'org-1', planId: plan.id }),
    ).rejects.toBeInstanceOf(ApiException);
  });

  it('serializes plans with resolved features', async () => {
    prisma.plan.findMany.mockResolvedValue([plan]);
    const listed = await plansService.list();
    expect(listed.items[0].includedFeatures).toContain('MULTI_USER');
    expect(listed.items[0].licenceFeatures).toEqual(expect.arrayContaining(['collector', 'dashboard']));
  });
});
