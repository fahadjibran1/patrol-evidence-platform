import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest } from '../lib/api';
import { useAuth } from '../lib/auth';
import { canManageBilling } from '../lib/roles';
import { formatMoney, formatUkDateTime } from '../lib/dates';
import {
  Card,
  DataTable,
  ErrorBanner,
  LoadingState,
  PageHeader,
  StatusBadge,
} from '../components/ui';
import type { BillingPayment, PaginatedResponse } from '../types';

export function BillingPaymentsPage(): JSX.Element {
  const { accessToken, admin } = useAuth();
  const canRecord = canManageBilling(admin?.role);
  const [payments, setPayments] = useState<BillingPayment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!accessToken) {
      return;
    }

    void apiRequest<PaginatedResponse<BillingPayment>>(
      '/admin/billing/payments?page=1&pageSize=100',
      {},
      accessToken,
    )
      .then((response) => setPayments(response.items ?? []))
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : 'Failed to load billing payments');
      })
      .finally(() => setIsLoading(false));
  }, [accessToken]);

  return (
    <div className="page-stack">
      <PageHeader
        title="Billing payments"
        subtitle="Payments recorded against subscription invoices."
        actions={
          canRecord ? (
            <Link to="/billing/manual-payment" className="primary-button">
              Record manual payment
            </Link>
          ) : undefined
        }
      />

      {error ? <ErrorBanner message={error} /> : null}
      {isLoading ? <LoadingState label="Loading billing payments…" /> : (
        <Card>
          <DataTable
            caption="Billing payments"
            columns={[
              { key: 'invoice', label: 'Invoice' },
              { key: 'organisation', label: 'Organisation' },
              { key: 'amount', label: 'Amount', align: 'right' },
              { key: 'status', label: 'Status' },
              { key: 'method', label: 'Method' },
              { key: 'reference', label: 'Reference' },
              { key: 'received', label: 'Received' },
            ]}
            rows={payments.map((payment) => ({
              id: payment.id,
              cells: {
                invoice: payment.invoiceNumber ?? payment.invoiceId,
                organisation: payment.organisationId && payment.organisationName ? (
                  <Link to={`/customers/${payment.organisationId}`} className="text-link">
                    {payment.organisationName}
                  </Link>
                ) : payment.organisationName ?? '—',
                amount: formatMoney(payment.amount, payment.currency),
                status: <StatusBadge value={payment.status} />,
                method: payment.manualMethod?.replace(/_/g, ' ') ?? payment.provider,
                reference: payment.providerReference ?? '—',
                received: formatUkDateTime(payment.receivedAt ?? payment.createdAt),
              },
            }))}
            emptyMessage="No billing payments recorded."
          />
        </Card>
      )}
    </div>
  );
}
