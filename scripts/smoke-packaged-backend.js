const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const {
  getBackendEntryCandidates,
  getFrontendEntryCandidates,
  getPackagedAppRoot,
} = require('../desktop/packaged-runtime-paths');

const projectRoot = path.resolve(__dirname, '..');
const outRoot = path.join(projectRoot, 'out');
const HEALTH_PORT = 3999;
const HEALTH_URL = `http://localhost:${HEALTH_PORT}/health`;
const HEALTH_TIMEOUT_MS = 180_000;

function fail(message) {
  console.error(`SMOKE FAILED: ${message}`);
  process.exit(1);
}

function pass(message) {
  console.log(`SMOKE OK: ${message}`);
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
  let exited = false;

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
    exited = true;
    exitCode = code;
    exitSignal = signal;
  });

  return {
    stdoutBuffer,
    stderrBuffer,
    getExitDetails: () => ({ exited, exitCode, exitSignal }),
  };
}

function redactSecrets(text) {
  return String(text || '')
    .replace(/JWT_SECRET=[^\s]+/gi, 'JWT_SECRET=[redacted]')
    .replace(/LICENSE_[A-Z0-9_]+=[^\s]+/gi, (match) => `${match.split('=')[0]}=[redacted]`)
    .replace(/password[=:][^\s]+/gi, 'password=[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer [redacted]');
}

function getLicenseStatus(url, desktopApiToken) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, { headers: { 'x-patrolsafe-desktop-token': desktopApiToken } }, (response) => {
      let payload = '';
      response.on('data', (chunk) => {
        payload += chunk.toString();
      });
      response.on('end', () => {
        if (response.statusCode === 200) {
          try {
            resolve(JSON.parse(payload));
          } catch (error) {
            reject(error);
          }
          return;
        }
        reject(new Error(`license/status returned ${response.statusCode}: ${payload}`));
      });
    });
    request.on('error', reject);
  });
}

