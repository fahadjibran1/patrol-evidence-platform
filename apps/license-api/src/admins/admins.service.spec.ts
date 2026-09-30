import { AdminRole } from '@prisma/client';
import { ERROR_CODES } from '@/common/constants/error-codes';
import { AdminsService } from './admins.service';

describe('AdminsService MFA reset authorization', () => {
  const target = { id: 'target-admin', role: AdminRole.ADMIN };
  const actor = {
    sub: 'super-admin',
    email: 'super@example.test',
    displayName: 'Super',
    role: AdminRole.SUPER_ADMIN,
    mfaVerified: true,
  };

  function fixture() {
    const prisma = {
      admin: { findUnique: jest.fn().mockResolvedValue(target) },
    };
    const auth = { verifyPassword: jest.fn().mockResolvedValue(true) };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const mfa = { reset: jest.fn().mockResolvedValue(undefined) };
    const service = new AdminsService(prisma as never, auth as never, audit as never, mfa as never);
    return { service, auth, audit, mfa };
  }

  it('requires a SUPER_ADMIN session that has completed MFA', async () => {
    const { service, mfa } = fixture();
    await expect(service.resetMfa({ ...actor, mfaVerified: false }, target.id, { password: 'ValidPassword!234' }))
      .rejects.toMatchObject({ code: ERROR_CODES.AUTH_MFA_REQUIRED });
    await expect(service.resetMfa({ ...actor, role: AdminRole.ADMIN }, target.id, { password: 'ValidPassword!234' }))
      .rejects.toMatchObject({ code: ERROR_CODES.AUTH_MFA_REQUIRED });
    expect(mfa.reset).not.toHaveBeenCalled();
  });

  it('forbids self-service MFA reset through the administrative recovery route', async () => {
    const { service } = fixture();
    await expect(service.resetMfa({ ...actor, sub: target.id }, target.id, { password: 'ValidPassword!234' }))
      .rejects.toMatchObject({ code: ERROR_CODES.FORBIDDEN_ROLE });
  });

  it('preserves password step-up and audits a failed reset attempt', async () => {
    const { service, auth, audit, mfa } = fixture();
    auth.verifyPassword.mockResolvedValue(false);
    await expect(service.resetMfa(actor, target.id, { password: 'WrongPassword!234' }))
      .rejects.toMatchObject({ code: ERROR_CODES.AUTH_INVALID_CREDENTIALS });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'auth.mfa_reset_denied',
      metadata: { reason: 'password_step_up_failed' },
    }));
    expect(mfa.reset).not.toHaveBeenCalled();
  });

  it('permits only an MFA-verified SUPER_ADMIN with successful password step-up', async () => {
    const { service, auth, mfa } = fixture();
    await expect(service.resetMfa(actor, target.id, { password: 'ValidPassword!234' }))
      .resolves.toEqual({ success: true });
    expect(auth.verifyPassword).toHaveBeenCalledWith(actor.sub, 'ValidPassword!234');
    expect(mfa.reset).toHaveBeenCalledWith(target.id, actor.sub);
  });
});
