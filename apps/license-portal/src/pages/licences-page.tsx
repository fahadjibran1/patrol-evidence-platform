import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatUkDate } from '../lib/dates';
import { canIssueLicences } from '../lib/roles';
import {
  Card,
  DataTable,
  ErrorBanner,
  LoadingState,
  PageHeader,
  StatusBadge,
} from '../components/ui';
import type { LicenceSummary, PaginatedResponse } from '../types';

export function LicencesPage(): JSX.Element {
  const { accessToken, admin } = useAuth();
  const [licences, setLicences] = useState<LicenceSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!accessToken) {
      return;
    }

    void apiRequest<PaginatedResponse<LicenceSummary>>('/admin/licences?page=1&pageSize=100', {}, accessToken)
      .then((response) => setLicences(response.items))
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : 'Failed to load licences');
      })
      .finally(() => setIsLoading(false));
  }, [accessToken]);

  return (
    <div className="page-stack">
      <PageHeader
        title="Licences"
        subtitle="Portal records for issued TG1 licences. Full keys are only shown at issuance."
        actions={
          canIssueLicences(admin?.role) ? (
            <Link to="/licences/issue" className="primary-button">Issue licence</Link>
          ) : undefined
        }
      />

      {error ? <ErrorBanner message={error} /> : null}
      {isLoading ? <LoadingState label="Loading licences…" /> : (
        <Card>
          <DataTable
            caption="Licences"
            columns={[
              { key: 'licenseId', label: 'Licence ID' },
              { key: 'customer', label: 'Customer' },
              { key: 'plan', label: 'Plan' },
              { key: 'portalStatus', label: 'Portal status' },
              { key: 'effective', label: 'Effective status' },
              { key: 'expires', label: 'Expires' },
              { key: 'devices', label: 'Devices', align: 'right' },
            ]}
            rows={licences.map((licence) => ({
              id: licence.id,
              cells: {
                licenseId: <Link to={`/licences/${licence.id}`} className="text-link">{licence.licenseId}</Link>,
                customer: licence.customerName ?? '—',
                plan: licence.plan,
                portalStatus: <StatusBadge value={licence.status} />,
                effective: <StatusBadge value={licence.effectiveStatus} />,
                expires: formatUkDate(licence.expiresAt),
                devices: licence.maxDevices,
              },
            }))}
          />
        </Card>
      )}
    </div>
  );
}
