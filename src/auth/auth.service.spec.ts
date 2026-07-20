import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { UsersService } from '@/users/users.service';
import { TokenService } from './token.service';
import { UserRole } from '@/common/enums/user-role.enum';
import * as passwordUtil from './security/password.util';
import { RefreshToken } from './entities/refresh-token.entity';
import { Repository } from 'typeorm';

describe('AuthService', () => {
  let service: AuthService;
  let usersService: jest.Mocked<Pick<UsersService, 'findByEmail' | 'findById'>>;
  let tokenService: jest.Mocked<Pick<TokenService, 'sign' | 'signRefresh' | 'verifyRefresh'>>;
  let refreshTokenRepo: jest.Mocked<Pick<Repository<RefreshToken>, 'save' | 'create' | 'findOne' | 'update'>>;

  beforeEach(() => {
    usersService = {
      findByEmail: jest.fn(),
      findById: jest.fn(),
    };

    tokenService = {
      sign: jest.fn().mockReturnValue('signed-access-token'),
      signRefresh: jest.fn().mockReturnValue({
        token: 'signed-refresh-token',
        expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      }),
      verifyRefresh: jest.fn().mockReturnValue({
        sub: 'user-1',
        email: 'alpha.admin@patrol.local',
        role: UserRole.COMPANY_ADMIN,
        companyId: 'company-1',
      }),
    };

    refreshTokenRepo = {
      save: jest.fn().mockImplementation(async (entity) => entity),
      create: jest.fn().mockImplementation((entity) => entity),
      findOne: jest.fn(),
      update: jest.fn(),
    };

    service = new AuthService(
      usersService as unknown as UsersService,
      tokenService as unknown as TokenService,
      refreshTokenRepo as unknown as Repository<RefreshToken>,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns access and refresh tokens for valid credentials', async () => {
    const user = {
      id: 'user-1',
      email: 'alpha.admin@patrol.local',
      passwordHash: 'hash',
      firstName: 'Alpha',
      lastName: 'Admin',
      role: UserRole.COMPANY_ADMIN,
      companyId: 'company-1',
      active: true,
      approved: true,
    };
    usersService.findByEmail.mockResolvedValue(user as never);
    usersService.findById.mockResolvedValue(user as never);
    jest.spyOn(passwordUtil, 'verifyPassword').mockResolvedValue(true);

    const result = await service.login({
      email: 'alpha.admin@patrol.local',
      password: 'Password123!',
    });

    expect(result.accessToken).toBe('signed-access-token');
    expect(result.refreshToken).toBe('signed-refresh-token');
    expect(result.user.role).toBe(UserRole.COMPANY_ADMIN);
    expect(tokenService.sign).toHaveBeenCalled();
    expect(tokenService.signRefresh).toHaveBeenCalled();
    expect(refreshTokenRepo.save).toHaveBeenCalled();
  });

  it('rejects invalid credentials', async () => {
    usersService.findByEmail.mockResolvedValue(null);

    await expect(
      service.login({
        email: 'missing@patrol.local',
        password: 'Password123!',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects pending guards', async () => {
    usersService.findByEmail.mockResolvedValue({
      id: 'guard-1',
      email: 'pending.guard@patrol.local',
      passwordHash: 'hash',
      firstName: 'Pending',
      lastName: 'Guard',
      role: UserRole.GUARD,
      companyId: 'company-1',
      active: true,
      approved: false,
    } as never);

    jest.spyOn(passwordUtil, 'verifyPassword').mockResolvedValue(true);

    await expect(
      service.login({
        email: 'pending.guard@patrol.local',
        password: 'Password123!',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refreshes a valid refresh token and rotates storage', async () => {
    const user = {
      id: 'user-1',
      email: 'alpha.admin@patrol.local',
      passwordHash: 'hash',
      firstName: 'Alpha',
      lastName: 'Admin',
      role: UserRole.COMPANY_ADMIN,
      companyId: 'company-1',
      active: true,
      approved: true,
    };
    usersService.findById.mockResolvedValue(user as never);
    refreshTokenRepo.findOne.mockResolvedValue({
      id: 'rt-1',
      userId: 'user-1',
      tokenHash: 'hash',
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
    } as never);

    const result = await service.refresh('signed-refresh-token');
    expect(result.accessToken).toBe('signed-access-token');
    expect(result.refreshToken).toBe('signed-refresh-token');
    expect(refreshTokenRepo.save).toHaveBeenCalled();
  });

  it('rejects revoked or missing refresh tokens', async () => {
    refreshTokenRepo.findOne.mockResolvedValue(null);
    await expect(service.refresh('signed-refresh-token')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects refresh for disabled accounts', async () => {
    refreshTokenRepo.findOne.mockResolvedValue({
      id: 'rt-1',
      userId: 'user-1',
      tokenHash: 'hash',
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
    } as never);
    usersService.findById.mockResolvedValue({
      id: 'user-1',
      email: 'alpha.admin@patrol.local',
      passwordHash: 'hash',
      firstName: 'Alpha',
      lastName: 'Admin',
      role: UserRole.COMPANY_ADMIN,
      companyId: 'company-1',
      active: false,
      approved: true,
    } as never);

    await expect(service.refresh('signed-refresh-token')).rejects.toBeInstanceOf(ForbiddenException);
  });
});
