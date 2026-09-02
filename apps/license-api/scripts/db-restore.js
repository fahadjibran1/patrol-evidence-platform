#!/usr/bin/env node
/**
 * Restore helper. DANGEROUS — overwrites the target database.
 * Usage: LICENSE_DATABASE_URL=... node scripts/db-restore.js path/to/backup.sql
 */
const { spawnSync } = require('child_process');
const { existsSync } = require('fs');
const { resolve } = require('path');

const url = process.env.LICENSE_DATABASE_URL;
const file = process.argv[2];
if (!url || !file) {
  console.error('Usage: LICENSE_DATABASE_URL=... node scripts/db-restore.js <backup.sql>');
  process.exit(1);
}
const path = resolve(file);
if (!existsSync(path)) {
  console.error(`File not found: ${path}`);
  process.exit(1);
}

if (process.env.CONFIRM_RESTORE !== 'YES') {
  console.error('Refusing to restore. Set CONFIRM_RESTORE=YES to proceed.');
  process.exit(1);
}

const result = spawnSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-f', path], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
process.exit(result.status || 0);
