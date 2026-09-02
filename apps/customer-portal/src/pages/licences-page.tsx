import { useEffect, useState } from 'react';
import { apiRequest, downloadAuthenticatedFile } from '../lib/api';
import { useAuth } from '../lib/auth';
import { canDownloadLicence } from '../lib/permissions';
import {
  Card,
  EmptyState,
  ErrorBanner,
  LoadingState,
  PageHeader,
  StatusBadge,
} from '../components/ui';
import type { CustomerSafeLicence } from '../types';

export function LicencesPage(): JSX.Element {
  const { accessToken, customer } = useAuth();
  const allowDownload = canDownloadLicence(customer);
  const [items, setItems] = useState<CustomerSafeLicence[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) {
      return;
    }
    setIsLoading(true);
    void apiRequest<{ items: CustomerSafeLicence[] }>('/customer/licences', {}, accessToken)
      .then((response) => {
        setItems(response.items);
        setError(null);
      })
      .catch((loadError) => {
        setItems([]);
        setError(loadError instanceof Error ? loadError.message : 'Failed to load licences');
      })
      .finally(() => setIsLoading(false));
  }, [accessToken]);

  async function downloadLicence(licence: CustomerSafeLicence): Promise<void> {
    if (!accessToken) {
      return;
    }
    setDownloadError(null);
    setDownloadingId(licence.id);
    try {
      await downloadAuthenticatedFile(
        `/customer/licences/${licence.id}/download`,
        `${licence.licenseId}.lic`,
        accessToken,
      );
      setItems((current) =>
        current.map((item) =>
          item.id === licence.id
            ? {
                ...item,
                downloadCount: item.downloadCount + 1,
                lastDownloadedAt: new Date().toISOString(),
              }
            : item,
        ),
      );
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setDownloadingId(null);
    }
  }

  return (
    <div className="page-stack">
      <PageHeader
        title="My licences"
        subtitle="Company-scoped licence records. TG1 key material is never shown in the portal."
      />
      {error ? <ErrorBanner message={error} /> : null}
      {downloadError ? <ErrorBanner message={downloadError} /> : null}
      {isLoading ? <LoadingState label="Loading licences…" /> : null}
      {!isLoading && items.length === 0 && !error ? (
        <EmptyState
          title="No licences yet"
          description="When a licence is issued for your company, it will appear here."
        />
      ) : null}
      {!isLoading && items.length > 0 ? (
        <Card>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Licence ID</th>
                  <th>Status</th>
                  <th>Plan</th>
                  <th>Issued</th>
                  <th>Expiry</th>
                  <th>Devices</th>
                  <th>Version</th>
                  <th>Download</th>
                </tr>
              </thead>
              <tbody>
                {items.map((licence) => {
                  const canDownload =
                    allowDownload
                    && licence.hasDownloadableFile
                    && (licence.effectiveStatus === 'ACTIVE'
                      || licence.effectiveStatus === 'EXPIRING_SOON'
                      || licence.effectiveStatus === 'SCHEDULED')
                    && licence.status === 'ACTIVE';
                  return (
                    <tr key={licence.id}>
                      <td>{licence.licenseId}</td>
                      <td><StatusBadge value={licence.effectiveStatus} /></td>
                      <td>{licence.plan}</td>
                      <td>{licence.issuedAt ? new Date(licence.issuedAt).toLocaleDateString() : '—'}</td>
                      <td>{licence.expiresAt}</td>
                      <td>{licence.maxDevices}</td>
                      <td>{licence.currentVersionNumber ?? '—'}</td>
                      <td>
                        <button
                          type="button"
                          className="secondary-button"
                          disabled={!canDownload || downloadingId === licence.id}
                          onClick={() => void downloadLicence(licence)}
                        >
                          {downloadingId === licence.id ? 'Downloading…' : 'Download'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
