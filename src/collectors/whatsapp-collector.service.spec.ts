import { ConfigService } from '@nestjs/config';
import { CollectorType } from '@/common/enums/collector-type.enum';
import { LicensingService } from '@/licensing/licensing.service';
import { WhatsAppSourceMappingService } from '@/patrol-groups/whatsapp-source-mapping.service';
import {
  resolveWhatsAppSenderName,
  shouldSkipWhatsAppFromMe,
  withDetachedFrameRetry,
} from './whatsapp-message.util';
import { WhatsAppCollectorService } from './whatsapp-collector.service';
import {
  WHATSAPP_HELPER_EVENT_PREFIX,
  type WhatsAppHelperIngestPayload,
  type WhatsAppHelperStatusSnapshot,
} from './whatsapp-helper.types';

describe('WhatsAppCollectorService', () => {
  const HELPER_TOKEN = 'test-helper-token';
  let currentEntitlement: Record<string, unknown>;

  const whatsAppSourceMappingService = {
    resolveActiveLinkedAccountId: jest.fn(),
    countActiveMappingsForIngest: jest.fn(),
    toRuntimeMappings: jest.fn(),
    resolveMappingForIngest: jest.fn(),
    persistLinkedWhatsAppAccount: jest.fn(),
    getConfiguredLinkedAccountId: jest.fn(),
    findActiveMappingsForIngest: jest.fn(),
    findActiveCertificationMappings: jest.fn(),
    subscribeToMappingChanges: jest.fn(() => jest.fn()),
  };

  const patrolImageIngestionService = {
    ingestPatrolImage: jest.fn(),
    findExistingByExternalMessageId: jest.fn(),
  };

  const licensingService = {
    assertCollectorStartAllowed: jest.fn(),
    getEntitlementEvaluation: jest.fn(() => currentEntitlement),
  } as unknown as LicensingService;

  function createConfigService(overrides?: Record<string, unknown>): ConfigService {
    const config = {
      whatsappEnabled: true,
      whatsappAutoStart: false,
      whatsappHeadless: true,
      whatsappAllowFromMe: false,
      whatsappBackfillMessageLimit: 10,
      whatsappSessionPath: './whatsapp-session',
      whatsappChromePath: undefined,
      whatsappPilotGroupName: undefined,
      whatsappPilotSiteCode: undefined,
      port: 3001,
      ...overrides,
    };

    return {
      get: jest.fn((key: string) => config[key as keyof typeof config]),
      getOrThrow: jest.fn((key: string) => {
        const value = config[key as keyof typeof config];
        if (value === undefined) {
          throw new Error(`Missing config: ${key}`);
        }

        return value;
      }),
    } as never;
  }

  function createService(overrides?: Record<string, unknown>): WhatsAppCollectorService {
    process.env.PATROL_HELPER_INTERNAL_TOKEN = HELPER_TOKEN;
    return new WhatsAppCollectorService(
      createConfigService(overrides),
      whatsAppSourceMappingService as unknown as WhatsAppSourceMappingService,
      patrolImageIngestionService as never,
      licensingService,
    );
  }

  function readyStatus(overrides?: Partial<WhatsAppHelperStatusSnapshot>): WhatsAppHelperStatusSnapshot {
    return {
      enabled: true,
      connected: true,
      ready: true,
      state: 'ready',
      info: 'Ready',
      sessionPath: './whatsapp-session',
      qrCode: null,
      lastQrAt: null,
      lastMessageAt: null,
      lastEventAt: new Date().toISOString(),
      lastReadyAt: new Date().toISOString(),
      lastDisconnectAt: null,
      lastBackfillAt: null,
      connectedAccount: '447700000000@c.us',
      backfillRunning: false,
      backfillMessagesScanned: 0,
      backfillImagesImported: 0,
      backfillDuplicatesSkipped: 0,
      liveMessagesProcessed: 0,
      liveImagesImported: 0,
      liveDuplicatesSkipped: 0,
      productionListenerCount: 0,
      allowFromMe: false,
      startupStage: 'Ready',
      startupStartedAt: null,
      lastError: null,
      collectorLogPath: 'collector.log',
      latestQrPath: 'latest-qr.txt',
      qrPayloadLength: null,
      qrPersistedAt: null,
      qrDeliveredAt: null,
      browserExecutablePath: null,
      browserExecutableSource: null,
      browserCandidatesTried: [],
      sessionPathExists: true,
      sessionPathWritable: true,
      sessionCorruptionSuspected: false,
      sessionCorruptionMessage: null,
      failureCode: null,
      groups: [],
      contacts: [],
      ...overrides,
    };
  }

  describe('helper browser preference', () => {
    const originalBrowser = process.env.WHATSAPP_BROWSER;
    const originalPatrolBrowser = process.env.PATROL_WHATSAPP_BROWSER;

    beforeEach(() => {
      delete process.env.WHATSAPP_BROWSER;
      delete process.env.PATROL_WHATSAPP_BROWSER;
    });

    afterAll(() => {
      if (originalBrowser === undefined) delete process.env.WHATSAPP_BROWSER;
      else process.env.WHATSAPP_BROWSER = originalBrowser;
      if (originalPatrolBrowser === undefined) delete process.env.PATROL_WHATSAPP_BROWSER;
      else process.env.PATROL_WHATSAPP_BROWSER = originalPatrolBrowser;
    });

    const preference = (service: WhatsAppCollectorService) =>
      (service as unknown as { resolveHelperBrowserPreference(): 'chrome' | 'edge' | 'auto' })
        .resolveHelperBrowserPreference();

    it('uses the validated auto plan when no browser is configured', () => {
      expect(preference(createService())).toBe('auto');
    });

    it.each(['chrome', 'edge', 'auto'] as const)('preserves an explicit %s preference', (browser) => {
      expect(preference(createService({ whatsappBrowser: browser }))).toBe(browser);
    });

    it('derives the family from an explicit saved executable when no preference is set', () => {
      expect(preference(createService({ whatsappChromePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' }))).toBe('chrome');
      expect(preference(createService({ whatsappChromePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' }))).toBe('edge');
    });
  });

  describe('helper WhatsApp Web version mode', () => {
    const originalPatrolMode = process.env.PATROL_WHATSAPP_WEB_VERSION_MODE;
    const originalLegacyMode = process.env.WHATSAPP_WEB_VERSION_MODE;

    beforeEach(() => {
      delete process.env.PATROL_WHATSAPP_WEB_VERSION_MODE;
      delete process.env.WHATSAPP_WEB_VERSION_MODE;
    });

    afterAll(() => {
      if (originalPatrolMode === undefined) delete process.env.PATROL_WHATSAPP_WEB_VERSION_MODE;
      else process.env.PATROL_WHATSAPP_WEB_VERSION_MODE = originalPatrolMode;
      if (originalLegacyMode === undefined) delete process.env.WHATSAPP_WEB_VERSION_MODE;
      else process.env.WHATSAPP_WEB_VERSION_MODE = originalLegacyMode;
    });

    const helperMode = (service: WhatsAppCollectorService) =>
      (service as unknown as { buildHelperEnv(): NodeJS.ProcessEnv }).buildHelperEnv()
        .PATROL_WHATSAPP_WEB_VERSION_MODE;

    it('propagates live mode to the helper by default', () => {
      expect(helperMode(createService())).toBe('live');
    });

    it('keeps an explicit production mode authoritative', () => {
      process.env.PATROL_WHATSAPP_WEB_VERSION_MODE = 'pinned';
      expect(helperMode(createService())).toBe('pinned');
    });

    it('continues to support the legacy explicit mode variable', () => {
      process.env.WHATSAPP_WEB_VERSION_MODE = 'library-default';
      expect(helperMode(createService())).toBe('library-default');
    });
  });

  describe('helper backend endpoint', () => {
    const originalBoundPort = process.env.PATROLSAFE_BOUND_BACKEND_PORT;

    afterEach(() => {
      if (originalBoundPort === undefined) delete process.env.PATROLSAFE_BOUND_BACKEND_PORT;
      else process.env.PATROLSAFE_BOUND_BACKEND_PORT = originalBoundPort;
    });

    it('uses the actual OS-assigned loopback port rather than configured port zero', () => {
      process.env.PATROLSAFE_BOUND_BACKEND_PORT = '54321';
      const env = (createService({ port: 0 }) as unknown as { buildHelperEnv(): NodeJS.ProcessEnv }).buildHelperEnv();
      expect(env.PATROL_HELPER_API_BASE_URL).toBe('http://127.0.0.1:54321');
    });
  });

  function attachRunningHelper(service: WhatsAppCollectorService): { write: jest.Mock } {
    const write = jest.fn();
    (service as unknown as {
      helperProcess: {
        exitCode: null;
        killed: boolean;
        stdin: { destroyed: boolean; write: jest.Mock };
      };
      helperStatus: WhatsAppHelperStatusSnapshot;
    }).helperProcess = {
      exitCode: null,
      killed: false,
      stdin: { destroyed: false, write },
    };
    (service as unknown as { helperStatus: WhatsAppHelperStatusSnapshot }).helperStatus = readyStatus();
    return { write };
  }

  function emitHelperStatus(service: WhatsAppCollectorService, payload: WhatsAppHelperStatusSnapshot): void {
    const line = `${WHATSAPP_HELPER_EVENT_PREFIX}${JSON.stringify({ type: 'status', payload })}`;
    (service as unknown as { handleHelperStdoutLine(line: string): void }).handleHelperStdoutLine(line);
  }

  function emitAuthorizationResult(
    service: WhatsAppCollectorService,
    authorized: boolean,
    state: 'EXPECTING_QR_ONLY' | 'AUTHENTICATION_AUTHORIZED' | 'UNEXPECTED_AUTHENTICATION' | 'DISABLED',
  ): void {
    const line = `${WHATSAPP_HELPER_EVENT_PREFIX}${JSON.stringify({
      type: 'certification-authorization-result',
      payload: { authorized, state },
    })}`;
    (service as unknown as { handleHelperStdoutLine(line: string): void }).handleHelperStdoutLine(line);
  }

  function emitSourceDiscoveryResult(
    service: WhatsAppCollectorService,
    requestId: string | undefined,
    options?: { state?: 'AVAILABLE' | 'EMPTY' | 'ERROR'; error?: string | null },
  ): void {
    const line = `${WHATSAPP_HELPER_EVENT_PREFIX}${JSON.stringify({
      type: 'source-discovery-result',
      payload: {
        requestId,
        state: options?.state ?? 'AVAILABLE',
        groups:
          options?.state === 'ERROR'
            ? []
            : [
                {
                  id: '120363000001@g.us',
                  name: 'UAT Patrol Group',
                  isGroup: true,
                  sourceType: 'group',
                  isReadOnly: false,
                  unreadCount: 0,
                },
              ],
        contacts: [],
        error: options?.error ?? null,
        completedAt: '2026-09-12T20:00:00.000Z',
      },
    })}`;
    (service as unknown as { handleHelperStdoutLine(line: string): void }).handleHelperStdoutLine(line);
  }

  function ingestPayload(overrides?: Partial<WhatsAppHelperIngestPayload>): WhatsAppHelperIngestPayload {
    return {
      siteCode: 'SWI01',
      groupId: 'group-1',
      sourceExternalId: '120363375746387624@g.us',
      senderName: 'Guard One',
      senderNumber: '447700000000',
      messageExternalId: 'wamid-1',
      originalFileName: 'proof.jpg',
      mimeType: 'image/jpeg',
      fileSize: 3,
      fileBase64: Buffer.from('abc').toString('base64'),
      timestamp: new Date().toISOString(),
      ...overrides,
    };
  }

  async function withQrOnlyCertification<T>(callback: () => Promise<T>): Promise<T> {
    const originalArgv = process.argv;
    const originalEnvironment = process.env.PATROL_CERTIFICATION_EXPECT_UNAUTHENTICATED;
    process.argv = [...process.argv, '--patrol-certification-qr-only'];
    process.env.PATROL_CERTIFICATION_EXPECT_UNAUTHENTICATED = 'true';
    try {
      return await callback();
    } finally {
      process.argv = originalArgv;
      if (originalEnvironment === undefined) delete process.env.PATROL_CERTIFICATION_EXPECT_UNAUTHENTICATED;
      else process.env.PATROL_CERTIFICATION_EXPECT_UNAUTHENTICATED = originalEnvironment;
    }
  }

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PATROL_HELPER_INTERNAL_TOKEN = HELPER_TOKEN;
    whatsAppSourceMappingService.resolveActiveLinkedAccountId.mockReturnValue('linked-account-1');
    whatsAppSourceMappingService.countActiveMappingsForIngest.mockResolvedValue(1);
    whatsAppSourceMappingService.toRuntimeMappings.mockResolvedValue([
      {
        externalGroupId: '120363375746387624@g.us',
        sourceType: 'group',
        mappedGroupId: 'group-1',
        groupName: 'Corner Copse - Swindon',
        siteCode: 'SWI01',
      },
    ]);
    whatsAppSourceMappingService.resolveMappingForIngest.mockResolvedValue({
      id: 'group-1',
      site: { active: true, siteCode: 'SWI01' },
    });
    whatsAppSourceMappingService.persistLinkedWhatsAppAccount.mockResolvedValue({
      changed: false,
      previousAccountId: 'linked-account-1',
      currentAccountId: 'linked-account-1',
    });
    whatsAppSourceMappingService.getConfiguredLinkedAccountId.mockReturnValue('linked-account-1');
    whatsAppSourceMappingService.findActiveMappingsForIngest.mockResolvedValue([]);
    whatsAppSourceMappingService.findActiveCertificationMappings.mockResolvedValue([
      {
        id: 'group-1',
        siteId: 'site-1',
        externalGroupId: '120363375746387624@g.us',
        linkedAccountId: 'linked-account-1',
        active: true,
        site: { id: 'site-1', siteCode: 'SWI01', active: true },
      },
    ]);
    patrolImageIngestionService.findExistingByExternalMessageId.mockResolvedValue(null);
    patrolImageIngestionService.ingestPatrolImage.mockResolvedValue({
      id: 'img-1',
      collectorType: CollectorType.WHATSAPP,
      filePath: 'evidence/img-1.jpg',
    });
    currentEntitlement = {
      mode: 'trial',
      status: 'active',
      expiresAt: '2099-12-31T23:59:59.000Z',
      collectorAllowed: true,
      message: 'Trial active.',
    };
    licensingService.assertCollectorStartAllowed = jest.fn(() => {
      if (currentEntitlement.collectorAllowed !== true) {
        throw new Error(String(currentEntitlement.message));
      }
    });
    licensingService.getEntitlementEvaluation = jest.fn(() => currentEntitlement as never);
    whatsAppSourceMappingService.subscribeToMappingChanges.mockReturnValue(jest.fn());
  });

  describe('persistent production monitoring', () => {
    it('keeps linking separate from monitoring and exposes PAUSED by default', async () => {
      const service = createService({ whatsappAutoStart: false });
      const runtime = await service.getRuntimeConfig(HELPER_TOKEN);
      const status = await service.getStatus();

      expect(runtime.monitoringEnabled).toBe(false);
      expect(status.monitoringPreference).toBe('PAUSED');
      expect(status.monitoringState).toBe('PAUSED');
    });

    it('discovers sources while the connected session is ready and monitoring is paused', async () => {
      const service = createService({ whatsappAutoStart: false });
      const { write } = attachRunningHelper(service);

      const refresh = service.refreshDiscoveredChats();
      const command = JSON.parse(write.mock.calls[0][0]) as { type: string; requestId: string };
      expect(command.type).toBe('refresh-discovered-chats');
      expect(command.requestId).toEqual(expect.any(String));
      emitSourceDiscoveryResult(service, command.requestId);

      await expect(refresh).resolves.toMatchObject({
        ready: true,
        monitoringPreference: 'PAUSED',
        sourceDiscoveryState: 'AVAILABLE',
        sourceDiscoveryError: null,
      });
      await expect(service.listGroups()).resolves.toEqual([
        expect.objectContaining({ id: '120363000001@g.us', name: 'UAT Patrol Group' }),
      ]);
    });

    it('fails source discovery closed when WhatsApp is not ready', async () => {
      const service = createService();
      attachRunningHelper(service);
      (service as unknown as { helperStatus: WhatsAppHelperStatusSnapshot }).helperStatus = readyStatus({
        state: 'waiting-for-client-info',
        connected: false,
        ready: false,
      });

      await expect(service.refreshDiscoveredChats()).rejects.toThrow(
        'WhatsApp must be connected and ready before sources can be refreshed.',
      );
    });

    it('enables mapped monitoring and commands exactly the existing helper generation', async () => {
      const service = createService();
      const { write } = attachRunningHelper(service);

      const status = await service.enableMonitoring();

      expect(status.monitoringPreference).toBe('ENABLED');
      expect(write).toHaveBeenCalledTimes(1);
      expect(JSON.parse(write.mock.calls[0][0])).toEqual({
        type: 'set-production-monitoring',
        enabled: true,
      });
    });

    it('pauses listeners without logging out or stopping the linked helper', async () => {
      const service = createService({ whatsappAutoStart: true });
      const { write } = attachRunningHelper(service);

      const status = await service.pauseMonitoring();

      expect(status.monitoringPreference).toBe('PAUSED');
      expect(status.state).toBe('ready');
      expect(write).toHaveBeenCalledTimes(1);
      expect(JSON.parse(write.mock.calls[0][0])).toEqual({
        type: 'set-production-monitoring',
        enabled: false,
      });
    });

    it('fails closed when no active mapping exists', async () => {
      const service = createService();
      whatsAppSourceMappingService.countActiveMappingsForIngest.mockResolvedValue(0);

      await expect(service.enableMonitoring()).rejects.toThrow(
        'Add at least one active WhatsApp group mapping before starting monitoring.',
      );
    });

    it('auto-starts only an enabled saved session with an active account mapping', async () => {
      const service = createService({ whatsappAutoStart: true });
      jest.spyOn(
        service as unknown as { isSessionProfileEmpty(): boolean },
        'isSessionProfileEmpty',
      ).mockReturnValue(false);
      const start = jest.spyOn(service, 'start').mockResolvedValue(await service.getStatus());

      await service.onModuleInit();
      await Promise.resolve();

      expect(whatsAppSourceMappingService.subscribeToMappingChanges).toHaveBeenCalledTimes(1);
      expect(start).toHaveBeenCalledTimes(1);
    });

    it('reconnects a saved linked session while monitoring stays paused', async () => {
      const service = createService({ whatsappAutoStart: false });
      jest.spyOn(
        service as unknown as { isSessionProfileEmpty(): boolean },
        'isSessionProfileEmpty',
      ).mockReturnValue(false);
      const start = jest.spyOn(service, 'start').mockResolvedValue(await service.getStatus());

      await service.onModuleInit();
      await Promise.resolve();

      expect(start).toHaveBeenCalledTimes(1);
      const runtime = await service.getRuntimeConfig(HELPER_TOKEN);
      expect(runtime.monitoringEnabled).toBe(false);
      expect((await service.getStatus()).monitoringPreference).toBe('PAUSED');
    });
  });

  describe('active entitlement lifecycle', () => {
    it('stops active listeners exactly once at the trial boundary without stopping or unlinking WhatsApp', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-10-15T12:00:00.000Z'));
      try {
        const service = createService({ whatsappAutoStart: true });
        const { write } = attachRunningHelper(service);
        (service as unknown as { helperStatus: WhatsAppHelperStatusSnapshot }).helperStatus = readyStatus({
          productionListenerCount: 3,
        });
        currentEntitlement = {
          mode: 'trial',
          status: 'active',
          expiresAt: '2026-10-15T12:01:00.000Z',
          collectorAllowed: true,
          message: 'Trial active.',
        };
        (service as unknown as { scheduleEntitlementRecheck(value: unknown): void })
          .scheduleEntitlementRecheck(currentEntitlement);

        jest.advanceTimersByTime(59_999);
        expect((await service.getStatus()).monitoringState).toBe('ACTIVE');

        currentEntitlement = {
          ...currentEntitlement,
          status: 'expired',
          collectorAllowed: false,
          message: 'Trial has expired.',
        };
        jest.advanceTimersByTime(2);

        const status = await service.getStatus();
        expect(status).toMatchObject({
          state: 'ready',
          connected: true,
          ready: true,
          monitoringPreference: 'ENABLED',
          monitoringState: 'TRIAL_EXPIRED',
          entitlementRestriction: 'TRIAL_EXPIRED',
          productionListenerCount: 0,
        });
        expect(status.entitlementMessage).toContain('Monitoring has stopped');
        expect(write).toHaveBeenCalledTimes(1);
        expect(JSON.parse(write.mock.calls[0][0])).toEqual({
          type: 'set-production-monitoring',
          enabled: false,
        });
        expect((service as unknown as { entitlementTransitionCount: number }).entitlementTransitionCount).toBe(1);

        jest.advanceTimersByTime(5 * 60 * 1000);
        expect(write).toHaveBeenCalledTimes(1);
        expect((service as unknown as { entitlementTransitionCount: number }).entitlementTransitionCount).toBe(1);
        expect(whatsAppSourceMappingService.getConfiguredLinkedAccountId()).toBe('linked-account-1');
      } finally {
        jest.useRealTimers();
      }
    });

    it('rejects new helper ingestion after expiry while an already admitted image finishes atomically', async () => {
      const service = createService({ whatsappAutoStart: true });
      attachRunningHelper(service);
      let finishIngest!: (value: { id: string; collectorType: CollectorType; filePath: string }) => void;
      patrolImageIngestionService.ingestPatrolImage.mockImplementationOnce(
        () => new Promise((resolve) => { finishIngest = resolve; }),
      );

      const admitted = service.ingestFromHelper(HELPER_TOKEN, ingestPayload({ messageExternalId: 'accepted-before-expiry' }));
      await Promise.resolve();
      await Promise.resolve();
      currentEntitlement = {
        mode: 'trial',
        status: 'expired',
        expiresAt: '2026-10-15T12:01:00.000Z',
        collectorAllowed: false,
        message: 'Trial has expired.',
      };
      (service as unknown as { reconcileActiveEntitlement(): void }).reconcileActiveEntitlement();
      finishIngest({ id: 'img-in-flight', collectorType: CollectorType.WHATSAPP, filePath: 'evidence/img-in-flight.jpg' });

      await expect(admitted).resolves.toMatchObject({ ok: true, imageId: 'img-in-flight' });
      await expect(
        service.ingestFromHelper(HELPER_TOKEN, ingestPayload({ messageExternalId: 'rejected-after-expiry' })),
      ).rejects.toThrow('Trial has expired.');
      expect(patrolImageIngestionService.ingestPatrolImage).toHaveBeenCalledTimes(1);
    });

    it('keeps monitoring blocked when an offline recovery signal arrives after local expiry', async () => {
      const service = createService({ whatsappAutoStart: true });
      attachRunningHelper(service);
      currentEntitlement = {
        mode: 'trial',
        status: 'expired',
        expiresAt: '2026-10-15T12:01:00.000Z',
        collectorAllowed: false,
        message: 'Trial has expired.',
      };
      (service as unknown as { reconcileActiveEntitlement(): void }).reconcileActiveEntitlement();
      emitHelperStatus(service, readyStatus({
        state: 'failed',
        connected: false,
        ready: false,
        productionListenerCount: 0,
        failureCode: 'NETWORK_UNAVAILABLE',
      }));

      expect((service as unknown as { networkRecoveryPromise: Promise<unknown> | null }).networkRecoveryPromise).toBeNull();
      await expect(service.getRuntimeConfig(HELPER_TOKEN)).resolves.toMatchObject({ monitoringEnabled: false });
      await expect(service.getStatus()).resolves.toMatchObject({ monitoringState: 'TRIAL_EXPIRED' });
    });

    it('requires manual resume after a valid Annual licence is activated and preserves the linked session', async () => {
      const service = createService({ whatsappAutoStart: true });
      const { write } = attachRunningHelper(service);
      currentEntitlement = {
        mode: 'trial',
        status: 'expired',
        expiresAt: '2026-10-15T12:01:00.000Z',
        collectorAllowed: false,
        message: 'Trial has expired.',
      };
      (service as unknown as { reconcileActiveEntitlement(): void }).reconcileActiveEntitlement();
      write.mockClear();

      currentEntitlement = {
        mode: 'commercial',
        status: 'active',
        expiresAt: '2027-10-15',
        collectorAllowed: true,
        message: 'Annual licence active.',
      };
      await expect(service.getStatus()).resolves.toMatchObject({
        state: 'ready',
        monitoringState: 'PAUSED',
        entitlementRestriction: null,
      });
      await expect(service.getRuntimeConfig(HELPER_TOKEN)).resolves.toMatchObject({ monitoringEnabled: false });

      await service.enableMonitoring();
      expect(write).toHaveBeenCalledWith(`${JSON.stringify({ type: 'set-production-monitoring', enabled: true })}\n`);
      emitHelperStatus(service, readyStatus({ productionListenerCount: 3 }));
      await expect(service.getStatus()).resolves.toMatchObject({
        monitoringState: 'ACTIVE',
        connected: true,
        entitlementRestriction: null,
      });
    });

    it('fails restart closed after expiry without creating a new helper or QR', async () => {
      const service = createService({ whatsappAutoStart: true });
      currentEntitlement = {
        mode: 'trial',
        status: 'expired',
        expiresAt: '2026-10-15T12:01:00.000Z',
        collectorAllowed: false,
        message: 'Trial has expired.',
      };

      await expect(service.start()).rejects.toThrow('Trial has expired.');
      await expect(service.getStatus()).resolves.toMatchObject({
        monitoringPreference: 'ENABLED',
        monitoringState: 'TRIAL_EXPIRED',
        qrCode: null,
      });
      expect((service as unknown as { helperProcess: unknown }).helperProcess).toBeNull();
    });

    it('does not stop a paid active licence at the unrelated trial boundary', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-10-15T12:00:00.000Z'));
      try {
        const service = createService({ whatsappAutoStart: true });
        const { write } = attachRunningHelper(service);
        (service as unknown as { helperStatus: WhatsAppHelperStatusSnapshot }).helperStatus = readyStatus({
          productionListenerCount: 3,
        });
        currentEntitlement = {
          mode: 'commercial',
          status: 'active',
          expiresAt: '2027-10-15',
          collectorAllowed: true,
          message: 'Annual licence active.',
        };
        (service as unknown as { scheduleEntitlementRecheck(value: unknown): void })
          .scheduleEntitlementRecheck(currentEntitlement);

        jest.advanceTimersByTime(5 * 60 * 1000);
        await expect(service.getStatus()).resolves.toMatchObject({
          monitoringState: 'ACTIVE',
          entitlementRestriction: null,
          productionListenerCount: 3,
        });
        expect(write).not.toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });
  });

  it('skips fromMe messages when WHATSAPP_ALLOW_FROM_ME is false', async () => {
    const service = createService({ whatsappAllowFromMe: false });
    const runtime = await service.getRuntimeConfig(HELPER_TOKEN);

    expect(runtime.allowFromMe).toBe(false);
    expect(shouldSkipWhatsAppFromMe(true, runtime.allowFromMe)).toBe(true);
    expect(patrolImageIngestionService.ingestPatrolImage).not.toHaveBeenCalled();
  });

  it('accepts fromMe messages when WHATSAPP_ALLOW_FROM_ME is true', async () => {
    const service = createService({ whatsappAllowFromMe: true });
    const runtime = await service.getRuntimeConfig(HELPER_TOKEN);

    expect(runtime.allowFromMe).toBe(true);
    expect(shouldSkipWhatsAppFromMe(true, runtime.allowFromMe)).toBe(false);

    const result = await service.ingestFromHelper(
      HELPER_TOKEN,
      ingestPayload({
        senderName: resolveWhatsAppSenderName({
          pushname: 'Guard One',
          name: 'Guard One',
          shortName: 'Guard',
          senderNumber: '447700000000',
          fromMe: true,
        }),
      }),
    );

    expect(result.ok).toBe(true);
    expect(patrolImageIngestionService.ingestPatrolImage).toHaveBeenCalledWith(
      expect.objectContaining({
        siteCode: 'SWI01',
        messageExternalId: 'wamid-1',
        senderName: 'Guard One',
      }),
    );
  });

  it('falls back to sender number when WhatsApp contact name is generic', async () => {
    const service = createService({ whatsappAllowFromMe: true });
    const senderName = resolveWhatsAppSenderName({
      pushname: 'WhatsApp',
      name: '',
      shortName: '',
      senderNumber: '447700111222',
      fromMe: false,
    });

    await service.ingestFromHelper(
      HELPER_TOKEN,
      ingestPayload({
        senderName,
        senderNumber: '447700111222',
        messageExternalId: 'wamid-generic-name',
      }),
    );

    expect(patrolImageIngestionService.ingestPatrolImage).toHaveBeenCalledWith(
      expect.objectContaining({
        senderName: '447700111222',
        senderNumber: '447700111222',
      }),
    );
  });

  it('skips duplicate messages by messageExternalId', async () => {
    const service = createService({ whatsappAllowFromMe: true });
    const existingImage = { id: 'img-existing', messageExternalId: 'wamid-1', filePath: 'evidence/existing.jpg' };
    patrolImageIngestionService.findExistingByExternalMessageId.mockResolvedValue(existingImage);
    patrolImageIngestionService.ingestPatrolImage.mockResolvedValue(existingImage);

    const result = await service.ingestFromHelper(HELPER_TOKEN, ingestPayload());

    expect(result.duplicate).toBe(true);
    expect(result.imageId).toBe('img-existing');
    expect(patrolImageIngestionService.findExistingByExternalMessageId).toHaveBeenCalledWith('wamid-1');
    expect(patrolImageIngestionService.ingestPatrolImage).toHaveBeenCalledTimes(1);
  });

  it('updates backfill status after reconnect-ready processing', async () => {
    const service = createService({ whatsappAllowFromMe: false });
    attachRunningHelper(service);

    emitHelperStatus(
      service,
      readyStatus({
        lastReadyAt: '2026-07-21T12:00:00.000Z',
        lastBackfillAt: '2026-07-21T12:00:05.000Z',
        backfillRunning: false,
        backfillMessagesScanned: 2,
        backfillImagesImported: 1,
        backfillDuplicatesSkipped: 1,
        connectedAccount: '447700000000@c.us',
        info: 'History refresh finished.',
      }),
    );

    const status = await service.getStatus();

    expect(status.ready).toBe(true);
    expect(status.connected).toBe(true);
    expect(status.lastReadyAt).toBe('2026-07-21T12:00:00.000Z');
    expect(status.lastBackfillAt).toBe('2026-07-21T12:00:05.000Z');
    expect(status.backfillRunning).toBe(false);
    expect(status.backfillMessagesScanned).toBe(2);
    expect(status.backfillImagesImported).toBe(1);
    expect(status.backfillDuplicatesSkipped).toBe(1);
    expect(status.mappedGroupsCount).toBe(1);
    expect(whatsAppSourceMappingService.countActiveMappingsForIngest).toHaveBeenCalledWith('447700000000@c.us');
  });

  it('replaces a refreshed QR and clears it when authentication leaves the linking state', async () => {
    const service = createService();
    attachRunningHelper(service);

    emitHelperStatus(
      service,
      readyStatus({
        state: 'qr-ready',
        connected: false,
        ready: false,
        connectedAccount: null,
        qrCode: 'current-qr-generation-1-payload',
        lastQrAt: '2026-09-04T12:00:00.000Z',
      }),
    );
    await expect(service.getStatus()).resolves.toMatchObject({
      state: 'qr-ready',
      qrCode: 'current-qr-generation-1-payload',
    });

    emitHelperStatus(
      service,
      readyStatus({
        state: 'qr-ready',
        connected: false,
        ready: false,
        connectedAccount: null,
        qrCode: 'current-qr-generation-2-payload',
        lastQrAt: '2026-09-04T12:01:00.000Z',
      }),
    );
    await expect(service.getStatus()).resolves.toMatchObject({
      state: 'qr-ready',
      qrCode: 'current-qr-generation-2-payload',
      lastQrAt: '2026-09-04T12:01:00.000Z',
    });

    emitHelperStatus(service, readyStatus({ qrCode: 'stale-qr-must-not-survive-ready' }));
    await expect(service.getStatus()).resolves.toMatchObject({ state: 'ready', qrCode: null });
  });

  it('runs manual backfill for the requested hour window', async () => {
    const service = createService({ whatsappAllowFromMe: false, whatsappBackfillMessageLimit: 0 });
    const { write } = attachRunningHelper(service);

    const status = await service.manualBackfill(1);

    expect(write).toHaveBeenCalledWith(`${JSON.stringify({ type: 'manual-backfill', hours: 1 })}\n`);
    expect(status.ready).toBe(true);
    expect(status.info).toBe('Refreshing patrol history for the last 1 hour.');
    expect(whatsAppSourceMappingService.countActiveMappingsForIngest).toHaveBeenCalledWith('447700000000@c.us');
  });

  it('retries manual backfill once when WhatsApp returns a detached frame error', async () => {
    const fetchMessages = jest
      .fn()
      .mockRejectedValueOnce(new Error("Attempted to use detached Frame 'frame-1'."))
      .mockResolvedValueOnce([{ id: { _serialized: 'wamid-retry' } }]);

    const messages = await withDetachedFrameRetry(() => fetchMessages());

    expect(fetchMessages).toHaveBeenCalledTimes(2);
    expect(messages).toEqual([{ id: { _serialized: 'wamid-retry' } }]);

    const service = createService({ whatsappAllowFromMe: false, whatsappBackfillMessageLimit: 10 });
    const { write } = attachRunningHelper(service);
    await service.manualBackfill(12);

    expect(write).toHaveBeenCalledWith(`${JSON.stringify({ type: 'manual-backfill', hours: 12 })}\n`);
  });

  it('blocks collector start when the licence service rejects activation', async () => {
    const rejectingService = new WhatsAppCollectorService(
      createConfigService({ whatsappAllowFromMe: false }),
      whatsAppSourceMappingService as unknown as WhatsAppSourceMappingService,
      patrolImageIngestionService as never,
      {
        getEntitlementEvaluation: jest.fn(() => ({
          mode: 'trial',
          status: 'expired',
          expiresAt: '2026-10-15T23:59:59.000Z',
          collectorAllowed: false,
          message: 'Trial expired',
        })),
        assertCollectorStartAllowed: jest.fn(() => {
          throw new Error('Trial expired');
        }),
      } as never,
    );

    await expect(rejectingService.start()).rejects.toThrow('Trial expired');
  });

  it('preserves and redacts the unexpected-authentication terminal state', async () => {
    const service = createService();
    const { write } = attachRunningHelper(service);
    const accountIdentifier = '447700999999@c.us';
    emitHelperStatus(
      service,
      readyStatus({
        state: 'UNEXPECTED_AUTHENTICATION',
        connected: true,
        ready: true,
        connectedAccount: accountIdentifier,
        groups: [{ id: 'private-group', name: 'Private', isGroup: true, sourceType: 'group', isReadOnly: false, unreadCount: 1 }],
        contacts: [{ id: 'private-contact', name: 'Private', isGroup: false, sourceType: 'contact', unreadCount: 1 }],
        failureCode: 'UNEXPECTED_AUTHENTICATION',
      }),
    );

    const status = await service.getStatus();
    expect(status.state).toBe('UNEXPECTED_AUTHENTICATION');
    expect(status.connected).toBe(false);
    expect(status.ready).toBe(false);
    expect(status.connectedAccount).toBeNull();
    await expect(service.listGroups()).resolves.toEqual([]);
    await expect(service.listContacts()).resolves.toEqual([]);
    await expect(service.refreshDiscoveredChats()).rejects.toThrow(
      'WhatsApp must be connected and ready before sources can be refreshed.',
    );
    await service.manualBackfill(1);
    await service.sendTestImage();
    await service.probeAuthReadyLifecycle();
    expect(write).not.toHaveBeenCalled();
    expect(whatsAppSourceMappingService.persistLinkedWhatsAppAccount).not.toHaveBeenCalledWith(accountIdentifier);
  });

  it('preserves a relink-required reconnect terminal state without exposing QR or allowing commands', async () => {
    const service = createService();
    const { write } = attachRunningHelper(service);
    emitHelperStatus(
      service,
      readyStatus({
        state: 'RELINK_REQUIRED',
        connected: false,
        ready: false,
        connectedAccount: null,
        qrCode: 'must-not-reach-renderer',
        qrPayloadLength: 24,
        failureCode: 'WHATSAPP_RELINK_REQUIRED',
      }),
    );

    await expect(service.getStatus()).resolves.toMatchObject({
      state: 'RELINK_REQUIRED',
      connected: false,
      ready: false,
      qrCode: null,
      qrPayloadLength: null,
      failureCode: 'WHATSAPP_RELINK_REQUIRED',
    });
    await expect(service.refreshDiscoveredChats()).rejects.toThrow(
      'WhatsApp must be connected and ready before sources can be refreshed.',
    );
    await service.manualBackfill(1);
    await service.sendTestImage();
    expect(write).not.toHaveBeenCalled();
  });

  it('rejects explicit relink unless the collector is terminal RELINK_REQUIRED', async () => {
    const service = createService();
    (service as unknown as { helperStatus: WhatsAppHelperStatusSnapshot }).helperStatus = readyStatus();

    await expect(service.relinkWhatsApp()).rejects.toThrow(
      'WhatsApp relink is available only after a failed reconnect session.',
    );
  });

  it('enters LINK_RETRY_REQUIRED only after failed-generation cleanup and profile release', async () => {
    const service = createService();
    const internal = service as unknown as {
      activeHelperGeneration: number;
      currentGenerationAuthenticationObserved: boolean;
      currentGenerationProfileSafety: 'NEVER_AUTHENTICATED_FIRST_LINK';
      linkRetryCleanupPromise: Promise<void> | null;
      stopHelperProcess(): Promise<void>;
      releaseCurrentProfileOwnership(profileDir: string, generation: number): Promise<void>;
    };
    internal.activeHelperGeneration = 1;
    internal.currentGenerationAuthenticationObserved = false;
    internal.currentGenerationProfileSafety = 'NEVER_AUTHENTICATED_FIRST_LINK';
    const order: string[] = [];
    jest.spyOn(internal, 'stopHelperProcess').mockImplementation(async () => { order.push('helper-stopped'); });
    jest.spyOn(internal, 'releaseCurrentProfileOwnership').mockImplementation(async () => { order.push('profile-released'); });

    emitHelperStatus(service, readyStatus({
      state: 'failed',
      connected: false,
      ready: false,
      connectedAccount: null,
      qrCode: 'stale-qr',
      qrPayloadLength: 8,
      failureCode: 'REMOTE_BOOTSTRAP_FAILURE',
      lastError: 'bootstrap failed',
    }));
    await internal.linkRetryCleanupPromise;

    expect(order).toEqual(['helper-stopped', 'profile-released']);
    await expect(service.getStatus()).resolves.toMatchObject({
      state: 'LINK_RETRY_REQUIRED',
      qrCode: null,
      qrPayloadLength: null,
      connectedAccount: null,
      failureCode: 'REMOTE_BOOTSTRAP_FAILURE',
      info: 'WhatsApp could not initialise. Check your internet connection and try again.',
    });
  });

  it('Try Again starts exactly one generation and rejects a rapid second click', async () => {
    const service = createService();
    const internal = service as unknown as {
      helperStatus: WhatsAppHelperStatusSnapshot;
      linkRetryReleaseVerified: boolean;
      linkRetryCleanupPromise: Promise<void> | null;
      currentGenerationProfileSafety: 'NEVER_AUTHENTICATED_FIRST_LINK';
    };
    internal.helperStatus = readyStatus({ state: 'LINK_RETRY_REQUIRED', connected: false, ready: false, connectedAccount: null });
    internal.linkRetryReleaseVerified = true;
    internal.linkRetryCleanupPromise = null;
    internal.currentGenerationProfileSafety = 'NEVER_AUTHENTICATED_FIRST_LINK';
    const start = jest.spyOn(service, 'start').mockResolvedValue({} as never);

    await service.retryLink();
    await expect(service.retryLink()).rejects.toThrow(
      'Try Again is available only after a recoverable WhatsApp linking failure.',
    );
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('ignores status callbacks from an older helper generation', async () => {
    const service = createService();
    const internal = service as unknown as {
      activeHelperGeneration: number;
      helperStatus: WhatsAppHelperStatusSnapshot;
      handleHelperStdoutLine(line: string, generation: number): void;
    };
    internal.activeHelperGeneration = 2;
    internal.helperStatus = readyStatus({ state: 'starting', connected: false, ready: false });
    const staleLine = `${WHATSAPP_HELPER_EVENT_PREFIX}${JSON.stringify({
      type: 'status',
      payload: readyStatus({ state: 'failed', connected: false, ready: false }),
    })}`;
    internal.handleHelperStdoutLine(staleLine, 1);

    await expect(service.getStatus()).resolves.toMatchObject({ state: 'starting' });
  });

  it('does not offer destructive first-link recovery after authentication was observed', () => {
    const service = createService();
    const internal = service as unknown as {
      activeHelperGeneration: number;
      currentGenerationAuthenticationObserved: boolean;
      currentGenerationProfileSafety: 'NEVER_AUTHENTICATED_FIRST_LINK';
      linkRetryCleanupPromise: Promise<void> | null;
    };
    internal.activeHelperGeneration = 1;
    internal.currentGenerationAuthenticationObserved = true;
    internal.currentGenerationProfileSafety = 'NEVER_AUTHENTICATED_FIRST_LINK';

    emitHelperStatus(service, readyStatus({
      state: 'failed',
      connected: false,
      ready: false,
      connectedAccount: null,
      failureCode: 'QR_INITIALIZATION_TIMEOUT',
    }));
    expect(internal.linkRetryCleanupPromise).toBeNull();
  });

  it('keeps RELINK_REQUIRED distinct from LINK_RETRY_REQUIRED', async () => {
    const service = createService();
    attachRunningHelper(service);
    emitHelperStatus(service, readyStatus({
      state: 'RELINK_REQUIRED',
      connected: false,
      ready: false,
      connectedAccount: null,
      failureCode: 'WHATSAPP_RELINK_REQUIRED',
    }));

    await expect(service.getStatus()).resolves.toMatchObject({
      state: 'RELINK_REQUIRED',
      failureCode: 'WHATSAPP_RELINK_REQUIRED',
    });
    await expect(service.retryLink()).rejects.toThrow(
      'Try Again is available only after a recoverable WhatsApp linking failure.',
    );
  });

  describe('transient network recovery supervisor', () => {
    type NetworkRecoveryInternals = {
      helperStatus: WhatsAppHelperStatusSnapshot;
      helperProcess: unknown;
      activeHelperGeneration: number;
      currentGenerationProfileSafety: 'EXISTING_SESSION_PROTECTED';
      networkRecoveryPromise: Promise<unknown> | null;
      automaticNetworkRecoveryAttempts: number;
      networkConnectivityCheckAttempts: number;
      networkConnectivityCheckDelayMs: number;
      stopHelperProcess(): Promise<void>;
      releaseCurrentProfileOwnership(profileDir: string, generation: number): Promise<void>;
      checkWhatsAppConnectivity(): Promise<boolean>;
      startInternal(): Promise<unknown>;
      isSessionProfileEmpty(): boolean;
    };

    function prepareRecovery(
      monitoringEnabled: boolean,
      connectivity: boolean,
    ): {
      service: WhatsAppCollectorService;
      internal: NetworkRecoveryInternals;
      order: string[];
      startInternal: jest.SpyInstance;
    } {
      const service = createService({ whatsappAutoStart: monitoringEnabled });
      attachRunningHelper(service);
      const internal = service as unknown as NetworkRecoveryInternals;
      internal.activeHelperGeneration = 1;
      internal.currentGenerationProfileSafety = 'EXISTING_SESSION_PROTECTED';
      internal.networkConnectivityCheckAttempts = 1;
      internal.networkConnectivityCheckDelayMs = 0;
      jest.spyOn(internal, 'isSessionProfileEmpty').mockReturnValue(false);
      const order: string[] = [];
      jest.spyOn(internal, 'stopHelperProcess').mockImplementation(async () => {
        order.push('helper-stopped');
        internal.helperProcess = null;
      });
      jest.spyOn(internal, 'releaseCurrentProfileOwnership').mockImplementation(async (_path, generation) => {
        order.push(`profile-released:${generation}`);
      });
      jest.spyOn(internal, 'checkWhatsAppConnectivity').mockImplementation(async () => {
        order.push(`connectivity:${connectivity}`);
        return connectivity;
      });
      const startInternal = jest.spyOn(internal, 'startInternal').mockImplementation(async () => {
        order.push('new-generation-started');
        internal.activeHelperGeneration += 1;
        internal.helperStatus = readyStatus({
          state: 'ready',
          connected: true,
          ready: true,
          connectedAccount: 'linked-account-1',
          productionListenerCount: monitoringEnabled ? 3 : 0,
          backfillMessagesScanned: 0,
        });
        // Mirrors the real ready-status handler, which closes the bounded
        // recovery episode before a later outage can begin.
        internal.automaticNetworkRecoveryAttempts = 0;
        return service.getStatus();
      });
      return { service, internal, order, startInternal };
    }

    it('stops and releases the failed generation before one connectivity-gated replacement', async () => {
      const { service, internal, order, startInternal } = prepareRecovery(true, true);

      emitHelperStatus(service, readyStatus({
        state: 'failed',
        connected: false,
        ready: false,
        connectedAccount: null,
        productionListenerCount: 0,
        failureCode: 'NETWORK_UNAVAILABLE',
        lastError: 'net::ERR_CONNECTION_TIMED_OUT at https://web.whatsapp.com/',
      }));
      await internal.networkRecoveryPromise;

      expect(order).toEqual([
        'helper-stopped',
        'profile-released:1',
        'connectivity:true',
        'new-generation-started',
      ]);
      expect(startInternal).toHaveBeenCalledTimes(1);
      await expect(service.getStatus()).resolves.toMatchObject({
        state: 'ready',
        monitoringPreference: 'ENABLED',
        monitoringState: 'ACTIVE',
        productionListenerCount: 3,
        backfillMessagesScanned: 0,
        qrCode: null,
      });
    });

    it('waits without launching another browser while WhatsApp Web remains unreachable', async () => {
      const { service, internal, order, startInternal } = prepareRecovery(true, false);

      emitHelperStatus(service, readyStatus({
        state: 'failed',
        connected: false,
        ready: false,
        connectedAccount: null,
        productionListenerCount: 0,
        failureCode: 'NETWORK_UNAVAILABLE',
      }));
      await internal.networkRecoveryPromise;

      expect(order).toEqual(['helper-stopped', 'profile-released:1', 'connectivity:false']);
      expect(startInternal).not.toHaveBeenCalled();
      await expect(service.getStatus()).resolves.toMatchObject({
        state: 'failed',
        monitoringPreference: 'ENABLED',
        monitoringState: 'ERROR',
        failureCode: 'NETWORK_UNAVAILABLE',
        productionListenerCount: 0,
        info: "We couldn't reconnect to WhatsApp. Check your internet connection and try again.",
      });
    });

    it('allows one later customer retry to re-enter a live-but-failed helper state', async () => {
      const { service, internal, startInternal } = prepareRecovery(true, true);
      internal.helperStatus = readyStatus({
        state: 'failed',
        connected: false,
        ready: false,
        connectedAccount: null,
        productionListenerCount: 0,
        failureCode: 'NETWORK_UNAVAILABLE',
      });

      const [first, second] = await Promise.all([service.start(), service.start()]);

      expect(startInternal).toHaveBeenCalledTimes(1);
      expect(first.state).toBe('ready');
      expect(second.state).toBe('ready');
      expect(internal.automaticNetworkRecoveryAttempts).toBe(0);
    });

    it('reconnects a saved session while preserving a paused monitoring preference', async () => {
      const { service, internal } = prepareRecovery(false, true);

      emitHelperStatus(service, readyStatus({
        state: 'failed',
        connected: false,
        ready: false,
        connectedAccount: null,
        failureCode: 'NETWORK_UNAVAILABLE',
      }));
      await internal.networkRecoveryPromise;

      await expect(service.getStatus()).resolves.toMatchObject({
        state: 'ready',
        monitoringPreference: 'PAUSED',
        monitoringState: 'PAUSED',
        productionListenerCount: 0,
        backfillMessagesScanned: 0,
      });
    });

    it('survives three sequential offline/online cycles without accumulating generations or listeners', async () => {
      const { service, internal, startInternal } = prepareRecovery(true, true);

      for (let cycle = 1; cycle <= 3; cycle += 1) {
        emitHelperStatus(service, readyStatus({
          state: 'failed',
          connected: false,
          ready: false,
          connectedAccount: null,
          productionListenerCount: 0,
          failureCode: 'NETWORK_UNAVAILABLE',
          lastError: `net::ERR_CONNECTION_TIMED_OUT cycle=${cycle}`,
        }));
        await internal.networkRecoveryPromise;
        expect((await service.getStatus()).productionListenerCount).toBe(3);
      }

      expect(startInternal).toHaveBeenCalledTimes(3);
      expect(internal.activeHelperGeneration).toBe(4);
      await expect(service.getStatus()).resolves.toMatchObject({
        monitoringState: 'ACTIVE',
        productionListenerCount: 3,
        backfillMessagesScanned: 0,
      });
    });
  });

  it('does not start or auto-recover after an unexpected-authentication terminal state', async () => {
    const service = createService();
    (service as unknown as { certificationTerminal: boolean }).certificationTerminal = true;
    (service as unknown as { helperStatus: WhatsAppHelperStatusSnapshot }).helperStatus = readyStatus({
      state: 'UNEXPECTED_AUTHENTICATION',
      connected: false,
      ready: false,
      connectedAccount: null,
      failureCode: 'UNEXPECTED_AUTHENTICATION',
    });
    const startInternal = jest.spyOn(service as never, 'startInternal');

    const status = await service.start();
    expect(status.state).toBe('UNEXPECTED_AUTHENTICATION');
    expect(startInternal).not.toHaveBeenCalled();
  });

  it('authorizes a QR-ready dual-factor certification helper exactly once', async () => {
    const originalArgv = process.argv;
    const originalEnvironment = process.env.PATROL_CERTIFICATION_EXPECT_UNAUTHENTICATED;
    process.argv = [...process.argv, '--patrol-certification-qr-only'];
    process.env.PATROL_CERTIFICATION_EXPECT_UNAUTHENTICATED = 'true';
    try {
      const service = createService();
      const { write } = attachRunningHelper(service);
      (service as unknown as { helperStatus: WhatsAppHelperStatusSnapshot }).helperStatus = readyStatus({
        state: 'qr-ready',
        connected: false,
        ready: false,
        connectedAccount: null,
      });

      const authorization = service.authorizeCertificationAuthentication();
      expect(write).toHaveBeenCalledWith(
        `${JSON.stringify({
          type: 'authorize-certification-authentication',
          explicitOperatorAuthorization: true,
        })}\n`,
      );
      emitAuthorizationResult(service, true, 'AUTHENTICATION_AUTHORIZED');
      await expect(authorization).resolves.toEqual({
        authorized: true,
        state: 'AUTHENTICATION_AUTHORIZED',
      });
      await expect(service.authorizeCertificationAuthentication()).rejects.toThrow(
        'Certification authentication authorization is not available in the current state.',
      );
    } finally {
      process.argv = originalArgv;
      if (originalEnvironment === undefined) {
        delete process.env.PATROL_CERTIFICATION_EXPECT_UNAUTHENTICATED;
      } else {
        process.env.PATROL_CERTIFICATION_EXPECT_UNAUTHENTICATED = originalEnvironment;
      }
    }
  });

  it('authorizes an existing-session reconnect while initialization is pending', async () => {
    const originalArgv = process.argv;
    const originalEnvironment = process.env.PATROL_CERTIFICATION_EXPECT_UNAUTHENTICATED;
    process.argv = [...process.argv, '--patrol-certification-qr-only'];
    process.env.PATROL_CERTIFICATION_EXPECT_UNAUTHENTICATED = 'true';
    try {
      const service = createService();
      const { write } = attachRunningHelper(service);
      (service as unknown as { helperStatus: WhatsAppHelperStatusSnapshot }).helperStatus = readyStatus({
        state: 'RECONNECT_AUTHORIZATION_PENDING',
        connected: false,
        ready: false,
        connectedAccount: null,
      });

      const authorization = service.authorizeCertificationAuthentication();
      expect(write).toHaveBeenCalledWith(
        `${JSON.stringify({
          type: 'authorize-certification-authentication',
          explicitOperatorAuthorization: true,
        })}\n`,
      );
      emitAuthorizationResult(service, true, 'AUTHENTICATION_AUTHORIZED');
      await expect(authorization).resolves.toEqual({
        authorized: true,
        state: 'AUTHENTICATION_AUTHORIZED',
      });
      await expect(service.authorizeCertificationAuthentication()).rejects.toThrow(
        'Certification authentication authorization is not available in the current state.',
      );
    } finally {
      process.argv = originalArgv;
      if (originalEnvironment === undefined) delete process.env.PATROL_CERTIFICATION_EXPECT_UNAUTHENTICATED;
      else process.env.PATROL_CERTIFICATION_EXPECT_UNAUTHENTICATED = originalEnvironment;
    }
  });

  it('keeps a dual-factor certification connection operationally idle', async () => {
    const originalArgv = process.argv;
    const originalEnvironment = process.env.PATROL_CERTIFICATION_EXPECT_UNAUTHENTICATED;
    process.argv = [...process.argv, '--patrol-certification-qr-only'];
    process.env.PATROL_CERTIFICATION_EXPECT_UNAUTHENTICATED = 'true';
    try {
      const service = createService();
      const { write } = attachRunningHelper(service);
      await service.listGroups();
      await service.listContacts();
      await service.refreshDiscoveredChats();
      await service.manualBackfill(1);
      await service.sendTestImage('synthetic-test-group');
      expect(write).not.toHaveBeenCalled();
    } finally {
      process.argv = originalArgv;
      if (originalEnvironment === undefined) delete process.env.PATROL_CERTIFICATION_EXPECT_UNAUTHENTICATED;
      else process.env.PATROL_CERTIFICATION_EXPECT_UNAUTHENTICATED = originalEnvironment;
    }
  });

  it('retains existing operational commands when either certification factor is absent', async () => {
    const originalArgv = process.argv;
    const originalEnvironment = process.env.PATROL_CERTIFICATION_EXPECT_UNAUTHENTICATED;
    try {
      process.argv = process.argv.filter((value) => value !== '--patrol-certification-qr-only');
      process.env.PATROL_CERTIFICATION_EXPECT_UNAUTHENTICATED = 'true';
      const environmentOnly = createService();
      const { write: environmentWrite } = attachRunningHelper(environmentOnly);
      const refresh = environmentOnly.refreshDiscoveredChats();
      const command = JSON.parse(environmentWrite.mock.calls[0][0]) as { type: string; requestId: string };
      emitSourceDiscoveryResult(environmentOnly, command.requestId);
      await refresh;
      expect(command).toEqual({ type: 'refresh-discovered-chats', requestId: expect.any(String) });

      delete process.env.PATROL_CERTIFICATION_EXPECT_UNAUTHENTICATED;
      process.argv = [...process.argv, '--patrol-certification-qr-only'];
      const markerOnly = createService();
      const { write: markerWrite } = attachRunningHelper(markerOnly);
      await markerOnly.manualBackfill(1);
      expect(markerWrite).toHaveBeenCalledWith(`${JSON.stringify({ type: 'manual-backfill', hours: 1 })}\n`);
    } finally {
      process.argv = originalArgv;
      if (originalEnvironment === undefined) delete process.env.PATROL_CERTIFICATION_EXPECT_UNAUTHENTICATED;
      else process.env.PATROL_CERTIFICATION_EXPECT_UNAUTHENTICATED = originalEnvironment;
    }
  });

  it('masks certification QR until helper authorization and reveals only the latest QR', async () => {
    const originalArgv = process.argv;
    const originalEnvironment = process.env.PATROL_CERTIFICATION_EXPECT_UNAUTHENTICATED;
    process.argv = [...process.argv, '--patrol-certification-qr-only'];
    process.env.PATROL_CERTIFICATION_EXPECT_UNAUTHENTICATED = 'true';
    try {
      const service = createService();
      attachRunningHelper(service);
      emitHelperStatus(service, readyStatus({ state: 'qr-ready', ready: false, connected: false, qrCode: 'qr-old', qrPayloadLength: 6 }));
      emitHelperStatus(service, readyStatus({ state: 'qr-ready', ready: false, connected: false, qrCode: 'qr-current', qrPayloadLength: 10 }));

      await expect(service.getStatus()).resolves.toMatchObject({
        qrCode: null,
        certificationState: 'EXPECTING_QR_ONLY',
        certificationQrMasked: true,
      });

      const authorization = service.authorizeCertificationAuthentication();
      emitAuthorizationResult(service, true, 'AUTHENTICATION_AUTHORIZED');
      await authorization;
      await expect(service.getStatus()).resolves.toMatchObject({
        qrCode: 'qr-current',
        certificationState: 'AUTHENTICATION_AUTHORIZED',
        certificationQrMasked: false,
      });
    } finally {
      process.argv = originalArgv;
      if (originalEnvironment === undefined) delete process.env.PATROL_CERTIFICATION_EXPECT_UNAUTHENTICATED;
      else process.env.PATROL_CERTIFICATION_EXPECT_UNAUTHENTICATED = originalEnvironment;
    }
  });

  it('never replaces a terminal supervisor snapshot with later normal helper status', async () => {
    const service = createService();
    (service as unknown as { certificationTerminal: boolean }).certificationTerminal = true;
    (service as unknown as { helperStatus: WhatsAppHelperStatusSnapshot }).helperStatus = readyStatus({
      state: 'UNEXPECTED_AUTHENTICATION', connected: false, ready: false, connectedAccount: null,
    });
    emitHelperStatus(service, readyStatus({ state: 'authenticated', connected: false, ready: false }));
    emitHelperStatus(service, readyStatus({ state: 'ready', connected: true, ready: true }));
    await expect(service.getStatus()).resolves.toMatchObject({
      state: 'UNEXPECTED_AUTHENTICATION', connected: false, ready: false,
    });
  });

  it('fails closed when either certification activation factor is absent', async () => {
    const originalArgv = process.argv;
    const originalEnvironment = process.env.PATROL_CERTIFICATION_EXPECT_UNAUTHENTICATED;
    try {
      process.argv = process.argv.filter((value) => value !== '--patrol-certification-qr-only');
      process.env.PATROL_CERTIFICATION_EXPECT_UNAUTHENTICATED = 'true';
      const environmentOnly = createService();
      attachRunningHelper(environmentOnly);
      await expect(environmentOnly.authorizeCertificationAuthentication()).rejects.toThrow(
        'WhatsApp certification authorization is unavailable.',
      );

      delete process.env.PATROL_CERTIFICATION_EXPECT_UNAUTHENTICATED;
      process.argv = [...process.argv, '--patrol-certification-qr-only'];
      const markerOnly = createService();
      attachRunningHelper(markerOnly);
      await expect(markerOnly.authorizeCertificationAuthentication()).rejects.toThrow(
        'WhatsApp certification authorization is unavailable.',
      );
    } finally {
      process.argv = originalArgv;
      if (originalEnvironment === undefined) {
        delete process.env.PATROL_CERTIFICATION_EXPECT_UNAUTHENTICATED;
      } else {
        process.env.PATROL_CERTIFICATION_EXPECT_UNAUTHENTICATED = originalEnvironment;
      }
    }
  });

  it('rejects authorization outside a QR-ready active helper session', async () => {
    const originalArgv = process.argv;
    const originalEnvironment = process.env.PATROL_CERTIFICATION_EXPECT_UNAUTHENTICATED;
    process.argv = [...process.argv, '--patrol-certification-qr-only'];
    process.env.PATROL_CERTIFICATION_EXPECT_UNAUTHENTICATED = 'true';
    try {
      const service = createService();
      attachRunningHelper(service);
      await expect(service.authorizeCertificationAuthentication()).rejects.toThrow(
        'A QR-ready or reconnect-pending certification helper session is required.',
      );

      (service as unknown as { certificationTerminal: boolean }).certificationTerminal = true;
      await expect(service.authorizeCertificationAuthentication()).rejects.toThrow(
        'The certification session is terminal and cannot be authorized.',
      );
    } finally {
      process.argv = originalArgv;
      if (originalEnvironment === undefined) {
        delete process.env.PATROL_CERTIFICATION_EXPECT_UNAUTHENTICATED;
      } else {
        process.env.PATROL_CERTIFICATION_EXPECT_UNAUTHENTICATED = originalEnvironment;
      }
    }
  });

  it('allows only authorized certification group metadata lookup', async () => {
    const originalArgv = process.argv;
    const originalEnvironment = process.env.PATROL_CERTIFICATION_EXPECT_UNAUTHENTICATED;
    process.argv = [...process.argv, '--patrol-certification-qr-only'];
    process.env.PATROL_CERTIFICATION_EXPECT_UNAUTHENTICATED = 'true';
    try {
      const service = createService();
      const helper = attachRunningHelper(service);
      (service as unknown as { certificationAuthorizationState: string }).certificationAuthorizationState = 'AUTHENTICATION_AUTHORIZED';
      const lookup = service.lookupCertificationGroup('test1');
      const command = JSON.parse((helper.write as jest.Mock).mock.calls[0][0]);
      expect(command).toMatchObject({ type: 'certification-group-lookup', displayName: 'test1' });
      const line = `${WHATSAPP_HELPER_EVENT_PREFIX}${JSON.stringify({ type: 'certification-group-lookup-result', payload: { requestId: command.requestId, displayName: 'test1', matches: [{ name: 'test1', id: '123@g.us' }] } })}`;
      (service as unknown as { handleHelperStdoutLine(line: string): void }).handleHelperStdoutLine(line);
      await expect(lookup).resolves.toEqual({ displayName: 'test1', matches: [{ name: 'test1', id: '123@g.us' }] });
    } finally {
      process.argv = originalArgv;
      if (originalEnvironment === undefined) delete process.env.PATROL_CERTIFICATION_EXPECT_UNAUTHENTICATED;
      else process.env.PATROL_CERTIFICATION_EXPECT_UNAUTHENTICATED = originalEnvironment;
    }
  });

  describe('certification live-ingestion mapping guard', () => {
    const sourceExternalId = '120363375746387624@g.us';
    const targetSiteId = 'site-1';

    function prepareAuthorizedService(): { service: WhatsAppCollectorService; write: jest.Mock } {
      const service = createService();
      const { write } = attachRunningHelper(service);
      (service as unknown as { helperStatus: WhatsAppHelperStatusSnapshot }).helperStatus = readyStatus({
        connectedAccount: 'linked-account-1',
      });
      (service as unknown as { certificationAuthorizationState: string }).certificationAuthorizationState =
        'AUTHENTICATION_AUTHORIZED';
      return { service, write };
    }

    it('arms exactly the requested active tuple while unrelated account mappings are irrelevant', async () => {
      await withQrOnlyCertification(async () => {
        const { service, write } = prepareAuthorizedService();

        await service.armCertificationLiveIngestion(sourceExternalId, targetSiteId);

        expect(whatsAppSourceMappingService.findActiveCertificationMappings).toHaveBeenCalledWith(
          'linked-account-1',
          sourceExternalId,
          targetSiteId,
        );
        expect(write).toHaveBeenCalledTimes(1);
        expect(JSON.parse(write.mock.calls[0][0])).toMatchObject({
          type: 'arm-certification-live-ingestion',
          linkedAccountId: 'linked-account-1',
          sourceExternalId,
          mappedGroupId: 'group-1',
          siteCode: 'SWI01',
        });
      });
    });

    it('fails closed when the exact tuple does not exist', async () => {
      await withQrOnlyCertification(async () => {
        const { service, write } = prepareAuthorizedService();
        whatsAppSourceMappingService.findActiveCertificationMappings.mockResolvedValue([]);

        await expect(service.armCertificationLiveIngestion(sourceExternalId, targetSiteId)).rejects.toThrow(
          'Exactly one active account-scoped source/site certification mapping is required.',
        );
        expect(write).not.toHaveBeenCalled();
      });
    });

    it('fails closed when duplicate exact tuples exist', async () => {
      await withQrOnlyCertification(async () => {
        const { service, write } = prepareAuthorizedService();
        whatsAppSourceMappingService.findActiveCertificationMappings.mockResolvedValue([
          { id: 'group-1', site: { siteCode: 'SWI01' } },
          { id: 'group-2', site: { siteCode: 'SWI01' } },
        ]);

        await expect(service.armCertificationLiveIngestion(sourceExternalId, targetSiteId)).rejects.toThrow(
          'Exactly one active account-scoped source/site certification mapping is required.',
        );
        expect(write).not.toHaveBeenCalled();
      });
    });

    it('enforces the currently authenticated account and performs no mapping or operational mutation', async () => {
      await withQrOnlyCertification(async () => {
        const { service, write } = prepareAuthorizedService();
        whatsAppSourceMappingService.resolveActiveLinkedAccountId.mockReturnValue('different-account');

        await expect(service.armCertificationLiveIngestion(sourceExternalId, targetSiteId)).rejects.toThrow(
          'Exactly one active account-scoped source/site certification mapping is required.',
        );
        expect(whatsAppSourceMappingService.findActiveCertificationMappings).not.toHaveBeenCalled();
        expect(whatsAppSourceMappingService.persistLinkedWhatsAppAccount).not.toHaveBeenCalled();
        expect(patrolImageIngestionService.ingestPatrolImage).not.toHaveBeenCalled();
        expect(write).not.toHaveBeenCalled();
      });
    });
  });
});
