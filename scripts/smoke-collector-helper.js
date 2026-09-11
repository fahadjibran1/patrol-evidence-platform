const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const outRoot = path.join(projectRoot, 'out');
const HEALTH_TIMEOUT_MS = 180_000;
const COLLECTOR_TIMEOUT_MS = 180_000;
const LOG_POLL_INTERVAL_MS = 1_000;
const SMOKE_HELPER_TOKEN = 'patrol-smoke-helper-token';
const SMOKE_ADMIN = {
  email: 'admin@patrol.local',
  password: 'Password123!',
  firstName: 'Local',
  lastName: 'Admin',
};
const SMOKE_SITE = {
  siteCode: 'SMOKE1',
  siteName: 'Smoke Test Site',
  clientName: 'Smoke Client',
};
const SMOKE_IMAGE_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9s3FoXcAAAAASUVORK5CYII=';

function fail(message) {
  console.error(`COLLECTOR SMOKE FAILED: ${message}`);
  process.exit(1);
}

function findPackagedAppDir() {
  const explicitDir = process.env.PATROL_PACKAGED_APP_DIR?.trim();
  if (explicitDir) {
    return explicitDir;
  }

  if (!fs.existsSync(outRoot)) {
    fail(`Output folder is missing: ${outRoot}`);
  }

  const candidates = fs
    .readdirSync(outRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(outRoot, entry.name))
    .filter((entryPath) => /win32-x64$/i.test(path.basename(entryPath)));

  if (candidates.length === 0) {
    fail(`No packaged Windows app folder found under ${outRoot}`);
  }

  candidates.sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);
  return candidates[0];
}

function waitForHealth(url, timeoutMs) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const tick = () => {
      const request = http.get(url, (response) => {
        let body = '';
        response.on('data', (chunk) => {
          body += chunk.toString();
        });
        response.on('end', () => {
          if (response.statusCode === 200) {
            resolve(body);
            return;
          }

          if (Date.now() - startedAt > timeoutMs) {
            reject(new Error(`Health endpoint returned status ${response.statusCode}`));
            return;
          }

          setTimeout(tick, 1000);
        });
      });

      request.on('error', () => {
        if (Date.now() - startedAt > timeoutMs) {
          reject(new Error(`Timed out waiting for ${url}`));
          return;
        }

        setTimeout(tick, 1000);
      });
    };

    tick();
  });
}

function reserveFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Unable to determine a free smoke port.')));
        return;
      }

      const port = address.port;
      server.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }

        resolve(port);
      });
    });
  });
}

function killChild(child) {
  if (!child || child.killed) {
    return;
  }

  try {
    child.kill();
  } catch {
    // Ignore cleanup errors during smoke cleanup.
  }
}

function collectChildOutput(child) {
  const stdoutBuffer = [];
  const stderrBuffer = [];
  let exitCode = null;
  let exitSignal = null;

  child.stdout?.on('data', (chunk) => {
    const text = chunk.toString();
    stdoutBuffer.push(text);
    process.stdout.write(text);
  });

  child.stderr?.on('data', (chunk) => {
    const text = chunk.toString();
    stderrBuffer.push(text);
    process.stderr.write(text);
  });

  child.on('exit', (code, signal) => {
    exitCode = code;
    exitSignal = signal;
  });

  return {
    stdoutBuffer,
    stderrBuffer,
    getExitDetails: () => ({ exitCode, exitSignal }),
  };
}

function readLogTail(logPath, maxLines = 120) {
  if (!fs.existsSync(logPath)) {
    return [];
  }

  return fs.readFileSync(logPath, 'utf8').split(/\r?\n/).filter(Boolean).slice(-maxLines);
}

async function requestJson(url, init = {}) {
  const response = await fetch(url, {
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

async function bootstrapWorkspace(apiBaseUrl) {
  return requestJson(`${apiBaseUrl}/desktop/bootstrap/initialize`, {
    method: 'POST',
    body: JSON.stringify({
      companyName: 'Tech Guards Security',
      adminFirstName: SMOKE_ADMIN.firstName,
      adminLastName: SMOKE_ADMIN.lastName,
      adminEmail: SMOKE_ADMIN.email,
      adminPassword: SMOKE_ADMIN.password,
      workspaceName: 'PatrolSafe Workspace',
      licenseKey: 'TG-TRIAL-DEV',
      autoStartCollector: true,
      autoLaunchApp: false,
      whatsappAllowFromMe: false,
    }),
  });
}

async function login(apiBaseUrl) {
  const result = await requestJson(`${apiBaseUrl}/auth/login`, {
    method: 'POST',
    body: JSON.stringify({
      email: SMOKE_ADMIN.email,
      password: SMOKE_ADMIN.password,
    }),
  });

  return result.accessToken;
}

async function createSmokeSite(apiBaseUrl, accessToken) {
  return requestJson(`${apiBaseUrl}/sites`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      ...SMOKE_SITE,
      active: true,
    }),
  });
}

