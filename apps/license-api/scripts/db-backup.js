#!/usr/bin/env node
/**
 * Production Postgres backup helper for LICENSE_DATABASE_URL.
 * Usage: LICENSE_DATABASE_URL=... node scripts/db-backup.js [output.sql.gz]
 */
const { spawnSync } = require('child_process');
const { mkdirSync } = require('fs');
const { dirname, resolve } = require('path');

const url = process.env.LICENSE_DATABASE_URL;
if (!url) {
  console.error('LICENSE_DATABASE_URL is required');
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const out = resolve(process.argv[2] || `backups/license-db-${stamp}.sql`);
mkdirSync(dirname(out), { recursive: true });

const result = spawnSync('pg_dump', [url, '--no-owner', '--no-acl', '-f', out], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

if (result.status !== 0) {
  console.error('pg_dump failed — ensure PostgreSQL client tools are installed and on PATH');
  process.exit(result.status || 1);
}

console.log(`Backup written: ${out}`);
console.log('Optional: gzip the file for long-term storage.');
