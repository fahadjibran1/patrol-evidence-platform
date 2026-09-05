import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { SimulateLiveImageIngestDto } from './dto/simulate-live-image-ingest.dto';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as readline from 'readline';
import { CollectorType } from '@/common/enums/collector-type.enum';
import { LicensingService } from '@/licensing/licensing.service';
import { WhatsAppSourceMappingService } from '@/patrol-groups/whatsapp-source-mapping.service';
import { IngestPatrolImageEvent, PatrolImageIngestionService } from '@/patrol-images/patrol-image-ingestion.service';
import {
  ensureProfileUnlocked,
  findBrowserProcessesUsingProfile,
  isProcessAlive,
  readHelperMutex,
  terminateBrowserOwners,
  type BrowserProcessOwner,
} from './browser-profile-lock.util';
import {
  WhatsAppCollectorContact,
  WhatsAppCollectorGroup,
  WhatsAppHelperCommand,
  WhatsAppHelperEvent,
  WhatsAppHelperIngestPayload,
  WhatsAppHelperRuntimeConfig,
  WhatsAppHelperStatusSnapshot,
  WHATSAPP_HELPER_EVENT_PREFIX,
} from './whatsapp-helper.types';
import {
  QR_ONLY_CERTIFICATION_PROCESS_MARKER,
  UNEXPECTED_AUTHENTICATION,
  isQrOnlyCertificationMode,
  redactQrOnlyCertificationLog,
} from './whatsapp-certification-guard';

export type { WhatsAppCollectorContact, WhatsAppCollectorGroup } from './whatsapp-helper.types';

export interface WhatsAppCollectorStatus extends Omit<WhatsAppHelperStatusSnapshot, 'groups'> {
  collectorLogTail: string[];
  mappedGroupsCount: number;
  pilotGroupName: string | null;
  certificationState: WhatsAppCertificationAuthorizationResult['state'];
  certificationQrMasked: boolean;
}

export interface WhatsAppCertificationAuthorizationResult {
  authorized: boolean;
  state: 'DISABLED' | 'EXPECTING_QR_ONLY' | 'AUTHENTICATION_AUTHORIZED' | typeof UNEXPECTED_AUTHENTICATION;
}

