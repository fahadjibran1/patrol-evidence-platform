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

  const whatsAppSourceMappingService = {
    resolveActiveLinkedAccountId: jest.fn(),
    countActiveMappingsForIngest: jest.fn(),
    toRuntimeMappings: jest.fn(),
    resolveMappingForIngest: jest.fn(),
    persistLinkedWhatsAppAccount: jest.fn(),
    getConfiguredLinkedAccountId: jest.fn(),
    findActiveMappingsForIngest: jest.fn(),
  };

  const patrolImageIngestionService = {
    ingestPatrolImage: jest.fn(),
    findExistingByExternalMessageId: jest.fn(),
  };

  const licensingService = {
    assertCollectorStartAllowed: jest.fn(),
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
    patrolImageIngestionService.findExistingByExternalMessageId.mockResolvedValue(null);
    patrolImageIngestionService.ingestPatrolImage.mockResolvedValue({
      id: 'img-1',
      collectorType: CollectorType.WHATSAPP,
      filePath: 'evidence/img-1.jpg',
    });
    licensingService.assertCollectorStartAllowed = jest.fn();
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
    expect(whatsAppSourceMappingService.resolveActiveLinkedAccountId).toHaveBeenCalled();
    expect(whatsAppSourceMappingService.countActiveMappingsForIngest).toHaveBeenCalledWith('linked-account-1');
  });

  it('runs manual backfill for the requested hour window', async () => {
    const service = createService({ whatsappAllowFromMe: false, whatsappBackfillMessageLimit: 0 });
    const { write } = attachRunningHelper(service);

    const status = await service.manualBackfill(1);

    expect(write).toHaveBeenCalledWith(`${JSON.stringify({ type: 'manual-backfill', hours: 1 })}\n`);
    expect(status.ready).toBe(true);
    expect(status.info).toBe('Refreshing patrol history for the last 1 hour.');
    expect(whatsAppSourceMappingService.resolveActiveLinkedAccountId).toHaveBeenCalledWith(
      '447700000000@c.us',
    );
    expect(whatsAppSourceMappingService.countActiveMappingsForIngest).toHaveBeenCalledWith('linked-account-1');
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
        assertCollectorStartAllowed: jest.fn(() => {
          throw new Error('Trial expired');
        }),
      } as never,
    );

    await expect(rejectingService.start()).rejects.toThrow('Trial expired');
  });
});
