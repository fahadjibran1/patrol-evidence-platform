import { AdminRole, CustomerStatus, LicensePlan, LicenseStatus, NotificationStatus, PaymentStatus } from '@prisma/client';
import { DashboardService } from './dashboard.service';

describe('DashboardService', () => {
  const admin = {
    sub: 'admin-1',
    email: 'admin@test.com',
    role: AdminRole.ADMIN,
    displayName: 'Admin',
  };
  const support = { ...admin, role: AdminRole.SUPPORT, sub: 'support-1' };

  function buildService() {
    const prisma = {
      customer: { count: jest.fn() },
      licence: {
        count: jest.fn(),
        groupBy: jest.fn(),
        findMany: jest.fn(),
      },
      notificationLog: {
        groupBy: jest.fn(),
        findMany: jest.fn(),
      },
      licenceVersion: { count: jest.fn() },
      auditLog: { findMany: jest.fn() },
      paymentRecord: { aggregate: jest.fn() },
    };

    const service = new DashboardService(prisma as never);
    return { service, prisma };
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  function mockOperationalQueries(prisma: ReturnType<typeof buildService>['prisma']) {
    prisma.customer.count.mockResolvedValue(5);
    prisma.licence.count
      .mockResolvedValueOnce(8) // active
      .mockResolvedValueOnce(1) // expired
      .mockResolvedValueOnce(2) // expiring 7
      .mockResolvedValueOnce(4) // expiring 30
      .mockResolvedValueOnce(3) // suspended
      .mockResolvedValueOnce(1); // revoked
    prisma.licenceVersion.count.mockResolvedValue(5); // renewed this month
    prisma.licence.groupBy.mockResolvedValue([
      { plan: LicensePlan.TRIAL, _count: { _all: 2 } },
      { plan: LicensePlan.MONTHLY, _count: { _all: 3 } },
      { plan: LicensePlan.ANNUAL, _count: { _all: 3 } },
    ]);
    prisma.notificationLog.groupBy.mockResolvedValue([
      { status: NotificationStatus.SENT, _count: { _all: 6 } },
      { status: NotificationStatus.FAILED, _count: { _all: 1 } },
      { status: NotificationStatus.PENDING, _count: { _all: 0 } },
    ]);
    prisma.licence.findMany.mockResolvedValue([
      {
        id: 'lic-1',
        licenseId: 'PEL-2026-000001',
        customerId: 'cust-1',
        plan: LicensePlan.ANNUAL,
        status: LicenseStatus.ACTIVE,
        startsAt: new Date('2026-01-01'),
        expiresAt: new Date('2026-07-25'),
        customer: { companyName: 'ABC Security' },
      },
    ]);
    prisma.auditLog.findMany.mockResolvedValue([
      {
        id: 'audit-1',
        action: 'licence.emailed',
        entityType: 'Licence',
        entityId: 'lic-1',
        customerId: 'cust-1',
        licenceId: 'lic-1',
        createdAt: new Date('2026-07-21T12:00:00.000Z'),
        actor: { displayName: 'Admin' },
      },
    ]);
    prisma.notificationLog.findMany.mockResolvedValue([
      {
        id: 'n-fail',
        notificationType: 'LICENSE_ISSUED',
        provider: 'EMAIL',
        recipient: 'a@b.com',
        subject: 'Licence',
        status: NotificationStatus.FAILED,
        errorMessage: 'SMTP is not configured',
        createdAt: new Date('2026-07-21T11:00:00.000Z'),
      },
    ]);
  }

  it('returns full operational and revenue data for ADMIN', async () => {
    const { service, prisma } = buildService();
    mockOperationalQueries(prisma);
    prisma.paymentRecord.aggregate
      .mockResolvedValueOnce({ _count: { _all: 2 }, _sum: { amountPence: 5000 } })
      .mockResolvedValueOnce({ _count: { _all: 1 }, _sum: { amountPence: 12000 } })
      .mockResolvedValueOnce({ _count: { _all: 3 }, _sum: { amountPence: 36000 } });

    const result = await service.getSummary(admin);

    expect(result.kpis).toMatchObject({
      activeCustomers: 5,
      activeLicences: 8,
      trialLicences: 2,
      monthlyLicences: 3,
      annualLicences: 3,
      expiredLicences: 1,
      expiringIn7Days: 2,
      expiringIn30Days: 4,
      suspendedLicences: 3,
      revokedLicences: 1,
      renewedThisMonth: 5,
      emailsSentToday: 6,
      failedEmailsToday: 1,
    });
    expect(result.renewalQueue).toHaveLength(1);
    expect(result.renewalQueue[0]).toMatchObject({
      licenseId: 'PEL-2026-000001',
      customerName: 'ABC Security',
      plan: LicensePlan.ANNUAL,
      canRenew: true,
      canReactivate: false,
    });
    expect(result.recentActivity[0]).toMatchObject({
      action: 'licence.emailed',
      actorDisplayName: 'Admin',
    });
    expect(result.notificationHealth).toMatchObject({
      sentToday: 6,
      failedToday: 1,
      pendingToday: 0,
    });
    expect(result.notificationHealth.recentFailures[0].errorMessage).toBe('SMTP is not configured');
    expect(result.revenue).toEqual({
      currency: 'GBP',
      outstandingPaymentsCount: 2,
      outstandingPaymentsAmountPence: 5000,
      paidTodayCount: 1,
      paidTodayAmountPence: 12000,
      paidThisMonthCount: 3,
      paidThisMonthAmountPence: 36000,
    });
    expect(prisma.paymentRecord.aggregate).toHaveBeenCalled();
    expect(prisma.customer.count).toHaveBeenCalledWith({ where: { status: CustomerStatus.ACTIVE } });
  });

  it('omits revenue for SUPPORT while keeping operational data', async () => {
    const { service, prisma } = buildService();
    mockOperationalQueries(prisma);

    const result = await service.getSummary(support);

    expect(result.kpis.activeLicences).toBe(8);
    expect(result.renewalQueue).toHaveLength(1);
    expect(result.renewalQueue[0].canRenew).toBe(false);
    expect(result.recentActivity).toHaveLength(1);
    expect(result.notificationHealth.sentToday).toBe(6);
    expect(result.revenue).toBeUndefined();
    expect(prisma.paymentRecord.aggregate).not.toHaveBeenCalled();
  });

  it('includes revenue for SUPER_ADMIN', async () => {
    const { service, prisma } = buildService();
    mockOperationalQueries(prisma);
    prisma.paymentRecord.aggregate.mockResolvedValue({
      _count: { _all: 0 },
      _sum: { amountPence: null },
    });

    const result = await service.getSummary({ ...admin, role: AdminRole.SUPER_ADMIN });
    expect(result.revenue).toBeDefined();
    expect(result.revenue?.outstandingPaymentsAmountPence).toBe(0);
    expect(prisma.paymentRecord.aggregate).toHaveBeenCalledTimes(3);
  });

  it('uses payment status filters for revenue aggregates', async () => {
    const { service, prisma } = buildService();
    mockOperationalQueries(prisma);
    prisma.paymentRecord.aggregate.mockResolvedValue({
      _count: { _all: 0 },
      _sum: { amountPence: null },
    });

    await service.getSummary(admin);

    expect(prisma.paymentRecord.aggregate.mock.calls[0][0].where).toEqual({
      paymentStatus: PaymentStatus.PENDING,
    });
    expect(prisma.paymentRecord.aggregate.mock.calls[1][0].where.paymentStatus).toBe(PaymentStatus.PAID);
    expect(prisma.paymentRecord.aggregate.mock.calls[2][0].where.paymentStatus).toBe(PaymentStatus.PAID);
  });
});

describe('DashboardService caching', () => {
  const admin = {
    sub: 'admin-1',
    email: 'admin@test.com',
    role: AdminRole.ADMIN,
    displayName: 'Admin',
  };

  function buildService() {
    const prisma = {
      customer: { count: jest.fn().mockResolvedValue(0) },
      licence: {
        count: jest.fn().mockResolvedValue(0),
        groupBy: jest.fn().mockResolvedValue([]),
        findMany: jest.fn().mockResolvedValue([]),
      },
      notificationLog: {
        groupBy: jest.fn().mockResolvedValue([]),
        findMany: jest.fn().mockResolvedValue([]),
      },
      licenceVersion: { count: jest.fn().mockResolvedValue(0) },
      auditLog: { findMany: jest.fn().mockResolvedValue([]) },
      paymentRecord: {
        aggregate: jest.fn().mockResolvedValue({ _count: { _all: 0 }, _sum: { amountPence: null } }),
      },
    };
    const metricsService = { recordDashboardLoad: jest.fn(), increment: jest.fn() };
    const service = new DashboardService(prisma as never, metricsService as never);
    return { service, prisma, metricsService };
  }

  it('serves the second call within the TTL window from cache without hitting prisma again', async () => {
    const { service, prisma } = buildService();

    await service.getSummary(admin);
    expect(prisma.customer.count).toHaveBeenCalledTimes(1);

    await service.getSummary(admin);
    expect(prisma.customer.count).toHaveBeenCalledTimes(1); // still 1 — served from cache
    expect(service.cacheSize).toBe(1);
  });

  it('invalidateAll() clears the cache so the next call recomputes', async () => {
    const { service, prisma } = buildService();

    await service.getSummary(admin);
    expect(prisma.customer.count).toHaveBeenCalledTimes(1);

    service.invalidateAll();
    expect(service.cacheSize).toBe(0);

    await service.getSummary(admin);
    expect(prisma.customer.count).toHaveBeenCalledTimes(2);
  });

  it('caches separately per admin role', async () => {
    const { service, prisma } = buildService();
    const support = { ...admin, role: AdminRole.SUPPORT };

    await service.getSummary(admin);
    await service.getSummary(support);

    expect(service.cacheSize).toBe(2);
    expect(prisma.customer.count).toHaveBeenCalledTimes(2);
  });

  it('records dashboard load time via MetricsService on a cache miss', async () => {
    const { service, metricsService } = buildService();

    await service.getSummary(admin);

    expect(metricsService.recordDashboardLoad).toHaveBeenCalledTimes(1);
    expect(metricsService.recordDashboardLoad).toHaveBeenCalledWith(expect.any(Number));
  });
});
