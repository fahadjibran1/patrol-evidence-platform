import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes } from 'crypto';
import { AuthenticatedUser } from './interfaces/authenticated-request.interface';

interface JwtPayload extends AuthenticatedUser {
  iat: number;
  exp: number;
  typ?: 'access' | 'refresh';
}

@Injectable()
export class TokenService {
  private readonly secret: string;
  private readonly expiresInHours: number;
  private readonly refreshExpiresInDays: number;

  constructor(private readonly configService: ConfigService) {
    this.secret = this.configService.getOrThrow<string>('jwtSecret');
    this.expiresInHours = this.configService.get<number>('jwtExpiresInHours') ?? 12;
    this.refreshExpiresInDays = this.configService.get<number>('jwtRefreshExpiresInDays') ?? 90;
  }

  sign(user: AuthenticatedUser): string {
    return this.signTyped(user, 'access', this.expiresInHours * 60 * 60);
  }

  signRefresh(user: AuthenticatedUser): { token: string; expiresAt: Date } {
    const expiresInSeconds = this.refreshExpiresInDays * 24 * 60 * 60;
    const token = this.signTyped(user, 'refresh', expiresInSeconds);
    return {
      token,
      expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
    };
  }

  verify(token: string): AuthenticatedUser {
    const decoded = this.verifyRaw(token);
    if (decoded.typ === 'refresh') {
      throw new Error('Refresh token cannot be used as access token');
    }
    return this.toAuthenticatedUser(decoded);
  }

  verifyRefresh(token: string): AuthenticatedUser {
    const decoded = this.verifyRaw(token);
    if (decoded.typ !== 'refresh') {
      throw new Error('Invalid refresh token type');
    }
    return this.toAuthenticatedUser(decoded);
  }

  createOpaqueRefreshToken(): string {
    return randomBytes(48).toString('base64url');
  }

  private signTyped(user: AuthenticatedUser, typ: 'access' | 'refresh', expiresInSeconds: number): string {
    const nowInSeconds = Math.floor(Date.now() / 1000);
    const payload: JwtPayload = {
      ...user,
      typ,
      iat: nowInSeconds,
      exp: nowInSeconds + expiresInSeconds,
    };

    const header = this.base64UrlEncode(
      JSON.stringify({
        alg: 'HS256',
        typ: 'JWT',
      }),
    );
    const encodedPayload = this.base64UrlEncode(JSON.stringify(payload));
    const signature = this.signValue(`${header}.${encodedPayload}`);

    return `${header}.${encodedPayload}.${signature}`;
  }

  private verifyRaw(token: string): JwtPayload {
    const [header, payload, signature] = token.split('.');

    if (!header || !payload || !signature) {
      throw new Error('Malformed token');
    }

    const expectedSignature = this.signValue(`${header}.${payload}`);
    if (signature !== expectedSignature) {
      throw new Error('Invalid token signature');
    }

    const decoded = JSON.parse(this.base64UrlDecode(payload)) as JwtPayload;
    const nowInSeconds = Math.floor(Date.now() / 1000);

    if (!decoded.exp || decoded.exp <= nowInSeconds) {
      throw new Error('Token expired');
    }

    return decoded;
  }

  private toAuthenticatedUser(decoded: JwtPayload): AuthenticatedUser {
    return {
      sub: decoded.sub,
      email: decoded.email,
      role: decoded.role,
      companyId: decoded.companyId ?? null,
    };
  }

  private signValue(value: string): string {
    return createHmac('sha256', this.secret).update(value).digest('base64url');
  }

  private base64UrlEncode(value: string): string {
    return Buffer.from(value, 'utf8').toString('base64url');
  }

  private base64UrlDecode(value: string): string {
    return Buffer.from(value, 'base64url').toString('utf8');
  }
}
