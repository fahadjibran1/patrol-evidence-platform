import { LicensePlan } from '@prisma/client';
import {
  closeIntegrationContext,
  CONCURRENT_ISSUANCE_COUNT,
  CONCURRENT_ISSUANCE_REPEATS,
  createIntegrationContext,
  createTestCustomer,
  LICENSE_ID_PATTERN,
  resetIntegrationDatabase,
  sequenceNumbersFromLicenseIds,
  type IntegrationContext,
} from './integration-harness';

describe('concurrent commercial licence issuance (PostgreSQL)', () => {
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
    const passwordHash = context.admin.passwordHash;
    const admin = await context.prisma.admin.create({
      data: {
        email: context.admin.email,
        passwordHash,
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

  async function runConcurrentIssuanceRound(round: number): Promise<void> {
    const customer = await createTestCustomer(context.prisma, {
      companyName: `Concurrent Customer Round ${round}`,
      email: `concurrent-round-${round}@example.co.uk`,
    });

    const results = await Promise.all(
      Array.from({ length: CONCURRENT_ISSUANCE_COUNT }, (_, index) =>
        context.licencesService.issueImmediately(context.adminActor, {
          customerId: customer.id,
          plan: LicensePlan.ANNUAL,
          startsAt: '2026-07-13',
          expiresAt: '2027-07-12',
          maxDevices: 1,
          features: ['collector'],
          notes: `concurrent-round-${round}-slot-${index}`,
        }),
      ),
    );

    expect(results).toHaveLength(CONCURRENT_ISSUANCE_COUNT);

    const licenseIds = results.map((result) => {
      expect(result.signedLicenseKey).toMatch(/^TG1\./);
      expect(result.licenseId).toMatch(LICENSE_ID_PATTERN);
      expect(result.status).toBe('ACTIVE');
      return result.licenseId;
    });

    expect(new Set(licenseIds).size).toBe(CONCURRENT_ISSUANCE_COUNT);

    const year = new Date().getUTCFullYear();
    for (const licenseId of licenseIds) {
      expect(licenseId.startsWith(`PEL-${year}-`)).toBe(true);
    }

    const sequenceNumbers = sequenceNumbersFromLicenseIds(licenseIds);
    expect(new Set(sequenceNumbers).size).toBe(CONCURRENT_ISSUANCE_COUNT);
    expect(sequenceNumbers.sort((a, b) => a - b)).toEqual(
      Array.from({ length: CONCURRENT_ISSUANCE_COUNT }, (_, index) => index + 1),
    );

    const storedLicences = await context.prisma.licence.findMany({
      where: { customerId: customer.id },
      orderBy: { licenseId: 'asc' },
    });
    expect(storedLicences).toHaveLength(CONCURRENT_ISSUANCE_COUNT);
    expect(new Set(storedLicences.map((licence) => licence.licenseId)).size).toBe(
      CONCURRENT_ISSUANCE_COUNT,
    );

    const issuedAudits = await context.prisma.auditLog.findMany({
      where: {
        action: 'licence.issued',
        customerId: customer.id,
      },
    });
    expect(issuedAudits).toHaveLength(CONCURRENT_ISSUANCE_COUNT);

    const draftAudits = await context.prisma.auditLog.findMany({
      where: {
        action: 'licence.draft_created',
        customerId: customer.id,
      },
    });
    expect(draftAudits).toHaveLength(CONCURRENT_ISSUANCE_COUNT);

    const sequence = await context.prisma.licenceIdSequence.findUnique({
      where: { year },
    });
    expect(sequence?.lastValue).toBe(CONCURRENT_ISSUANCE_COUNT);
  }

  it.each(Array.from({ length: CONCURRENT_ISSUANCE_REPEATS }, (_, index) => index + 1))(
    'issues %s concurrent licences with unique PEL IDs (repeat run)',
    async (round) => {
      await runConcurrentIssuanceRound(round);
    },
  );
});
