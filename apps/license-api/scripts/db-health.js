#!/usr/bin/env node
/**
 * Verifies database connectivity and that Prisma migrations table is readable.
 */
const { PrismaClient } = require('@prisma/client');

async function main() {
  const prisma = new PrismaClient();
  try {
    await prisma.$queryRaw`SELECT 1 AS ok`;
    const migrations = await prisma.$queryRawUnsafe(
      `SELECT migration_name, finished_at FROM "_prisma_migrations" ORDER BY finished_at DESC NULLS LAST LIMIT 5`,
    );
    console.log(JSON.stringify({ ok: true, recentMigrations: migrations }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: String(error.message || error) }));
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
