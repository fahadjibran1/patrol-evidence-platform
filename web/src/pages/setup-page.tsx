import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest } from '../lib/api';
import { isDesktopApp } from '../lib/desktop';
import { useAuth } from '../state/auth';
import type {
  DesktopBootstrapStatus,
  PatrolGroup,
  PatrolSchedule,
  PatrolSourceType,
  Site,
  WhatsAppCollectorContact,
  WhatsAppCollectorGroup,
  WhatsAppCollectorStatus,
} from '../types';
import { Card, EmptyState, PageHeader, StatusBadge } from '../components/ui';

const weekdayOptions = [
  { label: 'Sun', value: 0 },
  { label: 'Mon', value: 1 },
  { label: 'Tue', value: 2 },
  { label: 'Wed', value: 3 },
  { label: 'Thu', value: 4 },
  { label: 'Fri', value: 5 },
  { label: 'Sat', value: 6 },
];

const checkInOptions = [
  { label: 'Every 30 minutes', value: 30 },
  { label: 'Every hour', value: 60 },
  { label: 'Every 2 hours', value: 120 },
];

const setupSteps = [
  { id: 1, title: 'Create site', hint: 'Add the location you are securing.' },
  { id: 2, title: 'Link WhatsApp', hint: 'Connect the phone that receives patrol photos.' },
  { id: 3, title: 'Choose source', hint: 'Pick a group chat or an individual contact.' },
  { id: 4, title: 'Map to site', hint: 'Tell the system which chat belongs to which site.' },
  { id: 5, title: 'Patrol schedule', hint: 'Set when guards should check in.' },
  { id: 6, title: 'Start monitoring', hint: 'Turn on live patrol capture.' },
] as const;

