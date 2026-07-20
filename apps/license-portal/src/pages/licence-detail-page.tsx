import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError, apiRequest } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatUkDate, formatUkDateTime } from '../lib/dates';
import { canRenewLicences, canSuspendOrRevoke } from '../lib/roles';
import { OfflineEnforcementBanner } from '../components/layout';
import {
  ButtonRow,
  Card,
  DataTable,
  ErrorBanner,
  Field,
  LoadingState,
  PageHeader,
  StatusBadge,
  WarningBanner,
} from '../components/ui';
import type { LicenceDetail } from '../types';

export function LicenceDetailPage(): JSX.Element {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { accessToken, admin } = useAuth();
  const [licence, setLicence] = useState<LicenceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function loadLicence(): Promise<void> {
    if (!accessToken || !id) {
      return;
    }

    setIsLoading(true);
    try {
      const response = await apiRequest<LicenceDetail>(`/admin/licences/${id}`, {}, accessToken);
      setLicence(response);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load licence');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadLicence();
  }, [accessToken, id]);

  async function runAction(path: string, body: Record<string, string>): Promise<void> {
    if (!accessToken) {
      return;
    }

    setIsSubmitting(true);
    setActionError(null);

    try {
      await apiRequest(path, {
        method: 'POST',
        body: JSON.stringify(body),
      }, accessToken);
      setReason('');
      await loadLicence();
    } catch (submissionError) {
      setActionError(submissionError instanceof ApiError ? submissionError.message : 'Action failed');
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleSuspend(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!window.confirm('Suspend this licence in the portal? Offline installations will not be remotely disabled.')) {
      return;
    }

    void runAction(`/admin/licences/${id}/suspend`, { reason });
  }

  function handleRevoke(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!window.confirm('Revoke this licence? This cannot be reinstated once revoked.')) {
      return;
    }

    void runAction(`/admin/licences/${id}/revoke`, { reason });
  }

  if (isLoading) {
    return <LoadingState label="Loading licence…" />;
  }

  if (error || !licence) {
    return <ErrorBanner message={error ?? 'Licence not found.'} />;
  }

  const showOfflineWarning = licence.status === 'SUSPENDED' || licence.status === 'REVOKED';

  return (
    <div className="page-stack">
      <PageHeader
        title={licence.licenseId}
        subtitle={licence.customerName ?? 'Licence detail'}
        actions={
          <ButtonRow>
            {canRenewLicences(admin?.role) ? (
              <Link to={`/licences/${licence.id}/renew`} className="secondary-button">Renew</Link>
            ) : null}
            <Link to={`/customers/${licence.customerId}`} className="secondary-button">View customer</Link>
          </ButtonRow>
        }
      />

      {showOfflineWarning ? <OfflineEnforcementBanner /> : null}
      {actionError ? <ErrorBanner message={actionError} /> : null}

      <div className="two-column-grid">
        <Card>
          <h3>Portal status</h3>
          <div className="detail-grid">
            <div className="detail-item"><span>Portal status</span><strong><StatusBadge value={licence.status} /></strong></div>
            <div className="detail-item"><span>Effective status</span><strong><StatusBadge value={licence.effectiveStatus} /></strong></div>
            <div className="detail-item"><span>Plan</span><strong>{licence.plan}</strong></div>
            <div className="detail-item"><span>Starts</span><strong>{formatUkDate(licence.startsAt)}</strong></div>
            <div className="detail-item"><span>Expires</span><strong>{formatUkDate(licence.expiresAt)}</strong></div>
            <div className="detail-item"><span>Max devices</span><strong>{licence.maxDevices}</strong></div>
            <div className="detail-item"><span>Masked key</span><strong>{licence.maskedLicenseKey ?? 'Not issued'}</strong></div>
            <div className="detail-item"><span>Signing key ID</span><strong>{licence.signingKeyId ?? '—'}</strong></div>
          </div>
        </Card>

        <Card>
          <h3>Signed payload summary</h3>
          {licence.payloadSummary ? (
            <div className="detail-grid">
              <div className="detail-item"><span>Company</span><strong>{licence.payloadSummary.companyName}</strong></div>
              <div className="detail-item"><span>Customer email</span><strong>{licence.payloadSummary.customerEmail ?? '—'}</strong></div>
              <div className="detail-item"><span>Issued at</span><strong>{formatUkDate(licence.payloadSummary.issuedAt)}</strong></div>
              <div className="detail-item"><span>Features</span><strong>{licence.payloadSummary.features.join(', ') || '—'}</strong></div>
              <div className="detail-item"><span>Notes</span><strong>{licence.payloadSummary.notes ?? licence.notes ?? '—'}</strong></div>
            </div>
          ) : (
            <p className="muted-text">Payload summary available after issuance.</p>
          )}
        </Card>
      </div>

      {canSuspendOrRevoke(admin?.role) ? (
        <Card>
          <h3>Suspension and revocation</h3>
          <WarningBanner
            title="Portal-only enforcement"
            message="These actions update administrative records. Already-activated offline desktop licences remain valid until online activation is available."
          />
          <form className="page-stack" onSubmit={handleSuspend}>
            <Field label="Suspension reason">
              <input value={reason} onChange={(event) => setReason(event.target.value)} required />
            </Field>
            <ButtonRow>
              <button type="submit" className="secondary-button" disabled={isSubmitting}>Suspend licence</button>
              <button
                type="button"
                className="danger-button"
                disabled={isSubmitting}
                onClick={() => {
                  const form = document.getElementById('revoke-form') as HTMLFormElement | null;
                  form?.requestSubmit();
                }}
              >
                Revoke licence
              </button>
            </ButtonRow>
          </form>
          <form id="revoke-form" className="sr-only" onSubmit={handleRevoke}>
            <input value={reason} readOnly hidden />
          </form>
        </Card>
      ) : null}

      <Card>
        <h3>Installations</h3>
        <DataTable
          caption="Licence installations"
          columns={[
            { key: 'installationId', label: 'Installation ID' },
            { key: 'label', label: 'Device label' },
            { key: 'status', label: 'Status' },
            { key: 'lastSeen', label: 'Last seen' },
          ]}
          rows={(licence.installations ?? []).map((installation) => ({
            id: installation.id,
            cells: {
              installationId: installation.installationId,
              label: installation.deviceLabel ?? '—',
              status: <StatusBadge value={installation.status} />,
              lastSeen: formatUkDateTime(installation.lastSeenAt),
            },
          }))}
          emptyMessage="No installations registered."
        />
      </Card>

      <Card>
        <h3>Payment records</h3>
        <DataTable
          caption="Licence payments"
          columns={[
            { key: 'reference', label: 'Reference' },
            { key: 'amount', label: 'Amount' },
            { key: 'status', label: 'Status' },
          ]}
          rows={(licence.payments ?? []).map((payment) => ({
            id: payment.id,
            cells: {
              reference: payment.paymentReference ?? payment.invoiceReference ?? payment.id.slice(0, 8),
              amount: `${(payment.amountPence / 100).toFixed(2)} ${payment.currency}`,
              status: <StatusBadge value={payment.paymentStatus} />,
            },
          }))}
          emptyMessage="No linked payments."
        />
      </Card>

      <Card>
        <h3>Renewal history</h3>
        <DataTable
          caption="Renewal history"
          columns={[
            { key: 'licenseId', label: 'Licence ID' },
            { key: 'status', label: 'Status' },
            { key: 'expires', label: 'Expires' },
          ]}
          rows={(licence.renewals ?? []).map((renewal) => ({
            id: renewal.id,
            cells: {
              licenseId: (
                <button type="button" className="text-link" onClick={() => navigate(`/licences/${renewal.id}`)}>
                  {renewal.licenseId}
                </button>
              ),
              status: <StatusBadge value={renewal.effectiveStatus} />,
              expires: formatUkDate(renewal.expiresAt),
            },
          }))}
          emptyMessage="No renewal chain entries."
        />
      </Card>

      <Card>
        <h3>Audit history</h3>
        <DataTable
          caption="Licence audit history"
          columns={[
            { key: 'action', label: 'Action' },
            { key: 'actor', label: 'Actor' },
            { key: 'when', label: 'When' },
          ]}
          rows={(licence.auditLogs ?? []).map((entry) => ({
            id: entry.id,
            cells: {
              action: entry.action.replace(/_/g, ' '),
              actor: entry.actorDisplayName ?? 'System',
              when: formatUkDateTime(entry.createdAt),
            },
          }))}
          emptyMessage="No audit entries."
        />
      </Card>
    </div>
  );
}
