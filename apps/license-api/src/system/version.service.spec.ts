import { VersionService } from './version.service';

describe('VersionService', () => {
  it('returns platform version fields with migration lookup', async () => {
    const prisma = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ migration_name: '20260722200000_billing_domain' }]),
    };
    const config = {
      get: jest.fn((key: string) => {
        const map: Record<string, string> = {
          APP_VERSION: '1.2.3',
          ADMIN_PORTAL_VERSION: '1.2.0',
          CUSTOMER_PORTAL_VERSION: '1.2.1',
          DESKTOP_VERSION: '1.0.0',
          BUILD_NUMBER: '99',
          GIT_COMMIT: 'abc123',
          NODE_ENV: 'test',
        };
        return map[key];
      }),
    };

    const service = new VersionService(config as never, prisma as never);
    const version = await service.getVersion();

    expect(version.apiVersion).toBe('1.2.3');
    expect(version.portalVersion).toBe('1.2.0');
    expect(version.customerPortalVersion).toBe('1.2.1');
    expect(version.desktopVersion).toBe('1.0.0');
    expect(version.databaseMigrationVersion).toBe('20260722200000_billing_domain');
    expect(version.gitCommit).toBe('abc123');
    expect(version.buildNumber).toBe('99');
    expect(version.environment).toBe('test');
  });
});
