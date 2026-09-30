import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'crypto';
import type { Admin } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { AuditService } from '@/audit/audit.service';
import { ApiException } from '@/common/exceptions/api.exception';
import { ERROR_CODES } from '@/common/constants/error-codes';
import { AdminMfaCryptoService } from './admin-mfa-crypto.service';

const MFA_CHALLENGE_TTL_MS = 5 * 60_000;
const MFA_MAX_ATTEMPTS = 5;

export interface MfaRequestMeta { ipAddress?: string; userAgent?: string }

@Injectable()
export class AdminMfaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    private readonly crypto: AdminMfaCryptoService,
  ) {}

  isRequired(): boolean {
    return String(this.config.get<string>('ADMIN_MFA_REQUIRED') ?? '').toLowerCase() === 'true';
  }

  async beginLogin(admin: Admin, meta: MfaRequestMeta = {}) {
    if (!this.isRequired() && !admin.mfaEnabled) return null;
    if (!this.crypto.isConfigured()) throw this.unavailable();
    const purpose = admin.mfaEnabled ? 'LOGIN' : 'ENROL';
    const challengeToken = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + MFA_CHALLENGE_TTL_MS);
    await this.prisma.$transaction(async (tx) => {
      await tx.adminMfaChallenge.updateMany({
        where: { adminId: admin.id, consumedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.adminMfaChallenge.create({
        data: { adminId: admin.id, tokenHash: this.hashChallenge(challengeToken), purpose, expiresAt },
      });
    });
    await this.audit.record({
      actorAdminId: admin.id,
      action: 'auth.mfa_challenge_created',
      entityType: 'Admin',
      entityId: admin.id,
      metadata: { purpose, expiresAt: expiresAt.toISOString() },
      ...meta,
    });
    return { mfaRequired: true as const, enrollmentRequired: purpose === 'ENROL', challengeToken, expiresAt: expiresAt.toISOString() };
  }

  async startEnrollment(challengeToken: string, meta: MfaRequestMeta = {}) {
    const challenge = await this.activeChallenge(challengeToken, 'ENROL');
    if (challenge.secretPresentedAt || challenge.pendingSecretEnc) throw this.invalidChallenge();
    const admin = await this.prisma.admin.findUniqueOrThrow({ where: { id: challenge.adminId } });
    if (admin.mfaEnabled) throw this.invalidChallenge();
    const secret = this.crypto.generateSecret();
    const changed = await this.prisma.adminMfaChallenge.updateMany({
      where: { id: challenge.id, secretPresentedAt: null, pendingSecretEnc: null, consumedAt: null, revokedAt: null },
      data: { pendingSecretEnc: this.crypto.encryptSecret(secret), secretPresentedAt: new Date() },
    });
    if (changed.count !== 1) throw this.invalidChallenge();
    await this.audit.record({
      actorAdminId: admin.id,
      action: 'auth.mfa_enrollment_started',
      entityType: 'Admin',
      entityId: admin.id,
      ...meta,
    });
    return {
      secret,
      otpauthUri: this.crypto.createOtpAuthUri(secret, admin.email),
      issuer: 'PatrolSafe Operator',
      accountName: admin.email,
    };
  }

  async confirmEnrollment(challengeToken: string, code: string, meta: MfaRequestMeta = {}) {
    const challenge = await this.activeChallenge(challengeToken, 'ENROL');
    if (!challenge.pendingSecretEnc || !challenge.secretPresentedAt) throw this.invalidChallenge();
    const secret = this.crypto.decryptSecret(challenge.pendingSecretEnc);
    const counter = this.crypto.verifyTotp(secret, code);
    if (counter === null) return this.failedAttempt(challenge, 'enrollment_code_invalid', meta);
    const recoveryCodes = this.crypto.generateRecoveryCodes();
    const now = new Date();
    const completed = await this.prisma.$transaction(async (tx) => {
      const consumed = await tx.adminMfaChallenge.updateMany({
        where: { id: challenge.id, consumedAt: null, revokedAt: null, expiresAt: { gt: now }, attemptCount: { lt: MFA_MAX_ATTEMPTS } },
        data: { consumedAt: now },
      });
      if (consumed.count !== 1) return false;
      await tx.adminMfaRecoveryCode.deleteMany({ where: { adminId: challenge.adminId } });
      await tx.adminMfaRecoveryCode.createMany({
        data: recoveryCodes.map((recoveryCode) => ({ adminId: challenge.adminId, codeHash: this.crypto.hashRecoveryCode(recoveryCode) })),
      });
      await tx.admin.update({
        where: { id: challenge.adminId },
        data: { mfaEnabled: true, mfaSecretEnc: this.crypto.encryptSecret(secret), mfaEnrolledAt: now, mfaLastTotpCounter: counter },
      });
      await tx.refreshToken.deleteMany({ where: { adminId: challenge.adminId } });
      return true;
    });
    if (!completed) throw this.invalidChallenge();
    await this.audit.record({ actorAdminId: challenge.adminId, action: 'auth.mfa_enrollment_succeeded', entityType: 'Admin', entityId: challenge.adminId, ...meta });
    return { adminId: challenge.adminId, recoveryCodes };
  }

  async verifyLogin(
    challengeToken: string,
    input: { code?: string; recoveryCode?: string },
    meta: MfaRequestMeta = {},
  ) {
    const challenge = await this.activeChallenge(challengeToken, 'LOGIN');
    const admin = await this.prisma.admin.findUniqueOrThrow({ where: { id: challenge.adminId } });
    if (!admin.isActive || !admin.mfaEnabled || !admin.mfaSecretEnc) throw this.invalidChallenge();
    const now = new Date();
    let method: 'totp' | 'recovery';
    if (input.code && !input.recoveryCode) {
      const counter = this.crypto.verifyTotp(this.crypto.decryptSecret(admin.mfaSecretEnc), input.code);
      if (counter === null || (admin.mfaLastTotpCounter !== null && counter <= admin.mfaLastTotpCounter)) {
        return this.failedAttempt(challenge, 'totp_invalid_or_replayed', meta);
      }
      const consumed = await this.prisma.$transaction(async (tx) => {
        const challengeConsumed = await tx.adminMfaChallenge.updateMany({
          where: { id: challenge.id, consumedAt: null, revokedAt: null, expiresAt: { gt: now }, attemptCount: { lt: MFA_MAX_ATTEMPTS } },
          data: { consumedAt: now },
        });
        if (challengeConsumed.count !== 1) throw this.invalidChallenge();
        const updatedAdmin = await tx.admin.updateMany({
          where: {
            id: admin.id,
            OR: [{ mfaLastTotpCounter: null }, { mfaLastTotpCounter: { lt: counter } }],
          },
          data: { mfaLastTotpCounter: counter },
        });
        if (updatedAdmin.count !== 1) throw this.invalidChallenge();
        return true;
      });
      if (!consumed) throw this.invalidChallenge();
      method = 'totp';
    } else if (input.recoveryCode && !input.code) {
      const recoveryHash = this.crypto.hashRecoveryCode(input.recoveryCode);
      const consumed = await this.prisma.$transaction(async (tx) => {
        const existingRecovery = await tx.adminMfaRecoveryCode.findUnique({
          where: { codeHash: recoveryHash },
        });
        if (!existingRecovery || existingRecovery.adminId !== admin.id || existingRecovery.usedAt) return false;
        const challengeConsumed = await tx.adminMfaChallenge.updateMany({
          where: { id: challenge.id, consumedAt: null, revokedAt: null, expiresAt: { gt: now }, attemptCount: { lt: MFA_MAX_ATTEMPTS } },
          data: { consumedAt: now },
        });
        if (challengeConsumed.count !== 1) throw this.invalidChallenge();
        const recovery = await tx.adminMfaRecoveryCode.updateMany({
          where: { id: existingRecovery.id, adminId: admin.id, usedAt: null },
          data: { usedAt: now },
        });
        if (recovery.count !== 1) throw this.invalidChallenge();
        return true;
      });
      if (!consumed) return this.failedAttempt(challenge, 'recovery_invalid_or_replayed', meta);
      method = 'recovery';
    } else {
      return this.failedAttempt(challenge, 'verification_method_invalid', meta);
    }
    await this.audit.record({
      actorAdminId: admin.id,
      action: method === 'recovery' ? 'auth.mfa_recovery_used' : 'auth.mfa_verification_succeeded',
      entityType: 'Admin',
      entityId: admin.id,
      metadata: { method },
      ...meta,
    });
    return { adminId: admin.id, usedRecoveryCode: method === 'recovery' };
  }

  async reset(targetAdminId: string, actorAdminId: string): Promise<void> {
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.admin.update({
        where: { id: targetAdminId },
        data: { mfaEnabled: false, mfaSecretEnc: null, mfaEnrolledAt: null, mfaLastTotpCounter: null },
      });
      await tx.adminMfaRecoveryCode.deleteMany({ where: { adminId: targetAdminId } });
      await tx.adminMfaChallenge.updateMany({ where: { adminId: targetAdminId, consumedAt: null, revokedAt: null }, data: { revokedAt: now } });
      await tx.refreshToken.deleteMany({ where: { adminId: targetAdminId } });
    });
    await this.audit.record({ actorAdminId, action: 'auth.mfa_reset', entityType: 'Admin', entityId: targetAdminId });
  }

  assertSessionAllowed(admin: Pick<Admin, 'mfaEnabled'>, mfaVerified: boolean | undefined): void {
    if (this.isRequired() && (!admin.mfaEnabled || mfaVerified !== true)) {
      throw new ApiException(ERROR_CODES.AUTH_MFA_REQUIRED, 'Multi-factor authentication is required.', 401);
    }
    if (admin.mfaEnabled && mfaVerified !== true) {
      throw new ApiException(ERROR_CODES.AUTH_MFA_REQUIRED, 'Multi-factor authentication is required.', 401);
    }
  }

  private async activeChallenge(rawToken: string, purpose: 'ENROL' | 'LOGIN') {
    if (!/^[A-Za-z0-9_-]{43}$/.test(rawToken)) throw this.invalidChallenge();
    const challenge = await this.prisma.adminMfaChallenge.findUnique({ where: { tokenHash: this.hashChallenge(rawToken) } });
    if (!challenge || challenge.purpose !== purpose || challenge.consumedAt || challenge.revokedAt
      || challenge.expiresAt <= new Date() || challenge.attemptCount >= MFA_MAX_ATTEMPTS) throw this.invalidChallenge();
    return challenge;
  }

  private async failedAttempt(
    challenge: { id: string; adminId: string; attemptCount: number },
    reason: string,
    meta: MfaRequestMeta,
  ): Promise<never> {
    const nextCount = challenge.attemptCount + 1;
    await this.prisma.adminMfaChallenge.update({
      where: { id: challenge.id },
      data: { attemptCount: { increment: 1 }, ...(nextCount >= MFA_MAX_ATTEMPTS ? { revokedAt: new Date() } : {}) },
    });
    await this.audit.record({
      actorAdminId: challenge.adminId,
      action: 'auth.mfa_verification_failed',
      entityType: 'Admin',
      entityId: challenge.adminId,
      metadata: { reason, attempt: nextCount, challengeRevoked: nextCount >= MFA_MAX_ATTEMPTS },
      ...meta,
    });
    throw new ApiException(
      nextCount >= MFA_MAX_ATTEMPTS ? ERROR_CODES.AUTH_MFA_RATE_LIMITED : ERROR_CODES.AUTH_MFA_INVALID,
      nextCount >= MFA_MAX_ATTEMPTS ? 'Too many MFA attempts. Sign in again.' : 'The verification code is invalid or expired.',
      nextCount >= MFA_MAX_ATTEMPTS ? 429 : 401,
    );
  }

  private hashChallenge(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private invalidChallenge(): ApiException {
    return new ApiException(ERROR_CODES.AUTH_MFA_INVALID, 'The MFA challenge is invalid or expired.', 401);
  }

  private unavailable(): ApiException {
    return new ApiException(ERROR_CODES.AUTH_MFA_CONFIGURATION_INVALID, 'Multi-factor authentication is unavailable.', 503);
  }
}
