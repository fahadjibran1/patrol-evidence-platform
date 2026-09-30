import { ConfigService } from '@nestjs/config';
import { AdminRole } from '@prisma/client';
import { AdminMfaCryptoService } from './admin-mfa-crypto.service';
import { AdminMfaService } from './admin-mfa.service';
import { ERROR_CODES } from '@/common/constants/error-codes';

describe('AdminMfaService production boundary', () => {
  const admin = {
    id: 'admin-1',
    email: 'operator@example.test',
    displayName: 'Operator',
    passwordHash: 'hash',
    role: AdminRole.SUPER_ADMIN,
    isActive: true,
    lastLoginAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    mfaEnabled: false,
    mfaSecretEnc: null,
    mfaEnrolledAt: null,
    mfaLastTotpCounter: null,
  };

  function fixture(required = true) {
    const challengeCreate = jest.fn();
    const prisma: {
      $transaction: jest.Mock;
      adminMfaChallenge: { updateMany: jest.Mock; create: jest.Mock };
    } = {
      $transaction: jest.fn(),
      adminMfaChallenge: { updateMany: jest.fn(), create: challengeCreate },
    };
    prisma.$transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback(prisma));
    const audit = { record: jest.fn() };
    const config = new ConfigService({
      ADMIN_MFA_REQUIRED: required ? 'true' : 'false',
      ADMIN_MFA_ENCRYPTION_KEY: 'B'.repeat(64),
    });
    const service = new AdminMfaService(
      prisma as never,
      audit as never,
      config,
      new AdminMfaCryptoService(config),
    );
    return { service, challengeCreate, audit };
  }

  it('requires enrolment after a valid production password when MFA is not enabled', async () => {
    const { service, challengeCreate, audit } = fixture();
    const result = await service.beginLogin(admin);
    expect(result).toEqual(expect.objectContaining({ mfaRequired: true, enrollmentRequired: true }));
    expect(result?.challengeToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(challengeCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ adminId: admin.id, purpose: 'ENROL' }),
    }));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'auth.mfa_challenge_created' }));
  });

  it('keeps staging/development usable when MFA is not required and not enrolled', async () => {
    const { service, challengeCreate } = fixture(false);
    await expect(service.beginLogin(admin)).resolves.toBeNull();
    expect(challengeCreate).not.toHaveBeenCalled();
  });

  it('fails closed for production sessions without enrolled and verified MFA', () => {
    const { service } = fixture();
    expect(() => service.assertSessionAllowed({ mfaEnabled: false }, false)).toThrow('Multi-factor authentication is required');
    expect(() => service.assertSessionAllowed({ mfaEnabled: true }, false)).toThrow('Multi-factor authentication is required');
    expect(() => service.assertSessionAllowed({ mfaEnabled: true }, true)).not.toThrow();
  });
});

