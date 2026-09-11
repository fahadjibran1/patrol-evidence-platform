import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { UserRole } from '@/common/enums/user-role.enum';
import { readDesktopWorkspaceConfig } from '@/desktop/desktop-config.util';
import { TokenService } from '@/auth/token.service';

@Injectable()
export class DesktopInitializedMutationGuard implements CanActivate {
  constructor(private readonly tokenService: TokenService) {}

  canActivate(context: ExecutionContext): boolean {
    if (readDesktopWorkspaceConfig().setupCompleted !== true) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      user?: ReturnType<TokenService['verify']>;
    }>();
    const authorization = request.headers.authorization;
    const token = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length).trim() : '';
    if (!token) {
      throw new UnauthorizedException('An authenticated administrator is required after setup');
    }

    try {
      const user = this.tokenService.verify(token);
      if (user.role !== UserRole.ADMIN && user.role !== UserRole.COMPANY_ADMIN) {
        throw new ForbiddenException('Administrator access is required');
      }
      request.user = user;
      return true;
    } catch (error) {
      if (error instanceof ForbiddenException) {
        throw error;
      }
      throw new UnauthorizedException('Invalid or expired administrator token');
    }
  }
}
