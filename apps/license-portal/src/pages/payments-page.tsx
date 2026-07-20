import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatMoney, formatUkDateTime } from '../lib/dates';
import {
  Card,
  DataTable,
  ErrorBanner,
  LoadingState,
  PageHeader,
  StatusBadge,
} from '../components/ui';
import type { PaginatedResponse, PaymentRecord } from '../types';

export function PaymentsPage(): JSX.Element {
  const { accessToken } = useAuth();
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!accessToken) {
      return;
    }

    void apiRequest<PaginatedResponse<PaymentRecord>>('/admin/payments?page=1&pageSize=100', {}, accessToken)
      .then((response) => setPayments(response.items))
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : 'Failed to load payments');
      })
      .finally(() => setIsLoading(false));
  }, [accessToken]);

  return (
    <div className="page-stack">
      <PageHeader title="Payments" subtitle="Recorded customer payments linked to licences where applicable." />

      {error ? <ErrorBanner message={error} /> : null}
      {isLoading ? <LoadingState label="Loading payments…" /> : (
        <Card>
          <DataTable
            caption="Payment records"
            columns={[
              { key: 'customer', label: 'Customer' },
              { key: 'licence', label: 'Licence ID' },
              { key: 'amount', label: 'Amount', align: 'right' },
              { key: 'status', label: 'Status' },
              { key: 'reference', label: 'Reference' },
              { key: 'paidAt', label: 'Paid at' },
            ]}
            rows={payments.map((payment) => ({
              id: payment.id,
              cells: {
                customer: payment.customerName ? (
                  <Link to={`/customers/${payment.customerId}`} className="text-link">{payment.customerName}</Link>
                ) : payment.customerId,
                licence: payment.licenseId ?? '—',
                amount: formatMoney(payment.amountPence, payment.currency),
                status: <StatusBadge value={payment.paymentStatus} />,
                reference: payment.paymentReference ?? payment.invoiceReference ?? '—',
                paidAt: formatUkDateTime(payment.paidAt),
              },
            }))}
          />
        </Card>
      )}
    </div>
  );
}
