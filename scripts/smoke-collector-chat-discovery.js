/**
 * Packaged / local smoke: verify WhatsApp chat discovery APIs after auth.
 *
 * Requires an already-linked WhatsApp session (LocalAuth user data).
 *
 * Env:
 *   PATROL_HELPER_SESSION_PATH   - required session directory
 *   PATROL_PACKAGED_APP_DIR      - optional packaged app folder (defaults to newest out/*-win32-x64)
 *   PATROL_HELPER_EDGE_PATH / PATROL_HELPER_CHROME_PATH - optional browser override
 *
 * Exit 0 when logs contain CHAT_DISCOVERY_SMOKE_PASS.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const outRoot = path.join(projectRoot, 'out');
const SMOKE_TIMEOUT_MS = Number(process.env.PATROL_CHAT_DISCOVERY_SMOKE_TIMEOUT_MS ?? 240_000);
const LOG_POLL_INTERVAL_MS = 1_000;

function fail(message) {
  console.error(`CHAT DISCOVERY SMOKE FAILED: ${message}`);
  process.exit(1);
}

function pass(message) {
  console.log(`CHAT DISCOVERY SMOKE OK: ${message}`);
}

function findPackagedAppDir() {
  const explicitDir = process.env.PATROL_PACKAGED_APP_DIR?.trim();
  if (explicitDir) {
    return explicitDir;
  }

  if (!fs.existsSync(outRoot)) {
    return null;
  }

  const candidates = fs
    .readdirSync(outRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(outRoot, entry.name))
    .filter((entryPath) => /win32-x64$/i.test(path.basename(entryPath)));

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);
  return candidates[0];
}

function resolveHelperEntry() {
  const packagedAppDir = findPackagedAppDir();
  if (packagedAppDir) {
    const packagedHelper = path.join(
      packagedAppDir,
      'resources',
      'app',
      'dist',
      'collectors',
      'whatsapp-helper.main.js',
    );
    if (fs.existsSync(packagedHelper)) {
      return {
        entry: packagedHelper,
        cwd: path.join(packagedAppDir, 'resources', 'app'),
        resourcesPath: path.join(packagedAppDir, 'resources'),
        mode: 'packaged',
      };
    }
  }

  const localHelper = path.join(projectRoot, 'dist', 'collectors', 'whatsapp-helper.main.js');
  if (!fs.existsSync(localHelper)) {
    fail(
      `Helper entry missing. Build first (npm run build) or package the desktop app. Looked for ${localHelper}`,
    );
  }

  return {
    entry: localHelper,
    cwd: projectRoot,
    resourcesPath: path.join(projectRoot, 'resources'),
    mode: 'local-dist',
  };
}

function killChild(child) {
  if (!child || child.killed) {
    return;
  }
  try {
    child.kill();
  } catch {
    // ignore
  }
}

async function main() {
  const sessionPath = process.env.PATROL_HELPER_SESSION_PATH?.trim();
  if (!sessionPath) {
    fail(
      'PATROL_HELPER_SESSION_PATH is required (linked WhatsApp LocalAuth session directory).',
    );
  }

  if (!fs.existsSync(sessionPath)) {
    fail(`Session path does not exist: ${sessionPath}`);
  }

  const helper = resolveHelperEntry();
  const logPath = path.join(
    os.tmpdir(),
    'patrol-evidence-platform',
    `chat-discovery-smoke-${Date.now()}.log`,
  );
  fs.mkdirSync(path.dirname(logPath), { recursive: true });

  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    PATROL_HELPER_CHAT_DISCOVERY_SMOKE: 'true',
    PATROL_HELPER_SESSION_PATH: sessionPath,
    PATROL_HELPER_LOG_PATH: logPath,
    PATROL_HELPER_LOG_MAX_BYTES: process.env.PATROL_HELPER_LOG_MAX_BYTES || String(5 * 1024 * 1024),
    PATROL_RESOURCES_PATH: process.env.PATROL_RESOURCES_PATH || helper.resourcesPath,
  };

  console.log(`CHAT DISCOVERY SMOKE mode=${helper.mode} entry=${helper.entry}`);
  console.log(`CHAT DISCOVERY SMOKE session=${sessionPath}`);
  console.log(`CHAT DISCOVERY SMOKE log=${logPath}`);

  const child = spawn(process.execPath, [helper.entry], {
    cwd: helper.cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let combinedOutput = '';
  child.stdout?.on('data', (chunk) => {
    const text = chunk.toString();
    combinedOutput += text;
    process.stdout.write(text);
  });
  child.stderr?.on('data', (chunk) => {
    const text = chunk.toString();
    combinedOutput += text;
    process.stderr.write(text);
  });

  const startedAt = Date.now();
  let exitCode = null;
  child.on('exit', (code) => {
    exitCode = code;
  });

  while (Date.now() - startedAt < SMOKE_TIMEOUT_MS) {
    let logText = '';
    try {
      if (fs.existsSync(logPath)) {
        logText = fs.readFileSync(logPath, 'utf8');
      }
    } catch {
      // ignore transient read errors
    }

    const haystack = `${combinedOutput}\n${logText}`;
    if (haystack.includes('CHAT_DISCOVERY_SMOKE_PASS')) {
      killChild(child);
      pass('getChats / enumerate / getChatById / fetchMessages succeeded');
      process.exit(0);
    }

    if (haystack.includes('CHAT_DISCOVERY_SMOKE_FAIL')) {
      killChild(child);
      const failLine = haystack
        .split(/\r?\n/)
        .reverse()
        .find((line) => line.includes('CHAT_DISCOVERY_SMOKE_FAIL'));
      fail(failLine || 'CHAT_DISCOVERY_SMOKE_FAIL logged');
    }

    if (exitCode !== null) {
      fail(`Helper exited early with code ${exitCode}. See ${logPath}`);
    }

    await new Promise((resolve) => setTimeout(resolve, LOG_POLL_INTERVAL_MS));
  }

  killChild(child);
  fail(`Timed out after ${SMOKE_TIMEOUT_MS}ms waiting for CHAT_DISCOVERY_SMOKE_PASS. Log: ${logPath}`);
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
