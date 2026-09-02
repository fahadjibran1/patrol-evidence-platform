export type AdminRole = 'SUPER_ADMIN' | 'ADMIN' | 'SUPPORT';

export type CustomerStatus = 'PROSPECT' | 'TRIAL' | 'ACTIVE' | 'SUSPENDED' | 'CLOSED';

export type LicensePlan = 'TRIAL' | 'MONTHLY' | 'ANNUAL';

export type LicenseStatus = 'DRAFT' | 'ACTIVE' | 'EXPIRED' | 'SUSPENDED' | 'REVOKED';

export type EffectiveLicenseStatus =
  | 'DRAFT'
  | 'SCHEDULED'
  | 'ACTIVE'
  | 'EXPIRING_SOON'
  | 'EXPIRED'
  | 'SUSPENDED'
  | 'REVOKED';

export type InstallationStatus = 'PENDING' | 'ACTIVE' | 'DEACTIVATED' | 'BLOCKED';

export type PaymentStatus = 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED' | 'WAIVED';

export interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  role: AdminRole;
  isActive: boolean;
  lastLoginAt?: string | null;
  createdAt?: string;
}

/** Shape returned by POST /admin/auth/login */
export interface LoginAdminPayload {
  sub: string;
  email: string;
  role: AdminRole;
  displayName: string;
}

export interface AuthTokensPayload {
  accessToken: string;
  refreshToken: string;
  expiresIn?: string;
}

export interface LoginResponse {
  admin: LoginAdminPayload;
  tokens: AuthTokensPayload;
}

/** Shape returned by POST /admin/auth/refresh */
export interface RefreshResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn?: string;
}

export interface ApiErrorPayload {
  statusCode?: number;
  code?: string;
  message?: string | string[];
  error?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages?: number;
}

export interface DashboardKpis {
  activeCustomers: number;
  activeLicences: number;
  trialLicences: number;
  monthlyLicences: number;
  annualLicences: number;
  expiredLicences: number;
  expiringIn7Days: number;
  expiringIn30Days: number;
  /** Portal status === SUSPENDED. */
  suspendedLicences?: number;
  /** Portal status === REVOKED. */
  revokedLicences?: number;
  /** Licences that received a RENEWED version this calendar month. */
  renewedThisMonth?: number;
  emailsSentToday: number;
  failedEmailsToday: number;
}

export interface DashboardRenewalQueueItem {
  id: string;
  licenseId: string;
  customerId: string;
  customerName: string;
  plan: LicensePlan;
  status: LicenseStatus;
  effectiveStatus: EffectiveLicenseStatus;
  expiresAt: string;
  daysUntilExpiry: number;
  /** Whether the current admin role may renew this licence (SUPPORT cannot). */
  canRenew?: boolean;
  /** Renewal queue only contains ACTIVE licences, so reactivation never applies here. */
  canReactivate?: boolean;
}

export interface DashboardActivityItem {
  id: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  customerId?: string | null;
  licenceId?: string | null;
  actorDisplayName?: string | null;
  createdAt: string;
}

export interface DashboardNotificationFailure {
  id: string;
  notificationType: string;
  provider: string;
  recipient: string;
  subject: string;
  status: string;
  errorMessage?: string | null;
  createdAt: string;
}

export interface DashboardNotificationHealth {
  sentToday: number;
  failedToday: number;
  pendingToday: number;
  recentFailures: DashboardNotificationFailure[];
}

export interface DashboardRevenue {
  currency: string;
  outstandingPaymentsCount: number;
  outstandingPaymentsAmountPence: number;
  paidTodayCount: number;
  paidTodayAmountPence: number;
  paidThisMonthCount: number;
  paidThisMonthAmountPence: number;
}

export interface DashboardBilling {
  mrrPence: number;
  arrPence: number;
  activeSubscriptions: number;
  trialSubscriptions: number;
  pastDueSubscriptions: number;
  cancelledSubscriptions: number;
  revenueThisMonthPence: number;
  revenueThisYearPence: number;
  invoicesDue: number;
  invoicesOverdue: number;
  currency: string;
}

export interface DashboardStats {
  generatedAt: string;
  kpis: DashboardKpis;
  renewalQueue: DashboardRenewalQueueItem[];
  recentActivity: DashboardActivityItem[];
  notificationHealth: DashboardNotificationHealth;
  revenue?: DashboardRevenue;
  billing?: DashboardBilling;
}

