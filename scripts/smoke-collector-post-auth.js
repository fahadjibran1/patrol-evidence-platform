/**
 * Post-authentication startup smoke with a clean LocalAuth directory.
 *
 * Validates that after QR scan + phone link, the helper reaches ready without
 * disconnected(LOGOUT) / post_logout during chat synchronisation.
 *
 * Usage:
 *   npm run build
 *   npm run collector:smoke-post-auth
 *
 * Scan the QR when Edge opens. Exit 0 on POST_AUTH_SMOKE_PASS / ready-event.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const SMOKE_TIMEOUT_MS = Number(process.env.PATROL_POST_AUTH_SMOKE_TIMEOUT_MS ?? 300_000);
const LOG_POLL_INTERVAL_MS = 1_000;

function fail(message) {
  console.error(`POST-AUTH SMOKE FAILED: ${message}`);
  process.exit(1);
}

function pass(message) {
  console.log(`POST-AUTH SMOKE OK: ${message}`);
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

function ensureCleanSessionDir(sessionPath) {
  fs.rmSync(sessionPath, { recursive: true, force: true });
  fs.mkdirSync(sessionPath, { recursive: true });
}

async function main() {
  const helperEntry = path.join(projectRoot, 'dist', 'collectors', 'whatsapp-helper.main.js');
  if (!fs.existsSync(helperEntry)) {
    fail(`Helper missing. Run npm run build first. Looked for ${helperEntry}`);
  }

  const smokeRoot = path.join(os.tmpdir(), 'patrol-evidence-platform', 'post-auth-smoke');
  const sessionPath =
    process.env.PATROL_HELPER_SESSION_PATH?.trim() ||
    path.join(smokeRoot, `session-${Date.now()}`);
  const logPath =
    process.env.PATROL_HELPER_LOG_PATH?.trim() ||
    path.join(smokeRoot, `collector-${Date.now()}.log`);

  ensureCleanSessionDir(sessionPath);
  fs.mkdirSync(path.dirname(logPath), { recursive: true });

  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    PATROL_HELPER_POST_AUTH_SMOKE: 'true',
    PATROL_HELPER_SESSION_PATH: sessionPath,
    PATROL_HELPER_LOG_PATH: logPath,
    PATROL_HELPER_LOG_MAX_BYTES: process.env.PATROL_HELPER_LOG_MAX_BYTES || String(5 * 1024 * 1024),
    PATROL_RESOURCES_PATH: process.env.PATROL_RESOURCES_PATH || path.join(projectRoot, 'resources'),
  };

  console.log(`POST-AUTH SMOKE clean LocalAuth dir: ${sessionPath}`);
  console.log(`POST-AUTH SMOKE log: ${logPath}`);
  console.log('Scan the WhatsApp QR in Edge when it appears.');

  const child = spawn(process.execPath, [helperEntry], {
    cwd: projectRoot,
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

  let exitCode = null;
  child.on('exit', (code) => {
    exitCode = code;
  });

  const startedAt = Date.now();
  let sawAuthenticated = false;
  let sawPostLogout = false;

  while (Date.now() - startedAt < SMOKE_TIMEOUT_MS) {
    let logText = '';
    try {
      if (fs.existsSync(logPath)) {
        logText = fs.readFileSync(logPath, 'utf8');
      }
    } catch {
      // ignore
    }

    const haystack = `${combinedOutput}\n${logText}`;

    if (haystack.includes('lifecycle-authenticated') || haystack.includes('authenticated-event')) {
      sawAuthenticated = true;
    }
    if (
      haystack.includes('post-logout-navigation-detected') ||
      haystack.includes('POST_AUTH_SMOKE_FAIL') ||
      /disconnected-event.*LOGOUT/i.test(haystack)
    ) {
      sawPostLogout = true;
    }

    if (haystack.includes('POST_AUTH_SMOKE_PASS') || /lifecycle-ready\b/.test(haystack)) {
      if (sawPostLogout && !haystack.includes('POST_AUTH_SMOKE_PASS')) {
        killChild(child);
        fail('Saw ready-related log but also post_logout/LOGOUT during startup');
      }
      killChild(child);
      pass(`authenticated=${sawAuthenticated} reached ready without post-auth LOGOUT`);
      process.exit(0);
    }

    if (haystack.includes('POST_AUTH_SMOKE_FAIL')) {
      killChild(child);
      fail('Helper reported POST_AUTH_SMOKE_FAIL (LOGOUT during chat sync)');
    }

    if (sawAuthenticated && sawPostLogout) {
      killChild(child);
      fail('Authenticated then post_logout/LOGOUT before ready — session destroy race or WA logout');
    }

    if (exitCode !== null) {
      fail(`Helper exited early with code ${exitCode}. authenticated=${sawAuthenticated} log=${logPath}`);
    }

    await new Promise((resolve) => setTimeout(resolve, LOG_POLL_INTERVAL_MS));
  }

  killChild(child);
  fail(
    `Timed out after ${SMOKE_TIMEOUT_MS}ms. authenticated=${sawAuthenticated} postLogout=${sawPostLogout} log=${logPath}`,
  );
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
