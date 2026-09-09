import { Link } from 'react-router-dom';
import QRCode from 'react-qr-code';
import { MonitoringStatusBar } from '../components/monitoring-status-bar';
import { LoadingBlock, OpsStatusPill } from '../components/operator-ui';
import { RefreshBar } from '../components/refresh-bar';
import { useAuth } from '../state/auth';
import { useMonitoring } from '../state/monitoring';
import { Card, EmptyState, PageHeader } from '../components/ui';

export function CollectorPage(): JSX.Element {
  const { user } = useAuth();
  const {
    status,
    view,
    lastFetchedAt,
    isLoading,
    error,
    pollIntervalMs,
    refresh,
    isBusy,
    start,
    stop,
    resetSession,
    createFreshProfile,
    retryLink,
    relink,
  } = useMonitoring();

  if (user?.role === 'GUARD') {
    return <EmptyState title="Monitoring is for supervisors" description="Use Patrol Ops for your shift workflow." />;
  }

  return (
    <div className="page-stack">
      <PageHeader
        title="Monitoring"
        subtitle="Link WhatsApp, confirm sources are mapped in Setup, then keep this session running."
        actions={
          <Link className="secondary-button" to="/settings/diagnostics">
            Advanced diagnostics
          </Link>
        }
      />

      <RefreshBar
        lastUpdated={lastFetchedAt}
        pollIntervalSeconds={pollIntervalMs / 1000}
        onRefresh={refresh}
        isRefreshing={isLoading}
      />

      <MonitoringStatusBar />

      {error ? (
        <Card>
          <p className="error-text">{error}</p>
        </Card>
      ) : null}

      {!status && isLoading ? (
        <Card>
          <p className="muted-text">Loading monitoring status…</p>
        </Card>
      ) : status ? (
        <>
          <Card className={`monitoring-status-card monitoring-${view.opsTone}`}>
            <div className="monitoring-status-header">
              <div>
                <p className="eyebrow">WhatsApp session</p>
                <h3>{view.accountTitle}</h3>
                <p className="muted-text">
                  {view.phase === 'relink-required'
                    ? 'WhatsApp could not restore the saved linked session. Relink WhatsApp to continue.'
                    : view.phase === 'link-retry-required'
                      ? 'WhatsApp could not initialise. Check your internet connection and try again.'
                    : view.isLive
                    ? 'Patrol images from mapped sources will appear on the dashboard and in Evidence.'
                    : view.isLinking
                      ? status.info
                      : 'WhatsApp is not linked. Link it when you are ready; the rest of Patrol Evidence remains available.'}
                </p>
              </div>
              <OpsStatusPill tone={view.opsTone} label={view.label} />
            </div>

            <div className="monitoring-metrics">
              <div>
                <span>Mapped sources</span>
                <strong>{status.mappedGroupsCount}</strong>
              </div>
              <div>
                <span>Images today</span>
                <strong>{status.backfillImagesImported}</strong>
              </div>
            </div>

            <div className="button-row">
              {view.phase === 'relink-required' ? (
                <button
                  type="button"
                  className="primary-button"
                  disabled={isBusy}
                  onClick={() => void relink()}
                >
                  Relink WhatsApp
                </button>
              ) : view.phase === 'link-retry-required' ? (
                <button
                  type="button"
                  className="primary-button"
                  disabled={isBusy}
                  onClick={() => void retryLink()}
                >
                  Try Again
                </button>
              ) : view.isLinking ? (
                <button type="button" className="secondary-button" disabled={isBusy} onClick={() => void stop()}>
                  Cancel linking
                </button>
              ) : !view.isLive ? (
                <button type="button" className="primary-button" disabled={isBusy} onClick={() => void start()}>
                  {view.isError ? 'Retry linking' : 'Link WhatsApp'}
                </button>
              ) : (
                <button type="button" className="secondary-button" disabled={isBusy} onClick={() => void stop()}>
                  Pause monitoring
                </button>
              )}
              {view.isLive ? (
                <button type="button" className="secondary-button" disabled={isBusy} onClick={() => void resetSession()}>
                  Re-link WhatsApp
                </button>
              ) : null}
              {view.phase !== 'link-retry-required' ? (
                <button
                  type="button"
                  className="secondary-button"
                  disabled={isBusy}
                  onClick={() => {
                    if (
                      window.confirm(
                        'Create a completely fresh WhatsApp browser profile? The current app profile will be archived and a new QR will be shown.',
                      )
                    ) {
                      void createFreshProfile();
                    }
                  }}
                >
                  Create fresh WhatsApp profile
                </button>
              ) : null}
              <Link className="secondary-button" to="/setup">
                Source & site setup
              </Link>
            </div>
          </Card>

          {view.showQr ? (
            <Card className="collector-qr-card collector-qr-hero">
              <h3>Scan to link WhatsApp</h3>
              <p className="collector-qr-hero-lead">
                Scan only the current QR shown here in Patrol Evidence. On the patrol phone: WhatsApp → Linked devices → Link a device.
              </p>
              <div className="collector-qr-hero-layout">
                <div className="collector-qr-actions">
                  <button type="button" className="secondary-button" disabled={isBusy} onClick={() => void stop()}>
                    Cancel linking
                  </button>
                </div>
                {status.qrCode ? (
                  <div className="collector-qr-wrap large" aria-label="WhatsApp QR code">
                    <QRCode key={status.lastQrAt ?? status.qrCode} value={status.qrCode} size={280} level="M" />
                    <p className="muted-text">This code refreshes automatically. Scan the code shown here, not the browser window.</p>
                  </div>
                ) : (
                  <div className="collector-initializing">
                    {status.certificationQrMasked ? (
                      <>
                        <h4>QR prepared — waiting for certification authorization</h4>
                        <p className="muted-text">The QR will appear here only after the active certification helper is authorized.</p>
                      </>
                    ) : (
                      <LoadingBlock label={view.stageLabel} />
                    )}
                    <p className="muted-text collector-initializing-hint">
                      First launch can take up to two minutes while the selected browser and WhatsApp Web start. Do not
                      close the browser window.
                    </p>
                  </div>
                )}
              </div>
            </Card>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