export interface CustomerSummary {
  id: string;
  companyName: string;
  tradingName?: string | null;
  contactName?: string | null;
  email: string;
  phone?: string | null;
  status: CustomerStatus;
  currentPlan?: LicensePlan | null;
  licenceExpiry?: string | null;
  paymentStatus?: PaymentStatus | null;
  installationCount?: number;
  updatedAt: string;
}

export interface CustomerDetail extends CustomerSummary {
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  postcode?: string | null;
  country: string;
  notes?: string | null;
  createdAt: string;
}

export interface LicencePayloadSummary {
  licenseId: string;
  companyName: string;
  customerEmail?: string;
  plan: string;
  issuedAt?: string;
  startsAt: string;
  expiresAt: string;
  maxDevices: number;
  features: string[];
  notes?: string;
}

export interface LicenceSummary {
  id: string;
  licenseId: string;
  customerId: string;
  customerName?: string;
  plan: LicensePlan;
  status: LicenseStatus;
  effectiveStatus: EffectiveLicenseStatus;
  startsAt: string;
  expiresAt: string;
  maxDevices: number;
  maskedLicenseKey?: string | null;
  installationCount?: number;
  issuedAt?: string | null;
  updatedAt: string;
}

export interface NotificationLogEntry {
  id: string;
  notificationType: string;
  provider: string;
  recipient: string;
  subject: string;
  status: string;
  attempts: number;
  sentAt?: string | null;
  errorMessage?: string | null;
  source?: string | null;
  createdAt: string;
  updatedAt?: string;
  actorDisplayName?: string | null;
  actorAdminId?: string | null;
}

export interface SmtpStatus {
  configured: boolean;
  host: string | null;
  port: number | null;
  secure: boolean | null;
  fromName: string | null;
  fromEmail: string | null;
}

/** GET /admin/system/status — ADMIN / SUPER_ADMIN only */
export interface SystemQueueStats {
  name: string;
  waiting: number;
  active: number;
  failed: number;
  delayed: number;
  mode: 'redis' | 'inline';
}

export interface PlatformVersionInfo {
  apiVersion: string;
  portalVersion: string;
  customerPortalVersion: string;
  desktopVersion: string;
  databaseMigrationVersion: string | null;
  gitCommit: string | null;
  buildNumber: string;
  buildTimestamp: string;
  environment: string;
  nodeVersion: string;
}

export interface SystemStatus {
  version: string;
  buildNumber: string;
  environment: string;
  health?: string;
  uptimeSeconds: number;
  versions?: PlatformVersionInfo;
  database: { ok: boolean; migrationVersion?: string | null };
  redis: {
    configured: boolean;
    connected: boolean;
  };
  queue: {
    mode: 'redis' | 'inline';
    queues: SystemQueueStats[];
    pendingEmails: number;
    failedEmails: number;
    pendingJobs?: number;
    failedJobs?: number;
    workers?: string;
  };
  smtp: {
    configured: boolean;
    host: string | null;
    fromEmail: string | null;
  };
  cache: {
    dashboardCachedRoles: number;
  };
  errorReporting?: { provider: string };
  stripe?: {
    enabled: boolean;
    mode: 'TEST' | 'LIVE' | 'DISABLED';
    configured: boolean;
    failedWebhooks?: number;
    deadLetterWebhooks?: number;
    lastProcessedWebhookAt?: string | null;
    lastProcessedWebhookType?: string | null;
    openReconciliationAlerts?: number;
  };
  runtime?: {
    nodeVersion: string;
    pid: number;
    memory: {
      rssBytes: number;
      heapUsedBytes: number;
      heapTotalBytes: number;
      systemTotalBytes: number;
      systemFreeBytes: number;
    };
    cpu: { cores: number; loadAverage: number[] };
    disk: {
      available: boolean;
      totalBytes?: number;
      freeBytes?: number;
      usedBytes?: number;
    };
  };
}

export type LicenceVersionActionType =
  | 'ISSUED'
  | 'RENEWED'
  | 'REISSUED'
  | 'PLAN_CHANGED'
  | 'DEVICE_LIMIT_CHANGED'
  | 'REACTIVATED'
  | 'SUSPENDED'
  | 'REVOKED';

