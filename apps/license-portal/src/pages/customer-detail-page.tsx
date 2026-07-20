import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiRequest } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatUkDate, formatUkDateTime } from '../lib/dates';
import {
  Card,
  DataTable,
  ErrorBanner,
  LoadingState,
  PageHeader,
  StatusBadge,
  TabList,
} from '../components/ui';
import type {
  AuditLogEntry,
  CustomerDetail,
  Installation,
  LicenceSummary,
  PaginatedResponse,
  PaymentRecord,
} from '../types';

const tabs = [
  { id: 'overview', label: 'Overview' },
  { id: 'licences', label: 'Licences' },
  { id: 'installations', label: 'Installations' },
  { id: 'payments', label: 'Payments' },
  { id: 'notes', label: 'Notes' },
  { id: 'audit', label: 'Audit' },
];

export function CustomerDetailPage(): JSX.Element {
  const { id = '' } = useParams();
  const { accessToken } = useAuth();
  const [activeTab, setActiveTab] = useState('overview');
  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [licences, setLicences] = useState<LicenceSummary[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!accessToken || !id) {
      return;
    }

    setIsLoading(true);
    void Promise.all([
      apiRequest<CustomerDetail>(`/admin/customers/${id}`, {}, accessToken),
      apiRequest<PaginatedResponse<LicenceSummary>>(`/admin/customers/${id}/licences`, {}, accessToken),
      apiRequest<PaginatedResponse<PaymentRecord>>(`/admin/customers/${id}/payments`, {}, accessToken),
      apiRequest<PaginatedResponse<AuditLogEntry>>(`/admin/customers/${id}/audit`, {}, accessToken),
    ])
      .then(([customerResponse, licenceResponse, paymentResponse, auditResponse]) => {
        setCustomer(customerResponse);
        setLicences(licenceResponse.items);
        setPayments(paymentResponse.items);
        setAuditLogs(auditResponse.items);
      })
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : 'Failed to load customer');
      })
      .finally(() => setIsLoading(false));
  }, [accessToken, id]);

  const installations = useMemo(() => {
    const rows: Installation[] = [];
    for (const licence of licences) {
      if (licence.installationCount && licence.installationCount > 0) {
        rows.push({
          id: `${licence.id}-summary`,
          licenceId: licence.id,
          installationId: `${licence.installationCount} registered`,
          status: 'ACTIVE',
          licenseId: licence.licenseId,
          companyName: customer?.companyName,
          createdAt: licence.updatedAt,
          updatedAt: licence.updatedAt,
        });
      }
    }

    return rows;
  }, [customer?.companyName, licences]);

  if (isLoading) {
    return <LoadingState label="Loading customer…" />;
  }

  if (error || !customer) {
    return <ErrorBanner message={error ?? 'Customer not found.'} />;
  }

  return (
    <div className="page-stack">
      <PageHeader
        title={customer.companyName}
        subtitle={customer.email}
        actions={<StatusBadge value={customer.status} />}
      />

      <TabList tabs={tabs} active={activeTab} onChange={setActiveTab} />

      {activeTab === 'overview' ? (
        <Card>
          <div className="detail-grid">
            <div className="detail-item"><span>Trading name</span><strong>{customer.tradingName ?? '—'}</strong></div>
            <div className="detail-item"><span>Contact</span><strong>{customer.contactName ?? '—'}</strong></div>
            <div className="detail-item"><span>Phone</span><strong>{customer.phone ?? '—'}</strong></div>
            <div className="detail-item"><span>Country</span><strong>{customer.country}</strong></div>
            <div className="detail-item"><span>Address</span><strong>{[customer.addressLine1, customer.city, customer.postcode].filter(Boolean).join(', ') || '—'}</strong></div>
            <div className="detail-item"><span>Created</span><strong>{formatUkDate(customer.createdAt)}</strong></div>
            <div className="detail-item"><span>Updated</span><strong>{formatUkDate(customer.updatedAt)}</strong></div>
          </div>
        </Card>
      ) : null}

      {activeTab === 'licences' ? (
        <Card>
          <DataTable
            caption="Customer licences"
            columns={[
              { key: 'licenseId', label: 'Licence ID' },
              { key: 'plan', label: 'Plan' },
              { key: 'portalStatus', label: 'Portal status' },
              { key: 'effective', label: 'Effective status' },
              { key: 'expires', label: 'Expires' },
            ]}
            rows={licences.map((licence) => ({
              id: licence.id,
              cells: {
                licenseId: <Link to={`/licences/${licence.id}`} className="text-link">{licence.licenseId}</Link>,
                plan: licence.plan,
                portalStatus: <StatusBadge value={licence.status} />,
                effective: <StatusBadge value={licence.effectiveStatus} />,
                expires: formatUkDate(licence.expiresAt),
              },
            }))}
            emptyMessage="No licences for this customer."
          />
        </Card>
      ) : null}

      {activeTab === 'installations' ? (
        <Card>
          <DataTable
            caption="Customer installations"
            columns={[
              { key: 'licenseId', label: 'Licence ID' },
              { key: 'installationId', label: 'Installation ID' },
              { key: 'status', label: 'Status' },
              { key: 'updated', label: 'Updated' },
            ]}
            rows={installations.map((installation) => ({
              id: installation.id,
              cells: {
                licenseId: installation.licenseId ?? '—',
                installationId: installation.installationId,
                status: <StatusBadge value={installation.status} />,
                updated: formatUkDate(installation.updatedAt),
              },
            }))}
            emptyMessage="No installations recorded."
          />
        </Card>
      ) : null}

      {activeTab === 'payments' ? (
        <Card>
          <DataTable
            caption="Customer payments"
            columns={[
              { key: 'reference', label: 'Reference' },
              { key: 'amount', label: 'Amount' },
              { key: 'status', label: 'Status' },
              { key: 'paidAt', label: 'Paid at' },
            ]}
            rows={payments.map((payment) => ({
              id: payment.id,
              cells: {
                reference: payment.paymentReference ?? payment.invoiceReference ?? payment.id.slice(0, 8),
                amount: `${(payment.amountPence / 100).toFixed(2)} ${payment.currency}`,
                status: <StatusBadge value={payment.paymentStatus} />,
                paidAt: formatUkDateTime(payment.paidAt),
              },
            }))}
            emptyMessage="No payment records."
          />
        </Card>
      ) : null}

      {activeTab === 'notes' ? (
        <Card>
          <h3>Internal notes</h3>
          <p>{customer.notes?.trim() || 'No notes recorded for this customer.'}</p>
        </Card>
      ) : null}

      {activeTab === 'audit' ? (
        <Card>
          <DataTable
            caption="Customer audit trail"
            columns={[
              { key: 'action', label: 'Action' },
              { key: 'actor', label: 'Actor' },
              { key: 'when', label: 'When' },
            ]}
            rows={auditLogs.map((entry) => ({
              id: entry.id,
              cells: {
                action: entry.action.replace(/_/g, ' '),
                actor: entry.actorDisplayName ?? 'System',
                when: formatUkDateTime(entry.createdAt),
              },
            }))}
            emptyMessage="No audit entries."
          />
        </Card>
      ) : null}
    </div>
  );
}
