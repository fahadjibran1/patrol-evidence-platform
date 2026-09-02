import { CustomerRole } from '@prisma/client';
import {
  CustomerPermission,
  canAssignRole,
  permissionsForRole,
  roleHasPermission,
} from './customer-permissions';

describe('customer permissions', () => {
  it('gives Owner every permission', () => {
    expect(permissionsForRole(CustomerRole.OWNER)).toEqual(
      expect.arrayContaining(Object.values(CustomerPermission)),
    );
  });

  it('denies Viewer licence downloads', () => {
    expect(roleHasPermission(CustomerRole.VIEWER, CustomerPermission.DOWNLOAD_LICENCE)).toBe(false);
    expect(roleHasPermission(CustomerRole.TECHNICAL, CustomerPermission.DOWNLOAD_LICENCE)).toBe(true);
  });

  it('restricts Administrator from assigning Owner', () => {
    expect(canAssignRole(CustomerRole.ADMINISTRATOR, CustomerRole.OWNER)).toBe(false);
    expect(canAssignRole(CustomerRole.OWNER, CustomerRole.OWNER)).toBe(true);
  });

  it('allows Finance to view activity and billing but not manage users', () => {
    expect(roleHasPermission(CustomerRole.FINANCE, CustomerPermission.VIEW_ACTIVITY)).toBe(true);
    expect(roleHasPermission(CustomerRole.FINANCE, CustomerPermission.VIEW_BILLING)).toBe(true);
    expect(roleHasPermission(CustomerRole.FINANCE, CustomerPermission.MANAGE_USERS)).toBe(false);
    expect(roleHasPermission(CustomerRole.TECHNICAL, CustomerPermission.VIEW_BILLING)).toBe(false);
  });
});
