import { AdminRole, LicensePlan, LicenseStatus } from '@prisma/client';
import { addDays, todayUtcDate } from '@patrol/license-core';
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
    const notificationService = {
      send: jest.fn(),
      listForLicence: jest.fn().mockResolvedValue([]),
    };
    const emailProvider = {
      getSafeStatus: jest.fn().mockReturnValue({
        configured: true,
        host: 'smtp.example.com',
        port: 587,
        secure: false,
        fromName: 'Patrol Licence Portal',
        fromEmail: 'support@techguards.co.uk',
      }),
    };

    const service = new LicencesService(
      prisma as never,
      signingService as never,
      encryption,
      auditService as never,
      authService as never,
      notificationService as never,
      emailProvider as never,
    );

    return {
      service,
      prisma,
      signingService,
      auditService,
      authService,
      notificationService,
      emailProvider,
      ...overrides,
    };
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

    await expect(
      service.reinstate(admin, 'lic-1', { password: 'CorrectPassword1!' }),
    ).rejects.toMatchObject({
      code: ERROR_CODES.LICENCE_REVOKED,
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
    const notificationService = {
      send: jest.fn(),
      listForLicence: jest.fn().mockResolvedValue([]),
    };
    const emailProvider = {
      getSafeStatus: jest.fn().mockReturnValue({
        configured: true,
        host: 'smtp.example.com',
        port: 587,
        secure: false,
        fromName: 'Patrol Licence Portal',
        fromEmail: 'support@techguards.co.uk',
      }),
    };
    const service = new LicencesService(
      prisma as never,
      signingService as never,
      encryption,
      auditService as never,
      authService as never,
      notificationService as never,
      emailProvider as never,
    );
    return { service, prisma, auditService, authService, notificationService, emailProvider };
  }

  function issuedLicence(overrides: Record<string, unknown> = {}) {
    return {
      id: 'lic-1',
      licenseId: 'PEL-2026-000001',
      customerId: 'cust-1',
      status: LicenseStatus.ACTIVE,
      plan: LicensePlan.ANNUAL,
      maxDevices: 1,
      features: ['collector'],
      startsAt: new Date('2026-01-01'),
      expiresAt: new Date('2026-12-31'),
      signedLicenseEnc: encryption.encrypt(signed),
      customer: {
        id: 'cust-1',
        companyName: 'Co',
        contactName: 'Alex',
        email: 'billing@example.com',
      },
      installations: [],
      payments: [],
      renewals: [],
      previousLicence: null,
      ...overrides,
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

  it('allows ADMIN to email issued licence from issue-success with TG1', async () => {
    const { service, prisma, notificationService, auditService } = buildService();
    prisma.licence.findUnique.mockResolvedValue(issuedLicence());
    notificationService.send.mockResolvedValue({
      success: true,
      logId: 'log-1',
      status: 'SENT',
    });

    const result = await service.emailLicence(admin, 'lic-1', {
      source: 'issue-success',
      fullLicenseKey: signed,
    });

    expect(result.success).toBe(true);
    expect(result.attachmentFilename).toBe('PEL-2026-000001.lic');
    expect(result.recipient).toBe('billing@example.com');
    expect(notificationService.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'billing@example.com',
        attachments: [
          expect.objectContaining({
            filename: 'PEL-2026-000001.lic',
            content: `${signed}\n`,
            contentType: 'text/plain; charset=utf-8',
          }),
        ],
      }),
    );
    const sendArg = notificationService.send.mock.calls[0][0];
    expect(sendArg.html).not.toContain(signed);
    expect(sendArg.text).not.toContain(signed);
    expect(auditService.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'licence.email.requested' }));
    expect(auditService.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'licence.emailed' }));
    expect(JSON.stringify(auditService.record.mock.calls)).not.toContain(signed);
  });

  it('allows SUPER_ADMIN to email from licence-detail with password', async () => {
    const { service, prisma, authService, notificationService } = buildService();
    authService.verifyPassword.mockResolvedValue(true);
    prisma.licence.findUnique.mockResolvedValue(issuedLicence());
    notificationService.send.mockResolvedValue({
      success: true,
      logId: 'log-2',
      status: 'SENT',
    });

    const result = await service.emailLicence(superAdmin, 'lic-1', {
      source: 'licence-detail',
      password: 'CorrectPassword1!',
      recipientEmail: 'override@example.com',
      message: 'Please activate promptly.',
    });

    expect(result.success).toBe(true);
    expect(result.recipient).toBe('override@example.com');
    expect(authService.verifyPassword).toHaveBeenCalledWith(superAdmin.sub, 'CorrectPassword1!');
    expect(notificationService.send.mock.calls[0][0].html).toContain('Please activate promptly.');
  });

  it('returns 403 for SUPPORT email attempts', async () => {
    const { service } = buildService();
    await expect(
      service.emailLicence(support, 'lic-1', { source: 'licence-detail', password: 'x' }),
    ).rejects.toMatchObject({ code: ERROR_CODES.LICENCE_REVEAL_FORBIDDEN });
  });

  it('rejects licence-detail email without password', async () => {
    const { service, prisma } = buildService();
    prisma.licence.findUnique.mockResolvedValue(issuedLicence());
    await expect(service.emailLicence(admin, 'lic-1', { source: 'licence-detail' })).rejects.toMatchObject({
      code: ERROR_CODES.VALIDATION_ERROR,
    });
  });

  it('rejects wrong password for licence-detail email', async () => {
    const { service, prisma, authService } = buildService();
    prisma.licence.findUnique.mockResolvedValue(issuedLicence());
    authService.verifyPassword.mockResolvedValue(false);
    await expect(
      service.emailLicence(admin, 'lic-1', { source: 'licence-detail', password: 'wrong' }),
    ).rejects.toMatchObject({ code: ERROR_CODES.LICENCE_REVEAL_PASSWORD_INVALID });
  });

  it('rejects invalid recipient before SMTP', async () => {
    const { service, prisma, notificationService } = buildService();
    prisma.licence.findUnique.mockResolvedValue(
      issuedLicence({ customer: { id: 'cust-1', companyName: 'Co', contactName: 'A', email: '' } }),
    );
    await expect(
      service.emailLicence(admin, 'lic-1', {
        source: 'issue-success',
        fullLicenseKey: signed,
        recipientEmail: 'not-an-email',
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.VALIDATION_ERROR });
    expect(notificationService.send).not.toHaveBeenCalled();
  });

  it('records failure without changing licence status when provider fails', async () => {
    const { service, prisma, notificationService, auditService } = buildService();
    prisma.licence.findUnique.mockResolvedValue(issuedLicence());
    notificationService.send.mockResolvedValue({
      success: false,
      logId: 'log-fail',
      status: 'FAILED',
      errorCode: 'NOTIFICATION_SMTP_NOT_CONFIGURED',
      errorMessage: 'SMTP is not configured',
    });

    const result = await service.emailLicence(admin, 'lic-1', {
      source: 'issue-success',
      fullLicenseKey: signed,
    });

    expect(result.success).toBe(false);
    expect(result.licence.status).toBe(LicenseStatus.ACTIVE);
    expect(prisma.licence.update).not.toHaveBeenCalled();
    expect(auditService.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'licence.email.failed' }));
  });

  it('requires matching in-memory TG1 for issue-success', async () => {
    const { service, prisma } = buildService();
    prisma.licence.findUnique.mockResolvedValue(issuedLicence());
    await expect(
      service.emailLicence(admin, 'lic-1', {
        source: 'issue-success',
        fullLicenseKey: 'TG1.wrong.key.value',
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.VALIDATION_ERROR });
  });

  it('returns not found for missing licence', async () => {
    const { service, prisma } = buildService();
    prisma.licence.findUnique.mockResolvedValue(null);
    await expect(
      service.emailLicence(admin, 'missing', {
        source: 'issue-success',
        fullLicenseKey: signed,
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.LICENCE_NOT_FOUND });
  });
});

