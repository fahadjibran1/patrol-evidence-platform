import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as readline from 'readline';
import type { Client, LocalAuth, Message, MessageMedia } from 'whatsapp-web.js';
import { CollectorType } from '@/common/enums/collector-type.enum';
import {
  CollectorState,
  WhatsAppCollectorContact,
  WhatsAppCollectorGroup,
  WhatsAppHelperCommand,
  WhatsAppHelperEvent,
  WhatsAppHelperGroupMapping,
  WhatsAppHelperIngestPayload,
  WhatsAppHelperRuntimeConfig,
  WhatsAppHelperStatusSnapshot,
  WHATSAPP_HELPER_EVENT_PREFIX,
} from './whatsapp-helper.types';
import {
  type AccountBoundSignal,
  QrOnlyCertificationGuard,
  UNEXPECTED_AUTHENTICATION,
  isQrOnlyCertificationMode,
  redactQrOnlyCertificationLog,
} from './whatsapp-certification-guard';
import { PatrolSourceType } from '@/common/enums/patrol-source-type.enum';
import {
  getMessageSourceId,
  resolveWhatsAppSenderName,
  shouldSkipWhatsAppFromMe,
  withDetachedFrameRetry,
  type WhatsAppMessageSource,
} from './whatsapp-message.util';
import {
  buildWhatsAppLaunchConfigSummary,
  buildWhatsAppWebClientOptions,
  formatWhatsAppRuntimeConfigSummary,
  getWhatsAppWebVersionLogSnapshot,
  readBrowserExecutableVersion,
  readWhatsAppRuntimePackageVersions,
  resolveBrowserExecutables,
  type ResolvedBrowserExecutable,
  WHATSAPP_WEB_VERSION,
} from './whatsapp-web-runtime.config';
import {
  acquireHelperMutex,
  buildProfileLockFailureMessage,
  detectProfileLock,
  ensureProfileUnlocked,
  formatBrowserOwners,
  isProfileLockErrorMessage,
  ProfileLockError,
  readHelperMutex,
  type HelperMutexHandle,
} from './browser-profile-lock.util';
import {
  buildModuleCompatibilityDetails,
  classifyPostAuthCompatibility,
  extractUnknownWaWebModule,
  isWwebjsModuleCompatibilitySignal,
  shouldTreatAsModuleCompatibilityFailure,
  WWEBJS_MODULE_COMPATIBILITY_ERROR,
  WWEBJS_MODULE_COMPATIBILITY_USER_MESSAGE,
  type WwebjsStoreProbeResult,
} from './wwebjs-compatibility';

type MessageSource = 'live' | 'backfill';
type MessageProcessingResult = 'imported' | 'duplicate' | 'skipped';
type StartupGateOutcome = 'ready' | 'auth_failure' | 'disconnected' | 'failed';

const AUTHENTICATED_READY_TIMEOUT_MS = 90_000;
const QR_SCAN_AUTHENTICATED_TIMEOUT_MS = 120_000;
const BROWSER_LAUNCH_GRACE_MS = Number(process.env.PATROL_HELPER_BROWSER_LAUNCH_GRACE_MS ?? 90_000);
const QR_AFTER_PAGE_LOAD_TIMEOUT_MS = Number(
  process.env.PATROL_HELPER_QR_TIMEOUT_MS ?? process.env.PATROL_HELPER_STARTUP_TIMEOUT_MS ?? 120_000,
);
const MAX_BLANK_QR_STARTUP_RETRIES = Number(process.env.PATROL_HELPER_STARTUP_RETRIES ?? 2);
const SESSION_PROFILE_DIR = 'session-patrol-evidence-platform';
const LOCAL_AUTH_CLIENT_ID = 'patrol-evidence-platform';
const BROWSER_HEADLESS = false;
const BROWSER_AUTOMATION_FAILED_MESSAGE =
  'Unable to start browser automation. Check Edge/Chrome installation.';
const SESSION_CORRUPTION_USER_MESSAGE = 'WhatsApp session appears corrupted. Reset WhatsApp session.';
const QR_SCAN_INCOMPLETE_MESSAGE = 'QR scan did not complete. Please rescan.';
const POST_AUTH_COMPATIBILITY_TIMEOUT_MS = 10_000;

type WhatsAppRuntimeModule = typeof import('whatsapp-web.js');

const API_BASE_URL = process.env.PATROL_HELPER_API_BASE_URL?.trim() || 'http://localhost:3001';
const INTERNAL_TOKEN = process.env.PATROL_HELPER_INTERNAL_TOKEN?.trim() || '';
const SESSION_PATH =
  process.env.PATROL_HELPER_SESSION_PATH?.trim() ||
  path.join(os.tmpdir(), 'patrol-evidence-platform', 'whatsapp-session');
const COLLECTOR_LOG_PATH =
  process.env.PATROL_HELPER_LOG_PATH?.trim() ||
  path.join(os.tmpdir(), 'patrol-evidence-platform', 'collector-runtime.log');
const LATEST_QR_PATH =
  process.env.PATROL_HELPER_LATEST_QR_PATH?.trim() ||
  path.join(path.dirname(COLLECTOR_LOG_PATH), 'latest-qr.txt');
const SMOKE_MODE = process.env.PATROL_HELPER_SMOKE === 'true';
const CHAT_DISCOVERY_SMOKE_MODE = process.env.PATROL_HELPER_CHAT_DISCOVERY_SMOKE === 'true';
const POST_AUTH_SMOKE_MODE = process.env.PATROL_HELPER_POST_AUTH_SMOKE === 'true';
const LIVE_DEBUG_MODE = process.env.PATROL_HELPER_LIVE_DEBUG === 'true';
const qrOnlyCertificationGuard = new QrOnlyCertificationGuard(isQrOnlyCertificationMode());
const BROWSER_DUMP_IO = process.env.PATROL_HELPER_BROWSER_DUMPIO === 'true' || LIVE_DEBUG_MODE;
const BACKFILL_MESSAGE_LIMIT = Number(process.env.PATROL_HELPER_BACKFILL_MESSAGE_LIMIT ?? 150);
const COLLECTOR_LOG_MAX_BYTES = Number(process.env.PATROL_HELPER_LOG_MAX_BYTES ?? 20 * 1024 * 1024);
const COLLECTOR_LOG_KEEP_FILES = Math.max(1, Number(process.env.PATROL_HELPER_LOG_KEEP ?? 3));
const CHAT_STORE_READY_TIMEOUT_MS = Number(process.env.PATROL_HELPER_CHAT_STORE_READY_TIMEOUT_MS ?? 60_000);
const TEST_IMAGE_PATH = path.join(os.tmpdir(), 'patrol-evidence-platform', 'whatsapp-test-image.png');
const DEFAULT_TEST_GROUP_ID = '120363375746387624@g.us';
const CHAT_STORE_UNAVAILABLE_MESSAGE = WWEBJS_MODULE_COMPATIBILITY_USER_MESSAGE;
const POST_AUTH_LOGOUT_MESSAGE =
  'WhatsApp Web logged out while chats were syncing. Session files were preserved — retry linking without resetting unless the phone revoked the device.';

let client: Client | null = null;
let startupTimeout: NodeJS.Timeout | null = null;
let browserLaunchGraceTimeout: NodeJS.Timeout | null = null;
let qrWaitTimeout: NodeJS.Timeout | null = null;
let browserLaunchStartedAt: number | null = null;
let browserLaunchCompletedAt: number | null = null;
let whatsappPageLoadedAt: number | null = null;
let runtimeModulePromise: Promise<WhatsAppRuntimeModule> | null = null;
let shutdownRequested = false;
let reconnectAuthorizationPending = false;
let releaseReconnectAuthorizationHold: ((authorized: boolean) => void) | null = null;
/** Set only for operator stop / explicit session reset — never for library post_logout. */
let operatorLogoutRequested = false;
/** Once authenticated fires for an attempt, QR/browser startup timers must not destroy that client. */
let authenticationReachedAttemptId: number | null = null;
/** True only after positive account-bound evidence (authenticated/CONNECTED/ready). */
let qrScanDetected = false;
let qrReceivedLoggedForAttempt: number | null = null;
const recentPageConsoleErrors: string[] = [];
const RECENT_PAGE_CONSOLE_LIMIT = 40;
const moduleCompatibilitySignals: string[] = [];
const MODULE_COMPAT_SIGNAL_LIMIT = 40;
let moduleCompatibilityFailureReported = false;
const diagnosedPages = new WeakSet<object>();
let startupResolve: ((value: StartupGateOutcome) => void) | null = null;
let startupReject: ((reason?: unknown) => void) | null = null;
let activeStartupAttemptId = 0;
let groupDiscoveryTimers: NodeJS.Timeout[] = [];
let qrScanAuthenticatedTimeout: NodeJS.Timeout | null = null;
let startupGateResolved = false;
let activeBrowserLaunch: { executablePath: string; headless: boolean } | null = null;
let readinessFinalized = false;
let activeClientInfoWatch: { cancelled: boolean; attemptId: number } | null = null;
let liveMediaListenersAttached = false;
let unexpectedAuthenticationShutdownStarted = false;
let readyHeartbeatInterval: NodeJS.Timeout | null = null;
let navigationReattachTimer: NodeJS.Timeout | null = null;
let helperMutex: HelperMutexHandle | null = null;
const processedMessageIds = new Set<string>();
const pendingLiveMediaChecks = new Map<string, NodeJS.Timeout>();
const LIVE_MEDIA_RECHECK_MS = 1_000;
const LIVE_MEDIA_RECHECK_MAX = 10;
const READY_HEARTBEAT_INTERVAL_MS = 30_000;
const NAVIGATION_REATTACH_DELAY_MS = 3_000;
const CLIENT_INFO_POLL_MS = 2_000;

const status: WhatsAppHelperStatusSnapshot = {
  enabled: true,
  connected: false,
  ready: false,
  state: 'starting',
  info: 'Patrol monitoring starting',
  sessionPath: SESSION_PATH,
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
  allowFromMe: false,
  startupStage: 'Starting patrol monitoring...',
  startupStartedAt: new Date().toISOString(),
  lastError: null,
  collectorLogPath: COLLECTOR_LOG_PATH,
  latestQrPath: LATEST_QR_PATH,
  qrPayloadLength: null,
  qrPersistedAt: null,
  qrDeliveredAt: null,
  browserExecutablePath: null,
  browserExecutableSource: null,
  browserCandidatesTried: [],
  sessionPathExists: false,
  sessionPathWritable: false,
  sessionCorruptionSuspected: false,
  sessionCorruptionMessage: null,
  failureCode: null,
  groups: [],
  contacts: [],
};

