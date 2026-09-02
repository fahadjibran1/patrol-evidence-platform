import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  Card,
  ErrorBanner,
  InfoBanner,
  LoadingState,
  PageHeader,
} from '../components/ui';

interface FailedNotification {
  id: string;
  notificationType: string;
  recipient: string;
  subject: string;
  status: string;
  errorMessage: string | null;
  createdAt: string;
}

export function SupportOpsPage(): JSX.Element {
  const { accessToken, admin } = useAuth();
  const [failed, setFailed] = useState<FailedNotification[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [unlockEmail, setUnlockEmail] = useState('');
  const [unlockType, setUnlockType] = useState<'customer' | 'admin'>('customer');
  const [subscriptionId, setSubscriptionId] = useState('');
  const [organisationId, setOrganisationId] = useState('');
  const [webhookEventId, setWebhookEventId] = useState('');

  const load = useCallback(async () => {
    if (!accessToken) return;
    const res = await apiRequest<{ items: FailedNotification[] }>(
      '/admin/support/notifications/failed?limit=30',
      {},
      accessToken,
    );
    setFailed(Array.isArray(res.items) ? res.items : []);
    setError(null);
  }, [accessToken]);

  useEffect(() => {
    if (!accessToken) return;
    setIsLoading(true);
    void load()
      .catch((err: Error) => setError(err.message))
      .finally(() => setIsLoading(false));
  }, [accessToken, load]);

  async function run(action: () => Promise<unknown>, success: string) {
    if (!accessToken) return;
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      await action();
      setMessage(success);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Support operation failed');
    } finally {
      setBusy(false);
    }
  }

  if (isLoading) return <LoadingState label="Loading support tools…" />;

  return (
    <div className="page-stack">
      <PageHeader
        title="Support operations"
        subtitle="RC1 tooling: resend notifications, rebuild licences, unlock accounts, Stripe resync."
      />
      {error ? <ErrorBanner message={error} /> : null}
      {message ? <InfoBanner title="Support" message={message} /> : null}

      <div className="grid two">
        <Card>
          <h3>Unlock account</h3>
          <label>
            Account type
            <select
              value={unlockType}
              onChange={(e) => setUnlockType(e.target.value as 'customer' | 'admin')}
              disabled={busy}
            >
              <option value="customer">Customer</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <label>
            Email
            <input
              value={unlockEmail}
              onChange={(e) => setUnlockEmail(e.target.value)}
              disabled={busy}
              placeholder="user@example.com"
            />
          </label>
          <button
            type="button"
            className="primary-button"
            disabled={busy || !unlockEmail}
            onClick={() =>
              void run(
                () =>
                  apiRequest(
                    '/admin/support/accounts/unlock',
                    {
                      method: 'POST',
                      body: JSON.stringify({
                        accountType: unlockType,
                        email: unlockEmail,
                        reactivate: true,
                      }),
                    },
                    accessToken!,
                  ),
                'Account unlocked',
              )
            }
          >
            Unlock
          </button>
        </Card>

        <Card>
          <h3>Rebuild licence</h3>
          <label>
            Subscription ID
            <input
              value={subscriptionId}
              onChange={(e) => setSubscriptionId(e.target.value)}
              disabled={busy}
            />
          </label>
          <button
            type="button"
            className="primary-button"
            disabled={busy || !subscriptionId}
            onClick={() =>
              void run(
                () =>
                  apiRequest(
                    '/admin/support/licences/rebuild',
                    {
                      method: 'POST',
                      body: JSON.stringify({ subscriptionId }),
                    },
                    accessToken!,
                  ),
                'Licence rebuild requested',
              )
            }
          >
            Rebuild
          </button>
        </Card>

        <Card>
          <h3>Stripe resync</h3>
          <label>
            Organisation ID
            <input
              value={organisationId}
              onChange={(e) => setOrganisationId(e.target.value)}
              disabled={busy}
            />
          </label>
          <button
            type="button"
            className="primary-button"
            disabled={busy || !organisationId}
            onClick={() =>
              void run(
                () =>
                  apiRequest(
                    `/admin/support/stripe/resync/${encodeURIComponent(organisationId)}`,
                    { method: 'POST', body: '{}' },
                    accessToken!,
                  ),
                'Stripe resync started',
              )
            }
          >
            Resynchronise
          </button>
        </Card>

        <Card>
          <h3>Reprocess webhook</h3>
          <label>
            Stripe webhook event ID (internal)
            <input
              value={webhookEventId}
              onChange={(e) => setWebhookEventId(e.target.value)}
              disabled={busy}
            />
          </label>
          <button
            type="button"
            className="primary-button"
            disabled={busy || !webhookEventId}
            onClick={() =>
              void run(
                () =>
                  apiRequest(
                    `/admin/support/webhooks/${encodeURIComponent(webhookEventId)}/reprocess`,
                    { method: 'POST', body: '{}' },
                    accessToken!,
                  ),
                'Webhook reprocess queued',
              )
            }
          >
            Reprocess
          </button>
        </Card>

        {admin?.role === 'SUPER_ADMIN' ? (
          <Card>
            <h3>Reset customer billing state</h3>
            <label>
              Organisation ID
              <input
                value={organisationId}
                onChange={(e) => setOrganisationId(e.target.value)}
                disabled={busy}
              />
            </label>
            <button
              type="button"
              className="primary-button"
              disabled={busy || !organisationId}
              onClick={() =>
                void run(
                  () =>
                    apiRequest(
                      `/admin/support/organisations/${encodeURIComponent(organisationId)}/reset-state`,
                      {
                        method: 'POST',
                        body: JSON.stringify({
                          clearPendingCheckout: true,
                          clearScheduledPlanChange: true,
                          clearCancellation: true,
                          clearPastDue: true,
                        }),
                      },
                      accessToken!,
                    ),
                  'Customer billing state reset',
                )
              }
            >
              Reset flags
            </button>
          </Card>
        ) : null}
      </div>

      <Card>
        <h3>Failed notifications</h3>
        {failed.length === 0 ? (
          <p className="muted">No failed notifications.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Recipient</th>
                <th>Subject</th>
                <th>Type</th>
                <th>When</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {failed.map((row) => (
                <tr key={row.id}>
                  <td>{row.recipient}</td>
                  <td>{row.subject}</td>
                  <td>{row.notificationType}</td>
                  <td>{new Date(row.createdAt).toLocaleString()}</td>
                  <td>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={busy}
                      onClick={() =>
                        void run(
                          () =>
                            apiRequest(
                              `/admin/support/notifications/${encodeURIComponent(row.id)}/resend`,
                              { method: 'POST', body: '{}' },
                              accessToken!,
                            ),
                          'Notification resent',
                        )
                      }
                    >
                      Resend
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
