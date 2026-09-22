import { AdminRole } from '@prisma/client';

export enum CommercialOperatorPermission {
  VIEW_APPROVAL_QUEUE = 'commercial.approval.view',
  APPROVE_ISSUANCE = 'commercial.approval.issue',
  HOLD_ORDER = 'commercial.approval.hold',
  REJECT_ORDER = 'commercial.approval.reject',
  RELEASE_HOLD = 'commercial.approval.release_hold',
  RESEND_LICENCE = 'commercial.delivery.resend',
}

const PERMISSIONS: Readonly<Record<AdminRole, ReadonlySet<CommercialOperatorPermission>>> = {
  SUPER_ADMIN: new Set(Object.values(CommercialOperatorPermission)),
  ADMIN: new Set([CommercialOperatorPermission.VIEW_APPROVAL_QUEUE]),
  SUPPORT: new Set(),
};

export function adminHasCommercialPermission(
  role: AdminRole,
  permission: CommercialOperatorPermission,
): boolean {
  return PERMISSIONS[role].has(permission);
}
