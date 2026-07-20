import { ForbiddenException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { IsNull, Repository } from 'typeorm';
import { UsersService } from '@/users/users.service';
import { LoginDto } from './dto/login.dto';
import { TokenService } from './token.service';
import { verifyPassword } from './security/password.util';
import { UserRole } from '@/common/enums/user-role.enum';
import { RefreshToken } from './entities/refresh-token.entity';

export interface AuthSessionResponse {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: UserRole;
    companyId: string | null;
    active: boolean;
    approved: boolean;
  };
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly tokenService: TokenService,
    @InjectRepository(RefreshToken)
    private readonly refreshTokenRepo: Repository<RefreshToken>,
  ) {}

  async login(dto: LoginDto): Promise<AuthSessionResponse> {
    const user = await this.usersService.findByEmail(dto.email.trim().toLowerCase());
    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const passwordMatches = await verifyPassword(dto.password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (!user.active) {
      this.logger.warn(`AUTH_ACCOUNT_DISABLED userId=${user.id}`);
      throw new ForbiddenException('User account is inactive');
    }

    if (user.role !== UserRole.ADMIN && !user.companyId) {
      throw new ForbiddenException('User is not assigned to a company');
    }

    if (user.role === UserRole.GUARD && !user.approved) {
      throw new ForbiddenException('Guard account is pending approval');
    }

    return this.issueSession(user.id);
  }

  async refresh(refreshToken: string): Promise<AuthSessionResponse> {
    if (!refreshToken?.trim()) {
      throw new UnauthorizedException('Refresh token is required');
    }

    let payload;
    try {
      payload = this.tokenService.verifyRefresh(refreshToken);
    } catch {
      this.logger.warn('AUTH_SESSION_REVOKED reason=invalid_refresh_token');
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const tokenHash = this.hashToken(refreshToken);
    const stored = await this.refreshTokenRepo.findOne({
      where: { tokenHash, revokedAt: IsNull() },
    });

    if (!stored || stored.userId !== payload.sub || stored.expiresAt < new Date()) {
      this.logger.warn(`AUTH_SESSION_REVOKED userId=${payload.sub} reason=refresh_not_found_or_expired`);
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const user = await this.usersService.findById(payload.sub);
    if (!user.active) {
      stored.revokedAt = new Date();
      await this.refreshTokenRepo.save(stored);
      this.logger.warn(`AUTH_ACCOUNT_DISABLED userId=${user.id}`);
      throw new ForbiddenException('User account is inactive');
    }

    stored.revokedAt = new Date();
    await this.refreshTokenRepo.save(stored);

    const session = await this.issueSession(user.id);
    this.logger.log(`AUTH_ACCESS_TOKEN_REFRESHED userId=${user.id}`);
    return session;
  }

  async logout(userId: string, refreshToken?: string): Promise<void> {
    if (refreshToken?.trim()) {
      const tokenHash = this.hashToken(refreshToken);
      await this.refreshTokenRepo.update({ tokenHash, userId }, { revokedAt: new Date() });
    } else {
      await this.refreshTokenRepo.update({ userId, revokedAt: IsNull() }, { revokedAt: new Date() });
    }

    this.logger.log(`AUTH_EXPLICIT_LOGOUT userId=${userId}`);
  }

  async me(userId: string): Promise<AuthSessionResponse['user']> {
    const user = await this.usersService.findById(userId);

    if (!user.active) {
      this.logger.warn(`AUTH_ACCOUNT_DISABLED userId=${user.id}`);
      throw new ForbiddenException('User account is inactive');
    }

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      companyId: user.companyId,
      active: user.active,
      approved: user.approved,
    };
  }

  private async issueSession(userId: string): Promise<AuthSessionResponse> {
    const user = await this.usersService.findById(userId);
    const authenticated = {
      sub: user.id,
      email: user.email,
      role: user.role,
      companyId: user.companyId,
    };

    const accessToken = this.tokenService.sign(authenticated);
    const { token: refreshToken, expiresAt } = this.tokenService.signRefresh(authenticated);

    await this.refreshTokenRepo.save(
      this.refreshTokenRepo.create({
        userId: user.id,
        tokenHash: this.hashToken(refreshToken),
        expiresAt,
      }),
    );

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        companyId: user.companyId,
        active: user.active,
        approved: user.approved,
      },
    };
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
