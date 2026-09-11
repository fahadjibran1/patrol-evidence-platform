import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import QRCode from 'react-qr-code';
import { apiRequest } from '../lib/api';
import {
  chooseDesktopStoragePath,
  getDesktopState,
  isDesktopApp,
  openDesktopPath,
  restartDesktopBackend,
  saveDesktopConfig,
} from '../lib/desktop';
import { BuildLabel } from '../components/build-label';
import { useAuth } from '../state/auth';
import type {
  DesktopBootstrapStatus,
  DesktopSetupVerificationResult,
  DesktopState,
  PatrolGroup,
  PatrolSchedule,
  PatrolSourceType,
  Site,
  WhatsAppCollectorContact,
  WhatsAppCollectorGroup,
  WhatsAppCollectorStatus,
} from '../types';
import { Card, EmptyState, PageHeader, StatusBadge } from '../components/ui';

type WizardStep = 'company' | 'storage' | 'whatsapp' | 'site-setup';

type SourceFilter = 'all' | 'groups' | 'contacts' | 'unmapped' | 'mapped';

type DetectableSource = {
  id: string;
  name: string;
  sourceType: PatrolSourceType;
};

const wizardSteps: Array<{ value: WizardStep; label: string }> = [
  { value: 'company', label: 'Company & admin' },
  { value: 'storage', label: 'Image storage' },
  { value: 'whatsapp', label: 'Connect WhatsApp' },
  { value: 'site-setup', label: 'Site & mapping' },
];

const DESKTOP_SETUP_STEP_KEY = 'desktop-setup-step';
const DESKTOP_SETUP_STORAGE_APPLIED_KEY = 'desktop-setup-storage-applied';

function storagePathsMatch(expected: string, actual: string): boolean {
  const normalize = (value: string) => value.trim().replace(/\\/g, '/').toLowerCase();
  return normalize(expected) === normalize(actual);
}

function isStorageAppliedForSetup(
  selectedPath: string,
  bootstrap: DesktopBootstrapStatus | null,
  storageSettingsApplied: boolean,
): boolean {
  if (!selectedPath.trim() || !bootstrap) {
    return false;
  }

  const activePath = bootstrap.activeStorageRootPath ?? bootstrap.patrolImageStoragePath ?? '';
  return (
    storageSettingsApplied ||
    (Boolean(activePath) &&
      storagePathsMatch(selectedPath, activePath) &&
      bootstrap.settingsApplied === true)
  );
}

const weekdayOptions = [
  { label: 'Sun', value: 0 },
  { label: 'Mon', value: 1 },
  { label: 'Tue', value: 2 },
  { label: 'Wed', value: 3 },
  { label: 'Thu', value: 4 },
  { label: 'Fri', value: 5 },
  { label: 'Sat', value: 6 },
];

function formatDateTime(value: string | null): string {
  if (!value) {
    return 'Not yet';
  }

  return new Date(value).toLocaleString();
}

function collectorStageLabel(status: WhatsAppCollectorStatus): string {
  if (status.ready) {
    return 'Connected';
  }

  if (status.qrCode) {
    return 'QR received';
  }

  return status.startupStage ?? status.info;
}

function collectorStateLabel(state: WhatsAppCollectorStatus['state']): string {
  switch (state) {
    case 'idle':
      return 'Idle';
    case 'starting':
      return 'Starting';
    case 'browser-launching':
      return 'Browser launching';
    case 'whatsapp-loading':
      return 'WhatsApp loading';
    case 'waiting-for-qr':
      return 'Waiting for QR';
    case 'qr-ready':
      return 'QR ready';
    case 'LINK_RETRY_REQUIRED':
      return 'Try again';
    case 'authenticated':
      return 'Authenticated';
    case 'ready':
      return 'Ready';
    case 'disconnected':
      return 'Disconnected';
    case 'failed':
      return 'Failed';
    case 'disabled':
      return 'Disabled';
    default:
      return state;
  }
}

function isCurrentAccountMapping(group: PatrolGroup, activeLinkedAccountId: string | null): boolean {
  if (!group.externalGroupId?.trim() || !group.active) {
    return false;
  }

  const mappingAccountId = group.linkedAccountId?.trim() || null;
  if (!activeLinkedAccountId) {
    return !mappingAccountId;
  }

  return mappingAccountId === activeLinkedAccountId;
}

