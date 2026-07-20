import { AdminRole } from '@prisma/client';

export interface AuthenticatedAdmin {
  sub: string;
  email: string;
  role: AdminRole;
  displayName: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
}
