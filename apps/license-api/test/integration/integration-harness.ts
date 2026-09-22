import { generateKeyPairSync } from 'crypto';
import { execFileSync } from 'child_process';
import { join } from 'path';
import { Test, type TestingModule } from '@nestjs/testing';
import { AdminRole, CustomerStatus, type Admin, type Customer } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { AppModule } from '@/app.module';
import { PrismaService } from '@/prisma/prisma.service';
import { SigningService } from '@/signing/signing.service';
import { LicencesService } from '@/licences/licences.service';
import type { AuthenticatedAdmin } from '@/auth/interfaces/authenticated-admin.interface';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { apiRoot, licenseDatabaseUrl } = require('./load-test-env');

export const LICENSE_ID_PATTERN = /^PEL-\d{4}-\d{6}$/;
export const CONCURRENT_ISSUANCE_COUNT = 20;
export const CONCURRENT_ISSUANCE_REPEATS = 5;

export interface IntegrationContext {
  module: TestingModule;
  prisma: PrismaService;
  licencesService: LicencesService;
  signingService: SigningService;
  admin: Admin;
  adminActor: AuthenticatedAdmin;
  publicKeyPem: string;
  privateKeyPem: string;
}

function ensureMigrationsApplied(): void {
  const { existsSync } = require('fs') as typeof import('fs');
  const candidates = [
    join(apiRoot, 'node_modules', 'prisma', 'build', 'index.js'),
    join(apiRoot, '..', '..', 'node_modules', 'prisma', 'build', 'index.js'),
  ];
  const cliPath = candidates.find((candidate) => existsSync(candidate));
  if (!cliPath) {
    throw new Error('Unable to locate the Prisma CLI for integration migrations.');
  }

  execFileSync(process.execPath, [cliPath, 'migrate', 'deploy'], {
    cwd: apiRoot,
    env: {
      ...process.env,
      LICENSE_DATABASE_URL: licenseDatabaseUrl,
    },
    stdio: 'pipe',
  });
}

export async function createIntegrationContext(): Promise<IntegrationContext> {
  if (!licenseDatabaseUrl) {
    throw new Error(
      'LICENSE_TEST_DATABASE_URL or LICENSE_DATABASE_URL (or DB_* credentials) must be set for integration tests.',
    );
  }

  ensureMigrationsApplied();

  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

  const module = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  await module.init();

  const prisma = module.get(PrismaService);
  const licencesService = module.get(LicencesService);
  const signingService = module.get(SigningService);
  signingService.useTestKey(privateKeyPem, 'integration-test-key');

  await resetIntegrationDatabase(prisma);

  const passwordHash = await bcrypt.hash('IntegrationTestPass123!', 10);
  const admin = await prisma.admin.create({
    data: {
      email: 'integration.admin@patrol.test',
      passwordHash,
      displayName: 'Integration Admin',
      role: AdminRole.SUPER_ADMIN,
      isActive: true,
    },
  });

  return {
    module,
    prisma,
    licencesService,
    signingService,
    admin,
    adminActor: {
      sub: admin.id,
      email: admin.email,
      role: admin.role,
      displayName: admin.displayName,
    },
    publicKeyPem,
    privateKeyPem,
  };
}

export async function resetIntegrationDatabase(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "CommercialDeliveryAttempt",
      "CommercialLicenceArtifact",
      "CommercialLicenceIssuance",
      "CommercialCheckoutSession",
      "CommercialPayment",
      "CommercialProviderEvent",
      "CommercialOutboxEvent",
      "CommercialOrder",
      "CommercialPurchaseReference",
      "CommercialPurchaseRequest",
      "NotificationLog",
      "AuditLog",
      "StripeReconciliationAlert",
      "StripeWebhookEvent",
      "StripeCheckoutSession",
      "StripeSubscriptionMapping",
      "StripePriceMapping",
      "StripeCustomerMapping",
      "BillingCredit",
      "BillingPayment",
      "Invoice",
      "InvoiceNumberSequence",
      "Subscription",
      "PaymentRecord",
      "Installation",
      "LicenceVersion",
      "Licence",
      "LicenceIdSequence",
      "RefreshToken",
      "CustomerEmailVerificationToken",
      "CustomerPasswordResetToken",
      "OrganisationInvitation",
      "CustomerSession",
      "CustomerRefreshToken",
      "CustomerUser",
      "Customer",
      "Admin"
    RESTART IDENTITY CASCADE
  `);

  // Catalogue plans are seeded by migration; re-assert after accidental truncation in older harnesses.
  await prisma.$executeRawUnsafe(`
    INSERT INTO "Plan" (
      "id", "code", "name", "description", "status",
      "monthlyPrice", "annualPrice", "currency", "billingInterval",
      "trialDays", "maxDevices", "includedFeatures", "supportLevel", "sortOrder", "isPublic",
      "createdAt", "updatedAt"
    ) VALUES
    (
      'plan-starter-0000000000000001',
      'STARTER',
      'Starter',
      'Essential patrol evidence licensing for small teams.',
      'ACTIVE',
      4900, 49000, 'GBP', 'MONTHLY',
      14, 2,
      '["MULTI_USER","HAZARD_DETECTION"]'::jsonb,
      'STANDARD', 10, true,
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    ),
    (
      'plan-professional-0000000001',
      'PROFESSIONAL',
      'Professional',
      'Advanced reporting and multi-device deployments.',
      'ACTIVE',
      9900, 99000, 'GBP', 'MONTHLY',
      14, 10,
      '["MULTI_USER","HAZARD_DETECTION","UNLIMITED_DOWNLOADS","ADVANCED_REPORTING","API_ACCESS","REMOTE_MONITORING"]'::jsonb,
      'PRIORITY', 20, true,
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    ),
    (
      'plan-enterprise-00000000001',
      'ENTERPRISE',
      'Enterprise',
      'Full platform access with dedicated support. Custom pricing available.',
      'ACTIVE',
      24900, 249000, 'GBP', 'ANNUAL',
      30, 100,
      '["MULTI_USER","HAZARD_DETECTION","UNLIMITED_DOWNLOADS","ADVANCED_REPORTING","API_ACCESS","REMOTE_MONITORING","WHITE_LABEL","CUSTOM_BRANDING"]'::jsonb,
      'DEDICATED', 30, true,
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
    ON CONFLICT ("code") DO NOTHING
  `);
}

export async function createTestCustomer(
  prisma: PrismaService,
  overrides: Partial<Customer> = {},
): Promise<Customer> {
  return prisma.customer.create({
    data: {
      companyName: overrides.companyName ?? 'Concurrent Test Security Ltd',
      contactName: overrides.contactName ?? 'Ops Manager',
      email: overrides.email ?? 'concurrent@example.co.uk',
      status: overrides.status ?? CustomerStatus.ACTIVE,
      country: overrides.country ?? 'GB',
    },
  });
}

export async function closeIntegrationContext(context: IntegrationContext): Promise<void> {
  await context.module.close();
}

export function sequenceNumbersFromLicenseIds(licenseIds: string[]): number[] {
  return licenseIds.map((licenseId) => {
    const match = licenseId.match(/^PEL-\d{4}-(\d{6})$/);
    if (!match) {
      throw new Error(`Unexpected licence ID format: ${licenseId}`);
    }
    return Number(match[1]);
  });
}
