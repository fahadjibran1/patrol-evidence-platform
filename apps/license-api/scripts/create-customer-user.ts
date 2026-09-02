import { CustomerRole, PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

function readArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  return process.argv[index + 1];
}

async function main(): Promise<void> {
  const email = (readArg('--email') ?? process.env.LICENSE_CUSTOMER_USER_EMAIL)?.trim().toLowerCase();
  const password = readArg('--password') ?? process.env.LICENSE_CUSTOMER_USER_PASSWORD;
  const displayName =
    readArg('--display-name') ?? process.env.LICENSE_CUSTOMER_USER_DISPLAY_NAME ?? 'Customer User';
  const role = (readArg('--role') ?? process.env.LICENSE_CUSTOMER_USER_ROLE ?? CustomerRole.OWNER) as CustomerRole;
  const customerId = readArg('--customer-id') ?? process.env.LICENSE_CUSTOMER_ID;
  const customerEmail = (readArg('--customer-email') ?? process.env.LICENSE_CUSTOMER_EMAIL)?.trim().toLowerCase();

  if (!email || !password) {
    console.error('Provide --email and --password (or LICENSE_CUSTOMER_USER_EMAIL / LICENSE_CUSTOMER_USER_PASSWORD)');
    process.exit(1);
  }

  if (password.length < 8) {
    console.error('Password must be at least 8 characters');
    process.exit(1);
  }

  if (!Object.values(CustomerRole).includes(role)) {
    console.error(`Invalid role. Expected one of: ${Object.values(CustomerRole).join(', ')}`);
    process.exit(1);
  }

  const prisma = new PrismaClient();

  const customer = customerId
    ? await prisma.customer.findUnique({ where: { id: customerId } })
    : customerEmail
      ? await prisma.customer.findFirst({ where: { email: customerEmail } })
      : null;

  if (!customer) {
    console.error('Provide --customer-id or --customer-email for an existing Customer company record');
    await prisma.$disconnect();
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.customerUser.upsert({
    where: { email },
    update: {
      passwordHash,
      displayName,
      customerId: customer.id,
      role,
      isActive: true,
      emailVerifiedAt: new Date(),
    },
    create: {
      email,
      passwordHash,
      displayName,
      customerId: customer.id,
      role,
      emailVerifiedAt: new Date(),
    },
  });

  console.log(
    `Customer user ready: ${user.email} (${user.role}, company=${customer.companyName}, id=${customer.id})`,
  );
  await prisma.$disconnect();
}

void main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
