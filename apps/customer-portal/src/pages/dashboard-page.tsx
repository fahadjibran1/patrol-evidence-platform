import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  Card,
  DashboardSkeleton,
  ErrorBanner,
  MetricCard,
  PageHeader,
  StatusBadge,
} from '../components/ui';
import type { CustomerDashboard } from '../types';

export function DashboardPage(): JSX.Element {
  const { accessToken } = useAuth();
  const [stats, setStats] = useState<CustomerDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!accessToken) {
      return;
    }
    setIsLoading(true);
    void apiRequest<CustomerDashboard>('/customer/dashboard', {}, accessToken)
      .then((response) => {
        setStats(response);
        setError(null);
      })
      .catch((loadError) => {
        setStats(null);
        setError(loadError instanceof Error ? loadError.message : 'Failed to load dashboard');
      })
      .finally(() => setIsLoading(false));
  }, [accessToken]);

  return (
    <div className="page-stack">
      <PageHeader
        title="Dashboard"
        subtitle="Company licence status, renewals, and recent activity."
        actions={
          <Link className="secondary-button" to="/licences">
            View licences
          </Link>
        }
      />
      {error ? <ErrorBanner message={error} /> : null}
      {isLoading ? <DashboardSkeleton /> : null}
      {!isLoading && stats ? (
        <>
          <div className="metric-grid">
            <MetricCard label="Company" value={stats.company.companyName} />
            <MetricCard
              label="Status"
              value={stats.status ?? '—'}
              tone={stats.status === 'ACTIVE' ? 'success' : 'warning'}
            />
            <MetricCard label="Plan" value={stats.plan ?? '—'} />
            <MetricCard label="Expiry" value={stats.expiry ?? '—'} />
            <MetricCard label="Devices" value={stats.deviceAllowance ?? '—'} />
            <MetricCard
              label="Renewal countdown"
              value={
                stats.renewalCountdownDays === null
                  ? '—'
                  : stats.renewalCountdownDays < 0
                    ? 'Expired'
                    : `${stats.renewalCountdownDays} days`
              }
              tone={
                stats.renewalCountdownDays !== null && stats.renewalCountdownDays <= 14
                  ? 'warning'
                  : 'default'
              }
            />
          </div>

          <div className="split-grid">
            <Card>
              <h3>Current licence</h3>
              {stats.currentLicence ? (
                <div className="detail-grid">
                  <div className="detail-item"><span>Licence ID</span><strong>{stats.currentLicence.licenseId}</strong></div>
                  <div className="detail-item"><span>Status</span><strong><StatusBadge value={stats.currentLicence.effectiveStatus} /></strong></div>
                  <div className="detail-item"><span>Version</span><strong>{stats.currentLicence.currentVersionNumber ?? '—'}</strong></div>
                </div>
              ) : (
                <p className="muted">No licences issued for this company yet.</p>
              )}
            </Card>
            <Card>
              <h3>Latest activity</h3>
              <div className="detail-grid">
                <div className="detail-item">
                  <span>Latest download</span>
                  <strong>
                    {stats.latestDownload
                      ? `${stats.latestDownload.licenseId} · ${new Date(stats.latestDownload.downloadedAt).toLocaleString()}`
                      : 'None yet'}
                  </strong>
                </div>
                <div className="detail-item">
                  <span>Latest notification</span>
                  <strong>
                    {stats.latestNotification
                      ? `${stats.latestNotification.subject} · ${stats.latestNotification.status}`
                      : 'None yet'}
                  </strong>
                </div>
              </div>
            </Card>
          </div>
        </>
      ) : null}
    </div>
  );
}
