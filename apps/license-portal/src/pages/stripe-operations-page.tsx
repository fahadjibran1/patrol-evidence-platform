import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  Card,
  DataTable,
  ErrorBanner,
  InfoBanner,
  LoadingState,
  PageHeader,
  StatusBadge,
} from '../components/ui';

interface StripeStatus {
  mode: string;
  enabled: boolean;
  configured: boolean;
  gracePeriodDays?: number;
}

interface StripeOverview {
  stripe?: StripeStatus;
  failedWebhooks: number;
  deadLetters: number;
  openAlerts: number;
  lastProcessedWebhookAt: string | null;
  priceMappingsTotal?: number;
  activePriceMappingsForMode?: number;
}

interface PriceMapping {
  id: string;
  planId: string;
  billingInterval: string;
  stripeProductId: string;
  stripePriceId: string;
  currency: string;
  active: boolean;
  livemode: boolean;
  plan?: { code: string; name: string };
}

interface WebhookEvent {
  id: string;
  stripeEventId: string;
  type: string;
  processingStatus: string;
  attempts: number;
  receivedAt: string;
  processedAt: string | null;
  lastError: string | null;
  livemode: boolean;
}

interface ReconciliationAlert {
  id: string;
  alertType: string;
  message: string;
  status: string;
  stripeObjectId: string | null;
  createdAt: string;
}

