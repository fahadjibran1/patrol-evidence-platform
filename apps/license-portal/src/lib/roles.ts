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

export function canRevealLicenseKey(role: AdminRole | undefined): boolean {
  return role === 'SUPER_ADMIN' || role === 'ADMIN';
}

export function canManageAdmins(role: AdminRole | undefined): boolean {
  return role === 'SUPER_ADMIN';
}

export function canRecordPayments(role: AdminRole | undefined): boolean {
  return role === 'SUPER_ADMIN' || role === 'ADMIN';
}

export function canEditCustomers(_role: AdminRole | undefined): boolean {
  return true;
}

export function canManageInstallations(role: AdminRole | undefined): boolean {
  return role === 'SUPER_ADMIN' || role === 'ADMIN' || role === 'SUPPORT';
}
