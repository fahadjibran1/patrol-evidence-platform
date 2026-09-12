import type { WhatsAppCollectorStatus } from '../types';

export type MonitoringOpsTone = 'green' | 'amber' | 'red';

export type WhatsAppConnectionState =
  | 'NOT_LINKED'
  | 'LINKING'
  | 'CONNECTED'
  | 'RECONNECTING'
  | 'RELINK_REQUIRED'
  | 'ERROR';

export type MonitoringPhase =
  | 'offline'
  | 'launching-browser'
  | 'loading-whatsapp'
  | 'waiting-for-qr'
  | 'qr-ready'
  | 'link-retry-required'
  | 'relink-required'
  | 'authenticated'
  | 'ready'
  | 'error'
  | 'disabled';

export interface MonitoringView {
  phase: MonitoringPhase;
  /** Primary operator-facing label (Monitoring card pill, Diagnostics banner). */
  label: string;
  /** App topbar Monitoring column. */
  headerLabel: string;
  /** Sidebar strip under workspace name. */
  sidebarLabel: string;
  /** Longer stage line when available. */
  stageLabel: string;
  tone: 'ready' | 'warning' | 'error' | 'idle';
  opsTone: MonitoringOpsTone;
  isLive: boolean;
  connectionState: WhatsAppConnectionState;
  connectionLabel: string;
  isConnected: boolean;
  isSessionReady: boolean;
  monitoringState: 'ACTIVE' | 'PAUSED' | 'NO_GROUPS_CONFIGURED' | 'STARTING' | 'ERROR';
  isLinking: boolean;
  isError: boolean;
  isOffline: boolean;
  showQr: boolean;
  /** Shown as session title on Monitoring page. */
  accountTitle: string;
  /** StatusBadge / diagnostics raw state display. */
  statusBadge: string;
  /** True when session is linked or linking (not idle/offline/error). */
  isSessionActive: boolean;
}

const LINKING_STATES = new Set<WhatsAppCollectorStatus['state']>([
  'starting',
  'browser-launching',
  'whatsapp-loading',
  'waiting-for-qr',
  'qr-ready',
  'authenticated',
  'waiting-for-client-info',
]);

function phaseLabel(phase: MonitoringPhase, backfillRunning: boolean): string {
  switch (phase) {
    case 'ready':
      return backfillRunning ? 'Catching up' : 'Live';
    case 'launching-browser':
      return 'Starting link';
    case 'loading-whatsapp':
      return 'Loading WhatsApp Web';
    case 'waiting-for-qr':
      return 'Waiting for QR';
    case 'qr-ready':
      return 'QR Ready';
    case 'authenticated':
      return 'Authenticating';
    case 'link-retry-required':
      return 'Try again';
    case 'error':
      return 'Error';
    case 'relink-required':
      return 'Session expired';
    case 'disabled':
      return 'Disabled';
    default:
      return 'Not linked';
  }
}

function phaseTone(phase: MonitoringPhase): MonitoringView['tone'] {
  if (phase === 'ready') {
    return 'ready';
  }

  if (phase === 'error' || phase === 'relink-required' || phase === 'link-retry-required') {
    return 'error';
  }

  if (phase === 'offline' || phase === 'disabled') {
    return 'idle';
  }

  return 'warning';
}

function opsToneFromView(tone: MonitoringView['tone']): MonitoringOpsTone {
  if (tone === 'ready') {
    return 'green';
  }

  if (tone === 'error') {
    return 'red';
  }

  return 'amber';
}

function derivePhase(status: WhatsAppCollectorStatus): MonitoringPhase {
  if (!status.enabled || status.state === 'disabled') {
    return 'disabled';
  }

  if (status.ready || status.state === 'ready') {
    return 'ready';
  }

  if (status.state === 'RELINK_REQUIRED') {
    return 'relink-required';
  }

  if (status.state === 'LINK_RETRY_REQUIRED') {
    return 'link-retry-required';
  }

  if (status.state === 'failed' || status.state === 'disconnected') {
    return 'error';
  }

  if (status.state === 'idle') {
    return 'offline';
  }

  if (status.state === 'browser-launching' || status.state === 'starting') {
    return 'launching-browser';
  }

  if (status.state === 'whatsapp-loading') {
    return 'loading-whatsapp';
  }

  if (status.state === 'waiting-for-qr') {
    return 'waiting-for-qr';
  }

  if (status.state === 'qr-ready' || Boolean(status.qrCode)) {
    return 'qr-ready';
  }

  if (status.state === 'authenticated' || status.state === 'waiting-for-client-info') {
    return 'authenticated';
  }

  return 'offline';
}

function isLinkingStatus(status: WhatsAppCollectorStatus): boolean {
  if (status.ready || status.state === 'ready') {
    return false;
  }

  if (
    status.state === 'failed' ||
    status.state === 'disconnected' ||
    status.state === 'RELINK_REQUIRED' ||
    status.state === 'LINK_RETRY_REQUIRED' ||
    status.state === 'idle' ||
    status.state === 'disabled'
  ) {
    return false;
  }

  return LINKING_STATES.has(status.state) || Boolean(status.qrCode);
}

