import { AdminRole } from '@prisma/client';

export interface AuthenticatedAdmin {
  sub: string;
  email: string;
  role: AdminRole;
  displayName: string;
  mfaVerified?: boolean;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
}
