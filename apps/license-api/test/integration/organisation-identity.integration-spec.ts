import {
  closeIntegrationContext,
  createIntegrationContext,
  createTestCustomer,
  type IntegrationContext,
} from './integration-harness';
import * as bcrypt from 'bcrypt';
import { CustomerRole, LicensePlan, LicenseStatus } from '@prisma/client';
import { CustomerAuthService } from '@/customer-auth/customer-auth.service';
import { CustomerMembersService } from '@/customer-org/customer-members.service';
import { CustomerInvitationsService } from '@/customer-org/customer-invitations.service';
import { CustomerSessionsService } from '@/customer-org/customer-sessions.service';
import { CustomerActivityService } from '@/customer-org/customer-activity.service';
import { CustomerDownloadsService } from '@/customer-downloads/customer-downloads.service';
import { EncryptionService } from '@/crypto/encryption.service';
import { permissionsForRole } from '@/customer-org/customer-permissions';

describe('Organisation identity (integration)', () => {
  let context: IntegrationContext;
  let auth: CustomerAuthService;
  let members: CustomerMembersService;
  let invitations: CustomerInvitationsService;
  let sessions: CustomerSessionsService;
  let activity: CustomerActivityService;
  let downloads: CustomerDownloadsService;
  let encryption: EncryptionService;

  beforeAll(async () => {
    context = await createIntegrationContext();
    auth = context.module.get(CustomerAuthService);
    members = context.module.get(CustomerMembersService);
    invitations = context.module.get(CustomerInvitationsService);
    sessions = context.module.get(CustomerSessionsService);
    activity = context.module.get(CustomerActivityService);
    downloads = context.module.get(CustomerDownloadsService);
    encryption = context.module.get(EncryptionService);
  }, 120_000);

  afterAll(async () => {
    await closeIntegrationContext(context);
  });

  it('enforces roles, invitations, password reset, sessions, and org isolation', async () => {
    const companyA = await createTestCustomer(context.prisma, {
      companyName: 'Org A',
      email: 'a@org.test',
    });
    const companyB = await createTestCustomer(context.prisma, {
      companyName: 'Org B',
      email: 'b@org.test',
    });

    const passwordHash = await bcrypt.hash('CustomerPass123!', 10);
    const ownerA = await context.prisma.customerUser.create({
      data: {
        email: 'owner@orga.test',
        passwordHash,
        displayName: 'Owner A',
        customerId: companyA.id,
        role: CustomerRole.OWNER,
        emailVerifiedAt: new Date(),
      },
    });
    await context.prisma.customerUser.create({
      data: {
        email: 'owner@orgb.test',
        passwordHash,
        displayName: 'Owner B',
        customerId: companyB.id,
        role: CustomerRole.OWNER,
        emailVerifiedAt: new Date(),
      },
    });

    const actorA = {
      sub: ownerA.id,
      email: ownerA.email,
      displayName: ownerA.displayName,
      customerId: companyA.id,
      companyId: companyA.id,
      role: CustomerRole.OWNER,
      permissions: permissionsForRole(CustomerRole.OWNER),
      emailVerified: true,
    };

    const invited = await invitations.invite(actorA, {
      email: 'tech@orga.test',
      role: CustomerRole.TECHNICAL,
    });
    expect(invited.invitationToken).toBeTruthy();

    const accepted = await auth.acceptInvitation({
      token: invited.invitationToken!,
      displayName: 'Tech User',
      password: 'TechPass123!',
    });
    expect(accepted.customer.role).toBe(CustomerRole.TECHNICAL);
    expect(accepted.customer.companyId).toBe(companyA.id);

    const listed = await members.list(actorA);
    expect(listed.items.map((item) => item.email).sort()).toEqual(['owner@orga.test', 'tech@orga.test']);

    await expect(
      members.updateRole(actorA, accepted.customer.sub, { role: CustomerRole.VIEWER }),
    ).resolves.toMatchObject({ role: CustomerRole.VIEWER });

    await expect(members.remove(actorA, ownerA.id)).rejects.toMatchObject({ status: 400 });

    const reset = await auth.requestPasswordReset({ email: 'owner@orga.test' });
    expect(reset.resetToken).toBeTruthy();
    await auth.resetPassword({ token: reset.resetToken!, password: 'NewPass123!' });
    await expect(
      auth.login({ email: 'owner@orga.test', password: 'CustomerPass123!' }),
    ).rejects.toMatchObject({ status: 401 });
    const login = await auth.login({
      email: 'owner@orga.test',
      password: 'NewPass123!',
      rememberMe: true,
    });
    expect(login.tokens.rememberMe).toBe(true);

    const actorWithSession = { ...actorA, sessionId: login.tokens.sessionId };
    const sessionList = await sessions.list(actorWithSession);
    expect(sessionList.items.some((item) => item.current)).toBe(true);

    const licenceA = await context.prisma.licence.create({
      data: {
        licenseId: 'PEL-2026-800001',
        customerId: companyA.id,
        plan: LicensePlan.ANNUAL,
        status: LicenseStatus.ACTIVE,
        issuedAt: new Date(),
        startsAt: new Date('2026-01-01'),
        expiresAt: new Date('2027-01-01'),
        maxDevices: 2,
        features: [],
        signedLicenseEnc: encryption.encrypt('TG1.org.sig'),
        createdByAdminId: context.admin.id,
      },
    });
    await context.prisma.licence.create({
      data: {
        licenseId: 'PEL-2026-800002',
        customerId: companyB.id,
        plan: LicensePlan.MONTHLY,
        status: LicenseStatus.ACTIVE,
        issuedAt: new Date(),
        startsAt: new Date('2026-01-01'),
        expiresAt: new Date('2026-02-01'),
        maxDevices: 1,
        features: [],
        signedLicenseEnc: encryption.encrypt('TG1.other.sig'),
        createdByAdminId: context.admin.id,
      },
    });

    const viewerActor = {
      ...accepted.customer,
      role: CustomerRole.VIEWER,
      permissions: permissionsForRole(CustomerRole.VIEWER),
    };
    await expect(downloads.downloadCurrentActive(viewerActor, licenceA.id)).rejects.toMatchObject({
      status: 403,
    });

    const techActor = {
      ...accepted.customer,
      role: CustomerRole.TECHNICAL,
      permissions: permissionsForRole(CustomerRole.TECHNICAL),
    };
    // role was changed to VIEWER above — restore TECHNICAL for download test
    await context.prisma.customerUser.update({
      where: { id: accepted.customer.sub },
      data: { role: CustomerRole.TECHNICAL },
    });
    await expect(downloads.downloadCurrentActive(techActor, licenceA.id)).resolves.toMatchObject({
      licenseId: 'PEL-2026-800001',
    });

    const orgActivity = await activity.list(actorA);
    expect(orgActivity.items.every((item) => item.action.startsWith('customer.'))).toBe(true);
    expect(orgActivity.items.some((item) => item.action === 'customer.invitation.accepted')).toBe(true);
  }, 180_000);
});
