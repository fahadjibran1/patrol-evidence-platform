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
import type { CustomerNotificationItem, NotificationCategory } from '../types';

const FILTERS: Array<{ value: '' | NotificationCategory; label: string }> = [
  { value: '', label: 'All' },
  { value: 'licence', label: 'Licence' },
  { value: 'general', label: 'General' },
  { value: 'system', label: 'System' },
];

export function NotificationsPage(): JSX.Element {
  const { accessToken } = useAuth();
  const [items, setItems] = useState<CustomerNotificationItem[]>([]);
  const [category, setCategory] = useState<'' | NotificationCategory>('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!accessToken) {
      return;
    }
    setIsLoading(true);
    const query = category ? `?category=${category}` : '';
    void apiRequest<{ items: CustomerNotificationItem[] }>(`/customer/notifications${query}`, {}, accessToken)
      .then((response) => {
        setItems(response.items);
        setError(null);
      })
      .catch((loadError) => {
        setItems([]);
        setError(loadError instanceof Error ? loadError.message : 'Failed to load notifications');
      })
      .finally(() => setIsLoading(false));
  }, [accessToken, category]);

  return (
    <div className="page-stack">
      <PageHeader title="Notifications" subtitle="Email history for your company. Message bodies and TG1 attachments are never shown." />
      <div className="button-row" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
        {FILTERS.map((filter) => (
          <button
            key={filter.label}
            type="button"
            className={category === filter.value ? 'primary-button' : 'secondary-button'}
            onClick={() => setCategory(filter.value)}
          >
            {filter.label}
          </button>
        ))}
      </div>
      {error ? <ErrorBanner message={error} /> : null}
      {isLoading ? <LoadingState label="Loading notifications…" /> : null}
      {!isLoading && items.length === 0 && !error ? (
        <EmptyState title="No notifications" description="Licence and system emails for your company will appear here." />
      ) : null}
      {!isLoading && items.length > 0 ? (
        <Card>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Category</th>
                  <th>Subject</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>{new Date(item.createdAt).toLocaleString()}</td>
                    <td>{item.category}</td>
                    <td>{item.subject}</td>
                    <td><StatusBadge value={item.status} /></td>
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