function formatHourLabel(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

function hourOptions(): { label: string; value: number }[] {
  return Array.from({ length: 24 }, (_, hour) => ({
    label: formatHourLabel(hour),
    value: hour,
  }));
}

export function SetupPage(): JSX.Element {
  const { token, user } = useAuth();
  const [sites, setSites] = useState<Site[]>([]);
  const [groups, setGroups] = useState<PatrolGroup[]>([]);
  const [schedules, setSchedules] = useState<PatrolSchedule[]>([]);
  const [whatsAppGroups, setWhatsAppGroups] = useState<WhatsAppCollectorGroup[]>([]);
  const [whatsAppContacts, setWhatsAppContacts] = useState<WhatsAppCollectorContact[]>([]);
  const [collectorStatus, setCollectorStatus] = useState<WhatsAppCollectorStatus | null>(null);
  const [bootstrapStatus, setBootstrapStatus] = useState<DesktopBootstrapStatus | null>(null);
  const [licenseKey, setLicenseKey] = useState('');
  const [siteForm, setSiteForm] = useState({ siteCode: '', siteName: '', clientName: '' });
  const [groupForm, setGroupForm] = useState({
    siteId: '',
    sourceType: 'group' as PatrolSourceType,
    groupName: '',
    externalGroupId: '',
  });
  const [scheduleForm, setScheduleForm] = useState({
    siteId: '',
    scheduleName: 'Day shift',
    expectedGuards: 1,
    frequencyMinutes: 60,
    startHour: 6,
    endHour: 22,
    is24Hours: false,
    graceMinutes: 15,
    activeDays: [1, 2, 3, 4, 5],
  });
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSavingSite, setIsSavingSite] = useState(false);
  const [isRefreshingSources, setIsRefreshingSources] = useState(false);
  const [mappingAdvancedOpen, setMappingAdvancedOpen] = useState(false);
  const [scheduleAdvancedOpen, setScheduleAdvancedOpen] = useState(false);
  const [licenseAdvancedOpen, setLicenseAdvancedOpen] = useState(false);
  const [mappingSiteSelections, setMappingSiteSelections] = useState<Record<string, string>>({});

  const loadData = useCallback(async (): Promise<void> => {
    const [
      nextSites,
      nextGroups,
      nextSchedules,
      nextWhatsAppGroups,
      nextWhatsAppContacts,
      nextBootstrapStatus,
      nextCollectorStatus,
    ] = await Promise.all([
      apiRequest<Site[]>('/sites', {}, token ?? undefined),
      apiRequest<PatrolGroup[]>('/patrol-groups', {}, token ?? undefined),
      apiRequest<PatrolSchedule[]>('/patrol-schedules', {}, token ?? undefined),
      apiRequest<WhatsAppCollectorGroup[]>('/collectors/whatsapp/groups', {}, token ?? undefined).catch(() => []),
      apiRequest<WhatsAppCollectorContact[]>('/collectors/whatsapp/contacts', {}, token ?? undefined).catch(() => []),
      apiRequest<DesktopBootstrapStatus>('/desktop/bootstrap/status', {}, token ?? undefined).catch(() => null),
      apiRequest<WhatsAppCollectorStatus>('/collectors/whatsapp/status', {}, token ?? undefined).catch(() => null),
    ]);

    setSites(nextSites);
    setGroups(nextGroups);
    setSchedules(nextSchedules);
    setWhatsAppGroups(nextWhatsAppGroups);
    setWhatsAppContacts(nextWhatsAppContacts);
    setBootstrapStatus(nextBootstrapStatus);
    setCollectorStatus(nextCollectorStatus);
    setMappingSiteSelections(Object.fromEntries(nextGroups.map((group) => [group.id, group.siteId])));
    setLicenseKey(nextBootstrapStatus?.license.licenseKey ?? '');

    setGroupForm((current) =>
      current.siteId || !nextSites[0] ? current : { ...current, siteId: nextSites[0].id },
    );
    setScheduleForm((current) =>
      current.siteId || !nextSites[0] ? current : { ...current, siteId: nextSites[0].id },
    );
  }, [token]);

  useEffect(() => {
    void loadData().catch((loadError) =>
      setError(loadError instanceof Error ? loadError.message : 'Could not load setup. Refresh the page and try again.'),
    );
  }, [loadData]);

  const hasSites = sites.length > 0;
  const whatsAppLinked = Boolean(collectorStatus?.connected || collectorStatus?.ready);
  const currentLinkedAccountId = collectorStatus?.connectedAccount || bootstrapStatus?.linkedWhatsAppAccountId || null;
  const currentAccountMappings = groups.filter(
    (group) => !group.externalGroupId || (currentLinkedAccountId && group.linkedAccountId === currentLinkedAccountId),
  );
  const hasMappings = currentAccountMappings.some((group) => group.active && Boolean(group.externalGroupId));
  const hasSchedules = schedules.length > 0;
  const monitoringLive = collectorStatus?.monitoringState === 'ACTIVE';

  const stepComplete = useMemo(
    () => ({
      1: hasSites,
      2: whatsAppLinked,
      3: hasMappings,
      4: hasMappings,
      5: hasSchedules,
      6: monitoringLive,
    }),
    [hasMappings, hasSchedules, hasSites, monitoringLive, whatsAppLinked],
  );

  const completedCount = useMemo(
    () => [stepComplete[1], stepComplete[2], stepComplete[4], stepComplete[5], stepComplete[6]].filter(Boolean).length,
    [stepComplete],
  );

  const setupReady = hasSites && whatsAppLinked && hasMappings && hasSchedules && monitoringLive;

  const discoveredSources =
    groupForm.sourceType === 'group' ? whatsAppGroups : whatsAppContacts;

  const licenceLabel = useMemo(() => {
    const license = bootstrapStatus?.license;
    if (!license) {
      return 'Not available in browser mode';
    }

    if (license.licenseType === 'FULL' && license.status === 'ACTIVE') {
      return 'Full licence active';
    }

    if (license.status === 'ACTIVE') {
      return `Trial active · ${license.daysRemaining} day${license.daysRemaining === 1 ? '' : 's'} left`;
    }

    if (license.status === 'EXPIRED') {
      return 'Trial expired — enter a licence key';
    }

    return 'Activation needed';
  }, [bootstrapStatus?.license]);

  function clearMessages(): void {
    setError(null);
    setSuccess(null);
  }

  async function refreshWhatsAppSources(): Promise<void> {
    setIsRefreshingSources(true);
    clearMessages();

    try {
      const refreshedStatus = await apiRequest<WhatsAppCollectorStatus>(
        '/collectors/whatsapp/refresh-sources',
        { method: 'POST' },
        token ?? undefined,
      );
      if (refreshedStatus.sourceDiscoveryState === 'ERROR') {
        throw new Error(refreshedStatus.sourceDiscoveryError || 'Unable to load WhatsApp sources. Try again.');
      }
      const [nextWhatsAppGroups, nextWhatsAppContacts] = await Promise.all([
        apiRequest<WhatsAppCollectorGroup[]>('/collectors/whatsapp/groups', {}, token ?? undefined),
        apiRequest<WhatsAppCollectorContact[]>('/collectors/whatsapp/contacts', {}, token ?? undefined),
      ]);
      setCollectorStatus(refreshedStatus);
      setWhatsAppGroups(nextWhatsAppGroups);
      setWhatsAppContacts(nextWhatsAppContacts);
      const total = nextWhatsAppGroups.length + nextWhatsAppContacts.length;
      setSuccess(
        total > 0
          ? `Found ${total} WhatsApp source${total === 1 ? '' : 's'}. Choose one below.`
          : 'No eligible WhatsApp sources found. Open the group on the linked phone, then try again.',
      );
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : 'Could not refresh WhatsApp sources.');
    } finally {
      setIsRefreshingSources(false);
    }
  }

  async function submitSite(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    clearMessages();
    setIsSavingSite(true);

    try {
      await apiRequest<Site>(
        '/sites',
        {
          method: 'POST',
          body: JSON.stringify({
            siteCode: siteForm.siteCode.trim(),
            siteName: siteForm.siteName.trim(),
            clientName: siteForm.clientName.trim() || undefined,
            active: true,
          }),
        },
        token ?? undefined,
      );
      setSiteForm({ siteCode: '', siteName: '', clientName: '' });
      setSuccess('Site saved. Next, link WhatsApp on the Monitoring page.');
      await loadData();
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : 'Could not save site. Check the details and try again.');
    } finally {
      setIsSavingSite(false);
    }
  }

  async function submitGroup(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    clearMessages();

    try {
      await apiRequest(
        '/patrol-groups',
        {
          method: 'POST',
          body: JSON.stringify({
            siteId: groupForm.siteId,
            groupName: groupForm.groupName,
            externalGroupId: groupForm.externalGroupId || undefined,
            sourceType: groupForm.sourceType,
            active: true,
          }),
        },
        token ?? undefined,
      );
      setGroupForm((current) => ({ ...current, groupName: '', externalGroupId: '' }));
      setSuccess('WhatsApp source linked to site. Set the patrol schedule next.');
      await loadData();
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : 'Could not save mapping. Check your selections and try again.');
    }
  }

  async function submitSchedule(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    clearMessages();

    try {
      await apiRequest(
        '/patrol-schedules',
        {
          method: 'POST',
          body: JSON.stringify({
            ...scheduleForm,
            active: true,
          }),
        },
        token ?? undefined,
      );
      setSuccess('Patrol schedule saved. Go to Monitoring to start live capture.');
      await loadData();
    } catch (submissionError) {
      setError(
        submissionError instanceof Error ? submissionError.message : 'Could not save schedule. Check the times and try again.',
      );
    }
  }

  async function updateMapping(group: PatrolGroup, action: 'reassign' | 'deactivate' | 'reactivate'): Promise<void> {
    clearMessages();
    const targetSiteId = mappingSiteSelections[group.id] ?? group.siteId;
    const confirmed =
      action === 'reassign'
        ? window.confirm(
            'Move this WhatsApp group to the selected site? Future evidence will use the new site. Historical evidence will not change.',
          )
        : action === 'deactivate'
          ? window.confirm(
              'Deactivate this mapping? Future images from this source will not be captured. Historical evidence will remain available.',
            )
          : true;
    if (!confirmed) return;

    try {
      await apiRequest(
        `/patrol-groups/${group.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify(
            action === 'reassign' ? { siteId: targetSiteId } : { active: action === 'reactivate' },
          ),
        },
        token ?? undefined,
      );
      setSuccess(
        action === 'reassign'
          ? 'Mapping updated. Future evidence will use the new site; historical evidence is unchanged.'
          : action === 'deactivate'
            ? 'Mapping deactivated. Historical evidence remains available.'
            : 'Mapping reactivated for future monitoring.',
      );
      await loadData();
    } catch (mappingError) {
      setError(mappingError instanceof Error ? mappingError.message : 'Could not update this mapping.');
    }
  }

  async function updateLicense(): Promise<void> {
    if (!bootstrapStatus?.companyName) {
      setError('Company name is missing. Complete desktop first-run setup, then try again.');
      return;
    }

    clearMessages();

    try {
      const nextBootstrapStatus = await apiRequest<DesktopBootstrapStatus>(
        '/desktop/bootstrap/license',
        {
          method: 'POST',
          body: JSON.stringify({
            companyName: bootstrapStatus.companyName,
            licenseKey,
          }),
        },
        token ?? undefined,
      );
      setBootstrapStatus(nextBootstrapStatus);
      setSuccess('Licence updated.');
    } catch (licenseError) {
      setError(licenseError instanceof Error ? licenseError.message : 'Could not update licence.');
    }
  }

  function handleDiscoveredSourceSelection(selectedSourceId: string): void {
    const selectedGroup = whatsAppGroups.find((group) => group.id === selectedSourceId);
    const selectedContact = whatsAppContacts.find((contact) => contact.id === selectedSourceId);

    if (!selectedGroup && !selectedContact) {
      setGroupForm((current) => ({ ...current, groupName: '', externalGroupId: '' }));
      return;
    }

    if (selectedGroup) {
      setGroupForm((current) => ({
        ...current,
        sourceType: 'group',
        groupName: selectedGroup.name,
        externalGroupId: selectedGroup.id,
      }));
      return;
    }

    setGroupForm((current) => ({
      ...current,
      sourceType: 'contact',
      groupName: selectedContact?.name ?? '',
      externalGroupId: selectedContact?.id ?? '',
    }));
  }

  if (user?.role === 'GUARD') {
    return (
      <EmptyState
        title="Setup is for supervisors"
        description="Your admin configures sites and monitoring. You can use Patrol Ops, Evidence, and Alerts for your shift."
      />
    );
  }

  return (
    <div className="page-stack setup-wizard-page">
      <PageHeader
        title="Setup"
        subtitle="Follow the steps below to go from a new site to live patrol monitoring. No technical knowledge required."
      />

      <Card
        className={`setup-progress-banner${setupReady ? ' ops-banner-ready' : completedCount > 0 ? ' ops-banner-warning' : ''}`}
      >
        <div className="setup-progress-banner-inner">
          <div>
            <h3>{setupReady ? 'Ready for live monitoring' : `${completedCount} of 5 essentials complete`}</h3>
            <p className="muted-text">
              {setupReady
                ? 'Sites, WhatsApp, mappings, and schedules are in place. Monitoring is live.'
                : 'Work through each step in order. You can return here any time to add another site.'}
            </p>
          </div>
          <div className="setup-progress-badges">
            <StatusBadge value={hasSites ? 'READY' : 'Missing setup'} />
            <StatusBadge value={whatsAppLinked ? 'CONNECTED' : 'Missing setup'} />
            <StatusBadge value={hasMappings ? 'READY' : 'Missing setup'} />
            <StatusBadge value={hasSchedules ? 'READY' : 'Missing setup'} />
            <StatusBadge value={monitoringLive ? 'ACTIVE' : 'PENDING'} />
          </div>
        </div>
      </Card>

      {error ? (
        <Card className="setup-message-card">
          <p className="error-text">{error}</p>
        </Card>
      ) : null}
      {success ? (
        <Card className="setup-message-card setup-message-success">
          <p className="success-text">{success}</p>
        </Card>
      ) : null}

      <ol className="setup-wizard-stepper" aria-label="Setup progress">
        {setupSteps.map((step) => (
          <li
            key={step.id}
            className={`setup-wizard-step${stepComplete[step.id] ? ' setup-wizard-step-done' : ''}${
              step.id === 3 && stepComplete[4] ? ' setup-wizard-step-done' : ''
            }`}
          >
            <span className="setup-wizard-step-index">{stepComplete[step.id] || (step.id === 3 && stepComplete[4]) ? '✓' : step.id}</span>
            <span className="setup-wizard-step-label">{step.title}</span>
          </li>
        ))}
      </ol>

      <Card className={`setup-step-card${stepComplete[1] ? ' setup-step-card-done' : ''}`}>
        <div className="setup-step-header">
          <div>
            <p className="setup-step-eyebrow">Step 1</p>
            <h3>Create site</h3>
            <p className="muted-text">A site is a secured location — for example a warehouse, estate, or office park.</p>
          </div>
          <StatusBadge value={hasSites ? 'READY' : 'Missing setup'} />
        </div>

        {sites.length > 0 ? (
          <div className="setup-sites-list stack-list">
            {sites.map((site) => (
              <div className="list-row setup-site-row" key={site.id}>
                <div>
                  <strong>{site.siteCode}</strong>
                  <p>{site.siteName}</p>
                  {site.clientName ? <p className="muted-text">{site.clientName}</p> : null}
                </div>
                <StatusBadge value={site.active ? 'ACTIVE' : 'INACTIVE'} />
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No sites yet"
            description="Add your first site using the short form below. Use a short code your team will recognise (for example WH1 or GATE-A)."
          />
        )}

        <form className="form-grid setup-step-form" onSubmit={submitSite}>
          <label>
            Site code
            <input
              value={siteForm.siteCode}
              onChange={(event) => setSiteForm((current) => ({ ...current, siteCode: event.target.value }))}
              placeholder="e.g. WH1"
              maxLength={20}
              required
            />
          </label>
          <label>
            Site name
            <input
              value={siteForm.siteName}
              onChange={(event) => setSiteForm((current) => ({ ...current, siteName: event.target.value }))}
              placeholder="e.g. Riverside Warehouse"
              maxLength={120}
              required
            />
          </label>
          <details className="setup-advanced-details">
            <summary>Advanced options</summary>
            <div className="setup-advanced-panel">
              <label>
                Client name <span className="muted-text">(optional)</span>
                <input
                  value={siteForm.clientName}
                  onChange={(event) => setSiteForm((current) => ({ ...current, clientName: event.target.value }))}
                  placeholder="e.g. Acme Security Ltd"
                  maxLength={120}
                />
              </label>
              <p className="muted-text setup-advanced-note">
                Manage all sites on the <Link to="/sites">Sites</Link> page if you need to edit or deactivate later.
              </p>
            </div>
          </details>
          <div className="setup-action-row">
            <button type="submit" className="primary-button" disabled={isSavingSite}>
              {isSavingSite ? 'Saving…' : sites.length > 0 ? 'Add another site' : 'Create site'}
            </button>
          </div>
        </form>
      </Card>

      <Card className={`setup-step-card${stepComplete[2] ? ' setup-step-card-done' : ''}`}>
        <div className="setup-step-header">
          <div>
            <p className="setup-step-eyebrow">Step 2</p>
            <h3>Link WhatsApp</h3>
            <p className="muted-text">
              Open Monitoring, scan the QR code with the patrol phone, and wait until the status shows connected.
            </p>
          </div>
          <StatusBadge value={whatsAppLinked ? 'CONNECTED' : 'Missing setup'} />
        </div>

        {!hasSites ? (
          <p className="setup-blocked-hint muted-text">Create a site first (Step 1), then return here.</p>
        ) : (
          <div className="setup-step-body">
            <div className="setup-status-panel">
              <div>
                <strong>WhatsApp link</strong>
                <p className="muted-text">
                  {whatsAppLinked
                    ? 'Phone is linked. You can map patrol sources in the next steps.'
                    : 'Not linked yet. Use Monitoring to scan the QR code.'}
                </p>
              </div>
              <StatusBadge value={whatsAppLinked ? 'CONNECTED' : 'QR'} />
            </div>
            {whatsAppLinked ? (
              <div className="setup-status-panel">
                <div>
                  <strong>Monitoring</strong>
                  <p className="muted-text">
                    {monitoringLive
                      ? 'Active — new patrol images from mapped sources are being captured.'
                      : 'Paused — WhatsApp remains connected while patrol-image capture is stopped.'}
                  </p>
                </div>
                <StatusBadge value={monitoringLive ? 'ACTIVE' : 'PAUSED'} />
              </div>
            ) : null}
            <div className="setup-action-row">
              <Link className="primary-button setup-link-button" to="/collector">
                Open Monitoring to link WhatsApp
              </Link>
              <button type="button" className="secondary-button" onClick={() => void loadData()}>
                Check link status
              </button>
            </div>
          </div>
        )}
      </Card>

      <Card className={`setup-step-card${stepComplete[4] ? ' setup-step-card-done' : ''}`}>
        <div className="setup-step-header">
          <div>
            <p className="setup-step-eyebrow">Steps 3 & 4</p>
            <h3>Choose source and map to site</h3>
            <p className="muted-text">
              Select whether patrol photos come from a WhatsApp group or a single contact, then assign that source to a site.
            </p>
          </div>
          <StatusBadge value={hasMappings ? 'READY' : 'Missing setup'} />
        </div>

        {!hasSites ? (
          <p className="setup-blocked-hint muted-text">Create a site first.</p>
        ) : !whatsAppLinked ? (
          <p className="setup-blocked-hint muted-text">Link WhatsApp on Monitoring first, then refresh the source list below.</p>
        ) : (
          <>
            <div className="setup-source-type-picker">
              <p className="setup-field-label">Step 3 — Where do patrol photos arrive?</p>
              <div className="setup-source-type-buttons">
                <button
                  type="button"
                  className={`setup-source-type-button${groupForm.sourceType === 'group' ? ' setup-source-type-button-active' : ''}`}
                  onClick={() =>
                    setGroupForm((current) => ({
                      ...current,
                      sourceType: 'group',
                      groupName: '',
                      externalGroupId: '',
                    }))
                  }
                >
                  <strong>WhatsApp group</strong>
                  <span className="muted-text">Patrol team group chat</span>
                </button>
                <button
                  type="button"
                  className={`setup-source-type-button${groupForm.sourceType === 'contact' ? ' setup-source-type-button-active' : ''}`}
                  onClick={() =>
                    setGroupForm((current) => ({
                      ...current,
                      sourceType: 'contact',
                      groupName: '',
                      externalGroupId: '',
                    }))
                  }
                >
                  <strong>Individual contact</strong>
                  <span className="muted-text">One guard sends photos directly</span>
                </button>
              </div>
            </div>

            {collectorStatus?.sourceDiscoveryState === 'LOADING' ? (
              <EmptyState title="Searching for WhatsApp sources…" description="PatrolSafe is loading group names from the linked account." />
            ) : collectorStatus?.sourceDiscoveryState === 'ERROR' ? (
              <EmptyState title="Unable to load WhatsApp sources" description="Try Refresh sources again. WhatsApp will remain connected." />
            ) : discoveredSources.length === 0 ? (
              <EmptyState
                title={collectorStatus?.sourceDiscoveryState === 'EMPTY' ? 'No eligible WhatsApp sources found' : 'WhatsApp sources not loaded yet'}
                description="Open the patrol group or contact on the linked phone, then press Refresh sources."
              />
            ) : null}

            <form className="form-grid setup-step-form" onSubmit={submitGroup}>
              <p className="setup-field-label">Step 4 — Map source to site</p>
              <label>
                Site
                <select
                  value={groupForm.siteId}
                  onChange={(event) => setGroupForm((current) => ({ ...current, siteId: event.target.value }))}
                  required
                >
                  <option value="">Select site</option>
                  {sites.map((site) => (
                    <option key={site.id} value={site.id}>
                      {site.siteCode} — {site.siteName}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {groupForm.sourceType === 'group' ? 'WhatsApp group' : 'WhatsApp contact'}
                <select
                  value={
                    discoveredSources.some((entry) => entry.id === groupForm.externalGroupId)
                      ? groupForm.externalGroupId
                      : ''
                  }
                  onChange={(event) => handleDiscoveredSourceSelection(event.target.value)}
                  required={discoveredSources.length > 0}
                >
                  <option value="">
                    {discoveredSources.length === 0
                      ? 'No sources yet — refresh after linking'
                      : `Select ${groupForm.sourceType === 'group' ? 'group' : 'contact'}`}
                  </option>
                  {discoveredSources.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Display name on reports
                <input
                  value={groupForm.groupName}
                  onChange={(event) => setGroupForm((current) => ({ ...current, groupName: event.target.value }))}
                  placeholder="e.g. Night patrol group"
                  required
                />
              </label>

              <details
                className="setup-advanced-details"
                open={mappingAdvancedOpen}
                onToggle={(event) => setMappingAdvancedOpen(event.currentTarget.open)}
              >
                <summary>Advanced options</summary>
                <div className="setup-advanced-panel">
                  <label>
                    WhatsApp chat ID
                    <input
                      value={groupForm.externalGroupId}
                      onChange={(event) => setGroupForm((current) => ({ ...current, externalGroupId: event.target.value }))}
                      placeholder={groupForm.sourceType === 'group' ? '120363…@g.us' : '447700…@c.us'}
                    />
                  </label>
                  <p className="muted-text setup-advanced-note">
                    Only edit this if support gave you a chat ID. Normally, pick the source from the list above.
                  </p>
                </div>
              </details>

              <div className="setup-action-row">
                <button
                  type="button"
                  className="secondary-button"
                  disabled={isRefreshingSources}
                  onClick={() => void refreshWhatsAppSources()}
                >
                  {isRefreshingSources ? 'Refreshing…' : 'Refresh sources'}
                </button>
                <button type="submit" className="primary-button">
                  Save mapping
                </button>
              </div>
            </form>

            {currentAccountMappings.length > 0 ? (
              <div className="setup-existing-block stack-list">
                <p className="setup-field-label">Current mappings</p>
                {currentAccountMappings.map((group) => (
                  <div className="list-row" key={group.id}>
                    <div>
                      <strong>{group.groupName}</strong>
                      <p className="muted-text">
                        {group.site?.siteCode ?? 'Site'} · {group.sourceType === 'contact' ? 'Contact' : 'Group'}
                      </p>
                      <label>
                        Site for future evidence
                        <select
                          value={mappingSiteSelections[group.id] ?? group.siteId}
                          disabled={!group.active}
                          onChange={(event) =>
                            setMappingSiteSelections((current) => ({ ...current, [group.id]: event.target.value }))
                          }
                        >
                          {sites.map((site) => (
                            <option key={site.id} value={site.id}>
                              {site.siteCode} — {site.siteName}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="button-row">
                        {group.active ? (
                          <>
                            <button
                              type="button"
                              className="secondary-button"
                              disabled={(mappingSiteSelections[group.id] ?? group.siteId) === group.siteId}
                              onClick={() => void updateMapping(group, 'reassign')}
                            >
                              Move to selected site
                            </button>
                            <button
                              type="button"
                              className="secondary-button"
                              onClick={() => void updateMapping(group, 'deactivate')}
                            >
                              Deactivate mapping
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="primary-button"
                            onClick={() => void updateMapping(group, 'reactivate')}
                          >
                            Reactivate mapping
                          </button>
                        )}
                      </div>
                    </div>
                    <StatusBadge value={group.active ? 'ACTIVE' : 'INACTIVE'} />
                  </div>
                ))}
              </div>
            ) : null}
          </>
        )}
      </Card>

      <Card className={`setup-step-card${stepComplete[5] ? ' setup-step-card-done' : ''}`}>
        <div className="setup-step-header">
          <div>
            <p className="setup-step-eyebrow">Step 5</p>
            <h3>Set patrol schedule</h3>
            <p className="muted-text">Tell the system how often guards should send patrol evidence during the shift.</p>
          </div>
          <StatusBadge value={hasSchedules ? 'READY' : 'Missing setup'} />
        </div>

        {!hasSites ? (
          <p className="setup-blocked-hint muted-text">Create a site first.</p>
        ) : (
          <>
            {schedules.length > 0 ? (
              <div className="setup-existing-block stack-list">
                <p className="setup-field-label">Saved schedules</p>
                {schedules.map((schedule) => {
                  const site = sites.find((entry) => entry.id === schedule.siteId);
                  return (
                    <div className="list-row" key={schedule.id}>
                      <div>
                        <strong>{schedule.scheduleName || 'Shift'}</strong>
                        <p className="muted-text">
                          {site?.siteCode ?? 'Site'} · Every {schedule.frequencyMinutes} min ·{' '}
                          {schedule.is24Hours
                            ? '24 hours'
                            : `${formatHourLabel(schedule.startHour)}–${formatHourLabel(schedule.endHour)}`}{' '}
                          ·{' '}
                          {schedule.expectedGuards} expected guard{schedule.expectedGuards === 1 ? '' : 's'}
                        </p>
                      </div>
                      <StatusBadge value="READY" />
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyState
                title="No schedule yet"
                description="Set any monitoring window for this site (for example 09:00–17:00 or overnight 18:00–06:00). Start is inclusive and end is exclusive. Europe/London is the default business timezone."
              />
            )}

            <form className="form-grid setup-step-form" onSubmit={submitSchedule}>
              <label>
                Site
                <select
                  value={scheduleForm.siteId}
                  onChange={(event) => setScheduleForm((current) => ({ ...current, siteId: event.target.value }))}
                  required
                >
                  <option value="">Select site</option>
                  {sites.map((site) => (
                    <option key={site.id} value={site.id}>
                      {site.siteCode} — {site.siteName}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Schedule name
                <input
                  type="text"
                  maxLength={120}
                  value={scheduleForm.scheduleName}
                  onChange={(event) =>
                    setScheduleForm((current) => ({ ...current, scheduleName: event.target.value }))
                  }
                  placeholder="e.g. Day shift"
                  required
                />
              </label>
              <label>
                Expected guards on this schedule
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={scheduleForm.expectedGuards}
                  onChange={(event) =>
                    setScheduleForm((current) => ({ ...current, expectedGuards: Number(event.target.value) }))
                  }
                  required
                />
              </label>
              <label>
                How often should guards check in?
                <select
                  value={scheduleForm.frequencyMinutes}
                  onChange={(event) =>
                    setScheduleForm((current) => ({ ...current, frequencyMinutes: Number(event.target.value) }))
                  }
                >
                  {checkInOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="two-column-grid">
                <label>
                  Active from (inclusive)
                  <select
                    value={scheduleForm.startHour}
                    disabled={scheduleForm.is24Hours}
                    onChange={(event) =>
                      setScheduleForm((current) => ({ ...current, startHour: Number(event.target.value) }))
                    }
                  >
                    {hourOptions().map((option) => (
                      <option key={`start-${option.value}`} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Active until (exclusive)
                  <select
                    value={scheduleForm.endHour}
                    disabled={scheduleForm.is24Hours}
                    onChange={(event) =>
                      setScheduleForm((current) => ({ ...current, endHour: Number(event.target.value) }))
                    }
                  >
                    {hourOptions().map((option) => (
                      <option key={`end-${option.value}`} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <p className="muted-text">
                Example: 09:00–17:00 covers hours 09 through 16. Overnight 18:00–06:00 covers 18 through 05.
              </p>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={scheduleForm.is24Hours}
                  onChange={(event) =>
                    setScheduleForm((current) => ({ ...current, is24Hours: event.target.checked }))
                  }
                />
                24-hour monitoring (all hours)
              </label>
              <fieldset className="weekday-fieldset">
                <legend>Active days</legend>
                <div className="weekday-grid">
                  {weekdayOptions.map((day) => (
                    <label key={day.value} className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={scheduleForm.activeDays.includes(day.value)}
                        onChange={(event) =>
                          setScheduleForm((current) => ({
                            ...current,
                            activeDays: event.target.checked
                              ? [...current.activeDays, day.value].sort((left, right) => left - right)
                              : current.activeDays.filter((value) => value !== day.value),
                          }))
                        }
                      />
                      {day.label}
                    </label>
                  ))}
                </div>
              </fieldset>

              <details
                className="setup-advanced-details"
                open={scheduleAdvancedOpen}
                onToggle={(event) => setScheduleAdvancedOpen(event.currentTarget.open)}
              >
                <summary>Advanced options</summary>
                <div className="setup-advanced-panel">
                  <label>
                    Check-in interval (minutes)
                    <input
                      type="number"
                      min={5}
                      value={scheduleForm.frequencyMinutes}
                      onChange={(event) =>
                        setScheduleForm((current) => ({ ...current, frequencyMinutes: Number(event.target.value) }))
                      }
                    />
                  </label>
                  <label>
                    Grace period (minutes)
                    <input
                      type="number"
                      min={0}
                      max={120}
                      value={scheduleForm.graceMinutes}
                      onChange={(event) =>
                        setScheduleForm((current) => ({ ...current, graceMinutes: Number(event.target.value) }))
                      }
                    />
                  </label>
                  <p className="muted-text setup-advanced-note">
                    Grace period is extra time after each slot before a missed check-in is flagged.
                  </p>
                </div>
              </details>

              <div className="setup-action-row">
                <button type="submit" className="primary-button">
                  Save schedule
                </button>
              </div>
            </form>
          </>
        )}
      </Card>

      <Card className={`setup-step-card setup-step-card-final${stepComplete[6] ? ' setup-step-card-done' : ''}`}>
        <div className="setup-step-header">
          <div>
            <p className="setup-step-eyebrow">Step 6</p>
            <h3>Start monitoring</h3>
            <p className="muted-text">
              When monitoring is live, patrol photos from WhatsApp appear on the Dashboard and in Evidence automatically.
            </p>
          </div>
          <StatusBadge value={monitoringLive ? 'ACTIVE' : 'PENDING'} />
        </div>

        {!hasSites || !whatsAppLinked || !hasMappings || !hasSchedules ? (
          <p className="setup-blocked-hint muted-text">
            Complete steps 1–5 first: site, WhatsApp link, source mapping, and schedule.
          </p>
        ) : (
          <div className="setup-step-body">
            <div className="setup-status-panel">
              <div>
                <strong>Monitoring status</strong>
                <p className="muted-text">
                  {monitoringLive
                    ? 'Live — new patrol images are being captured.'
                    : 'Not running yet. Open Monitoring and press Start.'}
                </p>
              </div>
              <StatusBadge value={monitoringLive ? 'ACTIVE' : 'PENDING'} />
            </div>
            <div className="setup-action-row">
              <Link className="primary-button setup-link-button" to="/collector">
                {monitoringLive ? 'Open Monitoring' : 'Start monitoring'}
              </Link>
              <Link className="secondary-button setup-link-button" to="/">
                Go to Dashboard
              </Link>
            </div>
          </div>
        )}
      </Card>

      <details
        className="setup-advanced-details setup-licence-details"
        open={licenseAdvancedOpen}
        onToggle={(event) => setLicenseAdvancedOpen(event.currentTarget.open)}
      >
        <summary>Advanced — licence &amp; technical details</summary>
        <Card className="setup-section">
          <div className="section-header">
            <div>
              <h3>Licence</h3>
              <p className="muted-text">
                Trial and full licence keys are optional for day-to-day setup. Evidence stays visible if a trial ends;
                monitoring needs an active licence.
              </p>
            </div>
            <StatusBadge value={bootstrapStatus?.license.status ?? 'Unavailable'} />
          </div>
          <div className="ops-stats-grid compact">
            <div className="ops-stat">
              <span>Company</span>
              <strong>{bootstrapStatus?.companyName ?? 'Not set'}</strong>
            </div>
            <div className="ops-stat">
              <span>Licence</span>
              <strong>{licenceLabel}</strong>
            </div>
            <div className="ops-stat">
              <span>Trial ends</span>
              <strong>{bootstrapStatus?.license.trialEndDate ?? '—'}</strong>
            </div>
            <div className="ops-stat">
              <span>App mode</span>
              <strong>{isDesktopApp() ? 'Desktop app' : 'Browser'}</strong>
            </div>
          </div>
          <div className="input-button-row">
            <input
              value={licenseKey}
              onChange={(event) => setLicenseKey(event.target.value)}
              placeholder="Enter trial or full licence key"
            />
            <button type="button" className="secondary-button" onClick={() => void updateLicense()}>
              Update licence
            </button>
          </div>
        </Card>
      </details>
    </div>
  );
}
