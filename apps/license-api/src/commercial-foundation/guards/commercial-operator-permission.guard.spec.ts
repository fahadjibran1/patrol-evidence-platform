import { AdminRole } from '@prisma/client';
import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { CommercialOperatorPermissionGuard } from './commercial-operator-permission.guard';
import { CommercialOperatorPermission } from '../commercial-operator-permissions';

function context(user?: { role: AdminRole }) {
  return {
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('CommercialOperatorPermissionGuard', () => {
  const reflector = new Reflector();
  const guard = new CommercialOperatorPermissionGuard(reflector);

  beforeEach(() => jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(CommercialOperatorPermission.APPROVE_ISSUANCE));
  afterEach(() => jest.restoreAllMocks());

  it('fails unauthenticated and ordinary ADMIN approval closed', () => {
    expect(() => guard.canActivate(context())).toThrow(expect.objectContaining({ code: 'COMMERCIAL_OPERATOR_FORBIDDEN' }));
    expect(() => guard.canActivate(context({ role: AdminRole.ADMIN }))).toThrow(expect.objectContaining({ code: 'COMMERCIAL_OPERATOR_FORBIDDEN' }));
  });

  it('allows only the explicitly permissioned SUPER_ADMIN', () => {
    expect(guard.canActivate(context({ role: AdminRole.SUPER_ADMIN }))).toBe(true);
  });
});
