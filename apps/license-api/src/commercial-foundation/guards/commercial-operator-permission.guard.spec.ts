import { AdminRole } from '@prisma/client';
import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { CommercialOperatorPermissionGuard } from './commercial-operator-permission.guard';
import { CommercialOperatorPermission } from '../commercial-operator-permissions';

function context(request: {
  admin?: { role: AdminRole };
  user?: { role: AdminRole };
} = {}) {
  return {
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('CommercialOperatorPermissionGuard', () => {
  const reflector = new Reflector();
  const guard = new CommercialOperatorPermissionGuard(reflector);

  beforeEach(() => jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(CommercialOperatorPermission.APPROVE_ISSUANCE));
  afterEach(() => jest.restoreAllMocks());

  it('denies an unauthenticated request', () => {
    expect(() => guard.canActivate(context())).toThrow(expect.objectContaining({ code: 'COMMERCIAL_OPERATOR_FORBIDDEN' }));
  });

  it('does not accept the obsolete request.user principal', () => {
    expect(() => guard.canActivate(context({ user: { role: AdminRole.SUPER_ADMIN } }))).toThrow(
      expect.objectContaining({ code: 'COMMERCIAL_OPERATOR_FORBIDDEN' }),
    );
  });

  it.each(Object.values(CommercialOperatorPermission))(
    'allows SUPER_ADMIN permission %s',
    (permission) => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(permission);
      expect(guard.canActivate(context({ admin: { role: AdminRole.SUPER_ADMIN } }))).toBe(true);
    },
  );

  it('allows ADMIN to view the approval queue', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(CommercialOperatorPermission.VIEW_APPROVAL_QUEUE);
    expect(guard.canActivate(context({ admin: { role: AdminRole.ADMIN } }))).toBe(true);
  });

  it.each([
    CommercialOperatorPermission.APPROVE_ISSUANCE,
    CommercialOperatorPermission.HOLD_ORDER,
    CommercialOperatorPermission.REJECT_ORDER,
    CommercialOperatorPermission.RELEASE_HOLD,
    CommercialOperatorPermission.RESEND_LICENCE,
  ])('denies ADMIN permission %s', (permission) => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(permission);
    expect(() => guard.canActivate(context({ admin: { role: AdminRole.ADMIN } }))).toThrow(
      expect.objectContaining({ code: 'COMMERCIAL_OPERATOR_FORBIDDEN' }),
    );
  });

  it.each(Object.values(CommercialOperatorPermission))(
    'denies SUPPORT permission %s',
    (permission) => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(permission);
      expect(() => guard.canActivate(context({ admin: { role: AdminRole.SUPPORT } }))).toThrow(
        expect.objectContaining({ code: 'COMMERCIAL_OPERATOR_FORBIDDEN' }),
      );
    },
  );

  it('allows routes without a commercial permission requirement', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    expect(guard.canActivate(context())).toBe(true);
  });
});
