import { SetMetadata } from '@nestjs/common';
import { CommercialOperatorPermission } from '../commercial-operator-permissions';

export const COMMERCIAL_PERMISSION_KEY = 'commercial_operator_permission';
export const RequireCommercialPermission = (permission: CommercialOperatorPermission) =>
  SetMetadata(COMMERCIAL_PERMISSION_KEY, permission);
