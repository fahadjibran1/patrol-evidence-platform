import {
  closeIntegrationContext,
  createIntegrationContext,
  createTestCustomer,
  type IntegrationContext,
} from './integration-harness';
import * as bcrypt from 'bcrypt';
import {
  CustomerRole,
  LicensePlan,
  LicenseStatus,
  NotificationProviderKind,
  NotificationStatus,
  NotificationType,
} from '@prisma/client';
import { CustomerAuthService } from '@/customer-auth/customer-auth.service';
import { CustomerDashboardService } from '@/customer-dashboard/customer-dashboard.service';
import { CustomerLicencesService } from '@/customer-licences/customer-licences.service';
import { CustomerDownloadsService } from '@/customer-downloads/customer-downloads.service';
import { CustomerOrgProfileService } from '@/customer-org/customer-org-profile.service';
import { CustomerNotificationsService } from '@/customer-notifications/customer-notifications.service';
import { EncryptionService } from '@/crypto/encryption.service';
import { permissionsForRole } from '@/customer-org/customer-permissions';

describe('Customer portal foundation (integration)', () => {
  let context: IntegrationContext;
  let auth: CustomerAuthService;
  let dashboard: CustomerDashboardService;
  let licences: CustomerLicencesService;
  let downloads: CustomerDownloadsService;
  let profile: CustomerOrgProfileService;
  let notifications: CustomerNotificationsService;
  let encryption: EncryptionService;

  beforeAll(async () => {
    context = await createIntegrationContext();
    auth = context.module.get(CustomerAuthService);
    dashboard = context.module.get(CustomerDashboardService);
    licences = context.module.get(CustomerLicencesService);
    downloads = context.module.get(CustomerDownloadsService);
    profile = context.module.get(CustomerOrgProfileService);
    notifications = context.module.get(CustomerNotificationsService);
    encryption = context.module.get(EncryptionService);
  }, 120_000);

  afterAll(async () => {
    await closeIntegrationContext(context);
  });

  it('authenticates customer users, scopes data by company, downloads, audits, and updates profile', async () => {
    const companyA = await createTestCustomer(context.prisma, {
      companyName: 'Acme Security',
      email: 'ops@acme.test',
    });
    const companyB = await createTestCustomer(context.prisma, {
      companyName: 'Other Co',
      email: 'ops@other.test',
    });

    const passwordHash = await bcrypt.hash('CustomerPass123!', 10);
    const userA = await context.prisma.customerUser.create({
      data: {
        email: 'portal@acme.test',
        passwordHash,
        displayName: 'Acme Portal',
        customerId: companyA.id,
        role: CustomerRole.OWNER,
        emailVerifiedAt: new Date(),
      },
    });
    await context.prisma.customerUser.create({
      data: {
        email: 'portal@other.test',
        passwordHash,
        displayName: 'Other Portal',
        customerId: companyB.id,
        role: CustomerRole.OWNER,
        emailVerifiedAt: new Date(),
      },
    });

    const tg1 = 'TG1.payload.signature';
    const licenceA = await context.prisma.licence.create({
      data: {
        licenseId: 'PEL-2026-900001',
        customerId: companyA.id,
        plan: LicensePlan.ANNUAL,
        status: LicenseStatus.ACTIVE,
        issuedAt: new Date(),
        startsAt: new Date('2026-01-01'),
        expiresAt: new Date('2027-01-01'),
        maxDevices: 3,
        features: [],
        signedLicenseEnc: encryption.encrypt(tg1),
        createdByAdminId: context.admin.id,
        downloadCount: 0,
      },
    });
    await context.prisma.licence.create({
      data: {
        licenseId: 'PEL-2026-900002',
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

    await context.prisma.notificationLog.create({
      data: {
        notificationType: NotificationType.LICENSE_ISSUED,
        provider: NotificationProviderKind.EMAIL,
        recipient: 'ops@acme.test',
        subject: 'Licence issued',
        status: NotificationStatus.SENT,
        customerId: companyA.id,
        licenceId: licenceA.id,
      },
    });

    const login = await auth.login({ email: 'portal@acme.test', password: 'CustomerPass123!' });
    expect(login.customer.customerId).toBe(companyA.id);
    expect(login.customer.role).toBe(CustomerRole.OWNER);

    const actor = {
      sub: userA.id,
      email: userA.email,
      displayName: userA.displayName,
      customerId: companyA.id,
      companyId: companyA.id,
      role: CustomerRole.OWNER,
      permissions: permissionsForRole(CustomerRole.OWNER),
      emailVerified: true,
    };

    const summary = await dashboard.getSummary(actor);
    expect(summary.company.companyName).toBe('Acme Security');
    expect(summary.currentLicence?.licenseId).toBe('PEL-2026-900001');
    expect(JSON.stringify(summary)).not.toContain('TG1.');

    const listed = await licences.list(actor);
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0]).not.toHaveProperty('signedLicenseEnc');
    expect(JSON.stringify(listed)).not.toContain('TG1.');

    await expect(licences.getOne(actor, (await context.prisma.licence.findFirstOrThrow({
      where: { customerId: companyB.id },
    })).id)).rejects.toMatchObject({ status: 404 });

    const download = await downloads.downloadCurrentActive(actor, licenceA.id);
    expect(download.body).toBe(tg1);

    const updatedLicence = await context.prisma.licence.findUniqueOrThrow({ where: { id: licenceA.id } });
    expect(updatedLicence.downloadCount).toBe(1);
    expect(updatedLicence.lastDownloadedAt).toBeTruthy();

    const auditDownload = await context.prisma.auditLog.findFirst({
      where: { action: 'customer.licence.downloaded', actorCustomerUserId: userA.id },
    });
    expect(auditDownload).toBeTruthy();

    const noticeList = await notifications.list(actor, { category: 'licence' });
    expect(noticeList.items).toHaveLength(1);
    expect(noticeList.items[0].subject).toBe('Licence issued');

    const updatedProfile = await profile.updateOrganisation(actor, {
      contactName: 'New Contact',
      phone: '0123456789',
      defaultNotifySystem: false,
    });
    expect(updatedProfile.company.contactName).toBe('New Contact');
    expect(updatedProfile.user.notificationPreferences.system).toBe(false);
    expect(updatedProfile.billing.readOnly).toBe(true);

    const profileAudit = await context.prisma.auditLog.findFirst({
      where: { action: 'customer.organisation.updated', actorCustomerUserId: userA.id },
    });
    expect(profileAudit).toBeTruthy();

    await auth.logout(userA.id, login.tokens.refreshToken);
    const logoutAudit = await context.prisma.auditLog.findFirst({
      where: { action: 'customer.auth.logout', actorCustomerUserId: userA.id },
    });
    expect(logoutAudit).toBeTruthy();
  }, 120_000);
});
