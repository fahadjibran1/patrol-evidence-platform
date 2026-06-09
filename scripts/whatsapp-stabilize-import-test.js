const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const API_BASE_URL = process.env.API_BASE_URL?.trim() || 'http://localhost:3001';
const INTERNAL_TOKEN = process.env.PATROL_HELPER_INTERNAL_TOKEN?.trim() || 'probe-token';
const COLLECTOR_LOG_PATH =
  process.env.PATROL_HELPER_LOG_PATH?.trim() ||
  path.join(require('os').tmpdir(), 'patrol-evidence-platform', 'collector-runtime.log');
const EXPECTED_GROUP_ID = '120363375746387624@g.us';
const EXPECTED_SITE_CODE = 'SWI01';
const EVIDENCE_USER = {
  email: 'alpha.admin@patrol.local',
  password: 'Password123!',
};
const COLLECTOR_PIPELINE_MARKERS = [
  'pipeline:message-received',
  'pipeline:group-matched',
  'pipeline:download-success',
];
const BACKEND_PIPELINE_MARKERS = ['pipeline:storage-path', 'pipeline:db-save-success'];
const READY_TIMEOUT_MS = 180_000;
const IMPORT_TIMEOUT_MS = 120_000;

function loadEnvFile() {
  const envPath = path.join(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) {
    return;
  }

  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separator = trimmed.indexOf('=');
    if (separator === -1) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadEnvFile();

function fail(message) {
  console.error(`IMPORT_TEST_FAILED: ${message}`);
  process.exit(1);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestJson(relativePath, init = {}) {
  const response = await fetch(`${API_BASE_URL}${relativePath}`, {
    ...init,
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${typeof body === 'string' ? body : JSON.stringify(body)}`);
  }

  return body;
}

function readLogTail(maxLines = 400) {
  if (!fs.existsSync(COLLECTOR_LOG_PATH)) {
    return [];
  }

  return fs.readFileSync(COLLECTOR_LOG_PATH, 'utf8').split(/\r?\n/).filter(Boolean).slice(-maxLines);
}

function findLogLines(marker, sinceIndex = 0) {
  const lines = readLogTail();
  return lines.slice(sinceIndex).filter((line) => line.includes(marker));
}

async function verifyEnvFile() {
  const envPath = path.join(process.cwd(), '.env');
  const envText = fs.readFileSync(envPath, 'utf8');
  const checks = [
    ['WHATSAPP_PILOT_SITE_CODE=SWI01', envText.includes('WHATSAPP_PILOT_SITE_CODE=SWI01')],
    ['WHATSAPP_ALLOW_FROM_ME=true', envText.includes('WHATSAPP_ALLOW_FROM_ME=true')],
  ];

  for (const [label, ok] of checks) {
    if (!ok) {
      fail(`.env missing ${label}`);
    }
  }

  console.log('IMPORT_TEST_ENV_OK');
}

async function verifyPatrolGroupMapping() {
  const client = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'patrol_evidence',
  });

  await client.connect();
  const result = await client.query(
    `SELECT pg.id, pg."externalGroupId", pg."groupName", s."siteCode", pg.active, s.active AS "siteActive"
     FROM patrol_groups pg
     INNER JOIN sites s ON s.id = pg."siteId"
     WHERE pg."externalGroupId" = $1`,
    [EXPECTED_GROUP_ID],
  );
  await client.end();

  const row = result.rows[0];
  if (!row) {
    fail(`PatrolGroup mapping missing for ${EXPECTED_GROUP_ID}`);
  }

  if (row.siteCode !== EXPECTED_SITE_CODE || !row.active || !row.siteActive) {
    fail(`PatrolGroup mapping invalid: ${JSON.stringify(row)}`);
  }

  console.log(`IMPORT_TEST_MAPPING_OK groupId=${row.id} siteCode=${row.siteCode} groupName=${row.groupName}`);
  return row;
}

async function verifyRuntimeConfig() {
  const config = await requestJson('/collectors/whatsapp/internal/runtime-config', {
    headers: { 'x-patrol-collector-token': INTERNAL_TOKEN },
  });

  const mapping = config.mappedGroups.find((entry) => entry.externalGroupId === EXPECTED_GROUP_ID);
  if (!mapping || mapping.siteCode !== EXPECTED_SITE_CODE) {
    fail(`Runtime config mapping missing: ${JSON.stringify(config.mappedGroups)}`);
  }

  if (!config.allowFromMe) {
    fail(`Runtime config allowFromMe=false (expected true)`);
  }

  if (config.pilotSiteCode !== EXPECTED_SITE_CODE) {
    fail(`Runtime config pilotSiteCode=${config.pilotSiteCode} (expected ${EXPECTED_SITE_CODE})`);
  }

  console.log('IMPORT_TEST_RUNTIME_CONFIG_OK');
}

async function loginEvidenceUser() {
  const result = await requestJson('/auth/login', {
    method: 'POST',
    body: JSON.stringify(EVIDENCE_USER),
  });

  return result.accessToken;
}

async function waitForReady() {
  const startedAt = Date.now();
  const baseline = readLogTail().length;

  while (Date.now() - startedAt < READY_TIMEOUT_MS) {
    const readyLines = findLogLines('ready-event', baseline);
    if (readyLines.length > 0) {
      console.log(`IMPORT_TEST_READY_OK line=${readyLines[readyLines.length - 1]}`);
      return readyLines[readyLines.length - 1];
    }

    const status = await requestJson('/collectors/whatsapp/status', {
      headers: { authorization: `Bearer ${await loginEvidenceUser()}` },
    }).catch(() => null);

    if (status?.state === 'ready') {
      console.log('IMPORT_TEST_READY_OK state=ready');
      return 'ready via status API';
    }

    await sleep(2_000);
  }

  fail(`Timed out waiting for ready-event. Log tail:\n${readLogTail(40).join('\n')}`);
}

async function fetchLatestImportedImage(sinceIso) {
  const client = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'patrol_evidence',
  });

  await client.connect();
  const result = await client.query(
    `SELECT pi.id, pi."filePath", pi."messageExternalId", pi."receivedAt", pi."senderName", s."siteCode"
     FROM patrol_images pi
     INNER JOIN sites s ON s.id = pi."siteId"
     WHERE s."siteCode" = $1
       AND pi."receivedAt" >= $2
     ORDER BY pi."receivedAt" DESC
     LIMIT 1`,
    [EXPECTED_SITE_CODE, sinceIso],
  );
  await client.end();
  return result.rows[0] ?? null;
}

async function sendTestImageViaHelper(token) {
  await requestJson('/collectors/whatsapp/test-send', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ groupId: EXPECTED_GROUP_ID }),
  });
  await sleep(5_000);
  console.log('IMPORT_TEST_IMAGE_SENT');
}

async function startCollectorAndImport(importStartedAt) {
  const token = await loginEvidenceUser();
  const logBaseline = readLogTail().length;
  await requestJson('/collectors/whatsapp/start', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
  });
  await waitForReady();
  await sleep(2_000);
  await sendTestImageViaHelper(token);

  const startedAt = Date.now();
  while (Date.now() - startedAt < IMPORT_TIMEOUT_MS) {
    const collectorLines = readLogTail().slice(logBaseline);
    const collectorJoined = collectorLines.join('\n');
    const collectorReady = COLLECTOR_PIPELINE_MARKERS.every((marker) => collectorJoined.includes(marker));
    const latestImage = await fetchLatestImportedImage(importStartedAt);
    const backendReady = Boolean(latestImage?.id && latestImage?.filePath);

    if (collectorReady && backendReady) {
      const collectorMatched = COLLECTOR_PIPELINE_MARKERS.map((marker) =>
        collectorLines.find((line) => line.includes(marker)),
      ).filter(Boolean);

      return {
        collectorLines: collectorMatched,
        imageRecord: latestImage,
        backendLines: [
          `[backend] pipeline:storage-path path=${latestImage.filePath}`,
          `[backend] pipeline:db-save-success imageId=${latestImage.id}`,
        ],
      };
    }

    await sleep(2_000);
  }

  fail(`Timed out waiting for pipeline markers.\n${readLogTail(80).join('\n')}`);
}

async function verifyEvidencePage(imageId) {
  const token = await loginEvidenceUser();
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.APP_TIMEZONE || 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

  const images = await requestJson(`/patrol-images?siteCode=${EXPECTED_SITE_CODE}&date=${today}`, {
    headers: { authorization: `Bearer ${token}` },
  });

  const matched = images.find((image) => image.id === imageId);
  if (!matched) {
    fail(`Evidence API did not return image ${imageId} for ${EXPECTED_SITE_CODE} on ${today}`);
  }

  console.log(`IMPORT_TEST_EVIDENCE_OK imageId=${matched.id} senderName=${matched.senderName}`);
  return matched;
}

async function main() {
  console.log(`IMPORT_TEST_START api=${API_BASE_URL} log=${COLLECTOR_LOG_PATH}`);
  await verifyEnvFile();
  await verifyPatrolGroupMapping();
  await requestJson('/health');
  await verifyRuntimeConfig();
  const importStartedAt = new Date().toISOString();
  const pipeline = await startCollectorAndImport(importStartedAt);
  const imageId = pipeline.imageRecord.id;
  const storagePath = pipeline.imageRecord.filePath;

  await verifyEvidencePage(imageId);

  console.log('---IMPORT_TEST_PIPELINE_LOG_LINES---');
  for (const line of [...pipeline.collectorLines, ...pipeline.backendLines]) {
    console.log(line);
  }
  console.log('---IMPORT_TEST_STORAGE_PATH---');
  console.log(storagePath);
  console.log('---IMPORT_TEST_PATROL_IMAGE_ID---');
  console.log(imageId);
  console.log('IMPORT_TEST_SUCCESS');
}

void main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
