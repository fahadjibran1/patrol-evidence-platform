import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiRequest } from '../lib/api';
import { isDesktopApp } from '../lib/desktop';
import { useAuth } from '../state/auth';
import type { LicenseStatusResponse } from '../types';
import { StatusBadge } from '../components/ui';

const SUPPLIER_CONTACT = 'mailto:support@techguards.co.uk?subject=Patrol%20Evidence%20Platform%20Licence';

export function LicensePage(): JSX.Element {
  const navigate = useNavigate();
  const { token } = useAuth();
  const desktop = isDesktopApp();
  const [status, setStatus] = useState<LicenseStatusResponse | null>(null);
  const [licenseKey, setLicenseKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    const next = await apiRequest<LicenseStatusResponse>('/license/status', {}, token ?? undefined);
    setStatus(next);
    return next;
  }, [token]);

  useEffect(() => {
    void loadStatus().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : 'Could not load licence status.');
    });
  }, [loadStatus]);

  async function handleActivate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const next = await apiRequest<LicenseStatusResponse>(
        '/license/activate',
        {
          method: 'POST',
          body: JSON.stringify({ licenseKey: licenseKey.trim() }),
        },
        token ?? undefined,
      );
      setStatus(next);
      setLicenseKey('');
      setSuccess(next.status === 'ACTIVE' ? 'Licence activated successfully.' : next.message);
    } catch (activateError) {
      setError(activateError instanceof Error ? activateError.message : 'Licence activation failed.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDeactivate(): Promise<void> {
    const confirmed = window.confirm(
      'Deactivate this licence on this workstation? Your evidence, sites, mappings, and WhatsApp session will be kept.',
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
      setSuccess('Licence deactivated. Enter a new licence key to restore full operation.');
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

  if (!desktop) {
    return (
      <div className="page-shell narrow">
        <h1>Licence</h1>
        <p className="muted-text">Commercial licensing applies to the installed desktop application only.</p>
      </div>
    );
  }

  return (
    <div className="page-shell narrow">
      <div className="page-header">
        <div>
          <p className="eyebrow">Commercial Licence</p>
          <h1>Workstation licence</h1>
          <p className="muted-text">
            Activate, review, or deactivate the signed offline licence for this installation. Evidence and configuration
            are kept when a licence expires or is deactivated.
          </p>
        </div>
        <StatusBadge value={status?.status ?? 'Loading'} />
      </div>

      <section className="panel-grid">
        <article className="panel">
          <h2>Current status</h2>
          <dl className="detail-list">
            <div>
              <dt>Status</dt>
              <dd>{status?.status ?? '—'}</dd>
            </div>
            <div>
              <dt>Mode</dt>
              <dd>{status?.displayMode ?? '—'}</dd>
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
              <dd>{status?.expiresAt ?? '—'}</dd>
            </div>
            <div>
              <dt>Days remaining</dt>
              <dd>{status?.status === 'ACTIVE' ? status.daysRemaining : '—'}</dd>
            </div>
            {status?.legacy ? (
              <div>
                <dt>Legacy key</dt>
                <dd>Yes — migrate to a TG1 commercial licence before legacy support ends.</dd>
              </div>
            ) : null}
          </dl>
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
        <h2>Activate licence</h2>
        <form className="stack-form" onSubmit={(event) => void handleActivate(event)}>
          <label>
            Licence key
            <textarea
              rows={4}
              value={licenseKey}
              onChange={(event) => setLicenseKey(event.target.value)}
              placeholder="TG1...."
            />
          </label>
          {error ? <p className="form-error">{error}</p> : null}
          {success ? <p className="muted-text">{success}</p> : null}
          <div className="button-row">
            <button type="submit" className="primary-button" disabled={isSubmitting || !licenseKey.trim()}>
              {isSubmitting ? 'Working…' : 'Activate licence'}
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={isSubmitting || status?.status === 'NOT_ACTIVATED'}
              onClick={() => void handleDeactivate()}
            >
              Deactivate licence
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