async function main() {
  const packagedAppDir = findPackagedAppDir();
  const packagedExePath = path.join(packagedAppDir, 'PatrolEvidencePlatform.exe');
  const resourcesPath = path.join(packagedAppDir, 'resources');
  const appRoot = getPackagedAppRoot({ resourcesPath }) || path.join(resourcesPath, 'app');
  const backendResolution = getBackendEntryCandidates({
    appRoot,
    resourcesPath,
    dirnameHint: appRoot,
    packaged: true,
  });
  const frontendResolution = getFrontendEntryCandidates({
    appRoot,
    resourcesPath,
    dirnameHint: appRoot,
    packaged: true,
  });
  const backendEntryPath = backendResolution.resolved;
  // Temporary clean app-data directory for first-run trial bootstrap verification.
  const smokeRoot = path.join(os.tmpdir(), 'patrol-evidence-platform-smoke');
  const configRoot = path.join(smokeRoot, `run-${Date.now()}`);
  const configPath = path.join(configRoot, 'workspace-config.json');
  const dataDir = path.join(configRoot, 'data');
  const storageRoot = path.join(dataDir, 'Security_Patrols');
  const sqliteDbPath = path.join(dataDir, 'patrol-evidence.db');
  const whatsappSessionPath = path.join(dataDir, 'whatsapp-session');
  const licensePublicKeyPath = path.join(resourcesPath, 'license-public.pem');
  const desktopApiToken = crypto.randomBytes(48).toString('base64url');

  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(storageRoot, { recursive: true });
  fs.mkdirSync(whatsappSessionPath, { recursive: true });
  fs.writeFileSync(
    configPath,
    JSON.stringify(
      {
        dbType: 'sqlite',
        sqliteDbPath,
        storageRootPath: storageRoot,
        backendPort: HEALTH_PORT,
      },
      null,
      2,
    ),
    'utf8',
  );

  if (!fs.existsSync(packagedExePath)) {
    fail(`Packaged executable is missing: ${packagedExePath}`);
  }

  console.log(`SMOKE INFO: packagedAppDir=${packagedAppDir}`);
  console.log(`SMOKE INFO: appRoot=${appRoot}`);
  console.log(`SMOKE INFO: resourcesPath=${resourcesPath}`);
  console.log('SMOKE INFO: backendCandidates=');
  for (const candidate of backendResolution.candidates) {
    console.log(`  ${candidate.exists ? 'EXISTS' : 'MISSING'} ${candidate.path}`);
  }
  console.log('SMOKE INFO: frontendCandidates=');
  for (const candidate of frontendResolution.candidates) {
    console.log(`  ${candidate.exists ? 'EXISTS' : 'MISSING'} ${candidate.path}`);
  }

  if (!backendEntryPath) {
    fail('Packaged backend entry could not be resolved using the production path resolver.');
  }

  if (!frontendResolution.resolved) {
    fail('Packaged frontend index.html could not be resolved using the production path resolver.');
  }

  console.log(`SMOKE INFO: resolvedBackendEntry=${backendEntryPath}`);
  console.log(`SMOKE INFO: resolvedFrontendEntry=${frontendResolution.resolved}`);
  console.log(`SMOKE INFO: configPath=${configPath}`);
  console.log(`SMOKE INFO: sqliteDbPath=${sqliteDbPath}`);
  console.log(`SMOKE INFO: storageRoot=${storageRoot}`);
  console.log(`SMOKE INFO: whatsappSessionPath=${whatsappSessionPath}`);
  console.log(
    'SMOKE INFO: childStartupMethod=packaged-exe ELECTRON_RUN_AS_NODE=1 <backendEntry>',
  );

  const child = spawn(packagedExePath, [backendEntryPath], {
    cwd: appRoot,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      PORT: String(HEALTH_PORT),
      DESKTOP_CONFIG_PATH: configPath,
      // Keep licensing artefacts inside the clean temp app-data tree and use a file marker
      // so smoke does not pollute the machine-wide HKCU TrialMarker used by real installs.
      PATROL_LICENSE_DATA_ROOT: configRoot,
      PATROL_LICENSE_USE_FILE_MARKER: 'true',
      // Exercise production DPAPI encryption on Windows packaged builds.
      PATROL_LICENSE_TEST_MODE: '',
      PATROL_DISABLE_LOCAL_TRIAL: '',
      NODE_ENV: 'production',
      DB_TYPE: 'sqlite',
      SQLITE_DB_PATH: sqliteDbPath,
      STORAGE_ROOT_PATH: storageRoot,
      WHATSAPP_SESSION_PATH: whatsappSessionPath,
      WHATSAPP_AUTO_START: 'false',
      LICENSE_PUBLIC_KEY_FILE: fs.existsSync(licensePublicKeyPath) ? licensePublicKeyPath : '',
      PATROL_APP_PATH: appRoot,
      PATROL_RESOURCES_PATH: resourcesPath,
      PATROL_BACKEND_ENTRY_PATH: backendEntryPath,
      APP_DEBUG: 'true',
      PATROLSAFE_DESKTOP_API_TOKEN: desktopApiToken,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  const output = collectChildOutput(child);

  try {
    const body = await waitForHealth(HEALTH_URL, HEALTH_TIMEOUT_MS);
    pass(`health ready at ${HEALTH_URL}`);
    console.log(`SMOKE HEALTH BODY: ${body}`);

    const licenseStatusUrl = `http://localhost:${HEALTH_PORT}/license/status`;
    const licenseStatus = await getLicenseStatus(licenseStatusUrl, desktopApiToken);
    pass('license/status endpoint booted successfully');
    console.log(`SMOKE LICENSE STATUS: ${JSON.stringify(licenseStatus).slice(0, 500)}`);

    if (licenseStatus.status !== 'TRIAL_ACTIVE') {
      fail(
        `Expected TRIAL_ACTIVE on clean first-run app-data, got status=${licenseStatus.status} message=${licenseStatus.message} diagnostics=${JSON.stringify(licenseStatus.diagnostics ?? null)}`,
      );
    }
    if (licenseStatus.uiState !== 'Trial Active' || licenseStatus.plan !== 'trial') {
      fail(`Expected Trial Active ui/plan, got uiState=${licenseStatus.uiState} plan=${licenseStatus.plan}`);
    }
    if (licenseStatus.daysRemaining !== 30) {
      fail(`Expected exactly 30 trial days, got daysRemaining=${licenseStatus.daysRemaining}`);
    }
    if (!licenseStatus.installationId) {
      fail('Expected installationId to be created during first-run bootstrap');
    }
    if (licenseStatus.diagnostics?.trialCreationDisabled) {
      fail('Production smoke must not disable local trial creation');
    }
    if (process.platform === 'win32' && licenseStatus.diagnostics?.cryptoMode !== 'dpapi') {
      fail(`Expected DPAPI crypto mode on Windows packaged smoke, got ${licenseStatus.diagnostics?.cryptoMode}`);
    }
    pass('TRIAL_ACTIVE with exactly 30 days granted on clean app-data');

    // Second status call must not mint another trial when the marker already exists.
    const licenseStatusAgain = await getLicenseStatus(licenseStatusUrl, desktopApiToken);
    if (licenseStatusAgain.installationId !== licenseStatus.installationId) {
      fail('Installation ID changed between status calls');
    }
    if (licenseStatusAgain.daysRemaining !== 30 || licenseStatusAgain.status !== 'TRIAL_ACTIVE') {
      fail('Existing trial was not preserved on subsequent license/status call');
    }
    pass('Existing trial marker/record preserved (no regeneration)');

    killChild(child);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`SMOKE ERROR: ${message}`);
    killChild(child);
    const { exitCode, exitSignal } = output.getExitDetails();
    console.error('---SMOKE STDOUT---');
    console.error(redactSecrets(output.stdoutBuffer.join('')));
    console.error('---SMOKE STDERR---');
    console.error(redactSecrets(output.stderrBuffer.join('')));
    console.error(`SMOKE EXIT: code=${exitCode} signal=${exitSignal}`);
    process.exit(1);
  }
}

void main();
