import { ExportsService } from './exports.service';

describe('ExportsService', () => {
  function buildService() {
    const prisma = {
      customer: { findMany: jest.fn().mockResolvedValue([]) },
      licence: { findMany: jest.fn().mockResolvedValue([]) },
      licenceVersion: { findMany: jest.fn().mockResolvedValue([]) },
      paymentRecord: { findMany: jest.fn().mockResolvedValue([]) },
      notificationLog: { findMany: jest.fn().mockResolvedValue([]) },
      auditLog: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new ExportsService(prisma as never);
    return { service, prisma };
  }

  it('customersCsv returns header-only CSV with no rows and never selects password fields', async () => {
    const { service, prisma } = buildService();
    const csv = await service.customersCsv({});

    expect(csv.trim()).toBe(
      'id,companyName,tradingName,contactName,email,phone,city,postcode,country,status,createdAt,updatedAt',
    );
    const selectArg = prisma.customer.findMany.mock.calls[0][0].select;
    expect(selectArg).not.toHaveProperty('passwordHash');
  });

  it('customersCsv escapes commas/quotes in company names', async () => {
    const { service, prisma } = buildService();
    prisma.customer.findMany.mockResolvedValue([
      {
        id: 'c1',
        companyName: 'Acme, "The" Co',
        tradingName: null,
        contactName: null,
        email: 'a@b.com',
        phone: null,
        city: null,
        postcode: null,
        country: 'GB',
        status: 'ACTIVE',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]);

    const csv = await service.customersCsv({ status: 'ACTIVE' });
    expect(csv).toContain('"Acme, ""The"" Co"');
    expect(prisma.customer.findMany.mock.calls[0][0].where).toMatchObject({ status: 'ACTIVE' });
  });

  it('licencesCsv never selects signedLicenseEnc or payloadHash', async () => {
    const { service, prisma } = buildService();
    await service.licencesCsv({ status: 'ACTIVE' as never });

    const selectArg = prisma.licence.findMany.mock.calls[0][0].select;
    expect(selectArg).not.toHaveProperty('signedLicenseEnc');
    expect(selectArg).not.toHaveProperty('payloadHash');
  });

  it('licencesCsv applies status/plan/customerId filters', async () => {
    const { service, prisma } = buildService();
    await service.licencesCsv({ status: 'ACTIVE' as never, plan: 'ANNUAL' as never, customerId: 'cust-1' });

    expect(prisma.licence.findMany.mock.calls[0][0].where).toMatchObject({
      status: 'ACTIVE',
      plan: 'ANNUAL',
      customerId: 'cust-1',
    });
  });

  it('renewalsCsv filters LicenceVersion by actionType RENEWED', async () => {
    const { service, prisma } = buildService();
    await service.renewalsCsv({});

    expect(prisma.licenceVersion.findMany.mock.calls[0][0].where).toMatchObject({ actionType: 'RENEWED' });
  });

  it('revenueCsv never selects raw payment tokens beyond documented fields', async () => {
    const { service, prisma } = buildService();
    await service.revenueCsv({ paymentStatus: 'PAID' as never });

    const selectArg = prisma.paymentRecord.findMany.mock.calls[0][0].select;
    expect(Object.keys(selectArg).sort()).toEqual(
      [
        'id',
        'customerId',
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
        'customer',
      ].sort(),
    );
  });

  it('notificationsCsv never includes message bodies (html/text) since they are not stored', async () => {
    const { service, prisma } = buildService();
    await service.notificationsCsv({ status: 'FAILED' as never });

    const selectArg = prisma.notificationLog.findMany.mock.calls[0][0].select;
    expect(selectArg).not.toHaveProperty('html');
    expect(selectArg).not.toHaveProperty('text');
    expect(prisma.notificationLog.findMany.mock.calls[0][0].where).toMatchObject({ status: 'FAILED' });
  });

  it('auditCsv filters by customerId when provided', async () => {
    const { service, prisma } = buildService();
    await service.auditCsv({ customerId: 'cust-1' });

    expect(prisma.auditLog.findMany.mock.calls[0][0].where).toMatchObject({ customerId: 'cust-1' });
  });

  it('applies dateFrom/dateTo range filters when provided', async () => {
    const { service, prisma } = buildService();
    await service.auditCsv({ dateFrom: '2026-01-01', dateTo: '2026-02-01' });

    const where = prisma.auditLog.findMany.mock.calls[0][0].where;
    expect(where.createdAt.gte).toBeInstanceOf(Date);
    expect(where.createdAt.lte).toBeInstanceOf(Date);
  });
});
