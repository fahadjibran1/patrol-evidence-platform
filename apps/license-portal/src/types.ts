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

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  admin: AdminUser;
}

export interface RefreshResponse {
  accessToken: string;
  refreshToken: string;
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
}

export interface DashboardStats {
  totalCustomers: number;
  activeLicences: number;
  trials: number;
  expiredLicences: number;
  suspendedLicences: number;
  expiringIn7Days: number;
  expiringIn30Days: number;
  outstandingPayments: number;
  recentActivity?: AuditLogEntry[];
  upcomingRenewals?: LicenceSummary[];
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

export interface LicenceDetail extends LicenceSummary {
  features: string[];
  notes?: string | null;
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
  paymentReference?: string;
  invoiceReference?: string;
}

export interface IssueLicenceResponse {
  licence: LicenceDetail;
  licenseKey: string;
}

export interface RenewLicenceRequest {
  startsAt?: string;
  expiresAt: string;
  maxDevices?: number;
  features?: string[];
  notes?: string;
}

export interface RenewLicenceResponse {
  licence: LicenceDetail;
  licenseKey: string;
}

export interface SigningKeyStatus {
  signingKeyId: string | null;
  signingKeyReady: boolean;
  algorithm: string;
  environment: string;
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
