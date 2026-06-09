/**
 * Runs the WhatsApp helper with live event tracing to stdout + collector-runtime.log.
 * Scan QR in the opened Edge window, then send a real image to a mapped group.
 *
 * Prerequisites:
 *   npm run build
 *   Nest API running on PATROL_HELPER_API_BASE_URL (default http://localhost:3001)
 *
 * Usage:
 *   npm run collector:live-debug
 *
 * Optional env:
 *   PATROL_HELPER_API_BASE_URL=http://localhost:3001
 *   PATROL_HELPER_INTERNAL_TOKEN=<must match backend>
 *   PATROL_HELPER_SESSION_PATH=<custom session dir>
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const helperEntry = path.join(projectRoot, 'dist', 'collectors', 'whatsapp-helper.main.js');
const logPath =
  process.env.PATROL_HELPER_LOG_PATH?.trim() ||
  path.join(require('os').tmpdir(), 'patrol-evidence-platform', 'collector-runtime.log');

if (!fs.existsSync(helperEntry)) {
  console.error(`Helper not built. Run: npm run build\nMissing: ${helperEntry}`);
  process.exit(1);
}

const env = {
  ...process.env,
  PATROL_HELPER_LIVE_DEBUG: 'true',
  PATROL_HELPER_API_BASE_URL: process.env.PATROL_HELPER_API_BASE_URL?.trim() || 'http://localhost:3001',
  PATROL_HELPER_INTERNAL_TOKEN: process.env.PATROL_HELPER_INTERNAL_TOKEN?.trim() || 'patrol-live-debug-token',
  PATROL_HELPER_LOG_PATH: logPath,
};

console.log('Patrol WhatsApp live debug');
console.log(`Helper: ${helperEntry}`);
console.log(`API: ${env.PATROL_HELPER_API_BASE_URL}`);
console.log(`Log: ${logPath}`);
console.log('Events print to this console when listeners fire. Send a real image to a mapped group after ready-event.\n');

const child = spawn(process.execPath, [helperEntry], {
  cwd: projectRoot,
  env,
  stdio: ['inherit', 'pipe', 'pipe'],
  windowsHide: false,
});

child.stdout.on('data', (chunk) => {
  process.stdout.write(chunk);
});

child.stderr.on('data', (chunk) => {
  process.stderr.write(chunk);
});

child.on('exit', (code, signal) => {
  console.log(`\nHelper exited code=${code ?? 'null'} signal=${signal ?? 'null'}`);
  process.exit(code ?? 1);
});

process.on('SIGINT', () => {
  child.kill('SIGINT');
});
