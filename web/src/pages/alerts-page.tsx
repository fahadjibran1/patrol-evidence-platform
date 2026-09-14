import { FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiRequest } from '../lib/api';
import { customerErrorMessage } from '../lib/customer-errors';
import { useAuth } from '../state/auth';
import type { PatrolAlert, Site } from '../types';
import { Card, PageHeader, StatusBadge } from '../components/ui';
import { formatPatrolDateTime } from '../lib/patrol-time';

export function AlertsPage(): JSX.Element {
  const navigate = useNavigate();
  const { token, user } = useAuth();
  const [sites, setSites] = useState<Site[]>([]);
  const [alerts, setAlerts] = useState<PatrolAlert[]>([]);
  const [siteId, setSiteId] = useState('');
  const [alertType, setAlertType] = useState<PatrolAlert['alertType']>('WELFARE');
  const [alertMessage, setAlertMessage] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function loadData(): Promise<void> {
    const [nextAlerts, nextSites] = await Promise.all([
      apiRequest<PatrolAlert[]>('/patrol-alerts', {}, token ?? undefined),
      apiRequest<Site[]>('/sites', {}, token ?? undefined),
    ]);
    setAlerts(nextAlerts);
    setSites(nextSites);

    if (!siteId && nextSites[0]) {
      setSiteId(nextSites[0].id);
    }
  }

  useEffect(() => {
    loadData().catch((loadError) => setError(customerErrorMessage(loadError, 'Alerts could not be loaded. Try again.')));
  }, [token]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);

    try {
      await apiRequest(
        '/patrol-alerts',
        {
          method: 'POST',
          body: JSON.stringify({ siteId, alertType, alertMessage }),
        },
        token ?? undefined,
      );
      setAlertMessage('');
      setAlertType('WELFARE');
      await loadData();
    } catch (submissionError) {
      setError(customerErrorMessage(submissionError, 'The alert could not be created. Check the details and try again.'));
    }
  }

  async function resolveAlert(alertId: string): Promise<void> {
    setError(null);
    try {
      await apiRequest(`/patrol-alerts/${alertId}/resolve`, { method: 'PATCH' }, token ?? undefined);
      await loadData();
    } catch (resolveError) {
      setError(customerErrorMessage(resolveError, 'The alert could not be resolved. Try again.'));
    }
  }

  return (
    <div className="page-stack">
      <PageHeader
        title="Alerts"
        subtitle="Review welfare and emergency alerts raised during patrol activity."
      />
      {error ? <Card><p className="error-text">Something went wrong. {error}</p></Card> : null}

      <div className="two-column-grid">
        <Card>
          <h3>Trigger Alert</h3>
          {user?.role === 'GUARD' ? (
            <form className="form-grid" onSubmit={handleSubmit}>
              <label>
                Site
                <select value={siteId} onChange={(event) => setSiteId(event.target.value)} required>
                  <option value="">Select site</option>
                  {sites.map((site) => (
                    <option key={site.id} value={site.id}>
                      {site.siteCode} - {site.siteName}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Alert Type
                <select
                  value={alertType}
                  onChange={(event) => setAlertType(event.target.value as PatrolAlert['alertType'])}
                >
                  <option value="WELFARE">WELFARE</option>
                  <option value="EMERGENCY">EMERGENCY</option>
                </select>
              </label>
              <label>
                Message
                <textarea value={alertMessage} onChange={(event) => setAlertMessage(event.target.value)} required />
              </label>
              <button type="submit" className="primary-button">Trigger Alert</button>
            </form>
          ) : (
            <p className="muted-text">Alerts raised by guards appear here for review and follow-up.</p>
          )}
        </Card>

        <Card>
          <h3>Alert Queue</h3>
          {alerts.length === 0 ? (
            <div className="stack-list">
              <strong>No reports yet</strong>
              <p className="muted-text">
                No alerts have been raised. Patrol activity will appear here if guards send a welfare or emergency alert.
              </p>
            </div>
          ) : (
            <div className="stack-list">
              {alerts.map((alert) => (
                <div key={alert.id} className="incident-card">
                  <div className="incident-header">
                    <div>
                      <strong>{alert.site?.siteCode ?? alert.siteId}</strong>
                      <p>{formatPatrolDateTime(alert.alertTime)}</p>
                    </div>
                    <div className="badge-row">
                      <StatusBadge value={alert.alertType} />
                      <StatusBadge value={alert.isResolved ? 'RESOLVED' : 'OPEN'} />
                    </div>
                  </div>
                  <p>{alert.alertMessage}</p>
                  {!alert.isResolved && user?.role !== 'GUARD' ? (
                    <button type="button" className="secondary-button" onClick={() => resolveAlert(alert.id)}>
                      Mark as resolved
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          )}
          {alerts.length === 0 ? (
            <button type="button" className="secondary-button" onClick={() => navigate('/patrol')}>
              View Patrol Ops
            </button>
          ) : null}
        </Card>
      </div>
    </div>
  );
}
