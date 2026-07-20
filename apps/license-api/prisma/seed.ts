import { PrismaClient, AdminRole, CustomerStatus, LicensePlan, LicenseStatus, PaymentStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const adminEmail = process.env.LICENSE_ADMIN_EMAIL ?? 'admin@example.com';
  const adminPassword = process.env.LICENSE_ADMIN_PASSWORD ?? 'ChangeMe123!';
  const passwordHash = await bcrypt.hash(adminPassword, 12);

  await prisma.admin.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      email: adminEmail,
      passwordHash,
      displayName: process.env.LICENSE_ADMIN_DISPLAY_NAME ?? 'Demo Super Admin',
      role: AdminRole.SUPER_ADMIN,
    },
  });

  const customer = await prisma.customer.upsert({
    where: { id: '00000000-0000-4000-8000-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-4000-8000-000000000001',
      companyName: 'Demo Security Ltd',
      contactName: 'Alex Demo',
      email: 'demo@example.com',
      status: CustomerStatus.TRIAL,
      country: 'GB',
    },
  });

  const admin = await prisma.admin.findUniqueOrThrow({ where: { email: adminEmail } });

  await prisma.licence.upsert({
    where: { licenseId: 'PEL-2026-000001' },
    update: {},
    create: {
      licenseId: 'PEL-2026-000001',
      customerId: customer.id,
      plan: LicensePlan.TRIAL,
      status: LicenseStatus.DRAFT,
      startsAt: new Date('2026-07-18'),
      expiresAt: new Date('2026-08-16'),
      maxDevices: 1,
      features: ['collector'],
      createdByAdminId: admin.id,
    },
  });

  await prisma.licenceIdSequence.upsert({
    where: { year: 2026 },
    update: { lastValue: 1 },
    create: { year: 2026, lastValue: 1 },
  });

  await prisma.paymentRecord.createMany({
    data: [
      {
        customerId: customer.id,
        amountPence: 9900,
        currency: 'GBP',
        paymentStatus: PaymentStatus.PENDING,
        paymentReference: 'INV-DEMO-001',
        recordedByAdminId: admin.id,
      },
    ],
    skipDuplicates: true,
  });

  console.log('Seed complete.');
  console.log(`Admin login: ${adminEmail} / ${adminPassword}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
