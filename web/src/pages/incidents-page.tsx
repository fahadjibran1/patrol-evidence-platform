import { FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiRequest } from '../lib/api';
import { customerErrorMessage } from '../lib/customer-errors';
import { useAuth } from '../state/auth';
import type { Incident, Site } from '../types';
import { Card, PageHeader, StatusBadge } from '../components/ui';
import { formatPatrolDateTime } from '../lib/patrol-time';

export function IncidentsPage(): JSX.Element {
  const navigate = useNavigate();
  const { token, user } = useAuth();
  const [sites, setSites] = useState<Site[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [siteId, setSiteId] = useState('');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState<Incident['severity']>('MEDIUM');
  const [error, setError] = useState<string | null>(null);

  async function loadData(): Promise<void> {
    const [nextIncidents, nextSites] = await Promise.all([
      apiRequest<Incident[]>('/incidents', {}, token ?? undefined),
      apiRequest<Site[]>('/sites', {}, token ?? undefined),
    ]);
    setIncidents(nextIncidents);
    setSites(nextSites);

    if (!siteId && nextSites[0]) {
      setSiteId(nextSites[0].id);
    }
  }

  useEffect(() => {
    loadData().catch((loadError) => setError(customerErrorMessage(loadError, 'Incidents could not be loaded. Try again.')));
  }, [token]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);

    try {
      await apiRequest(
        '/incidents',
        {
          method: 'POST',
          body: JSON.stringify({ siteId, description, severity }),
        },
        token ?? undefined,
      );
      setDescription('');
      setSeverity('MEDIUM');
      await loadData();
    } catch (submissionError) {
      setError(customerErrorMessage(submissionError, 'The incident could not be created. Check the details and try again.'));
    }
  }

  async function updateStatus(incidentId: string, status: Incident['status']): Promise<void> {
    setError(null);
    try {
      await apiRequest(
        `/incidents/${incidentId}/status`,
        {
          method: 'PATCH',
          body: JSON.stringify({ status }),
        },
        token ?? undefined,
      );
      await loadData();
    } catch (updateError) {
      setError(customerErrorMessage(updateError, 'The incident could not be updated. Try again.'));
    }
  }

  return (
    <div className="page-stack">
      <PageHeader
        title="Incidents"
        subtitle="Review incidents reported during patrol activity."
      />
      {error ? <Card><p className="error-text">Something went wrong. {error}</p></Card> : null}

      <div className="two-column-grid">
        <Card>
          <h3>Report incident</h3>
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
              Severity
              <select value={severity} onChange={(event) => setSeverity(event.target.value as Incident['severity'])}>
                <option value="LOW">LOW</option>
                <option value="MEDIUM">MEDIUM</option>
                <option value="HIGH">HIGH</option>
                <option value="CRITICAL">CRITICAL</option>
              </select>
            </label>
            <label>
              Description
              <textarea value={description} onChange={(event) => setDescription(event.target.value)} required />
            </label>
            <button type="submit" className="primary-button">Save incident</button>
          </form>
        </Card>

        <Card>
          <h3>Incident queue</h3>
          {incidents.length === 0 ? (
            <div className="stack-list">
              <strong>No reports yet</strong>
              <p className="muted-text">No incidents have been reported. Check your setup and try again if you expected activity here.</p>
              <button type="button" className="secondary-button" onClick={() => navigate('/patrol')}>
                View Patrol Ops
              </button>
            </div>
          ) : (
            <div className="stack-list">
              {incidents.map((incident) => (
                <div key={incident.id} className="incident-card">
                  <div className="incident-header">
                    <div>
                      <strong>{incident.site?.siteCode ?? incident.siteId}</strong>
                      <p>{formatPatrolDateTime(incident.createdAt)}</p>
                    </div>
                    <div className="badge-row">
                      <StatusBadge value={incident.severity} />
                      <StatusBadge value={incident.status} />
                    </div>
                  </div>
                  <p>{incident.description}</p>
                  {user?.role !== 'GUARD' ? (
                    <label className="inline-field">
                      <span>Status</span>
                      <select
                        value={incident.status}
                        onChange={(event) => updateStatus(incident.id, event.target.value as Incident['status'])}
                      >
                        <option value="OPEN">OPEN</option>
                        <option value="IN_REVIEW">IN_REVIEW</option>
                        <option value="RESOLVED">RESOLVED</option>
                      </select>
                    </label>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
