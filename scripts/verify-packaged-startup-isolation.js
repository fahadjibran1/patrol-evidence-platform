const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer-core');

const projectRoot = path.resolve(__dirname, '..');

function latestPackagedExecutable() {
  const outRoot = path.join(projectRoot, 'out');
  const directory = fs.readdirSync(outRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /win32-x64$/i.test(entry.name))
    .map((entry) => path.join(outRoot, entry.name))
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs)[0];
  if (!directory) throw new Error('Packaged Windows application not found.');
  return path.join(directory, 'PatrolEvidencePlatform.exe');
}

function startForeignServices(requestLogPath) {
  const source = `
    const fs = require('fs');
    const http = require('http');
    const log = process.argv[1];
    const reply = (request, response, tracked) => {
      if (tracked) fs.appendFileSync(log, JSON.stringify({ url: request.url, token: request.headers['x-patrolsafe-desktop-token'] || null }) + '\\n');
      if (request.url === '/health') { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ status: 'ok' })); return; }
      if (request.url === '/desktop/bootstrap/runtime-identity') { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ identity: 'patrolsafe-desktop-backend', proof: 'invalid' })); return; }
      response.writeHead(tracked ? 404 : 200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(tracked ? { statusCode: 404, message: 'Cannot GET /desktop/bootstrap/status' } : { status: 'ok' }));
    };
    const servers = [4011, 4012, 4013, 4014].map((port, index) => http.createServer((req, res) => reply(req, res, index === 0)).listen(port, '127.0.0.1'));
    Promise.all(servers.map((server) => new Promise((resolve) => server.once('listening', resolve)))).then(() => process.stdout.write('READY\\n'));
    const stop = () => { let remaining = servers.length; for (const server of servers) server.close(() => { if (--remaining === 0) process.exit(0); }); };
    process.on('SIGTERM', stop); process.on('SIGINT', stop);
  `;
  const child = spawn(process.execPath, ['-e', source, requestLogPath], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  return new Promise((resolve, reject) => {
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.once('exit', (code) => reject(new Error(`Foreign service fixture exited early code=${code}: ${stderr}`)));
    child.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('READY')) resolve(child);
    });
  });
}

async function stopForeignServices(child) {
  if (!child || child.exitCode !== null) return;
  child.kill();
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 10_000)),
  ]);
}

function waitForDebugEndpoint(port, timeoutMs = 240_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const poll = () => {
      http.get(`http://127.0.0.1:${port}/json/version`, (response) => {
        response.resume();
        if (response.statusCode === 200) resolve();
        else if (Date.now() >= deadline) reject(new Error('Electron debug endpoint did not become ready.'));
        else setTimeout(poll, 250);
      }).on('error', () => {
        if (Date.now() >= deadline) reject(new Error('Electron debug endpoint did not become ready.'));
        else setTimeout(poll, 250);
      });
    };
    poll();
  });
}

async function waitForPage(browser, predicate, timeoutMs = 240_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const page = (await browser.pages()).find(predicate);
    if (page) return page;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Timed out waiting for packaged renderer.');
}

