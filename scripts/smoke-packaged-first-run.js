const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { getBackendEntryCandidates, getPackagedAppRoot } = require('../desktop/packaged-runtime-paths');

const PORT = 3998;
const API = `http://127.0.0.1:${PORT}`;
const projectRoot = path.resolve(__dirname, '..');
const smokeTimeZone = process.env.PATROLSAFE_SMOKE_TIMEZONE || 'Europe/London';

try {
  new Intl.DateTimeFormat('en', { timeZone: smokeTimeZone }).format(new Date());
} catch {
  throw new Error(`PATROLSAFE_SMOKE_TIMEZONE is not a valid IANA time zone: ${smokeTimeZone}`);
}

function packagedPaths() {
  const outRoot = path.join(projectRoot, 'out');
  const directory = fs.readdirSync(outRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /win32-x64$/i.test(entry.name))
    .map((entry) => path.join(outRoot, entry.name))
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs)[0];
  if (!directory) throw new Error('Packaged Windows application not found.');
  const resourcesPath = path.join(directory, 'resources');
  const appRoot = getPackagedAppRoot({ resourcesPath }) || path.join(resourcesPath, 'app');
  const backendEntry = getBackendEntryCandidates({ appRoot, resourcesPath, dirnameHint: appRoot, packaged: true }).resolved;
  if (!backendEntry) throw new Error('Packaged backend entry not found.');
  return {
    executable: path.join(directory, 'PatrolEvidencePlatform.exe'),
    resourcesPath,
    appRoot,
    backendEntry,
  };
}

function request(pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const body = options.body === undefined ? null : JSON.stringify(options.body);
    const request = http.request(`${API}${pathname}`, {
      method: options.method || 'GET',
      headers: {
        ...(body ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } : {}),
        ...(options.desktopToken ? { 'x-patrolsafe-desktop-token': options.desktopToken } : {}),
        ...(options.accessToken ? { authorization: `Bearer ${options.accessToken}` } : {}),
      },
    }, (response) => {
      let payload = '';
      response.on('data', (chunk) => { payload += chunk.toString(); });
      response.on('end', () => {
        let parsed = payload;
        try { parsed = payload ? JSON.parse(payload) : null; } catch { /* retain text */ }
        resolve({ status: response.statusCode, body: parsed });
      });
    });
    request.on('error', reject);
    if (body) request.write(body);
    request.end();
  });
}