/** One immutable snapshot in a licence's lifecycle history, returned by GET /admin/licences/:id. */
export interface LicenceVersionEntry {
  id: string;
  versionNumber: number;
  actionType: LicenceVersionActionType;
  plan: LicensePlan;
  maxDevices: number;
  features?: string[];
  validFrom: string;
  validUntil: string;
  statusSnapshot: LicenseStatus;
  /** Whether this version carries its own signed TG1 (false for status-only actions). */
  hasSignedLicence?: boolean;
  reason?: string | null;
  previousVersionId?: string | null;
  createdAt: string;
  issuedByDisplayName?: string | null;
  /** Not always provided by the API; the highest versionNumber is authoritative if absent. */
  isCurrent?: boolean;
}

export interface LicenceDetail extends LicenceSummary {
  features: string[];
  notes?: string | null;
  customerEmail?: string;
  payloadSummary?: LicencePayloadSummary;
  signingKeyId?: string | null;
  previousLicenceId?: string | null;
  suspendedAt?: string | null;
  suspensionReason?: string | null;
  revokedAt?: string | null;
  revocationReason?: string | null;
  renewals?: LicenceSummary[];
  installations?: Installation[];
  payments?: PaymentRecord[];
  auditLogs?: AuditLogEntry[];
  notificationLogs?: NotificationLogEntry[];
  /** Lifecycle version history, present on GET /admin/licences/:id. */
  versions?: LicenceVersionEntry[];
  /** Present when the licence is currently SUSPENDED or REVOKED. */
  offlineEnforcementWarning?: string | null;
}

export interface Installation {
  id: string;
  licenceId: string;
  installationId: string;
  deviceLabel?: string | null;
  status: InstallationStatus;
  customerProvidedAt?: string | null;
  firstSeenAt?: string | null;
  lastSeenAt?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
  licenseId?: string;
  companyName?: string;
}