describe('LicencesService lifecycle', () => {
  const admin = { sub: 'admin-1', email: 'admin@test.com', role: AdminRole.ADMIN, displayName: 'Admin' };
  const superAdmin = { ...admin, sub: 'super-1', role: AdminRole.SUPER_ADMIN };
  const support = { ...admin, role: AdminRole.SUPPORT };

  const encryption = new EncryptionService(
    new ConfigService({
      LICENCE_STORAGE_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    }),
  );

  function buildService() {
    const prisma: Record<string, any> = {
      licence: {
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ currentVersionId: null }),
        findMany: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
      },
      licenceVersion: {
        create: jest.fn(),
        aggregate: jest.fn().mockResolvedValue({ _max: { versionNumber: 0 } }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      installation: { count: jest.fn().mockResolvedValue(0) },
      customer: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'cust-1',
          companyName: 'Co',
          email: 'a@b.com',
          status: 'ACTIVE',
        }),
      },
      auditLog: { findFirst: jest.fn() },
      $queryRaw: jest.fn().mockResolvedValue(undefined),
    };
    prisma.$transaction = jest.fn(async (fn: (tx: unknown) => unknown) => fn(prisma));

    let versionCounter = 0;
    prisma.licenceVersion.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      versionCounter += 1;
      return { id: `version-${versionCounter}`, ...data };
    });

    const signingService = {
      signPayload: jest.fn().mockReturnValue({
        signedLicenseKey: 'TG1.payload.sig',
        payloadHash: 'hash123',
        signingKeyId: 'key-1',
      }),
      isReady: () => true,
    };
    const auditService = { record: jest.fn() };
    const authService = { verifyPassword: jest.fn().mockResolvedValue(true) };
    const notificationService = {
      send: jest.fn().mockResolvedValue({ success: true, logId: 'log-1', status: 'SENT' }),
      listForLicence: jest.fn().mockResolvedValue([]),
    };
    const emailProvider = {
      getSafeStatus: jest.fn().mockReturnValue({
        configured: true,
        host: 'smtp.example.com',
        port: 587,
        secure: false,
        fromName: 'Patrol Licence Portal',
        fromEmail: 'support@techguards.co.uk',
      }),
    };

    const service = new LicencesService(
      prisma as never,
      signingService as never,
      encryption,
      auditService as never,
      authService as never,
      notificationService as never,
      emailProvider as never,
    );

    return { service, prisma, signingService, auditService, authService, notificationService, emailProvider };
  }

  function baseLicence(overrides: Record<string, unknown> = {}) {
    return {
      id: 'lic-1',
      licenseId: 'PEL-2026-000001',
      customerId: 'cust-1',
      plan: LicensePlan.ANNUAL,
      status: LicenseStatus.ACTIVE,
      startsAt: new Date('2026-01-01'),
      expiresAt: new Date('2026-12-31'),
      maxDevices: 3,
      features: ['collector'],
      notes: null,
      signedLicenseEnc: encryption.encrypt('TG1.original.sig'),
      payloadHash: 'old-hash',
      signingKeyId: 'old-key',
      previousLicenceId: null,
      suspendedAt: null,
      suspensionReason: null,
      revokedAt: null,
      revocationReason: null,
      customer: { id: 'cust-1', companyName: 'Co', email: 'a@b.com', contactName: 'Alex' },
      installations: [],
      payments: [],
      renewals: [],
      previousLicence: null,
      ...overrides,
    };
  }

  describe('suspend', () => {
    it('requires password verification', async () => {
      const { service, prisma, authService } = buildService();
      prisma.licence.findUnique.mockResolvedValue(baseLicence());
      authService.verifyPassword.mockResolvedValue(false);

      await expect(
        service.suspend(admin, 'lic-1', { reason: 'Non-payment', password: 'wrong' }),
      ).rejects.toMatchObject({ code: ERROR_CODES.LICENCE_REVEAL_PASSWORD_INVALID });
    });

    it('rejects suspending an already-suspended licence', async () => {
      const { service, prisma } = buildService();
      prisma.licence.findUnique.mockResolvedValue(baseLicence({ status: LicenseStatus.SUSPENDED }));

      await expect(
        service.suspend(admin, 'lic-1', { reason: 'Non-payment', password: 'pw' }),
      ).rejects.toMatchObject({ code: ERROR_CODES.LICENCE_ALREADY_SUSPENDED });
    });

    it('rejects suspending an EXPIRED licence (ACTIVE only)', async () => {
      const { service, prisma } = buildService();
      prisma.licence.findUnique.mockResolvedValue(baseLicence({ status: LicenseStatus.EXPIRED }));

      await expect(
        service.suspend(admin, 'lic-1', { reason: 'Non-payment', password: 'pw' }),
      ).rejects.toMatchObject({ code: ERROR_CODES.LICENCE_INVALID_STATUS_TRANSITION });
    });

    it('blocks SUPPORT from suspending', async () => {
      const { service } = buildService();
      await expect(
        service.suspend(support, 'lic-1', { reason: 'Non-payment', password: 'pw' }),
      ).rejects.toMatchObject({ code: ERROR_CODES.FORBIDDEN_ROLE });
    });

    it('suspends an ACTIVE licence without producing a new TG1', async () => {
      const { service, prisma, auditService } = buildService();
      const licence = baseLicence();
      prisma.licence.findUnique.mockResolvedValue(licence);
      prisma.licence.update.mockResolvedValue({
        ...licence,
        status: LicenseStatus.SUSPENDED,
        suspendedAt: new Date(),
        suspendedByAdminId: admin.sub,
        suspensionReason: 'Non-payment',
      });

      const result = await service.suspend(admin, 'lic-1', { reason: 'Non-payment', password: 'pw' });

      expect(result.status).toBe(LicenseStatus.SUSPENDED);
      expect(prisma.licenceVersion.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            actionType: 'SUSPENDED',
            signedLicenseEnc: null,
            payloadHash: null,
            signingKeyId: null,
          }),
        }),
      );
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'licence.suspended' }),
      );
    });
  });

  describe('reactivate / reinstate', () => {
    it('rejects reactivating a non-suspended licence', async () => {
      const { service, prisma } = buildService();
      prisma.licence.findUnique.mockResolvedValue(baseLicence({ status: LicenseStatus.ACTIVE }));

      await expect(service.reactivate(admin, 'lic-1', { password: 'pw' })).rejects.toMatchObject({
        code: ERROR_CODES.LICENCE_NOT_SUSPENDED,
      });
    });

    it('requires renewal before reactivating an expired-while-suspended licence', async () => {
      const { service, prisma } = buildService();
      prisma.licence.findUnique.mockResolvedValue(
        baseLicence({ status: LicenseStatus.SUSPENDED, expiresAt: new Date('2020-01-01') }),
      );

      await expect(service.reactivate(admin, 'lic-1', { password: 'pw' })).rejects.toMatchObject({
        code: ERROR_CODES.LICENCE_INVALID_STATUS_TRANSITION,
      });
    });

    it('blocks reactivating a revoked licence with LICENCE_REVOKED', async () => {
      const { service, prisma } = buildService();
      prisma.licence.findUnique.mockResolvedValue(baseLicence({ status: LicenseStatus.REVOKED }));

      await expect(service.reactivate(admin, 'lic-1', { password: 'pw' })).rejects.toMatchObject({
        code: ERROR_CODES.LICENCE_REVOKED,
      });
    });

    it('reactivates a suspended, non-expired licence without a new TG1', async () => {
      const { service, prisma, auditService } = buildService();
      const suspended = baseLicence({
        status: LicenseStatus.SUSPENDED,
        expiresAt: new Date('2099-01-01'),
      });
      prisma.licence.findUnique.mockResolvedValue(suspended);
      prisma.licence.update.mockResolvedValue({
        ...suspended,
        status: LicenseStatus.ACTIVE,
        suspendedAt: null,
        suspendedByAdminId: null,
        suspensionReason: null,
      });

      const result = await service.reactivate(admin, 'lic-1', { password: 'pw' });

      expect(result.status).toBe(LicenseStatus.ACTIVE);
      expect(prisma.licenceVersion.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ actionType: 'REACTIVATED', signedLicenseEnc: null }),
        }),
      );
      expect(auditService.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'licence.reactivated' }));
    });

    it('reinstate() delegates to reactivate()', async () => {
      const { service, prisma } = buildService();
      prisma.licence.findUnique.mockResolvedValue(baseLicence({ status: LicenseStatus.ACTIVE }));
      await expect(service.reinstate(admin, 'lic-1', { password: 'pw' })).rejects.toMatchObject({
        code: ERROR_CODES.LICENCE_NOT_SUSPENDED,
      });
    });
  });

  describe('revoke', () => {
    it('requires exact confirmation text', async () => {
      const { service, prisma } = buildService();
      prisma.licence.findUnique.mockResolvedValue(baseLicence());

      await expect(
        service.revoke(admin, 'lic-1', {
          reason: 'Fraud',
          confirmationText: 'WRONG TEXT',
          password: 'pw',
        }),
      ).rejects.toMatchObject({ code: ERROR_CODES.LICENCE_REVOKE_CONFIRMATION_INVALID });
    });

    it('rejects revoking an already-revoked licence', async () => {
      const { service, prisma } = buildService();
      prisma.licence.findUnique.mockResolvedValue(baseLicence({ status: LicenseStatus.REVOKED }));

      await expect(
        service.revoke(admin, 'lic-1', {
          reason: 'Fraud',
          confirmationText: 'REVOKE PEL-2026-000001',
          password: 'pw',
        }),
      ).rejects.toMatchObject({ code: ERROR_CODES.LICENCE_REVOKED });
    });

    it('revokes with exact confirmation and blocks further mutation afterwards', async () => {
      const { service, prisma, auditService } = buildService();
      const licence = baseLicence();
      prisma.licence.findUnique
        .mockResolvedValueOnce(licence)
        .mockResolvedValue({ ...licence, status: LicenseStatus.REVOKED });
      prisma.licence.update.mockResolvedValue({
        ...licence,
        status: LicenseStatus.REVOKED,
        revokedAt: new Date(),
        revokedByAdminId: admin.sub,
        revocationReason: 'Fraud',
      });

      const result = await service.revoke(admin, 'lic-1', {
        reason: 'Fraud',
        confirmationText: 'REVOKE PEL-2026-000001',
        password: 'pw',
      });

      expect(result.status).toBe(LicenseStatus.REVOKED);
      expect(auditService.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'licence.revoked' }));

      await expect(
        service.suspend(admin, 'lic-1', { reason: 'x', password: 'pw' }),
      ).rejects.toMatchObject({ code: ERROR_CODES.LICENCE_REVOKED });
    });
  });

  describe('renew', () => {
    const today = todayUtcDate();
    const sourceExpiresAt = addDays(today, 30);
    const continuityFrom = addDays(sourceExpiresAt, 1);

    it('requires continuity unless SUPER_ADMIN sets allowDateOverride', async () => {
      const { service, prisma } = buildService();
      prisma.licence.findUnique.mockResolvedValue(
        baseLicence({ expiresAt: new Date(`${sourceExpiresAt}T00:00:00.000Z`) }),
      );

      await expect(
        service.renew(admin, 'lic-1', {
          renewalPeriod: 'ANNUAL',
          validFrom: addDays(continuityFrom, 30), // leaves a gap
          password: 'pw',
        }),
      ).rejects.toMatchObject({ code: ERROR_CODES.LICENCE_RENEWAL_DATE_INVALID });
    });

    it('rejects the gap override attempt from a non-SUPER_ADMIN', async () => {
      const { service, prisma } = buildService();
      prisma.licence.findUnique.mockResolvedValue(
        baseLicence({ expiresAt: new Date(`${sourceExpiresAt}T00:00:00.000Z`) }),
      );

      await expect(
        service.renew(admin, 'lic-1', {
          renewalPeriod: 'ANNUAL',
          validFrom: addDays(continuityFrom, 30),
          allowDateOverride: true,
          password: 'pw',
        }),
      ).rejects.toMatchObject({ code: ERROR_CODES.LICENCE_RENEWAL_DATE_INVALID });
    });

    it('allows SUPER_ADMIN to override continuity with allowDateOverride', async () => {
      const { service, prisma } = buildService();
      const licence = baseLicence({ expiresAt: new Date(`${sourceExpiresAt}T00:00:00.000Z`) });
      prisma.licence.findUnique.mockResolvedValue(licence);
      prisma.licence.update.mockResolvedValue({ ...licence });

      const gappedFrom = addDays(continuityFrom, 30);
      const result = await service.renew(superAdmin, 'lic-1', {
        renewalPeriod: 'ANNUAL',
        validFrom: gappedFrom,
        allowDateOverride: true,
        password: 'pw',
      });

      expect(result.fullLicenseKey).toBe('TG1.payload.sig');
    });

    it('keeps the same commercial licenceId and creates a RENEWED version', async () => {
      const { service, prisma, auditService } = buildService();
      const licence = baseLicence({ expiresAt: new Date(`${sourceExpiresAt}T00:00:00.000Z`) });
      prisma.licence.findUnique.mockResolvedValue(licence);
      prisma.licence.update.mockResolvedValue({ ...licence });

      const result = await service.renew(admin, 'lic-1', {
        renewalPeriod: 'ANNUAL',
        password: 'pw',
      });

      expect(result.licenseId).toBe('PEL-2026-000001');
      expect(prisma.licenceVersion.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ actionType: 'RENEWED' }) }),
      );
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'licence.renewal.requested' }),
      );
      expect(auditService.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'licence.renewed' }));
    });

    it('does not roll back the renewal when the optional email fails', async () => {
      const { service, prisma, notificationService, auditService } = buildService();
      const licence = baseLicence({ expiresAt: new Date(`${sourceExpiresAt}T00:00:00.000Z`) });
      prisma.licence.findUnique.mockResolvedValue(licence);
      prisma.licence.update.mockResolvedValue({ ...licence });
      notificationService.send.mockRejectedValue(new Error('SMTP down'));

      const result = await service.renew(admin, 'lic-1', {
        renewalPeriod: 'ANNUAL',
        password: 'pw',
        emailAfterRenewal: true,
      });

      expect(result.fullLicenseKey).toBe('TG1.payload.sig');
      expect(result.emailResult?.success).toBe(false);
      expect(auditService.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'licence.renewed' }));
      expect(auditService.record).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: 'licence.renewal.failed' }),
      );
    });

    it('rejects renewing a revoked licence', async () => {
      const { service, prisma } = buildService();
      prisma.licence.findUnique.mockResolvedValue(baseLicence({ status: LicenseStatus.REVOKED }));

      await expect(
        service.renew(admin, 'lic-1', { renewalPeriod: 'ANNUAL', password: 'pw' }),
      ).rejects.toMatchObject({ code: ERROR_CODES.LICENCE_REVOKED });
    });

    it('blocks SUPPORT from renewing', async () => {
      const { service } = buildService();
      await expect(
        service.renew(support, 'lic-1', { renewalPeriod: 'ANNUAL', password: 'pw' }),
      ).rejects.toMatchObject({ code: ERROR_CODES.FORBIDDEN_ROLE });
    });
  });

  describe('reissue', () => {
    it('re-signs the current entitlement and records a REISSUED version', async () => {
      const { service, prisma, auditService } = buildService();
      const licence = baseLicence();
      prisma.licence.findUnique.mockResolvedValue(licence);
      prisma.licence.update.mockResolvedValue({ ...licence });

      const result = await service.reissue(admin, 'lic-1', { reason: 'Corrupted file', password: 'pw' });

      expect(result.fullLicenseKey).toBe('TG1.payload.sig');
      expect(prisma.licenceVersion.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ actionType: 'REISSUED' }) }),
      );
      expect(auditService.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'licence.reissued' }));
    });

    it('rejects reissuing a revoked licence', async () => {
      const { service, prisma } = buildService();
      prisma.licence.findUnique.mockResolvedValue(baseLicence({ status: LicenseStatus.REVOKED }));

      await expect(
        service.reissue(admin, 'lic-1', { reason: 'Corrupted file', password: 'pw' }),
      ).rejects.toMatchObject({ code: ERROR_CODES.LICENCE_REVOKED });
    });
  });

  describe('changePlan', () => {
    it('changes plan and produces a new TG1', async () => {
      const { service, prisma, auditService } = buildService();
      const licence = baseLicence({ plan: LicensePlan.MONTHLY });
      prisma.licence.findUnique.mockResolvedValue(licence);
      prisma.licence.update.mockResolvedValue({ ...licence, plan: LicensePlan.ANNUAL });

      const result = await service.changePlan(admin, 'lic-1', {
        newPlan: LicensePlan.ANNUAL,
        reason: 'Upgrade',
        password: 'pw',
      });

      expect(result.plan).toBe(LicensePlan.ANNUAL);
      expect(prisma.licenceVersion.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ actionType: 'PLAN_CHANGED', plan: LicensePlan.ANNUAL }),
        }),
      );
      expect(auditService.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'licence.plan_changed' }));
    });
  });

  describe('changeDeviceLimit', () => {
    it('rejects lowering the limit below currently registered devices', async () => {
      const { service, prisma } = buildService();
      prisma.licence.findUnique.mockResolvedValue(baseLicence({ maxDevices: 5 }));
      prisma.installation.count.mockResolvedValue(4);

      await expect(
        service.changeDeviceLimit(admin, 'lic-1', { maxDevices: 2, reason: 'Downsize', password: 'pw' }),
      ).rejects.toMatchObject({ code: ERROR_CODES.LICENCE_DEVICE_LIMIT_INVALID });
    });

    it('increases the device limit and produces a new TG1', async () => {
      const { service, prisma, auditService } = buildService();
      const licence = baseLicence({ maxDevices: 3 });
      prisma.licence.findUnique.mockResolvedValue(licence);
      prisma.installation.count.mockResolvedValue(1);
      prisma.licence.update.mockResolvedValue({ ...licence, maxDevices: 10 });

      const result = await service.changeDeviceLimit(admin, 'lic-1', {
        maxDevices: 10,
        reason: 'Growth',
        password: 'pw',
      });

      expect(result.maxDevices).toBe(10);
      expect(prisma.licenceVersion.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ actionType: 'DEVICE_LIMIT_CHANGED', maxDevices: 10 }),
        }),
      );
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'licence.device_limit_changed' }),
      );
    });
  });
});

describe('ApiException', () => {
  it('carries stable error codes', () => {
    const error = new ApiException(ERROR_CODES.FORBIDDEN_ROLE, 'nope', 403);
    expect(error.code).toBe('FORBIDDEN_ROLE');
  });
});
