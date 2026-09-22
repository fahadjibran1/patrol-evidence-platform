import type { AdminRole } from '../types';

export function canIssueLicences(role: AdminRole | undefined): boolean {
  return role === 'SUPER_ADMIN' || role === 'ADMIN';
}

export function canRenewLicences(role: AdminRole | undefined): boolean {
  return canIssueLicences(role);
}

export function canSuspendOrRevoke(role: AdminRole | undefined): boolean {
  return role === 'SUPER_ADMIN' || role === 'ADMIN';
}

/** Current policy allows ADMIN (in addition to SUPER_ADMIN) to revoke licences. */
export function canRevokeLicence(role: AdminRole | undefined): boolean {
  return role === 'SUPER_ADMIN' || role === 'ADMIN';
}

/** Governs reissue / suspend / change-plan / change-device-limit — every lifecycle mutation except revoke has its own helper too, but they share this policy. */
export function canPerformLifecycleActions(role: AdminRole | undefined): boolean {
  return role === 'SUPER_ADMIN' || role === 'ADMIN';
}

export function canReactivateLicences(role: AdminRole | undefined): boolean {
  return role === 'SUPER_ADMIN' || role === 'ADMIN';
}

export function canRevealLicenseKey(role: AdminRole | undefined): boolean {
  return role === 'SUPER_ADMIN' || role === 'ADMIN';
}

export function canManageAdmins(role: AdminRole | undefined): boolean {
  return role === 'SUPER_ADMIN';
}

export function canRecordPayments(role: AdminRole | undefined): boolean {
  return role === 'SUPER_ADMIN' || role === 'ADMIN';
}

export function canManageBilling(role: AdminRole | undefined): boolean {
  return role === 'SUPER_ADMIN' || role === 'ADMIN';
}

export function canViewRevenue(role: AdminRole | undefined): boolean {
  return role === 'SUPER_ADMIN' || role === 'ADMIN';
}

/** System Status / metrics / production monitoring — ADMIN and SUPER_ADMIN only. */
export function canViewSystemStatus(role: AdminRole | undefined): boolean {
  return role === 'SUPER_ADMIN' || role === 'ADMIN';
}

export function canEditCustomers(_role: AdminRole | undefined): boolean {
  return true;
}

export function canManageInstallations(role: AdminRole | undefined): boolean {
  return role === 'SUPER_ADMIN' || role === 'ADMIN' || role === 'SUPPORT';
}

export function canViewCommercialApprovals(role: AdminRole | undefined): boolean {
  return role === 'SUPER_ADMIN' || role === 'ADMIN';
}

export function canApproveCommercialIssuance(role: AdminRole | undefined): boolean {
  return role === 'SUPER_ADMIN';
}
