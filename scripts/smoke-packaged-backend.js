const { spawn } = require('child_process');
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
  const smokeRoot = path.join(os.tmpdir(), 'patrol-evidence-platform-smoke');
  const configRoot = path.join(smokeRoot, `run-${Date.now()}`);
  const configPath = path.join(configRoot, 'workspace-config.json');
  const dataDir = path.join(configRoot, 'data');
  const storageRoot = path.join(dataDir, 'Security_Patrols');
  const sqliteDbPath = path.join(dataDir, 'patrol-evidence.db');
  const whatsappSessionPath = path.join(dataDir, 'whatsapp-session');
  const licensePublicKeyPath = path.join(resourcesPath, 'license-public.pem');

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
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  const output = collectChildOutput(child);

  try {
    const body = await waitForHealth(HEALTH_URL, HEALTH_TIMEOUT_MS);
    pass(`health ready at ${HEALTH_URL}`);
    console.log(`SMOKE HEALTH BODY: ${body}`);
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
