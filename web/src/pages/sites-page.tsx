import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiRequest } from '../lib/api';
import { useAuth } from '../state/auth';
import type { Site } from '../types';
import { Card, EmptyState, PageHeader, StatusBadge } from '../components/ui';

interface ArchivePreview {
  siteId: string;
  siteCode: string;
  siteName: string;
  mappedGroups: number;
  schedules: number;
  patrolImages: number;
  patrolSlots: number;
}

export function SitesPage(): JSX.Element {
  const navigate = useNavigate();
  const { token, user } = useAuth();
  const [sites, setSites] = useState<Site[]>([]);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [siteCode, setSiteCode] = useState('');
  const [siteName, setSiteName] = useState('');
  const [clientName, setClientName] = useState('');
  const [editingSiteId, setEditingSiteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<Site | null>(null);
  const [archivePreview, setArchivePreview] = useState<ArchivePreview | null>(null);
  const [confirmCode, setConfirmCode] = useState('');
  const [archiveReason, setArchiveReason] = useState('');

  const activeSites = useMemo(() => sites.filter((site) => !site.archivedAt), [sites]);
  const archivedSites = useMemo(() => sites.filter((site) => Boolean(site.archivedAt)), [sites]);

  async function loadSites(): Promise<void> {
    const path = includeArchived ? '/sites?includeArchived=true' : '/sites';
    const nextSites = await apiRequest<Site[]>(path, {}, token ?? undefined);
    setSites(nextSites);
  }

  useEffect(() => {
    void loadSites().catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Check your setup and try again.'));
  }, [token, includeArchived]);

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
    if (site.archivedAt) {
      return;
    }

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

  async function openArchiveDialog(site: Site): Promise<void> {
    setError(null);
    setConfirmCode('');
    setArchiveReason('');
    setArchiveTarget(site);
    try {
      const preview = await apiRequest<ArchivePreview>(`/sites/${site.id}/archive-preview`, {}, token ?? undefined);
      setArchivePreview(preview);
    } catch (previewError) {
      setArchiveTarget(null);
      setError(previewError instanceof Error ? previewError.message : 'Unable to load archive preview.');
    }
  }

  async function confirmArchive(): Promise<void> {
    if (!archiveTarget || !archivePreview) {
      return;
    }

    if (confirmCode.trim().toUpperCase() !== archivePreview.siteCode.toUpperCase()) {
      setError(`Type ${archivePreview.siteCode} exactly to confirm archive.`);
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      await apiRequest<Site>(
        `/sites/${archiveTarget.id}`,
        {
          method: 'DELETE',
          body: JSON.stringify({
            reason: archiveReason || undefined,
            confirmSiteCode: confirmCode,
          }),
        },
        token ?? undefined,
      );
      setArchiveTarget(null);
      setArchivePreview(null);
      setConfirmCode('');
      setIncludeArchived(true);
      await loadSites();
    } catch (archiveError) {
      setError(archiveError instanceof Error ? archiveError.message : 'Unable to archive site.');
    } finally {
      setIsSaving(false);
    }
  }

  async function restoreSite(site: Site): Promise<void> {
    setIsSaving(true);
    setError(null);
    try {
      await apiRequest<Site>(`/sites/${site.id}/restore`, { method: 'POST', body: '{}' }, token ?? undefined);
      await loadSites();
    } catch (restoreError) {
      setError(restoreError instanceof Error ? restoreError.message : 'Unable to restore site.');
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
          <div className="section-header">
            <h3>Sites</h3>
            <label className="checkbox-inline">
              <input
                type="checkbox"
                checked={includeArchived}
                onChange={(event) => setIncludeArchived(event.target.checked)}
              />
              Include archived
            </label>
          </div>
          {activeSites.length === 0 ? (
            <div className="stack-list">
              <p className="muted-text">Create your first site to start tracking patrol activity.</p>
              <button type="button" className="secondary-button" onClick={() => navigate('/setup')}>
                Open Setup
              </button>
            </div>
          ) : (
            <div className="stack-list">
              {activeSites.map((site) => (
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
                    <button
                      type="button"
                      className="danger-button"
                      disabled={isSaving}
                      onClick={() => void openArchiveDialog(site)}
                    >
                      Archive
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {includeArchived && archivedSites.length > 0 ? (
            <div className="stack-list stack-list-spaced">
              <h4>Archived sites</h4>
              <p className="muted-text">Historical evidence is retained. Monitoring is stopped until restore.</p>
              {archivedSites.map((site) => (
                <div key={site.id} className="list-row">
                  <div>
                    <strong>{site.siteCode}</strong>
                    <p>{site.siteName}</p>
                    <p className="muted-text">Archived {site.archivedAt ? new Date(site.archivedAt).toLocaleString() : ''}</p>
                  </div>
                  <div className="button-row">
                    <button type="button" className="secondary-button" disabled={isSaving} onClick={() => void restoreSite(site)}>
                      Restore
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </Card>
      </div>

      {archiveTarget && archivePreview ? (
        <div className="lightbox-backdrop" role="dialog" aria-modal="true" aria-label="Archive site confirmation">
          <div className="lightbox-panel lightbox-panel-narrow">
            <header className="lightbox-header">
              <div>
                <h3>Archive site</h3>
                <p className="muted-text">
                  {archivePreview.siteName} ({archivePreview.siteCode})
                </p>
              </div>
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setArchiveTarget(null);
                  setArchivePreview(null);
                }}
              >
                Cancel
              </button>
            </header>

            <div className="stack-list">
              <p>
                Mapped WhatsApp groups: <strong>{archivePreview.mappedGroups}</strong>
              </p>
              <p>
                Schedules: <strong>{archivePreview.schedules}</strong>
              </p>
              <p>
                Patrol/evidence records: <strong>{archivePreview.patrolImages}</strong> images,{' '}
                <strong>{archivePreview.patrolSlots}</strong> slots
              </p>
              <p className="error-text">This site will stop being monitored.</p>
              <p className="muted-text">Historical evidence will be retained and remains available with Include archived.</p>
              <label>
                Reason (optional)
                <input value={archiveReason} onChange={(event) => setArchiveReason(event.target.value)} maxLength={500} />
              </label>
              <label>
                Type {archivePreview.siteCode} to confirm
                <input value={confirmCode} onChange={(event) => setConfirmCode(event.target.value)} autoComplete="off" />
              </label>
              {error ? <p className="error-text">{error}</p> : null}
              <button type="button" className="danger-button" disabled={isSaving} onClick={() => void confirmArchive()}>
                {isSaving ? 'Archiving...' : 'Archive site'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
