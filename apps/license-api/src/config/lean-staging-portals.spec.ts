import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { configureLeanStagingPortals, leanStagingPortalPaths } from './lean-staging-portals';

describe('lean staging portal configuration', () => {
  it('remains disabled unless explicitly enabled', () => {
    const app = { getHttpAdapter: jest.fn() } as unknown as INestApplication;
    configureLeanStagingPortals(app, new ConfigService({}));
    expect(app.getHttpAdapter).not.toHaveBeenCalled();
  });

  it('fails startup when enabled portal assets are missing', () => {
    const app = { getHttpAdapter: jest.fn() } as unknown as INestApplication;
    expect(() => configureLeanStagingPortals(
      app,
      new ConfigService({
        COMMERCIAL_LEAN_STAGING_PORTALS: 'true',
        PATROLSAFE_COMMERCIAL_STAGING: 'true',
      }),
      leanStagingPortalPaths('C:/definitely-not-a-portal-root'),
    )).toThrow('Lean staging portal assets are missing');
  });

  it('requires an explicit staging marker', () => {
    const app = { getHttpAdapter: jest.fn() } as unknown as INestApplication;
    expect(() => configureLeanStagingPortals(
      app,
      new ConfigService({ COMMERCIAL_LEAN_STAGING_PORTALS: 'true' }),
    )).toThrow('explicit commercial staging marker');
    expect(app.getHttpAdapter).not.toHaveBeenCalled();
  });

  it('cannot be enabled in production even with the staging marker', () => {
    const app = { getHttpAdapter: jest.fn() } as unknown as INestApplication;
    const values: Record<string, string> = {
      NODE_ENV: 'production',
      COMMERCIAL_LEAN_STAGING_PORTALS: 'true',
      PATROLSAFE_COMMERCIAL_STAGING: 'true',
    };
    const config = { get: (key: string) => values[key] } as ConfigService;
    expect(() => configureLeanStagingPortals(app, config)).toThrow('cannot be enabled in production');
    expect(app.getHttpAdapter).not.toHaveBeenCalled();
  });
});
