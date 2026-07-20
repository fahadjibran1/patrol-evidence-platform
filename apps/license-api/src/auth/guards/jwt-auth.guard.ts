import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { AuthService } from '@/auth/auth.service';
import { AuthenticatedAdmin } from '@/auth/interfaces/authenticated-admin.interface';
import { ApiException } from '@/common/exceptions/api.exception';
import { ERROR_CODES } from '@/common/constants/error-codes';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      admin?: AuthenticatedAdmin;
    }>();

    const token = this.extractToken(request.headers.authorization);
    if (!token) {
      throw new ApiException(ERROR_CODES.AUTH_INVALID_CREDENTIALS, 'Missing bearer token', 401);
    }

    request.admin = await this.authService.validateAccessToken(token);
    return true;
  }

  private extractToken(authorization?: string): string | null {
    if (!authorization?.startsWith('Bearer ')) {
      return null;
    }
    const token = authorization.slice('Bearer '.length).trim();
    return token || null;
  }
}
