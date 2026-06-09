import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { AuthenticatedUser } from './interfaces/authenticated-request.interface';

interface JwtPayload extends AuthenticatedUser {
  iat: number;
  exp: number;
}

@Injectable()
export class TokenService {
  private readonly secret: string;
  private readonly expiresInHours: number;

  constructor(private readonly configService: ConfigService) {
    this.secret = this.configService.getOrThrow<string>('jwtSecret');
    this.expiresInHours = this.configService.get<number>('jwtExpiresInHours') ?? 12;
  }

  sign(user: AuthenticatedUser): string {
    const nowInSeconds = Math.floor(Date.now() / 1000);
    const payload: JwtPayload = {
      ...user,
      iat: nowInSeconds,
      exp: nowInSeconds + this.expiresInHours * 60 * 60,
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

  verify(token: string): AuthenticatedUser {
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
