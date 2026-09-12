import { readFileSync } from 'fs';
import * as path from 'path';
import type { WhatsAppCollectorStatus } from '../../web/src/types';
import {
  deriveMonitoringView,
  shouldShowWhatsAppQrTimeout,
} from '../../web/src/lib/monitoring-state';

function status(overrides: Partial<WhatsAppCollectorStatus>): WhatsAppCollectorStatus {
  return {
    enabled: true,
    connected: false,
    ready: false,
    state: 'idle',
    info: '',
    sessionPath: '',
    qrCode: null,
    lastQrAt: null,
    lastMessageAt: null,
    lastEventAt: null,
    lastReadyAt: null,
    lastDisconnectAt: null,
    lastBackfillAt: null,
    connectedAccount: null,
    backfillRunning: false,
    backfillMessagesScanned: 0,
    backfillImagesImported: 0,
    backfillDuplicatesSkipped: 0,
    allowFromMe: false,
    mappedGroupsCount: 0,
    pilotGroupName: null,
    startupStage: null,
    startupStartedAt: null,
    lastError: null,
    collectorLogPath: '',
    latestQrPath: '',
    qrPayloadLength: null,
    qrPersistedAt: null,
    qrDeliveredAt: null,
    collectorLogTail: [],
    browserExecutablePath: null,
    browserExecutableSource: null,
    browserCandidatesTried: [],
    sessionPathExists: false,
    sessionPathWritable: false,
    ...overrides,
  };
}

describe('WhatsApp customer state model', () => {
  it('keeps a ready paused WhatsApp session connected with zero live monitoring', () => {
    const current = status({
      connected: true,
      ready: true,
      state: 'ready',
      monitoringState: 'PAUSED',
      productionListenerCount: 0,
    });
    const view = deriveMonitoringView(current);

    expect(view.connectionLabel).toBe('Connected');
    expect(view.isConnected).toBe(true);
    expect(view.isSessionReady).toBe(true);
    expect(view.monitoringState).toBe('PAUSED');
    expect(view.label).toBe('Paused');
    expect(view.isLive).toBe(false);
    expect(shouldShowWhatsAppQrTimeout(current, Date.now())).toBe(false);
  });

  it('reports ready active monitoring independently', () => {
    const view = deriveMonitoringView(
      status({ connected: true, ready: true, state: 'ready', monitoringState: 'ACTIVE' }),
    );
    expect(view.connectionLabel).toBe('Connected');
    expect(view.label).toBe('Active');
    expect(view.isLive).toBe(true);
  });

  it('allows the QR timeout warning only during an actual timed-out QR wait', () => {
    const now = Date.parse('2026-09-12T20:00:30.000Z');
    const waiting = status({
      state: 'waiting-for-qr',
      startupStartedAt: '2026-09-12T20:00:00.000Z',
    });
    expect(shouldShowWhatsAppQrTimeout(waiting, now)).toBe(true);
    expect(shouldShowWhatsAppQrTimeout({ ...waiting, state: 'authenticated' }, now)).toBe(false);
    expect(shouldShowWhatsAppQrTimeout({ ...waiting, ready: true, state: 'ready' }, now)).toBe(false);
  });

  it('presents relink and disconnected states as connection states, not monitoring states', () => {
    expect(deriveMonitoringView(status({ state: 'RELINK_REQUIRED' })).connectionLabel).toBe('Relink required');
    expect(deriveMonitoringView(status({ state: 'disconnected' })).connectionLabel).toBe('Reconnecting');
  });

  it('keeps diagnostics fields bound to connection/readiness rather than isLive', () => {
    const diagnostics = readFileSync(
      path.join(process.cwd(), 'web', 'src', 'pages', 'collector-diagnostics-page.tsx'),
      'utf8',
    );
    expect(diagnostics).toContain("view.isConnected ? 'Yes' : 'No'");
    expect(diagnostics).toContain("view.isSessionReady ? 'Yes' : 'No'");
    expect(diagnostics).toContain('shouldShowWhatsAppQrTimeout(status, now)');
    expect(diagnostics).not.toContain("<span>Connected</span><strong>{view.isLive ? 'Yes' : 'No'}</strong>");
  });
});
