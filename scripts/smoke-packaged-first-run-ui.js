const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer-core');

const projectRoot = path.resolve(__dirname, '..');
const debugPort = 9335;
const backendPort = 3997;

function latestPackagedExecutable() {
  const outRoot = path.join(projectRoot, 'out');
  const directory = fs.readdirSync(outRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /win32-x64$/i.test(entry.name))
    .map((entry) => path.join(outRoot, entry.name))
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs)[0];
  if (!directory) throw new Error('Packaged Windows application not found.');
  return path.join(directory, 'PatrolEvidencePlatform.exe');
}

function waitForDebugEndpoint(timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const poll = () => {
      http.get(`http://127.0.0.1:${debugPort}/json/version`, (response) => {
        response.resume();
        if (response.statusCode === 200) resolve();
        else if (Date.now() >= deadline) reject(new Error('Electron debug endpoint did not become ready.'));
        else setTimeout(poll, 500);
      }).on('error', () => {
        if (Date.now() >= deadline) reject(new Error('Electron debug endpoint did not become ready.'));
        else setTimeout(poll, 500);
      });
    };
    poll();
  });
}

async function launch(executable, userDataRoot) {
  const child = spawn(executable, [
    `--user-data-dir=${userDataRoot}`,
    `--remote-debugging-port=${debugPort}`,
    '--no-first-run',
  ], {
    env: {
      ...process.env,
      PATROL_LICENSE_DATA_ROOT: userDataRoot,
      PATROL_LICENSE_USE_FILE_MARKER: 'true',
    },
    stdio: 'ignore',
    windowsHide: true,
  });
  await waitForDebugEndpoint();
  const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${debugPort}` });
  const deadline = Date.now() + 120_000;
  let page;
  while (Date.now() < deadline) {
    page = (await browser.pages()).find((candidate) => candidate.url().includes('index.html'));
    if (page) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!page) throw new Error('Packaged renderer page was not found.');
  return { child, browser, page };
}

async function close(app) {
  try { await app.browser.close(); } catch { /* already closed */ }
  await Promise.race([
    new Promise((resolve) => app.child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 10_000)),
  ]);
  if (app.child.exitCode === null) app.child.kill();
}

async function waitForHeading(page, expected, timeout = 120_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const found = await page.evaluate(
      (text) => Array.from(document.querySelectorAll('h3')).some((node) => node.textContent?.includes(text)),
      expected,
    );
    if (found) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for heading: ${expected}`);
}

async function clickButton(page, label) {
  const clicked = await page.evaluate((text) => {
    const button = Array.from(document.querySelectorAll('button')).find((entry) => entry.textContent?.trim() === text);
    if (!(button instanceof HTMLButtonElement)) return false;
    button.click();
    return true;
  }, label);
  if (!clicked) throw new Error(`Button not found: ${label}`);
}

async function firstLaunch(app) {
  const { page } = app;
  const bridge = await page.evaluate(() => ({
    url: window.location.href,
    desktop: window.desktopBridge?.isDesktop ?? false,
    apiBaseUrl: window.desktopBridge?.apiBaseUrl ?? null,
    body: document.body.innerText.slice(0, 500),
  }));
  console.log(`FIRST-RUN UI INFO: ${JSON.stringify(bridge)}`);
  await waitForHeading(page, 'Company and admin login');
  const inputs = await page.$$('form input');
  const values = [
    'PatrolSafe Local UAT Ltd',
    'PatrolSafe Local UAT Workspace',
    'Local',
    'Administrator',
    'local-uat@example.test',
    'Local-UAT-Password-9247',
  ];
  if (inputs.length < values.length) throw new Error(`Expected six company inputs, found ${inputs.length}.`);
  for (let index = 0; index < values.length; index += 1) {
    await inputs[index].click({ clickCount: 3 });
    await inputs[index].press('Backspace');
    await inputs[index].type(values[index]);
  }
  await clickButton(page, 'Continue to storage');
  await waitForHeading(page, 'Choose where patrol images are stored');
  console.log('FIRST-RUN UI OK: company/admin submission reaches storage without packaged renderer replacement');
}

async function resumedLaunch(app) {
  const { page } = app;
  await waitForHeading(page, 'Choose where patrol images are stored');
  console.log('FIRST-RUN UI OK: normal reopen resumes authoritative storage stage');
  await clickButton(page, 'Continue to WhatsApp');
  await waitForHeading(page, 'Connect WhatsApp');
  await clickButton(page, 'Set up WhatsApp later');
  await page.waitForFunction(() => !window.location.hash.includes('/desktop/setup'), { timeout: 120_000 });
  console.log(`FIRST-RUN UI OK: authenticated completion leaves setup route (${await page.url()})`);
}

async function completedLaunch(app) {
  const { page } = app;
  await page.waitForFunction(() => !window.location.hash.includes('/desktop/setup'), { timeout: 120_000 });
  const body = await page.evaluate(() => document.body.innerText);
  if (body.includes('First-Run Setup')) throw new Error('Completed setup wizard returned on second restart.');
  console.log(`FIRST-RUN UI OK: second normal reopen remains initialized (${await page.url()})`);
}

async function main() {
  const executable = latestPackagedExecutable();
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'patrolsafe-packaged-ui-'));
  const dataRoot = path.join(userDataRoot, 'data');
  fs.mkdirSync(path.join(dataRoot, 'Security_Patrols'), { recursive: true });
  fs.writeFileSync(path.join(userDataRoot, 'workspace-config.json'), JSON.stringify({
    setupCompleted: false,
    setupStage: 'company',
    backendPort,
    dbType: 'sqlite',
    sqliteDbPath: path.join(dataRoot, 'patrol-evidence.db'),
    storageRootPath: path.join(dataRoot, 'Security_Patrols'),
  }, null, 2));
  let app;
  try {
    app = await launch(executable, userDataRoot);
    await firstLaunch(app);
    await close(app);
    app = await launch(executable, userDataRoot);
    await resumedLaunch(app);
    await close(app);
    app = await launch(executable, userDataRoot);
    await completedLaunch(app);
    await close(app);
    app = null;

    const configPath = path.join(userDataRoot, 'workspace-config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (config.setupCompleted !== true || config.setupStage !== 'complete') {
      throw new Error('Final workspace config is not authoritatively complete.');
    }
    console.log(`FIRST-RUN UI RESULT: PASS root=${userDataRoot}`);
  } catch (error) {
    if (app) await close(app);
    console.error(`FIRST-RUN UI RESULT: FAIL ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

void main();
