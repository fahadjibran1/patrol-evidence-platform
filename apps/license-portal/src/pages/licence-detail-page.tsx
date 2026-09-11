import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { apiRequest, copyToClipboard } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatUkDate, formatUkDateTime } from '../lib/dates';
import { buildActivationInstructions, downloadLicenceFile } from '../lib/licence-file';
import {
  canPerformLifecycleActions,
  canReactivateLicences,
  canRenewLicences,
  canRevealLicenseKey,
  canRevokeLicence,
} from '../lib/roles';
import { OFFLINE_ENFORCEMENT_LIMITS_TEXT, OfflineEnforcementBanner } from '../components/layout';
import { DownloadLicenceModal } from '../components/download-licence-modal';
import { EmailLicenceModal } from '../components/email-licence-modal';
import { LifecycleActionModal, type LifecycleActionType } from '../components/lifecycle-action-modal';
import {
  ButtonRow,
  Card,
  DataTable,
  ErrorBanner,
  InfoBanner,
  LoadingState,
  PageHeader,
  StatusBadge,
} from '../components/ui';
import type { LicenceDetail, LicenceVersionEntry, LifecycleActionResponse } from '../types';

const LIFECYCLE_ACTION_LABELS: Record<LifecycleActionType, string> = {
  reissue: 'Reissue',
  suspend: 'Suspend',
  reactivate: 'Reactivate',
  'change-plan': 'Change plan',
  'change-device-limit': 'Change device limit',
  revoke: 'Revoke',
};

function versionLabel(version: LicenceVersionEntry, maxVersionNumber: number): 'Current' | 'Revoked' | 'Superseded' {
  if (version.statusSnapshot === 'REVOKED') {
    return 'Revoked';
  }
  if (version.isCurrent ?? version.versionNumber === maxVersionNumber) {
    return 'Current';
  }
  return 'Superseded';
}