async function sendHelperImport(apiBaseUrl) {
  const timestamp = new Date().toISOString();
  return requestJson(`${apiBaseUrl}/collectors/whatsapp/internal/ingest`, {
    method: 'POST',
    headers: {
      'x-patrol-collector-token': SMOKE_HELPER_TOKEN,
    },
    body: JSON.stringify({
      siteCode: SMOKE_SITE.siteCode,
      senderName: 'Smoke Helper',
      originalFileName: 'smoke-helper.png',
      mimeType: 'image/png',
      fileSize: Buffer.from(SMOKE_IMAGE_BASE64, 'base64').length,
      fileBase64: SMOKE_IMAGE_BASE64,
      timestamp,
      messageExternalId: `smoke-${Date.now()}`,
    }),
  });
}

async function verifyImportedImages(apiBaseUrl, accessToken) {
  const images = await requestJson(`${apiBaseUrl}/patrol-images`, {
    headers: {
      authorization: `Bearer ${accessToken}`,
    },
  });

  if (!Array.isArray(images) || images.length === 0) {
    throw new Error('No patrol images were returned after the helper ingest smoke.');
  }

  const matched = images.find((image) => image.senderName === 'Smoke Helper');
  if (!matched) {
    throw new Error('The smoke helper image was not found in patrol-images results.');
  }

  return matched;
}

async function fetchCollectorStatus(apiBaseUrl, accessToken) {
  return requestJson(`${apiBaseUrl}/collectors/whatsapp/status`, {
    headers: {
      authorization: `Bearer ${accessToken}`,
    },
  });
}

async function waitForCollectorOutcome(logPath, timeoutMs) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const tick = () => {
      const logLines = readLogTail(logPath, 200);
      const joined = logLines.join('\n');

      if (/ready-event/i.test(joined)) {
        resolve({ outcome: 'ready', logLines });
        return;
      }

      if (/authenticated-event/i.test(joined)) {
        resolve({ outcome: 'authenticated', logLines });
        return;
      }

      if (/qr-received/i.test(joined)) {
        resolve({ outcome: 'qr', logLines });
        return;
      }

      if (
        /browser-resolution-error|puppeteer-launch-error|session-path-error|auth-failure|collector-timeout|collector-crash|uncaughtException/i.test(
          joined,
        )
      ) {
        reject(
          new Error(
            `Collector reported a startup failure.\n---COLLECTOR LOG---\n${logLines.join('\n') || 'No log lines captured.'}`,
          ),
        );
        return;
      }

      if (Date.now() - startedAt > timeoutMs) {
        reject(
          new Error(
            `Timed out waiting for QR or reconnect.\n---COLLECTOR LOG---\n${logLines.join('\n') || 'No log lines captured.'}`,
          ),
        );
        return;
      }

      setTimeout(tick, LOG_POLL_INTERVAL_MS);
    };

    tick();
  });
}

function readLatestQr(latestQrPath) {
  if (!fs.existsSync(latestQrPath)) {
    throw new Error(`latest-qr.txt was not created: ${latestQrPath}`);
  }

  const qrPayload = fs.readFileSync(latestQrPath, 'utf8').trim();
  if (!qrPayload) {
    throw new Error(`latest-qr.txt is empty: ${latestQrPath}`);
  }

  return qrPayload;
}

