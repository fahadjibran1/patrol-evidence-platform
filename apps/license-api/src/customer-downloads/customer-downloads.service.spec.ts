import { CustomerDownloadsService } from './customer-downloads.service';
import { CustomerRole, LicenseStatus } from '@prisma/client';
import { permissionsForRole } from '@/customer-org/customer-permissions';

describe('CustomerDownloadsService', () => {
  const prisma = {
    licence: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  };
  const encryption = { decrypt: jest.fn() };
  const audit = { record: jest.fn() };
  const service = new CustomerDownloadsService(prisma as never, encryption as never, audit as never);

  const actor = {
    sub: 'user-1',
    email: 'user@acme.test',
    displayName: 'User',
    customerId: 'cust-1',
    companyId: 'cust-1',
    role: CustomerRole.OWNER,
    permissions: permissionsForRole(CustomerRole.OWNER),
    emailVerified: true,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('streams the active licence and audits the download', async () => {
    prisma.licence.findFirst.mockResolvedValue({
      id: 'lic-1',
      licenseId: 'PEL-2026-000001',
      customerId: 'cust-1',
      status: LicenseStatus.ACTIVE,
      startsAt: new Date('2026-01-01'),
      expiresAt: new Date('2027-01-01'),
      signedLicenseEnc: 'enc',
      downloadCount: 2,
    });
    encryption.decrypt.mockReturnValue('TG1.payload.sig');
    prisma.licence.update.mockResolvedValue({ downloadCount: 3 });

    const result = await service.downloadCurrentActive(actor, 'lic-1', { ipAddress: '1.1.1.1' });

    expect(result.body).toBe('TG1.payload.sig');
    expect(result.fileName).toBe('PEL-2026-000001.lic');
    expect(prisma.licence.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ downloadCount: { increment: 1 } }),
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'customer.licence.downloaded',
        actorCustomerUserId: 'user-1',
        customerId: 'cust-1',
      }),
    );
  });

  it('forbids downloading another company licence', async () => {
    prisma.licence.findFirst.mockResolvedValue(null);
    await expect(service.downloadCurrentActive(actor, 'lic-other')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('forbids downloading suspended licences', async () => {
    prisma.licence.findFirst.mockResolvedValue({
      id: 'lic-1',
      licenseId: 'PEL-2026-000001',
      customerId: 'cust-1',
      status: LicenseStatus.SUSPENDED,
      startsAt: new Date('2026-01-01'),
      expiresAt: new Date('2027-01-01'),
      signedLicenseEnc: 'enc',
      downloadCount: 0,
    });
    await expect(service.downloadCurrentActive(actor, 'lic-1')).rejects.toMatchObject({
      status: 403,
    });
  });
});
