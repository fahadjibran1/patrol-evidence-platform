import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { CustomerAuthService } from '../customer-auth.service';
import { AuthenticatedCustomer } from '../interfaces/authenticated-customer.interface';
import { ApiException } from '@/common/exceptions/api.exception';
import { ERROR_CODES } from '@/common/constants/error-codes';

@Injectable()
export class CustomerJwtAuthGuard implements CanActivate {
  constructor(private readonly customerAuthService: CustomerAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      customer?: AuthenticatedCustomer;
    }>();

    const token = this.extractToken(request.headers.authorization);
    if (!token) {
      throw new ApiException(ERROR_CODES.AUTH_INVALID_CREDENTIALS, 'Missing bearer token', 401);
    }

    request.customer = await this.customerAuthService.validateAccessToken(token);
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
