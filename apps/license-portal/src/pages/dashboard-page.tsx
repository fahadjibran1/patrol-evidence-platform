import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatMoney, formatUkDate, formatUkDateTime } from '../lib/dates';
import { canIssueLicences, canPerformLifecycleActions, canViewRevenue } from '../lib/roles';
import {
  Card,
  DashboardSkeleton,
  DataTable,
  ErrorBanner,
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
  const showRevenue = canViewRevenue(admin?.role);

  useEffect(() => {
    if (!accessToken) {
      return;
    }

    setIsLoading(true);
    void apiRequest<DashboardStats>('/admin/dashboard', {}, accessToken)
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

  if (isLoading) {
    return (
      <div className="page-stack">
        <PageHeader
          title="Dashboard"
          subtitle="Operational overview of customers, licences, notifications, and renewals."
        />
        <DashboardSkeleton />
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-stack">
        <PageHeader title="Dashboard" subtitle="Operational overview of customers, licences, notifications, and renewals." />
        <ErrorBanner message={error} />
      </div>
    );
  }

  if (!stats?.kpis) {
    return (
      <div className="page-stack">
        <PageHeader title="Dashboard" subtitle="Operational overview of customers, licences, notifications, and renewals." />
        <ErrorBanner message="Dashboard data unavailable." />
      </div>
    );
  }

  const { kpis, renewalQueue, recentActivity, notificationHealth, revenue, billing } = stats;

  return (
    <div className="page-stack">
      <PageHeader
        title="Dashboard"
        subtitle="Operational overview of customers, licences, notifications, and renewals."
        actions={
          canIssueLicences(admin?.role) ? (
            <Link to="/licences/issue" className="primary-button">
              Issue licence
            </Link>
          ) : undefined
        }
      />

      <div className="metrics-grid">
        <MetricCard label="Active customers" value={kpis.activeCustomers} tone="success" />
        <MetricCard label="Active licences" value={kpis.activeLicences} tone="success" />
        <MetricCard label="Trial licences" value={kpis.trialLicences} />
        <MetricCard label="Monthly licences" value={kpis.monthlyLicences} />
        <MetricCard label="Annual licences" value={kpis.annualLicences} />
        <MetricCard label="Expired licences" value={kpis.expiredLicences} tone="danger" />
        <MetricCard label="Expiring in 7 days" value={kpis.expiringIn7Days} tone="warning" />
        <MetricCard label="Expiring in 30 days" value={kpis.expiringIn30Days} tone="warning" />
        <MetricCard label="Emails sent today" value={kpis.emailsSentToday} />
        <MetricCard
          label="Failed emails today"
          value={kpis.failedEmailsToday}
          tone={kpis.failedEmailsToday > 0 ? 'danger' : 'default'}
        />
        <MetricCard label="Suspended" value={kpis.suspendedLicences ?? 0} tone={(kpis.suspendedLicences ?? 0) > 0 ? 'danger' : 'default'} />
        <MetricCard label="Revoked" value={kpis.revokedLicences ?? 0} tone={(kpis.revokedLicences ?? 0) > 0 ? 'danger' : 'default'} />
        <MetricCard label="Renewed this month" value={kpis.renewedThisMonth ?? 0} tone="success" />
      </div>

      {showRevenue && revenue ? (
        <div className="metrics-grid">
          <MetricCard
            label="Outstanding payments"
            value={`${revenue.outstandingPaymentsCount} · ${formatMoney(revenue.outstandingPaymentsAmountPence, revenue.currency)}`}
            tone="warning"
          />
          <MetricCard
            label="Paid today"
            value={`${revenue.paidTodayCount} · ${formatMoney(revenue.paidTodayAmountPence, revenue.currency)}`}
            tone="success"
          />
          <MetricCard
            label="Paid this month"
            value={`${revenue.paidThisMonthCount} · ${formatMoney(revenue.paidThisMonthAmountPence, revenue.currency)}`}
            tone="success"
          />
        </div>
      ) : null}

      {showRevenue && billing ? (
        <div className="metrics-grid">
          <MetricCard label="MRR" value={formatMoney(billing.mrrPence, billing.currency)} tone="success" />
          <MetricCard label="ARR" value={formatMoney(billing.arrPence, billing.currency)} tone="success" />
          <MetricCard label="Active subscriptions" value={billing.activeSubscriptions} tone="success" />
          <MetricCard label="Trial subscriptions" value={billing.trialSubscriptions} />
          <MetricCard
            label="Past due"
            value={billing.pastDueSubscriptions}
            tone={billing.pastDueSubscriptions > 0 ? 'danger' : 'default'}
          />
          <MetricCard label="Cancelled" value={billing.cancelledSubscriptions} />
          <MetricCard
            label="Revenue this month"
            value={formatMoney(billing.revenueThisMonthPence, billing.currency)}
            tone="success"
          />
          <MetricCard
            label="Revenue this year"
            value={formatMoney(billing.revenueThisYearPence, billing.currency)}
            tone="success"
          />
          <MetricCard
            label="Invoices due"
            value={billing.invoicesDue}
            tone={billing.invoicesDue > 0 ? 'warning' : 'default'}
          />
          <MetricCard
            label="Invoices overdue"
            value={billing.invoicesOverdue}
            tone={billing.invoicesOverdue > 0 ? 'danger' : 'default'}
          />
        </div>
      ) : null}

      <div className="two-column-grid">
        <Card>
          <h3>Renewal queue (next 30 days)</h3>
          <DataTable
            caption="Renewal queue"
            columns={[
              { key: 'licenseId', label: 'Licence ID' },
              { key: 'customer', label: 'Customer' },
              { key: 'plan', label: 'Plan' },
              { key: 'expires', label: 'Expires' },
              { key: 'days', label: 'Days left' },
              { key: 'status', label: 'Status' },
              { key: 'actions', label: 'Actions' },
            ]}
            rows={renewalQueue.map((licence) => {
              const canRenewThis = licence.canRenew ?? canPerformLifecycleActions(admin?.role);
              return {
                id: licence.id,
                cells: {
                  licenseId: (
                    <Link to={`/licences/${licence.id}`} className="text-link">
                      {licence.licenseId}
                    </Link>
                  ),
                  customer: (
                    <Link to={`/customers/${licence.customerId}`} className="text-link">
                      {licence.customerName}
                    </Link>
                  ),
                  plan: licence.plan,
                  expires: formatUkDate(licence.expiresAt),
                  days: String(licence.daysUntilExpiry),
                  status: <StatusBadge value={licence.effectiveStatus} />,
                  actions: canRenewThis ? (
                    <Link to={`/licences/${licence.id}/renew`} className="secondary-button">
                      Renew
                    </Link>
                  ) : (
                    '—'
                  ),
                },
              };
            })}
            emptyMessage="No licences due for renewal in the next 30 days."
          />
        </Card>

        <Card>
          <h3>Notification health</h3>
          <div className="metrics-grid" style={{ marginBottom: '1rem' }}>
            <MetricCard label="Sent today" value={notificationHealth.sentToday} tone="success" />
            <MetricCard
              label="Failed today"
              value={notificationHealth.failedToday}
              tone={notificationHealth.failedToday > 0 ? 'danger' : 'default'}
            />
            <MetricCard label="Pending today" value={notificationHealth.pendingToday} tone="warning" />
          </div>
          <DataTable
            caption="Recent notification failures"
            columns={[
              { key: 'when', label: 'When' },
              { key: 'type', label: 'Type' },
              { key: 'recipient', label: 'Recipient' },
              { key: 'error', label: 'Error' },
            ]}
            rows={notificationHealth.recentFailures.map((entry) => ({
              id: entry.id,
              cells: {
                when: formatUkDateTime(entry.createdAt),
                type: entry.notificationType,
                recipient: entry.recipient,
                error: entry.errorMessage ?? '—',
              },
            }))}
            emptyMessage="No recent notification failures."
          />
        </Card>
      </div>

      <Card>
        <h3>Recent activity</h3>
        <DataTable
          caption="Recent audit activity"
          columns={[
            { key: 'action', label: 'Action' },
            { key: 'entity', label: 'Entity' },
            { key: 'actor', label: 'Actor' },
            { key: 'when', label: 'When' },
          ]}
          rows={recentActivity.map((entry) => ({
            id: entry.id,
            cells: {
              action: entry.action.replace(/[._]/g, ' '),
              entity: entry.licenceId ?? entry.entityId ?? entry.entityType,
              actor: entry.actorDisplayName ?? 'System',
              when: formatUkDateTime(entry.createdAt),
            },
          }))}
          emptyMessage="No recent activity recorded."
        />
      </Card>
    </div>
  );
}
