import { createPublicKey } from 'crypto';
import { LicensePlan } from '@prisma/client';
import {
  LICENSE_PAYLOAD_VERSION,
  isLicenseActiveOnDate,
  isLicenseExpiredOnDate,
  parseSignedLicenseKey,
  todayUtcDate,
  verifySignedLicenseKey,
} from '@patrol/license-core';
import {
  closeIntegrationContext,
  createIntegrationContext,
  createTestCustomer,
  resetIntegrationDatabase,
  type IntegrationContext,
} from './integration-harness';

describe('TG1 Phase 1 compatibility via API issuance (PostgreSQL)', () => {
  let context: IntegrationContext;

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
        passwordHash: context.admin.passwordHash,
        displayName: context.admin.displayName,
        role: context.admin.role,
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

  it('issues a TG1 licence that the Phase 1 verifier accepts with matching payload rules', async () => {
    const customer = await createTestCustomer(context.prisma, {
      companyName: 'Phase One Compatibility Ltd',
      email: 'phase1@example.co.uk',
    });

    const issued = await context.licencesService.issueImmediately(context.adminActor, {
      customerId: customer.id,
      plan: LicensePlan.ANNUAL,
      startsAt: '2026-07-13',
      expiresAt: '2027-07-12',
      maxDevices: 2,
      features: ['collector', 'evidence'],
      customerEmail: 'licence-contact@example.co.uk',
      notes: 'phase-1-compat',
    });

    expect(issued.signedLicenseKey).toMatch(/^TG1\./);
    expect(issued.licenseId).toMatch(/^PEL-\d{4}-\d{6}$/);

    const publicKey = createPublicKey(context.publicKeyPem);
    const verification = verifySignedLicenseKey({
      licenseKey: issued.signedLicenseKey,
      publicKey,
      today: '2026-07-13',
    });

    expect(verification.valid).toBe(true);
    expect(verification.signatureValid).toBe(true);
    expect(verification.payload).toEqual(
      expect.objectContaining({
        version: LICENSE_PAYLOAD_VERSION,
        licenseId: issued.licenseId,
        companyName: 'Phase One Compatibility Ltd',
        customerEmail: 'licence-contact@example.co.uk',
        plan: 'annual',
        issuedAt: todayUtcDate(),
        startsAt: '2026-07-13',
        expiresAt: '2027-07-12',
        maxDevices: 2,
        features: ['collector', 'evidence'],
        notes: 'phase-1-compat',
      }),
    );

    const parsed = parseSignedLicenseKey(issued.signedLicenseKey);
    expect(parsed).not.toBeNull();

    // Phase 1 expiry rule: expiresAt is inclusive for the full UTC day.
    expect(isLicenseExpiredOnDate('2027-07-12', '2027-07-12')).toBe(false);
    expect(isLicenseExpiredOnDate('2027-07-12', '2027-07-13')).toBe(true);
    expect(isLicenseActiveOnDate('2026-07-13', '2027-07-12', '2027-07-12')).toBe(true);

    const onExpiryDay = verifySignedLicenseKey({
      licenseKey: issued.signedLicenseKey,
      publicKey,
      today: '2027-07-12',
    });
    expect(onExpiryDay.valid).toBe(true);

    const afterExpiry = verifySignedLicenseKey({
      licenseKey: issued.signedLicenseKey,
      publicKey,
      today: '2027-07-13',
    });
    expect(afterExpiry.valid).toBe(false);
    expect(afterExpiry.reason).toBe('Licence has expired.');

    const list = await context.licencesService.list({
      page: 1,
      pageSize: 20,
      customerId: customer.id,
    });
    expect(list.items).toHaveLength(1);
    expect(list.items[0].maskedKey).toMatch(/^TG1\./);
    expect(list.items[0]).not.toHaveProperty('signedLicenseKey');
    expect(JSON.stringify(list.items[0])).not.toContain(issued.signedLicenseKey);
  });
});
