import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiRequest } from '../lib/api';
import { customerErrorMessage } from '../lib/customer-errors';
import { useAuth } from '../state/auth';
import type { PatrolGroup, PatrolSchedule, Site } from '../types';
import { Card, EmptyState, PageHeader, StatusBadge } from '../components/ui';
import { formatPatrolDateTime } from '../lib/patrol-time';

interface ArchivePreview {
  siteId: string;
  siteCode: string;
  siteName: string;
  mappedGroups: number;
  schedules: number;
  patrolImages: number;
  patrolSlots: number;
  patrolAlerts: number;
  incidents: number;
  shiftAssignments: number;
  mappingConflictRecords: number;
  mayDeletePermanently: boolean;
}

export function SitesPage(): JSX.Element {
  const navigate = useNavigate();
  const { token, user } = useAuth();
  const [sites, setSites] = useState<Site[]>([]);
  const [groups, setGroups] = useState<PatrolGroup[]>([]);
  const [schedules, setSchedules] = useState<PatrolSchedule[]>([]);
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
  const [createdSite, setCreatedSite] = useState<Site | null>(null);

  const activeSites = useMemo(() => sites.filter((site) => !site.archivedAt), [sites]);
  const archivedSites = useMemo(() => sites.filter((site) => Boolean(site.archivedAt)), [sites]);

  async function loadSites(): Promise<void> {
    const path = includeArchived ? '/sites?includeArchived=true' : '/sites';
    const [nextSites, nextGroups, nextSchedules] = await Promise.all([
      apiRequest<Site[]>(path, {}, token ?? undefined),
      apiRequest<PatrolGroup[]>('/patrol-groups', {}, token ?? undefined),
      apiRequest<PatrolSchedule[]>('/patrol-schedules', {}, token ?? undefined),
    ]);
    setSites(nextSites);
    setGroups(nextGroups);
    setSchedules(nextSchedules);
  }

  useEffect(() => {
    void loadSites().catch((loadError) => setError(customerErrorMessage(loadError, 'Sites could not be loaded. Try again.')));
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
      const savedSite = await apiRequest<Site>(
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
      if (!editingSiteId) {
        setCreatedSite(savedSite);
      }
      await loadSites();
    } catch (saveError) {
      setError(customerErrorMessage(saveError, 'The site could not be saved. Check the details and try again.'));
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
      setError(customerErrorMessage(saveError, 'The site could not be updated. Your previous details are unchanged.'));
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
      setError(customerErrorMessage(previewError, 'The archive check could not be completed. Try again.'));
    }
  }

  async function confirmArchive(permanent = false): Promise<void> {
    if (!archiveTarget || !archivePreview) {
      return;
    }

    if (confirmCode.trim().toUpperCase() !== archivePreview.siteCode.toUpperCase()) {
      setError(`Type ${archivePreview.siteCode} exactly to confirm archive.`);
      return;
    }
    if (permanent && !archivePreview.mayDeletePermanently) {
      setError('This site has historical records. Archive it to preserve them.');
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      await apiRequest<Site | void>(
        permanent ? `/sites/${archiveTarget.id}/permanent` : `/sites/${archiveTarget.id}`,
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
      setIncludeArchived(!permanent);
      await loadSites();
    } catch (archiveError) {
      setError(customerErrorMessage(archiveError, 'The site could not be changed. No historical records were removed.'));
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
      setError(customerErrorMessage(restoreError, 'The site could not be restored. Try again.'));
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
          {createdSite ? (
            <div className="site-next-action" role="status">
              <div>
                <strong>{createdSite.siteName} is ready.</strong>
                <p className="muted-text">Next, choose the WhatsApp patrol group for this site.</p>
              </div>
              <button
                type="button"
                className="primary-button"
                onClick={() => navigate(`/setup?siteId=${encodeURIComponent(createdSite.id)}&step=mapping`)}
              >
                Add WhatsApp group
              </button>
            </div>
          ) : null}
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
                    <p className="muted-text">
                      {groups.filter((group) => group.siteId === site.id && group.active && group.externalGroupId).length}{' '}
                      active WhatsApp mapping(s) ·{' '}
                      {schedules.filter((schedule) => schedule.siteId === site.id && schedule.active).length} active schedule(s)
                    </p>
                  </div>
                  <div className="button-row">
                    <StatusBadge value={site.active} />
                    <button
                      type="button"
                      className="primary-button"
                      onClick={() => navigate(`/setup?siteId=${encodeURIComponent(site.id)}&step=mapping`)}
                    >
                      Manage WhatsApp groups
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => navigate(`/setup?siteId=${encodeURIComponent(site.id)}&step=schedule`)}
                    >
                      Configure schedule
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => {
                        setCreatedSite(null);
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
                      Archive / Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {includeArchived && archivedSites.length > 0 ? (
            <div className="stack-list stack-list-spaced">
              <h4>Archived sites</h4>
              <p className="muted-text">Historical evidence is retained. Restoring a site does not automatically reactivate old mappings or schedules.</p>
              {archivedSites.map((site) => (
                <div key={site.id} className="list-row">
                  <div>
                    <strong>{site.siteCode}</strong>
                    <p>{site.siteName}</p>
                    <p className="muted-text">Archived {site.archivedAt ? formatPatrolDateTime(site.archivedAt) : ''}</p>
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
        <div className="lightbox-backdrop" role="dialog" aria-modal="true" aria-label="Site lifecycle confirmation">
          <div className="lightbox-panel lightbox-panel-narrow">
            <header className="lightbox-header">
              <div>
                <h3>Archive or delete site</h3>
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
                Historical records: <strong>{archivePreview.patrolImages}</strong> images,{' '}
                <strong>{archivePreview.patrolSlots}</strong> patrol events,{' '}
                <strong>{archivePreview.patrolAlerts}</strong> alerts,{' '}
                <strong>{archivePreview.incidents}</strong> incidents,{' '}
                <strong>{archivePreview.shiftAssignments}</strong> assignments
              </p>
              {archivePreview.mappingConflictRecords > 0 ? <p className="muted-text">Mapping audit records: {archivePreview.mappingConflictRecords}</p> : null}
              <p className="error-text">Archiving stops monitoring for this site and pauses its mappings and schedules.</p>
              <p className="muted-text">Archiving preserves historical records. Restore does not automatically reactivate mappings or schedules.</p>
              {archivePreview.mayDeletePermanently ? (
                <p className="muted-text">This site has no historical records. Permanent deletion will also remove its mappings and schedules and cannot be undone.</p>
              ) : (
                <p className="muted-text">Permanent deletion is unavailable because this site has historical records. Archive it instead.</p>
              )}
              <label>
                Reason (optional)
                <input value={archiveReason} onChange={(event) => setArchiveReason(event.target.value)} maxLength={500} />
              </label>
              <label>
                Type {archivePreview.siteCode} to confirm
                <input value={confirmCode} onChange={(event) => setConfirmCode(event.target.value)} autoComplete="off" />
              </label>
              {error ? <p className="error-text">{error}</p> : null}
              <div className="button-row">
                <button type="button" className="secondary-button" disabled={isSaving} onClick={() => void confirmArchive()}>
                  {isSaving ? 'Working...' : 'Archive site'}
                </button>
                {archivePreview.mayDeletePermanently ? (
                  <button type="button" className="danger-button" disabled={isSaving} onClick={() => void confirmArchive(true)}>
                    Delete empty site permanently
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