async function launch(executable, label, debugPort, extraEnv = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `patrolsafe-startup-${label}-`));
  fs.writeFileSync(path.join(root, 'workspace-config.json'), JSON.stringify({
    setupCompleted: false,
    setupStage: 'company',
    backendPort: 3001,
    dbType: 'sqlite',
  }, null, 2));
  const child = spawn(executable, [
    `--user-data-dir=${root}`,
    `--remote-debugging-port=${debugPort}`,
    '--no-first-run',
  ], {
    env: {
      ...process.env,
      PATROL_LICENSE_DATA_ROOT: root,
      PATROL_LICENSE_USE_FILE_MARKER: 'true',
      ...extraEnv,
    },
    stdio: 'ignore',
    windowsHide: true,
  });
  await waitForDebugEndpoint(debugPort);
  const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${debugPort}` });
  return { root, child, browser };
}

async function closeApp(instance) {
  try {
    const pages = await instance.browser.pages();
    for (const page of pages) {
      await page.evaluate(() => window.close()).catch(() => undefined);
    }
    instance.browser.disconnect();
  } catch { /* already closed */ }
  await Promise.race([
    new Promise((resolve) => instance.child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 10_000)),
  ]);
  if (instance.child.exitCode === null) {
    instance.child.kill();
    await Promise.race([
      new Promise((resolve) => instance.child.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 10_000)),
    ]);
  }
  if (instance.child.exitCode === null) throw new Error('Controlled packaged desktop did not terminate.');
  await new Promise((resolve) => setTimeout(resolve, 2000));
}

async function assertNoOrphanBackend(root) {
  const logPath = path.join(root, 'desktop-runtime.log');
  const log = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
  const matches = [...log.matchAll(/backend-identity-verified pid=(\d+)/g)];
  const pid = Number(matches.at(-1)?.[1]);
  if (!pid) throw new Error('Verified backend PID was not recorded.');
  await new Promise((resolve) => setTimeout(resolve, 1500));
  try {
    process.kill(pid, 0);
    throw new Error(`Packaged backend remained alive after desktop exit (pid ${pid}).`);
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
}

async function main() {
  const executable = latestPackagedExecutable();
  const requestLogPath = process.env.PATROLSAFE_FOREIGN_REQUEST_LOG;
  if (!requestLogPath) throw new Error('PATROLSAFE_FOREIGN_REQUEST_LOG must identify the separately launched foreign-service request log.');

  let instance;
  try {
    instance = await launch(executable, 'collision', 9336);
    const page = await waitForPage(instance.browser, (candidate) => candidate.url().includes('index.html'));
    await page.waitForFunction(() => document.body.innerText.includes('Company and admin login'), { timeout: 180_000 });
    const bridge = await page.evaluate(async () => ({
      staticUrl: window.desktopBridge?.apiBaseUrl,
      dynamicUrl: await window.desktopBridge?.getApiBaseUrl?.(),
    }));
    if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(bridge.dynamicUrl || '')) {
      throw new Error(`Unexpected verified endpoint: ${bridge.dynamicUrl}`);
    }
    if (bridge.dynamicUrl.endsWith(':3001') || bridge.dynamicUrl.endsWith(':4011')) {
      throw new Error('A fixed or configured foreign port was reused.');
    }
    const foreignRequests = fs.existsSync(requestLogPath)
      ? fs.readFileSync(requestLogPath, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
      : [];
    if (foreignRequests.some((entry) => entry.token)) throw new Error('Foreign service received a PatrolSafe desktop token.');
    if (foreignRequests.length !== 0) throw new Error(`Foreign historical endpoint was contacted ${foreignRequests.length} time(s).`);
    await closeApp(instance);
    await assertNoOrphanBackend(instance.root);
    instance = null;

    const slowStartedAt = Date.now();
    instance = await launch(executable, 'slow', 9337, {
      PATROLSAFE_STARTUP_TEST_MODE: 'true',
      PATROLSAFE_TEST_BACKEND_READY_DELAY_MS: '20000',
    });
    await new Promise((resolve) => setTimeout(resolve, 16_000));
    const earlyOperationalPage = (await instance.browser.pages()).some((candidate) => candidate.url().includes('index.html'));
    if (earlyOperationalPage) throw new Error('Operational frontend loaded before delayed backend identity verification.');
    const slowPage = await waitForPage(instance.browser, (candidate) => candidate.url().includes('index.html'));
    await slowPage.waitForFunction(() => document.body.innerText.includes('Company and admin login'), { timeout: 180_000 });
    if (Date.now() - slowStartedAt < 20_000) throw new Error('Slow-start fixture did not exercise the old 15-second boundary.');
    await closeApp(instance);
    await assertNoOrphanBackend(instance.root);
    instance = null;

    instance = await launch(executable, 'timeout', 9338, {
      PATROLSAFE_STARTUP_TEST_MODE: 'true',
      PATROLSAFE_TEST_BACKEND_READY_DELAY_MS: '10000',
      PATROLSAFE_TEST_BACKEND_TIMEOUT_MS: '1500',
    });
    const failurePage = await waitForPage(instance.browser, (candidate) => candidate.url().startsWith('data:text/html'));
    const failureText = await failurePage.evaluate(() => document.body.innerText);
    if (!failureText.includes('PatrolSafe could not start') || failureText.includes('localhost')) {
      throw new Error('Genuine timeout did not produce the sanitized fail-closed support page.');
    }
    await closeApp(instance);
    instance = null;

    console.log(JSON.stringify({
      result: 'PASS',
      collision: { foreignRequestCount: foreignRequests.length, foreignTokenCount: 0 },
      slowBackendPastLegacyTimeout: true,
      genuineTimeoutFailClosed: true,
      childLifecycle: 'no-orphan-after-normal-close',
    }));
  } finally {
    if (instance) await closeApp(instance);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
