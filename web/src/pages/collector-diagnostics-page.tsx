import { useEffect, useState } from 'react';
import QRCode from 'react-qr-code';
import { apiRequest } from '../lib/api';
import { getDesktopState, openDesktopPath, saveDesktopConfig } from '../lib/desktop';
import { formatMonitoringStateUpdateTime, monitoringHelperStateLabel } from '../lib/monitoring-state';
import { MonitoringStatusBar } from '../components/monitoring-status-bar';
import { useAuth } from '../state/auth';
import { useMonitoring } from '../state/monitoring';
import type { DashboardOverview, DesktopBootstrapStatus, DesktopState, WhatsAppCollectorStatus } from '../types';
import { Card, EmptyState, PageHeader, StatusBadge } from '../components/ui';

function formatDateTime(value: string | null): string {
  if (!value) {
    return 'Not yet';
  }

  return new Date(value).toLocaleString();
}

export function CollectorDiagnosticsPage(): JSX.Element {
  const { token, user } = useAuth();
  const {
    status,
    view,
    error: monitoringError,
    isBusy: monitoringBusy,
    refresh,
    start,
    stop,
    resetSession,
    createFreshProfile,
  } = useMonitoring();
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [manualBackfillHours, setManualBackfillHours] = useState(24);
  const [desktopState, setDesktopState] = useState<DesktopState | null>(null);
  const [bootstrapStatus, setBootstrapStatus] = useState<DesktopBootstrapStatus | null>(null);
  const [chromePath, setChromePath] = useState('');
  const [browserPreference, setBrowserPreference] = useState<'chrome' | 'edge' | 'auto'>('chrome');
  const [now, setNow] = useState(() => Date.now());
  const [qrRenderedAt, setQrRenderedAt] = useState<string | null>(null);

  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    void apiRequest<DashboardOverview>(`/dashboard/overview?date=${today}`, {}, token ?? undefined)
      .then(setOverview)
      .catch(() => setOverview(null));
  }, [token, today]);

  useEffect(() => {
    void getDesktopState().then((nextState) => {
      if (!nextState) {
        return;
      }
      setDesktopState(nextState);
      setChromePath(nextState.config.whatsappChromePath ?? '');
      setBrowserPreference(nextState.config.whatsappBrowser ?? 'auto');
    });
  }, []);

  useEffect(() => {
    if (!token) {
      return;
    }

    void apiRequest<DesktopBootstrapStatus>('/desktop/bootstrap/status', {}, token)
      .then(setBootstrapStatus)
      .catch(() => setBootstrapStatus(null));
  }, [token]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!status?.qrCode) {
      setQrRenderedAt(null);
      return;
    }

    const renderedAt = new Date().toISOString();
    setQrRenderedAt(renderedAt);
    console.info('qr-rendered', {
      renderedAt,
      length: status.qrCode.length,
      latestQrPath: status.latestQrPath,
    });
  }, [status?.latestQrPath, status?.qrCode]);

  const actionBusy = isBusy || monitoringBusy;
  const displayError = error ?? monitoringError;

  async function refreshQr(): Promise<void> {
    setError(null);

    try {
      if (status?.state !== 'idle' && status?.state !== 'disabled') {
        await stop();
        await new Promise((resolve) => window.setTimeout(resolve, 1500));
      }

      await start();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Unable to refresh QR');
    }
  }

  async function restartMonitoring(): Promise<void> {
    setError(null);

    try {
      await stop();
      await new Promise((resolve) => window.setTimeout(resolve, 1500));
      await resetSession();
      await new Promise((resolve) => window.setTimeout(resolve, 1000));
      await start();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Unable to restart patrol monitoring');
    }
  }

  async function runManualBackfill(): Promise<void> {
    setIsBusy(true);
    setError(null);

    try {
      await apiRequest<WhatsAppCollectorStatus>(
        '/collectors/whatsapp/backfill',
        {
          method: 'POST',
          body: JSON.stringify({ hours: manualBackfillHours }),
        },
        token ?? undefined,
      );
      await refresh();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'History refresh failed');
    } finally {
      setIsBusy(false);
    }
  }

  async function saveChromePath(): Promise<void> {
    setIsBusy(true);
    setError(null);

    try {
      const nextState = await saveDesktopConfig({
        whatsappChromePath: chromePath.trim() || undefined,
        whatsappBrowser: browserPreference,
      });
      setDesktopState(nextState);
      await refresh();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Unable to save browser path');
    } finally {
      setIsBusy(false);
    }
  }

  async function clearChromePath(): Promise<void> {
    setIsBusy(true);
    setError(null);

    try {
      setChromePath('');
      const nextState = await saveDesktopConfig({
        whatsappChromePath: undefined,
        whatsappBrowser: browserPreference,
      });
      setDesktopState(nextState);
      await refresh();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Unable to clear browser path');
    } finally {
      setIsBusy(false);
    }
  }

  function collectorErrorText(collectorStatus: WhatsAppCollectorStatus): string | null {
    if (collectorStatus.failureCode === 'WWEBJS_MODULE_COMPATIBILITY_ERROR') {
      return 'WhatsApp connected, but this WhatsApp Web version is not compatible with the installed collector runtime.';
    }
    if (
      collectorStatus.lastError?.includes('WWEBJS_MODULE_COMPATIBILITY_ERROR') ||
      collectorStatus.lastError?.toLowerCase().includes('chat store') ||
      collectorStatus.info?.toLowerCase().includes('not compatible')
    ) {
      return 'WhatsApp connected, but this WhatsApp Web version is not compatible with the installed collector runtime.';
    }
    return collectorStatus.lastError;
  }

  if (user?.role === 'GUARD') {
    return <EmptyState title="Patrol monitoring is for admins" description="Guards only need the field workflow." />;
  }

  const collectorStartupTimestamp = status?.startupStartedAt ? new Date(status.startupStartedAt).getTime() : null;
  const showQrTimeoutPanel =
    collectorStartupTimestamp !== null &&
    !view.isLive &&
    !status?.qrCode &&
    now - collectorStartupTimestamp >= 20_000;

  return (
    <div className="page-stack">
      <PageHeader
        title="Advanced Diagnostics"
        subtitle="Runtime logs, listener state, session paths, and technical recovery tools for support staff."
      />

      <MonitoringStatusBar showRefresh />

      {displayError ? (
        <Card>
          <p className="error-text">Something went wrong. {displayError}</p>
        </Card>
      ) : null}

      {!status ? (
        <div className="fullscreen-state compact">Loading patrol monitoring status...</div>
      ) : (
        <>
          {(() => {
            const collectorStatus = status;
            const showQrPanel = view.showQr;
            const keyStates: Array<{ key: WhatsAppCollectorStatus['state']; label: string }> = [
              { key: 'qr-ready', label: 'QR ready' },
              { key: 'authenticated', label: 'Authenticated' },
              { key: 'ready', label: 'Ready' },
              { key: 'failed', label: 'Failed' },
            ];

            return (
              <>
                {showQrPanel ? (
                  <Card className="collector-qr-card collector-qr-hero">
                    <h3>Scan this WhatsApp QR code</h3>
                    <p className="collector-qr-hero-lead">
                      Open WhatsApp on the patrol phone {'>'} Linked devices {'>'} Link a device.
                    </p>

                    <div className="collector-state-row">
                      {keyStates.map((entry) => {
                        const isActive =
                          collectorStatus.state === entry.key ||
                          (entry.key === 'ready' && view.isLive) ||
                          (entry.key === 'qr-ready' && Boolean(collectorStatus.qrCode) && !collectorStatus.ready);
                        const tone =
                          entry.key === 'failed'
                            ? 'danger'
                            : entry.key === 'ready' || entry.key === 'authenticated'
                              ? 'success'
                              : entry.key === 'qr-ready'
                                ? 'warning'
                                : 'neutral';

                        return (
                          <span
                            key={entry.key}
                            className={`collector-state-pill${isActive ? ` active ${tone}` : ''}`}
                          >
                            {entry.label}
                            {isActive ? ' â€¢ now' : ''}
                          </span>
                        );
                      })}
                    </div>

                    <div className="collector-qr-hero-layout">
                      <div>
                        <p className="muted-text">{collectorStatus.info}</p>
                        <p className="muted-text">
                          Current state: <strong>{monitoringHelperStateLabel(collectorStatus.state)}</strong>
                          {' · '}
                          Operator view: <strong>{view.label}</strong>
                          {collectorStatus.lastQrAt ? ` Â· QR updated ${formatDateTime(collectorStatus.lastQrAt)}` : ''}
                        </p>
                        <div className="collector-qr-actions">
                          <button type="button" className="primary-button" disabled={actionBusy} onClick={() => void refreshQr()}>
                            Refresh QR
                          </button>
                          <button
                            type="button"
                            className="secondary-button"
                            disabled={actionBusy}
                            onClick={() => void restartMonitoring()}
                          >
                            Restart monitoring
                          </button>
                        </div>
                      </div>

                      {collectorStatus.qrCode ? (
                        <div className="collector-qr-wrap large" aria-label="WhatsApp QR code">
                          <QRCode value={collectorStatus.qrCode} size={320} level="M" />
                        </div>
                      ) : (
                        <div className="collector-qr-waiting">Waiting for QR code from patrol monitoringâ€¦</div>
                      )}
                    </div>

                    {collectorStatus.qrCode ? (
                      <details className="collector-technical-details">
                        <summary>Technical details</summary>
                        <div className="ops-stats-grid compact">
                          <div className="ops-stat">
                            <span>QR payload length</span>
                            <strong>{collectorStatus.qrPayloadLength ?? collectorStatus.qrCode.length}</strong>
                          </div>
                          <div className="ops-stat">
                            <span>QR rendered</span>
                            <strong>{formatDateTime(qrRenderedAt)}</strong>
                          </div>
                          <div className="ops-stat">
                            <span>Latest QR file</span>
                            <strong>{collectorStatus.latestQrPath}</strong>
                          </div>
                          <div className="ops-stat">
                            <span>QR persisted</span>
                            <strong>{formatDateTime(collectorStatus.qrPersistedAt)}</strong>
                          </div>
                          <div className="ops-stat">
                            <span>QR delivered to app</span>
                            <strong>{formatDateTime(collectorStatus.qrDeliveredAt)}</strong>
                          </div>
                        </div>
                        <label className="form-grid">
                          <span>Plain QR payload</span>
                          <textarea value={collectorStatus.qrCode} readOnly rows={4} />
                        </label>
                      </details>
                    ) : null}
                  </Card>
                ) : null}

                <Card className={`ops-banner ${view.isLive ? 'ops-banner-ready' : 'ops-banner-warning'}`}>
                  <div className="ops-banner-header">
                    <div>
                      <h3>WhatsApp patrol monitoring</h3>
                      <p className="muted-text">{collectorStatus.info}</p>
                    </div>
                    <div className="ops-banner-badges">
                      <StatusBadge value={view.statusBadge} />
                      {collectorStatus.backfillRunning ? <StatusBadge value="BACKFILLING" /> : null}
                    </div>
                  </div>

                  <div className="button-row collector-actions">
                    <button type="button" className="primary-button" disabled={actionBusy} onClick={() => void start()}>
                      Start monitoring
                    </button>
                    <button type="button" className="secondary-button" disabled={actionBusy} onClick={() => void stop()}>
                      Stop monitoring
                    </button>
                    <button type="button" className="secondary-button" disabled={actionBusy} onClick={() => void resetSession()}>
                      Reconnect WhatsApp
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={actionBusy}
                      onClick={() => {
                        if (
                          window.confirm(
                            'Archive the current app WhatsApp profile and create a fresh one? A new QR will be required.',
                          )
                        ) {
                          void createFreshProfile();
                        }
                      }}
                    >
                      Create fresh WhatsApp profile
                    </button>
                  </div>

                  <div className="collector-recovery-row">
                    <label className="inline-field">
                      <span>History refresh window</span>
                      <select
                        value={manualBackfillHours}
                        onChange={(event) => setManualBackfillHours(Number(event.target.value))}
                        disabled={isBusy}
                      >
                        {[1, 2, 4, 6, 12, 24, 36, 48].map((hours) => (
                          <option key={hours} value={hours}>
                            Last {hours} hour{hours === 1 ? '' : 's'}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button type="button" className="secondary-button" disabled={actionBusy || !view.isLive} onClick={() => void runManualBackfill()}>
                      Refresh last {manualBackfillHours}h
                    </button>
                  </div>

                  <div className="ops-stats-grid">
                    <div className="ops-stat"><span>Collector state</span><strong>{monitoringHelperStateLabel(collectorStatus.state)}</strong></div>
                    <div className="ops-stat"><span>Operator status</span><strong>{view.label}</strong></div>
                    <div className="ops-stat"><span>Connected</span><strong>{view.isLive ? 'Yes' : 'No'}</strong></div>
                    <div className="ops-stat"><span>Ready / Live</span><strong>{view.isLive ? 'Yes' : 'No'}</strong></div>
                    <div className="ops-stat"><span>Browser launch</span><strong>{collectorStatus.browserExecutablePath ? 'Ready' : 'Not found'}</strong></div>
                    <div className="ops-stat"><span>Session folder writable</span><strong>{collectorStatus.sessionPathWritable ? 'Yes' : 'No'}</strong></div>
                    <div className="ops-stat"><span>Mapped groups</span><strong>{collectorStatus.mappedGroupsCount}</strong></div>
                    <div className="ops-stat"><span>Allow self-sent images</span><strong>{collectorStatus.allowFromMe ? 'Enabled' : 'Disabled'}</strong></div>
                    <div className="ops-stat"><span>Last ready</span><strong>{formatDateTime(collectorStatus.lastReadyAt)}</strong></div>
                    <div className="ops-stat"><span>Last disconnect</span><strong>{formatDateTime(collectorStatus.lastDisconnectAt)}</strong></div>
                    <div className="ops-stat"><span>Last history refresh</span><strong>{formatDateTime(collectorStatus.lastBackfillAt)}</strong></div>
                    <div className="ops-stat"><span>Connected account</span><strong>{collectorStatus.connectedAccount ?? (view.isLive ? 'Live session' : view.isLinking ? 'Linking' : 'Not connected')}</strong></div>
                    <div className="ops-stat"><span>Live messages processed</span><strong>{collectorStatus.liveMessagesProcessed ?? 0}</strong></div>
                    <div className="ops-stat"><span>Live images received</span><strong>{collectorStatus.liveImagesImported ?? 0}</strong></div>
                    <div className="ops-stat"><span>Live duplicates skipped</span><strong>{collectorStatus.liveDuplicatesSkipped ?? 0}</strong></div>
                    <div className="ops-stat"><span>History messages scanned</span><strong>{collectorStatus.backfillMessagesScanned}</strong></div>
                    <div className="ops-stat"><span>History images imported</span><strong>{collectorStatus.backfillImagesImported}</strong></div>
                    <div className="ops-stat"><span>History duplicates skipped</span><strong>{collectorStatus.backfillDuplicatesSkipped}</strong></div>
                    <div className="ops-stat"><span>Images received today</span><strong>{overview?.imageTotals.received ?? 0}</strong></div>
                    <div className="ops-stat"><span>Last image received</span><strong>{formatDateTime(overview?.recentImages[0]?.sentAt ?? null)}</strong></div>
                    <div className="ops-stat"><span>Pilot group</span><strong>{collectorStatus.pilotGroupName ?? 'Not set'}</strong></div>
                    <div className="ops-stat"><span>Browser path</span><strong>{collectorStatus.browserExecutablePath ?? 'None found'}</strong></div>
                    <div className="ops-stat"><span>Session path</span><strong>{collectorStatus.sessionPath}</strong></div>
                    <div className="ops-stat"><span>Last state update</span><strong>{formatMonitoringStateUpdateTime(collectorStatus.lastEventAt)}</strong></div>
                  </div>

                  {collectorStatus.lastError || collectorStatus.failureCode || showQrTimeoutPanel ? (
                    <Card className="wizard-card">
                      <h3>
                        {collectorStatus.failureCode === 'WWEBJS_MODULE_COMPATIBILITY_ERROR'
                          ? 'WhatsApp Web compatibility'
                          : showQrTimeoutPanel
                            ? 'QR is taking longer than expected'
                            : 'Patrol monitoring error'}
                      </h3>
                      <p className="muted-text">
                        {collectorErrorText(collectorStatus) ??
                          'Patrol monitoring did not receive a QR code within 20 seconds. Review the latest debug log lines below, then retry the start action.'}
                      </p>
                      <div className="button-row">
                        <button type="button" className="secondary-button" disabled={actionBusy} onClick={() => void start()}>
                          Retry start
                        </button>
                        <button
                          type="button"
                          className="secondary-button"
                          disabled={!collectorStatus.collectorLogPath}
                          onClick={() => void openDesktopPath(collectorStatus.collectorLogPath)}
                        >
                          Open WhatsApp Debug Log
                        </button>
                        <button
                          type="button"
                          className="secondary-button"
                          disabled={!collectorStatus.latestQrPath}
                          onClick={() => void openDesktopPath(collectorStatus.latestQrPath)}
                        >
                          Open latest QR
                        </button>
                      </div>
                      <pre className="frontend-diagnostics-log">{collectorStatus.collectorLogTail.join('\n') || 'No collector log lines yet.'}</pre>
                    </Card>
                  ) : null}
                </Card>

                <Card className="wizard-card">
                  <h3>Storage paths</h3>
                  <p className="muted-text">
                    Patrol images use the configured storage folder. The SQLite database stays in the desktop app data folder.
                  </p>
                  <div className="ops-stats-grid compact">
                    <div className="ops-stat">
                      <span>Config file</span>
                      <strong>{bootstrapStatus?.configPath ?? desktopState?.configPath ?? 'Unavailable'}</strong>
                    </div>
                    <div className="ops-stat">
                      <span>Database path</span>
                      <strong>{bootstrapStatus?.databasePath ?? 'Unavailable'}</strong>
                    </div>
                    <div className="ops-stat">
                      <span>Saved patrol image folder</span>
                      <strong>{bootstrapStatus?.storageRootPath ?? 'Not set'}</strong>
                    </div>
                    <div className="ops-stat">
                      <span>Active patrol image path</span>
                      <strong>{bootstrapStatus?.activeStorageRootPath ?? bootstrapStatus?.patrolImageStoragePath ?? 'Unavailable'}</strong>
                    </div>
                    <div className="ops-stat">
                      <span>Auto-start monitoring on launch</span>
                      <strong>{bootstrapStatus?.autoStartCollector ? 'Enabled' : 'Disabled'}</strong>
                    </div>
                    <div className="ops-stat">
                      <span>Settings applied</span>
                      <strong>{bootstrapStatus?.settingsApplied === false ? 'No' : 'Yes'}</strong>
                    </div>
                  </div>
                </Card>

                <Card className="wizard-card">
                  <h3>Browser preference</h3>
                  <p className="muted-text">
                    Choose Chrome or Edge explicitly, or use the validated automatic selection. An explicit Chrome choice
                    launches Chrome only and never falls back to Edge.
                  </p>
                  <label className="inline-field">
                    <span>Browser</span>
                    <select
                      value={browserPreference}
                      onChange={(event) =>
                        setBrowserPreference(event.target.value as 'chrome' | 'edge' | 'auto')
                      }
                    >
                      <option value="chrome">Google Chrome</option>
                      <option value="edge">Microsoft Edge</option>
                      <option value="auto">Auto (Edge preferred)</option>
                    </select>
                  </label>
                  <label className="inline-field">
                    <span>Manual executable path (optional)</span>
                    <input
                      value={chromePath}
                      onChange={(event) => setChromePath(event.target.value)}
                      placeholder="C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
                    />
                  </label>
                  <div className="button-row">
                    <button type="button" className="secondary-button" disabled={isBusy} onClick={() => void saveChromePath()}>
                      Save browser settings
                    </button>
                    {desktopState?.config.whatsappChromePath ? (
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={isBusy}
                        onClick={() => void clearChromePath()}
                      >
                        Clear saved path
                      </button>
                    ) : null}
                  </div>
                  <p className="muted-text">
                    Preference: {desktopState?.config.whatsappBrowser ?? browserPreference}. Path:{' '}
                    {desktopState?.config.whatsappChromePath || 'Automatic detection for the selected browser'}
                  </p>
                </Card>
              </>
            );
          })()}
        </>
      )}
    </div>
  );
}
