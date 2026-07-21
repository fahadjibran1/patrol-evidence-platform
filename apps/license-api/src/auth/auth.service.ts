import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'crypto';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '@/prisma/prisma.service';
import { AuditService } from '@/audit/audit.service';
import { ApiException } from '@/common/exceptions/api.exception';
import { ERROR_CODES } from '@/common/constants/error-codes';
import { TokenService } from './token.service';
import { LoginDto } from './dto/auth.dto';
import { AuthenticatedAdmin, AuthTokens } from './interfaces/authenticated-admin.interface';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

@Injectable()
export class AuthService {
  private readonly loginAttempts = new Map<string, RateLimitEntry>();
  private readonly maxAttempts = 10;
  private readonly windowMs = 15 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService,
    private readonly auditService: AuditService,
    private readonly configService: ConfigService,
  ) {}

  async login(
    dto: LoginDto,
    meta?: { ipAddress?: string; userAgent?: string },
  ): Promise<{ admin: AuthenticatedAdmin; tokens: AuthTokens }> {
    const key = `${meta?.ipAddress ?? 'unknown'}:${dto.email.trim().toLowerCase()}`;
    this.assertNotRateLimited(key);

    const admin = await this.prisma.admin.findUnique({
      where: { email: dto.email.trim().toLowerCase() },
    });

    if (!admin || !(await bcrypt.compare(dto.password, admin.passwordHash))) {
      this.recordFailedAttempt(key);
      await this.auditService.record({
        action: 'auth.login_failed',
        entityType: 'Admin',
        metadata: { email: dto.email.trim().toLowerCase() },
        ipAddress: meta?.ipAddress,
        userAgent: meta?.userAgent,
      });
      throw new ApiException(ERROR_CODES.AUTH_INVALID_CREDENTIALS, 'Invalid email or password', 401);
    }

    if (!admin.isActive) {
      throw new ApiException(ERROR_CODES.AUTH_ACCOUNT_INACTIVE, 'Administrator account is inactive', 403);
    }

    this.loginAttempts.delete(key);
    await this.prisma.admin.update({
      where: { id: admin.id },
      data: { lastLoginAt: new Date() },
    });

    const tokens = await this.issueTokens(admin.id);
    await this.auditService.record({
      actorAdminId: admin.id,
      action: 'auth.login_success',
      entityType: 'Admin',
      entityId: admin.id,
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });

    return {
      admin: {
        sub: admin.id,
        email: admin.email,
        role: admin.role,
        displayName: admin.displayName,
      },
      tokens,
    };
  }

  async logout(adminId: string, refreshToken?: string, meta?: { ipAddress?: string; userAgent?: string }): Promise<void> {
    if (refreshToken) {
      await this.revokeRefreshToken(refreshToken);
    } else {
      await this.prisma.refreshToken.deleteMany({ where: { adminId } });
    }

    await this.auditService.record({
      actorAdminId: adminId,
      action: 'auth.logout',
      entityType: 'Admin',
      entityId: adminId,
      ipAddress: meta?.ipAddress,
      userAgent: meta?.userAgent,
    });
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    try {
      const payload = this.tokenService.verifyRefresh(refreshToken);
      const tokenHash = this.hashToken(refreshToken);
      const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });
      if (!stored || stored.adminId !== payload.sub || stored.expiresAt < new Date()) {
        throw new ApiException(ERROR_CODES.AUTH_INVALID_REFRESH, 'Invalid or expired refresh token', 401);
      }

      const admin = await this.prisma.admin.findUnique({ where: { id: payload.sub } });
      if (!admin?.isActive) {
        throw new ApiException(ERROR_CODES.AUTH_ACCOUNT_INACTIVE, 'Administrator account is inactive', 403);
      }

      await this.prisma.refreshToken.delete({ where: { id: stored.id } });
      return this.issueTokens(admin.id);
    } catch (error) {
      if (error instanceof ApiException) {
        throw error;
      }
      throw new ApiException(ERROR_CODES.AUTH_INVALID_REFRESH, 'Invalid or expired refresh token', 401);
    }
  }

  async validateAccessToken(token: string): Promise<AuthenticatedAdmin> {
    try {
      const admin = this.tokenService.verifyAccess(token);
      const record = await this.prisma.admin.findUnique({ where: { id: admin.sub } });
      if (!record?.isActive) {
        throw new ApiException(ERROR_CODES.AUTH_ACCOUNT_INACTIVE, 'Administrator account is inactive', 403);
      }
      return admin;
    } catch (error) {
      if (error instanceof ApiException) {
        throw error;
      }
      throw new ApiException(ERROR_CODES.AUTH_INVALID_CREDENTIALS, 'Invalid or expired access token', 401);
    }
  }

  async me(adminId: string): Promise<AuthenticatedAdmin> {
    const admin = await this.prisma.admin.findUnique({ where: { id: adminId } });
    if (!admin) {
      throw new ApiException(ERROR_CODES.ADMIN_NOT_FOUND, 'Administrator not found', 404);
    }
    return {
      sub: admin.id,
      email: admin.email,
      role: admin.role,
      displayName: admin.displayName,
    };
  }

  async verifyPassword(adminId: string, password: string): Promise<boolean> {
    const admin = await this.prisma.admin.findUnique({ where: { id: adminId } });
    if (!admin || !admin.isActive) {
      return false;
    }
    return bcrypt.compare(password, admin.passwordHash);
  }

  hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 12);
  }

  private async issueTokens(adminId: string): Promise<AuthTokens> {
    const admin = await this.prisma.admin.findUniqueOrThrow({ where: { id: adminId } });
    const jti = randomUUID();
    const refreshToken = this.tokenService.signRefresh(adminId, jti);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await this.prisma.refreshToken.create({
      data: {
        adminId,
        tokenHash: this.hashToken(refreshToken),
        expiresAt,
      },
    });

    return {
      accessToken: this.tokenService.signAccess(admin),
      refreshToken,
      expiresIn: this.configService.get<string>('JWT_ACCESS_EXPIRES_IN') ?? '15m',
    };
  }

  private async revokeRefreshToken(refreshToken: string): Promise<void> {
    const tokenHash = this.hashToken(refreshToken);
    await this.prisma.refreshToken.deleteMany({ where: { tokenHash } });
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private assertNotRateLimited(key: string): void {
    const entry = this.loginAttempts.get(key);
    if (!entry) {
      return;
    }
    if (Date.now() > entry.resetAt) {
      this.loginAttempts.delete(key);
      return;
    }
    if (entry.count >= this.maxAttempts) {
      throw new ApiException(ERROR_CODES.AUTH_RATE_LIMITED, 'Too many login attempts. Try again later.', 429);
    }
  }

  private recordFailedAttempt(key: string): void {
    const now = Date.now();
    const entry = this.loginAttempts.get(key);
    if (!entry || now > entry.resetAt) {
      this.loginAttempts.set(key, { count: 1, resetAt: now + this.windowMs });
      return;
    }
    entry.count += 1;
  }
}
