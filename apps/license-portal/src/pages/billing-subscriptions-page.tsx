import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, apiRequest } from '../lib/api';
import { useAuth } from '../lib/auth';
import { canManageBilling } from '../lib/roles';
import { formatUkDate } from '../lib/dates';
import {
  ButtonRow,
  Card,
  DataTable,
  ErrorBanner,
  Field,
  InfoBanner,
  LoadingState,
  PageHeader,
  StatusBadge,
} from '../components/ui';
import type {
  BillingPlan,
  BillingSubscription,
  ChangeSubscriptionPlanRequest,
  CreateSubscriptionRequest,
  PaginatedResponse,
} from '../types';

function formatApiError(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return fallback;
}

export function BillingSubscriptionsPage(): JSX.Element {
  const { accessToken, admin } = useAuth();
  const canMutate = canManageBilling(admin?.role);
  const [subscriptions, setSubscriptions] = useState<BillingSubscription[]>([]);
  const [plans, setPlans] = useState<BillingPlan[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [organisationId, setOrganisationId] = useState('');
  const [planId, setPlanId] = useState('');
  const [billingInterval, setBillingInterval] = useState<'MONTHLY' | 'ANNUAL'>('MONTHLY');
  const [changePlanId, setChangePlanId] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!accessToken) {
      return;
    }

    setIsLoading(true);
    setError(null);

    void Promise.all([
      apiRequest<PaginatedResponse<BillingSubscription>>(
        '/admin/billing/subscriptions?page=1&pageSize=100',
        {},
        accessToken,
      ),
      apiRequest<{ items: BillingPlan[] }>('/admin/billing/plans?status=ACTIVE', {}, accessToken),
    ])
      .then(([subscriptionResponse, planResponse]) => {
        setSubscriptions(subscriptionResponse.items ?? []);
        setPlans(planResponse.items ?? []);
      })
      .catch((loadError) => {
        setError(formatApiError(loadError, 'Failed to load subscriptions'));
      })
      .finally(() => setIsLoading(false));
  }, [accessToken, reloadKey]);

  function reload(): void {
    setReloadKey((value) => value + 1);
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!accessToken || !canMutate) {
      return;
    }

    setIsSubmitting(true);
    setActionError(null);
    setSuccess(null);

    const body: CreateSubscriptionRequest = {
      organisationId: organisationId.trim(),
      planId: planId.trim(),
      billingInterval,
      startTrial: true,
      autoRenew: true,
    };

    try {
      const created = await apiRequest<BillingSubscription>(
        '/admin/billing/subscriptions',
        { method: 'POST', body: JSON.stringify(body) },
        accessToken,
      );
      setOrganisationId('');
      setPlanId('');
      setSuccess(`Created subscription for ${created.organisationName ?? created.organisationId}.`);
      reload();
    } catch (submissionError) {
      setActionError(formatApiError(submissionError, 'Failed to create subscription'));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function runAction(
    subscriptionId: string,
    path: string,
    body?: unknown,
    successMessage?: string,
  ): Promise<void> {
    if (!accessToken || !canMutate) {
      return;
    }

    setBusyId(subscriptionId);
    setActionError(null);
    setSuccess(null);

    try {
      await apiRequest(
        path,
        {
          method: 'POST',
          ...(body ? { body: JSON.stringify(body) } : {}),
        },
        accessToken,
      );
      setSuccess(successMessage ?? 'Subscription updated.');
      reload();
    } catch (actionErr) {
      setActionError(formatApiError(actionErr, 'Subscription action failed'));
    } finally {
      setBusyId(null);
    }
  }

  async function handleChangePlan(subscription: BillingSubscription): Promise<void> {
    const nextPlanId = changePlanId[subscription.id]?.trim();
    if (!nextPlanId) {
      setActionError('Select a plan before changing.');
      return;
    }

    const body: ChangeSubscriptionPlanRequest = {
      planId: nextPlanId,
      billingInterval: subscription.billingInterval,
    };

    await runAction(
      subscription.id,
      `/admin/billing/subscriptions/${subscription.id}/change-plan`,
      body,
      'Plan changed.',
    );
  }

  return (
    <div className="page-stack">
      <PageHeader
        title="Subscriptions"
        subtitle="Organisation subscriptions and lifecycle actions."
      />

      {!canMutate ? (
        <InfoBanner
          title="Read-only access"
          message="Support users can view subscriptions. Activate, cancel, resume, and plan changes require ADMIN or SUPER_ADMIN."
        />
      ) : null}

      {error ? <ErrorBanner message={error} /> : null}
      {actionError ? <ErrorBanner message={actionError} /> : null}
      {success ? (
        <div className="banner banner-info" role="status">
          <strong>Success</strong>
          <p>{success}</p>
        </div>
      ) : null}

      {canMutate ? (
        <Card>
          <h3>Create subscription</h3>
          <form className="two-column-grid" onSubmit={(event) => void handleCreate(event)}>
            <Field label="Organisation ID">
              <input
                value={organisationId}
                onChange={(event) => setOrganisationId(event.target.value)}
                placeholder="Customer UUID"
                required
              />
            </Field>
            <Field label="Plan">
              <select value={planId} onChange={(event) => setPlanId(event.target.value)} required>
                <option value="">Select plan…</option>
                {plans.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.name} ({plan.code})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Billing interval">
              <select
                value={billingInterval}
                onChange={(event) => setBillingInterval(event.target.value as 'MONTHLY' | 'ANNUAL')}
              >
                <option value="MONTHLY">Monthly</option>
                <option value="ANNUAL">Annual</option>
              </select>
            </Field>
            <div className="field">
              <span>&nbsp;</span>
              <button type="submit" className="primary-button" disabled={isSubmitting}>
                {isSubmitting ? 'Creating…' : 'Create subscription'}
              </button>
            </div>
          </form>
        </Card>
      ) : null}

      {isLoading ? <LoadingState label="Loading subscriptions…" /> : (
        <Card>
          <DataTable
            caption="Subscriptions"
            columns={[
              { key: 'organisation', label: 'Organisation' },
              { key: 'plan', label: 'Plan' },
              { key: 'status', label: 'Status' },
              { key: 'interval', label: 'Interval' },
              { key: 'renewal', label: 'Next billing' },
              { key: 'actions', label: 'Actions' },
            ]}
            rows={subscriptions.map((subscription) => ({
              id: subscription.id,
              cells: {
                organisation: subscription.organisationName ? (
                  <Link to={`/customers/${subscription.organisationId}`} className="text-link">
                    {subscription.organisationName}
                  </Link>
                ) : subscription.organisationId,
                plan: subscription.plan.name,
                status: <StatusBadge value={subscription.status} />,
                interval: subscription.billingInterval,
                renewal: formatUkDate(subscription.nextBillingDate),
                actions: canMutate ? (
                  <ButtonRow>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={busyId === subscription.id}
                      onClick={() =>
                        void runAction(
                          subscription.id,
                          `/admin/billing/subscriptions/${subscription.id}/activate`,
                          undefined,
                          'Subscription activated.',
                        )
                      }
                    >
                      Activate
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={busyId === subscription.id}
                      onClick={() =>
                        void runAction(
                          subscription.id,
                          `/admin/billing/subscriptions/${subscription.id}/cancel`,
                          { atPeriodEnd: true },
                          'Subscription cancelled.',
                        )
                      }
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={busyId === subscription.id}
                      onClick={() =>
                        void runAction(
                          subscription.id,
                          `/admin/billing/subscriptions/${subscription.id}/resume`,
                          undefined,
                          'Subscription resumed.',
                        )
                      }
                    >
                      Resume
                    </button>
                    <select
                      value={changePlanId[subscription.id] ?? ''}
                      onChange={(event) =>
                        setChangePlanId((current) => ({
                          ...current,
                          [subscription.id]: event.target.value,
                        }))
                      }
                    >
                      <option value="">Change to…</option>
                      {plans.map((plan) => (
                        <option key={plan.id} value={plan.id}>
                          {plan.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={busyId === subscription.id}
                      onClick={() => void handleChangePlan(subscription)}
                    >
                      Change plan
                    </button>
                  </ButtonRow>
                ) : (
                  '—'
                ),
              },
            }))}
            emptyMessage="No subscriptions found."
          />
        </Card>
      )}
    </div>
  );
}
