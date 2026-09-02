import { CustomerRole } from '@prisma/client';

/** Application-level permission codes (not persisted — derived from CustomerRole). */
export enum CustomerPermission {
  VIEW_DASHBOARD = 'VIEW_DASHBOARD',
  VIEW_LICENCES = 'VIEW_LICENCES',
  DOWNLOAD_LICENCE = 'DOWNLOAD_LICENCE',
  VIEW_NOTIFICATIONS = 'VIEW_NOTIFICATIONS',
  MANAGE_OWN_PROFILE = 'MANAGE_OWN_PROFILE',
  MANAGE_ORG_PROFILE = 'MANAGE_ORG_PROFILE',
  MANAGE_USERS = 'MANAGE_USERS',
  MANAGE_INVITATIONS = 'MANAGE_INVITATIONS',
  VIEW_ACTIVITY = 'VIEW_ACTIVITY',
  MANAGE_SESSIONS = 'MANAGE_SESSIONS',
  VIEW_BILLING = 'VIEW_BILLING',
  PURCHASE_BILLING = 'PURCHASE_BILLING',
}

export { CustomerRole };

const ALL_PERMISSIONS = Object.values(CustomerPermission);

const ROLE_PERMISSIONS: Record<CustomerRole, ReadonlySet<CustomerPermission>> = {
  [CustomerRole.OWNER]: new Set(ALL_PERMISSIONS),
  [CustomerRole.ADMINISTRATOR]: new Set([
    CustomerPermission.VIEW_DASHBOARD,
    CustomerPermission.VIEW_LICENCES,
    CustomerPermission.DOWNLOAD_LICENCE,
    CustomerPermission.VIEW_NOTIFICATIONS,
    CustomerPermission.MANAGE_OWN_PROFILE,
    CustomerPermission.MANAGE_ORG_PROFILE,
    CustomerPermission.MANAGE_USERS,
    CustomerPermission.MANAGE_INVITATIONS,
    CustomerPermission.VIEW_ACTIVITY,
    CustomerPermission.MANAGE_SESSIONS,
    CustomerPermission.VIEW_BILLING,
    CustomerPermission.PURCHASE_BILLING,
  ]),
  [CustomerRole.TECHNICAL]: new Set([
    CustomerPermission.VIEW_DASHBOARD,
    CustomerPermission.VIEW_LICENCES,
    CustomerPermission.DOWNLOAD_LICENCE,
    CustomerPermission.VIEW_NOTIFICATIONS,
    CustomerPermission.MANAGE_OWN_PROFILE,
    CustomerPermission.MANAGE_SESSIONS,
  ]),
  [CustomerRole.FINANCE]: new Set([
    CustomerPermission.VIEW_DASHBOARD,
    CustomerPermission.VIEW_LICENCES,
    CustomerPermission.VIEW_NOTIFICATIONS,
    CustomerPermission.MANAGE_OWN_PROFILE,
    CustomerPermission.VIEW_ACTIVITY,
    CustomerPermission.MANAGE_SESSIONS,
    CustomerPermission.VIEW_BILLING,
    CustomerPermission.PURCHASE_BILLING,
  ]),
  [CustomerRole.VIEWER]: new Set([
    CustomerPermission.VIEW_DASHBOARD,
    CustomerPermission.VIEW_LICENCES,
    CustomerPermission.VIEW_NOTIFICATIONS,
    CustomerPermission.MANAGE_OWN_PROFILE,
    CustomerPermission.MANAGE_SESSIONS,
  ]),
};

export function permissionsForRole(role: CustomerRole): CustomerPermission[] {
  return [...(ROLE_PERMISSIONS[role] ?? new Set())];
}

export function roleHasPermission(role: CustomerRole, permission: CustomerPermission): boolean {
  return ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}

export const ASSIGNABLE_ROLES: CustomerRole[] = [
  CustomerRole.ADMINISTRATOR,
  CustomerRole.TECHNICAL,
  CustomerRole.FINANCE,
  CustomerRole.VIEWER,
  CustomerRole.OWNER,
];

export function canAssignRole(actorRole: CustomerRole, targetRole: CustomerRole): boolean {
  if (actorRole === CustomerRole.OWNER) {
    return true;
  }
  if (actorRole === CustomerRole.ADMINISTRATOR) {
    return targetRole !== CustomerRole.OWNER;
  }
  return false;
}
