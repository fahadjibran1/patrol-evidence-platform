export type UserRole = 'ADMIN' | 'COMPANY_ADMIN' | 'GUARD';

export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  companyId: string | null;
  active: boolean;
  approved: boolean;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

export interface ApiErrorPayload {
  message?: string | string[];
  error?: string;
  statusCode?: number;
}

export interface Site {
  id: string;
  companyId: string;
  siteCode: string;
  siteName: string;
  clientName?: string;
  active: boolean;
  archivedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DashboardOverview {
  date: string;
  siteTotals: {
    active: number;
    withScheduledSlots: number;
  };
  slotTotals: Record<string, number>;
  imageTotals: {
    received: number;
  };
  alerts: {
    unresolved: number;
  };
  recentImages: Array<{
    id: string;
    siteCode: string;
    sentAt: string;
    status: string;
    senderName?: string;
  }>;
}

export interface DashboardSiteRow {
  siteId: string;
  siteCode: string;
  siteName: string;
  clientName?: string;
  safeHours: number;
  missingHours: number;
  pendingHours: number;
  imagesReceived: number;
  unresolvedAlerts: number;
  latestImageAt: string | null;
}

export interface DashboardHourlySafetyCell {
  hour: number;
  status: 'Safe' | 'Missing' | 'Pending';
  safeFlag: boolean;
  firstPictureTime: string | null;
  firstSenderName: string | null;
  firstImageId: string | null;
  imageCount: number;
}

export interface DashboardHourlySafetyRow {
  siteId: string;
  siteCode: string;
  siteName: string;
  groupId: string | null;
  groupName: string | null;
  hourlyCells: DashboardHourlySafetyCell[];
}

export interface DashboardHourlyGuardStatusEntry {
  guardId: string;
  guardName: string;
  status: 'Reported' | 'Missing';
  firstPictureTime: string | null;
  totalPicturesInHour: number;
  senderNumber: string | null;
}

export interface DashboardHourlyGuardStatusRow {
  date: string;
  siteId: string;
  siteCode: string;
  siteName: string;
  groupId: string | null;
  groupName: string | null;
  hour: number;
  siteStatus: 'Safe' | 'Missing' | 'Pending';
  expectedGuards: DashboardHourlyGuardStatusEntry[];
}

export interface WhatsAppCollectorStatus {
  enabled: boolean;
  connected: boolean;
  ready: boolean;
  state:
    | 'disabled'
    | 'idle'
    | 'starting'
    | 'RECONNECT_AUTHORIZATION_PENDING'
    | 'RELINK_REQUIRED'
    | 'LINK_RETRY_REQUIRED'
    | 'browser-launching'
    | 'whatsapp-loading'
    | 'waiting-for-qr'
    | 'qr-ready'
    | 'authenticated'
    | 'waiting-for-client-info'
    | 'ready'
    | 'disconnected'
    | 'failed';
  info: string;
  sessionPath: string;
  sessionCorruptionSuspected?: boolean;
  sessionCorruptionMessage?: string | null;
  qrCode: string | null;
  lastQrAt: string | null;
  lastMessageAt: string | null;
  lastEventAt: string | null;
  lastReadyAt: string | null;
  lastDisconnectAt: string | null;
  lastBackfillAt: string | null;
  connectedAccount: string | null;
  backfillRunning: boolean;
  backfillMessagesScanned: number;
  backfillImagesImported: number;
  backfillDuplicatesSkipped: number;
  liveMessagesProcessed?: number;
  liveImagesImported?: number;
  liveDuplicatesSkipped?: number;
  productionListenerCount?: number;
  allowFromMe: boolean;
  mappedGroupsCount: number;
  pilotGroupName: string | null;
  startupStage: string | null;
  startupStartedAt: string | null;
  lastError: string | null;
  failureCode?: string | null;
  collectorLogPath: string;
  latestQrPath: string;
  qrPayloadLength: number | null;
  qrPersistedAt: string | null;
  qrDeliveredAt: string | null;
  collectorLogTail: string[];
  browserExecutablePath: string | null;
  browserExecutableSource: string | null;
  browserCandidatesTried: string[];
  sessionPathExists: boolean;
  sessionPathWritable: boolean;
  certificationState?: 'DISABLED' | 'EXPECTING_QR_ONLY' | 'AUTHENTICATION_AUTHORIZED' | 'UNEXPECTED_AUTHENTICATION';
  certificationQrMasked?: boolean;
  monitoringPreference?: 'ENABLED' | 'PAUSED';
  monitoringState?: 'ACTIVE' | 'PAUSED' | 'NO_GROUPS_CONFIGURED' | 'STARTING' | 'ERROR';
}

export interface WhatsAppCollectorGroup {
  id: string;
  name: string;
  isGroup?: true;
  sourceType?: 'group';
  isReadOnly: boolean;
  unreadCount: number;
}

export interface WhatsAppCollectorContact {
  id: string;
  name: string;
  isGroup?: false;
  sourceType?: 'contact';
  unreadCount: number;
}

export type PatrolSourceType = 'group' | 'contact';

export interface PatrolSlot {
  id: string;
  siteId: string;
  slotStart: string;
  slotEnd: string;
  expectedAt: string;
  status: string;
  imageId: string | null;
  resolvedAt: string | null;
}

export interface PatrolGroup {
  id: string;
  siteId: string;
  groupName: string;
  externalGroupId?: string;
  sourceType?: PatrolSourceType;
  linkedAccountId?: string;
  active: boolean;
  createdAt: string;
  site?: Site;
}

export interface PatrolSchedule {
  id: string;
  siteId: string;
  scheduleName: string;
  expectedGuards: number;
  frequencyMinutes: number;
  startHour: number;
  endHour: number;
  is24Hours?: boolean;
  graceMinutes: number;
  activeDays: number[];
  active: boolean;
  createdAt: string;
  site?: Site;
}

export interface Incident {
  id: string;
  guardId: string;
  companyId: string;
  siteId: string;
  description: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  status: 'OPEN' | 'IN_REVIEW' | 'RESOLVED';
  createdAt: string;
  updatedAt: string;
  site?: Site;
  guard?: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    role: UserRole;
  };
}

