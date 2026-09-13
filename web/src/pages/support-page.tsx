import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest } from '../lib/api';
import { getDesktopState } from '../lib/desktop';
import { formatMonitoringStateUpdateTime } from '../lib/monitoring-state';
import { useAuth } from '../state/auth';
import { useMonitoring } from '../state/monitoring';
import type { DesktopBootstrapStatus } from '../types';
import { Card, PageHeader } from '../components/ui';

export function SupportPage(): JSX.Element {
  const { token } = useAuth();
  const { status, view, refresh, isLoading } = useMonitoring();
  const [bootstrap, setBootstrap] = useState<DesktopBootstrapStatus | null>(null);
  const [applicationHealthy, setApplicationHealthy] = useState<boolean | null>(null);

  useEffect(() => {
    if (!token) return;
    void Promise.all([
      apiRequest<DesktopBootstrapStatus>('/desktop/bootstrap/status', {}, token),
      getDesktopState(),
    ]).then(([nextBootstrap, desktop]) => {
      setBootstrap(nextBootstrap);
      setApplicationHealthy(desktop?.backend.status === 'ready');
    }).catch(() => setApplicationHealthy(false));
  }, [token]);

  const storageHealthy = bootstrap?.databaseReady === true && bootstrap?.settingsApplied !== false;

  return (
    <div className="page-stack support-page">
      <PageHeader
        eyebrow="Settings"
        title="Support"
        subtitle="Check the parts of PatrolSafe that matter day to day, or open technical details when support asks for them."
        actions={<button type="button" className="secondary-button" disabled={isLoading} onClick={() => void refresh()}>Refresh</button>}
      />

      <div className="support-health-grid" aria-label="PatrolSafe health summary">
        <Card className="health-card">
          <span className={`health-indicator ${applicationHealthy === false ? 'danger' : 'success'}`} aria-hidden="true" />
          <div><span>Application</span><strong>{applicationHealthy === false ? 'Needs attention' : 'Healthy'}</strong></div>
        </Card>
        <Card className="health-card">
          <span className={`health-indicator ${view.isConnected ? 'success' : view.isError ? 'danger' : 'warning'}`} aria-hidden="true" />
          <div><span>WhatsApp</span><strong>{view.connectionLabel}</strong></div>
        </Card>
        <Card className="health-card">
          <span className={`health-indicator ${view.isLive ? 'success' : view.isError ? 'danger' : 'warning'}`} aria-hidden="true" />
          <div><span>Monitoring</span><strong>{view.label}</strong></div>
        </Card>
        <Card className="health-card">
          <span className={`health-indicator ${storageHealthy ? 'success' : 'warning'}`} aria-hidden="true" />
          <div><span>Evidence storage</span><strong>{storageHealthy ? 'Healthy' : 'Check settings'}</strong></div>
        </Card>
      </div>

      <div className="settings-grid">
        <Card>
          <h3>Connection help</h3>
          <p className="muted-text">
            Last successful WhatsApp connection: {formatMonitoringStateUpdateTime(status?.lastReadyAt)}.
          </p>
          <p className="muted-text">
            If WhatsApp needs attention, open Monitoring for the next recommended action. Paused monitoring does not disconnect WhatsApp.
          </p>
          <Link className="primary-button inline-action" to="/collector">Open Monitoring</Link>
        </Card>
        <Card>
          <h3>Protect your data</h3>
          <p className="muted-text">Create a verified backup before moving workstation or making significant changes.</p>
          <Link className="secondary-button inline-action" to="/settings/backup">Backup and restore</Link>
        </Card>
      </div>

      <Card className="advanced-support-card">
        <div>
          <h3>Advanced diagnostics</h3>
          <p className="muted-text">Technical logs and component details are intended for guided troubleshooting with PatrolSafe support.</p>
        </div>
        <Link className="secondary-button inline-action" to="/settings/diagnostics">Show advanced diagnostics</Link>
      </Card>
    </div>
  );
}