export function deriveMonitoringView(status: WhatsAppCollectorStatus | null): MonitoringView {
  if (!status) {
    return {
      phase: 'offline',
      label: 'Not linked',
      headerLabel: 'Not linked',
      sidebarLabel: 'WhatsApp not linked',
      stageLabel: 'Not linked',
      tone: 'idle',
      opsTone: 'amber' as MonitoringOpsTone,
      isLive: false,
      connectionState: 'NOT_LINKED',
      connectionLabel: 'Not linked',
      isConnected: false,
      isSessionReady: false,
      monitoringState: 'PAUSED',
      isLinking: false,
      isError: false,
      isOffline: true,
      showQr: false,
      accountTitle: 'Not linked yet',
      statusBadge: 'OFFLINE',
      isSessionActive: false,
    };
  }

  const phase = derivePhase(status);
  const isSessionReady = phase === 'ready';
  const monitoringState = status.monitoringState ?? (isSessionReady ? 'ACTIVE' : 'PAUSED');
  const connectionState: WhatsAppConnectionState = isSessionReady
    ? 'CONNECTED'
    : phase === 'relink-required'
      ? 'RELINK_REQUIRED'
      : status.state === 'disconnected'
        ? 'RECONNECTING'
        : phase === 'error'
          ? 'ERROR'
          : isLinkingStatus(status)
            ? 'LINKING'
            : 'NOT_LINKED';
  const connectionLabel =
    connectionState === 'CONNECTED'
      ? 'Connected'
      : connectionState === 'RECONNECTING'
        ? 'Reconnecting'
        : connectionState === 'RELINK_REQUIRED'
          ? 'Relink required'
          : connectionState === 'ERROR'
            ? 'Connection error'
            : connectionState === 'LINKING'
              ? 'Linking'
              : 'Not linked';
  const label = isSessionReady
    ? monitoringState === 'ACTIVE'
      ? 'Active'
      : monitoringState === 'NO_GROUPS_CONFIGURED'
        ? 'No groups configured'
        : monitoringState === 'ERROR'
          ? 'Monitoring error'
          : monitoringState === 'STARTING'
            ? 'Starting monitoring'
            : 'Paused'
    : phaseLabel(phase, status.backfillRunning);
  const isLive = isSessionReady && monitoringState === 'ACTIVE';
  const tone = isLive ? 'ready' : isSessionReady ? 'idle' : phaseTone(phase);
  const isLinking = isLinkingStatus(status);
  const isError = phase === 'error' || phase === 'relink-required' || phase === 'link-retry-required';
  const isOffline = phase === 'offline' || phase === 'disabled';
  const stageLabel = status.startupStage?.trim() || label;

  const headerLabel = isSessionReady
    ? label
    : phase === 'relink-required'
      ? 'Session expired'
    : phase === 'link-retry-required'
      ? 'WhatsApp could not initialise'
    : isError
      ? 'Error'
      : isLinking
        ? label
        : 'Not linked';

  const sidebarLabel = isSessionReady
    ? `Monitoring ${label.toLowerCase()}`
    : phase === 'relink-required'
      ? 'WhatsApp session expired'
    : phase === 'link-retry-required'
      ? 'WhatsApp needs another try'
    : isError
      ? 'Monitoring error'
      : isLinking
        ? `Monitoring · ${label}`
        : 'WhatsApp not linked';

  const accountTitle = isSessionReady
    ? status.connectedAccount || 'Patrol WhatsApp linked'
    : phase === 'relink-required'
      ? 'Session expired'
    : phase === 'link-retry-required'
      ? 'WhatsApp could not initialise'
    : isLinking
      ? stageLabel
      : 'Not linked yet';

  const statusBadge = isSessionReady
    ? monitoringState
    : phase === 'relink-required'
      ? 'RELINK REQUIRED'
    : phase === 'link-retry-required'
      ? 'TRY AGAIN'
    : isError
      ? 'FAILED'
      : isLinking
        ? 'PENDING'
      : 'NOT LINKED';

  return {
    phase,
    label,
    headerLabel,
    sidebarLabel,
    stageLabel,
    tone,
    opsTone: opsToneFromView(tone),
    isLive,
    connectionState,
    connectionLabel,
    isConnected: connectionState === 'CONNECTED',
    isSessionReady,
    monitoringState,
    isLinking,
    isError,
    isOffline,
    showQr: isLinking && !isSessionReady,
    accountTitle,
    statusBadge,
    isSessionActive: isSessionReady || isLinking,
  };
}

export function shouldShowWhatsAppQrTimeout(
  status: WhatsAppCollectorStatus | null,
  now: number,
  timeoutMs = 20_000,
): boolean {
  if (
    !status?.startupStartedAt ||
    status.ready ||
    status.connected ||
    status.state !== 'waiting-for-qr' ||
    status.qrCode
  ) {
    return false;
  }

  const startedAt = new Date(status.startupStartedAt).getTime();
  return Number.isFinite(startedAt) && now - startedAt >= timeoutMs;
}

/** Human label for helper `state` field (diagnostics detail). */
export function monitoringHelperStateLabel(state: WhatsAppCollectorStatus['state']): string {
  switch (state) {
    case 'idle':
      return 'Idle';
    case 'starting':
      return 'Starting';
    case 'browser-launching':
      return 'Launching browser';
    case 'whatsapp-loading':
      return 'Loading WhatsApp Web';
    case 'waiting-for-qr':
      return 'Waiting for QR';
    case 'qr-ready':
      return 'QR Ready';
    case 'RECONNECT_AUTHORIZATION_PENDING':
      return 'Reconnect authorization required';
    case 'RELINK_REQUIRED':
      return 'Relink required';
    case 'LINK_RETRY_REQUIRED':
      return 'Try again';
    case 'authenticated':
      return 'Authenticated';
    case 'waiting-for-client-info':
      return 'Authenticated';
    case 'ready':
      return 'Ready';
    case 'failed':
      return 'Error';
    case 'disabled':
      return 'Disabled';
    default:
      return state;
  }
}

export function formatMonitoringStateUpdateTime(value: string | null | undefined): string {
  if (!value) {
    return 'Not yet';
  }

  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(value));
}
