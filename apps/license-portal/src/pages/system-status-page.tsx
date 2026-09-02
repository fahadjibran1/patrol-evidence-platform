import { useCallback, useEffect, useState } from 'react';
import { apiRequest, downloadAuthenticatedFile } from '../lib/api';
import { useAuth } from '../lib/auth';
import { canViewRevenue, canViewSystemStatus } from '../lib/roles';
import {
  Card,
  ErrorBanner,
  InfoBanner,
  LoadingState,
  PageHeader,
  StatusBadge,
} from '../components/ui';
import type { SystemStatus } from '../types';

const EXPORTS: Array<{ path: string; fileName: string; label: string; revenueOnly?: boolean }> = [
  { path: '/admin/exports/customers.csv', fileName: 'customers.csv', label: 'Customers' },
  { path: '/admin/exports/licences.csv', fileName: 'licences.csv', label: 'Licences' },
  { path: '/admin/exports/renewals.csv', fileName: 'renewals.csv', label: 'Renewals' },
  { path: '/admin/exports/revenue.csv', fileName: 'revenue.csv', label: 'Revenue', revenueOnly: true },
  { path: '/admin/exports/notifications.csv', fileName: 'notifications.csv', label: 'Notifications' },
  { path: '/admin/exports/audit.csv', fileName: 'audit.csv', label: 'Audit log' },
];

function healthLabel(ok: boolean): string {
  return ok ? 'HEALTHY' : 'DEGRADED';
}

