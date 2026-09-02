import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest } from '../lib/api';
import { formatMoney } from '../lib/dates';
import { useAuth } from '../lib/auth';
import { Card, ErrorBanner, LoadingState, PageHeader, StatusBadge } from '../components/ui';

interface CompareResponse {
  currentPlanId: string | null;
  interval: string;
  plans: Array<{
    id: string;
    code: string;
    name: string;
    amount: number;
    currency: string;
    interval: string;
    maxDevices: number;
    supportLevel: string;
    features: string[];
    isCurrent: boolean;
    isRecommended: boolean;
  }>;
}

export function BillingPlansComparePage(): JSX.Element {
  const { accessToken } = useAuth();
  const [data, setData] = useState<CompareResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    void apiRequest<CompareResponse>('/customer/billing/plans/compare', {}, accessToken)
      .then(setData)
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Failed to load plans'));
  }, [accessToken]);

  return (
    <div className="page-stack">
      <PageHeader
        title="Compare plans"
        subtitle="Price, devices, features, and support levels."
        actions={<Link to="/billing" className="secondary-button">Back to billing</Link>}
      />
      {error ? <ErrorBanner message={error} /> : null}
      {!data && !error ? <LoadingState label="Loading plans…" /> : null}
      {data ? (
        <Card>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Plan</th>
                  <th>Price</th>
                  <th>Devices</th>
                  <th>Support</th>
                  <th>Features</th>
                </tr>
              </thead>
              <tbody>
                {data.plans.map((plan) => (
                  <tr key={plan.id}>
                    <td>
                      <strong>{plan.name}</strong>
                      {plan.isCurrent ? <StatusBadge value="CURRENT" /> : null}
                      {plan.isRecommended ? <StatusBadge value="RECOMMENDED" /> : null}
                    </td>
                    <td>{formatMoney(plan.amount, plan.currency)} / {plan.interval.toLowerCase()}</td>
                    <td>{plan.maxDevices}</td>
                    <td>{plan.supportLevel}</td>
                    <td>{(plan.features ?? []).map((f) => f.replace(/_/g, ' ')).join(', ') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
