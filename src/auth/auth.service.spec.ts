import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { UsersService } from '@/users/users.service';
import { TokenService } from './token.service';
import { UserRole } from '@/common/enums/user-role.enum';
import * as passwordUtil from './security/password.util';

describe('AuthService', () => {
  let service: AuthService;
  let usersService: jest.Mocked<Pick<UsersService, 'findByEmail' | 'findById'>>;
  let tokenService: jest.Mocked<Pick<TokenService, 'sign'>>;

  beforeEach(() => {
    usersService = {
      findByEmail: jest.fn(),
      findById: jest.fn(),
    };

    tokenService = {
      sign: jest.fn().mockReturnValue('signed-token'),
    };

    service = new AuthService(usersService as unknown as UsersService, tokenService as unknown as TokenService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns access token and user payload for valid credentials', async () => {
    usersService.findByEmail.mockResolvedValue({
      id: 'user-1',
      email: 'alpha.admin@patrol.local',
      passwordHash: 'hash',
      firstName: 'Alpha',
      lastName: 'Admin',
      role: UserRole.COMPANY_ADMIN,
      companyId: 'company-1',
      active: true,
      approved: true,
    } as never);

    jest.spyOn(passwordUtil, 'verifyPassword').mockResolvedValue(true);

    const result = await service.login({
      email: 'alpha.admin@patrol.local',
      password: 'Password123!',
    });

    expect(result.accessToken).toBe('signed-token');
    expect(result.user.role).toBe(UserRole.COMPANY_ADMIN);
    expect(tokenService.sign).toHaveBeenCalledWith({
      sub: 'user-1',
      email: 'alpha.admin@patrol.local',
      role: UserRole.COMPANY_ADMIN,
      companyId: 'company-1',
    });
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
});
