const { Client } = require('pg');
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

async function probe(label, url) {
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    const result = await client.query('select current_user, current_database()');
    console.log(`OK ${label} user=${result.rows[0].current_user} db=${result.rows[0].current_database}`);
    return true;
  } catch (error) {
    console.log(`FAIL ${label} ${error instanceof Error ? error.message : String(error)}`);
    return false;
  } finally {
    try {
      await client.end();
    } catch {
      // ignore
    }
  }
}

async function main() {
  const apiRoot = path.resolve(__dirname, '..');
  const repoRoot = path.resolve(apiRoot, '..', '..');
  const env = {
    ...loadEnvFile(path.join(repoRoot, '.env')),
    ...loadEnvFile(path.join(apiRoot, '.env')),
    ...loadEnvFile(path.join(apiRoot, '.env.integration-local')),
  };

  const candidates = [];
  if (env.LICENSE_TEST_DATABASE_URL) {
    candidates.push(['LICENSE_TEST_DATABASE_URL', env.LICENSE_TEST_DATABASE_URL]);
  }
  if (env.LICENSE_DATABASE_URL) {
    candidates.push(['LICENSE_DATABASE_URL', env.LICENSE_DATABASE_URL]);
  }
  if (env.DB_HOST) {
    const user = env.DB_USER || 'postgres';
    const pass = env.DB_PASS || env.DB_PASSWORD || '';
    const host = env.DB_HOST;
    const port = env.DB_PORT || '5432';
    const database = env.DB_NAME || 'postgres';
    candidates.push([
      'root-DB_*',
      `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}/${database}`,
    ]);
  }

  let anyOk = false;
  for (const [label, url] of candidates) {
    // eslint-disable-next-line no-await-in-loop
    anyOk = (await probe(label, url)) || anyOk;
  }
  process.exit(anyOk ? 0 : 1);
}

void main();
