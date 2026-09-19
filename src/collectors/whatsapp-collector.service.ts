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
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as readline from 'readline';
import { CollectorType } from '@/common/enums/collector-type.enum';
import { LicensingService } from '@/licensing/licensing.service';
import { writeDesktopWorkspaceConfigPatch } from '@/desktop/desktop-config.util';
import { WhatsAppSourceMappingService } from '@/patrol-groups/whatsapp-source-mapping.service';
import { IngestPatrolImageEvent, PatrolImageIngestionService } from '@/patrol-images/patrol-image-ingestion.service';
import {
  isProcessAlive,
  isProfileLockErrorMessage,
  readHelperMutex,
  releaseProfileOwnership,
  terminateBrowserOwners,
  type BrowserProcessOwner,
} from './browser-profile-lock.util';
import {
  classifyLinkProfileSafety,
  LINK_RETRY_REQUIRED,
  shouldOfferLinkRetry,
  type WhatsAppLinkProfileSafety,
} from './whatsapp-link-retry.util';
import {
  WhatsAppCollectorContact,
  WhatsAppCollectorGroup,
  WhatsAppHelperCommand,
  WhatsAppHelperEvent,
  WhatsAppHelperIngestPayload,
  WhatsAppHelperRuntimeConfig,
  WhatsAppHelperStatusSnapshot,
  WhatsAppSourceDiscoveryState,
  WhatsAppCertificationLiveIngestionStatus,
  WHATSAPP_HELPER_EVENT_PREFIX,
  WHATSAPP_MONITORING_LISTENER_TIMEOUT,
  WHATSAPP_RUNTIME_CONFIG_UNAVAILABLE,
  WHATSAPP_SESSION_RECOVERY_REQUIRED,
} from './whatsapp-helper.types';
import {
  QR_ONLY_CERTIFICATION_PROCESS_MARKER,
  UNEXPECTED_AUTHENTICATION,
  isQrOnlyCertificationMode,
  redactQrOnlyCertificationLog,
} from './whatsapp-certification-guard';
import {
  isRecoverableWhatsAppNetworkFailure,
  probeWhatsAppWebConnectivity,
  WHATSAPP_NETWORK_FAILURE_CODE,
} from './whatsapp-network-recovery.util';
import type { LicenceEvaluation } from '@patrol/license-core';
import {
  monitoringEntitlementRestriction,
  nextEntitlementRecheckDelayMs,
  type MonitoringEntitlementRestriction,
} from './whatsapp-entitlement-lifecycle.util';

export type { WhatsAppCollectorContact, WhatsAppCollectorGroup } from './whatsapp-helper.types';

export interface WhatsAppCollectorStatus extends Omit<WhatsAppHelperStatusSnapshot, 'groups'> {
  collectorLogTail: string[];
  mappedGroupsCount: number;
  pilotGroupName: string | null;
  certificationState: WhatsAppCertificationAuthorizationResult['state'];
  certificationQrMasked: boolean;
  certificationLiveIngestion: WhatsAppCertificationLiveIngestionStatus;
  monitoringPreference: 'ENABLED' | 'PAUSED';
  monitoringState: 'ACTIVE' | 'PAUSED' | 'NO_GROUPS_CONFIGURED' | 'STARTING' | 'WAITING_FOR_WHATSAPP' | 'WHATSAPP_RELINK_REQUIRED' | 'ERROR' | 'TRIAL_EXPIRED' | 'LICENCE_REQUIRED';
  entitlementRestriction: MonitoringEntitlementRestriction | null;
  entitlementMessage: string | null;
  sourceDiscoveryState: WhatsAppSourceDiscoveryState;
  sourceDiscoveryError: string | null;
  lastSourceDiscoveryAt: string | null;
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
  private monitoringEnabled: boolean;
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
  private readonly monitoringReconciliationTimeoutMs = Math.max(
    1_000,
    Number(process.env.PATROL_HELPER_MONITORING_ACK_TIMEOUT_MS ?? 15_000),
  );
  private authoritativeBackendEndpoint: string | null = null;
  private desktopBackendIdentityVerified = false;
  private deferredDesktopAutoStart = false;
  private entitlementRecheckTimer: NodeJS.Timeout | null = null;
  private entitlementRestriction: MonitoringEntitlementRestriction | null = null;
  private entitlementMessage: string | null = null;
  private entitlementResumeRequired = false;
  private entitlementTransitionCount = 0;

