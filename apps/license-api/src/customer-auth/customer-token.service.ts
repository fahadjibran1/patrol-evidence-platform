import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { CustomerRole } from '@prisma/client';
import { AuthenticatedCustomer } from './interfaces/authenticated-customer.interface';
import { CustomerPermission, permissionsForRole } from '@/customer-org/customer-permissions';

export const CUSTOMER_TOKEN_AUDIENCE = 'customer-portal';

interface CustomerAccessPayload {
  sub: string;
  email: string;
  displayName: string;
  customerId: string;
  companyId: string;
  role: CustomerRole;
  emailVerified: boolean;
  sessionId?: string;
  type: 'customer_access';
}

interface CustomerRefreshPayload {
  sub: string;
  type: 'customer_refresh';
  jti: string;
  sessionId: string;
  rememberMe?: boolean;
}

@Injectable()
export class CustomerTokenService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  signAccess(user: {
    id: string;
    email: string;
    displayName: string;
    customerId: string;
    role: CustomerRole;
    emailVerifiedAt: Date | null;
    sessionId?: string;
  }): string {
    const payload: CustomerAccessPayload = {
      sub: user.id,
      email: user.email,
      displayName: user.displayName,
      customerId: user.customerId,
      companyId: user.customerId,
      role: user.role,
      emailVerified: Boolean(user.emailVerifiedAt),
      sessionId: user.sessionId,
      type: 'customer_access',
    };
    return this.jwtService.sign(payload, {
      expiresIn: this.configService.get<string>('CUSTOMER_JWT_ACCESS_EXPIRES_IN')
        ?? this.configService.get<string>('JWT_ACCESS_EXPIRES_IN')
        ?? '15m',
      audience: CUSTOMER_TOKEN_AUDIENCE,
    });
  }

  signRefresh(customerUserId: string, jti: string, sessionId: string, rememberMe: boolean): string {
    const payload: CustomerRefreshPayload = {
      sub: customerUserId,
      type: 'customer_refresh',
      jti,
      sessionId,
      rememberMe,
    };
    return this.jwtService.sign(payload, {
      expiresIn: rememberMe
        ? (this.configService.get<string>('CUSTOMER_JWT_REMEMBER_EXPIRES_IN') ?? '30d')
        : (this.configService.get<string>('CUSTOMER_JWT_REFRESH_EXPIRES_IN')
          ?? this.configService.get<string>('JWT_REFRESH_EXPIRES_IN')
          ?? '7d'),
      audience: CUSTOMER_TOKEN_AUDIENCE,
    });
  }

  /** Signed opaque invitation / reset / verify tokens (short-lived). */
  signSecureAction(payload: Record<string, unknown>, expiresIn: string): string {
    return this.jwtService.sign(
      { ...payload, type: 'customer_secure_action' },
      { expiresIn, audience: CUSTOMER_TOKEN_AUDIENCE },
    );
  }

  verifySecureAction<T extends Record<string, unknown>>(token: string): T {
    const payload = this.jwtService.verify<T & { type?: string }>(token, {
      audience: CUSTOMER_TOKEN_AUDIENCE,
    });
    if (payload.type !== 'customer_secure_action') {
      throw new Error('Invalid secure action token');
    }
    return payload;
  }

  verifyAccess(token: string): AuthenticatedCustomer {
    const payload = this.jwtService.verify<CustomerAccessPayload>(token, {
      audience: CUSTOMER_TOKEN_AUDIENCE,
    });
    if (payload.type !== 'customer_access') {
      throw new Error('Invalid customer access token');
    }
    const role = payload.role ?? CustomerRole.VIEWER;
    return {
      sub: payload.sub,
      email: payload.email,
      displayName: payload.displayName,
      customerId: payload.customerId,
      companyId: payload.companyId ?? payload.customerId,
      role,
      permissions: permissionsForRole(role) as CustomerPermission[],
      emailVerified: Boolean(payload.emailVerified),
      sessionId: payload.sessionId,
    };
  }

  verifyRefresh(token: string): CustomerRefreshPayload {
    const payload = this.jwtService.verify<CustomerRefreshPayload>(token, {
      audience: CUSTOMER_TOKEN_AUDIENCE,
    });
    if (payload.type !== 'customer_refresh') {
      throw new Error('Invalid customer refresh token');
    }
    return payload;
  }
}
