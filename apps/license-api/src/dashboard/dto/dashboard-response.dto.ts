import type { LicensePlan, LicenseStatus } from '@prisma/client';
import type { EffectiveLicenceStatus } from '@/licences/licence.util';

export interface DashboardKpisDto {
  activeCustomers: number;
  activeLicences: number;
  trialLicences: number;
  monthlyLicences: number;
  annualLicences: number;
  expiredLicences: number;
  expiringIn7Days: number;
  expiringIn30Days: number;
  suspendedLicences: number;
  revokedLicences: number;
  renewedThisMonth: number;
  emailsSentToday: number;
  failedEmailsToday: number;
}

export interface DashboardRenewalQueueItemDto {
  id: string;
  licenseId: string;
  customerId: string;
  customerName: string;
  plan: LicensePlan;
  status: LicenseStatus;
  effectiveStatus: EffectiveLicenceStatus;
  expiresAt: string;
  daysUntilExpiry: number;
  /** Whether the current admin role is permitted to renew this licence (SUPPORT cannot). */
  canRenew: boolean;
  /** Renewal queue only contains ACTIVE licences, so reactivation never applies here. */
  canReactivate: boolean;
}

export interface DashboardActivityItemDto {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  customerId: string | null;
  licenceId: string | null;
  actorDisplayName: string | null;
  createdAt: string;
}

export interface DashboardNotificationFailureDto {
  id: string;
  notificationType: string;
  provider: string;
  recipient: string;
  subject: string;
  status: string;
  errorMessage: string | null;
  createdAt: string;
}

export interface DashboardNotificationHealthDto {
  sentToday: number;
  failedToday: number;
  pendingToday: number;
  recentFailures: DashboardNotificationFailureDto[];
}

export interface DashboardRevenueDto {
  currency: string;
  outstandingPaymentsCount: number;
  outstandingPaymentsAmountPence: number;
  paidTodayCount: number;
  paidTodayAmountPence: number;
  paidThisMonthCount: number;
  paidThisMonthAmountPence: number;
}

export interface DashboardSummaryDto {
  generatedAt: string;
  kpis: DashboardKpisDto;
  renewalQueue: DashboardRenewalQueueItemDto[];
  recentActivity: DashboardActivityItemDto[];
  notificationHealth: DashboardNotificationHealthDto;
  /** Present for ADMIN and SUPER_ADMIN only. Omitted for SUPPORT. */
  revenue?: DashboardRevenueDto;
  /** Present for ADMIN and SUPER_ADMIN only. Subscription engine metrics. */
  billing?: DashboardBillingDto;
}

export interface DashboardBillingDto {
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
