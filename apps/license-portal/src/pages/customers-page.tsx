import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, apiRequest } from '../lib/api';
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
import type { CreateCustomerRequest, CustomerSummary, PaginatedResponse } from '../types';

function formatApiError(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    return error.code && !error.message.startsWith(`${error.code}:`)
      ? `${error.code}: ${error.message}`
      : error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return fallback;
}

export function CustomersPage(): JSX.Element {
  const { accessToken } = useAuth();
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [companyName, setCompanyName] = useState('');
  const [email, setEmail] = useState('');
  const [contactName, setContactName] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!accessToken) {
      return;
    }

    setIsLoading(true);
    setError(null);
    const params = new URLSearchParams({ page: '1', pageSize: '50' });
    if (query.trim()) {
      params.set('search', query.trim());
    }

    void apiRequest<PaginatedResponse<CustomerSummary>>(`/admin/customers?${params.toString()}`, {}, accessToken)
      .then((response) => setCustomers(response.items ?? []))
      .catch((loadError) => {
        setError(formatApiError(loadError, 'Failed to load customers'));
      })
      .finally(() => setIsLoading(false));
  }, [accessToken, query, reloadKey]);

  function handleSearch(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setQuery(search);
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!accessToken) {
      return;
    }

    setIsCreating(true);
    setCreateError(null);
    setCreateSuccess(null);

    const body: CreateCustomerRequest = {
      companyName: companyName.trim(),
      email: email.trim(),
      contactName: contactName.trim() || undefined,
    };

    try {
      const created = await apiRequest<CustomerSummary>('/admin/customers', {
        method: 'POST',
        body: JSON.stringify(body),
      }, accessToken);
      setCompanyName('');
      setEmail('');
      setContactName('');
      setCreateSuccess(`Created ${created.companyName}.`);
      setReloadKey((value) => value + 1);
    } catch (submissionError) {
      setCreateError(formatApiError(submissionError, 'Failed to create customer'));
    } finally {
      setIsCreating(false);
    }
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

      <Card>
        <h3>Create customer</h3>
        <form className="two-column-grid" onSubmit={(event) => void handleCreate(event)}>
          <Field label="Company name">
            <input value={companyName} onChange={(event) => setCompanyName(event.target.value)} required minLength={2} />
          </Field>
          <Field label="Billing email">
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
          </Field>
          <Field label="Contact name">
            <input value={contactName} onChange={(event) => setContactName(event.target.value)} />
          </Field>
          <div className="field">
            <span>&nbsp;</span>
            <button type="submit" className="primary-button" disabled={isCreating}>
              {isCreating ? 'Creating…' : 'Create customer'}
            </button>
          </div>
        </form>
        {createError ? <ErrorBanner message={createError} /> : null}
        {createSuccess ? <p className="success-text">{createSuccess}</p> : null}
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
