import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatUkDate, formatUkDateTime } from '../lib/dates';
import { canIssueLicences } from '../lib/roles';
import {
  Card,
  DataTable,
  ErrorBanner,
  LoadingState,
  MetricCard,
  PageHeader,
  StatusBadge,
} from '../components/ui';
import type { DashboardStats } from '../types';

export function DashboardPage(): JSX.Element {
  const { accessToken, admin } = useAuth();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!accessToken) {
      return;
    }

    void apiRequest<DashboardStats>('/admin/dashboard', {}, accessToken)
      .then(setStats)
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : 'Failed to load dashboard');
      })
      .finally(() => setIsLoading(false));
  }, [accessToken]);

  if (isLoading) {
    return <LoadingState label="Loading dashboard…" />;
  }

  if (error) {
    return <ErrorBanner message={error} />;
  }

  if (!stats) {
    return <ErrorBanner message="Dashboard data unavailable." />;
  }

  return (
    <div className="page-stack">
      <PageHeader
        title="Dashboard"
        subtitle="Operational overview of licences, customers, and payments."
        actions={
          canIssueLicences(admin?.role) ? (
            <Link to="/licences/issue" className="primary-button">
              Issue licence
            </Link>
          ) : undefined
        }
      />

      <div className="metrics-grid">
        <MetricCard label="Active licences" value={stats.activeLicences} tone="success" />
        <MetricCard label="Trials" value={stats.trials} />
        <MetricCard label="Expiring in 7 days" value={stats.expiringIn7Days} tone="warning" />
        <MetricCard label="Expiring in 30 days" value={stats.expiringIn30Days} tone="warning" />
        <MetricCard label="Expired" value={stats.expiredLicences} tone="danger" />
        <MetricCard label="Suspended" value={stats.suspendedLicences} tone="danger" />
        <MetricCard label="Outstanding payments" value={stats.outstandingPayments} tone="warning" />
        <MetricCard label="Total customers" value={stats.totalCustomers} />
      </div>

      <div className="two-column-grid">
        <Card>
          <h3>Recent licence activity</h3>
          <DataTable
            caption="Recent licence activity"
            columns={[
              { key: 'action', label: 'Action' },
              { key: 'entity', label: 'Entity' },
              { key: 'when', label: 'When' },
            ]}
            rows={(stats.recentActivity ?? []).map((entry) => ({
              id: entry.id,
              cells: {
                action: entry.action.replace(/_/g, ' '),
                entity: entry.licenceId ?? entry.entityId ?? entry.entityType,
                when: formatUkDateTime(entry.createdAt),
              },
            }))}
            emptyMessage="No recent activity recorded."
          />
        </Card>

        <Card>
          <h3>Upcoming renewals</h3>
          <DataTable
            caption="Upcoming renewals"
            columns={[
              { key: 'licenseId', label: 'Licence ID' },
              { key: 'customer', label: 'Customer' },
              { key: 'expires', label: 'Expires' },
              { key: 'status', label: 'Status' },
            ]}
            rows={(stats.upcomingRenewals ?? []).map((licence) => ({
              id: licence.id,
              cells: {
                licenseId: <Link to={`/licences/${licence.id}`} className="text-link">{licence.licenseId}</Link>,
                customer: licence.customerName ?? '—',
                expires: formatUkDate(licence.expiresAt),
                status: <StatusBadge value={licence.effectiveStatus} />,
              },
            }))}
            emptyMessage="No upcoming renewals in the current window."
          />
        </Card>
      </div>
    </div>
  );
}
