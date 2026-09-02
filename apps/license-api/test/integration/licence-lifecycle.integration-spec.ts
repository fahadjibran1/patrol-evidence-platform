import { AdminRole, LicensePlan, LicenseStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { EmailProvider } from '@/notifications/providers/email.provider';
import {
  closeIntegrationContext,
  createIntegrationContext,
  createTestCustomer,
  resetIntegrationDatabase,
  type IntegrationContext,
} from './integration-harness';

describe('Licence lifecycle integration (PostgreSQL)', () => {
  let context: IntegrationContext;
  const adminPassword = 'IntegrationTestPass123!';
  let emailSend: jest.SpyInstance;

  beforeAll(async () => {
    context = await createIntegrationContext();
  });

  afterAll(async () => {
    if (context) {
      await closeIntegrationContext(context);
    }
  });

  beforeEach(async () => {
    await resetIntegrationDatabase(context.prisma);
    const admin = await context.prisma.admin.create({
      data: {
        email: context.admin.email,
        passwordHash: await bcrypt.hash(adminPassword, 10),
        displayName: context.admin.displayName,
        role: AdminRole.SUPER_ADMIN,
        isActive: true,
      },
    });
    context.admin = admin;
    context.adminActor = {
      sub: admin.id,
      email: admin.email,
      role: admin.role,
      displayName: admin.displayName,
    };
    context.signingService.useTestKey(context.privateKeyPem, 'integration-test-key');

    const emailProvider = context.module.get(EmailProvider);
    emailSend = jest.spyOn(emailProvider, 'send').mockResolvedValue({
      success: true,
      providerMessageId: 'mock-smtp-lifecycle',
    });
  });

  afterEach(() => {
    emailSend?.mockRestore();
  });

  it('walks a licence through issue -> renew -> reissue -> suspend -> reactivate -> change device limit -> revoke', async () => {
    const customer = await createTestCustomer(context.prisma, {
      companyName: 'Lifecycle Integration Ltd',
      contactName: 'Ops Lead',
      email: 'lifecycle@example.co.uk',
    });

    // --- 1. Issue -> version 1 (ISSUED) ---
    const issued = await context.licencesService.issueImmediately(context.adminActor, {
      customerId: customer.id,
      plan: LicensePlan.ANNUAL,
      startsAt: '2026-07-13',
      expiresAt: '2027-07-12',
      maxDevices: 2,
      features: ['collector'],
    });
    const licenceId = issued.licence.id;
    const humanLicenseId = issued.licence.licenseId;
    const issuedTg1 = issued.fullLicenseKey as string;
    expect(issuedTg1).toMatch(/^TG1\./);

    let licenceRow = await context.prisma.licence.findUniqueOrThrow({ where: { id: licenceId } });
    expect(licenceRow.currentVersionId).toBeTruthy();

    let versions = await context.prisma.licenceVersion.findMany({
      where: { licenceId },
      orderBy: { versionNumber: 'asc' },
    });
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ versionNumber: 1, actionType: 'ISSUED', previousVersionId: null });
    expect(versions[0].id).toBe(licenceRow.currentVersionId);

    // --- 2. Renew -> version 2 (RENEWED), same commercial licenceId, new TG1 ---
    const renewed = await context.licencesService.renew(context.adminActor, licenceId, {
      renewalPeriod: 'ANNUAL',
      password: adminPassword,
      reason: 'Annual renewal',
      emailAfterRenewal: true,
    });

    expect(renewed.licenseId).toBe(humanLicenseId);
    expect(renewed.startsAt).toBe('2027-07-13');
    expect(renewed.expiresAt).toBe('2028-07-12');
    expect(renewed.fullLicenseKey).toMatch(/^TG1\./);
    expect(renewed.fullLicenseKey).not.toBe(issuedTg1);
    expect(renewed.emailResult?.success).toBe(true);

    versions = await context.prisma.licenceVersion.findMany({ where: { licenceId }, orderBy: { versionNumber: 'asc' } });
    expect(versions).toHaveLength(2);
    expect(versions[1]).toMatchObject({ versionNumber: 2, actionType: 'RENEWED', previousVersionId: versions[0].id });
    expect(versions[1].signedLicenseEnc).toBeTruthy();

    const renewedNotification = await context.prisma.notificationLog.findFirst({
      where: { licenceId, notificationType: 'LICENSE_RENEWED' },
    });
    expect(renewedNotification).toBeTruthy();
    expect(emailSend).toHaveBeenCalled();

    // --- 3. Reissue -> version 3 (REISSUED), same window, fresh TG1 ---
    const reissued = await context.licencesService.reissue(context.adminActor, licenceId, {
      reason: 'Customer lost the licence file',
      password: adminPassword,
    });

    expect(reissued.startsAt).toBe('2027-07-13');
    expect(reissued.expiresAt).toBe('2028-07-12');
    expect(reissued.fullLicenseKey).toMatch(/^TG1\./);
    // Reissue re-signs the exact same entitlement (dates/plan/devices/features unchanged), and
    // TG1 signing is deterministic, so the bytes are legitimately identical to the prior TG1 here.
    const reissuedTg1 = reissued.fullLicenseKey as string;

    versions = await context.prisma.licenceVersion.findMany({ where: { licenceId }, orderBy: { versionNumber: 'asc' } });
    expect(versions).toHaveLength(3);
    expect(versions[2]).toMatchObject({ versionNumber: 3, actionType: 'REISSUED', previousVersionId: versions[1].id });

    // --- 4. Suspend -> version 4 (SUSPENDED), no new TG1 ---
    const suspended = await context.licencesService.suspend(context.adminActor, licenceId, {
      reason: 'Chargeback pending',
      password: adminPassword,
    });
    expect(suspended.status).toBe(LicenseStatus.SUSPENDED);

    versions = await context.prisma.licenceVersion.findMany({ where: { licenceId }, orderBy: { versionNumber: 'asc' } });
    expect(versions).toHaveLength(4);
    expect(versions[3]).toMatchObject({ versionNumber: 4, actionType: 'SUSPENDED', signedLicenseEnc: null });

    licenceRow = await context.prisma.licence.findUniqueOrThrow({ where: { id: licenceId } });
    expect(licenceRow.status).toBe(LicenseStatus.SUSPENDED);
    // The licence's own TG1 (from the reissue step) must be untouched by the status-only suspension.
    expect(licenceRow.signedLicenseEnc).toBeTruthy();

    // Suspending an already-suspended licence must fail with LICENCE_ALREADY_SUSPENDED.
    await expect(
      context.licencesService.suspend(context.adminActor, licenceId, { reason: 'again', password: adminPassword }),
    ).rejects.toMatchObject({ code: 'LICENCE_ALREADY_SUSPENDED' });

    // --- 5. Reactivate -> version 5 (REACTIVATED), no new TG1 ---
    const reactivated = await context.licencesService.reactivate(context.adminActor, licenceId, {
      password: adminPassword,
    });
    expect(reactivated.status).toBe(LicenseStatus.ACTIVE);

    versions = await context.prisma.licenceVersion.findMany({ where: { licenceId }, orderBy: { versionNumber: 'asc' } });
    expect(versions).toHaveLength(5);
    expect(versions[4]).toMatchObject({ versionNumber: 5, actionType: 'REACTIVATED', signedLicenseEnc: null });

    // --- 6. Change device limit -> version 6 (DEVICE_LIMIT_CHANGED), new TG1 ---
    const deviceLimitChanged = await context.licencesService.changeDeviceLimit(context.adminActor, licenceId, {
      maxDevices: 5,
      reason: 'Customer growth',
      password: adminPassword,
    });
    expect(deviceLimitChanged.maxDevices).toBe(5);
    expect(deviceLimitChanged.fullLicenseKey).toMatch(/^TG1\./);
    expect(deviceLimitChanged.fullLicenseKey).not.toBe(reissuedTg1);

    versions = await context.prisma.licenceVersion.findMany({ where: { licenceId }, orderBy: { versionNumber: 'asc' } });
    expect(versions).toHaveLength(6);
    expect(versions[5]).toMatchObject({
      versionNumber: 6,
      actionType: 'DEVICE_LIMIT_CHANGED',
      maxDevices: 5,
    });

    // --- 7. Revoke -> version 7 (REVOKED), no new TG1 ---
    const revokeConfirmation = `REVOKE ${humanLicenseId}`;
    await expect(
      context.licencesService.revoke(context.adminActor, licenceId, {
        reason: 'Fraud investigation',
        confirmationText: 'WRONG TEXT',
        password: adminPassword,
      }),
    ).rejects.toMatchObject({ code: 'LICENCE_REVOKE_CONFIRMATION_INVALID' });

    const revoked = await context.licencesService.revoke(context.adminActor, licenceId, {
      reason: 'Fraud investigation',
      confirmationText: revokeConfirmation,
      password: adminPassword,
    });
    expect(revoked.status).toBe(LicenseStatus.REVOKED);

    versions = await context.prisma.licenceVersion.findMany({ where: { licenceId }, orderBy: { versionNumber: 'asc' } });
    expect(versions).toHaveLength(7);
    expect(versions[6]).toMatchObject({ versionNumber: 7, actionType: 'REVOKED', signedLicenseEnc: null });

    // Version numbers must be strictly sequential and chained.
    expect(versions.map((v) => v.versionNumber)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    for (let i = 1; i < versions.length; i += 1) {
      expect(versions[i].previousVersionId).toBe(versions[i - 1].id);
    }

    licenceRow = await context.prisma.licence.findUniqueOrThrow({ where: { id: licenceId } });
    expect(licenceRow.currentVersionId).toBe(versions[6].id);

    // --- 8. Every further mutation on a revoked licence is rejected ---
    await expect(
      context.licencesService.suspend(context.adminActor, licenceId, { reason: 'x', password: adminPassword }),
    ).rejects.toMatchObject({ code: 'LICENCE_REVOKED' });
    await expect(
      context.licencesService.reactivate(context.adminActor, licenceId, { password: adminPassword }),
    ).rejects.toMatchObject({ code: 'LICENCE_REVOKED' });
    await expect(
      context.licencesService.reissue(context.adminActor, licenceId, { reason: 'x', password: adminPassword }),
    ).rejects.toMatchObject({ code: 'LICENCE_REVOKED' });
    await expect(
      context.licencesService.renew(context.adminActor, licenceId, { renewalPeriod: 'ANNUAL', password: adminPassword }),
    ).rejects.toMatchObject({ code: 'LICENCE_REVOKED' });
    await expect(
      context.licencesService.changeDeviceLimit(context.adminActor, licenceId, {
        maxDevices: 8,
        reason: 'x',
        password: adminPassword,
      }),
    ).rejects.toMatchObject({ code: 'LICENCE_REVOKED' });
    await expect(
      context.licencesService.changePlan(context.adminActor, licenceId, {
        newPlan: LicensePlan.MONTHLY,
        reason: 'x',
        password: adminPassword,
      }),
    ).rejects.toMatchObject({ code: 'LICENCE_REVOKED' });

    // --- 9. SUPPORT role is forbidden from any lifecycle mutation (403) ---
    const support = await context.prisma.admin.create({
      data: {
        email: 'support.lifecycle@patrol.test',
        passwordHash: await bcrypt.hash(adminPassword, 10),
        displayName: 'Support User',
        role: AdminRole.SUPPORT,
        isActive: true,
      },
    });
    const supportActor = {
      sub: support.id,
      email: support.email,
      role: support.role,
      displayName: support.displayName,
    };

    await expect(
      context.licencesService.renew(supportActor, licenceId, { renewalPeriod: 'ANNUAL', password: adminPassword }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_ROLE' });
    await expect(
      context.licencesService.suspend(supportActor, licenceId, { reason: 'x', password: adminPassword }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_ROLE' });

    // --- 10. findOne exposes the full version history without leaking TG1 material ---
    const detail = await context.licencesService.findOne(licenceId);
    expect(detail.versions).toHaveLength(7);
    expect(detail.versions.map((v: { actionType: string }) => v.actionType)).toEqual([
      'REVOKED',
      'DEVICE_LIMIT_CHANGED',
      'REACTIVATED',
      'SUSPENDED',
      'REISSUED',
      'RENEWED',
      'ISSUED',
    ]);
    for (const version of detail.versions as Array<Record<string, unknown>>) {
      expect(version).not.toHaveProperty('signedLicenseEnc');
      expect(version).toHaveProperty('hasSignedLicence');
    }
    expect(detail.versions[6]).toMatchObject({ issuedByDisplayName: context.admin.displayName });

    const fullPayload = JSON.stringify(detail);
    expect(fullPayload).not.toContain(issuedTg1);
    expect(fullPayload).not.toContain(renewed.fullLicenseKey);
    expect(fullPayload).not.toContain(reissuedTg1);
    expect(fullPayload).not.toContain(deviceLimitChanged.fullLicenseKey);
    expect(fullPayload).not.toMatch(/IntegrationTestPass/);

    // --- 11. Audit trail never leaks TG1 material or the admin password ---
    const auditRows = await context.prisma.auditLog.findMany({ where: { licenceId } });
    const auditPayload = JSON.stringify(auditRows);
    expect(auditPayload).not.toContain(issuedTg1);
    expect(auditPayload).not.toContain(renewed.fullLicenseKey);
    expect(auditPayload).not.toContain(reissuedTg1);
    expect(auditPayload).not.toContain(deviceLimitChanged.fullLicenseKey);
    expect(auditPayload).not.toMatch(/IntegrationTestPass/);
    expect(auditRows.map((row) => row.action)).toEqual(
      expect.arrayContaining([
        'licence.issued',
        'licence.renewal.requested',
        'licence.renewed',
        'licence.reissued',
        'licence.suspended',
        'licence.reactivated',
        'licence.device_limit_changed',
        'licence.revoked',
      ]),
    );
  });

  it('does not roll back a renewal when the optional confirmation email fails', async () => {
    const customer = await createTestCustomer(context.prisma, {
      companyName: 'Email Failure Ltd',
      email: 'email-failure@example.co.uk',
    });

    const issued = await context.licencesService.issueImmediately(context.adminActor, {
      customerId: customer.id,
      plan: LicensePlan.MONTHLY,
      startsAt: '2026-07-13',
      expiresAt: '2026-08-11',
      maxDevices: 1,
      features: ['collector'],
    });

    emailSend.mockResolvedValueOnce({
      success: false,
      errorCode: 'NOTIFICATION_SEND_FAILED',
      errorMessage: 'SMTP rejected the message',
    });

    const renewed = await context.licencesService.renew(context.adminActor, issued.licence.id, {
      renewalPeriod: 'MONTHLY',
      password: adminPassword,
      emailAfterRenewal: true,
    });

    expect(renewed.emailResult?.success).toBe(false);
    expect(renewed.fullLicenseKey).toMatch(/^TG1\./);

    const licenceRow = await context.prisma.licence.findUniqueOrThrow({ where: { id: issued.licence.id } });
    expect(licenceRow.status).toBe(LicenseStatus.ACTIVE);

    const versions = await context.prisma.licenceVersion.findMany({
      where: { licenceId: issued.licence.id },
    });
    expect(versions).toHaveLength(2);
    expect(versions.some((v) => v.actionType === 'RENEWED')).toBe(true);

    const renewedAudit = await context.prisma.auditLog.findFirst({
      where: { licenceId: issued.licence.id, action: 'licence.renewed' },
    });
    expect(renewedAudit).toBeTruthy();
    const failedFailedAudit = await context.prisma.auditLog.findFirst({
      where: { licenceId: issued.licence.id, action: 'licence.renewal.failed' },
    });
    expect(failedFailedAudit).toBeNull();
  });
});
