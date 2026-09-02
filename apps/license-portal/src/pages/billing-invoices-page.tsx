import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatMoney, formatUkDate } from '../lib/dates';
import {
  Card,
  DataTable,
  ErrorBanner,
  LoadingState,
  PageHeader,
  StatusBadge,
} from '../components/ui';
import type { BillingInvoice, PaginatedResponse } from '../types';

export function BillingInvoicesPage(): JSX.Element {
  const { accessToken } = useAuth();
  const [invoices, setInvoices] = useState<BillingInvoice[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!accessToken) {
      return;
    }

    void apiRequest<PaginatedResponse<BillingInvoice>>(
      '/admin/billing/invoices?page=1&pageSize=100',
      {},
      accessToken,
    )
      .then((response) => setInvoices(response.items ?? []))
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : 'Failed to load invoices');
      })
      .finally(() => setIsLoading(false));
  }, [accessToken]);

  return (
    <div className="page-stack">
      <PageHeader title="Invoices" subtitle="Subscription invoices and payment status." />

      {error ? <ErrorBanner message={error} /> : null}
      {isLoading ? <LoadingState label="Loading invoices…" /> : (
        <Card>
          <DataTable
            caption="Billing invoices"
            columns={[
              { key: 'number', label: 'Number' },
              { key: 'organisation', label: 'Organisation' },
              { key: 'plan', label: 'Plan' },
              { key: 'status', label: 'Status' },
              { key: 'total', label: 'Total', align: 'right' },
              { key: 'issued', label: 'Issued' },
              { key: 'due', label: 'Due' },
              { key: 'paid', label: 'Paid' },
            ]}
            rows={invoices.map((invoice) => ({
              id: invoice.id,
              cells: {
                number: invoice.number,
                organisation: (
                  <Link to={`/customers/${invoice.organisationId}`} className="text-link">
                    {invoice.organisationName}
                  </Link>
                ),
                plan: invoice.planCode,
                status: <StatusBadge value={invoice.status} />,
                total: formatMoney(invoice.total, invoice.currency),
                issued: formatUkDate(invoice.issuedAt),
                due: formatUkDate(invoice.dueAt),
                paid: formatUkDate(invoice.paidAt),
              },
            }))}
            emptyMessage="No invoices found."
          />
        </Card>
      )}
    </div>
  );
}
