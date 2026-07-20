import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedAdmin } from '@/auth/interfaces/authenticated-admin.interface';

export const CurrentAdmin = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedAdmin => {
    const request = ctx.switchToHttp().getRequest<{ admin: AuthenticatedAdmin }>();
    return request.admin;
  },
);
