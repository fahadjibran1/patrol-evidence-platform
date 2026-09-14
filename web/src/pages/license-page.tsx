import { ChangeEvent, FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiRequest } from '../lib/api';
import { isDesktopApp } from '../lib/desktop';
import { LICENCE_IMPORT_ACCEPT, readLocalLicenceFile } from '../lib/licence-file-import';
import { useAuth } from '../state/auth';
import type { LicenseStatusResponse } from '../types';
import { Card, PageHeader, StatusBadge } from '../components/ui';
import { formatPatrolDate } from '../lib/patrol-time';

const SUPPLIER_CONTACT = 'mailto:support@sfour.co.uk?subject=PatrolSafe%20by%20S4%20Licence';
const PUBLIC_REQUEST_PLAN = 'annual' as const;

export function LicensePage(): JSX.Element {
  const navigate = useNavigate();
  const { token } = useAuth();
  const desktop = isDesktopApp();
  const [status, setStatus] = useState<LicenseStatusResponse | null>(null);
  const [companyName, setCompanyName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadStatus = useCallback(async () => {
    const next = await apiRequest<LicenseStatusResponse>('/license/status', {}, token ?? undefined);
    setStatus(next);
    if (next.companyName) setCompanyName(next.companyName);
    return next;
  }, [token]);

  useEffect(() => {
    void loadStatus().catch(() => setError('Licence status could not be loaded. Try again.'));
  }, [loadStatus]);

  async function handleExportRequest(): Promise<void> {
    setIsSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await apiRequest<{ fileName: string; contents: string }>(
        '/license/request-file',
        { method: 'POST', body: JSON.stringify({ companyName: companyName.trim(), requestedPlan: PUBLIC_REQUEST_PLAN }) },
        token ?? undefined,
      );
      const blob = new Blob([result.contents], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = result.fileName;
      anchor.click();
      URL.revokeObjectURL(url);
      setSuccess('Licence request created. Send the downloaded file to your PatrolSafe supplier.');
    } catch {
      setError('The licence request could not be created. Check the company name and try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleImportAndActivate(raw: string): Promise<void> {
    setIsSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const next = await apiRequest<LicenseStatusResponse>(
        '/license/import',
        { method: 'POST', body: JSON.stringify({ licenceFileContents: raw }) },
        token ?? undefined,
      );
      setStatus(next);
      setSuccess(next.uiState === 'Licensed' ? 'PatrolSafe is now activated.' : next.message);
    } catch {
      setError('That licence file could not be activated. Confirm it belongs to this workstation and try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDeactivate(): Promise<void> {
    if (!window.confirm('Deactivate the licence on this workstation? Existing sites and evidence will be kept.')) return;
    setIsSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const next = await apiRequest<LicenseStatusResponse>(
        '/license/deactivate',
        { method: 'POST', body: JSON.stringify({}) },
        token ?? undefined,
      );
      setStatus(next);
      setSuccess('Licence deactivated. Existing data was preserved.');
    } catch {
      setError('The licence could not be deactivated. No company data was changed.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCopyInstallationId(): Promise<void> {
    if (!status?.installationId) return;
    try {
      await navigator.clipboard.writeText(status.installationId);
      setCopyMessage('Installation ID copied.');
    } catch {
      setCopyMessage('Select the installation ID and copy it manually.');
    }
  }

  async function handleImportLicenceFile(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const result = await readLocalLicenceFile(file).catch(() => ({ ok: false as const, error: 'The selected file could not be read.' }));
    if (!result.ok) {
      setError(result.error);
      return;
    }
    await handleImportAndActivate(result.key);
  }

  function handleManualImport(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const value = (event.currentTarget.elements.namedItem('licenceJson') as HTMLTextAreaElement | null)?.value;
    if (!value?.trim()) {
      setError('Paste the licence file contents or choose a licence file.');
      return;
    }
    void handleImportAndActivate(value.trim());
  }

  if (!desktop) {
    return <div className="page-shell narrow"><h1>Licence</h1><p>Licensing is managed in the installed PatrolSafe app.</p></div>;
  }

  const isTrial = status?.mode === 'trial' || status?.plan === 'trial' || status?.uiState === 'Trial Active';
  const isLicensed = status?.uiState === 'Licensed' || (status?.status === 'ACTIVE' && !isTrial);
  const isExpired = status?.uiState === 'Expired' || status?.status === 'EXPIRED';
  const stateLabel = isTrial ? 'Free trial' : isLicensed ? 'Licensed' : isExpired ? 'Trial expired' : 'Activation needed';
  const expiryLabel = status?.expiresAt
    ? formatPatrolDate(status.expiresAt)
    : isLicensed ? 'No expiry' : 'Not available';

  return (
    <div className="page-stack licence-page">
      <PageHeader
        eyebrow="Settings"
        title="Licence"
        subtitle="Review your trial or licence and activate PatrolSafe for this workstation. Your evidence remains protected if access expires."
      />
      {error ? <div className="banner banner-danger" role="alert">{error}</div> : null}
      {success ? <div className="banner banner-success" role="status">{success}</div> : null}

      <Card className={`licence-hero${isExpired ? ' licence-hero-danger' : ''}`}>
        <div className="licence-hero-copy">
          <StatusBadge value={stateLabel} />
          <h3>{stateLabel}</h3>
          <p className="licence-lead">
            {isTrial
              ? `${status?.daysRemaining ?? '—'} day${status?.daysRemaining === 1 ? '' : 's'} remaining`
              : isLicensed
                ? 'PatrolSafe is activated for this company.'
                : isExpired
                  ? 'Live operations are paused until PatrolSafe is activated. Existing evidence remains available.'
                  : 'Activate PatrolSafe to continue live patrol monitoring.'}
          </p>
          {!isTrial && !isLicensed && status?.message ? <p className="muted-text">{status.message}</p> : null}
        </div>
        <dl className="licence-summary">
          <div><dt>Company</dt><dd>{status?.companyName ?? 'Not set'}</dd></div>
          <div><dt>Expires</dt><dd>{expiryLabel}</dd></div>
          <div><dt>Plan</dt><dd>{isTrial ? 'Trial' : status?.plan ? status.plan.replace('_', ' ') : 'Not activated'}</dd></div>
        </dl>
      </Card>

      <div className="settings-grid">
        <Card className="action-card">
          <h3>Activate a licence</h3>
          <p className="muted-text">Select the PatrolSafe licence file supplied for this workstation.</p>
          <input ref={fileInputRef} type="file" accept={LICENCE_IMPORT_ACCEPT} hidden onChange={(event) => void handleImportLicenceFile(event)} />
          <div className="button-row">
            <button type="button" className="primary-button" disabled={isSubmitting} onClick={() => fileInputRef.current?.click()}>
              {isSubmitting ? 'Checking licence…' : 'Choose licence file'}
            </button>
            <a className="secondary-button" href={SUPPLIER_CONTACT}>Contact supplier</a>
          </div>
        </Card>

        <Card className="action-card">
          <h3>Request a licence</h3>
          <p className="muted-text">Annual subscription — £299 plus VAT where applicable for one Windows workstation per year. Renewal is manual.</p>
          <p className="muted-text">Create a request file for your PatrolSafe supplier. It contains workstation identity information but no passwords.</p>
          <label>Company name<input value={companyName} onChange={(event) => setCompanyName(event.target.value)} /></label>
          <div className="customer-detail-list"><strong>Licence term</strong><span>Annual</span></div>
          <button type="button" className="primary-button" disabled={isSubmitting || companyName.trim().length < 2} onClick={() => void handleExportRequest()}>
            Create licence request
          </button>
        </Card>
      </div>

      <Card>
        <details className="customer-details">
          <summary>Licence details</summary>
          <dl className="customer-detail-list">
            <div><dt>Installation ID</dt><dd className="breakable-value">{status?.installationId ?? 'Preparing…'}</dd></div>
            <div><dt>Licence ID</dt><dd>{status?.licenseId ?? 'Not activated'}</dd></div>
            <div><dt>Version</dt><dd>{status?.appVersion ?? '—'}{status?.buildId ? ` · build ${status.buildId}` : ''}</dd></div>
            <div><dt>Activated</dt><dd>{status?.activatedAt ? formatPatrolDate(status.activatedAt) : 'Not yet'}</dd></div>
          </dl>
          <div className="button-row">
            <button type="button" className="secondary-button" onClick={() => void handleCopyInstallationId()}>Copy installation ID</button>
            <button type="button" className="secondary-button" disabled={isSubmitting || status?.mode !== 'commercial'} onClick={() => void handleDeactivate()}>Deactivate licence</button>
            <button type="button" className="secondary-button" onClick={() => navigate('/settings/support')}>Open Support</button>
          </div>
          {copyMessage ? <p className="muted-text">{copyMessage}</p> : null}
          <details className="advanced-inline-details">
            <summary>Advanced licence import</summary>
            <form className="stack-form" onSubmit={handleManualImport}>
              <label>Paste licence file contents<textarea name="licenceJson" rows={5} /></label>
              <button type="submit" className="secondary-button" disabled={isSubmitting}>Import pasted licence</button>
            </form>
          </details>
        </details>
      </Card>

      {status?.status === 'ACTIVE' && token ? (
        <div className="button-row"><button type="button" className="primary-button" onClick={() => navigate('/')}>Continue to dashboard</button></div>
      ) : null}
    </div>
  );
}
