import { TokenService } from './token.service';
import { UserRole } from '@/common/enums/user-role.enum';

describe('TokenService', () => {
  const configService = {
    getOrThrow: jest.fn().mockReturnValue('patrol-evidence-platform-test-secret'),
    get: jest.fn((key: string) => {
      if (key === 'jwtExpiresInHours') {
        return 1 / 3600; // 1 second access token for expiry tests
      }
      if (key === 'jwtRefreshExpiresInDays') {
        return 90;
      }
      return undefined;
    }),
  };

  it('signs and verifies access tokens', () => {
    const service = new TokenService(configService as never);
    const token = service.sign({
      sub: 'user-1',
      email: 'a@b.com',
      role: UserRole.ADMIN,
      companyId: null,
    });

    expect(service.verify(token).sub).toBe('user-1');
  });

  it('rejects refresh tokens as access tokens', () => {
    const service = new TokenService(configService as never);
    const { token } = service.signRefresh({
      sub: 'user-1',
      email: 'a@b.com',
      role: UserRole.ADMIN,
      companyId: null,
    });

    expect(() => service.verify(token)).toThrow(/Refresh token/);
    expect(service.verifyRefresh(token).sub).toBe('user-1');
  });
});