async function waitForHealth(timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await request('/health');
      if (response.status === 200) return;
    } catch { /* process still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Timed out waiting for packaged backend.');
}

function startGeneration(paths, fixture, desktopToken) {
  const child = spawn(paths.executable, [paths.backendEntry], {
    cwd: paths.appRoot,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      PORT: String(PORT),
      DESKTOP_CONFIG_PATH: fixture.configPath,
      PATROL_LICENSE_DATA_ROOT: fixture.root,
      PATROL_LICENSE_USE_FILE_MARKER: 'true',
      NODE_ENV: 'production',
      DB_TYPE: 'sqlite',
      SQLITE_DB_PATH: fixture.databasePath,
      STORAGE_ROOT_PATH: fixture.evidenceRoot,
      WHATSAPP_SESSION_PATH: fixture.sessionRoot,
      WHATSAPP_AUTO_START: 'false',
      LICENSE_PUBLIC_KEY_FILE: path.join(paths.resourcesPath, 'license-public.pem'),
      PATROL_APP_PATH: paths.appRoot,
      PATROL_RESOURCES_PATH: paths.resourcesPath,
      PATROL_BACKEND_ENTRY_PATH: paths.backendEntry,
      PATROLSAFE_DESKTOP_API_TOKEN: desktopToken,
      JWT_SECRET: crypto.randomBytes(48).toString('base64url'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let diagnostics = '';
  child.stdout.on('data', (chunk) => { diagnostics += chunk.toString(); });
  child.stderr.on('data', (chunk) => { diagnostics += chunk.toString(); });
  return { child, diagnostics: () => diagnostics };
}

async function stopGeneration(generation) {
  if (generation.child.exitCode !== null) return;
  generation.child.kill();
  await Promise.race([
    new Promise((resolve) => generation.child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`FIRST-RUN SMOKE OK: ${message}`);
}

function readSchemaVersionWithPackagedRuntime(paths, fixture) {
  const probePath = path.join(fixture.root, 'schema-version-probe.cjs');
  const modulePath = path.join(paths.appRoot, 'node_modules', 'better-sqlite3');
  fs.writeFileSync(
    probePath,
    `const Database=require(${JSON.stringify(modulePath)});const db=new Database(process.argv[2],{readonly:true});const row=db.prepare('SELECT MAX(version) AS version FROM patrol_schema_migrations').get();db.close();process.stdout.write(String(row.version));`,
    'utf8',
  );
  const result = spawnSync(paths.executable, [probePath, fixture.databasePath], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(`Schema probe failed: ${String(result.stderr || result.stdout).trim()}`);
  }
  fs.rmSync(probePath, { force: true });
  return Number(String(result.stdout).trim());
}

async function main() {
  const paths = packagedPaths();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'patrolsafe-first-run-'));
  const fixture = {
    root,
    configPath: path.join(root, 'workspace-config.json'),
    databasePath: path.join(root, 'data', 'patrol-evidence.db'),
    evidenceRoot: path.join(root, 'data', 'Security_Patrols'),
    sessionRoot: path.join(root, 'data', 'whatsapp-session'),
  };
  const desktopToken = crypto.randomBytes(48).toString('base64url');
  let generation;
  try {
    fs.mkdirSync(fixture.evidenceRoot, { recursive: true });
    fs.mkdirSync(fixture.sessionRoot, { recursive: true });
    fs.writeFileSync(fixture.configPath, JSON.stringify({
      setupCompleted: false,
      setupStage: 'company',
      dbType: 'sqlite',
      sqliteDbPath: fixture.databasePath,
      storageRootPath: fixture.evidenceRoot,
      backendPort: PORT,
    }, null, 2));

    generation = startGeneration(paths, fixture, desktopToken);
    await waitForHealth();
    const initial = await request('/desktop/bootstrap/status', { desktopToken });
    expect(initial.status === 200 && initial.body.setupCompleted === false, 'pristine packaged root starts incomplete');

    const initialized = await request('/desktop/bootstrap/initialize', {
      method: 'POST', desktopToken,
      body: {
        workspaceName: 'PatrolSafe UAT Workspace',
        companyName: 'PatrolSafe UAT Ltd',
        appTimeZone: smokeTimeZone,
        adminFirstName: 'UAT',
        adminLastName: 'Administrator',
        adminEmail: 'uat-admin@example.test',
        adminPassword: 'Uat-First-Run-Only-9247',
        autoStartCollector: false,
        autoLaunchApp: false,
        whatsappAllowFromMe: false,
        markSetupComplete: false,
      },
    });
    expect(initialized.status === 201 && initialized.body.hasCompanyAdmin === true, 'company/admin commit completes before restart');
    expect(initialized.body.setupStage === 'storage', 'authoritative setup progress advances to storage');
    const licenceBefore = await request('/license/status', { desktopToken });
    await stopGeneration(generation);

    generation = startGeneration(paths, fixture, desktopToken);
    await waitForHealth();
    const afterRestart = await request('/desktop/bootstrap/status', { desktopToken });
    expect(afterRestart.status === 200 && afterRestart.body.hasCompanyAdmin === true, 'company/admin survive setup-triggered process restart');
    expect(afterRestart.body.setupCompleted === false && afterRestart.body.setupStage === 'storage', 'interrupted setup resumes at durable stage');

    const login = await request('/auth/login', {
      method: 'POST',
      body: { email: 'uat-admin@example.test', password: 'Uat-First-Run-Only-9247' },
    });
    expect(login.status === 201 && typeof login.body.accessToken === 'string', 'persisted administrator can sign in after restart');
    const completed = await request('/desktop/bootstrap/complete-setup', {
      method: 'POST', desktopToken, accessToken: login.body.accessToken,
    });
    expect(completed.status === 201 && completed.body.setupCompleted === true, 'authenticated setup completion commits');
    expect(completed.body.setupStage === 'complete', 'completion stage is authoritative');
    await stopGeneration(generation);

    generation = startGeneration(paths, fixture, desktopToken);
    await waitForHealth();
    const secondRestart = await request('/desktop/bootstrap/status', { desktopToken });
    expect(secondRestart.body.setupCompleted === true && secondRestart.body.hasCompanyAdmin === true, 'second restart remains initialized');
    expect(secondRestart.body.appTimeZone === smokeTimeZone, `workspace time zone ${smokeTimeZone} survives restart`);
    expect(secondRestart.body.configPath === fixture.configPath, 'every backend generation reads the same config root');
    expect(secondRestart.body.databasePath === fixture.databasePath, 'every backend generation reads the same database path');
    const licenceAfter = await request('/license/status', { desktopToken });
    expect(licenceAfter.body.installationId === licenceBefore.body.installationId, 'trial and installation identity persist across setup restarts');
    const blockedBootstrap = await request('/desktop/bootstrap/initialize', {
      method: 'POST', desktopToken,
      body: { companyName: 'Attacker', adminFirstName: 'Bad', adminLastName: 'Actor', adminEmail: 'bad@example.test', adminPassword: 'Password-123' },
    });
    expect(blockedBootstrap.status === 401, 'initialized anonymous bootstrap remains fail-closed');
    await stopGeneration(generation);
    generation = null;

    const config = JSON.parse(fs.readFileSync(fixture.configPath, 'utf8'));
    expect(config.setupCompleted === true && config.setupStage === 'complete', 'atomic workspace config contains completed state');
    expect(config.appTimeZone === smokeTimeZone, `workspace config persists ${smokeTimeZone}`);
    expect(readSchemaVersionWithPackagedRuntime(paths, fixture) === 2, 'schema version 2 remains intact');
    expect(!fs.readdirSync(root).some((name) => name.includes('.tmp-')), 'no partial workspace config artifact remains');
    console.log(`FIRST-RUN SMOKE RESULT: PASS root=${root}`);
  } catch (error) {
    if (generation) await stopGeneration(generation);
    console.error(`FIRST-RUN SMOKE RESULT: FAIL ${error instanceof Error ? error.message : String(error)}`);
    if (generation) console.error(generation.diagnostics().slice(-12_000));
    process.exitCode = 1;
  }
}

void main();
