import { CanActivate, ExecutionContext, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { DESKTOP_API_TOKEN_HEADER } from '@/config/cors-origin.util';

function safeSecretMatch(actual: string | undefined, expected: string): boolean {
  if (!actual) {
    return false;
  }

  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

@Injectable()
export class DesktopApiGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const desktopMode = Boolean(process.env.DESKTOP_CONFIG_PATH?.trim());
    if (!desktopMode) {
      return true;
    }

    const expected = process.env.PATROLSAFE_DESKTOP_API_TOKEN?.trim();
    if (!expected || expected.length < 32) {
      throw new ServiceUnavailableException('Desktop request authentication is unavailable');
    }

    const request = context.switchToHttp().getRequest<{ headers: Record<string, string | string[] | undefined> }>();
    const header = request.headers[DESKTOP_API_TOKEN_HEADER];
    const actual = Array.isArray(header) ? undefined : header?.trim();
    if (!safeSecretMatch(actual, expected)) {
      throw new UnauthorizedException('Desktop request authorization required');
    }

    return true;
  }
}