export function DesktopSetupPage(): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const recoverySetup = Boolean((location.state as { recoverySetup?: boolean } | null)?.recoverySetup);
  const { login, token } = useAuth();
  const [step, setStep] = useState<WizardStep>('company');
  const [desktopState, setDesktopState] = useState<DesktopState | null>(null);
  const [bootstrapStatus, setBootstrapStatus] = useState<DesktopBootstrapStatus | null>(null);
  const [collectorStatus, setCollectorStatus] = useState<WhatsAppCollectorStatus | null>(null);
  const [detectedGroups, setDetectedGroups] = useState<WhatsAppCollectorGroup[]>([]);
  const [detectedContacts, setDetectedContacts] = useState<WhatsAppCollectorContact[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [groups, setGroups] = useState<PatrolGroup[]>([]);
  const [schedules, setSchedules] = useState<PatrolSchedule[]>([]);
  const [verificationResult, setVerificationResult] = useState<DesktopSetupVerificationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [storageSettingsApplied, setStorageSettingsApplied] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [qrRenderedAt, setQrRenderedAt] = useState<string | null>(null);
  const [setupForm, setSetupForm] = useState({
    workspaceName: 'PatrolSafe Workspace',
    companyName: 'Tech Guards Security',
    storageRootPath: '',
    adminFirstName: 'Local',
    adminLastName: 'Admin',
    adminEmail: 'admin@patrol.local',
    adminPassword: 'Password123!',
    autoLaunchApp: false,
    autoStartCollector: false,
    whatsappAllowFromMe: false,
  });
  const [siteForm, setSiteForm] = useState({
    siteCode: '',
    siteName: '',
    clientName: '',
    active: true,
  });
  const [groupForm, setGroupForm] = useState({
    siteId: '',
    sourceType: 'group' as PatrolSourceType,
    groupName: '',
    externalGroupId: '',
    active: true,
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
    active: true,
  });
  const [sourceSearch, setSourceSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [selectedSource, setSelectedSource] = useState<DetectableSource | null>(null);
  const [duplicateSourceWarning, setDuplicateSourceWarning] = useState<string | null>(null);

  const isDesktop = useMemo(() => isDesktopApp(), []);
  const activeLinkedAccountId =
    bootstrapStatus?.linkedWhatsAppAccountId?.trim() || collectorStatus?.connectedAccount?.trim() || null;
  const currentAccountMappings = useMemo(
    () => groups.filter((group) => isCurrentAccountMapping(group, activeLinkedAccountId)),
    [groups, activeLinkedAccountId],
  );
  const oldAccountMappings = useMemo(
    () =>
      groups.filter(
        (group) =>
          group.externalGroupId?.trim() &&
          !isCurrentAccountMapping(group, activeLinkedAccountId) &&
          (group.linkedAccountId?.trim() || activeLinkedAccountId),
      ),
    [groups, activeLinkedAccountId],
  );
  const hasSites = sites.length > 0;
  const hasMappedSources = currentAccountMappings.length > 0;
  const mappedSourcesCount = currentAccountMappings.length;
  const mappedExternalIds = useMemo(
    () =>
      new Set(
        currentAccountMappings
          .map((group) => group.externalGroupId?.trim())
          .filter((value): value is string => Boolean(value)),
      ),
    [currentAccountMappings],
  );
  const detectableSources = useMemo<DetectableSource[]>(
    () =>
      [
        ...detectedGroups.map((group) => ({
          id: group.id,
          name: group.name,
          sourceType: 'group' as PatrolSourceType,
        })),
        ...detectedContacts.map((contact) => ({
          id: contact.id,
          name: contact.name,
          sourceType: 'contact' as PatrolSourceType,
        })),
      ].sort((left, right) => left.name.localeCompare(right.name)),
    [detectedContacts, detectedGroups],
  );
  const filteredDetectableSources = useMemo(() => {
    const query = sourceSearch.trim().toLowerCase();

    return detectableSources.filter((source) => {
      const isMapped = mappedExternalIds.has(source.id);
      if (sourceFilter === 'groups' && source.sourceType !== 'group') {
        return false;
      }
      if (sourceFilter === 'contacts' && source.sourceType !== 'contact') {
        return false;
      }
      if (sourceFilter === 'mapped' && !isMapped) {
        return false;
      }
      if (sourceFilter === 'unmapped' && isMapped) {
        return false;
      }
      if (!query) {
        return true;
      }

      return source.name.toLowerCase().includes(query) || source.id.toLowerCase().includes(query);
    });
  }, [detectableSources, mappedExternalIds, sourceFilter, sourceSearch]);

  function isSourceAlreadyMapped(externalGroupId: string): boolean {
    return mappedExternalIds.has(externalGroupId.trim());
  }

  function selectSourceForMapping(source: DetectableSource): void {
    setSelectedSource(source);
    setGroupForm((current) => ({
      ...current,
      sourceType: source.sourceType,
      groupName: source.name,
      externalGroupId: source.id,
    }));
    setDuplicateSourceWarning(
      isSourceAlreadyMapped(source.id) ? 'This source is already mapped.' : null,
    );
  }

  async function loadBootstrap(): Promise<DesktopBootstrapStatus> {
    const savedStep = sessionStorage.getItem(DESKTOP_SETUP_STEP_KEY) as WizardStep | null;
    if (savedStep && wizardSteps.some((entry) => entry.value === savedStep)) {
      setStep(savedStep);
      sessionStorage.removeItem(DESKTOP_SETUP_STEP_KEY);
    }
    const storageAppliedFromSession = sessionStorage.getItem(DESKTOP_SETUP_STORAGE_APPLIED_KEY) === 'true';
    if (storageAppliedFromSession) {
      setStorageSettingsApplied(true);
      sessionStorage.removeItem(DESKTOP_SETUP_STORAGE_APPLIED_KEY);
    }

    const [nextDesktopState, nextBootstrapStatus] = await Promise.all([
      getDesktopState(),
      apiRequest<DesktopBootstrapStatus>('/desktop/bootstrap/status'),
    ]);

    setDesktopState(nextDesktopState);
    setBootstrapStatus(nextBootstrapStatus);

    if (
      nextBootstrapStatus.storageRootPath?.trim() &&
      isStorageAppliedForSetup(
        nextBootstrapStatus.storageRootPath,
        nextBootstrapStatus,
        storageAppliedFromSession,
      )
    ) {
      setStorageSettingsApplied(true);
    }

    if (nextDesktopState?.config) {
      setSetupForm((current) => ({
        ...current,
        workspaceName: nextDesktopState.config.workspaceName ?? current.workspaceName,
        companyName: nextDesktopState.config.companyName ?? current.companyName,
        storageRootPath: nextDesktopState.config.storageRootPath ?? current.storageRootPath,
        adminFirstName: nextDesktopState.config.localAdminFirstName ?? current.adminFirstName,
        adminLastName: nextDesktopState.config.localAdminLastName ?? current.adminLastName,
        adminEmail: nextDesktopState.config.localAdminEmail ?? current.adminEmail,
        autoLaunchApp: nextDesktopState.config.autoLaunchApp ?? current.autoLaunchApp,
        autoStartCollector: nextDesktopState.config.autoStartCollector ?? current.autoStartCollector,
        whatsappAllowFromMe: nextDesktopState.config.whatsappAllowFromMe ?? current.whatsappAllowFromMe,
      }));
    }

    if (nextBootstrapStatus.setupCompleted && nextBootstrapStatus.hasCompanyAdmin) {
      setStep((current) => (current === 'company' ? 'storage' : current));
    }

    return nextBootstrapStatus;
  }

  async function loadProtectedData(nextToken: string): Promise<void> {
    const [
      nextSitesResult,
      nextGroupsResult,
      nextSchedulesResult,
      nextCollectorStatusResult,
      nextDetectedGroupsResult,
      nextDetectedContactsResult,
      nextBootstrapStatusResult,
    ] = await Promise.allSettled([
      apiRequest<Site[]>('/sites', {}, nextToken),
      apiRequest<PatrolGroup[]>('/patrol-groups', {}, nextToken),
      apiRequest<PatrolSchedule[]>('/patrol-schedules', {}, nextToken),
      apiRequest<WhatsAppCollectorStatus>('/collectors/whatsapp/status', {}, nextToken),
      apiRequest<WhatsAppCollectorGroup[]>('/collectors/whatsapp/groups', {}, nextToken),
      apiRequest<WhatsAppCollectorContact[]>('/collectors/whatsapp/contacts', {}, nextToken),
      apiRequest<DesktopBootstrapStatus>('/desktop/bootstrap/status', {}, nextToken),
    ]);

    const nextSites = nextSitesResult.status === 'fulfilled' ? nextSitesResult.value : [];
    const nextGroups = nextGroupsResult.status === 'fulfilled' ? nextGroupsResult.value : [];
    const nextSchedules = nextSchedulesResult.status === 'fulfilled' ? nextSchedulesResult.value : [];
    const nextCollectorStatus = nextCollectorStatusResult.status === 'fulfilled' ? nextCollectorStatusResult.value : null;
    const nextDetectedGroups = nextDetectedGroupsResult.status === 'fulfilled' ? nextDetectedGroupsResult.value : [];
    const nextDetectedContacts =
      nextDetectedContactsResult.status === 'fulfilled' ? nextDetectedContactsResult.value : [];
    const nextBootstrapStatus = nextBootstrapStatusResult.status === 'fulfilled' ? nextBootstrapStatusResult.value : null;

    setSites(nextSites);
    setGroups(nextGroups);
    setSchedules(nextSchedules);
    setCollectorStatus(nextCollectorStatus);
    setDetectedGroups(nextDetectedGroups);
    setDetectedContacts(nextDetectedContacts);

    if (nextBootstrapStatus) {
      setBootstrapStatus(nextBootstrapStatus);
    }

    if (nextSites[0]) {
      setGroupForm((current) => ({ ...current, siteId: current.siteId || nextSites[0].id }));
      setScheduleForm((current) => ({ ...current, siteId: current.siteId || nextSites[0].id }));
    }
  }

  useEffect(() => {
    if (!isDesktop) {
      return;
    }

    void loadBootstrap()
      .then((status) => {
        if (status?.setupCompleted && !recoverySetup) {
          navigate(token ? '/' : '/login', { replace: true });
        }
      })
      .catch((loadError) =>
        setError(loadError instanceof Error ? loadError.message : 'Failed to load desktop setup'),
      );
  }, [isDesktop, navigate, recoverySetup, token]);

  useEffect(() => {
    if (!token) {
      return;
    }

    void loadProtectedData(token).catch((loadError) =>
      setError(loadError instanceof Error ? loadError.message : 'Failed to load setup data'),
    );
  }, [token]);

  useEffect(() => {
    if (!token || (step !== 'whatsapp' && step !== 'site-setup')) {
      return;
    }

    const interval = window.setInterval(() => {
      void loadProtectedData(token).catch(() => undefined);
    }, 5000);

    return () => window.clearInterval(interval);
  }, [step, token]);

  useEffect(() => {
    if (!token || !collectorStatus?.connectedAccount) {
      return;
    }

    void Promise.allSettled([
      apiRequest<WhatsAppCollectorGroup[]>('/collectors/whatsapp/groups', {}, token),
      apiRequest<WhatsAppCollectorContact[]>('/collectors/whatsapp/contacts', {}, token),
      apiRequest<DesktopBootstrapStatus>('/desktop/bootstrap/status', {}, token),
    ]).then(([groupsResult, contactsResult, bootstrapResult]) => {
      if (groupsResult.status === 'fulfilled') {
        setDetectedGroups(groupsResult.value);
      }
      if (contactsResult.status === 'fulfilled') {
        setDetectedContacts(contactsResult.value);
      }
      if (bootstrapResult.status === 'fulfilled') {
        setBootstrapStatus(bootstrapResult.value);
      }
    });
  }, [token, collectorStatus?.connectedAccount]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!collectorStatus?.qrCode) {
      setQrRenderedAt(null);
      return;
    }

    setQrRenderedAt(new Date().toISOString());
  }, [collectorStatus?.latestQrPath, collectorStatus?.qrCode]);

  async function handleChooseStoragePath(): Promise<void> {
    const selectedPath = await chooseDesktopStoragePath();
    if (selectedPath) {
      setSetupForm((current) => ({ ...current, storageRootPath: selectedPath }));
      setStorageSettingsApplied(false);
    }
  }

  async function refreshBootstrapStatus(): Promise<DesktopBootstrapStatus> {
    const nextBootstrapStatus = await apiRequest<DesktopBootstrapStatus>('/desktop/bootstrap/status');
    setBootstrapStatus(nextBootstrapStatus);
    return nextBootstrapStatus;
  }

  async function persistWorkspaceSettings(
    partialConfig: Record<string, unknown>,
    options?: { restartBackend?: boolean; verifyStoragePath?: string; skipBackendRestart?: boolean },
  ): Promise<DesktopBootstrapStatus> {
    const nextDesktopState = await saveDesktopConfig(partialConfig);
    setDesktopState(nextDesktopState);

    if (options?.restartBackend && !options?.skipBackendRestart) {
      const restartedState = await restartDesktopBackend();
      setDesktopState(restartedState);
    }

    const nextBootstrapStatus = await refreshBootstrapStatus();

    if (options?.verifyStoragePath?.trim()) {
      const expected = options.verifyStoragePath.trim();
      const actual = nextBootstrapStatus.activeStorageRootPath ?? nextBootstrapStatus.patrolImageStoragePath ?? '';
      if (!actual || actual.localeCompare(expected, undefined, { sensitivity: 'accent' }) !== 0) {
        throw new Error(
          `Storage folder was not applied by the backend. Expected "${expected}" but the active patrol image path is "${actual || 'unset'}".`,
        );
      }

      if (!nextBootstrapStatus.settingsApplied) {
        throw new Error('Storage settings were saved locally but not applied by the running backend.');
      }
    }

    return nextBootstrapStatus;
  }

  async function ensureBackendHealthy(): Promise<void> {
    const latestDesktopState = (await getDesktopState()) ?? desktopState;
    if (latestDesktopState?.backend.status === 'ready') {
      return;
    }

    for (let attempt = 0; attempt < 30; attempt += 1) {
      try {
        await apiRequest('/health');
        return;
      } catch {
        await new Promise((resolve) => window.setTimeout(resolve, 1_000));
      }
    }

    throw new Error('Local backend is not ready yet. Wait a moment and try again.');
  }

  async function continueToWhatsAppStep(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setIsBusy(true);
    setError(null);
    setSuccess(null);

    try {
      const selectedPath = setupForm.storageRootPath.trim();
      if (!selectedPath) {
        throw new Error('Choose a storage folder before continuing.');
      }

      const currentBootstrap = bootstrapStatus ?? (await refreshBootstrapStatus());
      const storageAlreadyApplied = isStorageAppliedForSetup(
        selectedPath,
        currentBootstrap,
        storageSettingsApplied,
      );

      if (storageAlreadyApplied) {
        console.info('setup-storage-save-skipped-already-applied');
        await ensureBackendHealthy();
        const verifiedBootstrap = await refreshBootstrapStatus();
        const activePath = verifiedBootstrap.activeStorageRootPath ?? verifiedBootstrap.patrolImageStoragePath ?? '';
        if (!activePath || !storagePathsMatch(selectedPath, activePath)) {
          throw new Error(
            `Active image storage path "${activePath || 'unset'}" does not match the selected folder "${selectedPath}".`,
          );
        }
        if (!verifiedBootstrap.settingsApplied) {
          throw new Error('Storage settings were saved locally but not applied by the running backend.');
        }
        console.info('setup-continue-whatsapp-no-restart');
        setStorageSettingsApplied(true);
      } else {
        console.info('setup-storage-save-requested');
        sessionStorage.setItem(DESKTOP_SETUP_STEP_KEY, 'whatsapp');
        sessionStorage.setItem(DESKTOP_SETUP_STORAGE_APPLIED_KEY, 'true');
        const nextBootstrapStatus = await persistWorkspaceSettings(
          { storageRootPath: selectedPath },
          {
            skipBackendRestart: true,
            verifyStoragePath: selectedPath,
          },
        );

        if (!nextBootstrapStatus.schemaReady) {
          await apiRequest<DesktopBootstrapStatus>('/desktop/bootstrap/initialize', {
            method: 'POST',
            body: JSON.stringify({
              workspaceName: setupForm.workspaceName,
              companyName: setupForm.companyName,
              storageRootPath: selectedPath,
              adminFirstName: setupForm.adminFirstName,
              adminLastName: setupForm.adminLastName,
              adminEmail: setupForm.adminEmail,
              adminPassword: setupForm.adminPassword,
              markSetupComplete: false,
            }),
          });
          const refreshed = await refreshBootstrapStatus();
          if (!refreshed.schemaReady) {
            throw new Error('Local database is still preparing. Wait a moment and try again.');
          }
        }

        console.info('setup-storage-restart-complete');
        setStorageSettingsApplied(true);
      }

      if (!token) {
        const loginResponse = await login(setupForm.adminEmail, setupForm.adminPassword);
        await loadProtectedData(loginResponse.accessToken);
      }

      setSuccess(`Patrol images will be saved to: ${selectedPath}`);
      setStep('whatsapp');
    } catch (submissionError) {
      sessionStorage.removeItem(DESKTOP_SETUP_STEP_KEY);
      sessionStorage.removeItem(DESKTOP_SETUP_STORAGE_APPLIED_KEY);
      setError(submissionError instanceof Error ? submissionError.message : 'Failed to continue to WhatsApp setup');
    } finally {
      setIsBusy(false);
    }
  }

  async function saveStorageStep(event: FormEvent<HTMLFormElement>): Promise<void> {
    await continueToWhatsAppStep(event);
  }

  async function submitCompanyStep(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setIsBusy(true);
    setError(null);
    setSuccess(null);

    try {
      await persistWorkspaceSettings(
        {
          workspaceName: setupForm.workspaceName,
          companyName: setupForm.companyName,
          localAdminEmail: setupForm.adminEmail,
          localAdminFirstName: setupForm.adminFirstName,
          localAdminLastName: setupForm.adminLastName,
          autoLaunchApp: setupForm.autoLaunchApp,
          autoStartCollector: false,
          whatsappAllowFromMe: setupForm.whatsappAllowFromMe,
        },
        { restartBackend: true },
      );

      await apiRequest<DesktopBootstrapStatus>('/desktop/bootstrap/initialize', {
        method: 'POST',
        body: JSON.stringify({
          workspaceName: setupForm.workspaceName,
          companyName: setupForm.companyName,
          adminFirstName: setupForm.adminFirstName,
          adminLastName: setupForm.adminLastName,
          adminEmail: setupForm.adminEmail,
          adminPassword: setupForm.adminPassword,
          autoLaunchApp: setupForm.autoLaunchApp,
          autoStartCollector: false,
          whatsappAllowFromMe: setupForm.whatsappAllowFromMe,
          markSetupComplete: false,
        }),
      });

      const restartedState = await restartDesktopBackend();
      if (restartedState) {
        setDesktopState(restartedState);
      }
      await ensureBackendHealthy();

      const loginResponse = await login(setupForm.adminEmail, setupForm.adminPassword);
      await loadProtectedData(loginResponse.accessToken);
      setSuccess('Company admin created. Continue to choose where patrol images are stored.');
      setStep('storage');
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : 'Failed to save company settings');
    } finally {
      setIsBusy(false);
    }
  }

  async function resetWhatsAppSession(): Promise<void> {
    if (!token) {
      setError('Admin session required.');
      return;
    }

    if (
      !window.confirm(
        'Reset WhatsApp session? This closes the browser, deletes local WhatsApp session files, and shows a new QR code.',
      )
    ) {
      return;
    }

    setIsBusy(true);
    setError(null);
    setSuccess(null);

    try {
      const nextStatus = await apiRequest<WhatsAppCollectorStatus>(
        '/collectors/whatsapp/reset-session',
        { method: 'POST' },
        token,
      );
      setCollectorStatus(nextStatus);
      await loadProtectedData(token ?? '');
      setSuccess('WhatsApp session reset. Scan the new QR code when it appears.');
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : 'Failed to reset WhatsApp session');
    } finally {
      setIsBusy(false);
    }
  }

  async function collectorAction(
    path:
      | '/collectors/whatsapp/start'
      | '/collectors/whatsapp/retry-link'
      | '/collectors/whatsapp/reset-session'
      | '/collectors/whatsapp/stop',
  ): Promise<void> {
    if (!token) {
      return;
    }

    setIsBusy(true);
    setError(null);

    try {
      const nextStatus = await apiRequest<WhatsAppCollectorStatus>(path, { method: 'POST' }, token);
      setCollectorStatus(nextStatus);
      await loadProtectedData(token);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Patrol monitoring action failed');
    } finally {
      setIsBusy(false);
    }
  }

  async function createSite(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!token) {
      return;
    }

    setIsBusy(true);
    setError(null);

    try {
      await apiRequest('/sites', { method: 'POST', body: JSON.stringify(siteForm) }, token);
      setSiteForm({ siteCode: '', siteName: '', clientName: '', active: true });
      await loadProtectedData(token);
      setSuccess('Site created. Map a WhatsApp group or contact below.');
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : 'Failed to create site');
    } finally {
      setIsBusy(false);
    }
  }

  async function createGroup(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!token) {
      return;
    }

    setIsBusy(true);
    setError(null);

    try {
      if (isSourceAlreadyMapped(groupForm.externalGroupId)) {
        setDuplicateSourceWarning('This source is already mapped.');
        setError('This source is already mapped.');
        return;
      }

      await apiRequest(
        '/patrol-groups',
        {
          method: 'POST',
          body: JSON.stringify({
            ...groupForm,
            linkedAccountId: activeLinkedAccountId ?? undefined,
          }),
        },
        token,
      );
      setGroupForm((current) => ({ ...current, groupName: '', externalGroupId: '', active: true }));
      await loadProtectedData(token);
      setSuccess('WhatsApp source mapped. Patrol images from this source will import.');
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : 'Failed to create WhatsApp mapping');
    } finally {
      setIsBusy(false);
    }
  }

  async function createSchedule(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!token) {
      return;
    }

    setIsBusy(true);
    setError(null);

    try {
      await apiRequest('/patrol-schedules', { method: 'POST', body: JSON.stringify(scheduleForm) }, token);
      await loadProtectedData(token);
      setSuccess('Patrol schedule saved.');
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : 'Failed to create schedule');
    } finally {
      setIsBusy(false);
    }
  }

  async function refreshDiscoveredSources(): Promise<void> {
    if (!token) {
      return;
    }

    setIsBusy(true);
    setError(null);

    try {
      await apiRequest('/collectors/whatsapp/refresh-sources', { method: 'POST' }, token);
      await loadProtectedData(token);
      setSuccess('Refreshing WhatsApp chat list…');
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : 'Failed to refresh WhatsApp chats');
    } finally {
      setIsBusy(false);
    }
  }

  async function mapAndSaveDetectedSource(
    source: { id: string; name: string },
    sourceType: PatrolSourceType,
  ): Promise<void> {
    if (!token) {
      setError('Admin session required. Go back to step 1 and save company details.');
      return;
    }

    const siteId = groupForm.siteId || sites[0]?.id;
    if (!siteId) {
      setError('Create a site first, then map a WhatsApp source to it.');
      return;
    }

    if (!activeLinkedAccountId) {
      setError('Connect WhatsApp first so the linked account can be recorded before mapping sources.');
      return;
    }

    if (isSourceAlreadyMapped(source.id)) {
      setDuplicateSourceWarning('This source is already mapped.');
      setError('This source is already mapped.');
      return;
    }

    setIsBusy(true);
    setError(null);
    setDuplicateSourceWarning(null);

    try {
      await apiRequest(
        '/patrol-groups',
        {
          method: 'POST',
          body: JSON.stringify({
            siteId,
            sourceType,
            groupName: source.name,
            externalGroupId: source.id,
            linkedAccountId: activeLinkedAccountId,
            active: true,
          }),
        },
        token,
      );
      await loadProtectedData(token);
      setSuccess(`Mapped "${source.name}" to your site. Images from this source will now import.`);
      setSelectedSource(null);
      setDuplicateSourceWarning(null);
    } catch (mapError) {
      setError(mapError instanceof Error ? mapError.message : 'Failed to map WhatsApp source');
    } finally {
      setIsBusy(false);
    }
  }

  async function runConfigurationTest(): Promise<void> {
    if (!token) {
      return;
    }

    setIsBusy(true);
    setError(null);
    setSuccess(null);

    try {
      const mappedGroup = currentAccountMappings[0];
      const mappedSite = sites.find((site) => site.id === mappedGroup?.siteId);
      const result = await apiRequest<DesktopSetupVerificationResult>(
        '/desktop/bootstrap/verify-setup',
        {
          method: 'POST',
          body: JSON.stringify({
            siteCode: mappedSite?.siteCode,
            externalGroupId: mappedGroup?.externalGroupId,
          }),
        },
        token,
      );
      setVerificationResult(result);
      if (result.passed) {
        setSuccess('Configuration test PASSED. Your patrol system is ready.');
      } else {
        setError('Configuration test FAILED. Review the checks below and fix any issues.');
      }
    } catch (testError) {
      setError(testError instanceof Error ? testError.message : 'Configuration test failed');
    } finally {
      setIsBusy(false);
    }
  }

  async function finishSetup(requireMonitoringConfiguration = true): Promise<void> {
    if (!token) {
      return;
    }

    setIsBusy(true);
    setError(null);

    try {
      if (requireMonitoringConfiguration && !hasMappedSources) {
        throw new Error('Map at least one WhatsApp group or contact before finishing setup.');
      }

      if (requireMonitoringConfiguration && schedules.length === 0) {
        throw new Error('Save a patrol schedule before finishing setup.');
      }

      const completedStatus = await apiRequest<DesktopBootstrapStatus>(
        '/desktop/bootstrap/complete-setup',
        { method: 'POST' },
        token,
      );
      const syncedState = await saveDesktopConfig({ setupCompleted: true });
      setBootstrapStatus({
        ...completedStatus,
        setupCompleted: true,
      });
      setDesktopState(syncedState);
      sessionStorage.removeItem(DESKTOP_SETUP_STEP_KEY);
      sessionStorage.removeItem(DESKTOP_SETUP_STORAGE_APPLIED_KEY);
      setSuccess('Setup complete. Opening dashboard…');
      window.dispatchEvent(new Event('patrol:desktop-setup-completed'));
      navigate('/');
    } catch (finishError) {
      setError(finishError instanceof Error ? finishError.message : 'Failed to complete setup');
    } finally {
      setIsBusy(false);
    }
  }

  const collectorStartupTimestamp = collectorStatus?.startupStartedAt
    ? new Date(collectorStatus.startupStartedAt).getTime()
    : null;
  const showQrTimeoutPanel =
    collectorStartupTimestamp !== null &&
    !collectorStatus?.ready &&
    !collectorStatus?.qrCode &&
    now - collectorStartupTimestamp >= 20_000;
  const showNoSourceWarning = collectorStatus?.ready === true && !hasMappedSources;

  if (!isDesktop) {
    return (
      <EmptyState
        title="Desktop setup is only available in the installed app"
        description="Open the PatrolSafe desktop app to run first-launch setup."
      />
    );
  }

  return (
    <div className="page-stack">
      <PageHeader
        title={recoverySetup ? 'Workspace Setup' : 'First-Run Setup'}
        subtitle={
          recoverySetup
            ? 'Review or update company, storage, WhatsApp, and site settings without deleting existing data.'
            : 'Four steps: company login, storage folder, WhatsApp, then site mapping.'
        }
        actions={<BuildLabel />}
      />

      <Card className="wizard-stepper">
        <div className="wizard-step-list">
          {wizardSteps.map((wizardStep) => (
            <button
              key={wizardStep.value}
              type="button"
              className={`wizard-step ${step === wizardStep.value ? 'wizard-step-active' : ''}`}
              onClick={() => setStep(wizardStep.value)}
            >
              {wizardStep.label}
            </button>
          ))}
        </div>
      </Card>

      {error ? (
        <Card>
          <p className="error-text">{error}</p>
        </Card>
      ) : null}

      {success ? (
        <Card>
          <p className="success-text">{success}</p>
        </Card>
      ) : null}

      {step === 'company' ? (
        <Card className="wizard-card">
          <h3>Company and admin login</h3>
          <p className="muted-text">Create the local company and admin account used to sign in to this workstation.</p>
          <form className="form-grid" onSubmit={(event) => void submitCompanyStep(event)}>
            <div className="two-column-grid">
              <label>
                Company name
                <input
                  value={setupForm.companyName}
                  onChange={(event) => setSetupForm((current) => ({ ...current, companyName: event.target.value }))}
                  required
                />
              </label>
              <label>
                Workspace name
                <input
                  value={setupForm.workspaceName}
                  onChange={(event) => setSetupForm((current) => ({ ...current, workspaceName: event.target.value }))}
                  required
                />
              </label>
            </div>
            <div className="two-column-grid">
              <label>
                Admin first name
                <input
                  value={setupForm.adminFirstName}
                  onChange={(event) => setSetupForm((current) => ({ ...current, adminFirstName: event.target.value }))}
                  required
                />
              </label>
              <label>
                Admin last name
                <input
                  value={setupForm.adminLastName}
                  onChange={(event) => setSetupForm((current) => ({ ...current, adminLastName: event.target.value }))}
                  required
                />
              </label>
            </div>
            <div className="two-column-grid">
              <label>
                Admin email
                <input
                  type="email"
                  value={setupForm.adminEmail}
                  onChange={(event) => setSetupForm((current) => ({ ...current, adminEmail: event.target.value }))}
                  required
                />
              </label>
              <label>
                Admin password
                <input
                  type="password"
                  value={setupForm.adminPassword}
                  onChange={(event) => setSetupForm((current) => ({ ...current, adminPassword: event.target.value }))}
                  required
                />
              </label>
            </div>
            <p className="muted-text">
              WhatsApp linking starts only when an administrator selects Link WhatsApp from Monitoring.
            </p>
            <div className="button-row">
              <button type="submit" className="primary-button" disabled={isBusy}>
                Continue to storage
              </button>
            </div>
          </form>
        </Card>
      ) : null}

      {step === 'storage' ? (
        <Card className="wizard-card">
          <h3>Choose where patrol images are stored</h3>
          <form className="form-grid" onSubmit={(event) => void saveStorageStep(event)}>
            <label>
              Patrol image storage folder
              <div className="input-button-row">
                <input
                  value={setupForm.storageRootPath}
                  onChange={(event) => {
                    setSetupForm((current) => ({ ...current, storageRootPath: event.target.value }));
                    setStorageSettingsApplied(false);
                  }}
                  placeholder="D:\Patrol_Evidence"
                  required
                />
                <button type="button" className="secondary-button" onClick={() => void handleChooseStoragePath()}>
                  Browse folder
                </button>
              </div>
            </label>
            <p className="muted-text">
              Patrol images are saved in this folder. The database stays in the app data folder.
            </p>
            <div className="ops-stats-grid compact">
              <div className="ops-stat">
                <span>Database path</span>
                <strong>{bootstrapStatus?.databasePath ?? 'Created automatically in app data'}</strong>
              </div>
              <div className="ops-stat">
                <span>Active patrol image path</span>
                <strong>{bootstrapStatus?.activeStorageRootPath ?? setupForm.storageRootPath ?? 'Not set yet'}</strong>
              </div>
            </div>
            <div className="button-row">
              <button type="submit" className="primary-button" disabled={isBusy}>
                Continue to WhatsApp
              </button>
            </div>
          </form>
        </Card>
      ) : null}

      {step === 'whatsapp' ? (
        <Card className="wizard-card">
          <h3>Connect WhatsApp</h3>
          <p className="muted-text">
            Click Connect WhatsApp below to show the QR code. WhatsApp will not start until you click.
          </p>

          {showNoSourceWarning ? (
            <Card className="ops-banner ops-banner-warning">
              <strong>No WhatsApp source mapped</strong>
              <p className="muted-text">
                WhatsApp is connected but no patrol group or contact is mapped yet. Images will not import until you map
                a source in the next step.
              </p>
            </Card>
          ) : null}

          {collectorStatus ? (
            <>
              <div className="ops-stats-grid compact">
                <div className="ops-stat">
                  <span>Status</span>
                  <strong>{collectorStateLabel(collectorStatus.state)}</strong>
                </div>
                <div className="ops-stat">
                  <span>Ready</span>
                  <strong>{collectorStatus.ready ? 'Yes' : 'No'}</strong>
                </div>
                <div className="ops-stat">
                  <span>Mapped sources</span>
                  <strong>{mappedSourcesCount}</strong>
                </div>
                <div className="ops-stat">
                  <span>Stage</span>
                  <strong>{collectorStageLabel(collectorStatus)}</strong>
                </div>
                <div className="ops-stat">
                  <span>Current WhatsApp account</span>
                  <strong>{activeLinkedAccountId ?? 'Not linked yet'}</strong>
                </div>
              </div>
              <div className="button-row setup-whatsapp-actions">
                <button
                  type="button"
                  className="primary-button setup-action-button"
                  disabled={isBusy}
                  onClick={() =>
                    void collectorAction(
                      collectorStatus.state === 'LINK_RETRY_REQUIRED'
                        ? '/collectors/whatsapp/retry-link'
                        : '/collectors/whatsapp/start',
                    )
                  }
                >
                  {collectorStatus.state === 'LINK_RETRY_REQUIRED' ? 'Try Again' : 'Connect WhatsApp'}
                </button>
                <button
                  type="button"
                  className="secondary-button setup-action-button"
                  disabled={isBusy}
                  onClick={() => void resetWhatsAppSession()}
                >
                  Reset WhatsApp session
                </button>
                <button
                  type="button"
                  className="secondary-button setup-action-button"
                  disabled={!collectorStatus.collectorLogPath}
                  onClick={() => void openDesktopPath(collectorStatus.collectorLogPath)}
                >
                  Open debug log
                </button>
                <button
                  type="button"
                  className="secondary-button setup-action-button"
                  disabled={isBusy}
                  onClick={() => void finishSetup(false)}
                >
                  Set up WhatsApp later
                </button>
                <button type="button" className="secondary-button setup-action-button" onClick={() => setStep('site-setup')}>
                  Continue to site &amp; mapping
                </button>
              </div>
              {collectorStatus.sessionCorruptionSuspected ? (
                <Card className="ops-banner ops-banner-warning">
                  <strong>WhatsApp session issue</strong>
                  <p className="muted-text">
                    {collectorStatus.sessionCorruptionMessage ??
                      'WhatsApp session appears corrupted. Reset WhatsApp session.'}
                  </p>
                  <button
                    type="button"
                    className="secondary-button setup-action-button"
                    disabled={isBusy}
                    onClick={() => void resetWhatsAppSession()}
                  >
                    Reset WhatsApp session
                  </button>
                </Card>
              ) : null}
              {collectorStatus.lastError || collectorStatus.failureCode || showQrTimeoutPanel ? (
                <Card className="wizard-card">
                  <h3>
                    {collectorStatus.state === 'LINK_RETRY_REQUIRED'
                      ? 'WhatsApp could not initialise'
                      : collectorStatus.failureCode === 'WWEBJS_MODULE_COMPATIBILITY_ERROR'
                      ? 'WhatsApp Web compatibility'
                      : showQrTimeoutPanel
                        ? 'QR is taking longer than expected'
                        : 'Connection issue'}
                  </h3>
                  <p className="muted-text">
                    {collectorStatus.state === 'LINK_RETRY_REQUIRED'
                      ? 'Check your internet connection and try again.'
                      : collectorStatus.failureCode === 'WWEBJS_MODULE_COMPATIBILITY_ERROR' ||
                    collectorStatus.lastError?.toLowerCase().includes('not compatible')
                      ? 'WhatsApp connected, but this WhatsApp Web version is not compatible with the installed collector runtime.'
                      : (collectorStatus.lastError ?? 'Retry Connect WhatsApp.')}
                  </p>
                </Card>
              ) : null}
              {collectorStatus.qrCode ? (
                <div className="collector-qr-wrap large">
                  <QRCode value={collectorStatus.qrCode} size={240} />
                  <p className="muted-text">Scan with the patrol phone. QR received: {formatDateTime(collectorStatus.lastQrAt)}</p>
                </div>
              ) : null}
            </>
          ) : (
            <p className="muted-text">Complete step 1 first to load the admin session, then connect WhatsApp.</p>
          )}
        </Card>
      ) : null}

      {step === 'site-setup' ? (
        <div className="page-stack">
          <Card className="wizard-card">
            <h3>WhatsApp account</h3>
            <p className="muted-text">
              Current WhatsApp account: <strong>{activeLinkedAccountId ?? 'Not linked yet'}</strong>
            </p>
            {oldAccountMappings.length > 0 ? (
              <p className="muted-text">
                {oldAccountMappings.length} mapping(s) from a previous WhatsApp account are kept for history and are not
                used for live ingest.
              </p>
            ) : null}
          </Card>

          {showNoSourceWarning ? (
            <Card className="ops-banner ops-banner-warning">
              <strong>No WhatsApp source mapped</strong>
              <p className="muted-text">
                WhatsApp is live but image count will stay at 0 until you map a detected group or contact below.
              </p>
            </Card>
          ) : null}

          <div className="setup-mapping-layout">
            <Card className="wizard-card setup-mapping-left">
              <h3>Add site</h3>
              <form className="form-grid" onSubmit={(event) => void createSite(event)}>
                <div className="two-column-grid">
                  <label>
                    Site code
                    <input
                      value={siteForm.siteCode}
                      onChange={(event) => setSiteForm((current) => ({ ...current, siteCode: event.target.value }))}
                      required
                    />
                  </label>
                  <label>
                    Site name
                    <input
                      value={siteForm.siteName}
                      onChange={(event) => setSiteForm((current) => ({ ...current, siteName: event.target.value }))}
                      required
                    />
                  </label>
                </div>
                <label>
                  Client name
                  <input
                    value={siteForm.clientName}
                    onChange={(event) => setSiteForm((current) => ({ ...current, clientName: event.target.value }))}
                  />
                </label>
                <button type="submit" className="primary-button" disabled={isBusy}>
                  Create site
                </button>
              </form>

              {hasSites ? (
                <>
                  <h3>Map WhatsApp source</h3>
                  {(selectedSource || groupForm.externalGroupId.trim()) && (
                    <div className="setup-source-selected">
                      Selected:{' '}
                      <strong>{selectedSource?.name || groupForm.groupName || 'Manual entry'}</strong> —{' '}
                      <code>{selectedSource?.id || groupForm.externalGroupId}</code>
                    </div>
                  )}
                  {duplicateSourceWarning ? (
                    <p className="setup-source-warning">{duplicateSourceWarning}</p>
                  ) : null}
                  <form className="form-grid" onSubmit={(event) => void createGroup(event)}>
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
                            {site.siteCode} - {site.siteName}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Display name
                      <input
                        value={groupForm.groupName}
                        onChange={(event) => setGroupForm((current) => ({ ...current, groupName: event.target.value }))}
                        required
                      />
                    </label>
                    <label>
                      WhatsApp chat ID
                      <input
                        value={groupForm.externalGroupId}
                        onChange={(event) =>
                          setGroupForm((current) => ({ ...current, externalGroupId: event.target.value }))
                        }
                        required
                      />
                    </label>
                    <button type="submit" className="secondary-button setup-source-save-button" disabled={isBusy}>
                      Save mapping manually
                    </button>
                  </form>
                </>
              ) : null}
            </Card>

            <Card className="wizard-card setup-mapping-right">
              <div className="setup-source-panel">
              <div className="section-header">
                <h3>All WhatsApp chats</h3>
                <button
                  type="button"
                  className="secondary-button setup-source-map-button"
                  disabled={isBusy || !collectorStatus?.ready}
                  onClick={() => void refreshDiscoveredSources()}
                >
                  Refresh chats
                </button>
              </div>
              {detectableSources.length === 0 ? (
                <p className="muted-text">
                  No chats visible yet. Connect WhatsApp in step 3, wait a few seconds, then click Refresh chats.
                </p>
              ) : (
                <>
                  <div className="setup-source-toolbar">
                    <label className="setup-source-search">
                      Search
                      <input
                        value={sourceSearch}
                        onChange={(event) => setSourceSearch(event.target.value)}
                        placeholder="Search by name or WhatsApp ID"
                      />
                    </label>
                    <div className="setup-source-filter-tabs" role="tablist" aria-label="Filter sources">
                      {(
                        [
                          ['all', 'All'],
                          ['groups', 'Groups'],
                          ['contacts', 'Contacts'],
                          ['unmapped', 'Unmapped'],
                          ['mapped', 'Mapped'],
                        ] as const
                      ).map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          role="tab"
                          aria-selected={sourceFilter === value}
                          className={sourceFilter === value ? 'setup-source-filter-tab active' : 'setup-source-filter-tab'}
                          onClick={() => setSourceFilter(value)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {selectedSource ? (
                    <div className="setup-source-selected">
                      Selected: <strong>{selectedSource.name}</strong> — <code>{selectedSource.id}</code>
                    </div>
                  ) : null}

                  {duplicateSourceWarning ? (
                    <p className="setup-source-warning">{duplicateSourceWarning}</p>
                  ) : null}

                  <div className="setup-source-table-wrap setup-source-table-scroll">
                    <table className="setup-source-table">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>WhatsApp ID</th>
                          <th>Type</th>
                          <th>Status</th>
                          <th aria-label="Actions" />
                        </tr>
                      </thead>
                      <tbody>
                        {filteredDetectableSources.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="setup-source-empty">
                              No sources match your search or filter.
                            </td>
                          </tr>
                        ) : (
                          filteredDetectableSources.map((source) => {
                            const isMapped = mappedExternalIds.has(source.id);
                            const isSelected = selectedSource?.id === source.id;
                            return (
                              <tr key={source.id} className={isSelected ? 'selected' : undefined}>
                                <td className="setup-source-name">{source.name}</td>
                                <td className="setup-source-id">
                                  <code>{source.id}</code>
                                </td>
                                <td>{source.sourceType === 'group' ? 'Group' : 'Contact'}</td>
                                <td>
                                  <StatusBadge value={isMapped ? 'MAPPED' : 'UNMAPPED'} />
                                </td>
                                <td className="setup-source-action">
                                  <button
                                    type="button"
                                    className="setup-source-map-button"
                                    disabled={isBusy || !hasSites || !activeLinkedAccountId || isMapped}
                                    onClick={() => {
                                      selectSourceForMapping(source);
                                      void mapAndSaveDetectedSource(source, source.sourceType);
                                    }}
                                  >
                                    Map
                                  </button>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                  <p className="muted-text setup-source-count">
                    Showing {filteredDetectableSources.length} of {detectableSources.length} detected source(s).
                  </p>
                </>
              )}

              {currentAccountMappings.length > 0 ? (
                <div className="setup-source-saved">
                  <h4>Saved mappings for this account</h4>
                  <div className="setup-source-table-wrap setup-source-table-scroll">
                    <table className="setup-source-table compact">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>WhatsApp ID</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {currentAccountMappings.map((group) => (
                          <tr key={group.id}>
                            <td className="setup-source-name">{group.groupName}</td>
                            <td className="setup-source-id">
                              <code>{group.externalGroupId}</code>
                            </td>
                            <td>
                              <StatusBadge value={group.active ? 'MAPPED' : 'INACTIVE'} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}

              {oldAccountMappings.length > 0 ? (
                <details className="setup-source-saved">
                  <summary>
                    <h4>Old mappings ({oldAccountMappings.length})</h4>
                  </summary>
                  <div className="setup-source-table-wrap setup-source-table-scroll">
                    <table className="setup-source-table compact">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>WhatsApp ID</th>
                          <th>Previous account</th>
                        </tr>
                      </thead>
                      <tbody>
                        {oldAccountMappings.map((group) => (
                          <tr key={group.id}>
                            <td className="setup-source-name">{group.groupName}</td>
                            <td className="setup-source-id">
                              <code>{group.externalGroupId}</code>
                            </td>
                            <td className="muted-text">{group.linkedAccountId ?? 'Unscoped legacy mapping'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              ) : null}
              </div>
            </Card>
          </div>

          <Card className="wizard-card">
            <h3>Patrol schedules</h3>
            {!hasSites ? (
              <p className="muted-text">Create a site first.</p>
            ) : (
              <>
                {schedules.length > 0 ? (
                  <div className="stack-list">
                    {schedules.map((schedule) => {
                      const site = sites.find((entry) => entry.id === schedule.siteId);
                      return (
                        <div className="list-row" key={schedule.id}>
                          <div>
                            <strong>{schedule.scheduleName || 'Shift'}</strong>
                            <p className="muted-text">
                              {site?.siteCode ?? 'Site'} · {String(schedule.startHour).padStart(2, '0')}:00–
                              {String(schedule.endHour).padStart(2, '0')}:00 · every {schedule.frequencyMinutes} min ·{' '}
                              {schedule.expectedGuards} expected guard{schedule.expectedGuards === 1 ? '' : 's'}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
                <form className="form-grid" onSubmit={(event) => void createSchedule(event)}>
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
                          {site.siteCode} - {site.siteName}
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
                      required
                    />
                  </label>
                  <div className="two-column-grid">
                    <label>
                      Start time (hour)
                      <input
                        type="number"
                        min={0}
                        max={23}
                        value={scheduleForm.startHour}
                        onChange={(event) =>
                          setScheduleForm((current) => ({ ...current, startHour: Number(event.target.value) }))
                        }
                        required
                      />
                    </label>
                    <label>
                      End time (hour)
                      <input
                        type="number"
                        min={0}
                        max={23}
                        value={scheduleForm.endHour}
                        onChange={(event) =>
                          setScheduleForm((current) => ({ ...current, endHour: Number(event.target.value) }))
                        }
                        required
                      />
                    </label>
                  </div>
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
                  <div className="two-column-grid">
                    <label>
                      Patrol interval (minutes)
                      <input
                        type="number"
                        min={5}
                        value={scheduleForm.frequencyMinutes}
                        onChange={(event) =>
                          setScheduleForm((current) => ({ ...current, frequencyMinutes: Number(event.target.value) }))
                        }
                        required
                      />
                    </label>
                    <label>
                      Expected guards
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
                  </div>
                  <label>
                    Grace (minutes)
                    <input
                      type="number"
                      min={0}
                      value={scheduleForm.graceMinutes}
                      onChange={(event) =>
                        setScheduleForm((current) => ({ ...current, graceMinutes: Number(event.target.value) }))
                      }
                      required
                    />
                  </label>
                  <button type="submit" className="secondary-button" disabled={isBusy}>
                    Save schedule
                  </button>
                </form>
              </>
            )}
          </Card>

          <Card className="wizard-card">
            <h3>Configuration test</h3>
            <p className="muted-text">
              Verifies WhatsApp, source mapping, storage folder, schedule, and saves a test patrol image.
            </p>
            <div className="ops-stats-grid compact">
              <div className="ops-stat">
                <span>Database path</span>
                <strong>{bootstrapStatus?.databasePath ?? 'Unknown'}</strong>
              </div>
              <div className="ops-stat">
                <span>Active image storage</span>
                <strong>{bootstrapStatus?.activeStorageRootPath ?? 'Not set'}</strong>
              </div>
              <div className="ops-stat">
                <span>Mapped sources</span>
                <strong>{mappedSourcesCount}</strong>
              </div>
              <div className="ops-stat">
                <span>Schedules</span>
                <strong>{schedules.length}</strong>
              </div>
            </div>
            <div className="button-row">
              <button type="button" className="primary-button" disabled={isBusy} onClick={() => void runConfigurationTest()}>
                Send test / check configuration
              </button>
              <button type="button" className="secondary-button" disabled={isBusy} onClick={() => void finishSetup(true)}>
                Finish setup and open dashboard
              </button>
            </div>
            {verificationResult ? (
              <div className="stack-list">
                <h4>{verificationResult.passed ? 'PASS' : 'FAIL'}</h4>
                {verificationResult.checks.map((check) => (
                  <div key={check.name} className="list-row">
                    <div>
                      <strong>{check.passed ? 'PASS' : 'FAIL'} — {check.name}</strong>
                      <p>{check.message}</p>
                    </div>
                    <StatusBadge value={check.passed ? 'PASS' : 'FAIL'} />
                  </div>
                ))}
              </div>
            ) : null}
          </Card>
        </div>
      ) : null}
    </div>
  );
}