export interface PaymentRecord {
  id: string;
  customerId: string;
  licenceId?: string | null;
  customerName?: string;
  licenseId?: string | null;
  amountPence: number;
  currency: string;
  paymentStatus: PaymentStatus;
  paymentMethod?: string | null;
  paymentReference?: string | null;
  invoiceReference?: string | null;
  paidAt?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuditLogEntry {
  id: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  customerId?: string | null;
  licenceId?: string | null;
  metadata?: Record<string, unknown> | null;
  actorAdminId?: string | null;
  actorDisplayName?: string | null;
  createdAt: string;
}

export interface IssueLicenceRequest {
  customerId: string;
  plan: LicensePlan;
  startsAt: string;
  expiresAt: string;
  maxDevices: number;
  features?: string[];
  customerEmail?: string;
  notes?: string;
  paymentStatus?: PaymentStatus;
  amountPence?: number;
  paymentMethod?: string;
  paymentReference?: string;
  invoiceReference?: string;
  currency?: string;
}

export interface IssueLicenceResponse {
  licence: LicenceDetail;
  licenseKey: string;
  fullLicenseKey?: string;
  signedLicenseKey?: string;
}

export type RenewalPeriod = 'MONTHLY' | 'ANNUAL' | 'CUSTOM';

/** POST /admin/licences/:id/renew */
export interface RenewLicenceRequest {
  renewalPeriod: RenewalPeriod;
  validFrom?: string;
  /** Required when renewalPeriod === 'CUSTOM'. */
  validUntil?: string;
  plan?: LicensePlan;
  maxDevices?: number;
  reason?: string;
  emailAfterRenewal?: boolean;
  recipientEmail?: string;
  /** SUPER_ADMIN only: allows validFrom to create a gap or overlap with the current expiry. */
  allowDateOverride?: boolean;
  password: string;
}

export interface LifecycleEmailResult {
  success: boolean;
  recipient?: string;
  notificationLogId?: string;
  errorCode?: string;
  errorMessage?: string;
}

/** Shared response shape for every lifecycle mutation (renew/reissue/suspend/reactivate/revoke/plan/device-limit). */
export interface LifecycleActionResponse extends LicenceDetail {
  /** Present when the mutation produced a fresh signed TG1 (renew/reissue/change-plan/change-device-limit). */
  fullLicenseKey?: string;
  signedLicenseKey?: string;
  emailResult?: LifecycleEmailResult;
}

/** POST /admin/licences/:id/renew response — renewal always produces a new TG1. */
export type RenewLicenceResponse = LifecycleActionResponse & {
  fullLicenseKey: string;
  signedLicenseKey: string;
};

/** POST /admin/licences/:id/reissue */
export interface ReissueLicenceRequest {
  reason: string;
  password: string;
  emailAfterReissue?: boolean;
  recipientEmail?: string;
}

/** POST /admin/licences/:id/suspend */
export interface SuspendLicenceRequest {
  reason: string;
  password: string;
}

/** POST /admin/licences/:id/reactivate */
export interface ReactivateLicenceRequest {
  reason?: string;
  password: string;
  emailUpdatedLicence?: boolean;
  recipientEmail?: string;
}

/** POST /admin/licences/:id/revoke */
export interface RevokeLicenceRequest {
  reason: string;
  confirmationText: string;
  password: string;
}

/** POST /admin/licences/:id/change-plan */
export interface ChangePlanRequest {
  newPlan: LicensePlan;
  validFrom?: string;
  reason: string;
  password: string;
  emailUpdatedLicence?: boolean;
  recipientEmail?: string;
}

/** POST /admin/licences/:id/change-device-limit */
export interface ChangeDeviceLimitRequest {
  maxDevices: number;
  reason: string;
  password: string;
  emailUpdatedLicence?: boolean;
  recipientEmail?: string;
}

export interface SigningKeyStatus {
  keyId: string;
  ready: boolean;
  algorithm: 'Ed25519' | string;
}

export interface CreateCustomerRequest {
  companyName: string;
  tradingName?: string;
  contactName?: string;
  email: string;
  phone?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  postcode?: string;
  country?: string;
  status?: CustomerStatus;
  notes?: string;
}

export interface CreateAdminRequest {
  email: string;
  displayName: string;
  password: string;
  role: AdminRole;
}

export type BillingInterval = 'MONTHLY' | 'ANNUAL';
export type PlanStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
export type SubscriptionStatus = 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED' | 'CANCELLED' | 'EXPIRED';
export type InvoiceStatus = 'DRAFT' | 'OPEN' | 'PAID' | 'VOID' | 'REFUNDED' | 'OVERDUE';
export type BillingPaymentStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'REFUNDED';
export type ManualPaymentMethod = 'CASH' | 'BANK_TRANSFER' | 'CARD' | 'CHEQUE' | 'OTHER';

export interface BillingPlan {
  id: string;
  code: string;
  name: string;
  description: string | null;
  status: PlanStatus;
  monthlyPrice: number;
  annualPrice: number;
  currency: string;
  billingInterval: BillingInterval;
  trialDays: number;
  maxDevices: number;
  includedFeatures: string[];
  licenceFeatures?: string[];
  supportLevel: string;
  sortOrder: number;
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BillingSubscription {
  id: string;
  organisationId: string;
  organisationName: string | null;
  organisationEmail: string | null;
  planId: string;
  plan: BillingPlan;
  status: SubscriptionStatus;
  billingInterval: BillingInterval;
  startedAt: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  nextBillingDate: string | null;
  autoRenew: boolean;
  trialEndsAt: string | null;
  cancelAtPeriodEnd: boolean;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BillingInvoice {
  id: string;
  subscriptionId: string;
  organisationId: string;
  organisationName: string;
  planCode: string;
  number: string;
  status: InvoiceStatus;
  subtotal: number;
  tax: number;
  discount: number;
  total: number;
  currency: string;
  issuedAt: string | null;
  dueAt: string | null;
  paidAt: string | null;
  paymentCount: number;
  createdAt: string;
}

export interface BillingPayment {
  id: string;
  invoiceId: string;
  invoiceNumber: string | null;
  organisationId: string | null;
  organisationName: string | null;
  provider: string;
  providerReference: string | null;
  status: BillingPaymentStatus;
  amount: number;
  currency: string;
  manualMethod: ManualPaymentMethod | null;
  notes: string | null;
  receivedAt: string | null;
  createdAt: string;
}

export interface CreateSubscriptionRequest {
  organisationId: string;
  planId: string;
  billingInterval?: BillingInterval;
  startTrial?: boolean;
  autoRenew?: boolean;
}

export interface ChangeSubscriptionPlanRequest {
  planId: string;
  billingInterval?: BillingInterval;
  reason?: string;
}

export interface RecordManualPaymentRequest {
  invoiceId: string;
  amount: number;
  currency?: string;
  method: ManualPaymentMethod;
  providerReference?: string;
  notes?: string;
}
