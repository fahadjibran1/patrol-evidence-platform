import { useEffect, useState } from 'react';
import { apiRequest } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatUkDateTime } from '../lib/dates';
import {
  Card,
  DataTable,
  ErrorBanner,
  LoadingState,
  PageHeader,
} from '../components/ui';
import type { AuditLogEntry, PaginatedResponse } from '../types';

export function AuditPage(): JSX.Element {
  const { accessToken } = useAuth();
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!accessToken) {
      return;
    }

    void apiRequest<PaginatedResponse<AuditLogEntry>>('/admin/audit?page=1&pageSize=100', {}, accessToken)
      .then((response) => setEntries(response.items))
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : 'Failed to load audit log');
      })
      .finally(() => setIsLoading(false));
  }, [accessToken]);

  return (
    <div className="page-stack">
      <PageHeader title="Audit log" subtitle="Immutable administrative activity across customers, licences, and payments." />

      {error ? <ErrorBanner message={error} /> : null}
      {isLoading ? <LoadingState label="Loading audit log…" /> : (
        <Card>
          <DataTable
            caption="Audit log"
            columns={[
              { key: 'when', label: 'When' },
              { key: 'action', label: 'Action' },
              { key: 'entity', label: 'Entity' },
              { key: 'actor', label: 'Actor' },
            ]}
            rows={entries.map((entry) => ({
              id: entry.id,
              cells: {
                when: formatUkDateTime(entry.createdAt),
                action: entry.action.replace(/_/g, ' '),
                entity: `${entry.entityType}${entry.entityId ? ` · ${entry.entityId}` : ''}`,
                actor: entry.actorDisplayName ?? 'System',
              },
            }))}
          />
        </Card>
      )}
    </div>
  );
}
