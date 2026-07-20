import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatUkDate } from '../lib/dates';
import {
  Card,
  DataTable,
  ErrorBanner,
  Field,
  LoadingState,
  PageHeader,
  StatusBadge,
} from '../components/ui';
import type { CustomerSummary, PaginatedResponse } from '../types';

export function CustomersPage(): JSX.Element {
  const { accessToken } = useAuth();
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!accessToken) {
      return;
    }

    setIsLoading(true);
    const params = new URLSearchParams({ page: '1', pageSize: '50' });
    if (query.trim()) {
      params.set('search', query.trim());
    }

    void apiRequest<PaginatedResponse<CustomerSummary>>(`/admin/customers?${params.toString()}`, {}, accessToken)
      .then((response) => setCustomers(response.items))
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : 'Failed to load customers');
      })
      .finally(() => setIsLoading(false));
  }, [accessToken, query]);

  function handleSearch(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setQuery(search);
  }

  return (
    <div className="page-stack">
      <PageHeader
        title="Customers"
        subtitle="Search by company, contact, email, licence ID, installation ID, or payment reference."
      />

      <Card>
        <form className="search-row" onSubmit={handleSearch}>
          <Field label="Search">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Company, email, licence ID…"
            />
          </Field>
          <button type="submit" className="secondary-button">Search</button>
        </form>
      </Card>

      {error ? <ErrorBanner message={error} /> : null}
      {isLoading ? <LoadingState label="Loading customers…" /> : (
        <Card>
          <DataTable
            caption="Customers"
            columns={[
              { key: 'company', label: 'Company' },
              { key: 'contact', label: 'Contact' },
              { key: 'status', label: 'Status' },
              { key: 'plan', label: 'Current plan' },
              { key: 'expiry', label: 'Licence expiry' },
              { key: 'payment', label: 'Payment status' },
              { key: 'installations', label: 'Installations', align: 'right' },
              { key: 'updated', label: 'Last updated' },
            ]}
            rows={customers.map((customer) => ({
              id: customer.id,
              cells: {
                company: <Link to={`/customers/${customer.id}`} className="text-link">{customer.companyName}</Link>,
                contact: customer.contactName ?? customer.email,
                status: <StatusBadge value={customer.status} />,
                plan: customer.currentPlan ?? '—',
                expiry: formatUkDate(customer.licenceExpiry),
                payment: customer.paymentStatus ? <StatusBadge value={customer.paymentStatus} /> : '—',
                installations: customer.installationCount ?? 0,
                updated: formatUkDate(customer.updatedAt),
              },
            }))}
          />
        </Card>
      )}
    </div>
  );
}