  private helperProcess: ChildProcessWithoutNullStreams | null = null;
  private helperStdout: readline.Interface | null = null;
  private startPromise: Promise<WhatsAppCollectorStatus> | null = null;
  private stopPromise: Promise<void> | null = null;
  private linkRetryCleanupPromise: Promise<void> | null = null;
  private networkRecoveryPromise: Promise<WhatsAppCollectorStatus> | null = null;
  private networkRecoverySequence = 0;
  private automaticNetworkRecoveryAttempts = 0;
  private sessionRecoveryPromise: Promise<WhatsAppCollectorStatus> | null = null;
  private sessionRecoverySequence = 0;
  private automaticSessionRecoveryAttempts = 0;
  private sessionRecoveryStableTimer: NodeJS.Timeout | null = null;
  private readonly maxAutomaticNetworkRecoveryAttempts = 2;
  private readonly maxAutomaticSessionRecoveryAttempts = 2;
  private readonly sessionRecoveryStableMs = 30_000;
  private readonly networkConnectivityCheckAttempts = 4;
  private readonly networkConnectivityCheckDelayMs = 5_000;
  private helperGeneration = 0;
  private activeHelperGeneration = 0;
  private currentGenerationAuthenticationObserved = false;
  private currentGenerationProfileSafety: WhatsAppLinkProfileSafety = 'UNKNOWN';
  private retryingProvenFirstLink = false;
  private linkRetryReleaseVerified = false;
  private mappedGroupsCount = 0;
  private pilotGroupName?: string;
  private pilotSiteCode?: string;
  private stoppingHelper = false;
  private chatDiscoveryRefreshCooldownUntil = 0;
  private certificationTerminal = false;
  private unsubscribeMappingChanges: (() => void) | null = null;
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
  private pendingCertificationGroupLookup:
    | { requestId: string; resolve: (matches: Array<{ name: string; id: string }>) => void; timer: NodeJS.Timeout }
    | null = null;
  private pendingSourceDiscovery:
    | {
        requestId: string;
        promise: Promise<void>;
        resolve: () => void;
        timer: NodeJS.Timeout;
      }
    | null = null;
  private readonly pendingMonitoringReconciliations = new Map<
    string,
    {
      enabled: boolean;
      resolve: () => void;
      reject: (error: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  private sourceDiscoveryState: WhatsAppSourceDiscoveryState = 'NOT_ATTEMPTED';
  private sourceDiscoveryError: string | null = null;
  private lastSourceDiscoveryAt: string | null = null;
  private helperStatus: WhatsAppHelperStatusSnapshot;
  private certificationLiveIngestion: WhatsAppCertificationLiveIngestionStatus = {
    armed: false,
    budgetRemaining: 0,
    approvedSourcePresent: false,
    listenerCount: 0,
    acceptedItemCount: 0,
    rejectedUnapprovedSourceCount: 0,
    rejectedUnsupportedMediaCount: 0,
  };

  constructor(
    private readonly configService: ConfigService,
    private readonly whatsAppSourceMappingService: WhatsAppSourceMappingService,
    private readonly patrolImageIngestionService: PatrolImageIngestionService,
    private readonly licensingService: LicensingService,
  ) {
    this.enabled = configService.get<boolean>('whatsappEnabled') ?? false;
    this.autoStart = configService.get<boolean>('whatsappAutoStart') ?? false;
    this.monitoringEnabled = this.autoStart;
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
    this.unsubscribeMappingChanges = this.whatsAppSourceMappingService.subscribeToMappingChanges(() => {
      void this.reconcileProductionMonitoring('mapping-change').catch((error) => {
        this.appendCollectorLog('production-monitoring-reconcile-failed', `reason=mapping-change error=${error instanceof Error ? error.message : String(error)}`);
      });
    });
    if (!this.enabled) {
      this.logger.log('WHATSAPP_AUTOSTART_SKIPPED reason=collector-disabled');
      this.appendCollectorLog('auto-start-skipped', 'collector-disabled');
      return;
    }

    await this.refreshMappedGroupsCount();
    if (!this.whatsAppSourceMappingService.getConfiguredLinkedAccountId()) {
      this.logger.log('WHATSAPP_AUTOSTART_SKIPPED reason=no-linked-account');
      this.appendCollectorLog('auto-start-skipped', 'no-linked-account');
      return;
    }
    if (this.mappedGroupsCount === 0) {
      this.logger.log('WHATSAPP_AUTOSTART_IDLE reason=no-active-mappings');
      this.appendCollectorLog('auto-start-idle', 'no-active-mappings; reconnect-without-listeners');
    }
    if (this.isSessionProfileEmpty()) {
      this.logger.log('WHATSAPP_AUTOSTART_SKIPPED reason=no-saved-session');
      this.appendCollectorLog('auto-start-skipped', 'no-saved-session');
      return;
    }

    if (this.monitoringEnabled) {
      this.logger.log('WHATSAPP_AUTOSTART_ENABLED');
      this.appendCollectorLog('auto-start-enabled', 'startPatrolMonitoringAfterLaunch=true');
    } else {
      this.logger.log('WHATSAPP_SESSION_AUTORECONNECT monitoring=paused');
      this.appendCollectorLog('session-auto-reconnect', 'monitoring=paused listeners=disabled');
    }

    if (this.isPackagedDesktopRuntime()) {
      this.deferredDesktopAutoStart = true;
      this.appendCollectorLog('auto-start-deferred', 'awaiting-authoritative-endpoint-and-desktop-identity');
      return;
    }

    void this.start().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Patrol monitoring auto-start failed: ${message}`);
      this.appendCollectorLog('auto-start-failed', message);
    });
  }

  async onModuleDestroy(): Promise<void> {
    this.clearEntitlementRecheckTimer();
    this.unsubscribeMappingChanges?.();
    this.unsubscribeMappingChanges = null;
    const activeRecovery = this.networkRecoveryPromise;
    const activeSessionRecovery = this.sessionRecoveryPromise;
    this.cancelNetworkRecovery();
    this.cancelSessionRecovery();
    await activeRecovery?.catch(() => undefined);
    await activeSessionRecovery?.catch(() => undefined);
    this.rejectPendingMonitoringReconciliations('Patrol monitoring stopped before listener reconciliation completed.');
    await this.stopHelperProcess();
  }

  registerAuthoritativeBackendEndpoint(host: string, port: number): void {
    if (host !== '127.0.0.1' || !Number.isInteger(port) || port < 1 || port > 65_535) {
      throw new Error('Packaged WhatsApp helper requires a resolved loopback backend endpoint.');
    }
    this.authoritativeBackendEndpoint = `http://${host}:${port}`;
    this.appendCollectorLog('authoritative-backend-endpoint-registered', `host=${host} port=${port}`);
  }

  confirmDesktopBackendIdentityVerified(): { ready: true } {
    if (this.isPackagedDesktopRuntime() && !this.authoritativeBackendEndpoint) {
      throw new Error('Packaged backend endpoint is unavailable after identity verification.');
    }
    this.desktopBackendIdentityVerified = true;
    this.appendCollectorLog('desktop-backend-identity-confirmed');
    if (this.deferredDesktopAutoStart) {
      this.deferredDesktopAutoStart = false;
      void this.start().catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Patrol monitoring deferred auto-start failed: ${message}`);
        this.appendCollectorLog('auto-start-failed', message);
      });
    }
    return { ready: true };
  }

  async getStatus(): Promise<WhatsAppCollectorStatus> {
    if (this.entitlementRestriction) {
      const currentEntitlement = this.licensingService.getEntitlementEvaluation();
      if (!monitoringEntitlementRestriction(currentEntitlement)) {
        this.clearEntitlementRestriction(true);
      }
    }
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
      certificationLiveIngestion: { ...this.certificationLiveIngestion },
      monitoringPreference: this.monitoringEnabled ? 'ENABLED' : 'PAUSED',
      monitoringState: this.resolveMonitoringState(),
      entitlementRestriction: this.entitlementRestriction,
      entitlementMessage: this.entitlementMessage,
      sourceDiscoveryState: this.sourceDiscoveryState,
      sourceDiscoveryError: this.sourceDiscoveryError,
      lastSourceDiscoveryAt: this.lastSourceDiscoveryAt,
    };
  }

  async enableMonitoring(): Promise<WhatsAppCollectorStatus> {
    if (isQrOnlyCertificationMode()) {
      throw new BadRequestException('Production monitoring is unavailable in certification mode.');
    }
    const entitlement = this.assertEntitlementForLicensedAction();
    await this.refreshMappedGroupsCount();
    if (!this.whatsAppSourceMappingService.getConfiguredLinkedAccountId()) {
      throw new BadRequestException('Connect WhatsApp before starting monitoring.');
    }
    if (this.mappedGroupsCount === 0) {
      throw new BadRequestException('Add at least one active WhatsApp group mapping before starting monitoring.');
    }
    this.monitoringEnabled = true;
    this.entitlementResumeRequired = false;
    this.scheduleEntitlementRecheck(entitlement);
    writeDesktopWorkspaceConfigPatch({ autoStartCollector: true });
    this.appendCollectorLog('production-monitoring-enabled', `mappings=${this.mappedGroupsCount}`);
    if (!this.isHelperRunning()) {
      return this.start();
    }
    await this.reconcileProductionMonitoring('customer-enable');
    return this.getStatus();
  }

  async pauseMonitoring(): Promise<WhatsAppCollectorStatus> {
    if (isQrOnlyCertificationMode()) {
      throw new BadRequestException('Production monitoring is unavailable in certification mode.');
    }
    this.monitoringEnabled = false;
    this.clearEntitlementRecheckTimer();
    writeDesktopWorkspaceConfigPatch({ autoStartCollector: false });
    this.appendCollectorLog('production-monitoring-paused');
    if (this.isHelperRunning()) {
      this.sendHelperCommand({ type: 'set-production-monitoring', enabled: false });
    }
    return this.getStatus();
  }

  async armCertificationLiveIngestion(
    sourceExternalId: string,
    targetSiteId: string,
  ): Promise<WhatsAppCollectorStatus> {
    if (!isQrOnlyCertificationMode() || this.certificationAuthorizationState !== 'AUTHENTICATION_AUTHORIZED') {
      throw new BadRequestException('Certification live ingestion requires both certification factors.');
    }
    if (!this.isHelperRunning() || this.helperStatus.state !== 'ready' || !this.helperStatus.connectedAccount) {
      throw new BadRequestException('An authenticated, ready certification helper session is required.');
    }
    const connectedAccount = this.helperStatus.connectedAccount.trim();
    const linkedAccountId = this.whatsAppSourceMappingService.resolveActiveLinkedAccountId(connectedAccount);
    const requestedSource = sourceExternalId.trim();
    const requestedSiteId = targetSiteId.trim();
    if (!linkedAccountId || linkedAccountId !== connectedAccount || !requestedSource || !requestedSiteId) {
      throw new BadRequestException(
        'Exactly one active account-scoped source/site certification mapping is required.',
      );
    }
    const matchingMappings = await this.whatsAppSourceMappingService.findActiveCertificationMappings(
      linkedAccountId,
      requestedSource,
      requestedSiteId,
    );
    if (matchingMappings.length !== 1) {
      throw new BadRequestException(
        'Exactly one active account-scoped source/site certification mapping is required.',
      );
    }
    const mapping = matchingMappings[0];
    const generationId = randomUUID();
    this.sendHelperCommand({
      type: 'arm-certification-live-ingestion',
      linkedAccountId: linkedAccountId as string,
      sourceExternalId: requestedSource,
      mappedGroupId: mapping.id,
      siteCode: mapping.site.siteCode,
      generationId,
    });
    return this.getStatus();
  }

  async disarmCertificationLiveIngestion(): Promise<WhatsAppCollectorStatus> {
    if (!isQrOnlyCertificationMode()) {
      throw new BadRequestException('Certification live ingestion is unavailable outside certification mode.');
    }
    this.sendHelperCommand({ type: 'disarm-certification-live-ingestion' });
    this.certificationLiveIngestion = { ...this.certificationLiveIngestion, armed: false, budgetRemaining: 0, listenerCount: 0 };
    return this.getStatus();
  }

  async listGroups(): Promise<WhatsAppCollectorGroup[]> {
    return [...this.helperStatus.groups].sort((left, right) => left.name.localeCompare(right.name));
  }

  async lookupCertificationGroup(displayName: string): Promise<{ displayName: string; matches: Array<{ name: string; id: string }> }> {
    if (!isQrOnlyCertificationMode() || this.certificationAuthorizationState !== 'AUTHENTICATION_AUTHORIZED' || !this.isHelperRunning() || this.helperStatus.state !== 'ready') {
      throw new BadRequestException('An authorized certification helper session is required.');
    }
    const requested = displayName.trim();
    if (!requested) throw new BadRequestException('displayName is required.');
    const requestId = randomUUID();
    const result = new Promise<Array<{ name: string; id: string }>>((resolve) => {
      const timer = setTimeout(() => { this.pendingCertificationGroupLookup = null; resolve([]); }, 10_000);
      this.pendingCertificationGroupLookup = { requestId, resolve, timer };
    });
    this.sendHelperCommand({ type: 'certification-group-lookup', displayName: requested, requestId });
    return { displayName: requested, matches: await result };
  }

  async listContacts(): Promise<WhatsAppCollectorContact[]> {
    return [...this.helperStatus.contacts].sort((left, right) => left.name.localeCompare(right.name));
  }

  async refreshDiscoveredChats(): Promise<WhatsAppCollectorStatus> {
    if (!this.isHelperRunning()) {
      throw new BadRequestException('Connect WhatsApp before refreshing sources.');
    }

    if (isQrOnlyCertificationMode()) {
      this.appendCollectorLog('certification-operational-command-suppressed', 'action=refresh-discovered-chats');
      return this.getStatus();
    }

    if (this.helperStatus.state !== 'ready' || !this.helperStatus.connectedAccount?.trim()) {
      throw new BadRequestException('WhatsApp must be connected and ready before sources can be refreshed.');
    }

    if (this.pendingSourceDiscovery) {
      await this.pendingSourceDiscovery.promise;
      return this.getStatus();
    }

    this.sourceDiscoveryState = 'LOADING';
    this.sourceDiscoveryError = null;
    const requestId = randomUUID();
    let resolvePending!: () => void;
    const promise = new Promise<void>((resolve) => {
      resolvePending = resolve;
    });
    const timer = setTimeout(() => {
      if (this.pendingSourceDiscovery?.requestId !== requestId) {
        return;
      }
      this.pendingSourceDiscovery = null;
      this.sourceDiscoveryState = 'ERROR';
      this.sourceDiscoveryError = 'WhatsApp sources did not respond in time. Try again.';
      this.lastSourceDiscoveryAt = new Date().toISOString();
      resolvePending();
    }, 20_000);
    this.pendingSourceDiscovery = { requestId, promise, resolve: resolvePending, timer };
    this.sendHelperCommand({ type: 'refresh-discovered-chats', requestId });
    await promise;
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

    this.assertPackagedHelperEndpointReady();

    if (this.helperStatus.state === LINK_RETRY_REQUIRED) {
      throw new BadRequestException('Use Try Again to retry this WhatsApp linking session.');
    }

    const entitlement = this.assertEntitlementForLicensedAction();
    if (this.monitoringEnabled) {
      this.scheduleEntitlementRecheck(entitlement);
    }

    if (this.networkRecoveryPromise) {
      return this.networkRecoveryPromise;
    }

    if (this.sessionRecoveryPromise) {
      return this.sessionRecoveryPromise;
    }

    if (isRecoverableWhatsAppNetworkFailure(this.helperStatus)) {
      return this.beginNetworkRecovery('customer-retry', true);
    }

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
    const activeRecovery = this.networkRecoveryPromise;
    const activeSessionRecovery = this.sessionRecoveryPromise;
    this.cancelNetworkRecovery();
    this.cancelSessionRecovery();
    await activeRecovery?.catch(() => undefined);
    await activeSessionRecovery?.catch(() => undefined);
    if (this.linkRetryCleanupPromise) {
      await this.linkRetryCleanupPromise;
    }
    await this.stopHelperProcess();
    if (this.pendingCertificationGroupLookup) {
      clearTimeout(this.pendingCertificationGroupLookup.timer);
      this.pendingCertificationGroupLookup.resolve([]);
      this.pendingCertificationGroupLookup = null;
    }
    this.resetSourceDiscoveryState();
    this.certificationTerminal = false;
    this.clearPendingCertificationAuthorization();
    this.certificationAuthorizationRequested = false;
    this.certificationAuthorizationState = isQrOnlyCertificationMode() ? 'EXPECTING_QR_ONLY' : 'DISABLED';
    this.linkRetryReleaseVerified = false;
    this.retryingProvenFirstLink = false;
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

  async retryLink(): Promise<WhatsAppCollectorStatus> {
    if (this.helperStatus.state !== LINK_RETRY_REQUIRED) {
      throw new BadRequestException('Try Again is available only after a recoverable WhatsApp linking failure.');
    }
    if (
      !this.linkRetryReleaseVerified ||
      this.linkRetryCleanupPromise ||
      this.isHelperRunning() ||
      this.currentGenerationProfileSafety !== 'NEVER_AUTHENTICATED_FIRST_LINK'
    ) {
      throw new BadRequestException('The previous WhatsApp linking attempt has not released safely yet.');
    }

    this.appendCollectorLog(
      'link-retry-requested',
      `previousGeneration=${this.activeHelperGeneration} profileSafety=${this.currentGenerationProfileSafety}`,
    );
    this.retryingProvenFirstLink = true;
    this.linkRetryReleaseVerified = false;
    this.helperStatus = this.buildDefaultStatus({
      state: 'idle',
      info: 'Trying WhatsApp again…',
      startupStage: 'Retrying WhatsApp link',
      lastError: null,
      failureCode: null,
      qrCode: null,
      qrPayloadLength: null,
      connectedAccount: null,
      groups: [],
      contacts: [],
    });
    return this.start();
  }

  async authorizeCertificationAuthentication(): Promise<WhatsAppCertificationAuthorizationResult> {
    if (!isQrOnlyCertificationMode()) {
      throw new NotFoundException('WhatsApp certification authorization is unavailable.');
    }
    if (
      this.certificationTerminal ||
      this.certificationAuthorizationState === UNEXPECTED_AUTHENTICATION ||
      this.helperStatus.state === UNEXPECTED_AUTHENTICATION ||
      this.helperStatus.state === 'RELINK_REQUIRED'
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
    this.cancelSessionRecovery();
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
   * Explicitly replace a terminal failed reconnect profile. The old profile is
   * archived first and is never deleted or reused by this action.
   */
  async relinkWhatsApp(): Promise<WhatsAppCollectorStatus> {
    if (this.helperStatus.state !== 'RELINK_REQUIRED') {
      throw new BadRequestException('WhatsApp relink is available only after a failed reconnect session.');
    }

    this.cancelSessionRecovery();
    const archiveResult = await this.archiveCurrentSessionForFreshLink('explicit-relink');
    if (!archiveResult.ok) {
      this.helperStatus = this.buildDefaultStatus({
        state: 'failed',
        info: 'Could not prepare WhatsApp for relinking. Your existing session data was preserved.',
        startupStage: 'Relink preparation failed',
        lastError: archiveResult.error,
        sessionCorruptionSuspected: true,
        sessionCorruptionMessage: 'Existing WhatsApp session was preserved; relink preparation failed.',
      });
      return this.getStatus();
    }

    this.certificationTerminal = false;
    this.clearPendingCertificationAuthorization();
    this.certificationAuthorizationRequested = false;
    this.certificationAuthorizationState = isQrOnlyCertificationMode() ? 'EXPECTING_QR_ONLY' : 'DISABLED';
    this.helperStatus = this.buildDefaultStatus({
      state: 'idle',
      info: 'Expired WhatsApp session archived. Starting a fresh relink QR flow…',
      startupStage: 'Fresh relink profile',
      lastError: null,
      sessionCorruptionSuspected: false,
      sessionCorruptionMessage: null,
      connectedAccount: null,
      groups: [],
      contacts: [],
    });
    this.appendCollectorLog('explicit-relink-prepared', `archivePath=${archiveResult.archivePath}`);

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

    this.cancelSessionRecovery();
    const archiveResult = await this.archiveCurrentSessionForFreshLink('fresh-profile');
    if (!archiveResult.ok) {
      this.helperStatus = this.buildDefaultStatus({
        state: 'failed',
        info: 'Could not prepare a fresh WhatsApp profile. Your existing session data was preserved.',
        startupStage: 'Fresh profile preparation failed',
        lastError: archiveResult.error,
      });
      return this.getStatus();
    }

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

  private async archiveCurrentSessionForFreshLink(action: string): Promise<
    | { ok: true; archivePath: string }
    | { ok: false; error: string }
  > {
    const profileDir = path.join(this.sessionPath, 'session-patrol-evidence-platform');
    await this.stopHelperProcess();
    try {
      await releaseProfileOwnership(profileDir, (event, details) => {
        this.appendCollectorLog(event, details);
      }, { timeoutMs: 30_000, forceAfterMs: 5_000 });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.appendCollectorLog('fresh-profile-archive-failed', message);
      return { ok: false, error: message };
    }

    if (!existsSync(this.sessionPath)) {
      mkdirSync(this.sessionPath, { recursive: true });
      this.appendCollectorLog('fresh-profile-created', `sessionPath=${this.sessionPath} reason=${action}`);
      return { ok: true, archivePath: 'none-existing' };
    }

    const archiveRoot = path.resolve(path.dirname(this.sessionPath), 'whatsapp-session-archive');
    const archivePath = path.join(
      archiveRoot,
      `${path.basename(this.sessionPath)}-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`,
    );
    try {
      mkdirSync(archiveRoot, { recursive: true });
      const managedRoot = path.resolve(path.dirname(this.sessionPath));
      if (!archivePath.startsWith(`${managedRoot}${path.sep}`)) {
        throw new Error('Archive destination escaped the managed WhatsApp data root.');
      }
      renameSync(this.sessionPath, archivePath);
      mkdirSync(this.sessionPath, { recursive: true });
      if (readdirSync(this.sessionPath).length !== 0) {
        throw new Error('Fresh WhatsApp session root was not empty after archival.');
      }
      const archiveSummary = this.summarizeDirectory(archivePath);
      this.appendCollectorLog(
        'fresh-profile-archived',
        `from=${this.sessionPath} to=${archivePath} action=${action} files=${archiveSummary.files} directories=${archiveSummary.directories} bytes=${archiveSummary.bytes}`,
      );
      this.appendCollectorLog('fresh-profile-created', `sessionPath=${this.sessionPath} reason=${action} entries=0 candidate=false`);
      return { ok: true, archivePath };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.appendCollectorLog('fresh-profile-archive-failed', message);
      return { ok: false, error: message };
    }
  }

  private summarizeDirectory(root: string): { files: number; directories: number; bytes: number } {
    let files = 0;
    let directories = 0;
    let bytes = 0;
    const visit = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          directories += 1;
          visit(entryPath);
        } else if (entry.isFile()) {
          files += 1;
          bytes += statSync(entryPath).size;
        }
      }
    };
    visit(root);
    return { files, directories, bytes };
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
    const linkedAccountId =
      this.helperStatus.connectedAccount?.trim() ||
      this.whatsAppSourceMappingService.getConfiguredLinkedAccountId();
    const activeMappings = await this.whatsAppSourceMappingService.toRuntimeMappings(linkedAccountId);

    return {
      monitoringEnabled:
        this.monitoringEnabled &&
        this.entitlementRestriction === null &&
        !this.entitlementResumeRequired &&
        activeMappings.length > 0,
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
    this.assertEntitlementForHelperIngest();
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
        linkedAccountId: linkedAccountId ?? undefined,
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

    if (!Number.isFinite(payload.fileSize) || payload.fileSize <= 0 || payload.fileSize > 25 * 1024 * 1024) {
      throw new BadRequestException('Evidence image exceeds the 25MB limit or has an invalid size');
    }
    if (Buffer.byteLength(payload.fileBase64, 'utf8') > 36 * 1024 * 1024) {
      throw new BadRequestException('Evidence image payload exceeds the encoded size limit');
    }

    const normalized: IngestPatrolImageEvent = {
      collectorType: CollectorType.WHATSAPP,
      siteCode: payload.siteCode,
      timestamp: payload.timestamp,
      groupId: payload.groupId,
      senderName: payload.senderName,
      senderNumber: payload.senderNumber,
      senderExternalId: payload.senderExternalId,
      messageExternalId: payload.messageExternalId,
      linkedAccountId: payload.linkedAccountId,
      originalFileName: payload.originalFileName,
      mimeType: payload.mimeType,
      fileSize: payload.fileSize,
      fileBuffer: Buffer.from(payload.fileBase64, 'base64'),
    };

    const existingBefore = payload.messageExternalId
      ? payload.linkedAccountId
        ? await this.patrolImageIngestionService.findExistingByIdentity(payload.linkedAccountId, payload.messageExternalId)
        : await this.patrolImageIngestionService.findExistingByExternalMessageId(payload.messageExternalId)
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
    this.resetSourceDiscoveryState();
    const profileWasEmptyBeforeLaunch = this.isSessionProfileEmpty();
    this.currentGenerationProfileSafety = classifyLinkProfileSafety({
      configuredLinkedAccountId: this.whatsAppSourceMappingService.getConfiguredLinkedAccountId(),
      profileWasEmptyBeforeLaunch,
      retryingProvenFirstLink: this.retryingProvenFirstLink,
    });
    this.retryingProvenFirstLink = false;
    this.currentGenerationAuthenticationObserved = false;
    this.linkRetryReleaseVerified = false;
    this.activeHelperGeneration = ++this.helperGeneration;
    const generation = this.activeHelperGeneration;
    this.appendCollectorLog(
      'helper-generation-prepared',
      `generation=${generation} profileSafety=${this.currentGenerationProfileSafety} profileWasEmpty=${profileWasEmptyBeforeLaunch}`,
    );
    this.clearPendingCertificationAuthorization();
    this.certificationAuthorizationRequested = false;
    this.certificationAuthorizationState = isQrOnlyCertificationMode() ? 'EXPECTING_QR_ONLY' : 'DISABLED';
    this.certificationLiveIngestion = {
      armed: false,
      budgetRemaining: 0,
      approvedSourcePresent: false,
      listenerCount: 0,
      acceptedItemCount: 0,
      rejectedUnapprovedSourceCount: 0,
      rejectedUnsupportedMediaCount: 0,
    };
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
      this.handleHelperStdoutLine(line, generation);
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
      this.appendCollectorLog('helper-exit', `generation=${generation} code=${code} signal=${signal}`);
      if (generation !== this.activeHelperGeneration) {
        this.appendCollectorLog(
          'stale-helper-exit-ignored',
          `generation=${generation} activeGeneration=${this.activeHelperGeneration}`,
        );
        return;
      }

      this.clearPendingCertificationAuthorization();
      this.stopHelperProcessStreams();
      if (this.helperProcess === child) {
        this.helperProcess = null;
      }
      this.failPendingSourceDiscovery('WhatsApp disconnected before sources could be loaded. Try again.');
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
      this.maybeBeginLinkRetryCleanup(this.helperStatus, generation);
    });

    await this.sleep(this.startupDelayMs);
    return this.getStatus();
  }

  private buildHelperEnv(): NodeJS.ProcessEnv {
    const apiBaseUrl = this.resolveHelperApiBaseUrl();
    return {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      PATROL_HELPER_API_BASE_URL: apiBaseUrl,
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
        'live',
      PATROL_HELPER_BACKFILL_MESSAGE_LIMIT: String(this.configService.get<number>('whatsappBackfillMessageLimit') ?? 150),
      PATROL_HELPER_BROWSER_LAUNCH_GRACE_MS: process.env.PATROL_HELPER_BROWSER_LAUNCH_GRACE_MS ?? '90000',
      PATROL_HELPER_QR_TIMEOUT_MS: process.env.PATROL_HELPER_QR_TIMEOUT_MS ?? '120000',
      PATROL_HELPER_STARTUP_RETRIES: process.env.PATROL_HELPER_STARTUP_RETRIES ?? '2',
      PATROL_HELPER_FIRST_LINK_ATTEMPT:
        this.currentGenerationProfileSafety === 'NEVER_AUTHENTICATED_FIRST_LINK' ? 'true' : 'false',
    };
  }

  private isPackagedDesktopRuntime(): boolean {
    return process.env.PATROL_DESKTOP_PACKAGED === 'true' && Boolean(process.env.DESKTOP_CONFIG_PATH?.trim());
  }

  private assertPackagedHelperEndpointReady(): void {
    if (!this.isPackagedDesktopRuntime()) {
      return;
    }
    if (!this.authoritativeBackendEndpoint || !this.desktopBackendIdentityVerified) {
      throw new Error('PatrolSafe local service is not yet securely ready for WhatsApp.');
    }
  }

  private resolveHelperApiBaseUrl(): string {
    if (this.isPackagedDesktopRuntime()) {
      this.assertPackagedHelperEndpointReady();
      return this.authoritativeBackendEndpoint as string;
    }
    const port = Number(
      process.env.PATROLSAFE_BOUND_BACKEND_PORT ??
      this.configService.get<number>('port') ??
      process.env.PORT ??
      3001,
    );
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      throw new Error('WhatsApp helper API endpoint is unresolved.');
    }
    return `http://127.0.0.1:${port}`;
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

  private handleHelperStdoutLine(line: string, generation = this.activeHelperGeneration): void {
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
      if (generation !== this.activeHelperGeneration) {
        this.appendCollectorLog(
          'stale-helper-event-ignored',
          `generation=${generation} activeGeneration=${this.activeHelperGeneration} type=${event.type}`,
        );
        return;
      }
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
      if (event.type === 'certification-group-lookup-result') {
        const pending = this.pendingCertificationGroupLookup;
        if (pending && event.payload.requestId !== pending.requestId) {
          this.appendCollectorLog('certification-group-lookup-stale-result-ignored');
          return;
        }
        this.pendingCertificationGroupLookup = null;
        if (pending) { clearTimeout(pending.timer); pending.resolve(event.payload.matches); }
        return;
      }
      if (event.type === 'source-discovery-result') {
        const pending = this.pendingSourceDiscovery;
        if (pending && event.payload.requestId && event.payload.requestId !== pending.requestId) {
          this.appendCollectorLog('source-discovery-stale-result-ignored');
          return;
        }
        this.helperStatus = {
          ...this.helperStatus,
          groups: [...event.payload.groups],
          contacts: [...event.payload.contacts],
        };
        this.sourceDiscoveryState = event.payload.state;
        this.sourceDiscoveryError = event.payload.error;
        this.lastSourceDiscoveryAt = event.payload.completedAt;
        if (pending && event.payload.requestId === pending.requestId) {
          clearTimeout(pending.timer);
          this.pendingSourceDiscovery = null;
          pending.resolve();
        }
        return;
      }
      if (event.type === 'certification-live-ingestion-status') {
        this.certificationLiveIngestion = { ...event.payload };
        return;
      }
      if (event.type === 'production-monitoring-result') {
        const pending = this.pendingMonitoringReconciliations.get(event.payload.requestId);
        if (!pending) {
          this.appendCollectorLog('production-monitoring-stale-result-ignored', `requestId=${event.payload.requestId}`);
          return;
        }
        clearTimeout(pending.timer);
        this.pendingMonitoringReconciliations.delete(event.payload.requestId);
        this.helperStatus = {
          ...this.helperStatus,
          productionListenerCount: event.payload.productionListenerCount,
        };
        if (!event.payload.ok) {
          const failureCode = event.payload.errorCode ?? 'WHATSAPP_MONITORING_RECONCILIATION_FAILED';
          this.helperStatus = {
            ...this.helperStatus,
            failureCode,
            info:
              failureCode === WHATSAPP_RUNTIME_CONFIG_UNAVAILABLE
                ? 'WhatsApp connected, but monitoring configuration could not be loaded. Try again.'
                : 'WhatsApp connected, but monitoring listeners could not be started. Try again or contact support.',
            lastError: 'Patrol monitoring reconciliation did not complete.',
          };
          pending.reject(new Error(failureCode));
          return;
        }
        if (
          this.helperStatus.failureCode === WHATSAPP_RUNTIME_CONFIG_UNAVAILABLE ||
          this.helperStatus.failureCode === WHATSAPP_MONITORING_LISTENER_TIMEOUT ||
          this.helperStatus.failureCode === 'WHATSAPP_MONITORING_RECONCILIATION_FAILED'
        ) {
          this.helperStatus = {
            ...this.helperStatus,
            failureCode: null,
            lastError: null,
            info: event.payload.effective
              ? 'WhatsApp connected. Patrol monitoring is active.'
              : 'WhatsApp connected. Patrol monitoring is paused.',
          };
        }
        pending.resolve();
        return;
      }
      if (event.type === 'status') {
        if (this.certificationTerminal && event.payload.state !== UNEXPECTED_AUTHENTICATION && event.payload.state !== 'RELINK_REQUIRED') {
          this.appendCollectorLog(
            'certification-terminal-status-ignored',
            `state=${event.payload.state}`,
          );
          return;
        }
        const previousQr = this.helperStatus.qrCode;
        const previousState = this.helperStatus.state;
        const previousConnectedAccount = this.helperStatus.connectedAccount?.trim() || null;
        this.helperStatus = {
          ...event.payload,
          groups: [...event.payload.groups],
          contacts: [...event.payload.contacts],
          browserCandidatesTried: [...event.payload.browserCandidatesTried],
        };
        if (this.entitlementResumeRequired && event.payload.productionListenerCount > 0) {
          this.helperStatus = {
            ...this.helperStatus,
            productionListenerCount: 0,
            info: this.entitlementMessage ?? 'Monitoring requires an active PatrolSafe licence.',
          };
          this.sendHelperCommand({ type: 'set-production-monitoring', enabled: false });
        }
        if (
          this.helperStatus.state === 'RECONNECT_AUTHORIZATION_PENDING' ||
          this.helperStatus.state === 'authenticated' ||
          this.helperStatus.state === 'waiting-for-client-info' ||
          this.helperStatus.state === 'ready' ||
          Boolean(this.helperStatus.connectedAccount?.trim())
        ) {
          this.currentGenerationProfileSafety = 'EXISTING_SESSION_PROTECTED';
        }
        if (
          this.helperStatus.state === 'authenticated' ||
          this.helperStatus.state === 'waiting-for-client-info' ||
          this.helperStatus.state === 'ready' ||
          Boolean(this.helperStatus.connectedAccount?.trim())
        ) {
          this.currentGenerationAuthenticationObserved = true;
        }
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
        if (this.helperStatus.state === 'RELINK_REQUIRED') {
          this.certificationTerminal = true;
          this.clearPendingCertificationAuthorization();
          this.helperStatus = {
            ...this.helperStatus,
            connected: false,
            ready: false,
            connectedAccount: null,
            groups: [],
            contacts: [],
            qrCode: null,
            qrPayloadLength: null,
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
        if (previousState !== 'ready' && this.helperStatus.state === 'ready') {
          this.automaticNetworkRecoveryAttempts = 0;
          this.markSessionRecoveryStableAfterDelay(generation);
          this.maybeRequestChatDiscoveryRefresh();
          void this.reconcileProductionMonitoring('network-or-session-ready').catch((error) => {
            this.appendCollectorLog('production-monitoring-reconcile-failed', `reason=network-or-session-ready error=${error instanceof Error ? error.message : String(error)}`);
          });
        }
        this.maybeBeginSessionRecovery(this.helperStatus, generation);
        this.maybeBeginNetworkRecovery(this.helperStatus, generation);
        this.maybeBeginLinkRetryCleanup(this.helperStatus, generation);
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

  private isSessionProfileEmpty(): boolean {
    const profileDir = path.join(this.sessionPath, 'session-patrol-evidence-platform');
    if (!existsSync(profileDir)) {
      return true;
    }
    try {
      return readdirSync(profileDir).length === 0;
    } catch {
      return false;
    }
  }

  private maybeBeginSessionRecovery(status: WhatsAppHelperStatusSnapshot, generation: number): void {
    if (
      this.entitlementRestriction !== null ||
      this.entitlementResumeRequired ||
      isQrOnlyCertificationMode() ||
      generation !== this.activeHelperGeneration ||
      this.sessionRecoveryPromise ||
      this.networkRecoveryPromise ||
      status.failureCode !== WHATSAPP_SESSION_RECOVERY_REQUIRED ||
      status.state !== 'disconnected' ||
      this.currentGenerationProfileSafety !== 'EXISTING_SESSION_PROTECTED' ||
      !this.whatsAppSourceMappingService.getConfiguredLinkedAccountId() ||
      this.isSessionProfileEmpty()
    ) {
      return;
    }

    this.clearSessionRecoveryStableTimer();
    if (this.automaticSessionRecoveryAttempts >= this.maxAutomaticSessionRecoveryAttempts) {
      void this.beginSessionRelinkRequired(generation);
      return;
    }

    this.automaticSessionRecoveryAttempts += 1;
    const recoverySequence = ++this.sessionRecoverySequence;
    const recovery = this.runSessionRecovery(recoverySequence, generation).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      this.certificationTerminal = true;
      this.helperStatus = this.buildDefaultStatus({
        state: 'RELINK_REQUIRED',
        connected: false,
        ready: false,
        productionListenerCount: 0,
        failureCode: 'WHATSAPP_RELINK_REQUIRED',
        startupStage: 'WhatsApp relink required',
        info: 'WhatsApp needs to be relinked. Your sites, mappings, schedules and evidence are preserved.',
        lastError: 'Safe WhatsApp session recovery could not complete.',
        qrCode: null,
        connectedAccount: null,
        groups: [],
        contacts: [],
      });
      this.appendCollectorLog(
        'session-recovery-failed-closed',
        `failedGeneration=${generation} recoverySequence=${recoverySequence} error=${message}`,
      );
      return this.getStatus();
    });
    const trackedRecovery = recovery.finally(() => {
      if (this.sessionRecoveryPromise === trackedRecovery) {
        this.sessionRecoveryPromise = null;
      }
    });
    this.sessionRecoveryPromise = trackedRecovery;
  }

  private async runSessionRecovery(
    recoverySequence: number,
    failedGeneration: number,
  ): Promise<WhatsAppCollectorStatus> {
    const profileDir = path.join(this.sessionPath, 'session-patrol-evidence-platform');
    this.helperStatus = {
      ...this.helperStatus,
      state: 'reconnecting',
      connected: false,
      ready: false,
      productionListenerCount: 0,
      failureCode: WHATSAPP_SESSION_RECOVERY_REQUIRED,
      startupStage: 'Reconnecting saved WhatsApp session',
      info: 'WhatsApp session ended unexpectedly. PatrolSafe is reconnecting safely.',
      lastError: null,
    };
    this.appendCollectorLog(
      'session-recovery-start',
      `failedGeneration=${failedGeneration} recoverySequence=${recoverySequence} attempt=${this.automaticSessionRecoveryAttempts}/${this.maxAutomaticSessionRecoveryAttempts}`,
    );

    await this.stopHelperProcess();
    await this.releaseCurrentProfileOwnership(profileDir, failedGeneration);
    if (recoverySequence !== this.sessionRecoverySequence) {
      this.appendCollectorLog('session-recovery-cancelled', `recoverySequence=${recoverySequence}`);
      return this.getStatus();
    }

    this.helperStatus = this.buildDefaultStatus({
      state: 'starting',
      info: 'Reconnecting the preserved WhatsApp session...',
      startupStage: 'Reconnecting saved WhatsApp session',
      failureCode: null,
      lastError: null,
      qrCode: null,
      connectedAccount: null,
      productionListenerCount: 0,
    });
    const entitlement = this.assertEntitlementForLicensedAction();
    if (this.monitoringEnabled) {
      this.scheduleEntitlementRecheck(entitlement);
    }
    return this.startInternal();
  }

  private async beginSessionRelinkRequired(failedGeneration: number): Promise<WhatsAppCollectorStatus> {
    if (this.sessionRecoveryPromise) {
      return this.sessionRecoveryPromise;
    }

    const recoverySequence = ++this.sessionRecoverySequence;
    const profileDir = path.join(this.sessionPath, 'session-patrol-evidence-platform');
    this.certificationTerminal = true;
    this.helperStatus = this.buildDefaultStatus({
      state: 'RELINK_REQUIRED',
      connected: false,
      ready: false,
      productionListenerCount: 0,
      failureCode: 'WHATSAPP_RELINK_REQUIRED',
      startupStage: 'WhatsApp relink required',
      info: 'WhatsApp needs to be relinked. Your sites, mappings, schedules and evidence are preserved.',
      lastError: 'The preserved WhatsApp session could not recover after bounded reconnect attempts.',
      qrCode: null,
      connectedAccount: null,
      groups: [],
      contacts: [],
    });
    this.appendCollectorLog(
      'session-recovery-bounded-failure',
      `failedGeneration=${failedGeneration} attempts=${this.automaticSessionRecoveryAttempts} sessionPreserved=true`,
    );

    const terminal = (async (): Promise<WhatsAppCollectorStatus> => {
      await this.stopHelperProcess();
      await this.releaseCurrentProfileOwnership(profileDir, failedGeneration);
      if (recoverySequence !== this.sessionRecoverySequence) {
        return this.getStatus();
      }
      return this.getStatus();
    })().catch((error) => {
      this.appendCollectorLog(
        'session-relink-release-failed',
        `failedGeneration=${failedGeneration} error=${error instanceof Error ? error.message : String(error)}`,
      );
      return this.getStatus();
    });
    const trackedTerminal = terminal.finally(() => {
      if (this.sessionRecoveryPromise === trackedTerminal) {
        this.sessionRecoveryPromise = null;
      }
    });
    this.sessionRecoveryPromise = trackedTerminal;
    return trackedTerminal;
  }

  private markSessionRecoveryStableAfterDelay(generation: number): void {
    this.clearSessionRecoveryStableTimer();
    const timer = setTimeout(() => {
      this.sessionRecoveryStableTimer = null;
      if (generation === this.activeHelperGeneration && this.helperStatus.state === 'ready') {
        this.automaticSessionRecoveryAttempts = 0;
        this.appendCollectorLog('session-recovery-stable', `generation=${generation}`);
      }
    }, this.sessionRecoveryStableMs);
    timer.unref?.();
    this.sessionRecoveryStableTimer = timer;
  }

  private clearSessionRecoveryStableTimer(): void {
    if (this.sessionRecoveryStableTimer) {
      clearTimeout(this.sessionRecoveryStableTimer);
      this.sessionRecoveryStableTimer = null;
    }
  }

  private cancelSessionRecovery(): void {
    this.sessionRecoverySequence += 1;
    this.automaticSessionRecoveryAttempts = 0;
    this.clearSessionRecoveryStableTimer();
  }

  private maybeBeginNetworkRecovery(status: WhatsAppHelperStatusSnapshot, generation: number): void {
    if (
      this.entitlementRestriction !== null ||
      this.entitlementResumeRequired ||
      isQrOnlyCertificationMode() ||
      generation !== this.activeHelperGeneration ||
      this.networkRecoveryPromise ||
      !isRecoverableWhatsAppNetworkFailure(status) ||
      this.currentGenerationProfileSafety !== 'EXISTING_SESSION_PROTECTED' ||
      !this.whatsAppSourceMappingService.getConfiguredLinkedAccountId() ||
      this.isSessionProfileEmpty()
    ) {
      return;
    }

    if (this.automaticNetworkRecoveryAttempts >= this.maxAutomaticNetworkRecoveryAttempts) {
      this.helperStatus = {
        ...this.helperStatus,
        state: 'failed',
        connected: false,
        ready: false,
        productionListenerCount: 0,
        failureCode: WHATSAPP_NETWORK_FAILURE_CODE,
        startupStage: 'Unable to reconnect',
        info: "We couldn't reconnect to WhatsApp. Check your internet connection and try again.",
        lastError: 'WhatsApp Web is not reachable after bounded reconnect attempts.',
      };
      this.appendCollectorLog(
        'network-recovery-bounded-failure',
        `generation=${generation} attempts=${this.automaticNetworkRecoveryAttempts}`,
      );
      return;
    }

    this.automaticNetworkRecoveryAttempts += 1;
    void this.beginNetworkRecovery('automatic', false).catch((error) => {
      this.appendCollectorLog(
        'network-recovery-failed',
        `generation=${generation} error=${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }

  private async beginNetworkRecovery(
    reason: 'automatic' | 'customer-retry',
    explicitCustomerRetry: boolean,
  ): Promise<WhatsAppCollectorStatus> {
    if (this.networkRecoveryPromise) {
      return this.networkRecoveryPromise;
    }

    if (
      isQrOnlyCertificationMode() ||
      !this.whatsAppSourceMappingService.getConfiguredLinkedAccountId() ||
      this.isSessionProfileEmpty()
    ) {
      return this.getStatus();
    }

    if (explicitCustomerRetry) {
      this.automaticNetworkRecoveryAttempts = 0;
    }

    const recoverySequence = ++this.networkRecoverySequence;
    const failedGeneration = this.activeHelperGeneration;
    const recovery = this.runNetworkRecovery(recoverySequence, failedGeneration, reason);
    const trackedRecovery = recovery.finally(() => {
      if (this.networkRecoveryPromise === trackedRecovery) {
        this.networkRecoveryPromise = null;
      }
    });
    this.networkRecoveryPromise = trackedRecovery;
    return trackedRecovery;
  }

  private async runNetworkRecovery(
    recoverySequence: number,
    failedGeneration: number,
    reason: 'automatic' | 'customer-retry',
  ): Promise<WhatsAppCollectorStatus> {
    const profileDir = path.join(this.sessionPath, 'session-patrol-evidence-platform');
    this.helperStatus = {
      ...this.helperStatus,
      state: 'reconnecting',
      connected: false,
      ready: false,
      productionListenerCount: 0,
      failureCode: WHATSAPP_NETWORK_FAILURE_CODE,
      startupStage: 'Reconnecting to WhatsApp',
      info: 'Connection lost. PatrolSafe is waiting for WhatsApp to become reachable.',
      lastError: null,
    };
    this.appendCollectorLog(
      'network-recovery-start',
      `reason=${reason} failedGeneration=${failedGeneration} recoverySequence=${recoverySequence} monitoring=${this.monitoringEnabled ? 'enabled' : 'paused'}`,
    );

    await this.stopHelperProcess();
    await this.releaseCurrentProfileOwnership(profileDir, failedGeneration);

    for (let attempt = 1; attempt <= this.networkConnectivityCheckAttempts; attempt += 1) {
      if (recoverySequence !== this.networkRecoverySequence) {
        this.appendCollectorLog('network-recovery-cancelled', `recoverySequence=${recoverySequence}`);
        return this.getStatus();
      }

      const reachable = await this.checkWhatsAppConnectivity();
      this.appendCollectorLog(
        'network-connectivity-check',
        `recoverySequence=${recoverySequence} attempt=${attempt}/${this.networkConnectivityCheckAttempts} reachable=${reachable}`,
      );
      if (recoverySequence !== this.networkRecoverySequence) {
        this.appendCollectorLog('network-recovery-cancelled', `recoverySequence=${recoverySequence}`);
        return this.getStatus();
      }
      if (reachable) {
        this.helperStatus = this.buildDefaultStatus({
          state: 'starting',
          info: 'WhatsApp is reachable. Reconnecting the saved session...',
          startupStage: 'Reconnecting saved WhatsApp session',
          failureCode: null,
          lastError: null,
          qrCode: null,
          connectedAccount: null,
          productionListenerCount: 0,
        });
        this.appendCollectorLog(
          'network-connectivity-restored',
          `recoverySequence=${recoverySequence} nextGeneration=${this.helperGeneration + 1}`,
        );
        const entitlement = this.assertEntitlementForLicensedAction();
        if (this.monitoringEnabled) {
          this.scheduleEntitlementRecheck(entitlement);
        }
        return this.startInternal();
      }

      if (attempt < this.networkConnectivityCheckAttempts) {
        await this.sleep(this.networkConnectivityCheckDelayMs);
      }
    }

    this.helperStatus = {
      ...this.helperStatus,
      state: 'failed',
      connected: false,
      ready: false,
      productionListenerCount: 0,
      failureCode: WHATSAPP_NETWORK_FAILURE_CODE,
      startupStage: 'Unable to reconnect',
      info: "We couldn't reconnect to WhatsApp. Check your internet connection and try again.",
      lastError: 'WhatsApp Web is not reachable.',
      lastDisconnectAt: new Date().toISOString(),
    };
    this.appendCollectorLog(
      'network-recovery-awaiting-customer',
      `recoverySequence=${recoverySequence} checks=${this.networkConnectivityCheckAttempts} sessionPreserved=true`,
    );
    return this.getStatus();
  }

  private checkWhatsAppConnectivity(): Promise<boolean> {
    return probeWhatsAppWebConnectivity();
  }

  private cancelNetworkRecovery(): void {
    this.networkRecoverySequence += 1;
    this.automaticNetworkRecoveryAttempts = 0;
  }

  private maybeBeginLinkRetryCleanup(status: WhatsAppHelperStatusSnapshot, generation: number): void {
    if (
      generation !== this.activeHelperGeneration ||
      this.linkRetryCleanupPromise ||
      !shouldOfferLinkRetry({
        status,
        profileSafety: this.currentGenerationProfileSafety,
        authenticationObserved: this.currentGenerationAuthenticationObserved,
        profileLockFailure: isProfileLockErrorMessage(status.lastError ?? status.info ?? ''),
      })
    ) {
      return;
    }

    this.linkRetryCleanupPromise = this.completeLinkRetryCleanup(status, generation)
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.appendCollectorLog('link-retry-cleanup-failed', `generation=${generation} error=${message}`);
        if (generation === this.activeHelperGeneration) {
          this.linkRetryReleaseVerified = false;
          this.helperStatus = this.buildDefaultStatus({
            state: 'failed',
            info: 'WhatsApp could not stop the previous linking attempt safely.',
            startupStage: 'Link cleanup failed',
            lastError: message,
            failureCode: 'LINK_RETRY_CLEANUP_FAILED',
            sessionCorruptionSuspected: false,
            sessionCorruptionMessage: null,
          });
        }
      })
      .finally(() => {
        this.linkRetryCleanupPromise = null;
      });
  }

  private async completeLinkRetryCleanup(
    failedStatus: WhatsAppHelperStatusSnapshot,
    generation: number,
  ): Promise<void> {
    const profileDir = path.join(this.sessionPath, 'session-patrol-evidence-platform');
    const failureCode = failedStatus.failureCode || 'QR_INITIALIZATION_TIMEOUT';
    this.appendCollectorLog(
      'link-retry-cleanup-start',
      `generation=${generation} failureCode=${failureCode} profileSafety=${this.currentGenerationProfileSafety}`,
    );

    await this.stopHelperProcess();
    await this.releaseCurrentProfileOwnership(profileDir, generation);
    if (generation !== this.activeHelperGeneration) {
      this.appendCollectorLog(
        'link-retry-cleanup-stale-completion-ignored',
        `generation=${generation} activeGeneration=${this.activeHelperGeneration}`,
      );
      return;
    }

    this.clearPreviousQrArtifact();
    this.clearPendingCertificationAuthorization();
    this.certificationAuthorizationRequested = false;
    this.certificationAuthorizationState = isQrOnlyCertificationMode() ? 'EXPECTING_QR_ONLY' : 'DISABLED';
    this.certificationLiveIngestion = {
      armed: false,
      budgetRemaining: 0,
      approvedSourcePresent: false,
      listenerCount: 0,
      acceptedItemCount: 0,
      rejectedUnapprovedSourceCount: 0,
      rejectedUnsupportedMediaCount: 0,
    };
    this.linkRetryReleaseVerified = true;
    this.helperStatus = this.buildDefaultStatus({
      state: LINK_RETRY_REQUIRED,
      info: 'WhatsApp could not initialise. Check your internet connection and try again.',
      startupStage: 'WhatsApp could not initialise',
      lastError: 'WhatsApp bootstrap did not complete.',
      failureCode,
      qrCode: null,
      qrPayloadLength: null,
      qrDeliveredAt: null,
      qrPersistedAt: null,
      connectedAccount: null,
      groups: [],
      contacts: [],
      sessionCorruptionSuspected: false,
      sessionCorruptionMessage: null,
    });
    this.appendCollectorLog(
      'link-retry-required',
      `generation=${generation} failureCode=${failureCode} helperReleased=true profileReleased=true`,
    );
  }

  private async releaseCurrentProfileOwnership(profileDir: string, generation: number): Promise<void> {
    await releaseProfileOwnership(
      profileDir,
      (event, details) => this.appendCollectorLog(event, `generation=${generation} ${details}`),
      { timeoutMs: 30_000, forceAfterMs: 5_000 },
    );
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
    this.rejectPendingMonitoringReconciliations('Patrol monitoring helper stopped before listener reconciliation completed.');
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
    const linkedAccountId =
      this.helperStatus.connectedAccount?.trim() ||
      this.whatsAppSourceMappingService.getConfiguredLinkedAccountId();
    this.mappedGroupsCount = await this.whatsAppSourceMappingService.countActiveMappingsForIngest(
      linkedAccountId,
    );
  }

  private resolveMonitoringState(): WhatsAppCollectorStatus['monitoringState'] {
    if (this.entitlementRestriction) {
      return this.entitlementRestriction;
    }
    if (this.entitlementResumeRequired) {
      return 'PAUSED';
    }
    if (!this.monitoringEnabled) {
      return 'PAUSED';
    }
    if (this.mappedGroupsCount === 0) {
      return 'NO_GROUPS_CONFIGURED';
    }
    if (
      this.helperStatus.failureCode === WHATSAPP_RUNTIME_CONFIG_UNAVAILABLE ||
      this.helperStatus.failureCode === WHATSAPP_MONITORING_LISTENER_TIMEOUT ||
      this.helperStatus.failureCode === 'WHATSAPP_MONITORING_RECONCILIATION_FAILED'
    ) {
      return 'ERROR';
    }
    if (this.helperStatus.state === 'ready' && this.helperStatus.productionListenerCount === 3) {
      return 'ACTIVE';
    }
    if (this.helperStatus.state === 'RELINK_REQUIRED') {
      return 'WHATSAPP_RELINK_REQUIRED';
    }
    if (
      this.helperStatus.state === 'reconnecting' ||
      this.helperStatus.state === 'starting' ||
      this.helperStatus.state === 'browser-launching' ||
      this.helperStatus.state === 'whatsapp-loading' ||
      this.helperStatus.state === 'authenticated' ||
      this.helperStatus.state === 'waiting-for-client-info'
    ) {
      return 'WAITING_FOR_WHATSAPP';
    }
    if (
      this.helperStatus.state === 'failed' ||
      this.helperStatus.state === 'LINK_RETRY_REQUIRED' ||
      this.helperStatus.state === 'disconnected'
    ) {
      return 'ERROR';
    }
    return 'STARTING';
  }

  private async reconcileProductionMonitoring(reason: string): Promise<void> {
    await this.refreshMappedGroupsCount();
    if (isQrOnlyCertificationMode()) {
      return;
    }
    if (this.monitoringEnabled && !this.entitlementResumeRequired) {
      const entitlement = this.licensingService.getEntitlementEvaluation(true);
      if (monitoringEntitlementRestriction(entitlement)) {
        this.applyEntitlementRestriction(entitlement, `monitoring-reconcile:${reason}`);
        return;
      }
      this.clearEntitlementRestriction();
      this.scheduleEntitlementRecheck(entitlement);
    }
    if (!this.isHelperRunning()) {
      if (
        this.monitoringEnabled &&
        this.whatsAppSourceMappingService.getConfiguredLinkedAccountId() &&
        !this.isSessionProfileEmpty()
      ) {
        this.appendCollectorLog('production-monitoring-starting', `reason=${reason}`);
        void this.start().catch((error) => {
          this.appendCollectorLog(
            'production-monitoring-start-failed',
            error instanceof Error ? error.message : String(error),
          );
        });
      }
      return;
    }
    if (this.helperStatus.state !== 'ready') {
      return;
    }
    const enabled =
      this.monitoringEnabled &&
      this.entitlementRestriction === null &&
      !this.entitlementResumeRequired &&
      this.mappedGroupsCount > 0;
    await this.requestMonitoringReconciliation(enabled, reason);
    this.appendCollectorLog(
      'production-monitoring-reconciled',
      `reason=${reason} enabled=${enabled} mappings=${this.mappedGroupsCount}`,
    );
  }

  private requestMonitoringReconciliation(enabled: boolean, reason: string): Promise<void> {
    if (!this.isHelperRunning() || this.helperProcess?.stdin.destroyed) {
      return Promise.reject(new Error('WHATSAPP_HELPER_NOT_RUNNING'));
    }
    const requestId = randomUUID();
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const pending = this.pendingMonitoringReconciliations.get(requestId);
        if (!pending) {
          return;
        }
        this.pendingMonitoringReconciliations.delete(requestId);
        this.helperStatus = {
          ...this.helperStatus,
          productionListenerCount: 0,
          failureCode: WHATSAPP_MONITORING_LISTENER_TIMEOUT,
          info: 'WhatsApp connected, but monitoring listeners did not start in time. Try again or contact support.',
          lastError: 'Patrol monitoring listener acknowledgement timed out.',
        };
        this.appendCollectorLog('production-monitoring-reconcile-timeout', `reason=${reason} requestId=${requestId}`);
        reject(new Error(WHATSAPP_MONITORING_LISTENER_TIMEOUT));
      }, this.monitoringReconciliationTimeoutMs);
      this.pendingMonitoringReconciliations.set(requestId, { enabled, resolve, reject, timer });
      this.sendHelperCommand({ type: 'set-production-monitoring', enabled, requestId });
      this.appendCollectorLog('production-monitoring-reconcile-requested', `reason=${reason} enabled=${enabled} requestId=${requestId}`);
    });
  }

  private rejectPendingMonitoringReconciliations(message: string): void {
    for (const pending of this.pendingMonitoringReconciliations.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(message));
    }
    this.pendingMonitoringReconciliations.clear();
  }

  private assertEntitlementForLicensedAction(): LicenceEvaluation {
    const evaluation = this.licensingService.getEntitlementEvaluation(true);
    if (monitoringEntitlementRestriction(evaluation)) {
      this.applyEntitlementRestriction(evaluation, 'licensed-action');
      try {
        this.licensingService.assertCollectorStartAllowed();
      } catch (error) {
        throw error;
      }
      throw new BadRequestException(evaluation.message);
    }
    this.clearEntitlementRestriction();
    this.entitlementResumeRequired = false;
    return evaluation;
  }

  /**
   * This synchronous admission point defines the ingestion boundary: an event
   * admitted here may finish, while every later event is rejected after expiry.
   */
  private assertEntitlementForHelperIngest(): void {
    const evaluation = this.licensingService.getEntitlementEvaluation(true);
    if (!monitoringEntitlementRestriction(evaluation)) {
      return;
    }
    this.applyEntitlementRestriction(evaluation, 'helper-ingest-admission');
    try {
      this.licensingService.assertCollectorStartAllowed();
    } catch (error) {
      throw error;
    }
    throw new BadRequestException(evaluation.message);
  }

  private scheduleEntitlementRecheck(evaluation: LicenceEvaluation): void {
    this.clearEntitlementRecheckTimer();
    if (
      !this.monitoringEnabled ||
      this.entitlementResumeRequired ||
      monitoringEntitlementRestriction(evaluation)
    ) {
      return;
    }
    const delay = nextEntitlementRecheckDelayMs(evaluation);
    this.entitlementRecheckTimer = setTimeout(() => {
      this.entitlementRecheckTimer = null;
      this.reconcileActiveEntitlement();
    }, delay);
    this.entitlementRecheckTimer.unref?.();
  }

  private reconcileActiveEntitlement(): void {
    if (!this.monitoringEnabled) {
      return;
    }
    const evaluation = this.licensingService.getEntitlementEvaluation(true);
    if (monitoringEntitlementRestriction(evaluation)) {
      this.applyEntitlementRestriction(evaluation, 'scheduled-boundary');
      return;
    }
    this.clearEntitlementRestriction();
    this.scheduleEntitlementRecheck(evaluation);
  }

  private applyEntitlementRestriction(evaluation: LicenceEvaluation, trigger: string): void {
    const restriction = monitoringEntitlementRestriction(evaluation);
    if (!restriction) {
      return;
    }
    const firstTransition = this.entitlementRestriction !== restriction;
    this.entitlementRestriction = restriction;
    this.entitlementResumeRequired = true;
    this.entitlementMessage =
      restriction === 'TRIAL_EXPIRED'
        ? 'Your 30-day PatrolSafe trial has ended. Monitoring has stopped. Your existing evidence remains available.'
        : 'Monitoring requires an active PatrolSafe licence. Your existing evidence remains available.';
    this.clearEntitlementRecheckTimer();
    this.cancelNetworkRecovery();
    this.helperStatus = {
      ...this.helperStatus,
      productionListenerCount: 0,
      info: this.entitlementMessage,
      startupStage: restriction === 'TRIAL_EXPIRED' ? 'Trial expired' : 'Licence required',
      lastError: null,
    };
    if (this.isHelperRunning()) {
      this.sendHelperCommand({ type: 'set-production-monitoring', enabled: false });
    }
    if (firstTransition) {
      this.entitlementTransitionCount += 1;
      this.appendCollectorLog(
        'monitoring-entitlement-restricted',
        `restriction=${restriction} trigger=${trigger} listeners=detaching sessionPreserved=true`,
      );
    }
  }

  private clearEntitlementRestriction(preserveResumeRequirement = false): void {
    this.entitlementRestriction = null;
    this.entitlementMessage = null;
    if (!preserveResumeRequirement) {
      this.entitlementResumeRequired = false;
    }
  }

  private clearEntitlementRecheckTimer(): void {
    if (this.entitlementRecheckTimer) {
      clearTimeout(this.entitlementRecheckTimer);
      this.entitlementRecheckTimer = null;
    }
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
      liveMessagesProcessed: 0,
      liveImagesImported: 0,
      liveDuplicatesSkipped: 0,
      productionListenerCount: 0,
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

    // With no operator/admin choice, use the validated Edge-first launch plan.
    // Explicit browser preferences and saved executable paths remain authoritative above.
    return 'auto';
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
    this.sourceDiscoveryState = 'LOADING';
    this.sourceDiscoveryError = null;
    this.sendHelperCommand({ type: 'refresh-discovered-chats' });
  }

  private resetSourceDiscoveryState(): void {
    const pending = this.pendingSourceDiscovery;
    this.pendingSourceDiscovery = null;
    if (pending) {
      clearTimeout(pending.timer);
      pending.resolve();
    }
    this.sourceDiscoveryState = 'NOT_ATTEMPTED';
    this.sourceDiscoveryError = null;
    this.lastSourceDiscoveryAt = null;
    this.chatDiscoveryRefreshCooldownUntil = 0;
  }

  private failPendingSourceDiscovery(message: string): void {
    const pending = this.pendingSourceDiscovery;
    if (!pending) {
      return;
    }
    this.pendingSourceDiscovery = null;
    clearTimeout(pending.timer);
    this.sourceDiscoveryState = 'ERROR';
    this.sourceDiscoveryError = message;
    this.lastSourceDiscoveryAt = new Date().toISOString();
    pending.resolve();
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