export interface PatrolAlert {
  id: string;
  siteId: string;
  slotId: string | null;
  guardId: string | null;
  alertType: 'MISSING_PATROL' | 'WELFARE' | 'EMERGENCY';
  alertMessage: string;
  alertTime: string;
  isResolved: boolean;
  resolvedAt: string | null;
  createdAt: string;
  site?: Site;
}

export interface PatrolImageRecord {
  id: string;
  siteId: string;
  groupId?: string;
  collectorType: 'WHATSAPP' | 'GUARD_APP' | 'MANUAL';
  senderName?: string;
  senderNumber?: string;
  senderExternalId?: string;
  messageExternalId?: string;
  sentAt: string;
  receivedAt: string;
  patrolDate: string;
  patrolHour: number;
  originalFileName?: string;
  storedFileName: string;
  filePath: string;
  mimeType: string;
  status: string;
  notes?: string;
  site?: Site;
  group?: PatrolGroup;
}

export interface DesktopWorkspaceConfig {
  setupCompleted?: boolean;
  workspaceName?: string;
  companyName?: string;
  licenseKey?: string;
  licenseType?: 'TRIAL' | 'FULL' | 'MONTHLY' | 'ANNUAL';
  licenseStatus?: 'ACTIVE' | 'EXPIRED' | 'INVALID' | 'NOT_ACTIVATED';
  trialStartDate?: string;
  trialEndDate?: string;
  licenseCreatedAt?: string;
  licenseUpdatedAt?: string;
  storageRootPath?: string;
  autoLaunchApp?: boolean;
  autoStartCollector?: boolean;
  whatsappHeadless?: boolean;
  whatsappAllowFromMe?: boolean;
  whatsappChromePath?: string;
  whatsappBrowser?: 'chrome' | 'edge' | 'auto';
  whatsappPilotGroupName?: string;
  whatsappPilotSiteCode?: string;
  linkedWhatsAppAccountId?: string;
  appTimeZone?: string;
  dbType?: 'sqlite' | 'postgres';
  sqliteDbPath?: string;
  dbHost?: string;
  dbPort?: number;
  dbUser?: string;
  dbPassword?: string;
  dbName?: string;
  localAdminEmail?: string;
  localAdminFirstName?: string;
  localAdminLastName?: string;
  lastSetupAt?: string;
}

export interface LicenseSnapshot {
  companyName: string | null;
  licenseKey: string | null;
  licenseId: string | null;
  licenseType: 'TRIAL' | 'FULL' | 'MONTHLY' | 'ANNUAL';
  plan: 'trial' | 'monthly' | 'annual' | null;
  displayMode: 'Trial' | 'Licensed' | 'Not activated';
  legacy: boolean;
  trialStartDate: string | null;
  trialEndDate: string | null;
  startsAt: string | null;
  expiresAt: string | null;
  status: 'ACTIVE' | 'TRIAL_ACTIVE' | 'EXPIRED' | 'INVALID' | 'NOT_ACTIVATED';
  daysRemaining: number;
  installationId: string | null;
  maxDevices: number | null;
  features: string[];
  activatedAt: string | null;
  lastSuccessfulValidationAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  message: string;
  collectorAllowed: boolean;
  operationsAllowed: boolean;
  requiresActivation: boolean;
}

