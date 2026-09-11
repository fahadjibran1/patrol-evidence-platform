import { ConfigService } from '@nestjs/config';
import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { TokenService } from '@/auth/token.service';
import { UserRole } from '@/common/enums/user-role.enum';
import { DesktopApiGuard } from './desktop-api.guard';
import { DesktopInitializedMutationGuard } from './desktop-initialized-mutation.guard';
import { DesktopRecoveryService } from './desktop-recovery.service';

function contextWithHeaders(headers: Record<string, string | undefined>): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => ({ headers }) }) } as unknown as ExecutionContext;
}

describe('desktop localhost request authorization', () => {
  const original = { ...process.env };
  const configPath = join(process.cwd(), `.desktop-security-${process.pid}.json`);

  beforeEach(() => {
    process.env.DESKTOP_CONFIG_PATH = configPath;
    process.env.PATROLSAFE_DESKTOP_API_TOKEN = 'a'.repeat(64);
    process.env.PATROLSAFE_DESKTOP_RECOVERY_AUTHORITY = 'b'.repeat(64);
  });

  afterEach(() => {
    rmSync(configPath, { force: true });
    process.env = { ...original };
  });

  it('rejects hostile localhost clients without the desktop capability', () => {
    expect(() => new DesktopApiGuard().canActivate(contextWithHeaders({ origin: 'https://attacker.example' }))).toThrow(
      UnauthorizedException,
    );
  });

  it('accepts a legitimate packaged renderer capability', () => {
    expect(
      new DesktopApiGuard().canActivate(
        contextWithHeaders({ 'x-patrolsafe-desktop-token': process.env.PATROLSAFE_DESKTOP_API_TOKEN }),
      ),
    ).toBe(true);
  });

  it('allows first initialization but blocks anonymous re-bootstrap after setup', () => {
    const tokenService = new TokenService(
      new ConfigService({ jwtSecret: 'test-secret-value-long-enough', jwtExpiresInHours: 1 }),
    );
    const guard = new DesktopInitializedMutationGuard(tokenService);
    writeFileSync(configPath, JSON.stringify({ setupCompleted: false }));
    expect(guard.canActivate(contextWithHeaders({}))).toBe(true);
    writeFileSync(configPath, JSON.stringify({ setupCompleted: true }));
    expect(() => guard.canActivate(contextWithHeaders({}))).toThrow(UnauthorizedException);

    const adminToken = tokenService.sign({
      sub: 'admin-1', email: 'admin@example.test', role: UserRole.COMPANY_ADMIN, companyId: 'company-1',
    });
    expect(guard.canActivate(contextWithHeaders({ authorization: `Bearer ${adminToken}` }))).toBe(true);
    const guardToken = tokenService.sign({
      sub: 'guard-1', email: 'guard@example.test', role: UserRole.GUARD, companyId: 'company-1',
    });
    expect(() => guard.canActivate(contextWithHeaders({ authorization: `Bearer ${guardToken}` }))).toThrow(
      ForbiddenException,
    );
  });

  it('requires native authority and consumes recovery capability exactly once', () => {
    const recovery = new DesktopRecoveryService();
    const token = 'c'.repeat(64);
    expect(() => recovery.authorize('wrong', token)).toThrow(UnauthorizedException);
    recovery.authorize(process.env.PATROLSAFE_DESKTOP_RECOVERY_AUTHORITY, token);
    expect(() => recovery.consume(token)).not.toThrow();
    expect(() => recovery.consume(token)).toThrow(UnauthorizedException);
  });
});