async function main() {
  const healthPort = await reserveFreePort();
  const healthUrl = `http://localhost:${healthPort}/health`;
  const apiBaseUrl = `http://localhost:${healthPort}`;
  const packagedAppDir = findPackagedAppDir();
  const packagedExePath = path.join(packagedAppDir, 'PatrolEvidencePlatform.exe');
  const appRoot = path.join(packagedAppDir, 'resources', 'app');
  const smokeRoot = path.join(os.tmpdir(), 'patrol-evidence-platform-collector-smoke');
  const configRoot = path.join(smokeRoot, `run-${Date.now()}`);
  const configPath = path.join(configRoot, 'workspace-config.json');
  const dataDir = path.join(configRoot, 'data');
  const storageRoot = path.join(dataDir, 'Security_Patrols');
  const sqliteDbPath = path.join(dataDir, 'patrol-evidence.db');
  const collectorLogPath = path.join(configRoot, 'collector-runtime.log');
  const latestQrPath = path.join(configRoot, 'latest-qr.txt');

  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(storageRoot, { recursive: true });
  fs.writeFileSync(
    configPath,
    JSON.stringify(
      {
        companyName: 'Tech Guards Security',
        licenseKey: 'TG-TRIAL-DEV',
        dbType: 'sqlite',
        sqliteDbPath,
        storageRootPath: storageRoot,
        backendPort: healthPort,
        autoStartCollector: true,
        whatsappHeadless: false,
      },
      null,
      2,
    ),
    'utf8',
  );

  if (!fs.existsSync(packagedExePath)) {
    fail(`Packaged executable is missing: ${packagedExePath}`);
  }

  const env = {
    ...process.env,
    PORT: String(healthPort),
    DESKTOP_CONFIG_PATH: configPath,
    DB_TYPE: 'sqlite',
    SQLITE_DB_PATH: sqliteDbPath,
    STORAGE_ROOT_PATH: storageRoot,
    WHATSAPP_ENABLED: 'true',
    APP_DEBUG: 'true',
    PATROL_SMOKE_BACKEND_ONLY: 'true',
    PATROL_HELPER_INTERNAL_TOKEN: SMOKE_HELPER_TOKEN,
  };

  console.log(`COLLECTOR SMOKE INFO: packagedAppDir=${packagedAppDir}`);
  console.log(`COLLECTOR SMOKE INFO: healthPort=${healthPort}`);
  console.log(`COLLECTOR SMOKE INFO: configPath=${configPath}`);
  console.log(`COLLECTOR SMOKE INFO: collectorLogPath=${collectorLogPath}`);
  console.log(`COLLECTOR SMOKE INFO: latestQrPath=${latestQrPath}`);

  const child = spawn(packagedExePath, [], {
    cwd: appRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  const output = collectChildOutput(child);

  try {
    const healthBody = await waitForHealth(healthUrl, HEALTH_TIMEOUT_MS);
    console.log(`COLLECTOR SMOKE HEALTH: ${healthBody}`);
    await bootstrapWorkspace(apiBaseUrl);
    const accessToken = await login(apiBaseUrl);
    await createSmokeSite(apiBaseUrl, accessToken);

    const result = await waitForCollectorOutcome(collectorLogPath, COLLECTOR_TIMEOUT_MS);
    const collectorStatus = await fetchCollectorStatus(apiBaseUrl, accessToken);
    const qrPayload = readLatestQr(latestQrPath);

    if (!collectorStatus?.qrCode) {
      throw new Error('Collector status did not expose qrCode to the frontend API.');
    }

    if (collectorStatus.qrCode !== qrPayload) {
      throw new Error('Collector status QR payload does not match latest-qr.txt.');
    }

    if (collectorStatus.state !== 'qr-ready') {
      throw new Error(`Collector status did not reach qr-ready. Current state: ${collectorStatus.state}`);
    }

    if (!collectorStatus.qrPayloadLength || collectorStatus.qrPayloadLength !== qrPayload.length) {
      throw new Error(
        `Collector status QR payload length is invalid. status=${collectorStatus.qrPayloadLength} file=${qrPayload.length}`,
      );
    }

    if (!collectorStatus.qrPersistedAt) {
      throw new Error('Collector status did not report qrPersistedAt.');
    }

    if (!collectorStatus.qrDeliveredAt) {
      throw new Error('Collector status did not report qrDeliveredAt.');
    }

    if (collectorStatus.latestQrPath !== latestQrPath) {
      throw new Error(
        `Collector latestQrPath mismatch. status=${collectorStatus.latestQrPath} expected=${latestQrPath}`,
      );
    }

    await sendHelperImport(apiBaseUrl);
    const importedImage = await verifyImportedImages(apiBaseUrl, accessToken);
    console.log(`COLLECTOR SMOKE RESULT: ${result.outcome}`);
    console.log(`COLLECTOR SMOKE STATE: ${collectorStatus.state}`);
    console.log(`COLLECTOR SMOKE QR LENGTH: ${qrPayload.length}`);
    console.log(`COLLECTOR SMOKE QR FILE: ${latestQrPath}`);
    console.log(`COLLECTOR SMOKE IMPORT VERIFIED: ${importedImage.id}`);
    console.log('---COLLECTOR LOG TAIL---');
    console.log(result.logLines.join('\n'));
    killChild(child);
    process.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    killChild(child);
    const { exitCode, exitSignal } = output.getExitDetails();
    console.error('---SMOKE STDOUT---');
    console.error(output.stdoutBuffer.join(''));
    console.error('---SMOKE STDERR---');
    console.error(output.stderrBuffer.join(''));
    console.error(`COLLECTOR SMOKE EXIT: code=${exitCode} signal=${exitSignal}`);
    process.exit(1);
  }
}

void main();