export function SystemStatusPage(): JSX.Element {
  const { accessToken, admin } = useAuth();
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const showRevenue = canViewRevenue(admin?.role);

  const load = useCallback(async () => {
    if (!accessToken || !canViewSystemStatus(admin?.role)) {
      return;
    }

    const response = await apiRequest<SystemStatus>('/admin/system/status', {}, accessToken);
    setStatus(response);
    setError(null);
  }, [accessToken, admin?.role]);

  useEffect(() => {
    if (!accessToken) {
      return;
    }

    setIsLoading(true);
    void load()
      .catch((loadError) => {
        setStatus(null);
        setError(loadError instanceof Error ? loadError.message : 'Failed to load system status');
      })
      .finally(() => setIsLoading(false));
  }, [accessToken, load]);

  async function refresh(): Promise<void> {
    setIsRefreshing(true);
    try {
      await load();
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : 'Failed to refresh system status');
    } finally {
      setIsRefreshing(false);
    }
  }

  async function downloadExport(path: string, fileName: string): Promise<void> {
    if (!accessToken) {
      return;
    }
    setExportError(null);
    setDownloading(fileName);
    try {
      await downloadAuthenticatedFile(path, fileName, accessToken);
    } catch (downloadError) {
      setExportError(downloadError instanceof Error ? downloadError.message : 'Export download failed');
    } finally {
      setDownloading(null);
    }
  }

  if (!canViewSystemStatus(admin?.role)) {
    return (
      <div className="page-stack">
        <PageHeader title="System status" subtitle="Restricted to administrators." />
        <ErrorBanner message="Your role cannot view system status." />
      </div>
    );
  }

  return (
    <div className="page-stack">
      <PageHeader
        title="System status"
        subtitle="Queue, SMTP, Redis, database, cache, and platform version for production monitoring."
        actions={
          <button type="button" className="secondary-button" disabled={isRefreshing || isLoading} onClick={() => void refresh()}>
            {isRefreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        }
      />

      <InfoBanner
        title="No secrets on this page"
        message="SMTP passwords, JWT secrets, TG1 licence keys, and encryption keys are never returned by the system status API."
      />

      {error ? <ErrorBanner message={error} /> : null}
      {isLoading ? <LoadingState label="Loading system status…" /> : null}

      {!isLoading && status ? (
        <>
          <Card>
            <h3>Platform</h3>
            <div className="detail-grid">
              <div className="detail-item"><span>API version</span><strong>{status.versions?.apiVersion ?? status.version}</strong></div>
              <div className="detail-item"><span>Admin portal</span><strong>{status.versions?.portalVersion ?? '—'}</strong></div>
              <div className="detail-item"><span>Customer portal</span><strong>{status.versions?.customerPortalVersion ?? '—'}</strong></div>
              <div className="detail-item"><span>Desktop</span><strong>{status.versions?.desktopVersion ?? '—'}</strong></div>
              <div className="detail-item"><span>DB migration</span><strong>{status.versions?.databaseMigrationVersion ?? status.database.migrationVersion ?? '—'}</strong></div>
              <div className="detail-item"><span>Git commit</span><strong>{status.versions?.gitCommit ?? '—'}</strong></div>
              <div className="detail-item"><span>Build</span><strong>{status.buildNumber}</strong></div>
              <div className="detail-item"><span>Build time</span><strong>{status.versions?.buildTimestamp ?? '—'}</strong></div>
              <div className="detail-item"><span>Environment</span><strong>{status.environment}</strong></div>
              <div className="detail-item"><span>Health</span><strong><StatusBadge value={(status.health ?? 'unknown').toUpperCase()} /></strong></div>
              <div className="detail-item"><span>Uptime</span><strong>{formatUptime(status.uptimeSeconds)}</strong></div>
              <div className="detail-item"><span>Error reporting</span><strong>{status.errorReporting?.provider ?? 'console'}</strong></div>
            </div>
          </Card>

          <Card>
            <h3>Infrastructure health</h3>
            <div className="detail-grid">
              <div className="detail-item">
                <span>Database</span>
                <strong><StatusBadge value={healthLabel(status.database.ok)} /></strong>
              </div>
              <div className="detail-item">
                <span>Redis</span>
                <strong>
                  <StatusBadge
                    value={
                      !status.redis.configured
                        ? 'OPTIONAL'
                        : status.redis.connected
                          ? 'CONNECTED'
                          : 'DOWN'
                    }
                  />
                </strong>
              </div>
              <div className="detail-item">
                <span>SMTP</span>
                <strong><StatusBadge value={status.smtp.configured ? 'CONFIGURED' : 'MISSING'} /></strong>
              </div>
              <div className="detail-item">
                <span>Queue mode</span>
                <strong>{status.queue.mode}</strong>
              </div>
              <div className="detail-item">
                <span>Workers</span>
                <strong>{status.queue.workers ?? '—'}</strong>
              </div>
              <div className="detail-item">
                <span>SMTP host</span>
                <strong>{status.smtp.host ?? '—'}</strong>
              </div>
              <div className="detail-item">
                <span>From email</span>
                <strong>{status.smtp.fromEmail ?? '—'}</strong>
              </div>
              <div className="detail-item">
                <span>Dashboard cache buckets</span>
                <strong>{status.cache.dashboardCachedRoles}</strong>
              </div>
              <div className="detail-item">
                <span>Stripe</span>
                <strong>
                  <StatusBadge
                    value={
                      !status.stripe?.enabled
                        ? 'DISABLED'
                        : status.stripe.configured
                          ? status.stripe.mode
                          : 'DEGRADED'
                    }
                  />
                </strong>
              </div>
              <div className="detail-item">
                <span>Stripe failed webhooks</span>
                <strong>{status.stripe?.failedWebhooks ?? 0}</strong>
              </div>
              <div className="detail-item">
                <span>Stripe dead-letter</span>
                <strong>{status.stripe?.deadLetterWebhooks ?? 0}</strong>
              </div>
              <div className="detail-item">
                <span>Stripe alerts</span>
                <strong>{status.stripe?.openReconciliationAlerts ?? 0}</strong>
              </div>
            </div>
            {status.queue.mode === 'inline' ? (
              <InfoBanner
                title="Inline queue mode"
                message="REDIS_URL is not set. Email jobs run in-process (fine for local/dev). Set REDIS_URL for durable cross-instance retries in production."
              />
            ) : null}
          </Card>

          {status.runtime ? (
            <Card>
              <h3>Runtime resources</h3>
              <div className="detail-grid">
                <div className="detail-item"><span>Node</span><strong>{status.runtime.nodeVersion}</strong></div>
                <div className="detail-item"><span>PID</span><strong>{status.runtime.pid}</strong></div>
                <div className="detail-item"><span>Heap used</span><strong>{formatBytes(status.runtime.memory.heapUsedBytes)}</strong></div>
                <div className="detail-item"><span>RSS</span><strong>{formatBytes(status.runtime.memory.rssBytes)}</strong></div>
                <div className="detail-item"><span>System free</span><strong>{formatBytes(status.runtime.memory.systemFreeBytes)}</strong></div>
                <div className="detail-item"><span>CPU cores</span><strong>{status.runtime.cpu.cores}</strong></div>
                <div className="detail-item"><span>Load avg</span><strong>{status.runtime.cpu.loadAverage.map((n) => n.toFixed(2)).join(' / ') || '—'}</strong></div>
                <div className="detail-item">
                  <span>Disk free</span>
                  <strong>
                    {status.runtime.disk.available && status.runtime.disk.freeBytes != null
                      ? formatBytes(status.runtime.disk.freeBytes)
                      : 'n/a'}
                  </strong>
                </div>
              </div>
            </Card>
          ) : null}

          <Card>
            <h3>Background queues</h3>
            <div className="detail-grid">
              <div className="detail-item"><span>Pending emails</span><strong>{status.queue.pendingEmails}</strong></div>
              <div className="detail-item"><span>Failed emails</span><strong>{status.queue.failedEmails}</strong></div>
              <div className="detail-item"><span>Pending jobs</span><strong>{status.queue.pendingJobs ?? '—'}</strong></div>
              <div className="detail-item"><span>Failed jobs</span><strong>{status.queue.failedJobs ?? '—'}</strong></div>
            </div>
            <div className="table-wrap" style={{ marginTop: '1rem' }}>
              <table>
                <thead>
                  <tr>
                    <th>Queue</th>
                    <th>Waiting</th>
                    <th>Active</th>
                    <th>Delayed</th>
                    <th>Failed</th>
                    <th>Mode</th>
                  </tr>
                </thead>
                <tbody>
                  {status.queue.queues.map((queue) => (
                    <tr key={queue.name}>
                      <td>{queue.name}</td>
                      <td>{queue.waiting}</td>
                      <td>{queue.active}</td>
                      <td>{queue.delayed}</td>
                      <td>{queue.failed}</td>
                      <td>{queue.mode}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card>
            <h3>CSV exports</h3>
            <p className="muted">Download operational datasets. Filters can be added later via query params on the export API.</p>
            {exportError ? <ErrorBanner message={exportError} /> : null}
            <div className="button-row" style={{ flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.75rem' }}>
              {EXPORTS.filter((item) => !item.revenueOnly || showRevenue).map((item) => (
                <button
                  key={item.path}
                  type="button"
                  className="secondary-button"
                  disabled={downloading === item.fileName}
                  onClick={() => void downloadExport(item.path, item.fileName)}
                >
                  {downloading === item.fileName ? `Downloading ${item.label}…` : `Export ${item.label}`}
                </button>
              ))}
            </div>
          </Card>
        </>
      ) : null}
    </div>
  );
}

function formatUptime(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = -1;
  do {
    value /= 1024;
    unit += 1;
  } while (value >= 1024 && unit < units.length - 1);
  return `${value.toFixed(1)} ${units[unit]}`;
}