export function StripeOperationsPage(): JSX.Element {
  const { accessToken } = useAuth();
  const [status, setStatus] = useState<StripeStatus | null>(null);
  const [overview, setOverview] = useState<StripeOverview | null>(null);
  const [mappings, setMappings] = useState<PriceMapping[]>([]);
  const [webhooks, setWebhooks] = useState<WebhookEvent[]>([]);
  const [alerts, setAlerts] = useState<ReconciliationAlert[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!accessToken) return;
    const [statusRes, overviewRes, mappingRes, webhookRes, alertRes] = await Promise.all([
      apiRequest<StripeStatus & { providers?: unknown }>('/admin/stripe/status', {}, accessToken),
      apiRequest<StripeOverview>('/admin/stripe/overview', {}, accessToken),
      apiRequest<PriceMapping[]>('/admin/stripe/price-mappings', {}, accessToken),
      apiRequest<WebhookEvent[]>('/admin/stripe/webhooks', {}, accessToken),
      apiRequest<ReconciliationAlert[]>('/admin/stripe/alerts', {}, accessToken),
    ]);
    setStatus({
      mode: statusRes.mode,
      enabled: statusRes.enabled,
      configured: statusRes.configured,
      gracePeriodDays: statusRes.gracePeriodDays,
    });
    setOverview(overviewRes);
    setMappings(Array.isArray(mappingRes) ? mappingRes : []);
    setWebhooks(Array.isArray(webhookRes) ? webhookRes : []);
    setAlerts(Array.isArray(alertRes) ? alertRes : []);
    setError(null);
  }, [accessToken]);

  useEffect(() => {
    if (!accessToken) return;
    setIsLoading(true);
    void load()
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : 'Failed to load Stripe operations');
      })
      .finally(() => setIsLoading(false));
  }, [accessToken, load]);

  async function validateMapping(id: string): Promise<void> {
    if (!accessToken) return;
    setBusyId(id);
    try {
      await apiRequest(`/admin/stripe/price-mappings/${id}/validate`, { method: 'POST', body: '{}' }, accessToken);
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Validation failed');
    } finally {
      setBusyId(null);
    }
  }

  async function reprocess(eventId: string): Promise<void> {
    if (!accessToken) return;
    setBusyId(eventId);
    try {
      await apiRequest(`/admin/stripe/webhooks/${eventId}/reprocess`, { method: 'POST', body: '{}' }, accessToken);
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Reprocess failed');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="page-stack">
      <PageHeader
        title="Stripe operations"
        subtitle="Payment-provider mappings, webhooks, and reconciliation. Internal billing remains authoritative."
        actions={(
          <button type="button" className="secondary-button" onClick={() => void load()}>
            Refresh
          </button>
        )}
      />

      <InfoBanner
        title="Secrets never shown"
        message="Secret keys, webhook signing secrets, Checkout URLs, and full webhook payloads are not displayed here."
      />

      {error ? <ErrorBanner message={error} /> : null}
      {isLoading ? <LoadingState label="Loading Stripe operations…" /> : null}

      {!isLoading && status ? (
        <Card>
          <h3>Overview</h3>
          <div className="detail-grid">
            <div className="detail-item"><span>Enabled</span><strong>{status.enabled ? 'Yes' : 'No'}</strong></div>
            <div className="detail-item"><span>Mode</span><strong><StatusBadge value={status.mode} /></strong></div>
            <div className="detail-item"><span>Configured</span><strong>{status.configured ? 'Yes' : 'No'}</strong></div>
            <div className="detail-item"><span>Failed webhooks</span><strong>{overview?.failedWebhooks ?? 0}</strong></div>
            <div className="detail-item"><span>Dead letter</span><strong>{overview?.deadLetters ?? 0}</strong></div>
            <div className="detail-item"><span>Open alerts</span><strong>{overview?.openAlerts ?? 0}</strong></div>
            <div className="detail-item"><span>Active mappings</span><strong>{overview?.activePriceMappingsForMode ?? 0}</strong></div>
            <div className="detail-item"><span>Last processed</span><strong>{overview?.lastProcessedWebhookAt ?? '—'}</strong></div>
            <div className="detail-item"><span>Grace period (days)</span><strong>{status.gracePeriodDays ?? '—'}</strong></div>
          </div>
        </Card>
      ) : null}

      {!isLoading ? (
        <>
          <Card>
            <h3>Price mappings</h3>
            <DataTable
              caption="Stripe price mappings"
              columns={[
                { key: 'plan', label: 'Plan' },
                { key: 'interval', label: 'Interval' },
                { key: 'price', label: 'Stripe price' },
                { key: 'currency', label: 'Currency' },
                { key: 'mode', label: 'Mode' },
                { key: 'active', label: 'Active' },
                { key: 'actions', label: 'Actions' },
              ]}
              rows={mappings.map((mapping) => ({
                id: mapping.id,
                cells: {
                  plan: mapping.plan?.code ?? mapping.planId,
                  interval: mapping.billingInterval,
                  price: mapping.stripePriceId,
                  currency: mapping.currency,
                  mode: mapping.livemode ? 'LIVE' : 'TEST',
                  active: mapping.active ? 'Yes' : 'No',
                  actions: (
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={busyId === mapping.id}
                      onClick={() => void validateMapping(mapping.id)}
                    >
                      Validate
                    </button>
                  ),
                },
              }))}
              emptyMessage="No Stripe price mappings configured."
            />
          </Card>

          <Card>
            <h3>Reconciliation alerts</h3>
            <DataTable
              caption="Reconciliation alerts"
              columns={[
                { key: 'type', label: 'Type' },
                { key: 'message', label: 'Message' },
                { key: 'status', label: 'Status' },
                { key: 'object', label: 'Stripe object' },
                { key: 'created', label: 'Created' },
              ]}
              rows={alerts.map((alert) => ({
                id: alert.id,
                cells: {
                  type: alert.alertType,
                  message: alert.message,
                  status: <StatusBadge value={alert.status} />,
                  object: alert.stripeObjectId ?? '—',
                  created: alert.createdAt,
                },
              }))}
              emptyMessage="No reconciliation alerts."
            />
          </Card>

          <Card>
            <h3>Webhook events</h3>
            <DataTable
              caption="Recent Stripe webhooks"
              columns={[
                { key: 'type', label: 'Type' },
                { key: 'status', label: 'Status' },
                { key: 'attempts', label: 'Attempts' },
                { key: 'mode', label: 'Mode' },
                { key: 'error', label: 'Last error' },
                { key: 'actions', label: 'Actions' },
              ]}
              rows={webhooks.map((event) => ({
                id: event.id,
                cells: {
                  type: event.type,
                  status: <StatusBadge value={event.processingStatus} />,
                  attempts: String(event.attempts),
                  mode: event.livemode ? 'LIVE' : 'TEST',
                  error: event.lastError ?? '—',
                  actions: ['FAILED', 'DEAD_LETTER'].includes(event.processingStatus) ? (
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={busyId === event.id}
                      onClick={() => void reprocess(event.id)}
                    >
                      Reprocess
                    </button>
                  ) : '—',
                },
              }))}
              emptyMessage="No webhook events stored."
            />
          </Card>
        </>
      ) : null}
    </div>
  );
}
