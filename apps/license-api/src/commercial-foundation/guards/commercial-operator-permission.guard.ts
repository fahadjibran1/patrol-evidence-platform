import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { AuthenticatedAdmin } from '@/auth/interfaces/authenticated-admin.interface';
import { ApiException } from '@/common/exceptions/api.exception';
import { ERROR_CODES } from '@/common/constants/error-codes';
import { COMMERCIAL_PERMISSION_KEY } from '../decorators/require-commercial-permission.decorator';
import { adminHasCommercialPermission, CommercialOperatorPermission } from '../commercial-operator-permissions';

@Injectable()
export class CommercialOperatorPermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<CommercialOperatorPermission>(
      COMMERCIAL_PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required) return true;
    const admin = context.switchToHttp().getRequest<Request & { admin?: AuthenticatedAdmin }>().admin;
    if (!admin || !adminHasCommercialPermission(admin.role, required)) {
      throw new ApiException(ERROR_CODES.COMMERCIAL_OPERATOR_FORBIDDEN, 'Commercial approval permission is required.', 403);
    }
    return true;
  }
}
