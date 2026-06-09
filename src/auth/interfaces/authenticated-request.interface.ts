import { Request } from 'express';
import { UserRole } from '@/common/enums/user-role.enum';

export interface AuthenticatedUser {
  sub: string;
  email: string;
  role: UserRole;
  companyId: string | null;
}

export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
}
