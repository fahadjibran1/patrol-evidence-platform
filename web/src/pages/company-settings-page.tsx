import { FormEvent, useEffect, useState } from 'react';
import { apiRequest } from '../lib/api';
import { beginDesktopAdminRecovery, getDesktopState, saveDesktopConfig } from '../lib/desktop';
import { useAuth } from '../state/auth';
import type { DesktopBootstrapStatus } from '../types';
import { Card, PageHeader } from '../components/ui';
import {
  formatTimeZoneLabel,
  getWorkspaceTimeZone,
  listSupportedTimeZones,
  setWorkspaceTimeZone,
} from '../lib/patrol-time';

const SUPPORTED_TIME_ZONES = listSupportedTimeZones();

export function CompanySettingsPage(): JSX.Element {
  const { token, user } = useAuth();
  const [status, setStatus] = useState<DesktopBootstrapStatus | null>(null);
  const [workspaceName, setWorkspaceName] = useState('');
  const [autoLaunchApp, setAutoLaunchApp] = useState(false);
  const [appTimeZone, setAppTimeZone] = useState(getWorkspaceTimeZone());
  const [savedTimeZone, setSavedTimeZone] = useState(getWorkspaceTimeZone());
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timeZoneOptions = SUPPORTED_TIME_ZONES.includes(appTimeZone)
    ? SUPPORTED_TIME_ZONES
    : [appTimeZone, ...SUPPORTED_TIME_ZONES];

  useEffect(() => {
    if (!token) return;

    void Promise.all([
      apiRequest<DesktopBootstrapStatus>('/desktop/bootstrap/status', {}, token),
      getDesktopState(),
    ])
      .then(([nextStatus, desktopState]) => {
        setStatus(nextStatus);
        setWorkspaceName(desktopState?.config.workspaceName ?? nextStatus.workspaceName ?? '');
        setAutoLaunchApp(desktopState?.config.autoLaunchApp === true);
        const nextTimeZone = desktopState?.config.appTimeZone ?? nextStatus.appTimeZone;
        if (nextTimeZone) {
          setAppTimeZone(nextTimeZone);
          setSavedTimeZone(nextTimeZone);
        }
      })
      .catch(() => setError('Company settings could not be loaded. Try again.'));
  }, [token]);

  async function saveCompanySettings(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    setMessage(null);
    try {
      if (
        appTimeZone !== savedTimeZone &&
        !window.confirm(
          'Change the workspace time zone? Historical evidence timestamps stay unchanged, but date grouping and patrol schedule interpretation may change.',
        )
      ) {
        setIsSaving(false);
        return;
      }
      await saveDesktopConfig({ workspaceName: workspaceName.trim(), autoLaunchApp, appTimeZone });
      setWorkspaceTimeZone(appTimeZone);
      setSavedTimeZone(appTimeZone);
      setMessage('Company settings saved.');
    } catch {
      setError('Company settings could not be saved. Your existing settings are unchanged.');
    } finally {
      setIsSaving(false);
    }
  }

  async function changeAdminPassword(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setMessage(null);

    if (newPassword.length < 8) {
      setError('Choose a password with at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('The new passwords do not match.');
      return;
    }
    if (!window.confirm('Change the local administrator password for this workstation?')) return;

    setIsSaving(true);
    try {
      const recoveryToken = await beginDesktopAdminRecovery();
      if (!recoveryToken) return;
      await apiRequest(
        '/desktop/bootstrap/reset-admin-password',
        {
          method: 'POST',
          headers: { 'X-PatrolSafe-Recovery-Token': recoveryToken },
          body: JSON.stringify({ newPassword, confirmPassword, confirmed: true }),
        },
        token ?? undefined,
      );
      setNewPassword('');
      setConfirmPassword('');
      setMessage('Administrator password changed. Use the new password next time you sign in.');
    } catch {
      setError('The password was not changed. Authorise the request and try again.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="page-stack settings-page">
      <PageHeader
        eyebrow="Settings"
        title="Company settings"
        subtitle="Manage this workstation's name and administrator access. Your company identity and evidence stay protected."
      />

      {error ? <div className="banner banner-danger" role="alert">{error}</div> : null}
      {message ? <div className="banner banner-success" role="status">{message}</div> : null}

      <div className="settings-grid">
        <Card>
          <h3>Company identity</h3>
          <p className="muted-text">These details identify the existing PatrolSafe workspace.</p>
          <dl className="customer-detail-list">
            <div><dt>Company</dt><dd>{status?.companyName ?? 'Loading…'}</dd></div>
            <div><dt>Administrator</dt><dd>{status?.localAdminEmail ?? user?.email ?? 'Loading…'}</dd></div>
          </dl>
          <p className="help-text">Contact support before changing the legal company identity for an activated licence.</p>
        </Card>

        <Card>
          <h3>Workstation preferences</h3>
          <form className="form-grid" onSubmit={saveCompanySettings}>
            <label>
              Workspace name
              <input
                value={workspaceName}
                onChange={(event) => setWorkspaceName(event.target.value)}
                maxLength={120}
                required
              />
            </label>
            <label className="checkbox-inline setting-checkbox">
              <input
                type="checkbox"
                checked={autoLaunchApp}
                onChange={(event) => setAutoLaunchApp(event.target.checked)}
              />
              Open PatrolSafe when I sign in to Windows
            </label>
            <label>
              Time zone
              <select value={appTimeZone} onChange={(event) => setAppTimeZone(event.target.value)} required>
                {timeZoneOptions.map((timeZone) => (
                  <option key={timeZone} value={timeZone}>{formatTimeZoneLabel(timeZone)}</option>
                ))}
              </select>
              <span className="help-text">
                PatrolSafe uses this time zone for patrol schedules, evidence dates and daily reporting.
              </span>
            </label>
            <button type="submit" className="primary-button" disabled={isSaving}>
              {isSaving ? 'Saving…' : 'Save settings'}
            </button>
          </form>
        </Card>
      </div>

      <Card className="security-action-card">
        <div>
          <p className="eyebrow">Security</p>
          <h3>Change administrator password</h3>
          <p className="muted-text">This is a separate, confirmed action. Existing sites, evidence and WhatsApp mappings are not changed.</p>
        </div>
        <form className="form-grid security-action-form" onSubmit={changeAdminPassword}>
          <label>
            New password
            <input
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              minLength={8}
              autoComplete="new-password"
              required
            />
          </label>
          <label>
            Confirm new password
            <input
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              minLength={8}
              autoComplete="new-password"
              required
            />
          </label>
          <button type="submit" className="secondary-button" disabled={isSaving}>Change password</button>
        </form>
      </Card>
    </div>
  );
}
