import { useEffect, useState } from 'react';
import { apiRequest } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatMoney } from '../lib/dates';
import {
  Card,
  DataTable,
  ErrorBanner,
  LoadingState,
  PageHeader,
  StatusBadge,
} from '../components/ui';
import type { BillingPlan } from '../types';

export function BillingPlansPage(): JSX.Element {
  const { accessToken } = useAuth();
  const [plans, setPlans] = useState<BillingPlan[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!accessToken) {
      return;
    }

    void apiRequest<{ items: BillingPlan[] }>('/admin/billing/plans', {}, accessToken)
      .then((response) => setPlans(response.items ?? []))
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : 'Failed to load plans');
      })
      .finally(() => setIsLoading(false));
  }, [accessToken]);

  return (
    <div className="page-stack">
      <PageHeader
        title="Billing plans"
        subtitle="Subscription plans, pricing, and entitlements."
      />

      {error ? <ErrorBanner message={error} /> : null}
      {isLoading ? <LoadingState label="Loading plans…" /> : (
        <Card>
          <DataTable
            caption="Billing plans"
            columns={[
              { key: 'code', label: 'Code' },
              { key: 'name', label: 'Name' },
              { key: 'status', label: 'Status' },
              { key: 'monthly', label: 'Monthly', align: 'right' },
              { key: 'annual', label: 'Annual', align: 'right' },
              { key: 'devices', label: 'Devices', align: 'right' },
              { key: 'public', label: 'Public' },
            ]}
            rows={plans.map((plan) => ({
              id: plan.id,
              cells: {
                code: plan.code,
                name: plan.name,
                status: <StatusBadge value={plan.status} />,
                monthly: formatMoney(plan.monthlyPrice, plan.currency),
                annual: formatMoney(plan.annualPrice, plan.currency),
                devices: String(plan.maxDevices),
                public: plan.isPublic ? 'Yes' : 'No',
              },
            }))}
            emptyMessage="No billing plans configured."
          />
        </Card>
      )}
    </div>
  );
}
