import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes, randomUUID } from 'crypto';
import * as bcrypt from 'bcrypt';
import { CustomerRole } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { AuditService } from '@/audit/audit.service';
import { ApiException } from '@/common/exceptions/api.exception';
import { ERROR_CODES } from '@/common/constants/error-codes';
import { MetricsService } from '@/metrics/metrics.service';
import { CustomerTokenService } from './customer-token.service';
import {
  CustomerAcceptInvitationDto,
  CustomerChangePasswordDto,
  CustomerForgotPasswordDto,
  CustomerLoginDto,
  CustomerResetPasswordDto,
  CustomerVerifyEmailDto,
} from './dto/customer-auth.dto';
import {
  AuthenticatedCustomer,
  CustomerAuthTokens,
} from './interfaces/authenticated-customer.interface';
import { permissionsForRole } from '@/customer-org/customer-permissions';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

@Injectable()
export class CustomerAuthService {
  private readonly logger = new Logger(CustomerAuthService.name);
  private readonly loginAttempts = new Map<string, RateLimitEntry>();
  private readonly maxAttempts = 8;
  private readonly windowMs = 15 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: CustomerTokenService,
    private readonly auditService: AuditService,
    private readonly configService: ConfigService,
    @Optional() private readonly metricsService?: MetricsService,
  ) {}

  async login(
    dto: CustomerLoginDto,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<{ customer: AuthenticatedCustomer; tokens: CustomerAuthTokens }> {
    const email = dto.email.trim().toLowerCase();
    const key = `${meta?.ipAddress ?? 'unknown'}:${email}`;
    this.assertNotRateLimited(key);

    const user = await this.prisma.customerUser.findUnique({
      where: { email },
      include: { customer: true },
    });

    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      this.recordFailedAttempt(key);
      this.metricsService?.increment('loginFailures');
      await this.auditService.record({
        action: 'customer.auth.login_failed',
        entityType: 'CustomerUser',
        customerId: user?.customerId ?? null,
        metadata: { email },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      throw new ApiException(ERROR_CODES.AUTH_INVALID_CREDENTIALS, 'Invalid email or password', 401);
    }

    if (!user.isActive) {
      throw new ApiException(ERROR_CODES.AUTH_ACCOUNT_INACTIVE, 'Customer account is inactive', 403);
    }

    if (user.customer.status === 'CLOSED' || user.customer.status === 'SUSPENDED') {
      throw new ApiException(
        ERROR_CODES.CUSTOMER_AUTH_FORBIDDEN,
        'Company account is not eligible for portal access',
        403,
      );
    }

    this.loginAttempts.delete(key);
    await this.prisma.customerUser.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const rememberMe = Boolean(dto.rememberMe);
    const tokens = await this.issueTokens(user.id, user.customerId, meta, rememberMe);
    await this.auditService.record({
      actorCustomerUserId: user.id,
      action: 'customer.auth.login_success',
      entityType: 'CustomerUser',
      entityId: user.id,
      customerId: user.customerId,
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
      metadata: { sessionId: tokens.sessionId, rememberMe },
    });

    return {
      customer: this.toAuthenticated(user),
      tokens,
    };
  }

  async logout(
    customerUserId: string,
    refreshToken?: string,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<void> {
    const user = await this.prisma.customerUser.findUnique({ where: { id: customerUserId } });

    if (refreshToken) {
      await this.revokeRefreshToken(refreshToken);
    } else {
      await this.prisma.customerSession.updateMany({
        where: { customerUserId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.prisma.customerRefreshToken.deleteMany({ where: { customerUserId } });
    }

    await this.auditService.record({
      actorCustomerUserId: customerUserId,
      action: 'customer.auth.logout',
      entityType: 'CustomerUser',
      entityId: customerUserId,
      customerId: user?.customerId ?? null,
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });
  }

  async refresh(refreshToken: string): Promise<CustomerAuthTokens> {
    try {
      const payload = this.tokenService.verifyRefresh(refreshToken);
      const tokenHash = this.hashToken(refreshToken);
      const stored = await this.prisma.customerRefreshToken.findUnique({
        where: { tokenHash },
        include: { session: true },
      });
      if (
        !stored
        || stored.customerUserId !== payload.sub
        || stored.expiresAt < new Date()
        || stored.session?.revokedAt
      ) {
        throw new ApiException(ERROR_CODES.AUTH_INVALID_REFRESH, 'Invalid or expired refresh token', 401);
      }

      const user = await this.prisma.customerUser.findUnique({ where: { id: payload.sub } });
      if (!user?.isActive) {
        throw new ApiException(ERROR_CODES.AUTH_ACCOUNT_INACTIVE, 'Customer account is inactive', 403);
      }

      await this.prisma.customerSession.updateMany({
        where: { refreshTokenId: stored.id },
        data: { revokedAt: new Date() },
      });
      await this.prisma.customerRefreshToken.delete({ where: { id: stored.id } });

      return this.issueTokens(
        user.id,
        user.customerId,
        undefined,
        stored.rememberMe || Boolean(payload.rememberMe),
      );
    } catch (error) {
      if (error instanceof ApiException) {
        throw error;
      }
      throw new ApiException(ERROR_CODES.AUTH_INVALID_REFRESH, 'Invalid or expired refresh token', 401);
    }
  }

  async validateAccessToken(token: string): Promise<AuthenticatedCustomer> {
    try {
      const customer = this.tokenService.verifyAccess(token);
      const record = await this.prisma.customerUser.findUnique({
        where: { id: customer.sub },
        include: { customer: true },
      });
      if (!record?.isActive) {
        throw new ApiException(ERROR_CODES.AUTH_ACCOUNT_INACTIVE, 'Customer account is inactive', 403);
      }
      if (record.customerId !== customer.customerId) {
        throw new ApiException(ERROR_CODES.AUTH_INVALID_CREDENTIALS, 'Invalid or expired access token', 401);
      }
      return this.toAuthenticated(record, customer.sessionId);
    } catch (error) {
      if (error instanceof ApiException) {
        throw error;
      }
      throw new ApiException(ERROR_CODES.AUTH_INVALID_CREDENTIALS, 'Invalid or expired access token', 401);
    }
  }

  async me(customerUserId: string): Promise<AuthenticatedCustomer & { mfaEnabled: boolean }> {
    const user = await this.prisma.customerUser.findUnique({ where: { id: customerUserId } });
    if (!user) {
      throw new ApiException(ERROR_CODES.CUSTOMER_USER_NOT_FOUND, 'Customer user not found', 404);
    }
    return { ...this.toAuthenticated(user), mfaEnabled: user.mfaEnabled };
  }

  async requestPasswordReset(
    dto: CustomerForgotPasswordDto,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<{ accepted: boolean; resetToken?: string }> {
    const email = dto.email.trim().toLowerCase();
    const user = await this.prisma.customerUser.findUnique({ where: { email } });
    // Always return accepted to avoid account enumeration.
    if (!user?.isActive) {
      return { accepted: true };
    }

    const rawToken = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await this.prisma.customerPasswordResetToken.create({
      data: {
        customerUserId: user.id,
        tokenHash: this.hashToken(rawToken),
        expiresAt,
      },
    });

    await this.auditService.record({
      actorCustomerUserId: user.id,
      action: 'customer.auth.password_reset_requested',
      entityType: 'CustomerUser',
      entityId: user.id,
      customerId: user.customerId,
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    this.logger.log(`Password reset token issued for ${email} (expires ${expiresAt.toISOString()})`);

    return {
      accepted: true,
      resetToken: this.configService.get('NODE_ENV') === 'production' ? undefined : rawToken,
    };
  }

  async resetPassword(
    dto: CustomerResetPasswordDto,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<{ success: boolean }> {
    const tokenHash = this.hashToken(dto.token);
    const stored = await this.prisma.customerPasswordResetToken.findUnique({
      where: { tokenHash },
      include: { customerUser: true },
    });
    if (!stored || stored.usedAt || stored.expiresAt < new Date()) {
      throw new ApiException(
        ERROR_CODES.CUSTOMER_PASSWORD_RESET_INVALID,
        'Invalid or expired password reset token',
        400,
      );
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);
    await this.prisma.$transaction([
      this.prisma.customerUser.update({
        where: { id: stored.customerUserId },
        data: { passwordHash },
      }),
      this.prisma.customerPasswordResetToken.update({
        where: { id: stored.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.customerSession.updateMany({
        where: { customerUserId: stored.customerUserId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      this.prisma.customerRefreshToken.deleteMany({ where: { customerUserId: stored.customerUserId } }),
    ]);

    await this.auditService.record({
      actorCustomerUserId: stored.customerUserId,
      action: 'customer.auth.password_reset_completed',
      entityType: 'CustomerUser',
      entityId: stored.customerUserId,
      customerId: stored.customerUser.customerId,
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return { success: true };
  }

  async changePassword(
    actor: AuthenticatedCustomer,
    dto: CustomerChangePasswordDto,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<{ success: boolean }> {
    const user = await this.prisma.customerUser.findUniqueOrThrow({ where: { id: actor.sub } });
    if (!(await bcrypt.compare(dto.currentPassword, user.passwordHash))) {
      throw new ApiException(ERROR_CODES.AUTH_INVALID_CREDENTIALS, 'Current password is incorrect', 401);
    }
    const passwordHash = await bcrypt.hash(dto.newPassword, 12);
    await this.prisma.customerUser.update({ where: { id: user.id }, data: { passwordHash } });
    await this.auditService.record({
      actorCustomerUserId: user.id,
      action: 'customer.auth.password_changed',
      entityType: 'CustomerUser',
      entityId: user.id,
      customerId: user.customerId,
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });
    return { success: true };
  }

  async issueEmailVerification(
    customerUserId: string,
  ): Promise<{ accepted: boolean; verificationToken?: string }> {
    const user = await this.prisma.customerUser.findUnique({ where: { id: customerUserId } });
    if (!user) {
      throw new ApiException(ERROR_CODES.CUSTOMER_USER_NOT_FOUND, 'Customer user not found', 404);
    }
    if (user.emailVerifiedAt) {
      return { accepted: true };
    }

    const rawToken = randomBytes(32).toString('hex');
    await this.prisma.customerEmailVerificationToken.create({
      data: {
        customerUserId: user.id,
        tokenHash: this.hashToken(rawToken),
        expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
      },
    });

    return {
      accepted: true,
      verificationToken: this.configService.get('NODE_ENV') === 'production' ? undefined : rawToken,
    };
  }

  async verifyEmail(
    dto: CustomerVerifyEmailDto,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<{ success: boolean }> {
    const stored = await this.prisma.customerEmailVerificationToken.findUnique({
      where: { tokenHash: this.hashToken(dto.token) },
      include: { customerUser: true },
    });
    if (!stored || stored.usedAt || stored.expiresAt < new Date()) {
      throw new ApiException(
        ERROR_CODES.CUSTOMER_EMAIL_VERIFICATION_INVALID,
        'Invalid or expired email verification token',
        400,
      );
    }

    await this.prisma.$transaction([
      this.prisma.customerUser.update({
        where: { id: stored.customerUserId },
        data: { emailVerifiedAt: new Date() },
      }),
      this.prisma.customerEmailVerificationToken.update({
        where: { id: stored.id },
        data: { usedAt: new Date() },
      }),
    ]);

    await this.auditService.record({
      actorCustomerUserId: stored.customerUserId,
      action: 'customer.auth.email_verified',
      entityType: 'CustomerUser',
      entityId: stored.customerUserId,
      customerId: stored.customerUser.customerId,
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return { success: true };
  }

  async acceptInvitation(
    dto: CustomerAcceptInvitationDto,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<{ customer: AuthenticatedCustomer; tokens: CustomerAuthTokens }> {
    const invitation = await this.prisma.organisationInvitation.findUnique({
      where: { tokenHash: this.hashToken(dto.token) },
    });
    if (!invitation || invitation.status !== 'PENDING') {
      throw new ApiException(ERROR_CODES.CUSTOMER_INVITATION_INVALID, 'Invitation is not valid', 400);
    }
    if (invitation.expiresAt < new Date()) {
      await this.prisma.organisationInvitation.update({
        where: { id: invitation.id },
        data: { status: 'EXPIRED' },
      });
      throw new ApiException(ERROR_CODES.CUSTOMER_INVITATION_EXPIRED, 'Invitation has expired', 400);
    }

    const existing = await this.prisma.customerUser.findUnique({
      where: { email: invitation.email },
    });
    if (existing) {
      throw new ApiException(ERROR_CODES.CUSTOMER_MEMBER_EXISTS, 'A user with this email already exists', 409);
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = await this.prisma.customerUser.create({
      data: {
        email: invitation.email,
        passwordHash,
        displayName: dto.displayName.trim(),
        phone: dto.phone?.trim() || null,
        customerId: invitation.customerId,
        role: invitation.role,
        emailVerifiedAt: new Date(),
        isActive: true,
      },
    });

    await this.prisma.organisationInvitation.update({
      where: { id: invitation.id },
      data: {
        status: 'ACCEPTED',
        acceptedAt: new Date(),
        acceptedUserId: user.id,
      },
    });

    await this.auditService.record({
      actorCustomerUserId: user.id,
      action: 'customer.invitation.accepted',
      entityType: 'OrganisationInvitation',
      entityId: invitation.id,
      customerId: invitation.customerId,
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
      metadata: { role: invitation.role, email: invitation.email },
    });

    const tokens = await this.issueTokens(user.id, user.customerId, meta, false);
    return { customer: this.toAuthenticated(user), tokens };
  }

  hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private toAuthenticated(
    user: {
      id: string;
      email: string;
      displayName: string;
      customerId: string;
      role: CustomerRole;
      emailVerifiedAt: Date | null;
    },
    sessionId?: string,
  ): AuthenticatedCustomer {
    return {
      sub: user.id,
      email: user.email,
      displayName: user.displayName,
      customerId: user.customerId,
      companyId: user.customerId,
      role: user.role,
      permissions: permissionsForRole(user.role),
      emailVerified: Boolean(user.emailVerifiedAt),
      sessionId,
    };
  }

  private async issueTokens(
    customerUserId: string,
    customerId: string,
    meta?: { ipAddress?: string; userAgent?: string },
    rememberMe = false,
  ): Promise<CustomerAuthTokens> {
    const user = await this.prisma.customerUser.findUniqueOrThrow({ where: { id: customerUserId } });
    const jti = randomUUID();
    const sessionId = randomUUID();
    const refreshToken = this.tokenService.signRefresh(customerUserId, jti, sessionId, rememberMe);
    const accessToken = this.tokenService.signAccess({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      customerId,
      role: user.role,
      emailVerifiedAt: user.emailVerifiedAt,
      sessionId,
    });

    const refreshExpiresIn = rememberMe
      ? (this.configService.get<string>('CUSTOMER_JWT_REMEMBER_EXPIRES_IN') ?? '30d')
      : (this.configService.get<string>('CUSTOMER_JWT_REFRESH_EXPIRES_IN')
        ?? this.configService.get<string>('JWT_REFRESH_EXPIRES_IN')
        ?? '7d');
    const expiresAt = this.computeExpiry(refreshExpiresIn);

    const stored = await this.prisma.customerRefreshToken.create({
      data: {
        customerUserId,
        tokenHash: this.hashToken(refreshToken),
        expiresAt,
        rememberMe,
      },
    });

    await this.prisma.customerSession.create({
      data: {
        id: sessionId,
        customerUserId,
        refreshTokenId: stored.id,
        ipAddress: meta?.ipAddress ?? null,
        userAgent: meta?.userAgent ?? null,
        expiresAt,
        rememberMe,
      },
    });

    return {
      accessToken,
      refreshToken,
      expiresIn:
        this.configService.get<string>('CUSTOMER_JWT_ACCESS_EXPIRES_IN')
        ?? this.configService.get<string>('JWT_ACCESS_EXPIRES_IN')
        ?? '15m',
      sessionId,
      rememberMe,
    };
  }

  private async revokeRefreshToken(refreshToken: string): Promise<void> {
    const tokenHash = this.hashToken(refreshToken);
    const stored = await this.prisma.customerRefreshToken.findUnique({ where: { tokenHash } });
    if (!stored) {
      return;
    }
    await this.prisma.customerSession.updateMany({
      where: { refreshTokenId: stored.id },
      data: { revokedAt: new Date() },
    });
    await this.prisma.customerRefreshToken.delete({ where: { id: stored.id } });
  }

  private computeExpiry(expiresIn: string): Date {
    const match = /^(\d+)([smhd])$/.exec(expiresIn.trim());
    const now = Date.now();
    if (!match) {
      return new Date(now + 7 * 24 * 60 * 60 * 1000);
    }
    const amount = Number(match[1]);
    const unit = match[2];
    const multipliers: Record<string, number> = {
      s: 1000,
      m: 60_000,
      h: 3_600_000,
      d: 86_400_000,
    };
    return new Date(now + amount * (multipliers[unit] ?? 86_400_000));
  }

  /** RC1 support: clear in-memory login rate limit for a customer email (all IP keys). */
  clearLoginRateLimit(email: string): number {
    const needle = email.trim().toLowerCase();
    let cleared = 0;
    for (const key of [...this.loginAttempts.keys()]) {
      if (key.endsWith(`:${needle}`)) {
        this.loginAttempts.delete(key);
        cleared += 1;
      }
    }
    return cleared;
  }

  private assertNotRateLimited(key: string): void {
    const entry = this.loginAttempts.get(key);
    if (entry && entry.resetAt > Date.now() && entry.count >= this.maxAttempts) {
      throw new ApiException(
        ERROR_CODES.AUTH_RATE_LIMITED,
        'Too many login attempts. Try again later.',
        429,
      );
    }
  }

  private recordFailedAttempt(key: string): void {
    const now = Date.now();
    const existing = this.loginAttempts.get(key);
    if (!existing || existing.resetAt <= now) {
      this.loginAttempts.set(key, { count: 1, resetAt: now + this.windowMs });
      return;
    }
    existing.count += 1;
  }
}
