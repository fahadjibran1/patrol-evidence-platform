import { useEffect, useState } from 'react';
import { apiRequest } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  Card,
  ErrorBanner,
  InfoBanner,
  LoadingState,
  PageHeader,
  StatusBadge,
} from '../components/ui';
import type { SigningKeyStatus } from '../types';

export function SettingsPage(): JSX.Element {
  const { accessToken } = useAuth();
  const [status, setStatus] = useState<SigningKeyStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!accessToken) {
      return;
    }

    void apiRequest<SigningKeyStatus>('/admin/settings/signing-key', {}, accessToken)
      .then(setStatus)
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : 'Failed to load signing key status');
      })
      .finally(() => setIsLoading(false));
  }, [accessToken]);

  return (
    <div className="page-stack">
      <PageHeader
        title="Settings"
        subtitle="Operational configuration visible to administrators. Private key material is never exposed."
      />

      <InfoBanner
        title="Key material stays on the server"
        message="The portal only displays the signing key identifier and readiness status. Ed25519 private keys are loaded exclusively by the licence API process."
      />

      {error ? <ErrorBanner message={error} /> : null}
      {isLoading ? <LoadingState label="Loading settings…" /> : status ? (
        <Card>
          <div className="detail-grid">
            <div className="detail-item"><span>Signing key ID</span><strong>{status.keyId || 'Not configured'}</strong></div>
            <div className="detail-item"><span>Readiness</span><strong><StatusBadge value={status.ready ? 'READY' : 'MISSING'} /></strong></div>
            <div className="detail-item"><span>Algorithm</span><strong>{status.algorithm}</strong></div>
          </div>
        </Card>
      ) : (
        <ErrorBanner message="Signing key status unavailable." />
      )}
    </div>
  );
}
