import { AdminRole, LicensePlan, LicenseStatus, NotificationStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { EmailProvider } from '@/notifications/providers/email.provider';
import {
  closeIntegrationContext,
  createIntegrationContext,
  createTestCustomer,
  resetIntegrationDatabase,
  type IntegrationContext,
} from './integration-harness';

describe('Licence email delivery integration (PostgreSQL)', () => {
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
      providerMessageId: 'mock-smtp-1',
    });
  });

  afterEach(() => {
    emailSend?.mockRestore();
  });

  it('emails from issue-success and licence-detail, audits safely, and keeps licence valid on failure', async () => {
    const customer = await createTestCustomer(context.prisma, {
      companyName: 'Email Integration Ltd',
      contactName: 'Ops Lead',
      email: 'email-customer@example.co.uk',
    });

    const issued = await context.licencesService.issueImmediately(context.adminActor, {
      customerId: customer.id,
      plan: LicensePlan.ANNUAL,
      startsAt: '2026-07-13',
      expiresAt: '2027-07-12',
      maxDevices: 1,
      features: ['collector'],
    });

    const tg1 = issued.fullLicenseKey as string;
    expect(tg1).toMatch(/^TG1\./);

    const issueSuccessEmail = await context.licencesService.emailLicence(context.adminActor, issued.licence.id, {
      source: 'issue-success',
      fullLicenseKey: tg1,
    });

    expect(issueSuccessEmail.success).toBe(true);
    expect(issueSuccessEmail.attachmentFilename).toBe(`${issued.licence.licenseId}.lic`);
    expect(issueSuccessEmail.recipient).toBe('email-customer@example.co.uk');
    expect(emailSend).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'email-customer@example.co.uk',
        attachments: [
          expect.objectContaining({
            filename: `${issued.licence.licenseId}.lic`,
            content: `${tg1}\n`,
            contentType: 'text/plain; charset=utf-8',
          }),
        ],
      }),
    );

    const sendPayload = emailSend.mock.calls[0][0];
    expect(sendPayload.html).not.toContain(tg1);
    expect(sendPayload.text).not.toContain(tg1);

    const sentLog = await context.prisma.notificationLog.findFirst({
      where: { licenceId: issued.licence.id, status: NotificationStatus.SENT },
    });
    expect(sentLog).toBeTruthy();
    expect(sentLog?.recipient).toBe('email-customer@example.co.uk');
    expect(JSON.stringify(sentLog?.metadata ?? {})).not.toContain(tg1);

    const emailedAudit = await context.prisma.auditLog.findFirst({
      where: { licenceId: issued.licence.id, action: 'licence.emailed' },
    });
    expect(emailedAudit).toBeTruthy();
    expect(JSON.stringify(emailedAudit?.metadata ?? {})).not.toContain(tg1);
    expect(JSON.stringify(emailedAudit?.metadata ?? {})).not.toMatch(/password/i);

    const detailEmail = await context.licencesService.emailLicence(context.adminActor, issued.licence.id, {
      source: 'licence-detail',
      password: adminPassword,
      recipientEmail: 'override@example.co.uk',
      message: 'Integration note',
    });
    expect(detailEmail.success).toBe(true);
    expect(detailEmail.recipient).toBe('override@example.co.uk');

    const support = await context.prisma.admin.create({
      data: {
        email: 'support.email@patrol.test',
        passwordHash: await bcrypt.hash(adminPassword, 10),
        displayName: 'Support User',
        role: AdminRole.SUPPORT,
        isActive: true,
      },
    });

    await expect(
      context.licencesService.emailLicence(
        {
          sub: support.id,
          email: support.email,
          role: support.role,
          displayName: support.displayName,
        },
        issued.licence.id,
        { source: 'licence-detail', password: adminPassword },
      ),
    ).rejects.toMatchObject({ code: 'LICENCE_REVEAL_FORBIDDEN' });

    emailSend.mockResolvedValueOnce({
      success: false,
      errorCode: 'NOTIFICATION_SEND_FAILED',
      errorMessage: 'SMTP rejected the message',
    });

    const failed = await context.licencesService.emailLicence(context.adminActor, issued.licence.id, {
      source: 'licence-detail',
      password: adminPassword,
    });
    expect(failed.success).toBe(false);

    const failedLog = await context.prisma.notificationLog.findFirst({
      where: { licenceId: issued.licence.id, status: NotificationStatus.FAILED },
      orderBy: { createdAt: 'desc' },
    });
    expect(failedLog).toBeTruthy();

    const licenceAfterFailure = await context.prisma.licence.findUnique({
      where: { id: issued.licence.id },
    });
    expect(licenceAfterFailure?.status).toBe(LicenseStatus.ACTIVE);

    const failedAudit = await context.prisma.auditLog.findFirst({
      where: { licenceId: issued.licence.id, action: 'licence.email.failed' },
      orderBy: { createdAt: 'desc' },
    });
    expect(failedAudit).toBeTruthy();
    expect(JSON.stringify(failedAudit?.metadata ?? {})).not.toContain(tg1);
  });
});
