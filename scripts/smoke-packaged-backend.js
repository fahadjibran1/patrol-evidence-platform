const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const outRoot = path.join(projectRoot, 'out');
const HEALTH_PORT = 3999;
const HEALTH_URL = `http://localhost:${HEALTH_PORT}/health`;
const HEALTH_TIMEOUT_MS = 180_000;
const RUN_AS_NODE_PROBE_TIMEOUT_MS = 15_000;

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

async function runRawRunAsNodeProbe(packagedExePath, backendEntryPath, appRoot, env) {
  console.log(`SMOKE INFO: probing raw run-as-node command for ${RUN_AS_NODE_PROBE_TIMEOUT_MS}ms`);
  const child = spawn(packagedExePath, [backendEntryPath], {
    cwd: appRoot,
    env: {
      ...env,
      ELECTRON_RUN_AS_NODE: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  const output = collectChildOutput(child);

  await new Promise((resolve) => setTimeout(resolve, RUN_AS_NODE_PROBE_TIMEOUT_MS));
  const { exited, exitCode, exitSignal } = output.getExitDetails();
  const noVisibleOutput = output.stdoutBuffer.length === 0 && output.stderrBuffer.length === 0;

  if (exited && exitCode === 0 && noVisibleOutput) {
    console.log(
      'SMOKE INFO: raw ELECTRON_RUN_AS_NODE packaged-exe invocation exited immediately with no output; falling back to packaged desktop smoke mode.',
    );
    return;
  }

  killChild(child);
  console.log(
    `SMOKE INFO: raw run-as-node probe ended with exited=${exited} code=${exitCode} signal=${exitSignal}; continuing with packaged desktop smoke mode.`,
  );
}

async function main() {
  const packagedAppDir = findPackagedAppDir();
  const packagedExePath = path.join(packagedAppDir, 'PatrolEvidencePlatform.exe');
  const backendEntryPath = path.join(packagedAppDir, 'resources', 'app', 'dist', 'main.js');
  const appRoot = path.join(packagedAppDir, 'resources', 'app');
  const smokeRoot = path.join(os.tmpdir(), 'patrol-evidence-platform-smoke');
  const configRoot = path.join(smokeRoot, `run-${Date.now()}`);
  const configPath = path.join(configRoot, 'workspace-config.json');
  const dataDir = path.join(configRoot, 'data');
  const storageRoot = path.join(dataDir, 'Security_Patrols');
  const sqliteDbPath = path.join(dataDir, 'patrol-evidence.db');

  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(storageRoot, { recursive: true });
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

  if (!fs.existsSync(backendEntryPath)) {
    fail(`Packaged backend entry is missing: ${backendEntryPath}`);
  }

  const baseEnv = {
    ...process.env,
    PORT: String(HEALTH_PORT),
    DESKTOP_CONFIG_PATH: configPath,
    DB_TYPE: 'sqlite',
    SQLITE_DB_PATH: sqliteDbPath,
    STORAGE_ROOT_PATH: storageRoot,
    APP_DEBUG: 'true',
  };

  console.log(`SMOKE INFO: packagedAppDir=${packagedAppDir}`);
  console.log(`SMOKE INFO: backendEntryPath=${backendEntryPath}`);
  console.log(`SMOKE INFO: configPath=${configPath}`);
  console.log(`SMOKE INFO: sqliteDbPath=${sqliteDbPath}`);
  console.log(`SMOKE INFO: storageRoot=${storageRoot}`);

  await runRawRunAsNodeProbe(packagedExePath, backendEntryPath, appRoot, baseEnv);

  const child = spawn(packagedExePath, [], {
    cwd: appRoot,
    env: {
      ...baseEnv,
      PATROL_SMOKE_BACKEND_ONLY: 'true',
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
    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`SMOKE ERROR: ${message}`);
    killChild(child);
    const { exitCode, exitSignal } = output.getExitDetails();
    console.error('---SMOKE STDOUT---');
    console.error(output.stdoutBuffer.join(''));
    console.error('---SMOKE STDERR---');
    console.error(output.stderrBuffer.join(''));
    console.error(`SMOKE EXIT: code=${exitCode} signal=${exitSignal}`);
    process.exit(1);
  }
}

void main();
