import type { CustomerPermission, CustomerRole, CustomerUser } from '../types';

export function hasPermission(
  user: CustomerUser | null | undefined,
  permission: CustomerPermission,
): boolean {
  return Boolean(user?.permissions?.includes(permission));
}

export function canManageUsers(user: CustomerUser | null | undefined): boolean {
  return hasPermission(user, 'MANAGE_USERS');
}

export function canManageInvitations(user: CustomerUser | null | undefined): boolean {
  return hasPermission(user, 'MANAGE_INVITATIONS');
}

export function canManageOrg(user: CustomerUser | null | undefined): boolean {
  return hasPermission(user, 'MANAGE_ORG_PROFILE');
}

export function canViewActivity(user: CustomerUser | null | undefined): boolean {
  return hasPermission(user, 'VIEW_ACTIVITY');
}

export function canDownloadLicence(user: CustomerUser | null | undefined): boolean {
  return hasPermission(user, 'DOWNLOAD_LICENCE');
}

export function canViewBilling(user: CustomerUser | null | undefined): boolean {
  return hasPermission(user, 'VIEW_BILLING');
}

export function canPurchaseBilling(user: CustomerUser | null | undefined): boolean {
  return hasPermission(user, 'PURCHASE_BILLING');
}

export const ROLE_OPTIONS: CustomerRole[] = [
  'OWNER',
  'ADMINISTRATOR',
  'TECHNICAL',
  'FINANCE',
  'VIEWER',
];