export interface LicenseStatusResponse {
  status: 'ACTIVE' | 'TRIAL_ACTIVE' | 'EXPIRED' | 'INVALID' | 'NOT_ACTIVATED';
  displayMode: 'Trial' | 'Licensed' | 'Not activated';
  uiState?: 'Trial Active' | 'Licensed' | 'Expired' | 'Invalid' | 'Not activated';
  plan: 'trial' | 'monthly' | 'annual' | null;
  companyName: string | null;
  licenseId: string | null;
  customerEmail: string | null;
  startsAt: string | null;
  expiresAt: string | null;
  daysRemaining: number;
  maxDevices: number | null;
  features: string[];
  featureFlags?: {
    whatsappMonitoring: boolean;
    guardSafe: boolean;
    evidence: boolean;
    alerts: boolean;
    incidents: boolean;
    exports: boolean;
  };
  installationId: string | null;
  machineFingerprint?: string | null;
  activatedAt: string | null;
  lastSuccessfulValidationAt: string | null;
  legacy: boolean;
  message: string;
  collectorAllowed: boolean;
  operationsAllowed: boolean;
  requiresActivation: boolean;
  mode?: 'trial' | 'commercial' | 'unlicensed' | 'invalid';
  buildId?: string | null;
  appVersion?: string | null;
  diagnostics?: {
    dataRoot: string | null;
    trialFilePath: string | null;
    trialMarkerPresent: boolean;
    licensingDirectoryWritable: boolean | null;
    lastTrialBootstrapError: string | null;
    cryptoMode: 'dpapi' | 'test';
    trialCreationDisabled: boolean;
  };
}

export interface DesktopPostgresConfig {
  dbHost: string;
  dbPort: number;
  dbUser: string;
  dbPassword: string;
  dbName: string;
}

export interface DesktopState {
  isDesktop: boolean;
  apiBaseUrl: string;
  configPath: string | null;
  config: DesktopWorkspaceConfig;
  backend: {
    status: 'stopped' | 'starting' | 'ready' | 'error';
    startedAt: string | null;
    lastExitAt: string | null;
    pid: number | null;
  };
}

export interface DesktopBootstrapStatus {
  desktopMode: boolean;
  configPath: string | null;
  setupCompleted: boolean;
  workspaceName: string | null;
  storageRootPath: string | null;
  activeStorageRootPath: string | null;
  patrolImageStoragePath: string | null;
  companyName: string | null;
  localAdminEmail: string | null;
  dbConfigured: boolean;
  dbType: 'sqlite' | 'postgres';
  databasePath: string | null;
  databaseReady: boolean;
  databaseFileCreated: boolean;
  schemaReady: boolean;
  hasCompany: boolean;
  hasCompanyAdmin: boolean;
  autoLaunchApp: boolean;
  autoStartCollector: boolean;
  whatsappAllowFromMe: boolean;
  linkedWhatsAppAccountId: string | null;
  settingsApplied: boolean;
  license: LicenseSnapshot;
}

export interface DesktopSetupVerificationCheck {
  name: string;
  passed: boolean;
  message: string;
}

export interface DesktopSetupVerificationResult {
  passed: boolean;
  checks: DesktopSetupVerificationCheck[];
}

export interface DesktopPostgresStatus {
  host: string;
  port: number;
  user: string;
  database: string;
  localServerExpected: boolean;
  postgresInstalled: boolean | null;
  detectedBinaryPath: string | null;
  installGuideUrl: string;
  reachable: boolean;
  credentialsValid: boolean;
  databaseExists: boolean;
  schemaReady: boolean;
  migrationsRan: boolean;
  issueCode:
    | 'NOT_CHECKED'
    | 'READY'
    | 'SERVICE_NOT_RUNNING'
    | 'WRONG_PASSWORD'
    | 'DATABASE_MISSING'
    | 'MIGRATIONS_MISSING'
    | 'UNKNOWN';
  issueTitle: string;
  plainMessage: string;
  recommendedAction: string;
  checkedAt: string | null;
  message: string;
  error: string | null;
}
