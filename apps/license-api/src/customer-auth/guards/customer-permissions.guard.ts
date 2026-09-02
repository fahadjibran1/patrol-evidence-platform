import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CustomerPermission } from '@/customer-org/customer-permissions';
import { ApiException } from '@/common/exceptions/api.exception';
import { ERROR_CODES } from '@/common/constants/error-codes';
import { CUSTOMER_PERMISSIONS_KEY } from '../decorators/require-customer-permissions.decorator';
import { AuthenticatedCustomer } from '../interfaces/authenticated-customer.interface';
import { roleHasPermission } from '@/customer-org/customer-permissions';

@Injectable()
export class CustomerPermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<CustomerPermission[]>(CUSTOMER_PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{ customer?: AuthenticatedCustomer }>();
    const customer = request.customer;
    if (!customer) {
      throw new ApiException(ERROR_CODES.AUTH_INVALID_CREDENTIALS, 'Missing customer authentication', 401);
    }

    const allowed = required.every(
      (permission) =>
        customer.permissions?.includes(permission)
        || roleHasPermission(customer.role, permission),
    );
    if (!allowed) {
      throw new ApiException(ERROR_CODES.CUSTOMER_PERMISSION_DENIED, 'Insufficient organisation permissions', 403);
    }
    return true;
  }
}
