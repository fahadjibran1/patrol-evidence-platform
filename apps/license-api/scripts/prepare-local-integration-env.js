const fs = require('fs');
const path = require('path');

function loadEnvFile(filePath, target = {}) {
  if (!fs.existsSync(filePath)) {
    return target;
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

    if (target[key] === undefined) {
      target[key] = value;
    }
  }

  return target;
}

const apiRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(apiRoot, '..', '..');
const env = loadEnvFile(path.join(repoRoot, '.env'));

const user = env.DB_USER || 'postgres';
const pass = env.DB_PASS || env.DB_PASSWORD || '';
const host = env.DB_HOST || 'localhost';
const port = env.DB_PORT || '5432';
const database = 'patrol_license_portal_test';
const url = `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}/${database}?schema=public`;

const outPath = path.join(apiRoot, '.env.integration-local');
fs.writeFileSync(
  outPath,
  [
    `LICENSE_TEST_DATABASE_URL=${url}`,
    `LICENSE_DATABASE_URL=${url}`,
    '',
  ].join('\n'),
  'utf8',
);

console.log(
  `Prepared ${path.relative(repoRoot, outPath)} host=${host}:${port} user=${user} database=${database}`,
);
