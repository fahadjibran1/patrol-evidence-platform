import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AdminRole } from '@prisma/client';
import { AuthenticatedAdmin } from './interfaces/authenticated-admin.interface';

interface AccessTokenPayload {
  sub: string;
  email: string;
  role: AdminRole;
  displayName: string;
  type: 'access';
  mfaVerified: boolean;
}

interface RefreshTokenPayload {
  sub: string;
  type: 'refresh';
  jti: string;
  mfaVerified: boolean;
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  signAccess(admin: { id: string; email: string; role: AdminRole; displayName: string }, mfaVerified = false): string {
    const payload: AccessTokenPayload = {
      sub: admin.id,
      email: admin.email,
      role: admin.role,
      displayName: admin.displayName,
      type: 'access',
      mfaVerified,
    };
    return this.jwtService.sign(payload, {
      expiresIn: this.configService.get<string>('JWT_ACCESS_EXPIRES_IN') ?? '15m',
    });
  }

  signRefresh(adminId: string, jti: string, mfaVerified = false): string {
    const payload: RefreshTokenPayload = { sub: adminId, type: 'refresh', jti, mfaVerified };
    return this.jwtService.sign(payload, {
      expiresIn: this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') ?? '7d',
    });
  }

  verifyAccess(token: string): AuthenticatedAdmin {
    const payload = this.jwtService.verify<AccessTokenPayload>(token);
    if (payload.type !== 'access') {
      throw new Error('Invalid token type');
    }
    return {
      sub: payload.sub,
      email: payload.email,
      role: payload.role,
      displayName: payload.displayName,
      mfaVerified: payload.mfaVerified === true,
    };
  }

  verifyRefresh(token: string): RefreshTokenPayload {
    const payload = this.jwtService.verify<RefreshTokenPayload>(token);
    if (payload.type !== 'refresh') {
      throw new Error('Invalid token type');
    }
    return payload;
  }
}
