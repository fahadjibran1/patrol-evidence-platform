import { useEffect, useState } from 'react';
import { apiRequest } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  Card,
  EmptyState,
  ErrorBanner,
  LoadingState,
  PageHeader,
} from '../components/ui';
import type { ActivityItem } from '../types';

export function ActivityPage(): JSX.Element {
  const { accessToken } = useAuth();
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!accessToken) return;
    setIsLoading(true);
    void apiRequest<{ items: ActivityItem[] }>('/customer/activity', {}, accessToken)
      .then((response) => setItems(response.items))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load activity'))
      .finally(() => setIsLoading(false));
  }, [accessToken]);

  return (
    <div className="page-stack">
      <PageHeader title="Activity" subtitle="Organisation-only audit history. Internal admin events are never shown." />
      {error ? <ErrorBanner message={error} /> : null}
      {isLoading ? <LoadingState /> : null}
      {!isLoading && items.length === 0 ? (
        <EmptyState title="No activity yet" description="Logins, invitations, and profile changes will appear here." />
      ) : null}
      {!isLoading && items.length > 0 ? (
        <Card>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Action</th>
                  <th>Actor</th>
                  <th>Entity</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>{new Date(item.createdAt).toLocaleString()}</td>
                    <td>{item.action}</td>
                    <td>{item.actor ? `${item.actor.displayName} (${item.actor.email})` : '—'}</td>
                    <td>{item.entityType}{item.entityId ? ` · ${item.entityId.slice(0, 8)}` : ''}</td>
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
