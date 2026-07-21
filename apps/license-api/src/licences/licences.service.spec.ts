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
        features: ['collector'],
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.FORBIDDEN_ROLE });
  });

  it('rejects CLOSED customers for issuance', async () => {
    const { service, prisma } = buildService();
    prisma.customer.findUnique.mockResolvedValue({
      id: 'cust-1',
      companyName: 'Co',
      email: 'a@b.com',
      status: 'CLOSED',
    });

    await expect(
      service.issueImmediately(admin, {
        customerId: 'cust-1',
        plan: LicensePlan.ANNUAL,
        maxDevices: 1,
        features: ['collector'],
        startsAt: '2026-07-01',
        expiresAt: '2027-06-30',
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.LICENCE_CUSTOMER_INELIGIBLE });
  });

  it('rejects unsupported features', async () => {
    const { service, prisma } = buildService();
    prisma.customer.findUnique.mockResolvedValue({
      id: 'cust-1',
      companyName: 'Co',
      email: 'a@b.com',
      status: 'ACTIVE',
    });

    await expect(
      service.issueImmediately(admin, {
        customerId: 'cust-1',
        plan: LicensePlan.ANNUAL,
        maxDevices: 1,
        features: ['not-a-real-feature'],
        startsAt: '2026-07-01',
        expiresAt: '2027-06-30',
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.LICENCE_FEATURES_INVALID });
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

describe('LicencesService reveal and download-event', () => {
  const admin = { sub: 'admin-1', email: 'admin@test.com', role: AdminRole.ADMIN, displayName: 'Admin' };
  const superAdmin = { ...admin, role: AdminRole.SUPER_ADMIN };
  const support = { ...admin, role: AdminRole.SUPPORT };
  const encryption = new EncryptionService(
    new ConfigService({
      LICENCE_STORAGE_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    }),
  );
  const signed = 'TG1.abc123payload.signature456';

  function buildService() {
    const prisma = {
      licence: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
      },
      customer: { findUnique: jest.fn() },
      auditLog: { findFirst: jest.fn() },
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
    return { service, prisma, auditService, authService };
  }

  function issuedLicence() {
    return {
      id: 'lic-1',
      licenseId: 'PEL-2026-000001',
      customerId: 'cust-1',
      status: LicenseStatus.ACTIVE,
      startsAt: new Date('2026-01-01'),
      expiresAt: new Date('2026-12-31'),
      signedLicenseEnc: encryption.encrypt(signed),
      customer: { companyName: 'Co', email: 'a@b.com' },
      installations: [],
      payments: [],
      renewals: [],
      previousLicence: null,
    };
  }

  it('allows ADMIN to reveal after password verification', async () => {
    const { service, prisma, authService, auditService } = buildService();
    authService.verifyPassword.mockResolvedValue(true);
    prisma.licence.findUnique.mockResolvedValue(issuedLicence());

    const result = await service.reveal(admin, 'lic-1', { password: 'CorrectPassword1!' });
    expect(result.fullLicenseKey).toBe(signed);
    expect(result.signedLicenseKey).toBe(signed);
    expect(auditService.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'licence.reveal.requested' }));
    expect(auditService.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'licence.revealed' }));
    for (const call of auditService.record.mock.calls) {
      expect(JSON.stringify(call[0])).not.toContain(signed);
    }
  });

  it('allows SUPER_ADMIN to reveal', async () => {
    const { service, prisma, authService } = buildService();
    authService.verifyPassword.mockResolvedValue(true);
    prisma.licence.findUnique.mockResolvedValue(issuedLicence());
    const result = await service.reveal(superAdmin, 'lic-1', { password: 'CorrectPassword1!' });
    expect(result.fullLicenseKey).toBe(signed);
  });

  it('returns 403 for SUPPORT reveal attempts', async () => {
    const { service } = buildService();
    await expect(service.reveal(support, 'lic-1', { password: 'x' })).rejects.toMatchObject({
      code: ERROR_CODES.LICENCE_REVEAL_FORBIDDEN,
    });
  });

  it('returns safe invalid-password response for wrong password', async () => {
    const { service, authService, auditService } = buildService();
    authService.verifyPassword.mockResolvedValue(false);

    await expect(service.reveal(admin, 'lic-1', { password: 'wrong' })).rejects.toMatchObject({
      code: ERROR_CODES.LICENCE_REVEAL_PASSWORD_INVALID,
    });
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'licence.reveal.failed',
        metadata: { reason: 'invalid_password' },
      }),
    );
  });

  it('denies inactive admins via failed password verification', async () => {
    const { service, authService } = buildService();
    authService.verifyPassword.mockResolvedValue(false);
    await expect(service.reveal(admin, 'lic-1', { password: 'CorrectPassword1!' })).rejects.toMatchObject({
      code: ERROR_CODES.LICENCE_REVEAL_PASSWORD_INVALID,
    });
  });

  it('records download-event metadata without TG1 values', async () => {
    const { service, prisma, auditService } = buildService();
    prisma.licence.findUnique.mockResolvedValue(issuedLicence());
    prisma.auditLog.findFirst.mockResolvedValue(null);

    const result = await service.recordDownloadEvent(admin, 'lic-1', 'licence-detail');
    expect(result).toEqual({ recorded: true, deduplicated: false });
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'licence.downloaded',
        metadata: { licenseId: 'PEL-2026-000001', source: 'licence-detail' },
      }),
    );
    expect(JSON.stringify(auditService.record.mock.calls)).not.toContain(signed);
  });

  it('deduplicates download-event spam within the window', async () => {
    const { service, prisma } = buildService();
    prisma.licence.findUnique.mockResolvedValue(issuedLicence());
    prisma.auditLog.findFirst.mockResolvedValue({
      metadata: { source: 'issue-success' },
    });

    const result = await service.recordDownloadEvent(admin, 'lic-1', 'issue-success');
    expect(result).toEqual({ recorded: false, deduplicated: true });
  });

  it('forbids SUPPORT from download-event', async () => {
    const { service } = buildService();
    await expect(service.recordDownloadEvent(support, 'lic-1', 'licence-detail')).rejects.toMatchObject({
      code: ERROR_CODES.FORBIDDEN_ROLE,
    });
  });
});

describe('ApiException', () => {
  it('carries stable error codes', () => {
    const error = new ApiException(ERROR_CODES.FORBIDDEN_ROLE, 'nope', 403);
    expect(error.code).toBe('FORBIDDEN_ROLE');
  });
});