@Injectable()
export class WhatsAppCollectorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WhatsAppCollectorService.name);
  private readonly enabled: boolean;
  private readonly autoStart: boolean;
  private readonly headless: boolean;
  private readonly allowFromMe: boolean;
  private readonly sessionPath: string;
  private readonly collectorLogPath: string;
  private readonly latestQrPath: string;
  private readonly helperEntryPath: string;
  private readonly helperInternalToken =
    process.env.PATROL_HELPER_INTERNAL_TOKEN?.trim() || randomUUID();
  private readonly startupDelayMs = 1_000;
  private readonly stopTimeoutMs = 8_000;

  private helperProcess: ChildProcessWithoutNullStreams | null = null;
  private helperStdout: readline.Interface | null = null;
  private startPromise: Promise<WhatsAppCollectorStatus> | null = null;
  private stopPromise: Promise<void> | null = null;
  private mappedGroupsCount = 0;
  private pilotGroupName?: string;
  private pilotSiteCode?: string;
  private stoppingHelper = false;
  private chatDiscoveryRefreshCooldownUntil = 0;
  private certificationTerminal = false;
  private certificationAuthorizationRequested = false;
  private certificationAuthorizationState:
    | 'DISABLED'
    | 'EXPECTING_QR_ONLY'
    | 'AUTHENTICATION_AUTHORIZED'
    | typeof UNEXPECTED_AUTHENTICATION = isQrOnlyCertificationMode() ? 'EXPECTING_QR_ONLY' : 'DISABLED';
  private pendingCertificationAuthorization:
    | {
        resolve: (result: WhatsAppCertificationAuthorizationResult) => void;
        timer: NodeJS.Timeout;
      }
    | null = null;
  private helperStatus: WhatsAppHelperStatusSnapshot;

  constructor(
    private readonly configService: ConfigService,
    private readonly whatsAppSourceMappingService: WhatsAppSourceMappingService,
    private readonly patrolImageIngestionService: PatrolImageIngestionService,
    private readonly licensingService: LicensingService,
  ) {
    this.enabled = configService.get<boolean>('whatsappEnabled') ?? false;
    this.autoStart = configService.get<boolean>('whatsappAutoStart') ?? false;
    this.headless = configService.get<boolean>('whatsappHeadless') ?? true;
    this.allowFromMe = configService.get<boolean>('whatsappAllowFromMe') ?? false;
    this.sessionPath = configService.getOrThrow<string>('whatsappSessionPath');
    this.collectorLogPath = this.resolveCollectorLogPath();
    this.latestQrPath = this.resolveLatestQrPath();
    this.pilotGroupName = configService.get<string>('whatsappPilotGroupName') ?? undefined;
    this.pilotSiteCode = configService.get<string>('whatsappPilotSiteCode') ?? undefined;
    this.helperEntryPath = path.join(process.cwd(), 'dist', 'collectors', 'whatsapp-helper.main.js');
    this.helperStatus = this.buildDefaultStatus();

    this.appendCollectorLog(
      'collector-manager-config',
      `enabled=${this.enabled} autoStart=${this.autoStart} sessionPath=${this.sessionPath} helperEntry=${this.helperEntryPath}`,
    );
  }

  async onModuleInit(): Promise<void> {
    if (!this.enabled) {
      this.logger.log('WHATSAPP_AUTOSTART_SKIPPED reason=collector-disabled');
      this.appendCollectorLog('auto-start-skipped', 'collector-disabled');
      return;
    }

    if (!this.autoStart) {
      this.logger.log('WHATSAPP_AUTOSTART_SKIPPED reason=auto-start-disabled');
      this.appendCollectorLog('auto-start-skipped', 'startPatrolMonitoringAfterLaunch=false');
      return;
    }

    this.logger.log('WHATSAPP_AUTOSTART_ENABLED');
    this.appendCollectorLog('auto-start-enabled', 'startPatrolMonitoringAfterLaunch=true');

    void this.start().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Patrol monitoring auto-start failed: ${message}`);
      this.appendCollectorLog('auto-start-failed', message);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.stopHelperProcess();
  }

  async getStatus(): Promise<WhatsAppCollectorStatus> {
    await this.refreshMappedGroupsCount();
    const certificationQrMasked =
      isQrOnlyCertificationMode() &&
      this.certificationAuthorizationState !== 'AUTHENTICATION_AUTHORIZED';
    if (this.helperStatus.qrCode && !certificationQrMasked && !this.helperStatus.qrDeliveredAt) {
      this.helperStatus = {
        ...this.helperStatus,
        qrDeliveredAt: new Date().toISOString(),
      };
      this.appendCollectorLog(
        'qr-delivered-to-frontend',
        `length=${this.helperStatus.qrPayloadLength ?? 0} state=${this.helperStatus.state}`,
      );
    }

    const connectedAccount = this.helperStatus.connectedAccount?.trim();
    if (connectedAccount) {
      void this.syncLinkedWhatsAppAccount(connectedAccount);
    }

    return {
      ...this.helperStatus,
      qrCode: certificationQrMasked ? null : this.helperStatus.qrCode,
      qrPayloadLength: certificationQrMasked ? null : this.helperStatus.qrPayloadLength,
      info:
        certificationQrMasked && this.helperStatus.state === 'qr-ready'
          ? 'QR prepared — waiting for certification authorization.'
          : this.helperStatus.info,
      connected: this.helperStatus.state === 'ready',
      ready: this.helperStatus.state === 'ready',
      mappedGroupsCount: this.mappedGroupsCount,
      pilotGroupName: this.pilotGroupName ?? null,
      collectorLogTail: this.readCollectorLogTail(),
      certificationState: this.certificationAuthorizationState,
      certificationQrMasked,
    };
  }

  async listGroups(): Promise<WhatsAppCollectorGroup[]> {
    this.maybeRequestChatDiscoveryRefresh();
    return [...this.helperStatus.groups].sort((left, right) => left.name.localeCompare(right.name));
  }

  async listContacts(): Promise<WhatsAppCollectorContact[]> {
    this.maybeRequestChatDiscoveryRefresh();
    return [...this.helperStatus.contacts].sort((left, right) => left.name.localeCompare(right.name));
  }

  async refreshDiscoveredChats(): Promise<WhatsAppCollectorStatus> {
    if (!this.isHelperRunning()) {
      this.helperStatus = {
        ...this.helperStatus,
        info: 'Patrol monitoring helper is not running.',
      };
      return this.getStatus();
    }

    if (isQrOnlyCertificationMode()) {
      this.appendCollectorLog('certification-operational-command-suppressed', 'action=refresh-discovered-chats');
      return this.getStatus();
    }

    this.sendHelperCommand({ type: 'refresh-discovered-chats' });
    return this.getStatus();
  }

  async start(): Promise<WhatsAppCollectorStatus> {
    if (!this.enabled) {
      this.helperStatus = this.buildDefaultStatus({
        state: 'disabled',
        info: 'Set WHATSAPP_ENABLED=true to start patrol monitoring.',
      });
      return this.getStatus();
    }

    if (this.certificationTerminal) {
      return this.getStatus();
    }

    this.licensingService.assertCollectorStartAllowed();

    if (this.isHelperRunning()) {
      return this.getStatus();
    }

    if (this.startPromise) {
      return this.startPromise;
    }

    this.startPromise = this.startInternal();
    try {
      return await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  async stop(): Promise<WhatsAppCollectorStatus> {
    await this.stopHelperProcess();
    this.certificationTerminal = false;
    this.clearPendingCertificationAuthorization();
    this.certificationAuthorizationRequested = false;
    this.certificationAuthorizationState = isQrOnlyCertificationMode() ? 'EXPECTING_QR_ONLY' : 'DISABLED';
    this.helperStatus = this.buildDefaultStatus({
      state: this.enabled ? 'idle' : 'disabled',
      info: 'Patrol monitoring stopped.',
      startupStage: 'Stopped',
      lastError: null,
      qrCode: null,
      connectedAccount: null,
      groups: [],
      contacts: [],
    });
    return this.getStatus();
  }

  async authorizeCertificationAuthentication(): Promise<WhatsAppCertificationAuthorizationResult> {
    if (!isQrOnlyCertificationMode()) {
      throw new NotFoundException('WhatsApp certification authorization is unavailable.');
    }
    if (
      this.certificationTerminal ||
      this.certificationAuthorizationState === UNEXPECTED_AUTHENTICATION ||
      this.helperStatus.state === UNEXPECTED_AUTHENTICATION
    ) {
      throw new BadRequestException('The certification session is terminal and cannot be authorized.');
    }
    if (
      !this.isHelperRunning() ||
      !['qr-ready', 'RECONNECT_AUTHORIZATION_PENDING'].includes(this.helperStatus.state)
    ) {
      throw new BadRequestException('A QR-ready or reconnect-pending certification helper session is required.');
    }
    if (
      this.certificationAuthorizationRequested ||
      this.certificationAuthorizationState !== 'EXPECTING_QR_ONLY'
    ) {
      throw new BadRequestException('Certification authentication authorization is not available in the current state.');
    }

    this.certificationAuthorizationRequested = true;
    this.appendCollectorLog('WHATSAPP_CERTIFICATION_AUTHORIZATION_REQUESTED');
    const resultPromise = new Promise<WhatsAppCertificationAuthorizationResult>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingCertificationAuthorization = null;
        this.certificationAuthorizationRequested = false;
        resolve({ authorized: false, state: this.certificationAuthorizationState });
      }, 2_000);
      this.pendingCertificationAuthorization = { resolve, timer };
    });
    this.sendHelperCommand({
      type: 'authorize-certification-authentication',
      explicitOperatorAuthorization: true,
    });
    return resultPromise;
  }

  async resetSession(): Promise<WhatsAppCollectorStatus> {
    const stack = new Error('session-reset-requested').stack ?? 'stack-unavailable';
    this.appendCollectorLog(
      'SESSION_DELETE_REQUESTED',
      `user-initiated reset stack=${stack.replace(/\s+/g, ' ')} pid=${process.pid}`,
    );
    this.appendCollectorLog(
      'session-reset-requested',
      `user-initiated reset stack=${stack.replace(/\s+/g, ' ')}`,
    );
    await this.stopHelperProcess();
    await this.sleep(3_000);

    try {
      await this.deleteSessionFolderWithRetry();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.helperStatus = this.buildDefaultStatus({
        state: 'failed',
        info: `Unable to reset WhatsApp session: ${message}`,
        startupStage: 'Session reset failed',
        lastError: message,
        sessionCorruptionSuspected: isSessionCorruptionSignal(message),
        sessionCorruptionMessage: isSessionCorruptionSignal(message)
          ? 'WhatsApp session appears corrupted. Reset WhatsApp session.'
          : null,
      });
      this.appendCollectorLog('session-reset-error', message);
      return this.getStatus();
    }

    this.helperStatus = this.buildDefaultStatus({
      state: 'idle',
      info: 'WhatsApp session reset. Starting QR flow…',
      startupStage: 'Session reset',
      lastError: null,
      sessionCorruptionSuspected: false,
      sessionCorruptionMessage: null,
      connectedAccount: null,
      groups: [],
      contacts: [],
    });
    this.appendCollectorLog('session-reset', 'WhatsApp session folder deleted. Restarting QR flow.');

    if (!this.enabled) {
      return this.getStatus();
    }

    return this.start();
  }

  /**
   * Operator action: archive the current automated browser profile and start with a brand-new userDataDir.
   * Closes only browser processes that hold this application's profile — not the user's personal Chrome/Edge.
   */
  async createFreshWhatsAppProfile(): Promise<WhatsAppCollectorStatus> {
    const stack = new Error('fresh-profile-requested').stack ?? 'stack-unavailable';
    const profileDir = path.join(this.sessionPath, 'session-patrol-evidence-platform');
    this.appendCollectorLog(
      'SESSION_DELETE_REQUESTED',
      `create-fresh-whatsapp-profile stack=${stack.replace(/\s+/g, ' ')} pid=${process.pid} profileDir=${profileDir}`,
    );

    await this.stopHelperProcess();
    await this.sleep(1_000);

    const owners = findBrowserProcessesUsingProfile(profileDir);
    if (owners.length > 0) {
      this.appendCollectorLog(
        'EXISTING_BROWSER_FOUND',
        owners.map((owner) => `pid=${owner.pid} name=${owner.name}`).join(' | '),
      );
      await terminateBrowserOwners(owners, { forceAfterMs: 5_000 });
    }

    try {
      await ensureProfileUnlocked(profileDir, (event, details) => {
        this.appendCollectorLog(event, details);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.appendCollectorLog('fresh-profile-unlock-warning', message);
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    if (existsSync(this.sessionPath)) {
      const archivePath = `${this.sessionPath}.bak-${timestamp}`;
      try {
        renameSync(this.sessionPath, archivePath);
        this.appendCollectorLog(
          'fresh-profile-archived',
          `from=${this.sessionPath} to=${archivePath}`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.appendCollectorLog('fresh-profile-archive-failed', message);
        await this.deleteSessionFolderWithRetry();
      }
    }

    mkdirSync(this.sessionPath, { recursive: true });
    this.appendCollectorLog(
      'fresh-profile-created',
      `sessionPath=${this.sessionPath} userDataDir=${path.join(this.sessionPath, 'session-patrol-evidence-platform')}`,
    );

    this.helperStatus = this.buildDefaultStatus({
      state: 'idle',
      info: 'Fresh WhatsApp profile created. Starting QR flow…',
      startupStage: 'Fresh profile',
      lastError: null,
      sessionCorruptionSuspected: false,
      sessionCorruptionMessage: null,
      connectedAccount: null,
      groups: [],
      contacts: [],
    });

    if (!this.enabled) {
      return this.getStatus();
    }

    return this.start();
  }

  private async deleteSessionFolderWithRetry(maxAttempts = 6): Promise<void> {
    if (!existsSync(this.sessionPath)) {
      return;
    }

    let lastError: unknown = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        rmSync(this.sessionPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 });
        this.appendCollectorLog('session-reset-deleted', `path=${this.sessionPath} attempt=${attempt}`);
        return;
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        this.appendCollectorLog('session-reset-delete-retry', `attempt=${attempt} error=${message}`);
        await this.sleep(1_000 * attempt);
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  async manualBackfill(hours: number): Promise<WhatsAppCollectorStatus> {
    if (!this.isHelperRunning() || this.helperStatus.state !== 'ready') {
      this.helperStatus = {
        ...this.helperStatus,
        info: 'Patrol monitoring must be ready before history refresh can run.',
      };
      return this.getStatus();
    }

    if (isQrOnlyCertificationMode()) {
      this.appendCollectorLog('certification-operational-command-suppressed', 'action=manual-backfill');
      return this.getStatus();
    }

    this.sendHelperCommand({ type: 'manual-backfill', hours });
    this.helperStatus = {
      ...this.helperStatus,
      info: `Refreshing patrol history for the last ${hours} hour${hours === 1 ? '' : 's'}.`,
    };
    return this.getStatus();
  }

  async getRuntimeConfig(token: string): Promise<WhatsAppHelperRuntimeConfig> {
    this.assertHelperToken(token);
    const linkedAccountId = this.whatsAppSourceMappingService.resolveActiveLinkedAccountId(
      this.helperStatus.connectedAccount,
    );
    const activeMappings = await this.whatsAppSourceMappingService.toRuntimeMappings(linkedAccountId);

    return {
      allowFromMe: this.allowFromMe,
      pilotGroupName: this.pilotGroupName ?? null,
      pilotSiteCode: this.pilotSiteCode ?? null,
      mappedGroups: activeMappings,
    };
  }

  async ingestFromHelper(
    token: string,
    payload: WhatsAppHelperIngestPayload,
    ingestContext?: { contentLength?: string | number },
  ): Promise<{ ok: true; imageId: string; duplicate: boolean; filePath?: string }> {
    this.assertHelperToken(token);
    this.logIngestPayloadSize(payload, ingestContext?.contentLength);
    return this.ingestPatrolImagePayload(payload, 'helper');
  }

  async simulateLiveImageIngest(
    token: string,
    payload: SimulateLiveImageIngestDto,
  ): Promise<{ ok: true; imageId: string; duplicate: boolean }> {
    this.assertHelperToken(token);
    return this.simulateLiveImageIngestForAdmin(payload);
  }

  async simulateLiveImageIngestForAdmin(
    payload: SimulateLiveImageIngestDto,
  ): Promise<{ ok: true; imageId: string; duplicate: boolean }> {
    const linkedAccountId = this.whatsAppSourceMappingService.resolveActiveLinkedAccountId(
      this.helperStatus.connectedAccount,
    );
    const mappedGroup = await this.whatsAppSourceMappingService.resolveMappingForIngest(
      payload.externalGroupId,
      linkedAccountId,
    );

    if (!mappedGroup?.site?.active) {
      this.appendCollectorLog(
        'pipeline:source-not-mapped',
        `simulate externalGroupId=${payload.externalGroupId} siteCode=${payload.siteCode}`,
      );
      throw new BadRequestException('Mapped active patrol group not found for externalGroupId.');
    }

    const pngBase64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9s3FoXcAAAAASUVORK5CYII=';
    const messageExternalId =
      payload.messageExternalId?.trim() || `simulate-live-${payload.externalGroupId}-${Date.now()}`;

    this.appendCollectorLog(
      'simulate-live-image-start',
      `siteCode=${payload.siteCode} externalGroupId=${payload.externalGroupId} message=${messageExternalId}`,
    );

    return this.ingestPatrolImagePayload(
      {
        siteCode: payload.siteCode.trim().toUpperCase(),
        groupId: payload.groupId ?? mappedGroup.id,
        senderName: 'Simulated guard',
        senderNumber: 'simulated',
        messageExternalId,
        originalFileName: `simulate-${messageExternalId}.png`,
        mimeType: 'image/png',
        fileSize: Buffer.byteLength(pngBase64, 'base64'),
        fileBase64: pngBase64,
        timestamp: new Date().toISOString(),
      },
      'simulate',
    );
  }

  private logIngestPayloadSize(
    payload: WhatsAppHelperIngestPayload,
    contentLength?: string | number,
  ): void {
    const base64Bytes = payload.fileBase64 ? Buffer.byteLength(payload.fileBase64, 'utf8') : 0;
  const decodedBytes = payload.fileSize ?? (base64Bytes > 0 ? Math.floor((base64Bytes * 3) / 4) : 0);

    this.appendCollectorLog(
      'ingest-payload-bytes',
      `fileSize=${payload.fileSize ?? 'none'} decodedEstimate=${decodedBytes} base64FieldBytes=${base64Bytes} message=${payload.messageExternalId ?? 'none'}`,
    );
    this.appendCollectorLog(
      'ingest-content-length',
      `header=${contentLength ?? 'none'} base64FieldBytes=${base64Bytes} fileSize=${payload.fileSize ?? 'none'}`,
    );
  }

  private async ingestPatrolImagePayload(
    payload: WhatsAppHelperIngestPayload,
    source: 'helper' | 'simulate',
  ): Promise<{ ok: true; imageId: string; duplicate: boolean; filePath?: string }> {
    if (source === 'simulate') {
      this.logIngestPayloadSize(payload);
    }

    this.appendCollectorLog(
      'pipeline:backend-ingest-received',
      `source=${source} siteCode=${payload.siteCode} message=${payload.messageExternalId} groupId=${payload.groupId ?? 'none'} bytes=${payload.fileSize}`,
    );

    const normalized: IngestPatrolImageEvent = {
      collectorType: CollectorType.WHATSAPP,
      siteCode: payload.siteCode,
      timestamp: payload.timestamp,
      groupId: payload.groupId,
      senderName: payload.senderName,
      senderNumber: payload.senderNumber,
      senderExternalId: payload.senderExternalId,
      messageExternalId: payload.messageExternalId,
      originalFileName: payload.originalFileName,
      mimeType: payload.mimeType,
      fileSize: payload.fileSize,
      fileBuffer: Buffer.from(payload.fileBase64, 'base64'),
    };

    const existingBefore = payload.messageExternalId
      ? await this.patrolImageIngestionService.findExistingByExternalMessageId(payload.messageExternalId)
      : null;

    try {
      const image = await this.patrolImageIngestionService.ingestPatrolImage(normalized);
      const duplicate = Boolean(existingBefore);

      this.appendCollectorLog(
        'APP_IMAGE_INGEST_SUCCESS',
        `source=${source} imageId=${image.id} siteCode=${payload.siteCode} file=${image.filePath ?? 'unknown'}`,
      );
      this.appendCollectorLog(
        'APP_IMAGE_CAPTURED',
        `sender=${payload.senderNumber ?? 'unknown'} chat=${payload.sourceExternalId ?? 'unknown'} site=${payload.siteCode} file=${image.filePath ?? 'unknown'}`,
      );
      this.appendCollectorLog(
        'pipeline:backend-ingest-success',
        `source=${source} imageId=${image.id} siteCode=${payload.siteCode} message=${payload.messageExternalId} duplicate=${duplicate}`,
      );
      this.appendCollectorLog(
        duplicate ? 'pipeline:db-save-duplicate' : 'pipeline:db-save-success',
        `source=${source} imageId=${image.id} siteCode=${payload.siteCode} message=${payload.messageExternalId}`,
      );

      return { ok: true, imageId: image.id, duplicate, filePath: image.filePath ?? undefined };
    } catch (error) {
      this.appendCollectorLog(
        'pipeline:backend-ingest-failure',
        `source=${source} siteCode=${payload.siteCode} message=${payload.messageExternalId} error=${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  private async startInternal(): Promise<WhatsAppCollectorStatus> {
    this.clearPendingCertificationAuthorization();
    this.certificationAuthorizationRequested = false;
    this.certificationAuthorizationState = isQrOnlyCertificationMode() ? 'EXPECTING_QR_ONLY' : 'DISABLED';
    this.helperStatus = this.buildDefaultStatus({
      state: 'starting',
      info: 'Patrol monitoring starting...',
      startupStage: 'Starting patrol monitoring...',
      startupStartedAt: new Date().toISOString(),
      lastError: null,
      qrCode: null,
    });

    this.clearPreviousQrArtifact();

    if (!existsSync(this.helperEntryPath)) {
      this.helperStatus = {
        ...this.helperStatus,
        state: 'failed',
        info: 'The patrol monitoring helper is missing from the desktop build.',
        startupStage: 'Helper missing',
        lastError: this.helperEntryPath,
      };
      return this.getStatus();
    }

    this.ensureSessionDirectoryWritable();
    await this.ensureSingleHelperInstance();
    this.stopHelperProcessStreams();
    this.stoppingHelper = false;

    const helperEnv = this.buildHelperEnv();
    const helperArgs = [this.helperEntryPath];
    if (isQrOnlyCertificationMode()) {
      helperArgs.push(QR_ONLY_CERTIFICATION_PROCESS_MARKER);
    }
    this.appendCollectorLog(
      'helper-start',
      `command=${process.execPath} ${helperArgs.join(' ')} api=${helperEnv.PATROL_HELPER_API_BASE_URL} chrome=${helperEnv.PATROL_HELPER_CHROME_PATH || 'auto'}`,
    );

    const child = spawn(process.execPath, helperArgs, {
      cwd: process.cwd(),
      env: helperEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    this.helperProcess = child;
    this.helperStdout = readline.createInterface({
      input: child.stdout,
      crlfDelay: Infinity,
    });

    this.helperStdout.on('line', (line) => {
      this.handleHelperStdoutLine(line);
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString().trim();
      if (!text) {
        return;
      }
      this.appendCollectorLog('helper-stderr', text);
      if (this.isFatalHelperStderr(text)) {
        this.helperStatus = {
          ...this.helperStatus,
          lastError: text,
        };
      }
    });

    child.on('exit', (code, signal) => {
      this.clearPendingCertificationAuthorization();
      this.stopHelperProcessStreams();
      this.appendCollectorLog('helper-exit', `code=${code} signal=${signal}`);
      this.helperProcess = null;
      if (this.stoppingHelper) {
        this.stoppingHelper = false;
        return;
      }

      if (this.certificationTerminal || this.helperStatus.state === UNEXPECTED_AUTHENTICATION) {
        return;
      }

      this.helperStatus = {
        ...this.helperStatus,
        state: 'failed',
        connectedAccount: null,
        info: 'Patrol monitoring stopped unexpectedly.',
        startupStage: 'Collector stopped',
        lastError: `Helper exited with code ${code ?? 'null'} signal ${signal ?? 'null'}`,
        lastDisconnectAt: new Date().toISOString(),
      };
    });

    await this.sleep(this.startupDelayMs);
    return this.getStatus();
  }

  private buildHelperEnv(): NodeJS.ProcessEnv {
    const port = String(this.configService.get<number>('port') ?? process.env.PORT ?? 3001);
    return {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      PATROL_HELPER_API_BASE_URL: `http://localhost:${port}`,
      PATROL_HELPER_INTERNAL_TOKEN: this.helperInternalToken,
      PATROL_HELPER_SESSION_PATH: this.sessionPath,
      PATROL_HELPER_LOG_PATH: this.collectorLogPath,
      PATROL_HELPER_LATEST_QR_PATH: this.latestQrPath,
      PATROL_HELPER_HEADLESS: this.headless ? 'true' : 'false',
      PATROL_HELPER_ALLOW_FROM_ME: this.allowFromMe ? 'true' : 'false',
      PATROL_HELPER_PILOT_GROUP_NAME: this.pilotGroupName ?? '',
      PATROL_HELPER_PILOT_SITE_CODE: this.pilotSiteCode ?? '',
      PATROL_HELPER_CHROME_PATH: this.configService.get<string>('whatsappChromePath') ?? '',
      WHATSAPP_BROWSER: this.resolveHelperBrowserPreference(),
      PATROL_WHATSAPP_BROWSER: this.resolveHelperBrowserPreference(),
      PATROL_WHATSAPP_WEB_VERSION_MODE:
        process.env.PATROL_WHATSAPP_WEB_VERSION_MODE ??
        process.env.WHATSAPP_WEB_VERSION_MODE ??
        'pinned',
      PATROL_HELPER_BACKFILL_MESSAGE_LIMIT: String(this.configService.get<number>('whatsappBackfillMessageLimit') ?? 150),
      PATROL_HELPER_BROWSER_LAUNCH_GRACE_MS: process.env.PATROL_HELPER_BROWSER_LAUNCH_GRACE_MS ?? '90000',
      PATROL_HELPER_QR_TIMEOUT_MS: process.env.PATROL_HELPER_QR_TIMEOUT_MS ?? '120000',
      PATROL_HELPER_STARTUP_RETRIES: process.env.PATROL_HELPER_STARTUP_RETRIES ?? '2',
    };
  }

  private clearPreviousQrArtifact(): void {
    try {
      if (existsSync(this.latestQrPath)) {
        unlinkSync(this.latestQrPath);
      }
    } catch (error) {
      this.appendCollectorLog(
        'latest-qr-clear-error',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private handleHelperStdoutLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    if (!trimmed.startsWith(WHATSAPP_HELPER_EVENT_PREFIX)) {
      this.appendCollectorLog('helper-stdout', trimmed);
      return;
    }

    const payloadText = trimmed.slice(WHATSAPP_HELPER_EVENT_PREFIX.length);
    try {
      const event = JSON.parse(payloadText) as WhatsAppHelperEvent;
      if (event.type === 'certification-authorization-result') {
        this.certificationAuthorizationState = event.payload.state;
        this.certificationAuthorizationRequested = false;
        if (event.payload.authorized) {
          this.appendCollectorLog('WHATSAPP_CERTIFICATION_AUTHORIZED');
        } else {
          this.appendCollectorLog('WHATSAPP_CERTIFICATION_AUTHORIZATION_REJECTED');
        }
        const pending = this.pendingCertificationAuthorization;
        this.pendingCertificationAuthorization = null;
        if (pending) {
          clearTimeout(pending.timer);
          pending.resolve({
            authorized: event.payload.authorized,
            state: event.payload.state,
          });
        }
        return;
      }
      if (event.type === 'status') {
        if (this.certificationTerminal && event.payload.state !== UNEXPECTED_AUTHENTICATION) {
          this.appendCollectorLog(
            'certification-terminal-status-ignored',
            `state=${event.payload.state}`,
          );
          return;
        }
        const previousQr = this.helperStatus.qrCode;
        const previousConnectedAccount = this.helperStatus.connectedAccount?.trim() || null;
        this.helperStatus = {
          ...event.payload,
          groups: [...event.payload.groups],
          contacts: [...event.payload.contacts],
          browserCandidatesTried: [...event.payload.browserCandidatesTried],
        };
        const qrEligibleStates = new Set([
          'starting',
          'browser-launching',
          'whatsapp-loading',
          'waiting-for-qr',
          'qr-ready',
        ]);
        if (!qrEligibleStates.has(this.helperStatus.state)) {
          this.helperStatus = {
            ...this.helperStatus,
            qrCode: null,
            qrPayloadLength: null,
          };
        }
        if (this.helperStatus.state === UNEXPECTED_AUTHENTICATION) {
          this.certificationTerminal = true;
          this.certificationAuthorizationState = UNEXPECTED_AUTHENTICATION;
          this.clearPendingCertificationAuthorization();
          this.helperStatus = {
            ...this.helperStatus,
            connected: false,
            ready: false,
            connectedAccount: null,
            groups: [],
            contacts: [],
          };
        }
        const nextConnectedAccount = this.helperStatus.connectedAccount?.trim() || null;
        if (nextConnectedAccount && nextConnectedAccount !== previousConnectedAccount) {
          void this.syncLinkedWhatsAppAccount(nextConnectedAccount);
        } else if (this.helperStatus.state === 'ready' && nextConnectedAccount) {
          void this.syncLinkedWhatsAppAccount(nextConnectedAccount);
        }
        if (this.helperStatus.qrCode && this.helperStatus.qrCode !== previousQr) {
          this.appendCollectorLog(
            'qr-pushed-to-backend-state',
            `length=${this.helperStatus.qrPayloadLength ?? this.helperStatus.qrCode.length} path=${this.helperStatus.latestQrPath}`,
          );
        }
      }
    } catch (error) {
      this.appendCollectorLog('helper-event-parse-error', error instanceof Error ? error.message : String(error));
    }
  }

  sendHelperCommand(command: WhatsAppHelperCommand): void {
    if (this.certificationTerminal && command.type !== 'stop') {
      return;
    }
    if (!this.helperProcess || this.helperProcess.stdin.destroyed) {
      return;
    }

    this.helperProcess.stdin.write(`${JSON.stringify(command)}\n`);
  }

  async probeAuthReadyLifecycle(): Promise<WhatsAppCollectorStatus> {
    if (!this.isHelperRunning()) {
      this.helperStatus = {
        ...this.helperStatus,
        info: 'Patrol monitoring helper is not running.',
      };
      return this.getStatus();
    }

    this.sendHelperCommand({ type: 'probe-auth-ready-lifecycle' });
    return this.getStatus();
  }

  async sendTestImage(groupId?: string): Promise<WhatsAppCollectorStatus> {
    if (!this.isHelperRunning() || this.helperStatus.state !== 'ready') {
      this.helperStatus = {
        ...this.helperStatus,
        info: 'Patrol monitoring must be ready before a test image can be sent.',
      };
      return this.getStatus();
    }

    if (isQrOnlyCertificationMode()) {
      this.appendCollectorLog('certification-operational-command-suppressed', 'action=send-test-image');
      return this.getStatus();
    }

    this.sendHelperCommand({ type: 'send-test-image', groupId });
    return this.getStatus();
  }

  private isFatalHelperStderr(text: string): boolean {
    const normalized = text.toLowerCase();
    const nonFatalPatterns = [
      'deprecated_endpoint',
      'dit.whatsapp.net',
      'crashlogs.whatsapp.net',
      'cdn.whatsapp.net',
      'net::err_failed',
      'cors policy',
      'punycode',
      'deprecationwarning',
      'phone_registration_error',
      'devtools listening',
      'tensorflow lite',
      'crashpad',
      'settings version is not 7',
    ];

    return !nonFatalPatterns.some((pattern) => normalized.includes(pattern));
  }

  private async ensureSingleHelperInstance(): Promise<void> {
    if (this.isHelperRunning()) {
      this.appendCollectorLog(
        'EXISTING_HELPER_FOUND',
        `pid=${this.helperProcess?.pid ?? 'unknown'} action=stop-before-restart`,
      );
      await this.stopHelperProcess();
    }

    const mutex = readHelperMutex(this.sessionPath);
    if (mutex && isProcessAlive(mutex.pid)) {
      this.appendCollectorLog(
        'EXISTING_HELPER_FOUND',
        `pid=${mutex.pid} startedAt=${mutex.startedAt} action=terminate-orphan`,
      );
      const owners: BrowserProcessOwner[] = [
        {
          pid: mutex.pid,
          name: 'whatsapp-helper',
          commandLine: `pid=${mutex.pid}`,
        },
      ];
      await terminateBrowserOwners(owners, { forceAfterMs: 3_000 });
    }

    const mutexPath = path.join(this.sessionPath, 'helper.mutex');
    if (existsSync(mutexPath)) {
      try {
        unlinkSync(mutexPath);
      } catch {
        // ignore
      }
    }
  }

  private async stopHelperProcess(): Promise<void> {
    if (!this.helperProcess) {
      return;
    }

    if (this.stopPromise) {
      return this.stopPromise;
    }

    this.stopPromise = new Promise((resolve) => {
      const child = this.helperProcess;
      if (!child) {
        resolve();
        return;
      }

      this.stoppingHelper = true;
      this.sendHelperCommand({ type: 'stop' });

      const killTimeout = setTimeout(() => {
        if (this.helperProcess) {
          this.helperProcess.kill();
        }
      }, this.stopTimeoutMs);

      child.once('exit', () => {
        clearTimeout(killTimeout);
        this.helperProcess = null;
        this.stopHelperProcessStreams();
        this.stoppingHelper = false;
        resolve();
      });
    });

    try {
      await this.stopPromise;
    } finally {
      this.stopPromise = null;
    }
  }

  private stopHelperProcessStreams(): void {
    this.helperStdout?.close();
    this.helperStdout = null;
  }

  private isHelperRunning(): boolean {
    return Boolean(this.helperProcess && this.helperProcess.exitCode === null && !this.helperProcess.killed);
  }

  private assertHelperToken(token: string): void {
    if (!token || token !== this.helperInternalToken) {
      throw new UnauthorizedException('Invalid collector helper token');
    }
  }

  async refreshRuntimeMappingsFromDatabase(): Promise<number> {
    await this.refreshMappedGroupsCount();
    return this.mappedGroupsCount;
  }

  private async refreshMappedGroupsCount(): Promise<void> {
    this.mappedGroupsCount = await this.whatsAppSourceMappingService.countActiveMappingsForIngest(
      this.whatsAppSourceMappingService.resolveActiveLinkedAccountId(this.helperStatus.connectedAccount),
    );
  }

  private async syncLinkedWhatsAppAccount(connectedAccount: string): Promise<void> {
    try {
      const result = await this.whatsAppSourceMappingService.persistLinkedWhatsAppAccount(connectedAccount);
      if (result.changed) {
        this.appendCollectorLog('LINKED_ACCOUNT_SAVED', `account=${result.currentAccountId}`);
        this.appendCollectorLog(
          'whatsapp-linked-account-updated',
          `previous=${result.previousAccountId ?? 'none'} current=${result.currentAccountId}`,
        );
        await this.refreshMappedGroupsCount();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.appendCollectorLog('whatsapp-linked-account-sync-error', message);
    }
  }

  private buildDefaultStatus(overrides?: Partial<WhatsAppHelperStatusSnapshot>): WhatsAppHelperStatusSnapshot {
    return {
      enabled: this.enabled,
      connected: false,
      ready: false,
      state: this.enabled ? 'idle' : 'disabled',
      latestQrPath: this.latestQrPath,
      qrPayloadLength: null,
      qrPersistedAt: null,
      qrDeliveredAt: null,
      info: this.enabled ? 'Patrol monitoring is idle.' : 'Patrol monitoring is disabled.',
      sessionPath: this.sessionPath,
      qrCode: null,
      lastQrAt: null,
      lastMessageAt: null,
      lastEventAt: new Date().toISOString(),
      lastReadyAt: null,
      lastDisconnectAt: null,
      lastBackfillAt: null,
      connectedAccount: null,
      backfillRunning: false,
      backfillMessagesScanned: 0,
      backfillImagesImported: 0,
      backfillDuplicatesSkipped: 0,
      allowFromMe: this.allowFromMe,
      startupStage: this.enabled ? 'Stopped' : 'Disabled',
      startupStartedAt: null,
      lastError: null,
      collectorLogPath: this.collectorLogPath,
      browserExecutablePath: null,
      browserExecutableSource: null,
      browserCandidatesTried: [],
      sessionPathExists: existsSync(this.sessionPath),
      sessionPathWritable: this.canWriteToSessionPath(),
      sessionCorruptionSuspected: false,
      sessionCorruptionMessage: null,
      failureCode: null,
      groups: [],
      contacts: [],
      ...overrides,
    };
  }

  private resolveHelperBrowserPreference(): 'chrome' | 'edge' | 'auto' {
    const configured =
      this.configService.get<string>('whatsappBrowser')?.trim().toLowerCase() ||
      process.env.WHATSAPP_BROWSER?.trim().toLowerCase() ||
      process.env.PATROL_WHATSAPP_BROWSER?.trim().toLowerCase() ||
      '';

    if (configured === 'chrome' || configured === 'edge' || configured === 'auto') {
      return configured;
    }

    const chromePath = this.configService.get<string>('whatsappChromePath')?.trim() || '';
    if (chromePath) {
      // A saved Chrome/Edge path must force that browser family — never fall back to Edge via auto.
      if (/msedge\.exe$/i.test(chromePath)) {
        return 'edge';
      }
      return 'chrome';
    }

    // Packaged default: Chrome. Auto historically preferred Edge and ignored an operator Chrome choice.
    return 'chrome';
  }

  private readCollectorLogTail(maxLines = 80): string[] {
    if (!existsSync(this.collectorLogPath)) {
      return [];
    }

    try {
      return readFileSync(this.collectorLogPath, 'utf8').split(/\r?\n/).filter(Boolean).slice(-maxLines);
    } catch {
      return [];
    }
  }

  private resolveCollectorLogPath(): string {
    const configPath = process.env.DESKTOP_CONFIG_PATH?.trim();
    if (configPath) {
      return path.join(path.dirname(configPath), 'collector-runtime.log');
    }

    return path.join(os.tmpdir(), 'patrol-evidence-platform', 'collector-runtime.log');
  }

  private resolveLatestQrPath(): string {
    const configPath = process.env.DESKTOP_CONFIG_PATH?.trim();
    if (configPath) {
      return path.join(path.dirname(configPath), 'latest-qr.txt');
    }

    return path.join(os.tmpdir(), 'patrol-evidence-platform', 'latest-qr.txt');
  }

  private maybeRequestChatDiscoveryRefresh(): void {
    if (isQrOnlyCertificationMode()) {
      return;
    }
    if (!this.isHelperRunning() || this.helperStatus.state !== 'ready') {
      return;
    }

    if (this.helperStatus.groups.length > 0 || this.helperStatus.contacts.length > 0) {
      return;
    }

    const now = Date.now();
    if (now < this.chatDiscoveryRefreshCooldownUntil) {
      return;
    }

    this.chatDiscoveryRefreshCooldownUntil = now + 10_000;
    this.sendHelperCommand({ type: 'refresh-discovered-chats' });
  }

  private appendCollectorLog(event: string, details?: string): void {
    const safeDetails =
      details && isQrOnlyCertificationMode() ? redactQrOnlyCertificationLog(details) : details;
    const line = `[${new Date().toISOString()}] ${event}${safeDetails ? ` ${safeDetails}` : ''}`;
    try {
      mkdirSync(path.dirname(this.collectorLogPath), { recursive: true });
      appendFileSync(this.collectorLogPath, `${line}\n`, 'utf8');
    } catch (error) {
      this.logger.warn(`Unable to write collector log: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private clearPendingCertificationAuthorization(): void {
    const pending = this.pendingCertificationAuthorization;
    this.pendingCertificationAuthorization = null;
    if (pending) {
      clearTimeout(pending.timer);
      pending.resolve({ authorized: false, state: this.certificationAuthorizationState });
    }
  }

  private canWriteToSessionPath(): boolean {
    try {
      this.ensureSessionDirectoryWritable();
      return true;
    } catch {
      return false;
    }
  }

  private ensureSessionDirectoryWritable(): void {
    mkdirSync(this.sessionPath, { recursive: true });
    const probePath = path.join(this.sessionPath, '.write-test');
    writeFileSync(probePath, 'ok', 'utf8');
    unlinkSync(probePath);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

function isSessionCorruptionSignal(text: string): boolean {
  const normalized = text.toLowerCase();
  return (
    normalized.includes('err_cache_read_failure') ||
    normalized.includes('leveldb') ||
    normalized.includes('indexeddb') ||
    normalized.includes('database corruption') ||
    normalized.includes('corruption') ||
    normalized.includes('localauth.logout') ||
    normalized.includes('ebusy') ||
    normalized.includes('resource busy or locked')
  );
}