function rotateCollectorLogIfNeeded(): void {
  if (!Number.isFinite(COLLECTOR_LOG_MAX_BYTES) || COLLECTOR_LOG_MAX_BYTES <= 0) {
    return;
  }

  try {
    if (!existsSync(COLLECTOR_LOG_PATH)) {
      return;
    }

    const size = statSync(COLLECTOR_LOG_PATH).size;
    if (size < COLLECTOR_LOG_MAX_BYTES) {
      return;
    }

    const oldest = `${COLLECTOR_LOG_PATH}.${COLLECTOR_LOG_KEEP_FILES}`;
    if (existsSync(oldest)) {
      unlinkSync(oldest);
    }

    for (let index = COLLECTOR_LOG_KEEP_FILES - 1; index >= 1; index -= 1) {
      const fromPath = `${COLLECTOR_LOG_PATH}.${index}`;
      const toPath = `${COLLECTOR_LOG_PATH}.${index + 1}`;
      if (existsSync(fromPath)) {
        renameSync(fromPath, toPath);
      }
    }

    renameSync(COLLECTOR_LOG_PATH, `${COLLECTOR_LOG_PATH}.1`);
  } catch (error) {
    process.stderr.write(
      `collector-log-rotate-failed ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }
}

function appendCollectorLog(event: string, details?: string): void {
  const safeDetails =
    qrOnlyCertificationGuard.currentState === 'DISABLED' || !details
      ? details
      : redactQrOnlyCertificationLog(details);
  const line = `[${new Date().toISOString()}] ${event}${safeDetails ? ` ${safeDetails}` : ''}`;
  try {
    mkdirSync(path.dirname(COLLECTOR_LOG_PATH), { recursive: true });
    rotateCollectorLogIfNeeded();
    appendFileSync(COLLECTOR_LOG_PATH, `${line}\n`, 'utf8');
  } catch (error) {
    process.stderr.write(`collector-log-write-failed ${error instanceof Error ? error.message : String(error)}\n`);
  }

  if (LIVE_DEBUG_MODE || CHAT_DISCOVERY_SMOKE_MODE) {
    process.stdout.write(`${line}\n`);
  }
}

function formatRuntimeError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack || error.message;
  }

  return String(error);
}

function isRecoverableContextError(error: unknown): boolean {
  const message = formatRuntimeError(error).toLowerCase();
  return (
    message.includes('execution context was destroyed') ||
    message.includes('context was destroyed') ||
    message.includes('target closed') ||
    message.includes('session closed') ||
    message.includes('protocol error') ||
    message.includes('navigation')
  );
}

function writeLatestQrPayload(qr: string): void {
  mkdirSync(path.dirname(LATEST_QR_PATH), { recursive: true });
  writeFileSync(LATEST_QR_PATH, qr, 'utf8');
}

function clearLatestQrPayload(): void {
  try {
    if (existsSync(LATEST_QR_PATH)) {
      unlinkSync(LATEST_QR_PATH);
    }
  } catch (error) {
    appendCollectorLog('latest-qr-clear-error', error instanceof Error ? error.message : String(error));
  }
}

function isSessionHealthy(): boolean {
  return readinessFinalized && status.state === 'ready' && Boolean(status.connectedAccount?.trim());
}

function hasReachedAuthenticationPhase(attemptId: number = activeStartupAttemptId): boolean {
  return authenticationReachedAttemptId !== null && authenticationReachedAttemptId === attemptId;
}

function isActiveClientGeneration(targetClient: Client, attemptId: number): boolean {
  return !shutdownRequested && attemptId === activeStartupAttemptId && targetClient === client;
}

function isPostAuthStartupProtected(targetClient: Client | null = client): boolean {
  if (!targetClient || operatorLogoutRequested || shutdownRequested) {
    return false;
  }

  if (readinessFinalized && status.state === 'ready') {
    return false;
  }

  return (
    authenticationReachedAttemptId !== null &&
    authenticationReachedAttemptId === activeStartupAttemptId &&
    (targetClient === client || client === null)
  );
}

function describeClientIdentity(targetClient: Client | null, attemptId: number = activeStartupAttemptId): string {
  const browserPid = targetClient?.pupBrowser?.process()?.pid;
  let pageUrl = 'none';
  try {
    pageUrl = targetClient?.pupPage?.url() || 'none';
  } catch {
    pageUrl = 'unavailable';
  }

  return [
    `attemptId=${attemptId}`,
    `activeAttemptId=${activeStartupAttemptId}`,
    `authAttemptId=${authenticationReachedAttemptId ?? 'none'}`,
    `clientMatch=${targetClient !== null && targetClient === client}`,
    `browserPid=${browserPid ?? 'none'}`,
    `pageUrl=${pageUrl}`,
    `state=${status.state}`,
    `readinessFinalized=${readinessFinalized}`,
    `operatorLogoutRequested=${operatorLogoutRequested}`,
  ].join(' ');
}

function logLifecycleEvent(
  event:
    | 'qr'
    | 'authenticated'
    | 'change_state'
    | 'ready'
    | 'auth_failure'
    | 'disconnected'
    | 'client.destroy'
    | 'client.logout'
    | 'authStrategy.logout'
    | 'session-reset'
    | 'fullyDestroyClientSession'
    | 'releaseStaleBrowserSession',
  details?: string,
  targetClient: Client | null = client,
  attemptId: number = activeStartupAttemptId,
): void {
  appendCollectorLog(
    `lifecycle-${event}`,
    `${describeClientIdentity(targetClient, attemptId)}${details ? ` ${details}` : ''}`,
  );
}

function logDestructiveAction(
  action:
    | 'client.destroy'
    | 'client.logout'
    | 'authStrategy.logout'
    | 'fullyDestroyClientSession'
    | 'releaseStaleBrowserSession'
    | 'session-reset',
  reason: string,
  targetClient: Client | null = client,
): void {
  const stack = new Error(`destructive-action:${action}`).stack ?? 'stack-unavailable';
  const lifecycleEvent =
    action === 'client.destroy' || action === 'fullyDestroyClientSession' || action === 'releaseStaleBrowserSession'
      ? 'DESTROY_CALL_REQUESTED'
      : action === 'session-reset'
        ? 'SESSION_DELETE_REQUESTED'
        : 'LOGOUT_CALL_REQUESTED';

  logAuthLifecycle(
    lifecycleEvent,
    `action=${action} reason=${reason} stack=${stack.replace(/\s+/g, ' ')}`,
    targetClient,
  );
  logLifecycleEvent(action, `reason=${reason}`, targetClient);
  appendCollectorLog(
    'destructive-action',
    `action=${action} reason=${reason} pageUrl=${currentPageUrl(targetClient)} collectorState=${status.state} operatorLogoutRequested=${operatorLogoutRequested} pid=${process.pid} ${describeClientIdentity(targetClient)} stack=${stack.replace(/\s+/g, ' ')}`,
  );
}

function markAuthenticationReached(attemptId: number, targetClient: Client): void {
  authenticationReachedAttemptId = attemptId;
  clearStartupTimeouts();
  clearQrScanAuthenticatedTimeout();
  clearReadinessTimers();
  appendCollectorLog(
    'post-auth-startup-guards-armed',
    describeClientIdentity(targetClient, attemptId),
  );
}

function isRetryableStartupFailure(outcome: StartupGateOutcome): boolean {
  if (outcome === 'disconnected') {
    return !hasPassedQrScanPhase() && !operatorLogoutRequested && !shutdownRequested;
  }

  if (outcome === 'ready' || outcome === 'auth_failure') {
    return false;
  }

  if (
    status.failureCode === WWEBJS_MODULE_COMPATIBILITY_ERROR ||
    moduleCompatibilityFailureReported ||
    isWwebjsModuleCompatibilitySignal(status.lastError) ||
    isWwebjsModuleCompatibilitySignal(status.info)
  ) {
    return false;
  }

  if (
    status.state === 'authenticated' ||
    status.state === 'waiting-for-client-info' ||
    readinessFinalized ||
    authenticationReachedAttemptId === activeStartupAttemptId
  ) {
    return false;
  }

  const errorText = `${status.lastError ?? ''} ${status.info ?? ''}`.toLowerCase();
  return (
    outcome === 'failed' &&
    (errorText.includes('qr') ||
      errorText.includes('timeout') ||
      errorText.includes('edge') ||
      errorText.includes('browser') ||
      errorText.includes('whatsapp web'))
  );
}

function rememberModuleCompatibilitySignal(signal: string): void {
  if (!signal.trim()) {
    return;
  }
  moduleCompatibilitySignals.push(signal);
  if (moduleCompatibilitySignals.length > MODULE_COMPAT_SIGNAL_LIMIT) {
    moduleCompatibilitySignals.splice(0, moduleCompatibilitySignals.length - MODULE_COMPAT_SIGNAL_LIMIT);
  }
}

function reportModuleCompatibilityFailure(
  source: string,
  details?: string,
  probe?: Partial<WwebjsStoreProbeResult> | null,
): void {
  if (moduleCompatibilityFailureReported && status.failureCode === WWEBJS_MODULE_COMPATIBILITY_ERROR) {
    appendCollectorLog(
      WWEBJS_MODULE_COMPATIBILITY_ERROR,
      `duplicate source=${source} ${details ?? ''}`.trim(),
    );
    return;
  }

  moduleCompatibilityFailureReported = true;
  const missingModule =
    extractUnknownWaWebModule(details ?? '') ||
    moduleCompatibilitySignals.map((entry) => extractUnknownWaWebModule(entry)).find(Boolean) ||
    null;
  const detailLine = buildModuleCompatibilityDetails({
    missingModule,
    probe,
    source,
  });

  appendCollectorLog(WWEBJS_MODULE_COMPATIBILITY_ERROR, `${detailLine} ${details ?? ''}`.trim());
  appendCollectorLog(
    'module-compat-session-preserved',
    'LocalAuth session retained — not a logout; do not delete session or retry QR auth for this failure.',
  );

  updateStatus(
    {
      // Stay authenticated when the account linked successfully — this is not a logout.
      state:
        status.state === 'ready'
          ? 'ready'
          : status.connectedAccount || hasReachedAuthenticationPhase(activeStartupAttemptId)
            ? 'authenticated'
            : 'failed',
      failureCode: WWEBJS_MODULE_COMPATIBILITY_ERROR,
      info: WWEBJS_MODULE_COMPATIBILITY_USER_MESSAGE,
      lastError: WWEBJS_MODULE_COMPATIBILITY_USER_MESSAGE,
      startupStage: 'Incompatible WhatsApp Web',
      sessionCorruptionSuspected: false,
    },
    WWEBJS_MODULE_COMPATIBILITY_ERROR,
    detailLine,
  );
  resolveStartupOnce('failed');
}

function isSessionCorruptionSignal(text: string): boolean {
  const normalized = text.toLowerCase();
  return (
    normalized.includes('err_cache_read_failure') ||
    normalized.includes('leveldb') ||
    normalized.includes('indexeddb') ||
    normalized.includes('indexed db') ||
    normalized.includes('database corruption') ||
    normalized.includes('corruption') ||
    normalized.includes('localauth.logout') ||
    normalized.includes('ebusy') ||
    normalized.includes('resource busy or locked')
  );
}

function reportSessionCorruption(source: string, details: string): void {
  if (status.sessionCorruptionSuspected) {
    return;
  }

  appendCollectorLog('session-corruption-detected', `${source} ${details}`);
  updateStatus(
    {
      sessionCorruptionSuspected: true,
      sessionCorruptionMessage: SESSION_CORRUPTION_USER_MESSAGE,
      info: SESSION_CORRUPTION_USER_MESSAGE,
      lastError: SESSION_CORRUPTION_USER_MESSAGE,
    },
    'session-corruption-detected',
    `${source} ${details}`,
  );
}

function applyStatusPresentation(): void {
  if (status.state === 'disconnected') {
    status.info = status.sessionCorruptionSuspected
      ? SESSION_CORRUPTION_USER_MESSAGE
      : 'WhatsApp disconnected. Connect again or reset the session if needed.';
    status.startupStage = 'Disconnected';
    return;
  }

  if (status.state === 'ready') {
    status.info = 'Ready to receive images.';
    status.startupStage = 'Ready';
    return;
  }

  if (status.state === 'waiting-for-client-info') {
    status.info = 'Finishing WhatsApp sync after scan…';
    status.startupStage = 'Authenticated';
    return;
  }

  if (status.failureCode === WWEBJS_MODULE_COMPATIBILITY_ERROR) {
    status.info = WWEBJS_MODULE_COMPATIBILITY_USER_MESSAGE;
    status.startupStage = 'Incompatible WhatsApp Web';
    return;
  }

  if (status.state === 'authenticated') {
    status.info = 'Phone scanned — finishing WhatsApp startup…';
    status.startupStage = 'Authenticated';
    return;
  }

  if (status.state === 'qr-ready' || status.qrCode) {
    status.info = 'Scan with the patrol phone: WhatsApp → Linked devices → Link a device.';
    status.startupStage = 'QR ready';
    return;
  }

  if (status.state === 'waiting-for-qr') {
    status.info = 'WhatsApp Web is open — waiting for QR code…';
    status.startupStage = 'Waiting for QR';
    return;
  }

  if (status.state === 'whatsapp-loading') {
    status.info = 'Loading WhatsApp Web in the browser…';
    status.startupStage = 'Loading WhatsApp Web';
    return;
  }

  if (status.state === 'browser-launching') {
    status.info = 'Launching Microsoft Edge for WhatsApp…';
    status.startupStage = 'Launching browser';
    return;
  }

  if (status.state === 'starting') {
    status.info = 'Starting patrol monitoring…';
    status.startupStage = 'Starting';
  }
}

function emitStatus(): void {
  status.lastEventAt = new Date().toISOString();
  status.ready = status.state === 'ready';
  status.connected = status.state === 'ready';
  status.sessionPathExists = existsSync(SESSION_PATH);
  status.sessionPathWritable = canWriteToSessionPath();

  const payload: WhatsAppHelperEvent = {
    type: 'status',
    payload: {
      ...status,
      groups: [...status.groups],
      contacts: [...status.contacts],
      browserCandidatesTried: [...status.browserCandidatesTried],
    },
  };

  process.stdout.write(`${WHATSAPP_HELPER_EVENT_PREFIX}${JSON.stringify(payload)}\n`);
}

function emitCertificationAuthorizationResult(authorized: boolean): void {
  const payload: WhatsAppHelperEvent = {
    type: 'certification-authorization-result',
    payload: {
      authorized,
      state: qrOnlyCertificationGuard.currentState,
    },
  };
  process.stdout.write(`${WHATSAPP_HELPER_EVENT_PREFIX}${JSON.stringify(payload)}\n`);
}

function isConnectedAndFinalized(): boolean {
  return readinessFinalized && Boolean(status.connectedAccount?.trim());
}

function shouldBlockStateRegression(previousState: CollectorState, nextState: CollectorState): boolean {
  if (nextState === 'waiting-for-client-info' && readinessFinalized && !shutdownRequested && client) {
    return true;
  }

  if (
    (previousState === 'authenticated' || previousState === 'waiting-for-client-info') &&
    !shutdownRequested &&
    authenticationReachedAttemptId === activeStartupAttemptId
  ) {
    const regressiveStates: CollectorState[] = [
      'waiting-for-qr',
      'qr-ready',
      'whatsapp-loading',
      'browser-launching',
      'starting',
    ];
    return regressiveStates.includes(nextState);
  }

  if (previousState === 'ready' && !shutdownRequested && client && readinessFinalized) {
    const regressiveStates: CollectorState[] = [
      'waiting-for-client-info',
      'authenticated',
      'waiting-for-qr',
      'qr-ready',
      'whatsapp-loading',
      'browser-launching',
      'starting',
    ];
    return regressiveStates.includes(nextState);
  }

  return false;
}

function setReadinessFinalized(nextValue: boolean, reason: string): void {
  if (readinessFinalized === nextValue) {
    return;
  }

  const previousValue = readinessFinalized;
  readinessFinalized = nextValue;
  appendCollectorLog(
    'READY_STATE_CHANGED',
    `previous=${previousValue} next=${nextValue} reason=${reason} state=${status.state} account=${status.connectedAccount ?? 'none'}`,
  );
}

function canAcceptLiveMessages(): boolean {
  if (!readinessFinalized) {
    return false;
  }

  if (status.state === 'ready') {
    return true;
  }

  if (isConnectedAndFinalized()) {
    healReadyStateIfStale('live-message-gate');
    return true;
  }

  return false;
}

function healReadyStateIfStale(trigger: string): void {
  if (status.state === 'ready' || !readinessFinalized || shutdownRequested) {
    return;
  }

  appendCollectorLog(
    'ready-state-healed',
    `trigger=${trigger} previousState=${status.state} readinessFinalized=${readinessFinalized} account=${status.connectedAccount ?? 'none'}`,
  );
  updateStatus(
    {
      state: 'ready',
      lastError: null,
    },
    'ready-state-healed',
    trigger,
  );
}

function updateStatus(partial: Partial<WhatsAppHelperStatusSnapshot>, logEvent?: string, logDetails?: string): void {
  const previousState = status.state;
  const requestedState = partial.state;

  if (requestedState && requestedState !== previousState) {
    if (shouldBlockStateRegression(previousState, requestedState)) {
      appendCollectorLog(
        'STATE_TRANSITION',
        `blocked=true previousState=${previousState} nextState=${requestedState} readinessFinalized=${readinessFinalized} account=${status.connectedAccount ?? 'none'} trigger=${logEvent ?? 'none'}`,
      );
      const { state: _ignoredState, ...rest } = partial;
      partial = rest;
    } else {
      appendCollectorLog(
        'STATE_TRANSITION',
        `blocked=false previousState=${previousState} nextState=${requestedState} readinessFinalized=${readinessFinalized} trigger=${logEvent ?? 'none'}${logDetails ? ` ${logDetails}` : ''}`,
      );
    }
  }

  Object.assign(status, partial);
  if (!('info' in partial) && !('startupStage' in partial)) {
    applyStatusPresentation();
  }
  if (logEvent) {
    appendCollectorLog(logEvent, logDetails);
  }
  emitStatus();
}

function stopForUnexpectedAuthentication(signal: AccountBoundSignal): boolean {
  if (!qrOnlyCertificationGuard.detectAccountBoundSignal(signal)) {
    return false;
  }

  if (unexpectedAuthenticationShutdownStarted) {
    appendCollectorLog('certification-terminal-callback-ignored', `signal=${signal}`);
    return true;
  }

  unexpectedAuthenticationShutdownStarted = true;
  cancelClientInfoWatch();
  clearReadinessTimers();
  clearStartupTimeouts();
  clearGroupDiscoveryTimers();
  resetLiveMessageListenerState();
  updateStatus(
    {
      state: UNEXPECTED_AUTHENTICATION,
      connected: false,
      ready: false,
      connectedAccount: null,
      groups: [],
      contacts: [],
      backfillRunning: false,
      failureCode: UNEXPECTED_AUTHENTICATION,
      info: 'Unexpected authenticated WhatsApp state detected during QR-only certification; collector stopped before account discovery.',
      startupStage: 'QR-only certification stopped',
      lastError: 'Unexpected authentication during QR-only certification.',
      qrCode: null,
      qrPayloadLength: null,
    },
    UNEXPECTED_AUTHENTICATION,
    `signal=${signal}`,
  );
  resolveStartupOnce('failed');
  setImmediate(() => void shutdown(2, { preserveTerminalState: true }));
  return true;
}

function blockAfterCertificationTerminal(event: string): boolean {
  if (!unexpectedAuthenticationShutdownStarted && !qrOnlyCertificationGuard.isTerminal()) {
    return false;
  }
  appendCollectorLog('certification-terminal-callback-ignored', `event=${event}`);
  return true;
}

function canWriteToSessionPath(): boolean {
  try {
    ensureSessionDirectoryWritable();
    return true;
  } catch {
    return false;
  }
}

function ensureSessionDirectoryWritable(): void {
  mkdirSync(SESSION_PATH, { recursive: true });
  const probePath = path.join(SESSION_PATH, '.write-test');
  writeFileSync(probePath, 'ok', 'utf8');
  unlinkSync(probePath);
}

function buildBrowserLaunchPlan(available: ResolvedBrowserExecutable[]): ResolvedBrowserExecutable[] {
  const edge = available.find((browser) => browser.source === 'edge');
  const chrome = available.find((browser) => browser.source === 'chrome');
  const preference = available.length > 0
    ? // preference already applied in resolveBrowserExecutables(); keep Edge→Chrome only for auto.
      (edge && chrome ? [edge, chrome] : available)
    : [];

  if (edge && chrome && preference.length === 2) {
    return [edge, chrome];
  }

  return available.length > 0 ? [available[0]] : [];
}

function isDestructiveLifecycleAllowed(): boolean {
  return operatorLogoutRequested || shutdownRequested;
}

function hasPassedQrScanPhase(): boolean {
  return (
    qrScanDetected ||
    authenticationReachedAttemptId !== null ||
    readinessFinalized ||
    status.state === 'authenticated' ||
    status.state === 'waiting-for-client-info' ||
    status.state === 'ready'
  );
}

function markQrScanDetected(source: string, targetClient: Client | null = client): void {
  if (qrScanDetected) {
    return;
  }

  qrScanDetected = true;
  appendCollectorLog(
    'QR_SCANNED_DETECTED',
    `source=${source} ${describeClientIdentity(targetClient)} pid=${process.pid}`,
  );
}

function rememberPageConsoleError(text: string): void {
  recentPageConsoleErrors.push(`[${new Date().toISOString()}] ${text}`);
  while (recentPageConsoleErrors.length > RECENT_PAGE_CONSOLE_LIMIT) {
    recentPageConsoleErrors.shift();
  }
}

function currentPageUrl(targetClient: Client | null = client): string {
  try {
    return targetClient?.pupPage?.url() || 'none';
  } catch {
    return 'unavailable';
  }
}

function logAuthLifecycle(
  event:
    | 'QR_RECEIVED'
    | 'QR_SCANNED_DETECTED'
    | 'AUTHENTICATED'
    | 'REMOTE_SESSION_SAVED'
    | 'READY'
    | 'DISCONNECTED'
    | 'NAVIGATION_URL'
    | 'LOGOUT_CALL_REQUESTED'
    | 'DESTROY_CALL_REQUESTED'
    | 'SESSION_DELETE_REQUESTED',
  details?: string,
  targetClient: Client | null = client,
): void {
  appendCollectorLog(
    event,
    [
      details,
      `pageUrl=${currentPageUrl(targetClient)}`,
      `collectorState=${status.state}`,
      `operatorLogoutRequested=${operatorLogoutRequested}`,
      `shutdownRequested=${shutdownRequested}`,
      `qrScanDetected=${qrScanDetected}`,
      `pid=${process.pid}`,
      describeClientIdentity(targetClient),
    ]
      .filter(Boolean)
      .join(' '),
  );
}

function logBrowserLaunchConfiguration(
  executablePath: string,
  browserSource: ResolvedBrowserExecutable['source'],
): void {
  const summary = buildWhatsAppLaunchConfigSummary({
    executablePath,
    browserSource,
    headless: BROWSER_HEADLESS,
    sessionPath: SESSION_PATH,
    userDataDir: sessionProfileDirectory(),
    clientId: LOCAL_AUTH_CLIENT_ID,
  });

  appendCollectorLog('browser-launch-config', summary);
}

function attachBrowserProcessDiagnostics(browser: NonNullable<Client['pupBrowser']>): void {
  const child = browser.process();
  if (!child) {
    appendCollectorLog('browser-process-missing', 'browser.process() returned null');
    return;
  }

  appendCollectorLog('browser-process-attached', `pid=${child.pid ?? 'unknown'}`);

  child.stdout?.on('data', (chunk: Buffer | string) => {
    const text = chunk.toString().trim();
    if (text) {
      appendCollectorLog('browser-process-stdout', text);
    }
  });

  child.stderr?.on('data', (chunk: Buffer | string) => {
    const text = chunk.toString().trim();
    if (!text) {
      return;
    }

    appendCollectorLog('browser-process-stderr', text);
    if (isSessionCorruptionSignal(text)) {
      reportSessionCorruption('browser-process-stderr', text);
    }
  });

  child.on('exit', (code, signal) => {
    appendCollectorLog(
      'browser-process-exit',
      `code=${code ?? 'null'} signal=${signal ?? 'null'}`,
    );
  });
}

async function waitForPuppeteerBrowser(
  currentClient: Client,
  timeoutMs = 30_000,
): Promise<NonNullable<Client['pupBrowser']> | undefined> {
  const startedAt = Date.now();
  while (!currentClient.pupBrowser && Date.now() - startedAt < timeoutMs) {
    await sleep(250);
  }

  return currentClient.pupBrowser ?? undefined;
}

async function verifyBrowserLaunch(
  currentClient: Client,
  executablePath: string,
  browserSource: ResolvedBrowserExecutable['source'],
): Promise<boolean> {
  const browser = await waitForPuppeteerBrowser(currentClient);
  if (!browser) {
    appendCollectorLog(
      'browser-verify-failed',
      `pupBrowser missing executable=${executablePath} source=${browserSource}`,
    );
    return false;
  }

  attachBrowserProcessDiagnostics(browser);

  appendCollectorLog(
    'APP_BROWSER_LAUNCH_SUCCESS',
    `executable=${executablePath} source=${browserSource} connected=${browser.isConnected()}`,
  );

  try {
    const pages = await browser.pages();
    appendCollectorLog('browser-pages', `count=${pages.length}`);
  } catch (error) {
    appendCollectorLog(
      'browser-pages-error',
      error instanceof Error ? error.message : String(error),
    );
  }

  const page = currentClient.pupPage;
  if (!page) {
    appendCollectorLog('browser-verify-failed', 'pupPage missing after browser launch');
    return false;
  }

  appendCollectorLog(
    'APP_BROWSER_PAGE_CREATED',
    `executable=${executablePath} source=${browserSource} url=${page.url()}`,
  );

  return true;
}

function reportBrowserAutomationFailure(reason: string): void {
  appendCollectorLog('browser-automation-failed', reason);
  const userMessage = isProfileLockErrorMessage(reason)
    ? reason
    : reason.trim().length > 0 && !reason.includes(BROWSER_AUTOMATION_FAILED_MESSAGE)
      ? reason
      : BROWSER_AUTOMATION_FAILED_MESSAGE;
  updateStatus(
    {
      state: 'failed',
      startupStage: isProfileLockErrorMessage(reason) ? 'Browser profile locked' : 'Browser automation failed',
      lastError: userMessage,
      info: userMessage,
      lastDisconnectAt: new Date().toISOString(),
    },
    'browser-automation-failed',
    reason,
  );
}

async function prepareBrowserLaunch(attemptIndex: number): Promise<void> {
  appendCollectorLog('browser-launch-started', `attempt=${attemptIndex + 1} sessionPath=${SESSION_PATH}`);

  if (isSessionHealthy()) {
    appendCollectorLog('browser-launch-prep-skipped', 'healthy-session');
    return;
  }

  const profileDir = sessionProfileDirectory();
  const hasExistingSession = existsSync(profileDir);

  if (client && !isPostAuthStartupProtected(client)) {
    await closeBrowserGracefully(client, 'prepareBrowserLaunch');
    client = null;
  }

  await ensureProfileUnlocked(profileDir, (event, details) => {
    appendCollectorLog(event, details);
  });

  if (attemptIndex > 0 && !isSessionHealthy()) {
    await releaseStaleBrowserSession();
  } else if (hasExistingSession) {
    appendCollectorLog('browser-launch-prep-existing-session', profileDir);
  } else {
    ensureSessionDirectoryWritable();
  }

  appendCollectorLog('browser-launch-prep-finished', `attempt=${attemptIndex + 1} healthy=${isSessionHealthy()}`);
}

function sessionProfileDirectory(): string {
  return path.join(SESSION_PATH, SESSION_PROFILE_DIR);
}

async function closeBrowserGracefully(
  currentClient: Client | null,
  reason = 'unspecified',
): Promise<void> {
  if (!currentClient) {
    return;
  }

  logDestructiveAction('client.destroy', reason, currentClient);

  if (hasPassedQrScanPhase() && !isDestructiveLifecycleAllowed()) {
    appendCollectorLog(
      'client-destroy-blocked',
      `reason=${reason} blocked-after-qr-scan ${describeClientIdentity(currentClient)}`,
    );
    return;
  }

  if (isPostAuthStartupProtected(currentClient) && !isDestructiveLifecycleAllowed()) {
    appendCollectorLog(
      'client-destroy-blocked',
      `reason=${reason} ${describeClientIdentity(currentClient)}`,
    );
    return;
  }

  try {
    appendCollectorLog('browser-close-start', `destroy without logout or session delete reason=${reason}`);
    await currentClient.destroy();
    logLifecycleEvent('client.destroy', `completed reason=${reason}`, currentClient);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    appendCollectorLog('browser-close-error', message);
    if (isSessionCorruptionSignal(message)) {
      reportSessionCorruption('browser-close-error', message);
    }
  }
}

async function releaseStaleBrowserSession(): Promise<void> {
  logDestructiveAction('releaseStaleBrowserSession', 'startup-retry-or-fallback', client);

  if (isSessionHealthy() || isPostAuthStartupProtected(client)) {
    appendCollectorLog(
      'browser-reuse-skipped',
      isSessionHealthy() ? 'healthy-session' : `post-auth-protected ${describeClientIdentity(client)}`,
    );
    return;
  }

  appendCollectorLog('browser-reuse-start', `sessionPath=${SESSION_PATH}`);
  await closeBrowserGracefully(client, 'releaseStaleBrowserSession');
  client = null;
  await ensureProfileUnlocked(sessionProfileDirectory(), (event, details) => {
    appendCollectorLog(event, details);
  });
  appendCollectorLog('browser-reuse-finished', `sessionPath=${SESSION_PATH} sessionFilesPreserved=true`);
}

function clearQrScanAuthenticatedTimeout(): void {
  if (qrScanAuthenticatedTimeout) {
    clearTimeout(qrScanAuthenticatedTimeout);
    qrScanAuthenticatedTimeout = null;
  }
}

function clearReadinessTimers(): void {
  clearQrScanAuthenticatedTimeout();
}

function scheduleQrScanAuthenticatedTimeout(currentClient: Client, attemptId: number): void {
  clearQrScanAuthenticatedTimeout();
  if (hasReachedAuthenticationPhase(attemptId) || readinessFinalized) {
    appendCollectorLog(
      'qr-scan-timeout-skipped',
      `already-authenticated ${describeClientIdentity(currentClient, attemptId)}`,
    );
    return;
  }

  qrScanAuthenticatedTimeout = setTimeout(() => {
    if (
      shutdownRequested ||
      readinessFinalized ||
      hasReachedAuthenticationPhase(attemptId) ||
      status.state === 'authenticated' ||
      status.state === 'waiting-for-client-info' ||
      status.state === 'ready' ||
      attemptId !== activeStartupAttemptId ||
      currentClient !== client
    ) {
      appendCollectorLog(
        'qr-scan-timeout-ignored',
        describeClientIdentity(currentClient, attemptId),
      );
      return;
    }

    appendCollectorLog(
      'qr-scan-timeout',
      `authenticated-event missing after ${QR_SCAN_AUTHENTICATED_TIMEOUT_MS}ms ${describeClientIdentity(currentClient, attemptId)}`,
    );

    void (async () => {
      if (hasPassedQrScanPhase() && !isDestructiveLifecycleAllowed()) {
        appendCollectorLog(
          'qr-scan-timeout-destroy-blocked',
          describeClientIdentity(currentClient, attemptId),
        );
        return;
      }

      await fullyDestroyClientSession(currentClient, 'qr-scan-timeout');
      updateStatus(
        {
          state: 'failed',
          qrCode: null,
          qrPayloadLength: null,
          info: QR_SCAN_INCOMPLETE_MESSAGE,
          lastError: QR_SCAN_INCOMPLETE_MESSAGE,
          lastDisconnectAt: new Date().toISOString(),
        },
        'qr-scan-timeout',
        QR_SCAN_INCOMPLETE_MESSAGE,
      );
      resolveStartupOnce('failed');
    })().catch((error) => {
      appendCollectorLog('qr-scan-timeout-error', error instanceof Error ? error.message : String(error));
      resolveStartupOnce('failed');
    });
  }, QR_SCAN_AUTHENTICATED_TIMEOUT_MS);
}

function cancelClientInfoWatch(): void {
  if (activeClientInfoWatch) {
    activeClientInfoWatch.cancelled = true;
    activeClientInfoWatch = null;
  }
}

async function resolveConnectedAccountId(currentClient: Client): Promise<string | null> {
  try {
    const immediate = currentClient.info?.wid?._serialized?.trim();
    if (immediate) {
      return immediate;
    }

    try {
      await currentClient.getState();
    } catch {
      // Client info may populate after state probe.
    }

    const afterState = currentClient.info?.wid?._serialized?.trim();
    if (afterState) {
      return afterState;
    }

    const fromPage = await currentClient.pupPage?.evaluate(() => {
      const store = (window as {
        Store?: {
          User?: { getMe?: () => { id?: { _serialized?: string } } };
          Conn?: { wid?: { _serialized?: string } };
        };
      }).Store;

      return (
        store?.User?.getMe?.()?.id?._serialized?.trim() ??
        store?.Conn?.wid?._serialized?.trim() ??
        null
      );
    });

    if (typeof fromPage === 'string' && fromPage.trim()) {
      return fromPage.trim();
    }
  } catch (error) {
    appendCollectorLog('connected-account-resolve-error', formatRuntimeError(error));
  }

  return null;
}

async function resolveConnectedAccountWithRetry(
  currentClient: Client,
  timeoutMs = 15_000,
): Promise<string | null> {
  if (blockAfterCertificationTerminal('resolve-client-identity')) {
    return null;
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !shutdownRequested) {
    const account = await resolveConnectedAccountId(currentClient);
    if (account) {
      return account;
    }

    await sleep(500);
  }

  return null;
}

async function probeClientAccount(currentClient: Client): Promise<string | null> {
  return resolveConnectedAccountId(currentClient);
}

async function logLoadedWhatsAppWebVersion(currentClient: Client, trigger: string): Promise<void> {
  const snapshot = getWhatsAppWebVersionLogSnapshot();
  appendCollectorLog(
    'WWEB_VERSION_REQUESTED',
    `trigger=${trigger} mode=${snapshot.mode} version=${snapshot.requestedVersion}`,
  );
  appendCollectorLog(
    'WWEB_CACHE_MODE',
    `trigger=${trigger} mode=${snapshot.cacheMode} strict=${snapshot.cacheStrict} htmlExists=${snapshot.htmlExists} htmlPath=${snapshot.htmlPath ?? 'n/a'}`,
  );
  appendCollectorLog(
    'WWEB_HTML_SHA256',
    `trigger=${trigger} sha256=${snapshot.htmlSha256 ?? 'n/a'} requested=${snapshot.requestedVersion}`,
  );

  try {
    const loadedVersion = await currentClient.pupPage?.evaluate(() => {
      const debugVersion = (window as { Debug?: { VERSION?: string } }).Debug?.VERSION;
      return debugVersion ?? 'unknown';
    });
    appendCollectorLog(
      'WWEB_VERSION_LOADED',
      `trigger=${trigger} configured=${snapshot.requestedVersion} loaded=${loadedVersion ?? 'unknown'} pinConfigured=${WHATSAPP_WEB_VERSION}`,
    );
    appendCollectorLog(
      'whatsapp-web-version-loaded',
      `trigger=${trigger} configured=${snapshot.requestedVersion} loaded=${loadedVersion ?? 'unknown'}`,
    );
  } catch (error) {
    appendCollectorLog(
      'WWEB_VERSION_LOADED',
      `trigger=${trigger} configured=${snapshot.requestedVersion} error=${error instanceof Error ? error.message : String(error)}`,
    );
    appendCollectorLog(
      'whatsapp-web-version-loaded',
      `trigger=${trigger} configured=${snapshot.requestedVersion} error=${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function logWhatsAppRuntimePackages(trigger: string): void {
  const versions = readWhatsAppRuntimePackageVersions();
  const browserPath = activeBrowserLaunch?.executablePath ?? status.browserExecutablePath ?? 'unknown';
  appendCollectorLog('whatsapp-runtime-packages', `trigger=${trigger} ${formatWhatsAppRuntimeConfigSummary()}`);
  appendCollectorLog(
    'whatsapp-runtime-combo',
    [
      `trigger=${trigger}`,
      `wwebjs=${versions.whatsappWebJs}`,
      `puppeteer=${versions.puppeteer}`,
      `puppeteerCore=${versions.puppeteerCore}`,
      `browserExecutable=${browserPath}`,
      `browserSource=${status.browserExecutableSource ?? 'unknown'}`,
      `browserVersion=${browserPath !== 'unknown' ? readBrowserExecutableVersion(browserPath) : 'unknown'}`,
      formatWhatsAppRuntimeConfigSummary(),
    ].join(' '),
  );
}

async function probePostAuthStoreCompatibility(currentClient: Client): Promise<WwebjsStoreProbeResult> {
  const result: WwebjsStoreProbeResult = {
    hasWindowStore: false,
    hasAuthStore: false,
    hasChatCollection: false,
    hasMsgCollection: false,
    socketModuleId: null,
    socketStrategy: null,
    missingDependencies: [],
    waState: null,
    getChatsOk: null,
    getChatsError: null,
    getChatsCount: null,
    chatCollectionReadOk: false,
    chatCollectionReadError: null,
    chatModelCount: null,
  };

  if (!currentClient.pupPage) {
    result.missingDependencies.push('pupPage');
    return result;
  }

  try {
    const pageProbe = await currentClient.pupPage.evaluate(() => {
      const scoped = window as typeof window & {
        Store?: { Chat?: unknown; Msg?: unknown };
        AuthStore?: { AppState?: unknown; __socketModuleId?: string; __socketStrategy?: string };
        WWebJS?: { getChats?: unknown };
        require?: (id: string) => unknown;
      };

      const missing: string[] = [];
      const hasWindowStore = typeof scoped.Store !== 'undefined';
      const hasAuthStore = typeof scoped.AuthStore !== 'undefined';
      let hasChatCollection = Boolean(scoped.Store?.Chat);
      let hasMsgCollection = Boolean(scoped.Store?.Msg);
      let chatCollectionReadOk = false;
      let chatCollectionReadError: string | null = null;
      let chatModelCount: number | null = null;

      if (!hasChatCollection && typeof scoped.require === 'function') {
        try {
          const collections = scoped.require('WAWebCollections') as {
            Chat?: unknown;
            Msg?: unknown;
          };
          hasChatCollection = Boolean(collections?.Chat);
          hasMsgCollection = Boolean(collections?.Msg);
          const chatCollection = collections?.Chat as { getModelsArray?: () => unknown[] } | undefined;
          if (typeof chatCollection?.getModelsArray === 'function') {
            const models = chatCollection.getModelsArray();
            chatCollectionReadOk = Array.isArray(models);
            chatModelCount = Array.isArray(models) ? models.length : null;
          }
        } catch (error) {
          missing.push('WAWebCollections');
          chatCollectionReadError = error instanceof Error ? error.message : String(error);
        }
      }

      if (!hasWindowStore) {
        // 1.34.7 no longer always exposes window.Store — collections via require are enough.
      }
      if (!hasAuthStore) {
        missing.push('AuthStore');
      }
      if (!hasChatCollection) {
        missing.push('Chat');
      }
      if (!hasMsgCollection) {
        missing.push('Msg');
      }

      return {
        hasWindowStore,
        hasAuthStore,
        hasChatCollection,
        hasMsgCollection,
        socketModuleId: scoped.AuthStore?.__socketModuleId ?? null,
        socketStrategy: scoped.AuthStore?.__socketStrategy ?? null,
        missingDependencies: missing,
        hasWWebJSGetChats: typeof scoped.WWebJS?.getChats === 'function',
        chatCollectionReadOk,
        chatCollectionReadError,
        chatModelCount,
      };
    });

    result.hasWindowStore = pageProbe.hasWindowStore;
    result.hasAuthStore = pageProbe.hasAuthStore;
    result.hasChatCollection = pageProbe.hasChatCollection;
    result.hasMsgCollection = pageProbe.hasMsgCollection;
    result.socketModuleId = pageProbe.socketModuleId;
    result.socketStrategy = pageProbe.socketStrategy;
    result.chatCollectionReadOk = pageProbe.chatCollectionReadOk;
    result.chatCollectionReadError = pageProbe.chatCollectionReadError;
    result.chatModelCount = pageProbe.chatModelCount;
    result.missingDependencies.push(...pageProbe.missingDependencies);
    if (!pageProbe.hasWWebJSGetChats) {
      result.missingDependencies.push('WWebJS.getChats');
    }
  } catch (error) {
    result.missingDependencies.push('page-evaluate');
    result.getChatsError = error instanceof Error ? error.message : String(error);
  }

  try {
    result.waState = await currentClient.getState();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result.missingDependencies.push('getState');
    if (isWwebjsModuleCompatibilitySignal(message)) {
      rememberModuleCompatibilitySignal(message);
    }
    result.getChatsError = result.getChatsError ?? message;
  }

  // Full getChats() serializes every chat and belongs to discovery. Basic
  // authenticated readiness only requires a safe read of the current Chat
  // collection, performed above without exposing chat contents.

  appendCollectorLog(
    'POST_AUTH_COMPAT_PROBE',
    [
      `hasStore=${result.hasWindowStore}`,
      `hasAuthStore=${result.hasAuthStore}`,
      `hasChat=${result.hasChatCollection}`,
      `hasMsg=${result.hasMsgCollection}`,
      `socketModule=${result.socketModuleId ?? 'none'}`,
      `socketStrategy=${result.socketStrategy ?? 'none'}`,
      `waState=${result.waState ?? 'unknown'}`,
      `getChatsOk=${result.getChatsOk}`,
      `getChatsCount=${result.getChatsCount ?? 'n/a'}`,
      `missing=${result.missingDependencies.join(',') || 'none'}`,
      `getChatsError=${result.getChatsError ?? 'none'}`,
      `chatCollectionReadOk=${result.chatCollectionReadOk}`,
      `chatModelCount=${result.chatModelCount ?? 'n/a'}`,
      `chatCollectionReadError=${result.chatCollectionReadError ?? 'none'}`,
    ].join(' '),
  );

  return result;
}

async function waitForPostAuthCompatibility(
  currentClient: Client,
  timeoutMs = POST_AUTH_COMPATIBILITY_TIMEOUT_MS,
): Promise<{ probe: WwebjsStoreProbeResult; failure: ReturnType<typeof classifyPostAuthCompatibility> }> {
  const deadline = Date.now() + timeoutMs;
  let probe = await probePostAuthStoreCompatibility(currentClient);
  let failure = classifyPostAuthCompatibility(probe);
  while (failure && Date.now() < deadline && !shutdownRequested) {
    if (currentClient !== client || !currentClient.pupPage) {
      return { probe, failure: 'PAGE_GENERATION_CHANGED' };
    }
    await sleep(500);
    probe = await probePostAuthStoreCompatibility(currentClient);
    failure = classifyPostAuthCompatibility(probe);
  }
  return { probe, failure };
}

function logMediaListenerCounts(target: Client, trigger: string): void {
  appendCollectorLog(
    'media-listener-counts',
    `trigger=${trigger} attached=${liveMediaListenersAttached} message=${target.listenerCount('message')} message_create=${target.listenerCount('message_create')} media_uploaded=${target.listenerCount('media_uploaded')}`,
  );
}

function describeFrameNavigation(frame: { url(): string; navigationType?: () => string }): string {
  try {
    return frame.navigationType?.() ?? 'navigated';
  } catch {
    return 'navigated';
  }
}

async function probeWhatsAppConnectionState(currentClient: Client): Promise<string | null> {
  try {
    return await currentClient.getState();
  } catch (error) {
    appendCollectorLog(
      'waiting-for-client-info',
      `state-probe-error=${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

async function finalizeClientReady(
  currentClient: Client,
  context: {
    headless: boolean;
    browserPath: string;
    readySource: 'ready-event' | 'client-info-detected';
  },
): Promise<void> {
  if (blockAfterCertificationTerminal('finalize-ready')) {
    return;
  }
  if (stopForUnexpectedAuthentication('client-identity')) {
    return;
  }
  if (shutdownRequested) {
    return;
  }

  if (readinessFinalized && status.state === 'ready') {
    return;
  }

  cancelClientInfoWatch();
  clearReadinessTimers();
  clearStartupTimeouts();

  let connectedAccount: string | null = status.connectedAccount;
  try {
    connectedAccount = (await resolveConnectedAccountWithRetry(currentClient)) ?? connectedAccount;
  } catch {
    connectedAccount = status.connectedAccount;
  }

  if (connectedAccount) {
    appendCollectorLog('LINKED_ACCOUNT_DISCOVERED', `account=${connectedAccount}`);
  }

  updateStatus(
    {
      state: 'waiting-for-client-info',
      qrCode: null,
      qrPayloadLength: null,
      connectedAccount,
      lastError: null,
      info: 'WhatsApp linked — verifying chat store before ready…',
      startupStage: 'Verifying chat store',
    },
    'chat-store-probe-start',
    `source=${context.readySource} account=${connectedAccount ?? 'unknown'}`,
  );

  logWhatsAppRuntimePackages(context.readySource);
  await logLoadedWhatsAppWebVersion(currentClient, context.readySource);

  const compatibility = await waitForPostAuthCompatibility(currentClient);
  const compatProbe = compatibility.probe;
  if (compatibility.failure) {
    appendCollectorLog(
      'CHAT_STORE_NOT_READY',
      `source=${context.readySource} reason=${compatibility.failure} account=${connectedAccount ?? 'unknown'} ${describeClientForDiscovery(currentClient)}`,
    );

    const treatAsCompat = shouldTreatAsModuleCompatibilityFailure({
      authenticated: true,
      ready: false,
      pageSignals: moduleCompatibilitySignals,
      chatStoreNotReady: true,
      lastError: compatProbe.getChatsError,
    });

    if (treatAsCompat || compatibility.failure) {
      reportModuleCompatibilityFailure(
        'chat-store-not-ready-after-authenticated',
        `reason=${compatibility.failure} account=${connectedAccount ?? 'unknown'} source=${context.readySource}`,
        compatProbe,
      );
    } else {
      updateStatus(
        {
          state: 'authenticated',
          connectedAccount,
          failureCode: WWEBJS_MODULE_COMPATIBILITY_ERROR,
          info: CHAT_STORE_UNAVAILABLE_MESSAGE,
          lastError: WWEBJS_MODULE_COMPATIBILITY_USER_MESSAGE,
        },
        'chat-store-not-ready',
        `source=${context.readySource}`,
      );
      resolveStartupOnce('failed');
    }

    if (CHAT_DISCOVERY_SMOKE_MODE) {
      appendCollectorLog('CHAT_DISCOVERY_SMOKE_FAIL', 'chat-store-not-ready-before-ready');
      setTimeout(() => void shutdown(1), 500);
    }
    return;
  }

  const firstReadyFinalization = !readinessFinalized;
  setReadinessFinalized(true, context.readySource);

  updateStatus(
    {
      state: 'ready',
      qrCode: null,
      qrPayloadLength: null,
      connectedAccount,
      lastReadyAt: new Date().toISOString(),
      lastError: null,
      sessionCorruptionSuspected: false,
      sessionCorruptionMessage: null,
    },
    'ready-event',
    `source=${context.readySource} headless=${context.headless} browser=${context.browserPath} account=${connectedAccount ?? 'unknown'} first=${firstReadyFinalization}`,
  );

  if (firstReadyFinalization) {
    clearLatestQrPayload();
    if (isQrOnlyCertificationMode()) {
      clearGroupDiscoveryTimers();
      resetLiveMessageListenerState();
      appendCollectorLog(
        'CONNECTED_CERTIFICATION_IDLE',
        'discovery=0 mapping=0 backfill=0 ingestionListeners=0 sending=0',
      );
    } else {
      attachLiveMediaListenersOnce(currentClient);
      if (client) {
        logMediaListenerCounts(client, 'ready-event');
      }
      await refreshDiscoveredChats();
      scheduleChatDiscoveryAfterReady(context.readySource);
      setTimeout(() => verifyAndReattachLiveMediaListeners('post-ready'), 2_000);
    }
    startReadyHeartbeat();
    resolveStartupOnce('ready');

    if (CHAT_DISCOVERY_SMOKE_MODE) {
      void runChatDiscoverySmoke(currentClient)
        .then((passed) => {
          setTimeout(() => void shutdown(passed ? 0 : 1), 500);
        })
        .catch((error) => {
          appendCollectorLog(
            'CHAT_DISCOVERY_SMOKE_FAIL',
            error instanceof Error ? error.message : String(error),
          );
          setTimeout(() => void shutdown(1), 500);
        });
      return;
    }
  }

  if (SMOKE_MODE && firstReadyFinalization) {
    setTimeout(() => void shutdown(0), 2_000);
  }
}

async function watchClientInfoAfterAuthentication(
  currentClient: Client,
  edgeExecutablePath: string,
  attemptId: number,
): Promise<void> {
  if (blockAfterCertificationTerminal('watch-client-info')) {
    return;
  }
  if (shutdownRequested || readinessFinalized || status.state === 'ready') {
    appendCollectorLog(
      'waiting-for-client-info',
      `skipped-already-ready state=${status.state} readinessFinalized=${readinessFinalized}`,
    );
    return;
  }

  cancelClientInfoWatch();
  const watch = { cancelled: false, attemptId };
  activeClientInfoWatch = watch;

  appendCollectorLog(
    'waiting-for-client-info',
    `browser=${edgeExecutablePath} headless=${BROWSER_HEADLESS} attemptId=${attemptId}`,
  );

  if (!readinessFinalized) {
    updateStatus(
      {
        state: 'waiting-for-client-info',
        lastError: null,
      },
      'authenticated-event',
      `awaiting-client-info browser=${edgeExecutablePath}`,
    );
  }

  const deadline = Date.now() + AUTHENTICATED_READY_TIMEOUT_MS;
  while (!watch.cancelled && Date.now() < deadline && !readinessFinalized && !shutdownRequested) {
    if (client !== currentClient || activeStartupAttemptId !== attemptId) {
      appendCollectorLog('waiting-for-client-info', 'cancelled-stale-client');
      return;
    }

    const waState = await probeWhatsAppConnectionState(currentClient);
    const accountId = await probeClientAccount(currentClient);
    appendCollectorLog(
      'waiting-for-client-info',
      `waState=${waState ?? 'unknown'} account=${accountId ?? 'none'}`,
    );

    if (accountId) {
      appendCollectorLog(
        'client-info-detected',
        `account=${accountId} waState=${waState ?? 'unknown'}`,
      );
      await finalizeClientReady(currentClient, {
        headless: BROWSER_HEADLESS,
        browserPath: edgeExecutablePath,
        readySource: 'client-info-detected',
      });
      return;
    }

    await sleep(CLIENT_INFO_POLL_MS);
  }

  if (!readinessFinalized && !watch.cancelled) {
    appendCollectorLog('ready-timeout', `ready not reached within ${AUTHENTICATED_READY_TIMEOUT_MS}ms after authenticated-event`);

    const treatAsCompat = shouldTreatAsModuleCompatibilityFailure({
      authenticated: true,
      ready: false,
      pageSignals: moduleCompatibilitySignals,
      timedOutAfterAuth: true,
      lastError: status.lastError,
    });

    if (treatAsCompat) {
      reportModuleCompatibilityFailure(
        'authenticated-ready-timeout',
        `authenticated=true ready=false timeoutMs=${AUTHENTICATED_READY_TIMEOUT_MS}`,
      );
      return;
    }

    updateStatus(
      {
        state: status.connectedAccount ? 'authenticated' : 'failed',
        info: 'Patrol monitoring could not reach ready state after authentication.',
        lastError: 'WhatsApp authenticated but ready was not reached.',
        lastDisconnectAt: new Date().toISOString(),
      },
      'ready-timeout',
      `state=${status.state}`,
    );
    resolveStartupOnce('failed');
  }
}

async function fullyDestroyClientSession(
  currentClient: Client | null,
  reason = 'unspecified',
): Promise<void> {
  logDestructiveAction('fullyDestroyClientSession', reason, currentClient);

  if (hasPassedQrScanPhase() && !isDestructiveLifecycleAllowed()) {
    appendCollectorLog(
      'session-destroy-skipped',
      `blocked-after-qr-scan reason=${reason} ${describeClientIdentity(currentClient)}`,
    );
    return;
  }

  if ((isSessionHealthy() || isPostAuthStartupProtected(currentClient)) && !isDestructiveLifecycleAllowed()) {
    appendCollectorLog(
      'session-destroy-skipped',
      isSessionHealthy()
        ? 'healthy-session'
        : `post-auth-protected reason=${reason} ${describeClientIdentity(currentClient)}`,
    );
    return;
  }

  cancelClientInfoWatch();
  clearReadinessTimers();
  clearStartupTimeouts();
  await closeBrowserGracefully(currentClient, `fullyDestroyClientSession:${reason}`);
  if (currentClient && client === currentClient) {
    client = null;
  }
  await sleep(2_000);
  appendCollectorLog(
    'session-destroy-finished',
    `sessionPath=${SESSION_PATH} sessionFilesPreserved=true reason=${reason}`,
  );
}

async function loadWhatsAppRuntimeModule(): Promise<WhatsAppRuntimeModule> {
  if (!runtimeModulePromise) {
    runtimeModulePromise = import('whatsapp-web.js');
  }

  return runtimeModulePromise;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createStartupGate(): Promise<StartupGateOutcome> {
  return new Promise<StartupGateOutcome>((resolve, reject) => {
    startupResolve = resolve;
    startupReject = reject;
  });
}

function resolveStartupOnce(outcome: StartupGateOutcome): void {
  if (startupGateResolved) {
    return;
  }

  startupGateResolved = true;
  resolveStartup(outcome);
}

function resolveStartup(outcome: StartupGateOutcome): void {
  if (!startupResolve) {
    return;
  }

  const resolve = startupResolve;
  startupResolve = null;
  startupReject = null;
  resolve(outcome);
}

function rejectStartup(error: unknown): void {
  if (!startupReject) {
    return;
  }

  const reject = startupReject;
  startupResolve = null;
  startupReject = null;
  reject(error);
}

function formatConsoleArgs(values: unknown[]): string {
  return values
    .map((value) => {
      if (typeof value === 'string') {
        return value;
      }

      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    })
    .join(' ');
}

async function attachPageDiagnostics(currentClient: Client): Promise<void> {
  const startedAt = Date.now();
  while (!currentClient.pupPage && Date.now() - startedAt < 30_000) {
    await sleep(250);
  }

  const page = currentClient.pupPage;
  if (!page) {
    appendCollectorLog('page-diagnostics-missing', 'Puppeteer page was not available within 30 seconds.');
    reportBrowserAutomationFailure('Puppeteer page was not available within 30 seconds.');
    rejectStartup(new Error(BROWSER_AUTOMATION_FAILED_MESSAGE));
    return;
  }

  if (diagnosedPages.has(page)) {
    return;
  }

  if (!browserLaunchCompletedAt) {
    browserLaunchCompletedAt = Date.now();
    appendCollectorLog(
      'browser-launch-complete',
      `elapsedMs=${browserLaunchStartedAt ? browserLaunchCompletedAt - browserLaunchStartedAt : 'unknown'}`,
    );
  }

  diagnosedPages.add(page);
  appendCollectorLog('page-diagnostics-attached', 'Puppeteer page listeners registered.');

  page.on('console', (message) => {
    const text = message.text();
    if (isWwebjsModuleCompatibilitySignal(text) || /Requiring unknown module\s+"?WAWeb/i.test(text)) {
      rememberModuleCompatibilitySignal(text);
      appendCollectorLog('whatsapp-module-compat-warning', text);
      appendCollectorLog(WWEBJS_MODULE_COMPATIBILITY_ERROR, `page-console ${text}`);
      // Do not classify as logout/session corruption.
      if (
        hasReachedAuthenticationPhase() &&
        !readinessFinalized &&
        !moduleCompatibilityFailureReported
      ) {
        reportModuleCompatibilityFailure('page-console', text);
      }
      return;
    }

    if (message.type() === 'error' || isSessionCorruptionSignal(text)) {
      rememberPageConsoleError(`type=${message.type()} ${text}`);
    }

    if (isSessionCorruptionSignal(text)) {
      reportSessionCorruption('page-console', text);
    }

    appendCollectorLog(
      'page-console',
      `type=${message.type()} text=${text} args=${formatConsoleArgs(message.args().map(() => '[arg]'))}`,
    );
  });

  page.on('pageerror', (error) => {
    const details = formatRuntimeError(error);
    rememberPageConsoleError(details);
    if (isWwebjsModuleCompatibilitySignal(details)) {
      rememberModuleCompatibilitySignal(details);
      appendCollectorLog(WWEBJS_MODULE_COMPATIBILITY_ERROR, `page-pageerror ${details}`);
      if (
        hasReachedAuthenticationPhase() &&
        !readinessFinalized &&
        !moduleCompatibilityFailureReported
      ) {
        reportModuleCompatibilityFailure('page-pageerror', details);
      }
      return;
    }
    if (isSessionCorruptionSignal(details)) {
      reportSessionCorruption('page-pageerror', details);
    }
    appendCollectorLog('page-pageerror', details);
  });

  page.on('error', (error) => {
    appendCollectorLog('page-error', formatRuntimeError(error));
    if (readinessFinalized && status.state === 'ready' && isRecoverableContextError(error)) {
      scheduleLiveMediaListenerReattachAfterNavigation(page.url(), 'page-error');
    }
  });

  page.on('requestfailed', (request) => {
    const failureText = request.failure()?.errorText ?? 'unknown';
    if (isSessionCorruptionSignal(failureText)) {
      reportSessionCorruption('page-request-failed', `${request.url()} ${failureText}`);
    }
    appendCollectorLog(
      'page-request-failed',
      `url=${request.url()} method=${request.method()} error=${failureText}`,
    );
  });

  page.on('response', (response) => {
    if (response.status() >= 400) {
      appendCollectorLog('page-response-error', `status=${response.status()} url=${response.url()}`);
    }
  });

  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) {
      const url = frame.url();
      const reason = describeFrameNavigation(frame);
      logAuthLifecycle('NAVIGATION_URL', `url=${url} reason=${reason}`, currentClient);
      appendCollectorLog(
        'page-mainframe-navigated',
        `url=${url} reason=${reason} ${describeClientIdentity(currentClient)}`,
      );

      if (/web\.whatsapp\.com\/?\?.*post_logout=1/i.test(url) || url.includes('post_logout=')) {
        let logoutReason = 'unknown';
        try {
          logoutReason = new URL(url).searchParams.get('logout_reason') || 'unknown';
        } catch {
          const match = url.match(/[?&]logout_reason=([^&]+)/i);
          logoutReason = match?.[1] ? decodeURIComponent(match[1]) : 'unknown';
        }

        appendCollectorLog(
          'post-logout-navigation-detected',
          [
            `url=${url}`,
            `logout_reason=${logoutReason}`,
            `authPhase=${hasReachedAuthenticationPhase()}`,
            `qrScanDetected=${qrScanDetected}`,
            `readinessFinalized=${readinessFinalized}`,
            `operatorLogoutRequested=${operatorLogoutRequested}`,
            `recentConsoleErrors=${recentPageConsoleErrors.slice(-8).join(' || ') || 'none'}`,
            describeClientIdentity(currentClient),
          ].join(' '),
        );

        // A post_logout navigation is also produced by QR expiry and is not
        // evidence that the phone accepted the current QR.
      }

      scheduleLiveMediaListenerReattachAfterNavigation(url, reason);
    }
  });

  page.on('domcontentloaded', () => {
    appendCollectorLog('page-domcontentloaded');
  });

  page.on('load', () => {
    whatsappPageLoadedAt = Date.now();
    const sinceLaunchMs = browserLaunchStartedAt ? whatsappPageLoadedAt - browserLaunchStartedAt : null;
    appendCollectorLog(
      'whatsapp-page-loaded',
      `url=${page.url()} sinceLaunchMs=${sinceLaunchMs ?? 'unknown'} ${describeClientIdentity(currentClient)}`,
    );
    appendCollectorLog('page-load', `url=${page.url()}`);
    clearBrowserLaunchGraceTimeout();

    if (readinessFinalized && status.state === 'ready') {
      scheduleLiveMediaListenerReattachAfterNavigation(page.url(), 'load');
    }

    if (hasReachedAuthenticationPhase() || readinessFinalized) {
      // Never re-arm QR/browser startup timers after the phone has linked.
      return;
    }

    if (
      !status.qrCode &&
      status.state !== 'ready' &&
      status.state !== 'authenticated' &&
      status.state !== 'waiting-for-client-info'
    ) {
      updateStatus(
        {
          state: 'waiting-for-qr',
        },
        'waiting-for-qr',
        `url=${page.url()}`,
      );
    }

    scheduleQrWaitTimeout(activeStartupAttemptId, activeBrowserLaunch?.executablePath ?? 'unknown');
  });

  page.on('close', () => {
    appendCollectorLog('browser-closed', `url=${page.url()}`);
    if (!shutdownRequested && status.state !== 'ready') {
      updateStatus(
        {
          lastError: 'WhatsApp browser window closed before patrol monitoring became ready.',
        },
        undefined,
        undefined,
      );
    }
  });
}

async function fetchJson(relativePath: string, init?: RequestInit) {
  const response = await fetch(`${API_BASE_URL}${relativePath}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-patrol-collector-token': INTERNAL_TOKEN,
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  return response.json();
}

async function fetchRuntimeConfig(): Promise<WhatsAppHelperRuntimeConfig> {
  const fallback: WhatsAppHelperRuntimeConfig = {
    allowFromMe: process.env.PATROL_HELPER_ALLOW_FROM_ME === 'true',
    pilotGroupName: process.env.PATROL_HELPER_PILOT_GROUP_NAME?.trim() || null,
    pilotSiteCode: process.env.PATROL_HELPER_PILOT_SITE_CODE?.trim() || null,
    mappedGroups: [],
  };

  try {
    const runtimeConfig = (await fetchJson(
      '/collectors/whatsapp/internal/runtime-config',
    )) as WhatsAppHelperRuntimeConfig;
    status.allowFromMe = runtimeConfig.allowFromMe;
    emitStatus();
    appendCollectorLog(
      'runtime-config-loaded',
      `mappedGroups=${runtimeConfig.mappedGroups.length} allowFromMe=${runtimeConfig.allowFromMe}`,
    );
    return runtimeConfig;
  } catch (error) {
    appendCollectorLog(
      'runtime-config-fallback',
      `error=${error instanceof Error ? error.message : String(error)} using local defaults`,
    );
    status.allowFromMe = fallback.allowFromMe;
    emitStatus();
    return fallback;
  }
}

async function postIngest(payload: WhatsAppHelperIngestPayload): Promise<void> {
  appendCollectorLog(
    'pipeline:backend-ingest-posting',
    `siteCode=${payload.siteCode} message=${payload.messageExternalId} bytes=${payload.fileSize}`,
  );
  try {
    const result = (await fetchJson('/collectors/whatsapp/internal/ingest', {
      method: 'POST',
      body: JSON.stringify(payload),
    })) as { ok: true; imageId: string; duplicate?: boolean; filePath?: string };

    appendCollectorLog(
      'APP_IMAGE_INGEST_SUCCESS',
      `imageId=${result.imageId} site=${payload.siteCode} duplicate=${Boolean(result.duplicate)}`,
    );
    appendCollectorLog(
      'pipeline:backend-ingest-success',
      `message=${payload.messageExternalId} siteCode=${payload.siteCode} imageId=${result.imageId} duplicate=${Boolean(result.duplicate)}`,
    );
    appendCollectorLog(
      'pipeline:db-save-success',
      `imageId=${result.imageId} siteCode=${payload.siteCode} message=${payload.messageExternalId}`,
    );
    if (result.filePath) {
      appendCollectorLog(
        'APP_IMAGE_CAPTURED',
        `sender=${payload.senderNumber ?? 'unknown'} chat=${payload.sourceExternalId ?? 'unknown'} site=${payload.siteCode} file=${result.filePath}`,
      );
    }
  } catch (error) {
    appendCollectorLog(
      'pipeline:backend-ingest-failure',
      `message=${payload.messageExternalId} error=${formatRuntimeError(error)}`,
    );
    throw error;
  }
}

function ensureTestImagePath(): string {
  mkdirSync(path.dirname(TEST_IMAGE_PATH), { recursive: true });
  if (!existsSync(TEST_IMAGE_PATH)) {
    const pngBase64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC';
    writeFileSync(TEST_IMAGE_PATH, Buffer.from(pngBase64, 'base64'));
  }

  return TEST_IMAGE_PATH;
}

async function sendTestImageToGroup(groupId: string): Promise<void> {
  if (!client || status.state !== 'ready') {
    appendCollectorLog('pipeline:send-test-image-skipped', `state=${status.state}`);
    return;
  }

  const runtimeModule = await loadWhatsAppRuntimeModule();
  const media = runtimeModule.MessageMedia.fromFilePath(ensureTestImagePath());
  const sent = await client.sendMessage(groupId, media, {
    caption: `patrol-import-test ${new Date().toISOString()}`,
  });
  appendCollectorLog(
    'pipeline:send-test-image-sent',
    `groupExternalId=${groupId} message=${sent.id?._serialized ?? 'unknown'}`,
  );
}

function extensionFromMedia(media: MessageMedia): string {
  if (media.mimetype === 'image/png') {
    return 'png';
  }

  return 'jpg';
}

async function resolvePatrolMessageSource(message: Message): Promise<WhatsAppMessageSource | null> {
  const direct = getMessageSourceId(message);
  if (direct) {
    return direct;
  }

  try {
    const chat = await message.getChat();
    const chatId = chat.id?._serialized;
    if (chatId?.endsWith('@g.us')) {
      appendCollectorLog('pipeline:source-chat-fallback', `externalId=${chatId} sourceType=group`);
      return { externalId: chatId, sourceType: PatrolSourceType.GROUP };
    }
    if (chatId?.endsWith('@c.us')) {
      appendCollectorLog('pipeline:source-chat-fallback', `externalId=${chatId} sourceType=contact`);
      return { externalId: chatId, sourceType: PatrolSourceType.CONTACT };
    }
  } catch (error) {
    appendCollectorLog(
      'pipeline:source-chat-fallback-error',
      `error=${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return null;
}

async function resolveSenderPreview(message: Message): Promise<{
  senderId: string;
  senderNumber?: string;
  senderName: string;
}> {
  let senderId = message.author ?? message.from ?? 'unknown';
  let senderNumber = senderId.replace(/@.+$/, '') || undefined;
  const messageData = (message as Message & { _data?: { notifyName?: string; pushname?: string } })._data;
  let pushname = messageData?.notifyName ?? messageData?.pushname ?? '';

  if (typeof message.getContact === 'function') {
    try {
      const contact = await message.getContact();
      pushname = contact?.pushname ?? contact?.name ?? contact?.shortName ?? pushname;
      if (!message.author && contact?.id?._serialized) {
        senderId = contact.id._serialized;
        senderNumber = contact.number ?? (senderId.replace(/@.+$/, '') || undefined);
      }
    } catch (error) {
      if (!isRecoverableContextError(error)) {
        appendCollectorLog('sender-contact-lookup-error', formatRuntimeError(error));
      }
    }
  }

  const senderName = resolveWhatsAppSenderName({
    senderNumber,
    pushname,
    name: pushname,
    shortName: pushname,
    fromMe: message.fromMe,
  });

  return { senderId, senderNumber, senderName };
}

async function resolveMappedSiteForSource(
  message: Message,
  runtimeConfig: WhatsAppHelperRuntimeConfig,
  sourceExternalId: string,
): Promise<{ siteCode: string; groupId?: string } | null> {
  const mapping = runtimeConfig.mappedGroups.find((entry) => entry.externalGroupId === sourceExternalId);
  if (mapping?.siteCode) {
    return {
      siteCode: mapping.siteCode.trim().toUpperCase(),
      groupId: mapping.mappedGroupId,
    };
  }

  const fallback = await resolvePilotFallback(message, runtimeConfig);
  if (!fallback?.siteCode) {
    return null;
  }

  return {
    siteCode: fallback.siteCode.trim().toUpperCase(),
    groupId: fallback.groupId,
  };
}

async function buildIncomingPayload(
  message: Message,
  runtimeConfig: WhatsAppHelperRuntimeConfig,
  sourceExternalId: string,
  sourceType: 'group' | 'contact',
): Promise<WhatsAppHelperIngestPayload | null> {
  appendCollectorLog(
    'process-download-start',
    `sourceExternalId=${sourceExternalId} sourceType=${sourceType} id=${message.id?._serialized ?? 'unknown'}`,
  );

  let media: MessageMedia | null = null;
  try {
    media = await message.downloadMedia();
  } catch (error) {
    appendCollectorLog(
      'pipeline:download-failure',
      `sourceExternalId=${sourceExternalId} sourceType=${sourceType} id=${message.id._serialized} error=${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }

  const mimetype = media?.mimetype ?? 'none';
  appendCollectorLog('media-mimetype', `id=${message.id._serialized} mimetype=${mimetype}`);

  if (!media || !media.mimetype?.startsWith('image/')) {
    appendCollectorLog(
      'pipeline:skip-not-image',
      `sourceExternalId=${sourceExternalId} sourceType=${sourceType} id=${message.id._serialized} mimetype=${mimetype}`,
    );
    return null;
  }

  appendCollectorLog(
    'pipeline:download-success',
    `sourceExternalId=${sourceExternalId} sourceType=${sourceType} id=${message.id._serialized} mimetype=${media.mimetype} bytes=${Buffer.byteLength(media.data, 'base64')}`,
  );
  appendCollectorLog(
    'process-download-success',
    `sourceExternalId=${sourceExternalId} sourceType=${sourceType} id=${message.id._serialized}`,
  );

  const mapping = runtimeConfig.mappedGroups.find((entry) => entry.externalGroupId === sourceExternalId);
  const fallback = mapping ? null : await resolvePilotFallback(message, runtimeConfig);
  const resolvedSiteCode = mapping?.siteCode ?? fallback?.siteCode;
  const resolvedGroupId = mapping?.mappedGroupId ?? fallback?.groupId;

  if (!resolvedSiteCode) {
    const senderPreview = await resolveSenderPreview(message);
    appendCollectorLog(
      'APP_IMAGE_SKIPPED_UNMAPPED_SOURCE',
      `chat=${sourceExternalId} sender=${senderPreview.senderNumber ?? senderPreview.senderId} senderName=${senderPreview.senderName}`,
    );
    appendCollectorLog(
      'pipeline:source-not-mapped',
      `sourceType=${sourceType} externalId=${sourceExternalId} mappedSourcesConfigured=${runtimeConfig.mappedGroups.length} configured=${runtimeConfig.mappedGroups.map((entry) => entry.externalGroupId).join('|') || 'none'}`,
    );
    appendCollectorLog(
      'pipeline:unmapped-source-debug',
      `chat=${sourceExternalId} sourceType=${sourceType} sender=${senderPreview.senderNumber ?? senderPreview.senderId} senderName=${senderPreview.senderName}`,
    );
    return null;
  }

  appendCollectorLog(
    'pipeline:source-matched',
    `sourceType=${sourceType} externalId=${sourceExternalId} mappedGroupId=${resolvedGroupId ?? 'none'} siteCode=${resolvedSiteCode}`,
  );
  if (sourceType === 'group') {
    appendCollectorLog(
      'pipeline:group-matched',
      `groupExternalId=${sourceExternalId} mappedGroupId=${resolvedGroupId ?? 'none'} siteCode=${resolvedSiteCode}`,
    );
  }

  const senderPreview = await resolveSenderPreview(message);
  const senderNumber = senderPreview.senderNumber;
  const senderName = senderPreview.senderName;

  return {
    siteCode: resolvedSiteCode,
    groupId: resolvedGroupId,
    sourceExternalId,
    senderName,
    senderNumber,
    senderExternalId: senderPreview.senderId,
    messageExternalId: message.id._serialized,
    linkedAccountId: status.connectedAccount ?? undefined,
    originalFileName: media.filename ?? `whatsapp-${message.id.id}.${extensionFromMedia(media)}`,
    mimeType: media.mimetype,
    fileSize: Buffer.byteLength(media.data, 'base64'),
    fileBase64: media.data,
    timestamp: new Date(message.timestamp * 1000).toISOString(),
  };
}

async function resolvePilotFallback(
  message: Message,
  runtimeConfig: WhatsAppHelperRuntimeConfig,
): Promise<{ siteCode: string; groupId?: string } | null> {
  if (!runtimeConfig.pilotGroupName || !runtimeConfig.pilotSiteCode) {
    return null;
  }

  const chat = await message.getChat();
  if (!chat.isGroup || chat.name.trim().toLowerCase() !== runtimeConfig.pilotGroupName.trim().toLowerCase()) {
    return null;
  }

  const mappedPilotGroup = runtimeConfig.mappedGroups.find(
    (entry) =>
      entry.groupName.trim().toLowerCase() === runtimeConfig.pilotGroupName?.trim().toLowerCase() &&
      entry.siteCode.trim().toUpperCase() === runtimeConfig.pilotSiteCode?.trim().toUpperCase(),
  );

  return {
    siteCode: runtimeConfig.pilotSiteCode.trim().toUpperCase(),
    groupId: mappedPilotGroup?.mappedGroupId,
  };
}

function clearNavigationReattachTimer(): void {
  if (navigationReattachTimer) {
    clearTimeout(navigationReattachTimer);
    navigationReattachTimer = null;
  }
}

function getLiveMediaListenerCounts(target: Client): {
  message: number;
  message_create: number;
  media_uploaded: number;
} {
  return {
    message: target.listenerCount('message'),
    message_create: target.listenerCount('message_create'),
    media_uploaded: target.listenerCount('media_uploaded'),
  };
}

function formatLiveMediaListenerCounts(counts: {
  message: number;
  message_create: number;
  media_uploaded: number;
}): string {
  return `message=${counts.message} message_create=${counts.message_create} media_uploaded=${counts.media_uploaded}`;
}

function detachLiveMediaListeners(target: Client): void {
  const wasAttached = liveMediaListenersAttached;
  target.removeListener('message', onClientMessageReceived);
  target.removeListener('message_create', onClientMessageCreated);
  target.removeListener('media_uploaded', onClientMediaUploaded);
  liveMediaListenersAttached = false;

  if (wasAttached) {
    appendCollectorLog(
      'listeners-detached',
      formatLiveMediaListenerCounts(getLiveMediaListenerCounts(target)),
    );
  }
}

function attachLiveMediaListeners(target: Client, reason: string): void {
  detachLiveMediaListeners(target);

  target.on('message', onClientMessageReceived);
  target.on('message_create', onClientMessageCreated);
  target.on('media_uploaded', onClientMediaUploaded);
  liveMediaListenersAttached = true;

  if (reason === 'ready-event') {
    appendCollectorLog('listener-attached', formatLiveMediaListenerCounts(getLiveMediaListenerCounts(target)));
    logMediaListenerCounts(target, 'ready-event');
    return;
  }

  appendCollectorLog('listeners-reattached', `reason=${reason} ${formatLiveMediaListenerCounts(getLiveMediaListenerCounts(target))}`);
  logMediaListenerCounts(target, reason);
}

function verifyAndReattachLiveMediaListeners(
  trigger: 'navigation' | 'health-check' | 'post-ready',
): void {
  const target = client;
  if (!target || shutdownRequested || status.state !== 'ready' || !readinessFinalized) {
    return;
  }

  const counts = getLiveMediaListenerCounts(target);
  appendCollectorLog(
    'listener-health-check',
    `trigger=${trigger} attached=${liveMediaListenersAttached} counts=${formatLiveMediaListenerCounts(counts)}`,
  );

  const missingListeners =
    counts.message === 0 || counts.message_create === 0 || counts.media_uploaded === 0;
  if (liveMediaListenersAttached && !missingListeners) {
    return;
  }

  detachLiveMediaListeners(target);
  attachLiveMediaListeners(target, trigger);
}

function scheduleLiveMediaListenerReattachAfterNavigation(url: string, reason: string): void {
  if (!readinessFinalized || status.state !== 'ready' || !client || shutdownRequested) {
    return;
  }

  appendCollectorLog('navigation-after-ready', `url=${url} reason=${reason}`);
  clearNavigationReattachTimer();
  navigationReattachTimer = setTimeout(() => {
    navigationReattachTimer = null;
    const target = client;
    if (!target || shutdownRequested || status.state !== 'ready' || !readinessFinalized) {
      return;
    }

    const counts = formatLiveMediaListenerCounts(getLiveMediaListenerCounts(target));
    appendCollectorLog(
      'listener-health-check',
      `trigger=navigation attached=${liveMediaListenersAttached} counts=${counts}`,
    );
    detachLiveMediaListeners(target);
    attachLiveMediaListeners(target, 'navigation');
    logMediaListenerCounts(target, 'navigation');
    void logLoadedWhatsAppWebVersion(target, 'navigation');
  }, NAVIGATION_REATTACH_DELAY_MS);
}

function resetLiveMessageListenerState(): void {
  clearNavigationReattachTimer();
  if (client && liveMediaListenersAttached) {
    detachLiveMediaListeners(client);
  } else {
    liveMediaListenersAttached = false;
  }
  for (const timer of pendingLiveMediaChecks.values()) {
    clearTimeout(timer);
  }
  pendingLiveMediaChecks.clear();
}

function clearPendingLiveMediaCheck(messageId: string): void {
  const timer = pendingLiveMediaChecks.get(messageId);
  if (timer) {
    clearTimeout(timer);
    pendingLiveMediaChecks.delete(messageId);
  }
}

function scheduleLiveMediaRecheck(messageId: string, attempt = 1): void {
  if (!messageId || pendingLiveMediaChecks.has(messageId) || !client || status.state !== 'ready') {
    return;
  }

  const timer = setTimeout(() => {
    pendingLiveMediaChecks.delete(messageId);
    void (async () => {
      if (!client || status.state !== 'ready') {
        return;
      }

      try {
        const refreshed = await client.getMessageById(messageId);
        if (!refreshed) {
          appendCollectorLog('pipeline:skip-not-media', `id=${messageId} reason=message-not-found attempt=${attempt}`);
          return;
        }

        if (!refreshed.hasMedia) {
          if (attempt < LIVE_MEDIA_RECHECK_MAX) {
            scheduleLiveMediaRecheck(messageId, attempt + 1);
          } else {
            appendCollectorLog(
              'pipeline:skip-not-media',
              `id=${messageId} reason=media-never-available attempts=${attempt}`,
            );
          }
          return;
        }

        appendCollectorLog('live-has-media', `id=${messageId} value=true source=recheck attempt=${attempt}`);
        await processMessage(refreshed, 'live');
      } catch (error) {
        appendCollectorLog(
          'live-media-recheck-error',
          `id=${messageId} attempt=${attempt} error=${formatRuntimeError(error)}`,
        );
        if (isRecoverableContextError(error)) {
          scheduleLiveMediaListenerReattachAfterNavigation('live-media-recheck', 'recoverable-error');
        }
      }
    })();
  }, LIVE_MEDIA_RECHECK_MS);

  pendingLiveMediaChecks.set(messageId, timer);
}

function attachLiveMediaListenersOnce(target: Client): void {
  if (blockAfterCertificationTerminal('attach-live-media-listeners')) {
    return;
  }
  if (liveMediaListenersAttached) {
    appendCollectorLog('listener-attached', 'skipped=already-attached');
    return;
  }

  attachLiveMediaListeners(target, 'ready-event');
}

async function onClientMessageReceived(message: Message): Promise<void> {
  await dispatchLiveMessage(message, 'message');
}

async function onClientMessageCreated(message: Message): Promise<void> {
  await dispatchLiveMessage(message, 'message_create');
}

async function onClientMediaUploaded(message: Message): Promise<void> {
  await dispatchLiveMessage(message, 'media_uploaded');
}

async function dispatchLiveMessage(
  message: Message,
  eventName: 'message' | 'message_create' | 'media_uploaded',
): Promise<void> {
  const messageId = message.id?._serialized ?? 'unknown';
  const previewSource = getMessageSourceId(message);

  appendCollectorLog(
    'live-message-event',
    `event=${eventName} id=${messageId} chat=${previewSource?.externalId ?? 'none'} sourceType=${previewSource?.sourceType ?? 'none'} hasMedia=${message.hasMedia} fromMe=${message.fromMe} type=${message.type ?? 'unknown'}`,
  );

  if (!message.hasMedia && eventName !== 'media_uploaded') {
    appendCollectorLog(
      'process-return-not-media',
      `stage=dispatch event=${eventName} id=${messageId} hasMedia=false`,
    );
    scheduleLiveMediaRecheck(messageId);
    return;
  }

  if (status.state !== 'ready' && !canAcceptLiveMessages()) {
    appendCollectorLog(
      'PROCESS_BLOCK_REASON',
      `stage=dispatch event=${eventName} id=${messageId} previousState=${status.state} state=${status.state} readinessFinalized=${readinessFinalized} account=${status.connectedAccount ?? 'none'} reason=collector-not-ready`,
    );
    appendCollectorLog(
      'process-return-not-ready',
      `stage=dispatch event=${eventName} id=${messageId} state=${status.state} readinessFinalized=${readinessFinalized}`,
    );
    return;
  }

  try {
    await processMessage(message, 'live');
  } catch (error) {
    appendCollectorLog('live-message-error', formatRuntimeError(error));
    if (isRecoverableContextError(error)) {
      scheduleLiveMediaListenerReattachAfterNavigation('live-message-error', 'recoverable-error');
    }
  }
}

function clearReadyHeartbeat(): void {
  if (readyHeartbeatInterval) {
    clearInterval(readyHeartbeatInterval);
    readyHeartbeatInterval = null;
  }
}

function startReadyHeartbeat(): void {
  clearReadyHeartbeat();
  readyHeartbeatInterval = setInterval(() => {
    if (shutdownRequested || status.state !== 'ready' || !client) {
      return;
    }

    const counts = formatLiveMediaListenerCounts(getLiveMediaListenerCounts(client));
    appendCollectorLog(
      'APP_CAPTURE_ALIVE',
      `ready=true listenersAttached=${liveMediaListenersAttached} listenerCounts=${counts}`,
    );

    if (!isQrOnlyCertificationMode()) {
      verifyAndReattachLiveMediaListeners('health-check');
    }
  }, READY_HEARTBEAT_INTERVAL_MS);
}

async function processMessage(message: Message, source: MessageSource): Promise<MessageProcessingResult> {
  const messageExternalId = message.id?._serialized ?? 'unknown';

  appendCollectorLog(
    'process-start',
    `source=${source} id=${messageExternalId} from=${message.from ?? 'none'} to=${message.to ?? 'none'} fromMe=${message.fromMe} hasMedia=${message.hasMedia} type=${message.type ?? 'unknown'}`,
  );

  if (source === 'live' && !canAcceptLiveMessages()) {
    appendCollectorLog(
      'PROCESS_BLOCK_REASON',
      `stage=process id=${messageExternalId} state=${status.state} readinessFinalized=${readinessFinalized} account=${status.connectedAccount ?? 'none'} reason=collector-not-ready`,
    );
    appendCollectorLog(
      'process-return-not-ready',
      `id=${messageExternalId} state=${status.state} readinessFinalized=${readinessFinalized}`,
    );
    return 'skipped';
  }

  const messageSource = await resolvePatrolMessageSource(message);

  appendCollectorLog(
    'pipeline:message-received',
    `source=${source} sourceExternalId=${messageSource?.externalId ?? 'none'} sourceType=${messageSource?.sourceType ?? 'none'} from=${message.from} to=${message.to ?? 'none'} id=${messageExternalId} fromMe=${message.fromMe} hasMedia=${message.hasMedia}`,
  );

  if (!messageSource) {
    appendCollectorLog(
      'process-return-not-mapped',
      `reason=no-source-id id=${messageExternalId} from=${message.from ?? 'none'} to=${message.to ?? 'none'} remote=${message.id?.remote ?? 'none'}`,
    );
    return 'skipped';
  }

  appendCollectorLog(
    'pipeline:source-detected',
    `sourceType=${messageSource.sourceType} externalId=${messageSource.externalId}`,
  );

  if (!message.hasMedia) {
    appendCollectorLog('pipeline:has-media', `source=${source} id=${messageExternalId} value=false`);
    if (source === 'live') {
      scheduleLiveMediaRecheck(messageExternalId);
    }
    appendCollectorLog(
      'process-return-not-media',
      `id=${messageExternalId} sourceExternalId=${messageSource.externalId}`,
    );
    return 'skipped';
  }

  appendCollectorLog('pipeline:has-media', `source=${source} id=${messageExternalId} value=true`);
  clearPendingLiveMediaCheck(messageExternalId);

  if (messageExternalId && processedMessageIds.has(messageExternalId)) {
    status.backfillDuplicatesSkipped += 1;
    emitStatus();
    appendCollectorLog('process-return-duplicate', `source=${source} message=${messageExternalId}`);
    return 'duplicate';
  }

  const runtimeConfig = await fetchRuntimeConfig();
  if (shouldSkipWhatsAppFromMe(message.fromMe, runtimeConfig.allowFromMe)) {
    appendCollectorLog(
      'process-return-fromme',
      `source=${source} message=${messageExternalId} allowFromMe=${runtimeConfig.allowFromMe}`,
    );
    return 'skipped';
  }

  const resolvedMapping = await resolveMappedSiteForSource(
    message,
    runtimeConfig,
    messageSource.externalId,
  );
  if (!resolvedMapping) {
    const senderPreview = await resolveSenderPreview(message);
    appendCollectorLog(
      'APP_IMAGE_SKIPPED_UNMAPPED_SOURCE',
      `chat=${messageSource.externalId} sender=${senderPreview.senderNumber ?? senderPreview.senderId} senderName=${senderPreview.senderName}`,
    );
    appendCollectorLog(
      'pipeline:unmapped-source-debug',
      `chat=${messageSource.externalId} sourceType=${messageSource.sourceType} sender=${senderPreview.senderNumber ?? senderPreview.senderId} senderName=${senderPreview.senderName} configured=${runtimeConfig.mappedGroups.map((entry) => entry.externalGroupId).join('|') || 'none'}`,
    );
    return 'skipped';
  }

  status.lastMessageAt = new Date().toISOString();
  status.backfillMessagesScanned += 1;
  emitStatus();

  try {
    const normalized = await buildIncomingPayload(
      message,
      runtimeConfig,
      messageSource.externalId,
      messageSource.sourceType,
    );
    if (!normalized) {
      appendCollectorLog(
        'process-return-not-mapped',
        `reason=build-payload-failed id=${messageExternalId} sourceExternalId=${messageSource.externalId}`,
      );
      return 'skipped';
    }

    await postIngest(normalized);
    if (messageExternalId) {
      processedMessageIds.add(messageExternalId);
    }
    status.backfillImagesImported += 1;
    emitStatus();
    appendCollectorLog('image-imported', `source=${source} site=${normalized.siteCode} message=${normalized.messageExternalId}`);
    return 'imported';
  } catch (error) {
    appendCollectorLog(
      'pipeline:backend-ingest-failure',
      `source=${source} message=${messageExternalId} error=${error instanceof Error ? error.message : String(error)}`,
    );
    return 'skipped';
  }
}

async function fetchMessagesForChat(currentClient: Client, chatId: string): Promise<Message[]> {
  return withDetachedFrameRetry(async () => {
    if (typeof currentClient.getChatById !== 'function') {
      throw new Error('client.getChatById is unavailable on the WhatsApp client');
    }

    if (currentClient.pupPage) {
      const hasGetChat = await currentClient.pupPage.evaluate(() => {
        const scopedWindow = window as typeof window & {
          WWebJS?: { getChat?: unknown };
        };
        return typeof scopedWindow.WWebJS?.getChat === 'function';
      });
      if (!hasGetChat) {
        throw new Error(
          'window.WWebJS.getChat is unavailable — WhatsApp Web injection/chat store is not ready',
        );
      }
    }

    const chat = await currentClient.getChatById(chatId);
    if (!chat || typeof chat.fetchMessages !== 'function') {
      throw new Error(
        `getChatById(${chatId}) did not return a Chat with fetchMessages (got ${chat ? typeof chat : 'undefined'})`,
      );
    }

    return chat.fetchMessages(
      BACKFILL_MESSAGE_LIMIT === 0 ? { limit: Infinity } : { limit: BACKFILL_MESSAGE_LIMIT },
    );
  });
}

async function runBackfill(hours: number): Promise<void> {
  if (!client || status.state !== 'ready') {
    updateStatus({ info: 'Patrol monitoring must be ready before history refresh can run.' });
    return;
  }

  if (status.backfillRunning) {
    return;
  }

  const runtimeConfig = await fetchRuntimeConfig();
  const cutoffTimestamp = Math.floor((Date.now() - hours * 60 * 60 * 1000) / 1000);
  updateStatus(
    {
      backfillRunning: true,
      backfillMessagesScanned: 0,
      backfillImagesImported: 0,
      backfillDuplicatesSkipped: 0,
      info: `Refreshing patrol history for the last ${hours} hour${hours === 1 ? '' : 's'}.`,
    },
    'manual-backfill-start',
    `hours=${hours} mappedGroups=${runtimeConfig.mappedGroups.length}`,
  );

  try {
    for (const mappedGroup of runtimeConfig.mappedGroups) {
      try {
        const messages = await fetchMessagesForChat(client, mappedGroup.externalGroupId);
        const orderedMessages = [...messages].sort((left, right) => left.timestamp - right.timestamp);
        for (const message of orderedMessages) {
          const messageSource = getMessageSourceId(message);
          if (
            !messageSource ||
            messageSource.externalId !== mappedGroup.externalGroupId ||
            message.timestamp < cutoffTimestamp
          ) {
            continue;
          }

          const result = await processMessage(message, 'backfill');
          if (result === 'duplicate') {
            status.backfillDuplicatesSkipped += 1;
          }
          emitStatus();
        }
      } catch (error) {
        appendCollectorLog(
          'manual-backfill-group-error',
          `group=${mappedGroup.externalGroupId} error=${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  } finally {
    updateStatus(
      {
        backfillRunning: false,
        lastBackfillAt: new Date().toISOString(),
        info: 'History refresh finished.',
      },
      'manual-backfill-finished',
      `scanned=${status.backfillMessagesScanned} imported=${status.backfillImagesImported} duplicates=${status.backfillDuplicatesSkipped}`,
    );
  }
}

function describeClientForDiscovery(activeClient: Client | null): string {
  if (!activeClient) {
    return 'client=null clientType=missing hasGetChats=false pupPage=missing pupBrowser=missing globalClientMatch=false';
  }

  return [
    `clientType=${activeClient.constructor?.name ?? typeof activeClient}`,
    `hasGetChats=${typeof activeClient.getChats === 'function'}`,
    `pupPage=${activeClient.pupPage ? 'present' : 'missing'}`,
    `pupBrowser=${activeClient.pupBrowser ? 'present' : 'missing'}`,
    `globalClientMatch=${activeClient === client}`,
    `state=${status.state}`,
    `ready=${readinessFinalized}`,
    `account=${status.connectedAccount ?? 'none'}`,
  ].join(' ');
}

async function probeWWebJsGetChatsReady(activeClient: Client): Promise<boolean> {
  if (!activeClient.pupPage || typeof activeClient.getChats !== 'function') {
    return false;
  }

  try {
    const injected = await activeClient.pupPage.evaluate(() => {
      const scopedWindow = window as typeof window & {
        WWebJS?: { getChats?: unknown; getChat?: unknown };
      };
      return {
        hasWWebJS: typeof scopedWindow.WWebJS !== 'undefined',
        hasGetChats: typeof scopedWindow.WWebJS?.getChats === 'function',
        hasGetChat: typeof scopedWindow.WWebJS?.getChat === 'function',
      };
    });

    if (!injected?.hasWWebJS || !injected.hasGetChats || !injected.hasGetChat) {
      appendCollectorLog(
        'CHAT_DISCOVERY_WWEBJS_PROBE',
        `injected=false hasWWebJS=${Boolean(injected?.hasWWebJS)} hasGetChats=${Boolean(injected?.hasGetChats)} hasGetChat=${Boolean(injected?.hasGetChat)}`,
      );
      return false;
    }

    // Require an actual Store-backed getChats() call — typeof checks alone marked ready while chat APIs were broken.
    const chats = await activeClient.getChats();
    if (!Array.isArray(chats)) {
      appendCollectorLog('CHAT_DISCOVERY_WWEBJS_PROBE', `getChatsReturned=${typeof chats}`);
      return false;
    }

    appendCollectorLog('CHAT_DISCOVERY_WWEBJS_PROBE', `getChatsOk=true count=${chats.length}`);
    return true;
  } catch (error) {
    appendCollectorLog(
      'CHAT_DISCOVERY_WWEBJS_PROBE',
      `getChatsError=${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}

async function waitForChatDiscoveryReady(
  activeClient: Client,
  timeoutMs = 45_000,
  options: { requireReadinessFinalized?: boolean } = {},
): Promise<boolean> {
  const requireReadinessFinalized = options.requireReadinessFinalized !== false;
  const startedAt = Date.now();
  appendCollectorLog(
    'CHAT_DISCOVERY_WWEBJS_WAIT',
    `timeoutMs=${timeoutMs} requireReadinessFinalized=${requireReadinessFinalized} ${describeClientForDiscovery(activeClient)}`,
  );

  const deadline = startedAt + timeoutMs;
  let lastWaitLogAt = startedAt;
  while (Date.now() < deadline && !shutdownRequested) {
    if (requireReadinessFinalized && !canAttemptChatDiscovery(activeClient)) {
      await sleep(500);
      continue;
    }

    if (
      !activeClient.pupPage ||
      typeof activeClient.getChats !== 'function' ||
      (client && activeClient !== client)
    ) {
      await sleep(500);
      continue;
    }

    try {
      const waState = await activeClient.getState();
      if (waState !== 'CONNECTED') {
        await sleep(500);
        continue;
      }
    } catch {
      await sleep(500);
      continue;
    }

    if (await probeWWebJsGetChatsReady(activeClient)) {
      appendCollectorLog(
        'CHAT_DISCOVERY_WWEBJS_READY',
        `elapsedMs=${Date.now() - startedAt} ${describeClientForDiscovery(activeClient)}`,
      );
      return true;
    }

    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs - (lastWaitLogAt - startedAt) >= 5_000) {
      lastWaitLogAt = Date.now();
      appendCollectorLog(
        'CHAT_DISCOVERY_WWEBJS_WAIT',
        `elapsedMs=${elapsedMs} ${describeClientForDiscovery(activeClient)}`,
      );
    }

    await sleep(500);
  }

  appendCollectorLog(
    'CHAT_DISCOVERY_WWEBJS_TIMEOUT',
    `timeoutMs=${timeoutMs} elapsedMs=${Date.now() - startedAt} ${describeClientForDiscovery(activeClient)}`,
  );
  return false;
}

function canAttemptChatDiscovery(activeClient: Client | null): activeClient is Client {
  return Boolean(
    activeClient &&
      client &&
      activeClient === client &&
      readinessFinalized &&
      status.state === 'ready' &&
      status.connectedAccount?.trim(),
  );
}

async function runChatDiscoverySmoke(activeClient: Client): Promise<boolean> {
  appendCollectorLog('CHAT_DISCOVERY_SMOKE_START', describeClientForDiscovery(activeClient));

  try {
    if (typeof activeClient.getChats !== 'function') {
      throw new Error('client.getChats is unavailable');
    }

    const chats = await activeClient.getChats();
    if (!Array.isArray(chats)) {
      throw new Error(`getChats() returned ${typeof chats}`);
    }

    const { groups, contacts } = mapChatsToDiscoveredSources(chats);
    appendCollectorLog(
      'CHAT_DISCOVERY_SMOKE_ENUM',
      `chats=${chats.length} groups=${groups.length} contacts=${contacts.length}`,
    );

    if (chats.length === 0) {
      throw new Error('getChats() returned zero chats — cannot verify getChatById/fetchMessages');
    }

    const probeChat = chats.find((chat) => Boolean(chat.id?._serialized)) ?? chats[0];
    const chatId = probeChat.id?._serialized;
    if (!chatId) {
      throw new Error('Discovered chat is missing id._serialized');
    }

    if (typeof activeClient.getChatById !== 'function') {
      throw new Error('client.getChatById is unavailable');
    }

    const byId = await activeClient.getChatById(chatId);
    if (!byId || typeof byId.fetchMessages !== 'function') {
      throw new Error(`getChatById(${chatId}) did not return a Chat with fetchMessages`);
    }

    const messages = await byId.fetchMessages({ limit: 1 });
    if (!Array.isArray(messages)) {
      throw new Error(`fetchMessages() returned ${typeof messages}`);
    }

    appendCollectorLog(
      'CHAT_DISCOVERY_SMOKE_PASS',
      `chatId=${chatId} groups=${groups.length} contacts=${contacts.length} fetchMessages=${messages.length}`,
    );
    return true;
  } catch (error) {
    appendCollectorLog(
      'CHAT_DISCOVERY_SMOKE_FAIL',
      error instanceof Error ? error.message : String(error),
    );
    return false;
  }
}

function resolveChatDisplayName(chat: {
  name?: string | null;
  id?: { _serialized?: string; user?: string };
}): string {
  const title = chat.name?.trim();
  if (title) {
    return title;
  }

  const serialized = chat.id?._serialized?.trim();
  if (serialized) {
    const localPart = serialized.split('@')[0]?.trim();
    return localPart || serialized;
  }

  const user = chat.id?.user?.trim();
  if (user) {
    return user;
  }

  return 'Unknown chat';
}

function isValidDiscoveredChatId(id: string | undefined): id is string {
  return Boolean(id?.includes('@') && id.trim().length > 3);
}

function mapChatsToDiscoveredSources(chats: Array<{
  id?: { _serialized?: string; user?: string };
  name?: string | null;
  isGroup?: boolean;
  isReadOnly?: boolean;
  unreadCount?: number;
}>): { groups: WhatsAppCollectorGroup[]; contacts: WhatsAppCollectorContact[] } {
  const groups: WhatsAppCollectorGroup[] = [];
  const contacts: WhatsAppCollectorContact[] = [];

  for (const chat of chats) {
    const id = chat.id?._serialized?.trim();
    if (!isValidDiscoveredChatId(id)) {
      continue;
    }

    const name = resolveChatDisplayName(chat);

    if (chat.isGroup) {
      groups.push({
        id,
        name,
        isGroup: true,
        sourceType: 'group',
        isReadOnly: Boolean(chat.isReadOnly),
        unreadCount: chat.unreadCount ?? 0,
      });
      continue;
    }

    contacts.push({
      id,
      name,
      isGroup: false,
      sourceType: 'contact',
      unreadCount: chat.unreadCount ?? 0,
    });
  }

  return {
    groups: normalizeDetectedGroups(groups),
    contacts: normalizeDetectedContacts(contacts),
  };
}

async function reportChatDiscoveryFailure(message: string, logEvent = 'CHAT_DISCOVERY_ERROR'): Promise<void> {
  appendCollectorLog(logEvent, `error=${message}`);
  updateStatus(
    {
      info: `Chat discovery failed: ${message}`,
      lastError: message,
      groups: [],
      contacts: [],
    },
    'group-refresh-final-error',
    message,
  );
}

async function refreshDiscoveredChats(): Promise<void> {
  if (blockAfterCertificationTerminal('refresh-discovered-chats')) {
    return;
  }
  if (isQrOnlyCertificationMode()) {
    appendCollectorLog('certification-operational-command-suppressed', 'action=refresh-discovered-chats');
    return;
  }
  appendCollectorLog('CHAT_DISCOVERY_START', describeClientForDiscovery(client));

  const activeClient = client;
  if (!activeClient) {
    await reportChatDiscoveryFailure('client missing before getChats');
    return;
  }

  appendCollectorLog('GROUP_DISCOVERY_CLIENT_OK', describeClientForDiscovery(activeClient));

  if (!canAttemptChatDiscovery(activeClient)) {
    await reportChatDiscoveryFailure(
      `discovery prerequisites missing ${describeClientForDiscovery(activeClient)}`,
    );
    return;
  }

  if (!(await waitForChatDiscoveryReady(activeClient))) {
    await reportChatDiscoveryFailure(
      'WhatsApp chat store did not become ready for getChats() — groups and contacts cannot be listed.',
      'CHAT_DISCOVERY_WWEBJS_TIMEOUT',
    );
    return;
  }

  let lastError: unknown = null;

  for (let attempt = 1; attempt <= 8; attempt += 1) {
    if (!canAttemptChatDiscovery(activeClient)) {
      await reportChatDiscoveryFailure(
        `discovery aborted session changed attempt=${attempt} ${describeClientForDiscovery(activeClient)}`,
      );
      return;
    }

    appendCollectorLog(
      'GROUP_DISCOVERY_CLIENT_OK',
      `attempt=${attempt} ${describeClientForDiscovery(activeClient)}`,
    );

    try {
      if (typeof activeClient.getChats !== 'function') {
        throw new Error(`client.getChats is ${typeof activeClient.getChats}`);
      }

      const chats = await activeClient.getChats();
      appendCollectorLog('CHAT_DISCOVERY_SUCCESS', `count=${chats.length} attempt=${attempt}`);

      const { groups, contacts } = mapChatsToDiscoveredSources(chats);
      appendCollectorLog('CHAT_DISCOVERY_GROUPS', `count=${groups.length} attempt=${attempt}`);
      appendCollectorLog('CHAT_DISCOVERY_CONTACTS', `count=${contacts.length} attempt=${attempt}`);

      status.groups = groups;
      status.contacts = contacts;
      if (status.lastError?.toLowerCase().includes('chat discovery')) {
        status.lastError = null;
      }
      appendCollectorLog(
        'group-refresh-success',
        `source=client.getChats groups=${groups.length} contacts=${contacts.length} attempt=${attempt}`,
      );
      updateStatus(
        {
          info:
            groups.length + contacts.length > 0
              ? `Discovered ${groups.length} group${groups.length === 1 ? '' : 's'} and ${contacts.length} contact${contacts.length === 1 ? '' : 's'}.`
              : 'Chat discovery succeeded, but no groups or contacts were returned yet.',
          lastError: null,
        },
        'group-refresh-success',
        `groups=${groups.length} contacts=${contacts.length}`,
      );
      return;
    } catch (error) {
      lastError = error;
      appendCollectorLog(
        'CHAT_DISCOVERY_ERROR',
        `error=${error instanceof Error ? error.message : String(error)} attempt=${attempt} ${describeClientForDiscovery(activeClient)}`,
      );
      appendCollectorLog(
        'group-refresh-error',
        `attempt=${attempt} ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    await sleep(1_500);
  }

  if (lastError) {
    await reportChatDiscoveryFailure(
      lastError instanceof Error ? lastError.message : String(lastError),
      'group-refresh-final-error',
    );
  } else {
    await reportChatDiscoveryFailure('Chat discovery failed after multiple getChats() attempts.');
  }
}

function normalizeDetectedGroups(groups: WhatsAppCollectorGroup[]): WhatsAppCollectorGroup[] {
  const seen = new Set<string>();
  return groups
    .filter((group) => isValidDiscoveredChatId(group.id))
    .filter((group) => {
      if (seen.has(group.id)) {
        return false;
      }
      seen.add(group.id);
      return true;
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

function normalizeDetectedContacts(contacts: WhatsAppCollectorContact[]): WhatsAppCollectorContact[] {
  const seen = new Set<string>();
  return contacts
    .filter((contact) => isValidDiscoveredChatId(contact.id))
    .filter((contact) => {
      if (seen.has(contact.id)) {
        return false;
      }
      seen.add(contact.id);
      return true;
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

function clearStartupTimeout(): void {
  if (startupTimeout) {
    clearTimeout(startupTimeout);
    startupTimeout = null;
  }
}

function clearBrowserLaunchGraceTimeout(): void {
  if (browserLaunchGraceTimeout) {
    clearTimeout(browserLaunchGraceTimeout);
    browserLaunchGraceTimeout = null;
  }
}

function clearQrWaitTimeout(): void {
  if (qrWaitTimeout) {
    clearTimeout(qrWaitTimeout);
    qrWaitTimeout = null;
  }
}

function clearStartupTimeouts(): void {
  clearStartupTimeout();
  clearBrowserLaunchGraceTimeout();
  clearQrWaitTimeout();
}

function scheduleBrowserLaunchGraceTimeout(startupAttemptId: number, edgeExecutablePath: string): void {
  clearBrowserLaunchGraceTimeout();
  if (hasReachedAuthenticationPhase(startupAttemptId) || readinessFinalized) {
    return;
  }

  browserLaunchGraceTimeout = setTimeout(() => {
    if (
      shutdownRequested ||
      startupAttemptId !== activeStartupAttemptId ||
      readinessFinalized ||
      hasReachedAuthenticationPhase(startupAttemptId) ||
      status.state === 'authenticated' ||
      status.state === 'waiting-for-client-info' ||
      status.state === 'ready' ||
      status.qrCode ||
      whatsappPageLoadedAt
    ) {
      appendCollectorLog(
        'edge-startup-timeout-ignored',
        describeClientIdentity(client, startupAttemptId),
      );
      return;
    }

    appendCollectorLog(
      'edge-startup-timeout',
      `graceMs=${BROWSER_LAUNCH_GRACE_MS} state=${status.state} browser=${edgeExecutablePath}`,
    );

    updateStatus(
      {
        state: 'failed',
        lastError: 'Microsoft Edge opened slowly or WhatsApp Web did not load in time.',
        info: 'Browser startup timed out. Retrying may help on first launch.',
        lastDisconnectAt: new Date().toISOString(),
      },
      'edge-startup-timeout',
      `browser=${edgeExecutablePath}`,
    );
    resolveStartupOnce('failed');
  }, BROWSER_LAUNCH_GRACE_MS);
}

function scheduleQrWaitTimeout(startupAttemptId: number, edgeExecutablePath: string): void {
  if (!whatsappPageLoadedAt) {
    return;
  }

  if (hasReachedAuthenticationPhase(startupAttemptId) || readinessFinalized) {
    appendCollectorLog(
      'qr-wait-timeout-skipped',
      `post-auth ${describeClientIdentity(client, startupAttemptId)}`,
    );
    return;
  }

  clearQrWaitTimeout();
  qrWaitTimeout = setTimeout(() => {
    if (
      shutdownRequested ||
      startupAttemptId !== activeStartupAttemptId ||
      readinessFinalized ||
      hasReachedAuthenticationPhase(startupAttemptId) ||
      status.state === 'authenticated' ||
      status.state === 'waiting-for-client-info' ||
      status.state === 'ready' ||
      status.qrCode
    ) {
      appendCollectorLog(
        'qr-wait-timeout-ignored',
        describeClientIdentity(client, startupAttemptId),
      );
      return;
    }

    appendCollectorLog(
      'qr-wait-timeout',
      `waitMs=${QR_AFTER_PAGE_LOAD_TIMEOUT_MS} state=${status.state} browser=${edgeExecutablePath}`,
    );

    // Never destroy an authenticated/syncing client from a QR wait timeout.
    updateStatus(
      {
        state: 'failed',
        lastError: 'WhatsApp Web loaded but no QR code appeared.',
        info: 'QR did not render. Retrying may help on first launch.',
        lastDisconnectAt: new Date().toISOString(),
      },
      'qr-wait-timeout',
      `browser=${edgeExecutablePath}`,
    );
    resolveStartupOnce('failed');
  }, QR_AFTER_PAGE_LOAD_TIMEOUT_MS);
}

function clearGroupDiscoveryTimers(): void {
  for (const timer of groupDiscoveryTimers) {
    clearTimeout(timer);
  }

  groupDiscoveryTimers = [];
}

function scheduleChatDiscoveryAfterReady(reason: string): void {
  if (isQrOnlyCertificationMode()) {
    clearGroupDiscoveryTimers();
    appendCollectorLog('certification-operational-timer-suppressed', `action=chat-discovery reason=${reason}`);
    return;
  }
  if (groupDiscoveryTimers.length > 0) {
    appendCollectorLog('group-discovery-already-scheduled', reason);
    return;
  }

  clearGroupDiscoveryTimers();

  const delaysMs = [5_000, 15_000, 30_000, 60_000, 120_000];
  groupDiscoveryTimers = delaysMs.map((delayMs, index) =>
    setTimeout(() => {
      if (shutdownRequested || !client) {
        appendCollectorLog('group-discovery-skipped', `reason=${reason} attempt=${index + 1} client-unavailable=true`);
        return;
      }

      if (!isSessionHealthy()) {
        appendCollectorLog('group-discovery-skipped', `reason=${reason} attempt=${index + 1} session-not-ready=true`);
        return;
      }

      appendCollectorLog('group-discovery-attempt', `reason=${reason} attempt=${index + 1} delayMs=${delayMs}`);
      void refreshDiscoveredChats()
        .then(() => {
          appendCollectorLog(
            'group-discovery-finished',
            `reason=${reason} attempt=${index + 1} groups=${status.groups.length} contacts=${status.contacts.length}`,
          );
        })
        .catch((error) => {
          appendCollectorLog(
            'CHAT_DISCOVERY_ERROR',
            `error=${error instanceof Error ? error.message : String(error)} reason=${reason} attempt=${index + 1}`,
          );
        });
    }, delayMs),
  );
}

async function shutdown(
  exitCode = 0,
  options?: { preserveTerminalState?: boolean },
): Promise<void> {
  reconnectAuthorizationPending = false;
  const releasePendingReconnect = releaseReconnectAuthorizationHold;
  releaseReconnectAuthorizationHold = null;
  releasePendingReconnect?.(false);
  shutdownRequested = true;
  clearStartupTimeouts();
  clearReadinessTimers();
  clearNavigationReattachTimer();
  clearReadyHeartbeat();
  resetLiveMessageListenerState();
  clearGroupDiscoveryTimers();
  resolveStartupOnce('disconnected');

  const currentClient = client;
  client = null;
  await closeBrowserGracefully(currentClient, 'shutdown');

  clearLatestQrPayload();
  if (options?.preserveTerminalState && unexpectedAuthenticationShutdownStarted) {
    updateStatus(
      {
        state: UNEXPECTED_AUTHENTICATION,
        connected: false,
        ready: false,
        connectedAccount: null,
        groups: [],
        contacts: [],
        failureCode: UNEXPECTED_AUTHENTICATION,
      },
      'certification-terminal-stop',
    );
  } else {
    updateStatus({ state: 'idle', startupStage: 'Stopped', info: 'Patrol monitoring stopped.' }, 'collector-stop');
  }
  try {
    helperMutex?.release();
  } catch {
    // ignore mutex release errors during shutdown
  }
  helperMutex = null;
  process.exit(exitCode);
}

function wireCommands(): void {
  const commandInput = readline.createInterface({
    input: process.stdin,
    terminal: false,
  });

  commandInput.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    let command: WhatsAppHelperCommand;
    try {
      command = JSON.parse(trimmed) as WhatsAppHelperCommand;
    } catch (error) {
      appendCollectorLog('command-parse-error', error instanceof Error ? error.message : String(error));
      return;
    }

    if (command.type === 'stop') {
      await shutdown(0);
      return;
    }

    if (command.type === 'authorize-certification-authentication') {
      appendCollectorLog('WHATSAPP_CERTIFICATION_AUTHORIZATION_REQUESTED');
      const authorized =
        isQrOnlyCertificationMode() &&
        command.explicitOperatorAuthorization === true &&
        qrOnlyCertificationGuard.authorizeAuthentication(true);
      if (authorized) {
        appendCollectorLog('WHATSAPP_CERTIFICATION_AUTHORIZED');
      } else {
        appendCollectorLog('WHATSAPP_CERTIFICATION_AUTHORIZATION_REJECTED');
      }
      emitCertificationAuthorizationResult(authorized);
      if (authorized && reconnectAuthorizationPending) {
        reconnectAuthorizationPending = false;
        const release = releaseReconnectAuthorizationHold;
        releaseReconnectAuthorizationHold = null;
        release?.(true);
      }
      return;
    }

    if (command.type === 'manual-backfill') {
      if (isQrOnlyCertificationMode()) {
        appendCollectorLog('certification-operational-command-suppressed', 'action=manual-backfill');
        return;
      }
      void runBackfill(command.hours);
    }

    if (command.type === 'send-test-image') {
      if (isQrOnlyCertificationMode()) {
        appendCollectorLog('certification-operational-command-suppressed', 'action=send-test-image');
        return;
      }
      const groupId = command.groupId?.trim() || DEFAULT_TEST_GROUP_ID;
      void sendTestImageToGroup(groupId).catch((error) => {
        appendCollectorLog(
          'pipeline:send-test-image-failure',
          `groupExternalId=${groupId} error=${error instanceof Error ? error.message : String(error)}`,
        );
      });
    }

    if (command.type === 'probe-auth-ready-lifecycle') {
      void probeAuthReadyLifecycle().catch((error) => {
        appendCollectorLog('probe-auth-ready-lifecycle-error', error instanceof Error ? error.message : String(error));
      });
    }

    if (command.type === 'refresh-discovered-chats') {
      if (isQrOnlyCertificationMode()) {
        appendCollectorLog('certification-operational-command-suppressed', 'action=refresh-discovered-chats');
        return;
      }
      void refreshDiscoveredChats().catch((error) => {
        appendCollectorLog('CHAT_DISCOVERY_ERROR', `error=${error instanceof Error ? error.message : String(error)}`);
      });
    }
  });
}

function hasExistingLocalAuthSessionCandidate(): boolean {
  const profileDir = path.join(SESSION_PATH, SESSION_PROFILE_DIR);
  if (!existsSync(profileDir)) {
    return false;
  }

  try {
    return readdirSync(profileDir).length > 0;
  } catch {
    return false;
  }
}

async function waitForReconnectCertificationAuthorization(): Promise<boolean> {
  if (!isQrOnlyCertificationMode() || !hasExistingLocalAuthSessionCandidate()) {
    return true;
  }

  reconnectAuthorizationPending = true;
  updateStatus(
    {
      state: 'RECONNECT_AUTHORIZATION_PENDING',
      startupStage: 'Reconnect authorization required',
      info: 'Authenticated WhatsApp session found. Waiting for certification authorization before reconnecting.',
      qrCode: null,
      qrPayloadLength: null,
      lastError: null,
    },
    'reconnect-authorization-pending',
    'existingLocalAuthCandidate=true initializeStarted=false',
  );

  return new Promise<boolean>((resolve) => {
    releaseReconnectAuthorizationHold = resolve;
  });
}

async function probeAuthReadyLifecycle(): Promise<void> {
  appendCollectorLog(
    'probe-auth-ready-lifecycle',
    `state=${status.state} ready=${status.ready} connected=${status.connected} account=${status.connectedAccount ?? 'none'}`,
  );

  if (!client) {
    appendCollectorLog('probe-auth-ready-lifecycle', 'no-active-client');
    return;
  }

  const waState = await probeWhatsAppConnectionState(client);
  const accountId = await probeClientAccount(client);
  appendCollectorLog(
    'probe-auth-ready-lifecycle',
    `waState=${waState ?? 'unknown'} account=${accountId ?? 'none'} readinessFinalized=${readinessFinalized}`,
  );

  if (!readinessFinalized && accountId) {
    appendCollectorLog('probe-auth-ready-lifecycle', 'promoting-to-ready');
    await finalizeClientReady(client, {
      headless: BROWSER_HEADLESS,
      browserPath: activeBrowserLaunch?.executablePath ?? 'unknown',
      readySource: 'client-info-detected',
    });
  }
}

async function initializeClientSafely(currentClient: Client): Promise<void> {
  try {
    await currentClient.initialize();
  } catch (error) {
    if (!isRecoverableContextError(error)) {
      throw error;
    }

    // Never call initialize() twice on the same Client — a second initialize during/after
    // QR scan can force WhatsApp Web into post_logout during chat synchronisation.
    appendCollectorLog(
      'initialize-recoverable-error',
      `${formatRuntimeError(error)} action=wait-without-reinitialize ${describeClientIdentity(currentClient)}`,
    );
    await sleep(NAVIGATION_REATTACH_DELAY_MS);
    if (!currentClient.pupPage || !currentClient.pupBrowser) {
      throw error;
    }
  }
}

function registerProcessGuards(): void {
  process.on('exit', () => {
    try {
      helperMutex?.release();
    } catch {
      // ignore
    }
    helperMutex = null;
  });
  process.on('SIGTERM', () => {
    void shutdown(0);
  });
  process.on('SIGINT', () => {
    void shutdown(0);
  });
  process.on('uncaughtException', (error) => {
    appendCollectorLog('uncaughtException', formatRuntimeError(error));
    if (isRecoverableContextError(error)) {
      appendCollectorLog('recoverable-uncaught-exception', 'continuing-after-navigation-context-loss');
      scheduleLiveMediaListenerReattachAfterNavigation('uncaughtException', 'execution-context');
      return;
    }

    updateStatus(
      {
        state: 'failed',
        startupStage: 'Collector failed',
        lastError: error instanceof Error ? error.message : String(error),
        info: 'Patrol monitoring stopped unexpectedly.',
        lastDisconnectAt: new Date().toISOString(),
      },
      'collector-crash',
    );
  });
  process.on('unhandledRejection', (reason) => {
    const details = formatRuntimeError(reason);
    appendCollectorLog('unhandledRejection', details);

    const looksLikeAuthTimeout = /auth timeout/i.test(details);
    if (
      looksLikeAuthTimeout &&
      hasReachedAuthenticationPhase() &&
      shouldTreatAsModuleCompatibilityFailure({
        authenticated: true,
        ready: readinessFinalized,
        pageSignals: moduleCompatibilitySignals,
        timedOutAfterAuth: true,
        lastError: details,
      })
    ) {
      reportModuleCompatibilityFailure('unhandledRejection-auth-timeout', details);
      return;
    }

    if (isWwebjsModuleCompatibilitySignal(details)) {
      rememberModuleCompatibilitySignal(details);
      if (hasReachedAuthenticationPhase() && !readinessFinalized) {
        reportModuleCompatibilityFailure('unhandledRejection', details);
      }
      return;
    }

    if (isRecoverableContextError(reason)) {
      appendCollectorLog('recoverable-unhandled-rejection', 'continuing-after-navigation-context-loss');
      scheduleLiveMediaListenerReattachAfterNavigation('unhandledRejection', 'execution-context');
    }
  });
}

async function runBrowserAttempt(
  executablePath: string,
  browserSource: ResolvedBrowserExecutable['source'],
  attemptIndex: number,
): Promise<StartupGateOutcome> {
  // Exactly one Client / Edge process: never create a second instance while post-auth sync is active.
  if (client && isPostAuthStartupProtected(client)) {
    appendCollectorLog(
      'browser-attempt-aborted-post-auth-protected',
      `refusing-second-client ${describeClientIdentity(client)}`,
    );
    if (readinessFinalized && status.state === 'ready') {
      return 'ready';
    }
    return status.state === 'disconnected' ? 'disconnected' : 'failed';
  }

  if (client) {
    const previousClient = client;
    client = null;
    await closeBrowserGracefully(previousClient, `runBrowserAttempt-replace-attempt-${attemptIndex + 1}`);
  }

  const startupAttemptId = (activeStartupAttemptId += 1);
  authenticationReachedAttemptId = null;
  activeBrowserLaunch = { executablePath, headless: BROWSER_HEADLESS };
  logBrowserLaunchConfiguration(executablePath, browserSource);
  moduleCompatibilitySignals.length = 0;
  moduleCompatibilityFailureReported = false;
  setReadinessFinalized(false, 'browser-attempt-restart');
  liveMediaListenersAttached = false;
  resetLiveMessageListenerState();
  clearReadyHeartbeat();
  cancelClientInfoWatch();
  clearStartupTimeouts();
  clearQrScanAuthenticatedTimeout();
  clearGroupDiscoveryTimers();
  startupGateResolved = false;
  startupResolve = null;
  startupReject = null;
  browserLaunchStartedAt = Date.now();
  browserLaunchCompletedAt = null;
  whatsappPageLoadedAt = null;
  qrScanDetected = false;
  qrReceivedLoggedForAttempt = null;
  recentPageConsoleErrors.length = 0;
  authenticationReachedAttemptId = null;
  clearLatestQrPayload();
  updateStatus(
    {
      qrCode: null,
      qrPayloadLength: null,
      qrDeliveredAt: null,
      qrPersistedAt: null,
      lastQrAt: null,
    },
    'client-generation-reset',
    `attemptId=${startupAttemptId}`,
  );

  const { Client, LocalAuth } = await loadWhatsAppRuntimeModule();

  logWhatsAppRuntimePackages('client-create');

  const authStrategy = new LocalAuth({
    clientId: LOCAL_AUTH_CLIENT_ID,
    dataPath: SESSION_PATH,
  });
  const originalLocalAuthLogout = authStrategy.logout.bind(authStrategy);
  authStrategy.logout = (async () => {
    logDestructiveAction('authStrategy.logout', 'whatsapp-web.js-or-client-logout', client);

    // After QR scan / auth, never delete LocalAuth unless the operator explicitly logs out or the app is shutting down.
    if (!isDestructiveLifecycleAllowed()) {
      appendCollectorLog(
        'localauth-logout-suppressed',
        `reason=post-qr-lifecycle-protection qrScanDetected=${qrScanDetected} readinessFinalized=${readinessFinalized} ${describeClientIdentity(client, startupAttemptId)}`,
      );
      return;
    }

    appendCollectorLog(
      'localauth-logout-allowed',
      `operatorLogoutRequested=${operatorLogoutRequested} shutdownRequested=${shutdownRequested}`,
    );
    logAuthLifecycle('SESSION_DELETE_REQUESTED', 'authStrategy.logout-allowed', client);
    await originalLocalAuthLogout();
  }) as typeof authStrategy.logout;

  const nextClient = new Client({
    authStrategy,
    ...buildWhatsAppWebClientOptions({
      headless: BROWSER_HEADLESS,
      executablePath,
      dumpio: BROWSER_DUMP_IO,
    }),
  });

  const startupGate = createStartupGate();

  nextClient.on('qr', (qr: string) => {
    if (blockAfterCertificationTerminal('qr')) {
      return;
    }
    if (!isActiveClientGeneration(nextClient, startupAttemptId)) {
      appendCollectorLog('qr-ignored-stale-attempt', describeClientIdentity(nextClient, startupAttemptId));
      return;
    }

    clearStartupTimeouts();
    const qrRenderMs = whatsappPageLoadedAt
      ? Date.now() - whatsappPageLoadedAt
      : browserLaunchStartedAt
        ? Date.now() - browserLaunchStartedAt
        : 0;
    qrReceivedLoggedForAttempt = startupAttemptId;
    logLifecycleEvent('qr', `length=${qr.length} ms=${qrRenderMs}`, nextClient, startupAttemptId);
    logAuthLifecycle('QR_RECEIVED', `length=${qr.length} ms=${qrRenderMs}`, nextClient);
    appendCollectorLog(
      'qr-render-time',
      `ms=${qrRenderMs} sincePageLoad=${Boolean(whatsappPageLoadedAt)} length=${qr.length} attempt=${attemptIndex + 1}`,
    );
    updateStatus(
      {
        state: 'qr-ready',
        qrCode: qr,
        lastQrAt: new Date().toISOString(),
        qrPayloadLength: qr.length,
        qrDeliveredAt: null,
        lastError: null,
      },
      'qr-received',
      `length=${qr.length} browser=${executablePath} source=${browserSource}`,
    );
    try {
      writeLatestQrPayload(qr);
      updateStatus(
        {
          qrPersistedAt: new Date().toISOString(),
        },
        'qr-persisted',
        `path=${LATEST_QR_PATH} length=${qr.length}`,
      );
    } catch (error) {
      updateStatus(
        {
          lastError: error instanceof Error ? error.message : String(error),
        },
        'qr-persist-error',
        error instanceof Error ? error.message : String(error),
      );
    }
    scheduleQrScanAuthenticatedTimeout(nextClient, startupAttemptId);
    if (SMOKE_MODE && !POST_AUTH_SMOKE_MODE && !CHAT_DISCOVERY_SMOKE_MODE) {
      setTimeout(() => void shutdown(0), 2_000);
    }
  });

  nextClient.on('authenticated', () => {
    if (blockAfterCertificationTerminal('authenticated')) {
      return;
    }
    if (!isActiveClientGeneration(nextClient, startupAttemptId)) {
      appendCollectorLog(
        'authenticated-ignored-stale-attempt',
        describeClientIdentity(nextClient, startupAttemptId),
      );
      return;
    }

    if (stopForUnexpectedAuthentication('authenticated')) {
      return;
    }

    markQrScanDetected('authenticated-event', nextClient);
    markAuthenticationReached(startupAttemptId, nextClient);
    logLifecycleEvent('authenticated', `browser=${executablePath}`, nextClient, startupAttemptId);
    logAuthLifecycle('AUTHENTICATED', `browser=${executablePath} source=${browserSource}`, nextClient);
    logAuthLifecycle('REMOTE_SESSION_SAVED', 'localauth-session-persisted-after-authenticated', nextClient);

    if (readinessFinalized || status.state === 'ready') {
      appendCollectorLog(
        'authenticated-event',
        `ignored-already-ready state=${status.state} readinessFinalized=${readinessFinalized}`,
      );
      return;
    }

    updateStatus(
      {
        state: 'authenticated',
        lastError: null,
      },
      'authenticated-event',
      `browser=${executablePath} source=${browserSource} ${describeClientIdentity(nextClient, startupAttemptId)}`,
    );
    void watchClientInfoAfterAuthentication(nextClient, executablePath, startupAttemptId);
  });

  nextClient.on('change_state', (state: string) => {
    if (blockAfterCertificationTerminal(`change_state:${state}`)) {
      return;
    }
    if (!isActiveClientGeneration(nextClient, startupAttemptId)) {
      appendCollectorLog('change-state-ignored-stale-attempt', describeClientIdentity(nextClient, startupAttemptId));
      return;
    }
    if (/^CONNECTED$/i.test(state) && stopForUnexpectedAuthentication('CONNECTED')) {
      return;
    }
    logLifecycleEvent('change_state', `waState=${state}`, nextClient, startupAttemptId);
    if (/^CONNECTED$/i.test(state)) {
      markQrScanDetected(`change_state:${state}`, nextClient);
    }
  });

  nextClient.on('ready', async () => {
    if (blockAfterCertificationTerminal('ready')) {
      return;
    }
    if (!isActiveClientGeneration(nextClient, startupAttemptId)) {
      appendCollectorLog('ready-ignored-stale-attempt', describeClientIdentity(nextClient, startupAttemptId));
      return;
    }

    if (stopForUnexpectedAuthentication('ready')) {
      return;
    }

    markQrScanDetected('ready-event', nextClient);
    markAuthenticationReached(startupAttemptId, nextClient);
    logLifecycleEvent('ready', `browser=${executablePath}`, nextClient, startupAttemptId);
    logAuthLifecycle('READY', `browser=${executablePath} source=${browserSource}`, nextClient);
    appendCollectorLog('client-info-detected', `source=library-ready-event browser=${executablePath}`);
    cancelClientInfoWatch();
    await finalizeClientReady(nextClient, {
      headless: BROWSER_HEADLESS,
      browserPath: executablePath,
      readySource: 'ready-event',
    });

    if (POST_AUTH_SMOKE_MODE) {
      appendCollectorLog('POST_AUTH_SMOKE_PASS', describeClientIdentity(nextClient, startupAttemptId));
      setTimeout(() => void shutdown(0), 1_000);
    }
  });

  nextClient.on('disconnected', (reason: string) => {
    if (blockAfterCertificationTerminal(`disconnected:${reason}`)) {
      return;
    }
    if (!isActiveClientGeneration(nextClient, startupAttemptId)) {
      appendCollectorLog('disconnected-ignored-stale-attempt', describeClientIdentity(nextClient, startupAttemptId));
      return;
    }
    clearStartupTimeouts();
    clearReadinessTimers();
    clearGroupDiscoveryTimers();

    const normalizedReason = reason?.trim() || 'unknown';
    const wasHealthy = isSessionHealthy();
    const postAuthIncomplete =
      normalizedReason === 'LOGOUT' &&
      !operatorLogoutRequested &&
      !readinessFinalized &&
      authenticationReachedAttemptId === startupAttemptId;

    logLifecycleEvent(
      'disconnected',
      `reason=${normalizedReason} wasHealthy=${wasHealthy} postAuthIncomplete=${postAuthIncomplete} operatorLogoutRequested=${operatorLogoutRequested}`,
      nextClient,
      startupAttemptId,
    );
    logAuthLifecycle(
      'DISCONNECTED',
      `reason=${normalizedReason} wasHealthy=${wasHealthy} postAuthIncomplete=${postAuthIncomplete}`,
      nextClient,
    );
    appendCollectorLog(
      'disconnected-event',
      `reason=${normalizedReason} wasHealthy=${wasHealthy} sessionPreserved=true logoutNotRequested=${!operatorLogoutRequested} ${describeClientIdentity(nextClient, startupAttemptId)}`,
    );

    if (isSessionCorruptionSignal(normalizedReason)) {
      reportSessionCorruption('disconnected-event', normalizedReason);
    }

    // Do not logout/delete LocalAuth here. Session files are preserved unless the operator resets.
    if (client === nextClient) {
      client = null;
    }
    clearLatestQrPayload();
    setReadinessFinalized(false, 'disconnected-event');

    updateStatus(
      {
        state: 'disconnected',
        qrCode: null,
        qrPayloadLength: null,
        qrDeliveredAt: null,
        qrPersistedAt: null,
        connectedAccount: status.connectedAccount,
        info: status.sessionCorruptionSuspected
          ? SESSION_CORRUPTION_USER_MESSAGE
          : postAuthIncomplete
            ? POST_AUTH_LOGOUT_MESSAGE
            : `WhatsApp disconnected (${normalizedReason}). Session files preserved.`,
        lastError: postAuthIncomplete
          ? POST_AUTH_LOGOUT_MESSAGE
          : normalizedReason === 'LOGOUT'
            ? 'WhatsApp logged out on the phone or session ended.'
            : normalizedReason,
        lastDisconnectAt: new Date().toISOString(),
      },
      'disconnected-event',
      normalizedReason,
    );

    if (POST_AUTH_SMOKE_MODE && postAuthIncomplete) {
      appendCollectorLog('POST_AUTH_SMOKE_FAIL', `reason=${normalizedReason}`);
      setTimeout(() => void shutdown(1), 500);
    }

    if (!startupGateResolved) {
      resolveStartupOnce('disconnected');
    }
  });

  nextClient.on('auth_failure', (message: string) => {
    if (blockAfterCertificationTerminal('auth_failure')) {
      return;
    }
    if (!isActiveClientGeneration(nextClient, startupAttemptId)) {
      appendCollectorLog('auth-failure-ignored-stale-attempt', describeClientIdentity(nextClient, startupAttemptId));
      return;
    }
    clearStartupTimeouts();
    clearReadinessTimers();
    logLifecycleEvent('auth_failure', message, nextClient, startupAttemptId);
    updateStatus(
      {
        state: 'failed',
        connectedAccount: null,
        info: `Patrol monitoring authentication failed: ${message}`,
        lastError: message,
        lastDisconnectAt: new Date().toISOString(),
      },
      'auth-failure',
      message,
    );
    resolveStartupOnce('auth_failure');
  });

  client = nextClient;

  updateStatus(
    {
      state: 'browser-launching',
      lastError: null,
    },
    'browser-opened',
    `executable=${executablePath} source=${browserSource} headless=${BROWSER_HEADLESS} attempt=${attemptIndex + 1}`,
  );

  updateStatus(
    {
      state: 'whatsapp-loading',
      browserExecutablePath: executablePath,
      browserExecutableSource: browserSource,
    },
    'whatsapp-loading',
    `browser=${executablePath} source=${browserSource} headless=${BROWSER_HEADLESS}`,
  );

  scheduleBrowserLaunchGraceTimeout(startupAttemptId, executablePath);
  void attachPageDiagnostics(nextClient);
  void (async () => {
    try {
      await initializeClientSafely(nextClient);
      if (startupAttemptId !== activeStartupAttemptId) {
        appendCollectorLog('initialize-complete-stale', `browser=${executablePath}`);
        return;
      }

      appendCollectorLog('initialize-complete', `browser=${executablePath} source=${browserSource}`);

      const browserReady = await verifyBrowserLaunch(nextClient, executablePath, browserSource);
      if (!browserReady) {
        reportBrowserAutomationFailure(
          `browser or page missing after initialize executable=${executablePath} source=${browserSource}`,
        );
        rejectStartup(new Error(BROWSER_AUTOMATION_FAILED_MESSAGE));
        return;
      }

      if (!browserLaunchCompletedAt) {
        browserLaunchCompletedAt = Date.now();
        appendCollectorLog(
          'browser-launch-complete',
          `source=initialize-complete elapsedMs=${browserLaunchStartedAt ? browserLaunchCompletedAt - browserLaunchStartedAt : 'unknown'}`,
        );
      }
    } catch (error) {
      if (startupAttemptId !== activeStartupAttemptId) {
        appendCollectorLog(
          'stale-initialize-error',
          `browser=${executablePath} error=${error instanceof Error ? error.message : String(error)}`,
        );
        return;
      }

      rejectStartup(error);
    }
  })();

  try {
    const attemptResult = await startupGate;
    appendCollectorLog(
      'startup-outcome',
      `result=${attemptResult} state=${status.state} ready=${status.ready} browser=${executablePath} source=${browserSource}`,
    );
    return attemptResult;
  } catch (error) {
    clearStartupTimeouts();
    clearReadinessTimers();
    rejectStartup(error);
    appendCollectorLog(
      'collector-attempt-error',
      `browser=${executablePath} source=${browserSource} error=${error instanceof Error ? error.stack || error.message : String(error)}`,
    );
    throw error;
  }
}

async function startCollector(): Promise<void> {
  wireCommands();
  registerProcessGuards();
  appendCollectorLog(
    'collector-helper-start',
    `api=${API_BASE_URL} sessionPath=${SESSION_PATH} headless=${BROWSER_HEADLESS} smoke=${SMOKE_MODE} liveDebug=${LIVE_DEBUG_MODE}`,
  );

  try {
    ensureSessionDirectoryWritable();
  } catch (error) {
    updateStatus(
      {
        state: 'failed',
        startupStage: 'Collector startup failed',
        lastError: error instanceof Error ? error.message : String(error),
        info: 'Patrol monitoring could not prepare its session folder.',
        lastDisconnectAt: new Date().toISOString(),
      },
      'session-path-error',
      error instanceof Error ? error.message : String(error),
    );
    return;
  }

  try {
    const existingHelper = readHelperMutex(SESSION_PATH);
    if (existingHelper && existingHelper.pid !== process.pid) {
      appendCollectorLog(
        'EXISTING_HELPER_FOUND',
        `pid=${existingHelper.pid} startedAt=${existingHelper.startedAt}`,
      );
    }
    helperMutex = acquireHelperMutex(SESSION_PATH);
    appendCollectorLog('helper-mutex-acquired', `pid=${helperMutex.pid} path=${helperMutex.path}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    appendCollectorLog('EXISTING_HELPER_FOUND', message);
    updateStatus(
      {
        state: 'failed',
        startupStage: 'Helper already running',
        lastError: message,
        info: message,
        lastDisconnectAt: new Date().toISOString(),
      },
      'helper-mutex-error',
      message,
    );
    return;
  }

  const runtimeConfig = await fetchRuntimeConfig();
  status.allowFromMe = runtimeConfig.allowFromMe;

  const reconnectAuthorized = await waitForReconnectCertificationAuthorization();
  if (!reconnectAuthorized || shutdownRequested || qrOnlyCertificationGuard.isTerminal()) {
    appendCollectorLog(
      'reconnect-authorization-hold-ended',
      `authorized=${reconnectAuthorized} shutdown=${shutdownRequested} terminal=${qrOnlyCertificationGuard.isTerminal()}`,
    );
    return;
  }
  if (isQrOnlyCertificationMode() && qrOnlyCertificationGuard.currentState === 'AUTHENTICATION_AUTHORIZED') {
    appendCollectorLog('reconnect-authorization-released', 'clientInitializeMayStart=true');
  }

  const browserResolution = resolveBrowserExecutables();
  const launchPlan = buildBrowserLaunchPlan(browserResolution.available);
  const primaryBrowser = launchPlan[0] ?? null;

  appendCollectorLog(
    'browser-selection',
    `preference=${browserResolution.preference} browserSource=${primaryBrowser?.source ?? 'none'} executable=${primaryBrowser?.executablePath ?? 'none'} plan=${launchPlan.map((b) => b.source).join(',') || 'none'}`,
  );
  appendCollectorLog('whatsapp-web-runtime-mode', formatWhatsAppRuntimeConfigSummary());

  updateStatus(
    {
      browserExecutablePath: primaryBrowser?.executablePath ?? null,
      browserExecutableSource: primaryBrowser?.source ?? null,
      browserCandidatesTried: browserResolution.tried,
      state: 'browser-launching',
      startupStage: primaryBrowser
        ? `Launching ${primaryBrowser.source === 'edge' ? 'Microsoft Edge' : 'Google Chrome'}...`
        : 'Browser not found',
      info: primaryBrowser
        ? `Launching ${primaryBrowser.source === 'edge' ? 'Microsoft Edge' : 'Google Chrome'} for WhatsApp...`
        : BROWSER_AUTOMATION_FAILED_MESSAGE,
    },
    'browser-resolution',
    `available=${browserResolution.available.map((browser) => `${browser.source}:${browser.executablePath}`).join(' | ') || 'none'} tried=${browserResolution.tried.join(' | ') || 'none'}`,
  );

  if (!primaryBrowser) {
    reportBrowserAutomationFailure('No Edge or Chrome executable found on this computer.');
    return;
  }

  if (process.platform !== 'win32') {
    updateStatus(
      {
        state: 'failed',
        lastError: BROWSER_AUTOMATION_FAILED_MESSAGE,
        info: BROWSER_AUTOMATION_FAILED_MESSAGE,
        lastDisconnectAt: new Date().toISOString(),
      },
      'browser-resolution-error',
      'non-windows-platform',
    );
    return;
  }

  const maxAttempts = 1 + MAX_BLANK_QR_STARTUP_RETRIES;

  try {
    let lastOutcome: StartupGateOutcome = 'failed';

    for (let attemptIndex = 0; attemptIndex < maxAttempts; attemptIndex += 1) {
      if (attemptIndex > 0) {
        if (!isRetryableStartupFailure(lastOutcome)) {
          break;
        }

        appendCollectorLog(
          'startup-retry',
          `attempt=${attemptIndex + 1} max=${maxAttempts} reason=${status.lastError ?? status.info ?? 'unknown'}`,
        );

        if (client) {
          if (isPostAuthStartupProtected(client)) {
            appendCollectorLog(
              'startup-retry-blocked-post-auth',
              describeClientIdentity(client),
            );
            return;
          }
          await fullyDestroyClientSession(client, 'startup-retry');
        }

      }

      await prepareBrowserLaunch(attemptIndex);

      let primaryLaunchError: Error | null = null;
      let browserLaunched = false;

      for (let browserIndex = 0; browserIndex < launchPlan.length; browserIndex += 1) {
        const browser = launchPlan[browserIndex];
        const profileDir = sessionProfileDirectory();

        // Never start a second browser against a locked/in-use profile.
        const lockBeforeLaunch = detectProfileLock(profileDir);
        if (lockBeforeLaunch.locked) {
          appendCollectorLog(
            'PROFILE_LOCK_DETECTED',
            `before-launch source=${browser.source} owners=${formatBrowserOwners(lockBeforeLaunch.owners)} lockFiles=${lockBeforeLaunch.lockFilesPresent.join(',') || 'none'}`,
          );
          if (lockBeforeLaunch.owners.length > 0) {
            appendCollectorLog('EXISTING_BROWSER_FOUND', formatBrowserOwners(lockBeforeLaunch.owners));
          }

          try {
            await ensureProfileUnlocked(profileDir, (event, details) => {
              appendCollectorLog(event, details);
            });
          } catch (unlockError) {
            const message =
              unlockError instanceof ProfileLockError
                ? unlockError.message
                : unlockError instanceof Error
                  ? unlockError.message
                  : String(unlockError);
            throw new ProfileLockError(
              message,
              profileDir,
              unlockError instanceof ProfileLockError ? unlockError.owners : lockBeforeLaunch.owners,
            );
          }
        }

        if (browserIndex > 0) {
          // Fallback is only allowed once the prior browser fully released the shared profile.
          const lockAfterPrimary = detectProfileLock(profileDir);
          if (lockAfterPrimary.locked) {
            appendCollectorLog(
              'browser-launch-fallback-blocked-profile-lock',
              `refusing ${browser.source} while profile still locked owners=${formatBrowserOwners(lockAfterPrimary.owners)}`,
            );
            throw new ProfileLockError(
              buildProfileLockFailureMessage(
                profileDir,
                lockAfterPrimary.owners,
                `${launchPlan[0].source} failed and the shared profile is still locked — not launching ${browser.source} against the same userDataDir.`,
              ),
              profileDir,
              lockAfterPrimary.owners,
            );
          }

          appendCollectorLog(
            'browser-launch-fallback',
            `primary=${launchPlan[0].source} failed=${primaryLaunchError?.message ?? 'unknown'}; trying ${browser.source} executable=${browser.executablePath}`,
          );

          if (client) {
            if (isPostAuthStartupProtected(client)) {
              appendCollectorLog(
                'browser-fallback-blocked-post-auth',
                describeClientIdentity(client),
              );
              break;
            }
            await fullyDestroyClientSession(client, 'browser-launch-fallback');
            await ensureProfileUnlocked(profileDir, (event, details) => {
              appendCollectorLog(event, details);
            });
          }
        }

        try {
          lastOutcome = await runBrowserAttempt(browser.executablePath, browser.source, attemptIndex);
          browserLaunched = true;
          break;
        } catch (error) {
          const launchError = error instanceof Error ? error : new Error(String(error));
          const lockAfterFailure = detectProfileLock(profileDir);

          appendCollectorLog(
            'browser-launch-failed',
            `source=${browser.source} executable=${browser.executablePath} error=${formatRuntimeError(launchError)} profileLocked=${lockAfterFailure.locked} owners=${formatBrowserOwners(lockAfterFailure.owners)}`,
          );

          if (browserIndex === 0) {
            primaryLaunchError = launchError;
          }

          if (isProfileLockErrorMessage(launchError.message) || lockAfterFailure.locked) {
            if (lockAfterFailure.owners.length > 0) {
              appendCollectorLog('EXISTING_BROWSER_FOUND', formatBrowserOwners(lockAfterFailure.owners));
            }
            appendCollectorLog(
              'PROFILE_LOCK_DETECTED',
              `after-launch-failure source=${browser.source} owners=${formatBrowserOwners(lockAfterFailure.owners)}`,
            );
            // Do not fall back to another browser using the same userDataDir.
            throw new ProfileLockError(
              buildProfileLockFailureMessage(
                profileDir,
                lockAfterFailure.owners,
                launchError.message,
              ),
              profileDir,
              lockAfterFailure.owners,
            );
          }

          if (browserIndex < launchPlan.length - 1) {
            continue;
          }

          if (primaryLaunchError && launchPlan.length > 1) {
            throw new Error(
              `${launchPlan[0].source} launch failed: ${primaryLaunchError.message}; ${browser.source} launch failed: ${launchError.message}`,
            );
          }

          throw launchError;
        }
      }

      if (!browserLaunched) {
        break;
      }

      appendCollectorLog(
        'startup-outcome',
        `result=${lastOutcome} attempt=${attemptIndex + 1} state=${status.state} ready=${status.ready} browser=${status.browserExecutablePath ?? 'unknown'}`,
      );

      if (lastOutcome === 'ready') {
        return;
      }

      if (status.state === 'authenticated' || status.state === 'waiting-for-client-info') {
        return;
      }

      if (!isRetryableStartupFailure(lastOutcome) || attemptIndex >= maxAttempts - 1) {
        break;
      }

      await sleep(2_500);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    appendCollectorLog(
      'collector-attempt-error',
      `browser=${status.browserExecutablePath ?? 'unknown'} error=${error instanceof Error ? error.stack || error.message : String(error)}`,
    );

    if (error instanceof ProfileLockError || isProfileLockErrorMessage(message)) {
      reportBrowserAutomationFailure(message);
    } else {
      updateStatus(
        {
          state: 'failed',
          info: BROWSER_AUTOMATION_FAILED_MESSAGE,
          lastError: message || BROWSER_AUTOMATION_FAILED_MESSAGE,
          lastDisconnectAt: new Date().toISOString(),
        },
        'puppeteer-launch-error',
        error instanceof Error ? error.stack || error.message : String(error),
      );
    }

    if (SMOKE_MODE && !shutdownRequested) {
      process.exitCode = 1;
    }
  }
}

void startCollector().catch((error) => {
  appendCollectorLog(
    'collector-start-fatal',
    error instanceof Error ? error.stack || error.message : String(error),
  );
  updateStatus(
    {
      state: 'failed',
      lastError: error instanceof Error ? error.message : String(error),
      info: 'Patrol monitoring failed to start.',
      lastDisconnectAt: new Date().toISOString(),
    },
    'collector-start-fatal',
  );
  if (!shutdownRequested) {
    process.exitCode = 1;
  }
});
