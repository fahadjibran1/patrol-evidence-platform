import type { WhatsAppCollectorStatus } from '../types';

export type MonitoringOpsTone = 'green' | 'amber' | 'red';

export type MonitoringPhase =
  | 'offline'
  | 'launching-browser'
  | 'loading-whatsapp'
  | 'waiting-for-qr'
  | 'qr-ready'
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
    case 'error':
      return 'Error';
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

  if (phase === 'error') {
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
  const label = phaseLabel(phase, status.backfillRunning);
  const tone = phaseTone(phase);
  const isLive = phase === 'ready';
  const isLinking = isLinkingStatus(status);
  const isError = phase === 'error';
  const isOffline = phase === 'offline' || phase === 'disabled';
  const stageLabel = status.startupStage?.trim() || label;

  const headerLabel = isLive
    ? 'Live'
    : isError
      ? 'Error'
      : isLinking
        ? label
        : 'Not linked';

  const sidebarLabel = isLive
    ? 'Monitoring live'
    : isError
      ? 'Monitoring error'
      : isLinking
        ? `Monitoring · ${label}`
        : 'WhatsApp not linked';

  const accountTitle = isLive
    ? status.connectedAccount || 'Patrol WhatsApp linked'
    : isLinking
      ? stageLabel
      : 'Not linked yet';

  const statusBadge = isLive
    ? 'CONNECTED'
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
    isLinking,
    isError,
    isOffline,
    showQr: isLinking && !isLive,
    accountTitle,
    statusBadge,
    isSessionActive: isLive || isLinking,
  };
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
