import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@/common/enums/user-role.enum';
import { ROLES_KEY } from '@/auth/decorators/roles.decorator';
import { AuthenticatedUser } from '@/auth/interfaces/authenticated-request.interface';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!roles || roles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    const user = request.user;

    if (!user || !roles.includes(user.role)) {
      throw new ForbiddenException('You do not have permission to access this resource');
    }

    return true;
  }
}
