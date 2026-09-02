import { SetMetadata } from '@nestjs/common';
import { CustomerPermission } from '@/customer-org/customer-permissions';

export const CUSTOMER_PERMISSIONS_KEY = 'customer_permissions';

export const RequireCustomerPermissions = (...permissions: CustomerPermission[]) =>
  SetMetadata(CUSTOMER_PERMISSIONS_KEY, permissions);
