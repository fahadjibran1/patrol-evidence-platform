import { FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiRequest } from '../lib/api';
import { useAuth } from '../state/auth';
import type { Site } from '../types';
import { Card, EmptyState, PageHeader, StatusBadge } from '../components/ui';

export function SitesPage(): JSX.Element {
  const navigate = useNavigate();
  const { token, user } = useAuth();
  const [sites, setSites] = useState<Site[]>([]);
  const [siteCode, setSiteCode] = useState('');
  const [siteName, setSiteName] = useState('');
  const [clientName, setClientName] = useState('');
  const [editingSiteId, setEditingSiteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function loadSites(): Promise<void> {
    const nextSites = await apiRequest<Site[]>('/sites', {}, token ?? undefined);
    setSites(nextSites);
  }

  useEffect(() => {
    void loadSites().catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Check your setup and try again.'));
  }, [token]);

  function resetForm(): void {
    setEditingSiteId(null);
    setSiteCode('');
    setSiteName('');
    setClientName('');
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setIsSaving(true);
    setError(null);

    try {
      await apiRequest<Site>(
        editingSiteId ? `/sites/${editingSiteId}` : '/sites',
        {
          method: editingSiteId ? 'PATCH' : 'POST',
          body: JSON.stringify({
            siteCode,
            siteName,
            clientName: clientName || undefined,
            active: true,
          }),
        },
        token ?? undefined,
      );

      resetForm();
      await loadSites();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Check your setup and try again.');
    } finally {
      setIsSaving(false);
    }
  }

  async function toggleSite(site: Site): Promise<void> {
    setIsSaving(true);
    setError(null);

    try {
      await apiRequest<Site>(
        `/sites/${site.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            active: !site.active,
          }),
        },
        token ?? undefined,
      );
      await loadSites();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Check your setup and try again.');
    } finally {
      setIsSaving(false);
    }
  }

  if (user?.role === 'GUARD') {
    return (
      <EmptyState
        title="Site management is for admins"
        description="Guards can still see site-linked work in Patrol Ops, Incidents, and Alerts."
      />
    );
  }

  return (
    <div className="page-stack">
      <PageHeader title="Sites" subtitle="Create and manage the places where patrol activity is tracked." />

      <div className="two-column-grid">
        <Card>
          <h3>{editingSiteId ? 'Edit Site' : 'Create Site'}</h3>
          <form className="form-grid" onSubmit={handleSubmit}>
            <label>
              Site Code
              <input value={siteCode} onChange={(event) => setSiteCode(event.target.value)} maxLength={20} required />
            </label>
            <label>
              Site Name
              <input value={siteName} onChange={(event) => setSiteName(event.target.value)} maxLength={120} required />
            </label>
            <label>
              Client Name
              <input value={clientName} onChange={(event) => setClientName(event.target.value)} maxLength={120} />
            </label>
            {error ? <p className="error-text">Something went wrong. {error}</p> : null}
            <div className="button-row">
              <button type="submit" className="primary-button" disabled={isSaving}>
                {isSaving ? 'Saving...' : editingSiteId ? 'Save Site' : 'Create Site'}
              </button>
              {editingSiteId ? (
                <button type="button" className="secondary-button" onClick={resetForm}>
                  Cancel
                </button>
              ) : null}
            </div>
          </form>
        </Card>

        <Card>
          <h3>Sites</h3>
          {sites.length === 0 ? (
            <div className="stack-list">
              <p className="muted-text">Create your first site to start tracking patrol activity.</p>
              <button type="button" className="secondary-button" onClick={() => navigate('/setup')}>
                Open Setup
              </button>
            </div>
          ) : (
            <div className="stack-list">
              {sites.map((site) => (
                <div key={site.id} className="list-row">
                  <div>
                    <strong>{site.siteCode}</strong>
                    <p>{site.siteName}</p>
                    <p>{site.clientName || 'No client assigned'}</p>
                  </div>
                  <div className="button-row">
                    <StatusBadge value={site.active} />
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => {
                        setEditingSiteId(site.id);
                        setSiteCode(site.siteCode);
                        setSiteName(site.siteName);
                        setClientName(site.clientName ?? '');
                        setError(null);
                      }}
                    >
                      Edit
                    </button>
                    <button type="button" className="secondary-button" disabled={isSaving} onClick={() => void toggleSite(site)}>
                      {site.active ? 'Deactivate' : 'Activate'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
