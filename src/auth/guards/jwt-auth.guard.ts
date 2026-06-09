import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthenticatedUser } from '@/auth/interfaces/authenticated-request.interface';
import { TokenService } from '@/auth/token.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly tokenService: TokenService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      query?: Record<string, string | undefined>;
      user?: AuthenticatedUser;
    }>();

    const token = this.extractToken(request);
    if (!token) {
      throw new UnauthorizedException('Missing bearer token');
    }

    try {
      request.user = this.tokenService.verify(token);
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  private extractToken(request: {
    headers: Record<string, string | undefined>;
    query?: Record<string, string | undefined>;
  }): string | null {
    const authorization = request.headers.authorization;
    if (authorization?.startsWith('Bearer ')) {
      const bearerToken = authorization.slice('Bearer '.length).trim();
      if (bearerToken) {
        return bearerToken;
      }
    }

    const queryToken = request.query?.access_token?.trim();
    return queryToken || null;
  }
}
