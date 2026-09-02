export type CustomerRole = 'OWNER' | 'ADMINISTRATOR' | 'TECHNICAL' | 'FINANCE' | 'VIEWER';
export type CustomerPermission =
  | 'VIEW_DASHBOARD'
  | 'VIEW_LICENCES'
  | 'DOWNLOAD_LICENCE'
  | 'VIEW_NOTIFICATIONS'
  | 'MANAGE_OWN_PROFILE'
  | 'MANAGE_ORG_PROFILE'
  | 'MANAGE_USERS'
  | 'MANAGE_INVITATIONS'
  | 'VIEW_ACTIVITY'
  | 'MANAGE_SESSIONS'
  | 'VIEW_BILLING'
  | 'PURCHASE_BILLING';

export type CustomerStatus = 'PROSPECT' | 'TRIAL' | 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
export type LicensePlan = 'TRIAL' | 'MONTHLY' | 'ANNUAL';
export type LicenseStatus = 'DRAFT' | 'ACTIVE' | 'EXPIRED' | 'SUSPENDED' | 'REVOKED';
export type NotificationStatus = 'PENDING' | 'QUEUED' | 'SENT' | 'FAILED';
export type NotificationCategory = 'licence' | 'general' | 'system';
export type InvitationStatus = 'PENDING' | 'ACCEPTED' | 'CANCELLED' | 'EXPIRED';

export interface CustomerUser {
  id: string;
  email: string;
  displayName: string;
  customerId: string;
  companyId: string;
  role: CustomerRole;
  permissions: CustomerPermission[];
  emailVerified?: boolean;
  mfaEnabled?: boolean;
}

export interface CustomerAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn?: string;
  sessionId?: string;
  rememberMe?: boolean;
}

export interface CustomerLoginResponse {
  customer: {
    sub: string;
    email: string;
    displayName: string;
    customerId: string;
    companyId: string;
    role: CustomerRole;
    permissions: CustomerPermission[];
    emailVerified: boolean;
  };
  tokens: CustomerAuthTokens;
}

export interface CustomerRefreshResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn?: string;
  sessionId?: string;
  rememberMe?: boolean;
}

export interface ApiErrorPayload {
  statusCode?: number;
  code?: string;
  message?: string | string[];
  error?: string;
}

export interface CustomerSafeLicence {
  id: string;
  licenseId: string;
  status: LicenseStatus;
  effectiveStatus: string;
  plan: LicensePlan;
  issuedAt: string | null;
  startsAt: string;
  expiresAt: string;
  maxDevices: number;
  currentVersionNumber: number | null;
  downloadCount: number;
  lastDownloadedAt: string | null;
  hasDownloadableFile: boolean;
}

export interface CustomerDashboard {
  company: {
    id: string;
    companyName: string;
    tradingName: string | null;
    status: CustomerStatus;
    email: string;
  };
  currentLicence: CustomerSafeLicence | null;
  status: string | null;
  plan: LicensePlan | null;
  expiry: string | null;
  deviceAllowance: number | null;
  latestDownload: {
    licenceId: string;
    licenseId: string;
    downloadedAt: string;
    downloadCount: number;
  } | null;
  latestNotification: {
    id: string;
    subject: string;
    status: NotificationStatus;
    createdAt: string;
    notificationType: string;
  } | null;
  renewalCountdownDays: number | null;
}

export interface CustomerProfile {
  user: {
    id: string;
    email: string;
    displayName: string;
    phone: string | null;
    role: CustomerRole;
    permissions: CustomerPermission[];
    emailVerified: boolean;
    mfaEnabled: boolean;
    notificationPreferences: {
      licence: boolean;
      general: boolean;
      system: boolean;
    };
  };
  company: {
    id: string;
    companyName: string;
    tradingName: string | null;
    contactName: string | null;
    email: string;
    phone: string | null;
    technicalContactName: string | null;
    technicalContactEmail: string | null;
    technicalContactPhone: string | null;
    status: CustomerStatus;
  };
  billing: {
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    postcode: string | null;
    country: string;
    readOnly: boolean;
  };
}

export interface CustomerNotificationItem {
  id: string;
  category: NotificationCategory;
  notificationType: string;
  subject: string;
  status: NotificationStatus;
  createdAt: string;
  sentAt: string | null;
  licenceId: string | null;
}

export interface OrgMember {
  id: string;
  email: string;
  displayName: string;
  phone: string | null;
  role: CustomerRole;
  permissions: CustomerPermission[];
  isActive: boolean;
  emailVerified: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface OrgInvitation {
  id: string;
  email: string;
  role: CustomerRole;
  status: InvitationStatus;
  expiresAt: string;
  acceptedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  invitedBy: { displayName: string; email: string };
}

export interface CustomerSessionItem {
  id: string;
  ipAddress: string | null;
  userAgent: string | null;
  rememberMe: boolean;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
  current: boolean;
}

export interface ActivityItem {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  createdAt: string;
  actor: { displayName: string; email: string } | null;
  metadata: unknown;
}

export type BillingInterval = 'MONTHLY' | 'ANNUAL';
export type SubscriptionStatus = 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED' | 'CANCELLED' | 'EXPIRED';
export type InvoiceStatus = 'DRAFT' | 'OPEN' | 'PAID' | 'VOID' | 'REFUNDED' | 'OVERDUE';
export type BillingPaymentStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'REFUNDED';

export interface CustomerBillingPlan {
  id: string;
  code: string;
  name: string;
  description: string | null;
  status: string;
  monthlyPrice: number;
  annualPrice: number;
  currency: string;
  billingInterval: BillingInterval;
  trialDays: number;
  maxDevices: number;
  includedFeatures: string[];
  supportLevel: string;
  isPublic: boolean;
}

export interface CustomerBillingSubscription {
  id: string;
  organisationId: string;
  organisationName: string | null;
  planId: string;
  plan: CustomerBillingPlan;
  status: SubscriptionStatus;
  pendingCheckout?: boolean;
  billingInterval: BillingInterval;
  startedAt: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  nextBillingDate: string | null;
  autoRenew: boolean;
  trialEndsAt: string | null;
  cancelAtPeriodEnd: boolean;
  cancelledAt: string | null;
}

export interface CustomerBillingInvoice {
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

export interface CustomerBillingPayment {
  id: string;
  invoiceId: string;
  invoiceNumber: string | null;
  provider: string;
  providerReference: string | null;
  status: BillingPaymentStatus;
  amount: number;
  currency: string;
  manualMethod: string | null;
  notes: string | null;
  receivedAt: string | null;
  createdAt: string;
}

export interface CustomerPlanComparisonRow {
  id: string;
  code: string;
  name: string;
  amount: number;
  currency: string;
  interval: BillingInterval;
  monthlyEquivalent: number;
}

/** GET /customer/billing */
export interface CustomerBillingOverview {
  subscription: CustomerBillingSubscription | null;
  plan: CustomerBillingPlan | null;
  renewalDate: string | null;
  invoices: CustomerBillingInvoice[];
  payments: CustomerBillingPayment[];
  plans: CustomerBillingPlan[];
  planComparison: CustomerPlanComparisonRow[];
  upgradeAvailable: boolean;
  downgradeAvailable: boolean;
  selfServeChangeDisabledReason: string;
  stripeCheckoutEnabled?: boolean;
  termsVersion?: string;
  canPurchase?: boolean;
  paymentActionRequired?: boolean;
  gracePeriodDays?: number;
}
