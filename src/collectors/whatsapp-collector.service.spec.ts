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
    await service.refreshDiscoveredChats();
    await service.manualBackfill(1);
    await service.sendTestImage();
    await service.probeAuthReadyLifecycle();
    expect(write).not.toHaveBeenCalled();
    expect(whatsAppSourceMappingService.persistLinkedWhatsAppAccount).not.toHaveBeenCalledWith(accountIdentifier);
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
      await environmentOnly.refreshDiscoveredChats();
      expect(environmentWrite).toHaveBeenCalledWith(`${JSON.stringify({ type: 'refresh-discovered-chats' })}\n`);

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
});
