import { ChangeEvent, FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiRequest } from '../lib/api';
import { isDesktopApp } from '../lib/desktop';
import { LICENCE_IMPORT_ACCEPT, readLocalLicenceFile } from '../lib/licence-file-import';
import { useAuth } from '../state/auth';
import type { LicenseStatusResponse } from '../types';
import { StatusBadge } from '../components/ui';

const SUPPLIER_CONTACT = 'mailto:support@techguards.co.uk?subject=Patrol%20Evidence%20Platform%20Licence';

export function LicensePage(): JSX.Element {
  const navigate = useNavigate();
  const { token } = useAuth();
  const desktop = isDesktopApp();
  const [status, setStatus] = useState<LicenseStatusResponse | null>(null);
  const [companyName, setCompanyName] = useState('');
  const [requestedPlan, setRequestedPlan] = useState<'annual' | 'three_year' | 'lifetime'>('annual');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadStatus = useCallback(async () => {
    const next = await apiRequest<LicenseStatusResponse>('/license/status', {}, token ?? undefined);
    setStatus(next);
    if (next.companyName) {
      setCompanyName(next.companyName);
    }
    return next;
  }, [token]);

  useEffect(() => {
    void loadStatus().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : 'Could not load licence status.');
    });
  }, [loadStatus]);

  async function handleExportRequest(): Promise<void> {
    setIsSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const result = await apiRequest<{ fileName: string; contents: string }>(
        '/license/request-file',
        {
          method: 'POST',
          body: JSON.stringify({ companyName: companyName.trim(), requestedPlan }),
        },
        token ?? undefined,
      );

      const blob = new Blob([result.contents], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = result.fileName;
      anchor.click();
      URL.revokeObjectURL(url);
      setSuccess('Licence request file (.tgreq) downloaded. Send it to your supplier.');
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : 'Could not export request file.');
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
        {
          method: 'POST',
          body: JSON.stringify({ licenceFileContents: raw }),
        },
        token ?? undefined,
      );
      setStatus(next);
      setSuccess(next.uiState === 'Licensed' ? 'Commercial licence imported successfully.' : next.message);
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : 'Licence import failed.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDeactivate(): Promise<void> {
    const confirmed = window.confirm(
      'Deactivate the commercial licence on this workstation? Evidence, configuration, database and images will be kept.',
    );
    if (!confirmed) {
      return;
    }

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
      setSuccess('Commercial licence deactivated. Existing data was preserved.');
    } catch (deactivateError) {
      setError(deactivateError instanceof Error ? deactivateError.message : 'Could not deactivate licence.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCopyInstallationId(): Promise<void> {
    if (!status?.installationId) {
      return;
    }

    try {
      await navigator.clipboard.writeText(status.installationId);
      setCopyMessage('Installation ID copied.');
    } catch {
      setCopyMessage('Could not copy automatically. Select and copy the installation ID manually.');
    }
  }

  async function handleImportLicenceFile(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }

    setError(null);
    setSuccess(null);

    try {
      const result = await readLocalLicenceFile(file);
      if (!result.ok) {
        setError(result.error);
        return;
      }

      await handleImportAndActivate(result.key);
    } catch {
      setError('Could not read the selected licence file.');
    }
  }

  function handleManualImport(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const textarea = (event.currentTarget.elements.namedItem('licenceJson') as HTMLTextAreaElement | null)
      ?.value;
    if (!textarea?.trim()) {
      setError('Paste a .tglic JSON licence or use Import licence file.');
      return;
    }
    void handleImportAndActivate(textarea.trim());
  }

  if (!desktop) {
    return (
      <div className="page-shell narrow">
        <h1>Licence</h1>
        <p className="muted-text">Commercial licensing applies to the installed desktop application only.</p>
      </div>
    );
  }

  const uiState = status?.uiState ?? status?.displayMode ?? 'Loading';

  return (
    <div className="page-shell narrow">
      <div className="page-header">
        <div>
          <p className="eyebrow">Commercial Licence</p>
          <h1>Workstation licence</h1>
          <p className="muted-text">
            Offline licensing for this installation. Evidence, configuration, database and images are always preserved
            when a trial or licence expires.
          </p>
        </div>
        <StatusBadge value={uiState} />
      </div>

      <section className="panel-grid">
        <article className="panel">
          <h2>Current status</h2>
          <dl className="detail-list">
            <div>
              <dt>State</dt>
              <dd>{uiState}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{status?.status ?? '—'}</dd>
            </div>
            <div>
              <dt>Licensed company</dt>
              <dd>{status?.companyName ?? '—'}</dd>
            </div>
            <div>
              <dt>Plan</dt>
              <dd>{status?.plan ?? '—'}</dd>
            </div>
            <div>
              <dt>Licence ID</dt>
              <dd>{status?.licenseId ?? '—'}</dd>
            </div>
            <div>
              <dt>Start date</dt>
              <dd>{status?.startsAt ?? '—'}</dd>
            </div>
            <div>
              <dt>Expiry date</dt>
              <dd>{status?.expiresAt ?? (status?.uiState === 'Licensed' ? 'Lifetime' : '—')}</dd>
            </div>
            <div>
              <dt>Days remaining</dt>
              <dd>
                {status?.status === 'ACTIVE' || status?.status === 'TRIAL_ACTIVE'
                  ? status.expiresAt
                    ? status.daysRemaining
                    : 'Lifetime'
                  : '—'}
              </dd>
            </div>
            <div>
              <dt>Build</dt>
              <dd>
                {status?.appVersion ?? '—'}
                {status?.buildId ? ` (${status.buildId})` : ''}
              </dd>
            </div>
          </dl>
          <p className="muted-text">{status?.message}</p>
          {status?.diagnostics?.lastTrialBootstrapError ? (
            <div className="frontend-diagnostics-log" style={{ marginTop: 12 }}>
              <p className="muted-text">Licence bootstrap diagnostic</p>
              <pre>{status.diagnostics.lastTrialBootstrapError}</pre>
              <pre>
                {[
                  `dataRoot=${status.diagnostics.dataRoot ?? 'null'}`,
                  `trialFile=${status.diagnostics.trialFilePath ?? 'null'}`,
                  `markerPresent=${status.diagnostics.trialMarkerPresent}`,
                  `writable=${String(status.diagnostics.licensingDirectoryWritable)}`,
                  `crypto=${status.diagnostics.cryptoMode}`,
                  `trialCreationDisabled=${status.diagnostics.trialCreationDisabled}`,
                ].join('\n')}
              </pre>
            </div>
          ) : null}
        </article>

        <article className="panel">
          <h2>Installation</h2>
          <p className="muted-text">Share this installation ID with your supplier when requesting a licence.</p>
          <div className="frontend-diagnostics-log">
            <pre>{status?.installationId ?? 'Generating installation ID…'}</pre>
          </div>
          <div className="button-row">
            <button type="button" className="secondary-button" onClick={() => void handleCopyInstallationId()}>
              Copy installation ID
            </button>
            {token ? (
              <button type="button" className="secondary-button" onClick={() => navigate('/settings/diagnostics')}>
                Open diagnostics
              </button>
            ) : (
              <button type="button" className="secondary-button" onClick={() => navigate('/login')}>
                Sign in
              </button>
            )}
          </div>
          {copyMessage ? <p className="muted-text">{copyMessage}</p> : null}
        </article>
      </section>

      <section className="panel">
        <h2>Export licence request</h2>
        <p className="muted-text">
          Creates a `.tgreq` file with installation ID and machine fingerprint only — no secrets.
        </p>
        <div className="stack-form">
          <label>
            Company name
            <input value={companyName} onChange={(event) => setCompanyName(event.target.value)} />
          </label>
          <label>
            Requested plan
            <select
              value={requestedPlan}
              onChange={(event) => setRequestedPlan(event.target.value as typeof requestedPlan)}
            >
              <option value="annual">Annual</option>
              <option value="three_year">Three year</option>
              <option value="lifetime">Lifetime</option>
            </select>
          </label>
          <button
            type="button"
            className="primary-button"
            disabled={isSubmitting || companyName.trim().length < 2}
            onClick={() => void handleExportRequest()}
          >
            Export request file (.tgreq)
          </button>
        </div>
      </section>

      <section className="panel">
        <h2>Import commercial licence</h2>
        <form className="stack-form" onSubmit={handleManualImport}>
          <label>
            Paste `.tglic` JSON
            <textarea name="licenceJson" rows={6} placeholder='{"payload":{...},"signature":"..."}' />
          </label>
          <input
            ref={fileInputRef}
            type="file"
            accept={LICENCE_IMPORT_ACCEPT}
            hidden
            onChange={(event) => void handleImportLicenceFile(event)}
          />
          {error ? <p className="form-error">{error}</p> : null}
          {success ? <p className="muted-text">{success}</p> : null}
          <div className="button-row">
            <button type="submit" className="primary-button" disabled={isSubmitting}>
              {isSubmitting ? 'Working…' : 'Import pasted licence'}
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={isSubmitting}
              onClick={() => fileInputRef.current?.click()}
            >
              Import .tglic file
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={isSubmitting || status?.mode !== 'commercial'}
              onClick={() => void handleDeactivate()}
            >
              Deactivate commercial licence
            </button>
            <a className="secondary-button" href={SUPPLIER_CONTACT}>
              Contact supplier
            </a>
          </div>
        </form>
      </section>

      {status?.status === 'ACTIVE' && token ? (
        <div className="button-row">
          <button type="button" className="primary-button" onClick={() => navigate('/')}>
            Continue to dashboard
          </button>
        </div>
      ) : null}
    </div>
  );
}
