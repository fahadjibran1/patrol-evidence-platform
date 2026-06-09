import { ConfigService } from '@nestjs/config';
import { CollectorType } from '@/common/enums/collector-type.enum';
import { LicensingService } from '@/licensing/licensing.service';
import { WhatsAppCollectorService } from './whatsapp-collector.service';

describe('WhatsAppCollectorService', () => {
  const patrolGroupRepo = {
    findOne: jest.fn(),
    find: jest.fn(),
    count: jest.fn(),
  };
  const patrolImageIngestionService = {
    ingestPatrolImage: jest.fn(),
    findExistingByExternalMessageId: jest.fn(),
  };
  const licensingService = {
    assertCollectorStartAllowed: jest.fn(),
  } as unknown as LicensingService;

  const mappedGroup = {
    id: 'group-1',
    groupName: 'Corner Copse - Swindon',
    externalGroupId: '120363375746387624@g.us',
    active: true,
    site: {
      id: 'site-1',
      siteCode: 'SWI01',
      active: true,
    },
  };

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

  function createMessage(overrides?: Partial<Record<string, unknown>>) {
    return {
      fromMe: false,
      from: '120363375746387624@g.us',
      hasMedia: true,
      timestamp: 1_775_000_000,
      author: '447700000000@c.us',
      id: {
        _serialized: 'wamid-1',
        id: 'wamid-1',
      },
      downloadMedia: jest.fn().mockResolvedValue({
        mimetype: 'image/jpeg',
        filename: 'proof.jpg',
        data: Buffer.from('abc').toString('base64'),
      }),
      getContact: jest.fn().mockResolvedValue({
        pushname: 'Guard One',
        name: 'Guard One',
        shortName: 'Guard',
        number: '447700000000',
      }),
      getChat: jest.fn().mockResolvedValue({
        isGroup: true,
        name: 'Corner Copse - Swindon',
      }),
      ...overrides,
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    patrolGroupRepo.find.mockResolvedValue([mappedGroup]);
    patrolGroupRepo.count.mockResolvedValue(1);
    patrolGroupRepo.findOne.mockResolvedValue(mappedGroup);
    patrolImageIngestionService.findExistingByExternalMessageId.mockResolvedValue(null);
    patrolImageIngestionService.ingestPatrolImage.mockResolvedValue({
      id: 'img-1',
      collectorType: CollectorType.WHATSAPP,
    });
    licensingService.assertCollectorStartAllowed = jest.fn();
  });

  it('skips fromMe messages when WHATSAPP_ALLOW_FROM_ME is false', async () => {
    const service = new WhatsAppCollectorService(
      createConfigService({ whatsappAllowFromMe: false }),
      patrolGroupRepo as never,
      patrolImageIngestionService as never,
      licensingService,
    );

    (service as never as { state: string }).state = 'ready';

    await (service as never as { handleMessage(message: unknown): Promise<void> }).handleMessage(
      createMessage({ fromMe: true }),
    );

    expect(patrolImageIngestionService.ingestPatrolImage).not.toHaveBeenCalled();
    expect(patrolImageIngestionService.findExistingByExternalMessageId).not.toHaveBeenCalled();
  });

  it('accepts fromMe messages when WHATSAPP_ALLOW_FROM_ME is true', async () => {
    const service = new WhatsAppCollectorService(
      createConfigService({ whatsappAllowFromMe: true }),
      patrolGroupRepo as never,
      patrolImageIngestionService as never,
      licensingService,
    );

    (service as never as { state: string }).state = 'ready';

    await (service as never as { handleMessage(message: unknown): Promise<void> }).handleMessage(
      createMessage({ fromMe: true }),
    );

    expect(patrolImageIngestionService.ingestPatrolImage).toHaveBeenCalledWith(
      expect.objectContaining({
        siteCode: 'SWI01',
        messageExternalId: 'wamid-1',
        senderName: 'Guard One',
      }),
    );
  });

  it('falls back to sender number when WhatsApp contact name is generic', async () => {
    const service = new WhatsAppCollectorService(
      createConfigService({ whatsappAllowFromMe: true }),
      patrolGroupRepo as never,
      patrolImageIngestionService as never,
      licensingService,
    );

    (service as never as { state: string }).state = 'ready';

    await (service as never as { handleMessage(message: unknown): Promise<void> }).handleMessage(
      createMessage({
        getContact: jest.fn().mockResolvedValue({
          pushname: 'WhatsApp',
          name: '',
          shortName: '',
          number: '447700111222',
        }),
        author: '447700111222@c.us',
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
    const service = new WhatsAppCollectorService(
      createConfigService({ whatsappAllowFromMe: true }),
      patrolGroupRepo as never,
      patrolImageIngestionService as never,
      licensingService,
    );
    const existingImage = { id: 'img-existing', messageExternalId: 'wamid-1' };

    patrolImageIngestionService.findExistingByExternalMessageId.mockResolvedValue(existingImage);

    const result = await (service as never as {
      processMessage(message: unknown, source: 'live' | 'backfill'): Promise<string>;
    }).processMessage(createMessage(), 'backfill');

    expect(result).toBe('duplicate');
    expect(patrolImageIngestionService.ingestPatrolImage).not.toHaveBeenCalled();
  });

  it('updates backfill status after reconnect-ready processing', async () => {
    const service = new WhatsAppCollectorService(
      createConfigService({ whatsappAllowFromMe: false }),
      patrolGroupRepo as never,
      patrolImageIngestionService as never,
      licensingService,
    );

    const handlers: Record<string, (...args: unknown[]) => unknown> = {};
    const chat = {
      fetchMessages: jest.fn().mockResolvedValue([
        createMessage({ id: { _serialized: 'wamid-import', id: 'wamid-import' } }),
        createMessage({ id: { _serialized: 'wamid-duplicate', id: 'wamid-duplicate' } }),
      ]),
    };
    const client: {
      info: { wid: { _serialized: string } };
      on: jest.Mock;
      getChatById: jest.Mock;
      destroy: jest.Mock;
    } = {
      info: { wid: { _serialized: '447700000000@c.us' } },
      on: jest.fn().mockImplementation((event: string, handler: (...args: unknown[]) => unknown) => {
        handlers[event] = handler;
        return client;
      }),
      getChatById: jest.fn().mockResolvedValue(chat),
      destroy: jest.fn(),
    };

    patrolImageIngestionService.findExistingByExternalMessageId.mockImplementation((messageExternalId: string) => {
      if (messageExternalId === 'wamid-duplicate') {
        return Promise.resolve({ id: 'img-existing', messageExternalId });
      }

      return Promise.resolve(null);
    });

    (service as never as { client: unknown }).client = client;
    (service as never as { reconnectInProgress: boolean }).reconnectInProgress = true;
    (service as never as { registerClientEvents(clientArg: unknown): void }).registerClientEvents(client);

    await handlers.ready();

    const status = await service.getStatus();

    expect(status.ready).toBe(true);
    expect(status.connected).toBe(true);
    expect(status.lastReadyAt).not.toBeNull();
    expect(status.lastBackfillAt).not.toBeNull();
    expect(status.backfillRunning).toBe(false);
    expect(status.backfillMessagesScanned).toBe(2);
    expect(status.backfillImagesImported).toBe(1);
    expect(status.backfillDuplicatesSkipped).toBe(1);
    expect(status.mappedGroupsCount).toBe(1);
  });

  it('runs manual backfill for the requested hour window', async () => {
    const service = new WhatsAppCollectorService(
      createConfigService({ whatsappAllowFromMe: false, whatsappBackfillMessageLimit: 0 }),
      patrolGroupRepo as never,
      patrolImageIngestionService as never,
      licensingService,
    );

    const nowSeconds = Math.floor(Date.now() / 1000);
    const chat = {
      fetchMessages: jest.fn().mockResolvedValue([
        createMessage({
          timestamp: nowSeconds - 30 * 60,
          id: { _serialized: 'wamid-recent', id: 'wamid-recent' },
        }),
        createMessage({
          timestamp: nowSeconds - 3 * 60 * 60,
          id: { _serialized: 'wamid-old', id: 'wamid-old' },
        }),
      ]),
    };
    const client = {
      getChatById: jest.fn().mockResolvedValue(chat),
    };

    (service as never as { client: unknown }).client = client;
    (service as never as { state: string }).state = 'ready';

    await service.manualBackfill(1);

    const status = await service.getStatus();

    expect(chat.fetchMessages).toHaveBeenCalled();
    expect(status.backfillMessagesScanned).toBe(1);
    expect(status.backfillImagesImported).toBe(1);
    expect(status.backfillDuplicatesSkipped).toBe(0);
  });

  it('retries manual backfill once when WhatsApp returns a detached frame error', async () => {
    const service = new WhatsAppCollectorService(
      createConfigService({ whatsappAllowFromMe: false, whatsappBackfillMessageLimit: 10 }),
      patrolGroupRepo as never,
      patrolImageIngestionService as never,
      licensingService,
    );
    const nowSeconds = Math.floor(Date.now() / 1000);

    const chat = {
      fetchMessages: jest
        .fn()
        .mockRejectedValueOnce(new Error("Attempted to use detached Frame 'frame-1'."))
        .mockResolvedValueOnce([
          createMessage({
            timestamp: nowSeconds - 20 * 60,
            id: { _serialized: 'wamid-retry', id: 'wamid-retry' },
          }),
        ]),
    };
    const client = {
      getChatById: jest.fn().mockResolvedValue(chat),
    };

    (service as never as { client: unknown }).client = client;
    (service as never as { state: string }).state = 'ready';

    await service.manualBackfill(12);

    const status = await service.getStatus();

    expect(chat.fetchMessages).toHaveBeenCalledTimes(2);
    expect(status.backfillMessagesScanned).toBe(1);
    expect(status.backfillImagesImported).toBe(1);
  });

  it('blocks collector start when the licence service rejects activation', async () => {
    const service = new WhatsAppCollectorService(
      createConfigService({ whatsappAllowFromMe: false }),
      patrolGroupRepo as never,
      patrolImageIngestionService as never,
      {
        assertCollectorStartAllowed: jest.fn(() => {
          throw new Error('Trial expired');
        }),
      } as never,
    );

    await expect(service.start()).rejects.toThrow('Trial expired');
  });
});
