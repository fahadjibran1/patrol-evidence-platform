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
import type { SigningKeyStatus, SmtpStatus } from '../types';

export function SettingsPage(): JSX.Element {
  const { accessToken } = useAuth();
  const [status, setStatus] = useState<SigningKeyStatus | null>(null);
  const [smtpStatus, setSmtpStatus] = useState<SmtpStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!accessToken) {
      return;
    }

    void Promise.all([
      apiRequest<SigningKeyStatus>('/admin/settings/signing-key', {}, accessToken),
      apiRequest<SmtpStatus>('/admin/settings/smtp', {}, accessToken),
    ])
      .then(([signing, smtp]) => {
        setStatus(signing);
        setSmtpStatus(smtp);
      })
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : 'Failed to load settings');
      })
      .finally(() => setIsLoading(false));
  }, [accessToken]);

  return (
    <div className="page-stack">
      <PageHeader
        title="Settings"
        subtitle="Operational configuration visible to administrators. Private key material and SMTP credentials are never exposed."
      />

      <InfoBanner
        title="Key material stays on the server"
        message="The portal only displays the signing key identifier and readiness status. Ed25519 private keys are loaded exclusively by the licence API process."
      />

      {error ? <ErrorBanner message={error} /> : null}
      {isLoading ? <LoadingState label="Loading settings…" /> : null}

      {!isLoading && status ? (
        <Card>
          <h3>Signing key</h3>
          <div className="detail-grid">
            <div className="detail-item"><span>Signing key ID</span><strong>{status.keyId || 'Not configured'}</strong></div>
            <div className="detail-item"><span>Readiness</span><strong><StatusBadge value={status.ready ? 'READY' : 'MISSING'} /></strong></div>
            <div className="detail-item"><span>Algorithm</span><strong>{status.algorithm}</strong></div>
          </div>
        </Card>
      ) : null}

      {!isLoading && !status && !error ? <ErrorBanner message="Signing key status unavailable." /> : null}

      {!isLoading && smtpStatus ? (
        <Card>
          <h3>Email (SMTP)</h3>
          <div className="detail-grid">
            <div className="detail-item">
              <span>SMTP configured</span>
              <strong>{smtpStatus.configured ? 'Yes' : 'No'}</strong>
            </div>
            <div className="detail-item">
              <span>Host</span>
              <strong>{smtpStatus.host ?? '—'}</strong>
            </div>
            <div className="detail-item">
              <span>Port</span>
              <strong>{smtpStatus.port ?? '—'}</strong>
            </div>
            <div className="detail-item">
              <span>Secure</span>
              <strong>
                {smtpStatus.secure === null ? '—' : smtpStatus.secure ? 'Yes' : 'No'}
              </strong>
            </div>
            <div className="detail-item">
              <span>From name</span>
              <strong>{smtpStatus.fromName ?? '—'}</strong>
            </div>
            <div className="detail-item">
              <span>From email</span>
              <strong>{smtpStatus.fromEmail ?? '—'}</strong>
            </div>
          </div>
          {!smtpStatus.configured ? (
            <InfoBanner
              title="SMTP incomplete"
              message="Licence email delivery requires SMTP_HOST, SMTP_PORT, SMTP_USERNAME, SMTP_PASSWORD, and SMTP_FROM_EMAIL on the API server."
            />
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
