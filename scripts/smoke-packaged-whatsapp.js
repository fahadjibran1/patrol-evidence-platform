const { execFileSync, spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const outRoot = path.join(projectRoot, 'out');
const HEALTH_PORT = 3998;
const HEALTH_URL = `http://localhost:${HEALTH_PORT}/health`;
const HEALTH_TIMEOUT_MS = 180_000;
const COLLECTOR_TIMEOUT_MS = 180_000;
const LOG_POLL_INTERVAL_MS = 1_000;
const QR_HOLD_MS = 30_000;

function fail(message) {
  console.error(`WHATSAPP SMOKE FAILED: ${message}`);
  process.exit(1);
}

function pass(message) {
  console.log(`WHATSAPP SMOKE OK: ${message}`);
}

function findPackagedAppDir() {
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

function killChild(child) {
  if (!child || child.killed) {
    return;
  }

  try {
    child.kill();
  } catch {
    // Ignore shutdown errors during smoke cleanup.
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
    if (process.env.PATROL_SMOKE_VERBOSE === 'true') {
      process.stdout.write(text);
    }
  });

  child.stderr?.on('data', (chunk) => {
    const text = chunk.toString();
    stderrBuffer.push(text);
    if (process.env.PATROL_SMOKE_VERBOSE === 'true') {
      process.stderr.write(text);
    }
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
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${text}`);
  }
  return body;
}

function readDesktopApiToken(configRoot) {
  const tokenPath = path.join(configRoot, 'desktop-api-token.txt');
  const token = fs.readFileSync(tokenPath, 'utf8').trim();
  if (token.length < 32) {
    throw new Error(`Packaged desktop API token is unavailable: ${tokenPath}`);
  }
  return token;
}

async function initializeAndStartCollector(apiBaseUrl, configRoot) {
  const email = 'fresh-link-smoke@patrol.local';
  const password = 'FreshLinkSmoke123!';
  const desktopApiToken = readDesktopApiToken(configRoot);
  await requestJson(`${apiBaseUrl}/desktop/bootstrap/initialize`, {
    method: 'POST',
    headers: { 'x-patrolsafe-desktop-token': desktopApiToken },
    body: JSON.stringify({
      companyName: 'PatrolSafe Fresh Link Smoke',
      appTimeZone: 'Europe/London',
      workspaceName: 'Fresh Link Smoke',
      adminFirstName: 'Fresh',
      adminLastName: 'Link',
      adminEmail: email,
      adminPassword: password,
      autoStartCollector: false,
      autoLaunchApp: false,
      whatsappAllowFromMe: false,
    }),
  });
  const login = await requestJson(`${apiBaseUrl}/auth/login`, {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  await requestJson(`${apiBaseUrl}/collectors/whatsapp/start`, {
    method: 'POST',
    headers: { authorization: `Bearer ${login.accessToken}` },
  });
  return login.accessToken;
}

async function stopCollector(apiBaseUrl, accessToken) {
  await requestJson(`${apiBaseUrl}/collectors/whatsapp/stop`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}` },
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function listProcessesUsingPath(targetPath) {
  const escapedPath = targetPath.replace(/'/g, "''");
  const script = [
    `$target = '${escapedPath}'`,
    '$matches = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.IndexOf($target, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 } | Select-Object ProcessId, Name, CommandLine',
    'if ($matches) { $matches | ConvertTo-Json -Compress }',
  ].join('; ');
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const output = execFileSync(
    'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    ['-NoProfile', '-EncodedCommand', encoded],
    { encoding: 'utf8', windowsHide: true },
  ).trim();
  if (!output) {
    return [];
  }
  const parsed = JSON.parse(output);
  return Array.isArray(parsed) ? parsed : [parsed];
}

async function waitForNoPathOwners(targetPath, timeoutMs = 30_000) {
  const startedAt = Date.now();
  let owners = [];
  do {
    owners = listProcessesUsingPath(targetPath);
    if (owners.length === 0) {
      return;
    }
    await delay(500);
  } while (Date.now() - startedAt <= timeoutMs);

  throw new Error(
    `Packaged smoke left processes owning its disposable profile: ${owners
      .map((owner) => `${owner.Name}:${owner.ProcessId}`)
      .join(', ')}`,
  );
}

function readLogTail(logPath, maxLines = 80) {
  if (!fs.existsSync(logPath)) {
    return [];
  }

  return fs.readFileSync(logPath, 'utf8').split(/\r?\n/).filter(Boolean).slice(-maxLines);
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
        /browser-resolution-error|puppeteer-launch-error|session-path-error|auth-failure|collector-timeout/i.test(
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

async function main() {
  const packagedAppDir = findPackagedAppDir();
  const packagedExePath = path.join(packagedAppDir, 'PatrolEvidencePlatform.exe');
  const appRoot = path.join(packagedAppDir, 'resources', 'app');
  const smokeRoot = path.join(os.tmpdir(), 'patrol-evidence-platform-whatsapp-smoke');
  const configRoot = path.join(smokeRoot, `run-${Date.now()}`);
  const configPath = path.join(configRoot, 'workspace-config.json');
  const dataDir = path.join(configRoot, 'data');
  const storageRoot = path.join(dataDir, 'Security_Patrols');
  const sqliteDbPath = path.join(dataDir, 'patrol-evidence.db');
  const collectorLogPath = path.join(configRoot, 'collector-runtime.log');

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
        backendPort: HEALTH_PORT,
        autoStartCollector: true,
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
    PORT: String(HEALTH_PORT),
    DESKTOP_CONFIG_PATH: configPath,
    DB_TYPE: 'sqlite',
    SQLITE_DB_PATH: sqliteDbPath,
    STORAGE_ROOT_PATH: storageRoot,
    WHATSAPP_ENABLED: 'true',
    APP_DEBUG: 'true',
    PATROL_SMOKE_BACKEND_ONLY: 'true',
    PATROL_LICENSE_DATA_ROOT: configRoot,
    PATROL_LICENSE_USE_FILE_MARKER: 'true',
  };

  console.log(`WHATSAPP SMOKE INFO: packagedAppDir=${packagedAppDir}`);
  console.log(`WHATSAPP SMOKE INFO: configPath=${configPath}`);
  console.log(`WHATSAPP SMOKE INFO: collectorLogPath=${collectorLogPath}`);

  const child = spawn(packagedExePath, [`--user-data-dir=${configRoot}`], {
    cwd: appRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  const output = collectChildOutput(child);

  try {
    const healthBody = await waitForHealth(HEALTH_URL, HEALTH_TIMEOUT_MS);
    pass(`health ready at ${HEALTH_URL}`);
    console.log(`WHATSAPP SMOKE HEALTH BODY: ${healthBody}`);

    const apiBaseUrl = `http://localhost:${HEALTH_PORT}`;
    const accessToken = await initializeAndStartCollector(apiBaseUrl, configRoot);

    const result = await waitForCollectorOutcome(collectorLogPath, COLLECTOR_TIMEOUT_MS);
    pass(`collector outcome=${result.outcome}`);
    if (result.outcome === 'qr') {
      pass(`holding fresh-link QR for ${QR_HOLD_MS / 1000} seconds`);
      await delay(QR_HOLD_MS);
      const heldLog = readLogTail(collectorLogPath, 250).join('\n');
      if (/browser-exit|browser-launch-failed|collector-attempt-error/i.test(heldLog)) {
        throw new Error('Browser did not remain healthy during the 30-second QR hold.');
      }
    }
    console.log('---COLLECTOR LOG TAIL---');
    console.log(result.logLines.join('\n'));
    await stopCollector(apiBaseUrl, accessToken);
    await delay(2_000);
    killChild(child);
    await delay(3_000);
    await waitForNoPathOwners(configRoot);
    pass('packaged process tree released the disposable profile');
    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    killChild(child);
    const { exitCode, exitSignal } = output.getExitDetails();
    console.error('---SMOKE STDOUT---');
    console.error(output.stdoutBuffer.join(''));
    console.error('---SMOKE STDERR---');
    console.error(output.stderrBuffer.join(''));
    console.error(`WHATSAPP SMOKE EXIT: code=${exitCode} signal=${exitSignal}`);
    process.exit(1);
  }
}

void main();
