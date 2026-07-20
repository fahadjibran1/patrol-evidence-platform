const fs = require('fs');
const path = require('path');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) {
      continue;
    }

    const separator = trimmed.indexOf('=');
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

const apiRoot = path.resolve(__dirname, '..', '..');
const repoRoot = path.resolve(apiRoot, '..', '..');

loadEnvFile(path.join(apiRoot, '.env'));
loadEnvFile(path.join(repoRoot, '.env'));

function buildTestDatabaseUrl() {
  if (process.env.LICENSE_TEST_DATABASE_URL?.trim()) {
    return process.env.LICENSE_TEST_DATABASE_URL.trim();
  }

  if (process.env.LICENSE_DATABASE_URL?.trim()) {
    return process.env.LICENSE_DATABASE_URL.trim();
  }

  const user = process.env.DB_USER?.trim() || 'postgres';
  const password = process.env.DB_PASSWORD ?? '';
  const host = process.env.DB_HOST?.trim() || 'localhost';
  const port = process.env.DB_PORT?.trim() || '5432';
  const database = process.env.LICENSE_TEST_DATABASE_NAME?.trim() || 'patrol_license_portal_test';

  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}?schema=public`;
}

process.env.NODE_ENV = 'test';
process.env.LICENSE_DATABASE_URL = buildTestDatabaseUrl();
process.env.JWT_SECRET =
  process.env.JWT_SECRET?.trim() || 'integration-test-jwt-secret-at-least-32-chars';
process.env.LICENCE_STORAGE_ENCRYPTION_KEY =
  process.env.LICENCE_STORAGE_ENCRYPTION_KEY?.trim() ||
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.LICENSE_SIGNING_KEY_ID =
  process.env.LICENSE_SIGNING_KEY_ID?.trim() || 'integration-test-key';
process.env.LICENSE_API_PORT = process.env.LICENSE_API_PORT || '3010';
process.env.LICENSE_PORTAL_ORIGIN = process.env.LICENSE_PORTAL_ORIGIN || 'http://localhost:5174';

const privateKeyFile =
  process.env.LICENSE_PRIVATE_KEY_FILE?.trim() ||
  path.join(repoRoot, '.license-keys', 'license-private.pem');
if (!process.env.LICENSE_PRIVATE_KEY?.trim() && fs.existsSync(privateKeyFile)) {
  process.env.LICENSE_PRIVATE_KEY_FILE = privateKeyFile;
}

module.exports = {
  apiRoot,
  repoRoot,
  licenseDatabaseUrl: process.env.LICENSE_DATABASE_URL,
};
