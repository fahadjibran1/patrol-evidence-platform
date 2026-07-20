import { PrismaClient, AdminRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';

function readArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  return process.argv[index + 1];
}

async function main(): Promise<void> {
  const email = (readArg('--email') ?? process.env.LICENSE_ADMIN_EMAIL)?.trim().toLowerCase();
  const password = readArg('--password') ?? process.env.LICENSE_ADMIN_PASSWORD;
  const displayName = readArg('--display-name') ?? process.env.LICENSE_ADMIN_DISPLAY_NAME ?? 'Super Admin';
  const role = (readArg('--role') ?? process.env.LICENSE_ADMIN_ROLE ?? AdminRole.SUPER_ADMIN) as AdminRole;

  if (!email || !password) {
    console.error('Provide --email and --password or set LICENSE_ADMIN_EMAIL and LICENSE_ADMIN_PASSWORD');
    process.exit(1);
  }

  if (password.length < 8) {
    console.error('Password must be at least 8 characters');
    process.exit(1);
  }

  const prisma = new PrismaClient();
  const passwordHash = await bcrypt.hash(password, 12);

  const admin = await prisma.admin.upsert({
    where: { email },
    update: {
      passwordHash,
      displayName,
      role,
      isActive: true,
    },
    create: {
      email,
      passwordHash,
      displayName,
      role,
    },
  });

  console.log(`Administrator ready: ${admin.email} (${admin.role})`);
  await prisma.$disconnect();
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
