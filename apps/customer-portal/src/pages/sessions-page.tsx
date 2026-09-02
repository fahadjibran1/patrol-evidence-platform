import { useEffect, useState } from 'react';
import { apiRequest } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  Card,
  EmptyState,
  ErrorBanner,
  LoadingState,
  PageHeader,
  StatusBadge,
} from '../components/ui';
import type { CustomerSessionItem } from '../types';

export function SessionsPage(): JSX.Element {
  const { accessToken } = useAuth();
  const [items, setItems] = useState<CustomerSessionItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  async function load(): Promise<void> {
    if (!accessToken) return;
    const response = await apiRequest<{ items: CustomerSessionItem[] }>('/customer/sessions', {}, accessToken);
    setItems(response.items);
  }

  useEffect(() => {
    setIsLoading(true);
    void load()
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load sessions'))
      .finally(() => setIsLoading(false));
  }, [accessToken]);

  async function revoke(id: string): Promise<void> {
    if (!accessToken) return;
    await apiRequest(`/customer/sessions/${id}/revoke`, { method: 'POST', body: '{}' }, accessToken);
    await load();
  }

  async function revokeOthers(): Promise<void> {
    if (!accessToken) return;
    await apiRequest('/customer/sessions/revoke-others', { method: 'POST', body: '{}' }, accessToken);
    await load();
  }

  return (
    <div className="page-stack">
      <PageHeader
        title="Sessions"
        subtitle="Active and recent portal sessions for your account."
        actions={
          <button type="button" className="secondary-button" onClick={() => void revokeOthers()}>
            Sign out other sessions
          </button>
        }
      />
      {error ? <ErrorBanner message={error} /> : null}
      {isLoading ? <LoadingState /> : null}
      {!isLoading && items.length === 0 ? (
        <EmptyState title="No sessions" description="Sessions will appear here after you sign in." />
      ) : null}
      {!isLoading && items.length > 0 ? (
        <Card>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Created</th>
                  <th>IP</th>
                  <th>Remember me</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((session) => (
                  <tr key={session.id}>
                    <td>{new Date(session.createdAt).toLocaleString()}</td>
                    <td>{session.ipAddress ?? '—'}</td>
                    <td>{session.rememberMe ? 'Yes' : 'No'}</td>
                    <td>
                      <StatusBadge
                        value={session.revokedAt ? 'REVOKED' : session.current ? 'ACTIVE' : 'OPEN'}
                      />
                    </td>
                    <td>
                      {!session.revokedAt ? (
                        <button type="button" className="secondary-button" onClick={() => void revoke(session.id)}>
                          Revoke
                        </button>
                      ) : null}
                    </td>
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