export function LicenceDetailPage(): JSX.Element {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { accessToken, admin } = useAuth();
  const [licence, setLicence] = useState<LicenceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showDownloadModal, setShowDownloadModal] = useState(false);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [activeAction, setActiveAction] = useState<LifecycleActionType | null>(null);
  const [actionResult, setActionResult] = useState<LifecycleActionResponse | null>(null);

  async function loadLicence(): Promise<void> {
    if (!accessToken || !id) {
      return;
    }

    setIsLoading(true);
    try {
      const response = await apiRequest<LicenceDetail & { maskedKey?: string | null }>(
        `/admin/licences/${id}`,
        {},
        accessToken,
      );
      setLicence({
        ...response,
        maskedLicenseKey: response.maskedLicenseKey ?? response.maskedKey ?? null,
      });
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load licence');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadLicence();
    // Clear any lingering in-memory action result / TG1 whenever we navigate to a different licence.
    return () => setActionResult(null);
  }, [accessToken, id]);

  if (isLoading) {
    return <LoadingState label="Loading licence…" />;
  }

  if (error || !licence) {
    return <ErrorBanner message={error ?? 'Licence not found.'} />;
  }

  const role = admin?.role;
  const status = licence.status;
  const showOfflineWarning = status === 'SUSPENDED' || status === 'REVOKED';
  const canDownload = canRevealLicenseKey(role) && Boolean(licence.maskedLicenseKey);
  const canLifecycle = canPerformLifecycleActions(role);

  const canShowRenew = canRenewLicences(role) && ['ACTIVE', 'SUSPENDED', 'EXPIRED'].includes(status);
  const canShowReissue = canLifecycle && status === 'ACTIVE' && Boolean(licence.maskedLicenseKey);
  const canShowSuspend = canLifecycle && status === 'ACTIVE';
  const canShowReactivate = canReactivateLicences(role) && status === 'SUSPENDED';
  const canShowChangePlan = canLifecycle && (status === 'ACTIVE' || status === 'SUSPENDED');
  const canShowChangeDeviceLimit = canLifecycle && (status === 'ACTIVE' || status === 'SUSPENDED');
  const canShowRevoke = canRevokeLicence(role) && status !== 'DRAFT' && status !== 'REVOKED';
  const hasAnyLifecycleAction =
    canShowReissue || canShowSuspend || canShowReactivate || canShowChangePlan || canShowChangeDeviceLimit || canShowRevoke;

  const versions = licence.versions ?? [];
  const maxVersionNumber = versions.reduce((max, entry) => Math.max(max, entry.versionNumber), 0);

  async function handleActionSuccess(action: LifecycleActionType, result: LifecycleActionResponse): Promise<void> {
    setActiveAction(null);
    setActionResult(result);
    setStatusMessage(`${LIFECYCLE_ACTION_LABELS[action]} completed successfully.`);
    await loadLicence();
  }

  return (
    <div className="page-stack">
      <PageHeader
        title={licence.licenseId}
        subtitle={licence.customerName ?? 'Licence detail'}
        actions={
          <ButtonRow>
            {canDownload ? (
              <button type="button" className="primary-button" onClick={() => setShowDownloadModal(true)}>
                Download licence file
              </button>
            ) : null}
            {canDownload ? (
              <button type="button" className="secondary-button" onClick={() => setShowEmailModal(true)}>
                Email licence
              </button>
            ) : null}
            {canShowRenew ? (
              <Link to={`/licences/${licence.id}/renew`} className="secondary-button">
                Renew
              </Link>
            ) : null}
            <Link to={`/customers/${licence.customerId}`} className="secondary-button">
              View customer
            </Link>
          </ButtonRow>
        }
      />

      {showOfflineWarning ? <OfflineEnforcementBanner /> : null}
      {statusMessage ? <p className="success-text">{statusMessage}</p> : null}

      <div className="two-column-grid">
        <Card>
          <h3>Portal status</h3>
          <div className="detail-grid">
            <div className="detail-item">
              <span>Portal status</span>
              <strong>
                <StatusBadge value={licence.status} />
              </strong>
            </div>
            <div className="detail-item">
              <span>Effective status</span>
              <strong>
                <StatusBadge value={licence.effectiveStatus} />
              </strong>
            </div>
            <div className="detail-item">
              <span>Plan</span>
              <strong>{licence.plan}</strong>
            </div>
            <div className="detail-item">
              <span>Starts</span>
              <strong>{formatUkDate(licence.startsAt)}</strong>
            </div>
            <div className="detail-item">
              <span>Expires</span>
              <strong>{formatUkDate(licence.expiresAt)}</strong>
            </div>
            <div className="detail-item">
              <span>Max devices</span>
              <strong>{licence.maxDevices}</strong>
            </div>
            <div className="detail-item">
              <span>Masked key</span>
              <strong>{licence.maskedLicenseKey ?? 'Not issued'}</strong>
            </div>
            <div className="detail-item">
              <span>Signing key ID</span>
              <strong>{licence.signingKeyId ?? '—'}</strong>
            </div>
          </div>
          {canDownload ? (
            <ButtonRow>
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  void copyToClipboard(
                    buildActivationInstructions({
                      licenseId: licence.licenseId,
                      companyName: licence.customerName ?? 'Customer',
                      plan: licence.plan,
                      expiresAtDisplay: formatUkDate(licence.expiresAt),
                    }),
                  ).then(() => setStatusMessage('Activation instructions copied.'));
                }}
              >
                Copy activation instructions
              </button>
            </ButtonRow>
          ) : null}
        </Card>

        <Card>
          <h3>Signed payload summary</h3>
          {licence.payloadSummary ? (
            <div className="detail-grid">
              <div className="detail-item">
                <span>Company</span>
                <strong>{licence.payloadSummary.companyName}</strong>
              </div>
              <div className="detail-item">
                <span>Customer email</span>
                <strong>{licence.payloadSummary.customerEmail ?? '—'}</strong>
              </div>
              <div className="detail-item">
                <span>Issued at</span>
                <strong>{formatUkDate(licence.payloadSummary.issuedAt)}</strong>
              </div>
              <div className="detail-item">
                <span>Features</span>
                <strong>{licence.payloadSummary.features.join(', ') || '—'}</strong>
              </div>
              <div className="detail-item">
                <span>Notes</span>
                <strong>{licence.payloadSummary.notes ?? licence.notes ?? '—'}</strong>
              </div>
            </div>
          ) : (
            <p className="muted-text">Payload summary available after issuance.</p>
          )}
        </Card>
      </div>

      {canLifecycle ? (
        <Card>
          <h3>Lifecycle actions</h3>
          <InfoBanner title="Offline enforcement limits" message={OFFLINE_ENFORCEMENT_LIMITS_TEXT} />

          {actionResult ? (
            <Card className="lifecycle-result">
              <p className="success-text">Updated licence record refreshed below.</p>
              {actionResult.emailResult ? (
                actionResult.emailResult.success ? (
                  <p className="success-text">Emailed to {actionResult.emailResult.recipient}.</p>
                ) : (
                  <ErrorBanner message={actionResult.emailResult.errorMessage ?? 'Email delivery failed. The change remains valid.'} />
                )
              ) : null}
              {actionResult.fullLicenseKey ? (
                <>
                  <p className="muted-text">A new TG1 key was produced by this action. It is held only in memory.</p>
                  <ButtonRow>
                    <button
                      type="button"
                      className="primary-button"
                      onClick={() => {
                        const key = actionResult.fullLicenseKey;
                        if (!key || !accessToken) {
                          return;
                        }
                        const result = downloadLicenceFile(actionResult.licenseId, key);
                        setStatusMessage(`${result.fileName} downloaded.`);
                        void apiRequest(
                          `/admin/licences/${actionResult.id}/download-event`,
                          { method: 'POST', body: JSON.stringify({ source: 'licence-detail' }) },
                          accessToken,
                        ).catch(() => undefined);
                        setActionResult(null);
                      }}
                    >
                      Download updated licence file
                    </button>
                    <button type="button" className="secondary-button" onClick={() => setActionResult(null)}>
                      Dismiss
                    </button>
                  </ButtonRow>
                </>
              ) : (
                <ButtonRow>
                  <button type="button" className="secondary-button" onClick={() => setActionResult(null)}>
                    Dismiss
                  </button>
                </ButtonRow>
              )}
            </Card>
          ) : null}

          {hasAnyLifecycleAction ? (
            <ButtonRow>
              {canShowReissue ? (
                <button type="button" className="secondary-button" onClick={() => setActiveAction('reissue')}>
                  Reissue
                </button>
              ) : null}
              {canShowSuspend ? (
                <button type="button" className="secondary-button" onClick={() => setActiveAction('suspend')}>
                  Suspend
                </button>
              ) : null}
              {canShowReactivate ? (
                <button type="button" className="secondary-button" onClick={() => setActiveAction('reactivate')}>
                  Reactivate
                </button>
              ) : null}
              {canShowChangePlan ? (
                <button type="button" className="secondary-button" onClick={() => setActiveAction('change-plan')}>
                  Change plan
                </button>
              ) : null}
              {canShowChangeDeviceLimit ? (
                <button type="button" className="secondary-button" onClick={() => setActiveAction('change-device-limit')}>
                  Change device limit
                </button>
              ) : null}
              {canShowRevoke ? (
                <button type="button" className="danger-button" onClick={() => setActiveAction('revoke')}>
                  Revoke
                </button>
              ) : null}
            </ButtonRow>
          ) : (
            <p className="muted-text">No lifecycle actions are available for this licence in its current status.</p>
          )}
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
        <h3>Version history</h3>
        <DataTable
          caption="Licence version history"
          columns={[
            { key: 'version', label: 'Version' },
            { key: 'action', label: 'Action' },
            { key: 'plan', label: 'Plan' },
            { key: 'devices', label: 'Devices', align: 'right' },
            { key: 'validity', label: 'Validity' },
            { key: 'label', label: 'Label' },
            { key: 'reason', label: 'Reason' },
            { key: 'issuedBy', label: 'Issued by' },
            { key: 'createdAt', label: 'Created' },
          ]}
          rows={versions.map((version) => ({
            id: version.id,
            cells: {
              version: `v${version.versionNumber}`,
              action: version.actionType.replace(/_/g, ' '),
              plan: version.plan,
              devices: version.maxDevices,
              validity: `${formatUkDate(version.validFrom)} – ${formatUkDate(version.validUntil)}`,
              label: <StatusBadge value={versionLabel(version, maxVersionNumber)} />,
              reason: version.reason ?? '—',
              issuedBy: version.issuedByDisplayName ?? 'System',
              createdAt: formatUkDateTime(version.createdAt),
            },
          }))}
          emptyMessage="No version history recorded for this licence."
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
        <h3>Notification history</h3>
        <DataTable
          caption="Licence notification history"
          columns={[
            { key: 'when', label: 'Date/time' },
            { key: 'type', label: 'Type' },
            { key: 'provider', label: 'Provider' },
            { key: 'recipient', label: 'Recipient' },
            { key: 'subject', label: 'Subject' },
            { key: 'status', label: 'Status' },
            { key: 'attempts', label: 'Attempts' },
            { key: 'sentAt', label: 'Sent at' },
            { key: 'error', label: 'Error' },
            { key: 'actor', label: 'Actor' },
          ]}
          rows={(licence.notificationLogs ?? []).map((entry) => ({
            id: entry.id,
            cells: {
              when: formatUkDateTime(entry.createdAt),
              type: entry.notificationType,
              provider: entry.provider,
              recipient: entry.recipient,
              subject: entry.subject,
              status: <StatusBadge value={entry.status} />,
              attempts: String(entry.attempts),
              sentAt: entry.sentAt ? formatUkDateTime(entry.sentAt) : '—',
              error: entry.errorMessage ?? '—',
              actor: entry.actorDisplayName ?? 'System',
            },
          }))}
          emptyMessage="No notification history for this licence."
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

      {showDownloadModal && accessToken ? (
        <DownloadLicenceModal
          licenceId={licence.id}
          humanLicenseId={licence.licenseId}
          accessToken={accessToken}
          onClose={() => setShowDownloadModal(false)}
          onDownloaded={(fileName) => setStatusMessage(`${fileName} downloaded.`)}
        />
      ) : null}

      {showEmailModal && accessToken ? (
        <EmailLicenceModal
          licenceId={licence.id}
          humanLicenseId={licence.licenseId}
          defaultRecipient={licence.customerEmail ?? licence.payloadSummary?.customerEmail ?? ''}
          defaultSubject={`Your PatrolSafe Licence – ${licence.licenseId}`}
          accessToken={accessToken}
          source="licence-detail"
          requirePassword
          onClose={() => setShowEmailModal(false)}
          onSent={(result) => {
            setStatusMessage(`Licence emailed successfully to ${result.recipient}.`);
            void loadLicence();
          }}
          onDownloadInstead={() => setShowDownloadModal(true)}
        />
      ) : null}

      {activeAction && accessToken ? (
        <LifecycleActionModal
          action={activeAction}
          licence={licence}
          accessToken={accessToken}
          onClose={() => setActiveAction(null)}
          onSuccess={(result) => void handleActionSuccess(activeAction, result)}
        />
      ) : null}
    </div>
  );
}
