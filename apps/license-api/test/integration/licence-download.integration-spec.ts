import { createPublicKey } from 'crypto';
import { AdminRole, LicensePlan } from '@prisma/client';
import { verifySignedLicenseKey } from '@patrol/license-core';
import * as bcrypt from 'bcrypt';
import {
  closeIntegrationContext,
  createIntegrationContext,
  createTestCustomer,
  resetIntegrationDatabase,
  type IntegrationContext,
} from './integration-harness';

describe('Licence download and reveal integration (PostgreSQL)', () => {
  let context: IntegrationContext;
  const adminPassword = 'IntegrationTestPass123!';

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
  });

  it('issues TG1, builds .lic content, reveals matching key, and audits safely', async () => {
    const customer = await createTestCustomer(context.prisma, {
      companyName: 'Download Integration Ltd',
      email: 'download@example.co.uk',
    });

    const issued = await context.licencesService.issueImmediately(context.adminActor, {
      customerId: customer.id,
      plan: LicensePlan.ANNUAL,
      startsAt: '2026-07-13',
      expiresAt: '2027-07-12',
      maxDevices: 1,
      features: ['collector'],
    });

    expect(issued.fullLicenseKey).toMatch(/^TG1\./);
    expect(issued.signedLicenseKey).toBe(issued.fullLicenseKey);

    const licFileContents = `${issued.fullLicenseKey.trim()}\n`;
    expect(licFileContents).toBe(`${issued.fullLicenseKey}\n`);

    const publicKey = createPublicKey(context.publicKeyPem);
    const verification = verifySignedLicenseKey({
      licenseKey: licFileContents.trim(),
      publicKey,
      today: '2026-07-13',
    });
    expect(verification.valid).toBe(true);

    const revealed = await context.licencesService.reveal(context.adminActor, issued.licence.id, {
      password: adminPassword,
    });
    expect(revealed.fullLicenseKey).toBe(issued.fullLicenseKey);
    expect(revealed.signedLicenseKey).toBe(issued.fullLicenseKey);

    const downloadEvent = await context.licencesService.recordDownloadEvent(
      context.adminActor,
      issued.licence.id,
      'licence-detail',
    );
    expect(downloadEvent.recorded).toBe(true);

    const audits = await context.prisma.auditLog.findMany({
      where: { licenceId: issued.licence.id },
      orderBy: { createdAt: 'asc' },
    });
    const actions = audits.map((entry) => entry.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'licence.reveal.requested',
        'licence.revealed',
        'licence.downloaded',
      ]),
    );

    for (const entry of audits) {
      expect(JSON.stringify(entry)).not.toContain(issued.fullLicenseKey);
    }

    const support = await context.prisma.admin.create({
      data: {
        email: 'support.download@patrol.test',
        passwordHash: await bcrypt.hash(adminPassword, 10),
        displayName: 'Support',
        role: AdminRole.SUPPORT,
        isActive: true,
      },
    });

    await expect(
      context.licencesService.reveal(
        {
          sub: support.id,
          email: support.email,
          role: support.role,
          displayName: support.displayName,
        },
        issued.licence.id,
        { password: adminPassword },
      ),
    ).rejects.toMatchObject({ code: 'LICENCE_REVEAL_FORBIDDEN' });
  });
});
