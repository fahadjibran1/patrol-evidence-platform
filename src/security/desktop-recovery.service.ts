import { Injectable, Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'crypto';

const RECOVERY_TOKEN_TTL_MS = 2 * 60 * 1000;

function safeSecretMatch(actual: string | undefined, expected: string): boolean {
  if (!actual) {
    return false;
  }
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class DesktopRecoveryService {
  private readonly logger = new Logger(DesktopRecoveryService.name);
  private readonly authorizedTokens = new Map<string, number>();

  authorize(authority: string | undefined, token: string): { ok: true; expiresInSeconds: number } {
    const expectedAuthority = process.env.PATROLSAFE_DESKTOP_RECOVERY_AUTHORITY?.trim();
    if (!expectedAuthority || expectedAuthority.length < 32) {
      throw new ServiceUnavailableException('Desktop recovery authorization is unavailable');
    }
    if (!safeSecretMatch(authority?.trim(), expectedAuthority)) {
      throw new UnauthorizedException('Desktop recovery authority required');
    }
    if (!/^[A-Za-z0-9_-]{43,128}$/.test(token)) {
      throw new UnauthorizedException('Invalid desktop recovery token');
    }

    this.removeExpired();
    this.authorizedTokens.set(tokenHash(token), Date.now() + RECOVERY_TOKEN_TTL_MS);
    this.logger.log('DESKTOP_ADMIN_RECOVERY_AUTHORIZED singleUse=true ttlSeconds=120');
    return { ok: true, expiresInSeconds: RECOVERY_TOKEN_TTL_MS / 1000 };
  }

  consume(token: string | undefined): void {
    this.removeExpired();
    const hash = token ? tokenHash(token) : '';
    const expiresAt = this.authorizedTokens.get(hash);
    if (!expiresAt || expiresAt <= Date.now()) {
      throw new UnauthorizedException('A fresh desktop recovery confirmation is required');
    }

    this.authorizedTokens.delete(hash);
    this.logger.log('DESKTOP_ADMIN_RECOVERY_CONSUMED singleUse=true');
  }

  private removeExpired(): void {
    const now = Date.now();
    for (const [hash, expiresAt] of this.authorizedTokens) {
      if (expiresAt <= now) {
        this.authorizedTokens.delete(hash);
      }
    }
  }
}
