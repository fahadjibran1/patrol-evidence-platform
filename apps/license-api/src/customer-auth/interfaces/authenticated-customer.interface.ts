import { CustomerRole } from '@prisma/client';
import { CustomerPermission } from '@/customer-org/customer-permissions';

export interface AuthenticatedCustomer {
  /** CustomerUser id */
  sub: string;
  email: string;
  displayName: string;
  /** Company record id (Customer.id) */
  customerId: string;
  /** Alias of customerId for company-scoped authorisation */
  companyId: string;
  role: CustomerRole;
  permissions: CustomerPermission[];
  emailVerified: boolean;
  sessionId?: string;
}

export interface CustomerAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
  sessionId: string;
  rememberMe: boolean;
}
