import { AdminRole, LicensePlan, LicenseStatus } from '@prisma/client';
import { LicencesService } from './licences.service';
import { ApiException } from '@/common/exceptions/api.exception';
import { ERROR_CODES } from '@/common/constants/error-codes';
import { EncryptionService } from '@/crypto/encryption.service';
import { ConfigService } from '@nestjs/config';

describe('LicencesService rules', () => {
  const admin = { sub: 'admin-1', email: 'admin@test.com', role: AdminRole.ADMIN, displayName: 'Admin' };
  const support = { ...admin, role: AdminRole.SUPPORT };

  const encryption = new EncryptionService(
    new ConfigService({
      LICENCE_STORAGE_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    }),
  );

  function buildService(overrides: Partial<Record<string, unknown>> = {}) {
    const prisma = {
      licence: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
      },
      customer: { findUnique: jest.fn() },
      $transaction: jest.fn(),
    };

    const signingService = { signPayload: jest.fn(), isReady: () => true };
    const auditService = { record: jest.fn() };
    const authService = { verifyPassword: jest.fn() };

    const service = new LicencesService(
      prisma as never,
      signingService as never,
      encryption,
      auditService as never,
      authService as never,
    );

    return { service, prisma, signingService, auditService, authService, ...overrides };
  }

  it('forbids SUPPORT from issuing licences', async () => {
    const { service } = buildService();
    await expect(
      service.createDraft(support, {
        customerId: 'cust-1',
        plan: LicensePlan.TRIAL,
        maxDevices: 1,
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.FORBIDDEN_ROLE });
  });

  it('cannot reinstate revoked licences', async () => {
    const { service, prisma } = buildService();
    prisma.licence.findUnique.mockResolvedValue({
      id: 'lic-1',
      customerId: 'cust-1',
      status: LicenseStatus.REVOKED,
      startsAt: new Date('2026-01-01'),
      expiresAt: new Date('2026-12-31'),
      customer: { companyName: 'Co', email: 'a@b.com' },
      installations: [],
      payments: [],
      renewals: [],
      previousLicence: null,
    });

    await expect(service.reinstate(admin, 'lic-1')).rejects.toMatchObject({
      code: ERROR_CODES.LICENCE_CANNOT_REINSTATE_REVOKED,
    });
  });

  it('masks keys in list responses', async () => {
    const { service, prisma } = buildService();
    const signed = 'TG1.abc123payload.signature456';
    const signedLicenseEnc = encryption.encrypt(signed);

    prisma.licence.count.mockResolvedValue(1);
    prisma.licence.findMany.mockResolvedValue([
      {
        id: 'lic-1',
        licenseId: 'PEL-2026-000001',
        customerId: 'cust-1',
        plan: LicensePlan.TRIAL,
        status: LicenseStatus.ACTIVE,
        startsAt: new Date('2026-01-01'),
        expiresAt: new Date('2026-12-31'),
        maxDevices: 1,
        signedLicenseEnc,
        customer: { companyName: 'Co' },
      },
    ]);

    const result = await service.list({ page: 1, pageSize: 20 });
    expect(result.items[0].maskedKey).toMatch(/^TG1\./);
    expect(result.items[0].maskedKey).not.toContain(signed);
  });
});

describe('ApiException', () => {
  it('carries stable error codes', () => {
    const error = new ApiException(ERROR_CODES.FORBIDDEN_ROLE, 'nope', 403);
    expect(error.code).toBe('FORBIDDEN_ROLE');
  });
});