describe('AdminMfaService challenge and recovery controls', () => {
  const challengeToken = 'C'.repeat(43);

  function fixture(options: {
    attemptCount?: number;
    expiresAt?: Date;
    lastCounter?: number | null;
    recoveryUsedAt?: Date | null;
  } = {}) {
    const config = new ConfigService({
      ADMIN_MFA_REQUIRED: 'true',
      ADMIN_MFA_ENCRYPTION_KEY: 'C'.repeat(64),
    });
    const crypto = new AdminMfaCryptoService(config);
    const secret = crypto.generateSecret();
    const challenge = {
      id: 'challenge-1',
      adminId: 'admin-1',
      tokenHash: 'hash',
      purpose: 'LOGIN',
      expiresAt: options.expiresAt ?? new Date(Date.now() + 60_000),
      attemptCount: options.attemptCount ?? 0,
      consumedAt: null,
      revokedAt: null,
      pendingSecretEnc: null,
      secretPresentedAt: null,
      createdAt: new Date(),
    };
    const enabledAdmin = {
      id: 'admin-1',
      email: 'operator@example.test',
      displayName: 'Operator',
      passwordHash: 'hash',
      role: AdminRole.SUPER_ADMIN,
      isActive: true,
      lastLoginAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      mfaEnabled: true,
      mfaSecretEnc: crypto.encryptSecret(secret),
      mfaEnrolledAt: new Date(),
      mfaLastTotpCounter: options.lastCounter ?? null,
    };
    const prisma = {
      $transaction: jest.fn(),
      admin: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(enabledAdmin),
        update: jest.fn().mockResolvedValue(enabledAdmin),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      adminMfaChallenge: {
        findUnique: jest.fn().mockResolvedValue(challenge),
        update: jest.fn().mockResolvedValue(challenge),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      adminMfaRecoveryCode: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'recovery-1',
          adminId: enabledAdmin.id,
          codeHash: crypto.hashRecoveryCode('ABCD-EFGH-IJKL-MNOP-QRST'),
          usedAt: options.recoveryUsedAt ?? null,
          createdAt: new Date(),
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      refreshToken: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    prisma.$transaction.mockImplementation(async (callback: (tx: typeof prisma) => unknown) => callback(prisma));
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const service = new AdminMfaService(prisma as never, audit as never, config, crypto);
    return { service, prisma, audit, crypto, challenge, enabledAdmin };
  }

  it('rejects an expired challenge without consuming it', async () => {
    const { service, prisma } = fixture({ expiresAt: new Date(Date.now() - 1) });
    await expect(service.verifyLogin(challengeToken, { code: '123456' }))
      .rejects.toMatchObject({ code: ERROR_CODES.AUTH_MFA_INVALID });
    expect(prisma.adminMfaChallenge.update).not.toHaveBeenCalled();
  });

  it('rejects a replayed TOTP counter and audits the failed attempt', async () => {
    const { service, prisma, audit, crypto } = fixture({ lastCounter: 100 });
    jest.spyOn(crypto, 'verifyTotp').mockReturnValue(100);
    await expect(service.verifyLogin(challengeToken, { code: '123456' }))
      .rejects.toMatchObject({ code: ERROR_CODES.AUTH_MFA_INVALID });
    expect(prisma.adminMfaChallenge.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ attemptCount: { increment: 1 } }),
    }));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'auth.mfa_verification_failed',
      metadata: expect.objectContaining({ reason: 'totp_invalid_or_replayed' }),
    }));
  });

  it('locks the challenge at the bounded fifth failed attempt', async () => {
    const { service, prisma, audit, crypto } = fixture({ attemptCount: 4 });
    jest.spyOn(crypto, 'verifyTotp').mockReturnValue(null);
    await expect(service.verifyLogin(challengeToken, { code: '123456' }))
      .rejects.toMatchObject({ code: ERROR_CODES.AUTH_MFA_RATE_LIMITED });
    expect(prisma.adminMfaChallenge.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ revokedAt: expect.any(Date) }),
    }));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ challengeRevoked: true, attempt: 5 }),
    }));
  });

  it('consumes one recovery code once and audits recovery use', async () => {
    const { service, prisma, audit } = fixture();
    await expect(service.verifyLogin(challengeToken, {
      recoveryCode: 'ABCD-EFGH-IJKL-MNOP-QRST',
    })).resolves.toEqual({ adminId: 'admin-1', usedRecoveryCode: true });
    expect(prisma.adminMfaRecoveryCode.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'recovery-1', usedAt: null }),
      data: { usedAt: expect.any(Date) },
    }));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'auth.mfa_recovery_used',
      metadata: { method: 'recovery' },
    }));
  });

  it('rejects and audits a replayed recovery code', async () => {
    const { service, prisma, audit } = fixture({ recoveryUsedAt: new Date() });
    await expect(service.verifyLogin(challengeToken, {
      recoveryCode: 'ABCD-EFGH-IJKL-MNOP-QRST',
    })).rejects.toMatchObject({ code: ERROR_CODES.AUTH_MFA_INVALID });
    expect(prisma.adminMfaRecoveryCode.updateMany).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'auth.mfa_verification_failed',
      metadata: expect.objectContaining({ reason: 'recovery_invalid_or_replayed' }),
    }));
  });

  it('resets MFA material, recovery codes, challenges and sessions atomically', async () => {
    const { service, prisma, audit } = fixture();
    await service.reset('admin-1', 'super-admin-2');
    expect(prisma.admin.update).toHaveBeenCalledWith(expect.objectContaining({
      data: {
        mfaEnabled: false,
        mfaSecretEnc: null,
        mfaEnrolledAt: null,
        mfaLastTotpCounter: null,
      },
    }));
    expect(prisma.adminMfaRecoveryCode.deleteMany).toHaveBeenCalled();
    expect(prisma.adminMfaChallenge.updateMany).toHaveBeenCalled();
    expect(prisma.refreshToken.deleteMany).toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'auth.mfa_reset' }));
  });
});
