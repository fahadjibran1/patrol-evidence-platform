import { PlatformBootstrapService } from './platform-bootstrap.service';

describe('PlatformBootstrapService', () => {
  it('logs persisted startup state and refreshes runtime mappings', async () => {
    const logger = {
      log: jest.fn(),
      error: jest.fn(),
    };
    const siteRepo = {
      find: jest.fn().mockResolvedValue([
        { id: 'site-1', siteCode: 'TS001', active: true },
        { id: 'site-2', siteCode: 'SWI01', active: true },
      ]),
    };
    const patrolScheduleRepo = {
      count: jest.fn().mockResolvedValue(2),
    };
    const whatsAppSourceMappingService = {
      rehydratePersistedMappingsOnStartup: jest.fn().mockResolvedValue({
        persistedActive: 3,
        ingestEligible: 3,
        linkedAccountBackfilled: 1,
        linkedAccountId: '447700000001@c.us',
      }),
    };
    const whatsAppCollectorService = {
      refreshRuntimeMappingsFromDatabase: jest.fn().mockResolvedValue(3),
    };

    const service = new PlatformBootstrapService(
      siteRepo as never,
      patrolScheduleRepo as never,
      whatsAppSourceMappingService as never,
      whatsAppCollectorService as never,
    );
    (service as unknown as { logger: typeof logger }).logger = logger;

    await service.runStartupBootstrap();

    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining('BOOTSTRAP_SITES_LOADED active=2 total=2'),
    );
    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining('BOOTSTRAP_MAPPINGS_LOADED persisted=3 ingestEligible=3'),
    );
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('BOOTSTRAP_SCHEDULES_LOADED active=2'));
    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining('BOOTSTRAP_DASHBOARD_READY runtimeMappedGroups=3 persistedMappings=3'),
    );
    expect(whatsAppCollectorService.refreshRuntimeMappingsFromDatabase).toHaveBeenCalled();
  });
});
