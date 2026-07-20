import { AdminRole } from '@prisma/client';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '@/auth/guards/roles.guard';
import { ROLES_KEY } from '@/common/decorators/roles.decorator';
import { ApiException } from '@/common/exceptions/api.exception';
import { ERROR_CODES } from '@/common/constants/error-codes';

describe('RolesGuard', () => {
  const reflector = new Reflector();
  const guard = new RolesGuard(reflector);

  function contextFor(role: AdminRole, handlerRoles?: AdminRole[]) {
    return {
      getHandler: () => handlerRoles,
      getClass: () => undefined,
      switchToHttp: () => ({
        getRequest: () => ({ admin: { sub: '1', email: 'a@b.com', role, displayName: 'X' } }),
      }),
    } as never;
  }

  it('allows access when no roles are required', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    expect(guard.canActivate(contextFor(AdminRole.SUPPORT))).toBe(true);
  });

  it('allows matching roles', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([AdminRole.ADMIN, AdminRole.SUPER_ADMIN]);
    expect(guard.canActivate(contextFor(AdminRole.ADMIN))).toBe(true);
  });

  it('rejects insufficient roles with stable code', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([AdminRole.SUPER_ADMIN]);
    expect(() => guard.canActivate(contextFor(AdminRole.SUPPORT))).toThrow(ApiException);
    try {
      guard.canActivate(contextFor(AdminRole.SUPPORT));
    } catch (error) {
      expect((error as ApiException).code).toBe(ERROR_CODES.FORBIDDEN_ROLE);
    }
  });
});

describe('ROLES_KEY metadata', () => {
  it('is a stable string key', () => {
    expect(ROLES_KEY).toBe('roles');
  });
});
