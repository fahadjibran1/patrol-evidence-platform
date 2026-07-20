const { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } = require('electron');
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const { Client } = require('pg');

const packageMetadata = require('../package.json');
const {
  getBackendEntryCandidates,
  getFrontendEntryCandidates,
  getPackagedAppRoot,
  getCanonicalBackendEntryPath,
} = require('./packaged-runtime-paths');

const PRODUCT_METADATA = {
  productName: packageMetadata.productName || 'Patrol Evidence Platform',
  version: packageMetadata.version || '1.0.0',
  buildId: packageMetadata.buildId || '2026.07.20.1',
  copyright: packageMetadata.copyright || '© 2026 TechGuard Security Ltd',
  companyName: packageMetadata.companyName || 'TechGuard Security Ltd',
  supportEmail: packageMetadata.supportEmail || 'support@techguardsecurity.com',
};

const DEFAULT_BACKEND_PORT = 3001;
const DEFAULT_WEB_URL = 'http://localhost:5173';
const BACKEND_HEALTH_PATH = '/health';
const CONFIG_FILE_NAME = 'workspace-config.json';
const POSTGRES_INSTALL_GUIDES = {
  win32: 'https://www.postgresql.org/download/windows/',
  darwin: 'https://www.postgresql.org/download/macosx/',
  linux: 'https://www.postgresql.org/download/',
};
const POSTGRES_ISSUE_CODES = {
  NOT_CHECKED: 'NOT_CHECKED',
  READY: 'READY',
  SERVICE_NOT_RUNNING: 'SERVICE_NOT_RUNNING',
  WRONG_PASSWORD: 'WRONG_PASSWORD',
  DATABASE_MISSING: 'DATABASE_MISSING',
  MIGRATIONS_MISSING: 'MIGRATIONS_MISSING',
  UNKNOWN: 'UNKNOWN',
};

let mainWindow = null;
let backendProcess = null;
let backendState = {
  status: 'stopped',
  startedAt: null,
  lastExitAt: null,
  pid: null,
};
let frontendState = {
  target: null,
  source: 'unknown',
  lastError: null,
};
let isShowingFrontendFallback = false;
let backendEntryPoint = null;
const backendOutputBuffer = [];
let backendRecoveryTimeout = null;
let backendSpawnCommand = null;
let backendStartupEnv = null;
let backendExitDetails = {
  code: null,
  signal: null,
};
let backendRestartInProgress = false;
let backendPortRecoveryInProgress = false;
let backendListeningDetected = false;
let backendHealthCheckGeneration = 0;

const DEFAULT_BACKEND_HEALTH_TIMEOUT_MS = 30_000;
const MIN_PACKAGED_BACKEND_HEALTH_TIMEOUT_MS = 90_000;
const PACKAGED_BACKEND_HEALTH_TIMEOUT_MS = 180_000;
const RESTART_BACKEND_HEALTH_TIMEOUT_MS = 90_000;
const BACKEND_LISTENING_GRACE_TIMEOUT_MS = 30_000;
const BACKEND_STOP_TIMEOUT_MS = 15_000;
const BACKEND_RECOVERY_WINDOW_MS = 120_000;
const BACKEND_LOG_TAIL_LINES = 80;
const BACKEND_CHILD_ENV_FLAG = 'PATROL_RUN_BACKEND';

const isBackendEntryProcess = process.env[BACKEND_CHILD_ENV_FLAG] === 'true';

function handleSquirrelEvent() {
  if (process.platform !== 'win32') {
    return false;
  }

  const squirrelEvent = process.argv[1];
  if (!squirrelEvent || !squirrelEvent.startsWith('--squirrel-')) {
    return false;
  }

  if (isBackendEntryProcess) {
    return false;
  }

  const updateExe = path.resolve(path.dirname(process.execPath), '..', 'Update.exe');
  const exeName = path.basename(process.execPath);
  const shortcutLocations = '--shortcut-locations=Desktop,StartMenu';

  const runUpdate = (args) => {
    try {
      spawn(updateExe, args, {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      }).on('error', () => undefined);
    } catch {
      // Squirrel events should never block app startup or uninstall cleanup.
    }
  };

  switch (squirrelEvent) {
    case '--squirrel-install':
    case '--squirrel-updated':
      runUpdate(['--createShortcut', exeName, shortcutLocations]);
      setTimeout(() => app.quit(), 1000);
      return true;
    case '--squirrel-uninstall':
      runUpdate(['--removeShortcut', exeName, shortcutLocations]);
      setTimeout(() => app.quit(), 1000);
      return true;
    case '--squirrel-obsolete':
      app.quit();
      return true;
    default:
      return false;
  }
}

function appendBackendShimLog(message, details = null) {
  const configPath = process.env.DESKTOP_CONFIG_PATH?.trim();
  if (!configPath) {
    return;
  }

  const logPath = path.join(path.dirname(configPath), 'backend-runtime.log');
  const line = `[${new Date().toISOString()}] ${message}${details ? ` ${details}` : ''}`;

  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, `${line}\n`, 'utf8');
  } catch (error) {
    console.error('Failed to write backend shim log', error);
  }
}

function getBackendEntryPointCandidateForChild() {
  const packagedAppRoot = getPackagedAppRoot({
    resourcesPath: process.resourcesPath,
    appRoot: process.env.PATROL_APP_PATH || undefined,
    dirnameHint: path.join(__dirname, '..'),
  });
  const resolution = getBackendEntryCandidates({
    appRoot: packagedAppRoot,
    resourcesPath: process.resourcesPath,
    dirnameHint: packagedAppRoot,
    envEntry: process.env.PATROL_BACKEND_ENTRY_PATH,
    packaged: true,
  });
  return (
    resolution.resolved ||
    resolution.candidates[0]?.path ||
    getCanonicalBackendEntryPath(packagedAppRoot) ||
    path.join(process.cwd(), 'dist', 'main.js')
  );
}

function runPackagedBackendEntry() {
  const backendEntry = getBackendEntryPointCandidateForChild();
  appendBackendShimLog(
    'backend-shim:start',
    `entry=${backendEntry} cwd=${process.cwd()} port=${process.env.PORT ?? 'unset'} dbType=${
      process.env.DB_TYPE ?? 'unset'
    } config=${process.env.DESKTOP_CONFIG_PATH ?? 'unset'} storage=${process.env.STORAGE_ROOT_PATH ?? 'unset'}`,
  );
  process.stdout.write(`[backend-shim] requiring ${backendEntry}\n`);

  try {
    require(backendEntry);
  } catch (error) {
    const details = error instanceof Error ? error.stack || error.message : String(error);
    appendBackendShimLog('backend-shim:require-failed', details);
    process.stderr.write(`${details}\n`);
    process.exit(1);
  }
}

function isBackendSmokeOnlyMode() {
  return process.env.PATROL_SMOKE_BACKEND_ONLY === 'true';
}

function getResolvedBackendEntryPoint() {
  return getBackendEntryPoint();
}

function getResolvedFrontendEntryPoint() {
  return getFrontendEntryPoint();
}

function getUserDataDataDirectory() {
  return path.join(app.getPath('userData'), 'data');
}

function isPathInsideDirectory(parentDirectory, candidatePath) {
  const parent = path.resolve(parentDirectory);
  const candidate = path.resolve(candidatePath);
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function resolvePackagedStorageRootPath(workspaceConfig, dataDir) {
  const fallback = path.join(dataDir, 'Security_Patrols');
  const configured = String(workspaceConfig.storageRootPath || process.env.STORAGE_ROOT_PATH || '').trim();
  if (!configured) {
    return fallback;
  }

  const resolved = path.resolve(configured);
  const installRoots = [getProjectRoot(), process.resourcesPath].filter(Boolean);
  if (installRoots.some((root) => isPathInsideDirectory(root, resolved))) {
    // Never write evidence into the packaged install tree.
    return fallback;
  }

  // Keep an explicit absolute customer storage location; otherwise use userData.
  if (path.isAbsolute(configured)) {
    return resolved;
  }

  return fallback;
}

function getConfiguredRuntimeValues() {
  const workspaceConfig = readWorkspaceConfig();
  const dataDir = getUserDataDataDirectory();
  const defaultStorageRoot = path.join(dataDir, 'Security_Patrols');
  const defaultSqlitePath = path.join(dataDir, 'patrol-evidence.db');
  const defaultWhatsAppSessionPath = path.join(dataDir, 'whatsapp-session');

  // Packaged desktop: DB + WhatsApp session always under Electron userData.
  // Storage stays under userData unless the customer configured an absolute path
  // outside the install tree.
  if (app.isPackaged) {
    return {
      dbType: 'sqlite',
      sqliteDbPath: defaultSqlitePath,
      storageRootPath: resolvePackagedStorageRootPath(workspaceConfig, dataDir),
      whatsappSessionPath: defaultWhatsAppSessionPath,
      autoStartCollector: workspaceConfig.autoStartCollector === true,
    };
  }

  const configuredStorage = String(workspaceConfig.storageRootPath || '').trim();
  const storageRootPath = configuredStorage
    ? path.resolve(configuredStorage)
    : String(process.env.STORAGE_ROOT_PATH || defaultStorageRoot).trim();

  return {
    dbType: String(workspaceConfig.dbType || process.env.DB_TYPE || 'sqlite').trim().toLowerCase() || 'sqlite',
    sqliteDbPath:
      String(workspaceConfig.sqliteDbPath || process.env.SQLITE_DB_PATH || defaultSqlitePath).trim(),
    storageRootPath,
    whatsappSessionPath:
      String(process.env.WHATSAPP_SESSION_PATH || defaultWhatsAppSessionPath).trim(),
    autoStartCollector: workspaceConfig.autoStartCollector === true,
  };
}

function isProductionDesktopMode() {
  return app.isPackaged && process.env.DESKTOP_DEV !== 'true';
}

if (isProductionDesktopMode() || isBackendSmokeOnlyMode()) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-gpu-compositing');
}

function shouldOpenDebugTools() {
  return process.env.APP_DEBUG === 'true';
}

function getLogPath() {
  return path.join(app.getPath('userData'), 'desktop-runtime.log');
}

function getBackendLogPath() {
  return path.join(app.getPath('userData'), 'backend-runtime.log');
}

function appendBackendLogLine(line) {
  try {
    fs.mkdirSync(path.dirname(getBackendLogPath()), { recursive: true });
    fs.appendFileSync(getBackendLogPath(), `${line}\n`, 'utf8');
  } catch (error) {
    console.error('Failed to write backend log from desktop shell', error);
  }
}

function appendDesktopLog(message, details = null) {
  const line = `[${new Date().toISOString()}] ${message}${details ? ` ${details}` : ''}`;
  console.log(line);

  try {
    fs.mkdirSync(path.dirname(getLogPath()), { recursive: true });
    fs.appendFileSync(getLogPath(), `${line}\n`, 'utf8');
  } catch (error) {
    console.error('Failed to write desktop log', error);
    try {
      const fallbackLogPath = path.join(process.env.TEMP || process.env.TMP || process.cwd(), 'patrol-evidence-desktop-runtime.log');
      fs.appendFileSync(fallbackLogPath, `${line}\n`, 'utf8');
    } catch {
      // Logging must never block the desktop shell.
    }
  }
}

function appendBackendOutput(stream, text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return;
  }

  for (const lineText of lines) {
    const formatted = `[${stream}] ${lineText}`;
    backendOutputBuffer.push(formatted);
    appendBackendLogLine(formatted);
  }

  if (backendOutputBuffer.length > BACKEND_LOG_TAIL_LINES) {
    backendOutputBuffer.splice(0, backendOutputBuffer.length - BACKEND_LOG_TAIL_LINES);
  }
  appendDesktopLog(`Backend ${stream}`, lines.join(' | '));
}

function readBackendLogTail(maxLines = BACKEND_LOG_TAIL_LINES) {
  const backendLogPath = getBackendLogPath();
  if (!fs.existsSync(backendLogPath)) {
    return 'Backend log file not created yet.';
  }

  try {
    const lines = fs.readFileSync(backendLogPath, 'utf8').split(/\r?\n/).filter(Boolean);
    return lines.slice(-maxLines).join('\n') || 'Backend log file is empty.';
  } catch (error) {
    return `Unable to read backend log tail: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getExistingCandidatePath(candidatePaths) {
  const normalized = candidatePaths.filter(Boolean).map((candidate) => path.normalize(candidate));
  return normalized.find((candidate) => fs.existsSync(candidate)) ?? normalized[0];
}

function getProjectRoot() {
  if (app.isPackaged) {
    return (
      getPackagedAppRoot({
        resourcesPath: process.resourcesPath,
        appRoot: app.getAppPath(),
        dirnameHint: path.join(__dirname, '..'),
      }) || app.getAppPath()
    );
  }

  return process.cwd();
}

function resolveBackendEntryDetails() {
  return getBackendEntryCandidates({
    appRoot: getProjectRoot(),
    resourcesPath: app.isPackaged ? process.resourcesPath : undefined,
    dirnameHint: path.join(__dirname, '..'),
    envEntry: process.env.PATROL_BACKEND_ENTRY_PATH,
    packaged: app.isPackaged,
  });
}

function resolveFrontendEntryDetails() {
  return getFrontendEntryCandidates({
    appRoot: getProjectRoot(),
    resourcesPath: app.isPackaged ? process.resourcesPath : undefined,
    dirnameHint: path.join(__dirname, '..'),
    packaged: app.isPackaged,
  });
}

function getBackendEntryPoint() {
  const resolution = resolveBackendEntryDetails();
  return (
    resolution.resolved ||
    resolution.candidates[0]?.path ||
    getCanonicalBackendEntryPath(getProjectRoot()) ||
    path.join(getProjectRoot(), 'dist', 'main.js')
  );
}

function getNestCliPath() {
  return path.join(getProjectRoot(), 'node_modules', '@nestjs', 'cli', 'bin', 'nest.js');
}

function getElectronNodeBackendEnv(baseEnv) {
  return {
    ...baseEnv,
    ELECTRON_RUN_AS_NODE: '1',
  };
}

function getFrontendEntryPoint() {
  const resolution = resolveFrontendEntryDetails();
  return (
    resolution.resolved ||
    resolution.candidates[0]?.path ||
    path.join(getProjectRoot(), 'web', 'dist', 'index.html')
  );
}

function getConfigPath() {
  const explicitConfigPath = process.env.DESKTOP_CONFIG_PATH?.trim();
  if (explicitConfigPath) {
    return explicitConfigPath;
  }

  return path.join(app.getPath('userData'), CONFIG_FILE_NAME);
}

function getSecureStoreDirectory() {
  return path.join(app.getPath('userData'), 'secure-session');
}

function getSecureStoreFilePath(key) {
  const safeKey = String(key || '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 120);
  return path.join(getSecureStoreDirectory(), `${safeKey}.bin`);
}

function ensureDesktopJwtSecret() {
  const secretPath = path.join(app.getPath('userData'), 'jwt-secret.txt');
  try {
    if (fs.existsSync(secretPath)) {
      const existing = fs.readFileSync(secretPath, 'utf8').trim();
      if (existing.length >= 16) {
        return existing;
      }
    }
  } catch (error) {
    appendDesktopLog('jwt-secret-read-failed', error instanceof Error ? error.message : String(error));
  }

  const secret = crypto.randomBytes(48).toString('base64url');
  try {
    fs.writeFileSync(secretPath, secret, { encoding: 'utf8', mode: 0o600 });
  } catch (error) {
    appendDesktopLog('jwt-secret-write-failed', error instanceof Error ? error.message : String(error));
  }
  return secret;
}

function readSecureStoreValue(key) {
  const filePath = getSecureStoreFilePath(key);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const payload = fs.readFileSync(filePath);
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(payload);
    }
  } catch (error) {
    appendDesktopLog('secure-store-decrypt-failed', error instanceof Error ? error.message : String(error));
    return null;
  }

  return payload.toString('utf8');
}

function writeSecureStoreValue(key, value) {
  const directory = getSecureStoreDirectory();
  fs.mkdirSync(directory, { recursive: true });
  const filePath = getSecureStoreFilePath(key);
  const payload =
    safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(String(value)) : Buffer.from(String(value), 'utf8');
  fs.writeFileSync(filePath, payload);
}

function clearSecureStoreValue(key) {
  const filePath = getSecureStoreFilePath(key);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

const DEFAULT_WORKSPACE_CONFIG = {
  setupCompleted: false,
  autoLaunchApp: false,
  autoStartCollector: false,
  whatsappAllowFromMe: false,
};

function normalizeSetupCompleted(value) {
  if (value === true) {
    return true;
  }

  if (typeof value === 'string' && value.trim().toLowerCase() === 'true') {
    return true;
  }

  return false;
}

function readWorkspaceConfig() {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    return { ...DEFAULT_WORKSPACE_CONFIG };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return {
      ...DEFAULT_WORKSPACE_CONFIG,
      ...parsed,
      setupCompleted: normalizeSetupCompleted(parsed.setupCompleted),
    };
  } catch {
    return { ...DEFAULT_WORKSPACE_CONFIG };
  }
}

function validateStorageRootPath(storageRootPath) {
  const resolved = path.resolve(String(storageRootPath || '').trim());
  if (!resolved) {
    throw new Error('Storage folder path is required.');
  }

  fs.mkdirSync(resolved, { recursive: true });
  const probePath = path.join(resolved, '.patrol-storage-write-test');
  fs.writeFileSync(probePath, 'ok', 'utf8');
  fs.rmSync(probePath, { force: true });
  appendDesktopLog('storage-folder-selected', `path=${resolved}`);
  return resolved;
}

function configChangeRequiresBackendRestart(partialConfig, currentConfig = readWorkspaceConfig()) {
  const restartKeys = [
    'storageRootPath',
    'dbType',
    'sqliteDbPath',
    'dbHost',
    'dbPort',
    'dbUser',
    'dbPassword',
    'dbName',
    'autoStartCollector',
    'whatsappAllowFromMe',
    'whatsappChromePath',
    'whatsappHeadless',
  ];

  return restartKeys.some((key) => {
    if (!Object.prototype.hasOwnProperty.call(partialConfig, key)) {
      return false;
    }

    if (key === 'storageRootPath') {
      const nextPath = path.resolve(String(partialConfig.storageRootPath || '').trim());
      const currentPath = currentConfig.storageRootPath
        ? path.resolve(String(currentConfig.storageRootPath).trim())
        : '';
      return !currentPath || nextPath !== currentPath;
    }

    return partialConfig[key] !== currentConfig[key];
  });
}

function resolveStoragePathForCompare(storageRootPath) {
  return path.resolve(String(storageRootPath || '').trim());
}

function getSetupRecoveryRouteHash() {
  const config = readWorkspaceConfig();
  return normalizeSetupCompleted(config.setupCompleted) ? '' : '#/desktop/setup';
}

function writeWorkspaceConfig(nextConfig) {
  const configPath = getConfigPath();
  const current = readWorkspaceConfig();
  const merged = {
    ...current,
    ...nextConfig,
  };

  if (Object.prototype.hasOwnProperty.call(nextConfig, 'setupCompleted')) {
    merged.setupCompleted = normalizeSetupCompleted(nextConfig.setupCompleted);
  } else {
    merged.setupCompleted = normalizeSetupCompleted(current.setupCompleted);
  }

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(merged, null, 2), 'utf8');
  if (merged.setupCompleted === true) {
    appendDesktopLog('SETUP_COMPLETED_SAVED', 'true');
  }
}

function getBackendPort() {
  const config = readWorkspaceConfig();
  return Number(config.backendPort || DEFAULT_BACKEND_PORT);
}

function getApiBaseUrl() {
  return `http://localhost:${getBackendPort()}`;
}

function getBackendHealthUrl() {
  return `http://localhost:${getBackendPort()}${BACKEND_HEALTH_PATH}`;
}

function resolvePackagedLicensePublicKeyPath() {
  const fileNames = ['license-public.pem', 'license-public.key'];
  const candidateRoots = [];

  if (app.isPackaged) {
    // Canonical packaged location: process.resourcesPath/license-public.pem (extraResource).
    if (process.resourcesPath) {
      candidateRoots.push(process.resourcesPath);
    }
  } else {
    candidateRoots.push(path.join(process.cwd(), 'resources'));
    candidateRoots.push(path.join(process.cwd(), '.license-keys'));
  }

  for (const root of candidateRoots) {
    for (const fileName of fileNames) {
      const candidate = path.join(root, fileName);
      if (fs.existsSync(candidate)) {
        appendDesktopLog('LICENSE_PUBLIC_KEY_RUNTIME_PATH', candidate);
        return candidate;
      }
    }
  }

  if (app.isPackaged) {
    appendDesktopLog(
      'LICENSE_PUBLIC_KEY_PACKAGE_VALIDATION_FAILED',
      'Packaged public key file was not found under process.resourcesPath.',
    );
  }

  return null;
}

function applyLicensePublicKeyRuntimeEnv(env) {
  env.PATROL_DESKTOP_PACKAGED = app.isPackaged ? 'true' : 'false';

  if (process.resourcesPath) {
    env.PATROL_RESOURCES_PATH = process.resourcesPath;
  }

  if (app.isPackaged) {
    env.PATROL_APP_PATH = app.getAppPath();
  }

  const publicKeyPath = resolvePackagedLicensePublicKeyPath();
  if (publicKeyPath) {
    env.LICENSE_PUBLIC_KEY_FILE = publicKeyPath;
  }

  return env;
}

function backendOutputIndicatesListening(text) {
  return /bootstrap:listening|Nest application successfully started/i.test(String(text || ''));
}

function markBackendListeningDetected(source) {
  if (backendListeningDetected) {
    return;
  }

  backendListeningDetected = true;
  appendDesktopLog('backend-listening-detected', source);
}

function probeBackendHealthOnce(timeoutMs = 4_000) {
  const healthUrl = getBackendHealthUrl();

  return new Promise((resolve) => {
    const request = http.get(healthUrl, (response) => {
      let body = '';
      response.on('data', (chunk) => {
        body += chunk.toString();
      });
      response.on('end', () => {
        if (response.statusCode !== 200) {
          resolve({ ok: false, statusCode: response.statusCode, healthUrl });
          return;
        }

        try {
          const parsed = JSON.parse(body);
          resolve({
            ok: parsed?.status === 'ok',
            statusCode: response.statusCode,
            healthUrl,
          });
        } catch {
          resolve({ ok: false, statusCode: response.statusCode, healthUrl });
        }
      });
    });

    request.on('error', () => {
      resolve({ ok: false, statusCode: null, healthUrl });
    });

    request.setTimeout(timeoutMs, () => {
      request.destroy();
      resolve({ ok: false, statusCode: null, healthUrl, timedOut: true });
    });
  });
}

function findPidListeningOnPort(port) {
  if (process.platform === 'win32') {
    try {
      const output = execSync(`netstat -ano -p tcp | findstr :${port}`, {
        encoding: 'utf8',
        windowsHide: true,
      });
      const lines = String(output || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

      for (const line of lines) {
        if (!/LISTENING/i.test(line)) {
          continue;
        }

        const parts = line.split(/\s+/);
        const pid = Number(parts[parts.length - 1]);
        if (Number.isInteger(pid) && pid > 0) {
          return pid;
        }
      }
    } catch {
      return null;
    }

    return null;
  }

  try {
    const output = execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t`, {
      encoding: 'utf8',
    }).trim();
    const pid = Number(output.split(/\r?\n/)[0]);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function getProcessCommandLine(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return '';
  }

  if (process.platform === 'win32') {
    try {
      const output = execSync(
        `powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter \\"ProcessId=${pid}\\").CommandLine"`,
        { encoding: 'utf8', windowsHide: true },
      );
      return String(output || '').trim();
    } catch {
      return '';
    }
  }

  try {
    return execSync(`ps -p ${pid} -o command=`, { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

function isPatrolBackendPid(pid) {
  if (pid === backendProcess?.pid) {
    return true;
  }

  const commandLine = getProcessCommandLine(pid);
  if (!commandLine) {
    return false;
  }

  return (
    /PATROL_RUN_BACKEND=true/i.test(commandLine) ||
    /patrol-evidence-platform/i.test(commandLine) ||
    /PatrolEvidencePlatform\.exe/i.test(commandLine) ||
    /dist[\\/]+main\.js/i.test(commandLine)
  );
}

function killProcessTree(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return;
  }

  if (process.platform === 'win32') {
    execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore', windowsHide: true });
    return;
  }

  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Ignore kill failures for processes that already exited.
    }
  }
}

async function waitForBackendPortRelease(port, timeoutMs = 10_000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const pid = findPidListeningOnPort(port);
    if (!pid) {
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, 400));
  }

  return !findPidListeningOnPort(port);
}

async function adoptExistingHealthyBackendIfAvailable() {
  const health = await probeBackendHealthOnce();
  if (!health.ok) {
    return false;
  }

  appendDesktopLog('backend-existing-health-ok', health.healthUrl);
  appendDesktopLog('backend-existing-reused', `url=${health.healthUrl}`);
  appendDesktopLog('backend-start-skipped-existing-healthy', `port=${getBackendPort()}`);

  const existingPid = findPidListeningOnPort(getBackendPort());
  markBackendListeningDetected('existing-health-probe');
  backendListeningDetected = true;
  backendState = {
    status: 'ready',
    startedAt: backendState.startedAt ?? new Date().toISOString(),
    lastExitAt: backendState.lastExitAt,
    pid: existingPid ?? backendProcess?.pid ?? null,
  };
  mainWindow?.webContents.send('desktop:backend-status', getDesktopState());
  return true;
}

async function releaseStaleBackendPortIfNeeded() {
  const port = getBackendPort();
  const existingHealth = await probeBackendHealthOnce();
  if (existingHealth.ok) {
    return adoptExistingHealthyBackendIfAvailable();
  }

  const pidOnPort = findPidListeningOnPort(port);
  if (!pidOnPort) {
    return false;
  }

  appendDesktopLog('backend-port-in-use', `port=${port} pid=${pidOnPort}`);

  if (backendProcess?.pid === pidOnPort) {
    return false;
  }

  if (!isPatrolBackendPid(pidOnPort)) {
    appendDesktopLog(
      'backend-port-in-use-foreign-process',
      `port=${port} pid=${pidOnPort} command=${getProcessCommandLine(pidOnPort) || 'unknown'}`,
    );
    return false;
  }

  appendDesktopLog('backend-stale-process-killed', `port=${port} pid=${pidOnPort}`);
  killProcessTree(pidOnPort);
  await waitForBackendPortRelease(port, 12_000);
  return false;
}

function resolveBackendHealthTimeoutMs(explicitTimeoutMs) {
  if (typeof explicitTimeoutMs === 'number' && explicitTimeoutMs > 0) {
    return Math.max(explicitTimeoutMs, MIN_PACKAGED_BACKEND_HEALTH_TIMEOUT_MS);
  }

  if (backendRestartInProgress) {
    return RESTART_BACKEND_HEALTH_TIMEOUT_MS;
  }

  if (app.isPackaged) {
    return PACKAGED_BACKEND_HEALTH_TIMEOUT_MS;
  }

  return DEFAULT_BACKEND_HEALTH_TIMEOUT_MS;
}

function getDesktopState() {
  const config = readWorkspaceConfig();
  return {
    isDesktop: true,
    apiBaseUrl: getApiBaseUrl(),
    configPath: getConfigPath(),
    config,
    backend: backendState,
  };
}

function getPostgresInstallGuideUrl() {
  return POSTGRES_INSTALL_GUIDES[process.platform] || 'https://www.postgresql.org/download/';
}

function isLocalHost(hostname) {
  const normalized = String(hostname || '').trim().toLowerCase();
  return ['localhost', '127.0.0.1', '::1', '0.0.0.0'].includes(normalized);
}

function listExistingPaths(candidatePaths) {
  return candidatePaths.filter((candidate) => fs.existsSync(candidate));
}

function detectLocalPostgresInstall() {
  if (!isLocalHost('localhost')) {
    return { installed: null, detectedBinaryPath: null };
  }

  if (process.platform === 'win32') {
    const baseDirs = [
      'C:\\Program Files\\PostgreSQL',
      'C:\\Program Files (x86)\\PostgreSQL',
    ];
    const detected = [];

    for (const baseDir of baseDirs) {
      if (!fs.existsSync(baseDir)) {
        continue;
      }

      for (const versionDir of fs.readdirSync(baseDir)) {
        const candidate = path.join(baseDir, versionDir, 'bin', 'psql.exe');
        if (fs.existsSync(candidate)) {
          detected.push(candidate);
        }
      }
    }

    return {
      installed: detected.length > 0,
      detectedBinaryPath: detected[0] ?? null,
    };
  }

  if (process.platform === 'darwin') {
    const candidates = listExistingPaths([
      '/Applications/Postgres.app/Contents/Versions/latest/bin/psql',
      '/opt/homebrew/bin/psql',
      '/usr/local/bin/psql',
    ]);

    return {
      installed: candidates.length > 0,
      detectedBinaryPath: candidates[0] ?? null,
    };
  }

  return {
    installed: null,
    detectedBinaryPath: null,
  };
}

function normalizePostgresConfig(overrides = {}) {
  const storedConfig = readWorkspaceConfig();
  const source = {
    ...storedConfig,
    ...overrides,
  };

  return {
    host: String(source.dbHost || 'localhost').trim(),
    port: Number(source.dbPort || 5432),
    user: String(source.dbUser || 'postgres').trim(),
    password: String(source.dbPassword || ''),
    database: String(source.dbName || 'patrol_evidence').trim(),
  };
}

function quoteIdentifier(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

async function withPgClient(config, databaseName, callback) {
  const client = new Client({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: databaseName,
  });

  await client.connect();
  try {
    return await callback(client);
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function connectWithFallbackDatabase(config, databases = ['postgres', 'template1']) {
  let lastError = null;

  for (const databaseName of databases) {
    try {
      const client = new Client({
        host: config.host,
        port: config.port,
        user: config.user,
        password: config.password,
        database: databaseName,
      });
      await client.connect();
      return { client, databaseName };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

async function closePgClient(client) {
  if (!client) {
    return;
  }

  await client.end().catch(() => undefined);
}

async function databaseExists(adminClient, databaseName) {
  const result = await adminClient.query('SELECT 1 FROM pg_database WHERE datname = $1', [databaseName]);
  return result.rowCount > 0;
}

async function checkSchemaReady(config) {
  try {
    return await withPgClient(config, config.database, async (client) => {
      const result = await client.query(
        `
          SELECT COUNT(*)::int AS table_count
          FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name = ANY($1::text[])
        `,
        [['companies', 'users', 'sites', 'patrol_groups', 'patrol_images']],
      );

      return Number(result.rows[0]?.table_count ?? 0) >= 5;
    });
  } catch {
    return false;
  }
}

function buildPostgresStatus(config, overrides = {}) {
  const install = isLocalHost(config.host) ? detectLocalPostgresInstall() : { installed: null, detectedBinaryPath: null };

  return {
    host: config.host,
    port: config.port,
    user: config.user,
    database: config.database,
    localServerExpected: isLocalHost(config.host),
    postgresInstalled: install.installed,
    detectedBinaryPath: install.detectedBinaryPath,
    installGuideUrl: getPostgresInstallGuideUrl(),
    reachable: false,
    credentialsValid: false,
    databaseExists: false,
    schemaReady: false,
    migrationsRan: false,
    issueCode: POSTGRES_ISSUE_CODES.NOT_CHECKED,
    issueTitle: 'Not checked yet',
    plainMessage: 'Run the database test to confirm the server, password, database, and app tables.',
    recommendedAction: 'Select Test Database to run a local PostgreSQL check for this workstation.',
    checkedAt: new Date().toISOString(),
    message: 'PostgreSQL has not been checked yet.',
    error: null,
    ...overrides,
  };
}

function isWrongPasswordError(error) {
  const code = error?.code;
  const message = error instanceof Error ? error.message : String(error || '');
  return code === '28P01' || /password authentication failed/i.test(message);
}

function isServiceNotRunningError(error) {
  const code = error?.code;
  const message = error instanceof Error ? error.message : String(error || '');
  return (
    ['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'EHOSTUNREACH'].includes(code) ||
    /connect ECONNREFUSED|timeout expired|could not connect to server|getaddrinfo ENOTFOUND|Connection terminated unexpectedly/i.test(
      message,
    )
  );
}

function setPostgresIssue(status, issueCode, issueTitle, plainMessage, recommendedAction) {
  status.issueCode = issueCode;
  status.issueTitle = issueTitle;
  status.plainMessage = plainMessage;
  status.recommendedAction = recommendedAction;
  status.checkedAt = new Date().toISOString();
}

function runNodeScript(scriptPath, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath], {
      cwd: getProjectRoot(),
      env: {
        ...process.env,
        ...extraEnv,
        ELECTRON_RUN_AS_NODE: '1',
      },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(new Error(stderr.trim() || stdout.trim() || `Script exited with code ${code}`));
    });
  });
}

function openDebugToolsIfNeeded(reason = 'manual') {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  if (shouldOpenDebugTools() || reason === 'frontend-load-failed') {
    appendDesktopLog('Opening DevTools', `reason=${reason}`);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

function renderStartupFailurePage(title, reason, errorMessage) {
  if (!mainWindow || mainWindow.isDestroyed() || isShowingFrontendFallback) {
    return;
  }

  isShowingFrontendFallback = true;
  const backendSummary = `${backendState.status}${backendState.pid ? ` (pid ${backendState.pid})` : ''}`;
  const frontendEntryPoint = getResolvedFrontendEntryPoint();
  const backendResolution = resolveBackendEntryDetails();
  const frontendResolution = resolveFrontendEntryDetails();
  const backendLogExcerpt = (() => {
    try {
      const logPath = getBackendLogPath();
      if (!fs.existsSync(logPath)) {
        return 'Backend log file not found.';
      }
      const lines = fs.readFileSync(logPath, 'utf8').split(/\r?\n/).filter(Boolean);
      return lines.slice(-BACKEND_LOG_TAIL_LINES).join('\n') || 'Backend log file is empty.';
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  })();
  const html = `
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Patrol Evidence Platform - Frontend Load Failed</title>
        <style>
          body {
            margin: 0;
            font-family: "Segoe UI", Arial, sans-serif;
            background: #f4f6f8;
            color: #182430;
          }
          .wrap {
            max-width: 920px;
            margin: 48px auto;
            padding: 32px;
          }
          .card {
            background: #ffffff;
            border: 1px solid #d8dee6;
            border-radius: 16px;
            box-shadow: 0 12px 30px rgba(24, 36, 48, 0.08);
            padding: 28px;
          }
          h1 {
            margin: 0 0 12px;
            font-size: 28px;
          }
          p {
            margin: 0 0 16px;
            line-height: 1.5;
          }
          .meta {
            display: grid;
            gap: 12px;
            margin-top: 20px;
          }
          .meta-item {
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 12px;
            padding: 14px 16px;
          }
          .meta-item strong {
            display: block;
            margin-bottom: 6px;
          }
          code, pre {
            font-family: Consolas, "Courier New", monospace;
            white-space: pre-wrap;
            word-break: break-word;
          }
        </style>
      </head>
      <body>
        <div class="wrap">
          <div class="card">
            <h1>${escapeHtml(title)}</h1>
            <p>This page is shown instead of leaving the desktop app stuck or unclear during startup. The details below are intended to make packaged Windows failures visible on a customer machine.</p>
            <div class="meta">
              <div class="meta-item">
                <strong>Application version</strong>
                <code>${escapeHtml(`${PRODUCT_METADATA.productName} ${PRODUCT_METADATA.version} (build ${PRODUCT_METADATA.buildId})`)}</code>
              </div>
              <div class="meta-item">
                <strong>App path</strong>
                <code>${escapeHtml(app.getAppPath())}</code>
              </div>
              <div class="meta-item">
                <strong>Resources path</strong>
                <code>${escapeHtml(process.resourcesPath || 'unavailable')}</code>
              </div>
              <div class="meta-item">
                <strong>Frontend load target</strong>
                <code>${escapeHtml(frontendState.target ?? 'unknown')}</code>
              </div>
              <div class="meta-item">
                <strong>Frontend file path</strong>
                <code>${escapeHtml(frontendEntryPoint)}</code>
              </div>
              <div class="meta-item">
                <strong>Attempted frontend paths</strong>
                <pre>${escapeHtml(
                  JSON.stringify(
                    frontendResolution.candidates.map((candidate) => ({
                      path: candidate.path,
                      exists: candidate.exists,
                    })),
                    null,
                    2,
                  ),
                )}</pre>
              </div>
              <div class="meta-item">
                <strong>Backend entry path</strong>
                <code>${escapeHtml(backendEntryPoint ?? getResolvedBackendEntryPoint())}</code>
              </div>
              <div class="meta-item">
                <strong>Attempted backend entry paths</strong>
                <pre>${escapeHtml(
                  JSON.stringify(
                    backendResolution.candidates.map((candidate) => ({
                      path: candidate.path,
                      exists: candidate.exists,
                    })),
                    null,
                    2,
                  ),
                )}</pre>
              </div>
              <div class="meta-item">
                <strong>Backend command</strong>
                <code>${escapeHtml(backendSpawnCommand ?? 'Not captured')}</code>
              </div>
              <div class="meta-item">
                <strong>Frontend source</strong>
                <code>${escapeHtml(frontendState.source)}</code>
              </div>
              <div class="meta-item">
                <strong>Backend status</strong>
                <code>${escapeHtml(backendSummary)}</code>
              </div>
              <div class="meta-item">
                <strong>Failure reason</strong>
                <code>${escapeHtml(reason)}</code>
              </div>
              <div class="meta-item">
                <strong>Error message</strong>
                <pre>${escapeHtml(errorMessage || 'No additional error details were available.')}</pre>
              </div>
              <div class="meta-item">
                <strong>Backend exit</strong>
                <code>${escapeHtml(
                  JSON.stringify({
                    code: backendExitDetails.code,
                    signal: backendExitDetails.signal,
                  }),
                )}</code>
              </div>
              <div class="meta-item">
                <strong>Backend log excerpt</strong>
                <pre>${escapeHtml(backendLogExcerpt)}</pre>
              </div>
              <div class="meta-item">
                <strong>Backend startup environment</strong>
                <pre>${escapeHtml(
                  JSON.stringify(
                    {
                      PORT: backendStartupEnv?.PORT ?? null,
                      DESKTOP_CONFIG_PATH: backendStartupEnv?.DESKTOP_CONFIG_PATH ?? null,
                      DB_TYPE: backendStartupEnv?.DB_TYPE ?? null,
                      STORAGE_ROOT_PATH: backendStartupEnv?.STORAGE_ROOT_PATH ?? null,
                    },
                    null,
                    2,
                  ),
                )}</pre>
              </div>
              <div class="meta-item">
                <strong>Desktop log file</strong>
                <code>${escapeHtml(getLogPath())}</code>
              </div>
              <div class="meta-item">
                <strong>Backend log file</strong>
                <code>${escapeHtml(getBackendLogPath())}</code>
              </div>
              <div class="meta-item">
                <strong>Missing file check</strong>
                <code>${escapeHtml(
                  JSON.stringify({
                    frontendExists: fs.existsSync(frontendEntryPoint),
                    backendExists: fs.existsSync(backendEntryPoint),
                    preloadExists: fs.existsSync(path.join(__dirname, 'preload.js')),
                  }),
                )}</code>
              </div>
              <div class="meta-item">
                <strong>Recent backend output</strong>
                <pre>${escapeHtml(backendOutputBuffer.join('\n') || 'No backend output captured yet.')}</pre>
              </div>
              <div class="meta-item">
                <strong>Backend log tail (${BACKEND_LOG_TAIL_LINES} lines)</strong>
                <pre>${escapeHtml(readBackendLogTail())}</pre>
              </div>
            </div>
          </div>
        </div>
      </body>
    </html>
  `;

  mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).catch((error) => {
    appendDesktopLog(
      'Failed to render frontend fallback page',
      error instanceof Error ? error.stack || error.message : String(error),
    );
  });
}

function renderFrontendFailurePage(reason, errorMessage) {
  renderStartupFailurePage(
    'Patrol Evidence Platform could not open the desktop screen',
    reason,
    errorMessage,
  );
}

function renderBackendFailurePage(reason, errorMessage) {
  if (backendRestartInProgress) {
    renderBackendRestartingPage();
    return;
  }

  renderStartupFailurePage(
    'Patrol Evidence Platform could not start the local backend',
    reason,
    errorMessage,
  );
}

function renderBackendRestartingPage() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  isShowingFrontendFallback = true;
  const healthUrl = getBackendHealthUrl();
  const timeoutMs = RESTART_BACKEND_HEALTH_TIMEOUT_MS;
  const html = `
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Patrol Evidence Platform - Restarting</title>
        <style>
          body { margin: 0; font-family: "Segoe UI", Arial, sans-serif; background: #f4f6f8; color: #182430; }
          .wrap { max-width: 720px; margin: 48px auto; padding: 32px; }
          .card { background: #fff; border: 1px solid #d8dee6; border-radius: 16px; padding: 28px; }
          h1 { margin: 0 0 12px; font-size: 26px; }
          p { margin: 0 0 12px; line-height: 1.5; }
          .actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 20px; }
          button { border: 1px solid #cbd5e1; background: #fff; border-radius: 10px; padding: 10px 16px; cursor: pointer; font-size: 14px; }
          button.primary { background: #1d4ed8; border-color: #1d4ed8; color: #fff; }
          .hidden { display: none; }
          .error { color: #b42318; }
        </style>
      </head>
      <body>
        <div class="wrap">
          <div class="card">
            <h1>Restarting local service…</h1>
            <p id="status-line">Patrol Evidence Platform is applying your setup changes and restarting the local backend on port ${getBackendPort()}.</p>
            <p>This can take up to ${Math.round(timeoutMs / 1000)} seconds during first-run setup. The desktop screen will reload automatically when ${escapeHtml(healthUrl)} responds.</p>
            <div id="recovery-panel" class="hidden">
              <p class="error">Restart is taking longer than expected. You can retry the health check or return to setup.</p>
              <div class="actions">
                <button type="button" class="primary" id="retry-health">Retry health check</button>
                <button type="button" id="return-setup">Return to setup</button>
                <button type="button" id="open-logs">Open logs</button>
              </div>
            </div>
          </div>
        </div>
        <script>
          (function () {
            var healthUrl = ${JSON.stringify(healthUrl)};
            var timeoutMs = ${timeoutMs};
            var recoveryPanel = document.getElementById('recovery-panel');
            var statusLine = document.getElementById('status-line');
            var deadline = Date.now() + timeoutMs;

            function navigate(action) {
              window.location.href = 'patrol-recovery://' + action;
            }

            function pollHealth() {
              fetch(healthUrl, { cache: 'no-store' })
                .then(function (response) {
                  if (response.ok) {
                    statusLine.textContent = 'Local service is ready. Reloading setup…';
                    window.location.href = 'patrol-recovery://reload-setup';
                  }
                })
                .catch(function () {
                  if (Date.now() >= deadline) {
                    recoveryPanel.classList.remove('hidden');
                  }
                });
            }

            document.getElementById('retry-health').addEventListener('click', function () {
              navigate('retry-health');
            });
            document.getElementById('return-setup').addEventListener('click', function () {
              navigate('return-setup');
            });
            document.getElementById('open-logs').addEventListener('click', function () {
              navigate('open-logs');
            });

            setInterval(pollHealth, 2500);
            pollHealth();
            setTimeout(function () {
              recoveryPanel.classList.remove('hidden');
            }, timeoutMs);
          })();
        </script>
      </body>
    </html>
  `;

  mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).catch((error) => {
    appendDesktopLog(
      'Failed to render backend restarting page',
      error instanceof Error ? error.stack || error.message : String(error),
    );
  });
}

async function handlePatrolRecoveryAction(action) {
  appendDesktopLog('patrol-recovery-action', action);

  if (action === 'open-logs') {
    await shell.openPath(getLogPath());
    return;
  }

  if (action === 'return-setup' || action === 'reload-setup') {
    backendRestartInProgress = false;
    reloadFrontendAfterBackendRecovery('#/desktop/setup');
    return;
  }

  if (action === 'retry-health') {
    try {
      await waitForBackendReady(15_000);
      appendDesktopLog('setup-storage-restart-complete', getBackendHealthUrl());
      backendRestartInProgress = false;
      reloadFrontendAfterBackendRecovery('#/desktop/setup');
    } catch (error) {
      appendDesktopLog(
        'patrol-recovery-retry-failed',
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}

function clearBackendRecoveryTimeout() {
  if (!backendRecoveryTimeout) {
    return;
  }

  clearTimeout(backendRecoveryTimeout);
  backendRecoveryTimeout = null;
}

function reloadFrontendAfterBackendRecovery(routeHash = '') {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  const frontendEntryPoint = getResolvedFrontendEntryPoint();
  const frontendUrl = `${pathToFileURL(frontendEntryPoint).toString()}${routeHash || ''}`;
  isShowingFrontendFallback = false;
  appendDesktopLog('Reloading frontend after backend recovery', frontendUrl);
  mainWindow.loadURL(frontendUrl).catch((error) => {
    appendDesktopLog(
      'Failed to reload frontend after backend recovery',
      error instanceof Error ? error.stack || error.message : String(error),
    );
    renderBackendFailurePage(
      'backend-recovery-reload-failed',
      error instanceof Error ? error.message : String(error),
    );
  });
}

function scheduleBackendRecoveryProbe(deadlineMs = BACKEND_RECOVERY_WINDOW_MS) {
  if (!app.isPackaged || backendRecoveryTimeout) {
    return;
  }

  const startedAt = Date.now();
  const probe = () => {
    if (Date.now() - startedAt > deadlineMs) {
      clearBackendRecoveryTimeout();
      appendDesktopLog('Backend recovery probe expired', `windowMs=${deadlineMs}`);
      return;
    }

    waitForBackendReady(5_000)
      .then(() => {
        clearBackendRecoveryTimeout();
        appendDesktopLog('backend-health-check-success', `${getBackendHealthUrl()} state=recovered`);
        appendDesktopLog('Backend recovered after initial timeout', getApiBaseUrl());
        backendState = {
          ...backendState,
          status: 'ready',
        };
        mainWindow?.webContents.send('desktop:backend-status', getDesktopState());
        if (isShowingFrontendFallback) {
          reloadFrontendAfterBackendRecovery(getSetupRecoveryRouteHash());
        }
      })
      .catch(() => {
        backendRecoveryTimeout = setTimeout(probe, 2_500);
      });
  };

  backendRecoveryTimeout = setTimeout(probe, 2_500);
}

async function runDatabaseMigrations(config) {
  const scriptPath = path.join(getProjectRoot(), 'desktop', 'run-migrations.js');
  await runNodeScript(scriptPath, {
    DESKTOP_PROJECT_ROOT: getProjectRoot(),
    DESKTOP_DB_HOST: config.host,
    DESKTOP_DB_PORT: String(config.port),
    DESKTOP_DB_USER: config.user,
    DESKTOP_DB_PASSWORD: config.password,
    DESKTOP_DB_NAME: config.database,
  });
}

async function checkPostgres(overrides = {}) {
  const config = normalizePostgresConfig(overrides);
  const status = buildPostgresStatus(config);
  let adminConnection = null;

  try {
    adminConnection = await connectWithFallbackDatabase(config);
    status.reachable = true;
    status.credentialsValid = true;
    status.databaseExists = await databaseExists(adminConnection.client, config.database);
    status.schemaReady = status.databaseExists ? await checkSchemaReady(config) : false;
    if (status.schemaReady) {
      setPostgresIssue(
        status,
        POSTGRES_ISSUE_CODES.READY,
        'Database ready',
        'PostgreSQL is working and the Patrol Evidence tables are ready on this workstation.',
        'You can continue with setup or restart services if you recently changed settings.',
      );
      status.message = 'PostgreSQL is ready for the desktop workspace.';
    } else if (status.databaseExists) {
      setPostgresIssue(
        status,
        POSTGRES_ISSUE_CODES.MIGRATIONS_MISSING,
        'App tables missing',
        'The database exists, but Patrol Evidence tables are still missing or incomplete.',
        'Select Create DB and run migrations to prepare the required app tables.',
      );
      status.message = 'Database exists but still needs migrations.';
    } else {
      setPostgresIssue(
        status,
        POSTGRES_ISSUE_CODES.DATABASE_MISSING,
        'Database missing',
        `The PostgreSQL server is reachable, but the "${config.database}" database has not been created yet.`,
        'Select Create DB and run migrations to create the workspace database automatically.',
      );
      status.message = 'PostgreSQL is reachable. The workspace database still needs to be created.';
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to connect to PostgreSQL';
    status.error = message;

    if (isWrongPasswordError(error)) {
      status.reachable = true;
      setPostgresIssue(
        status,
        POSTGRES_ISSUE_CODES.WRONG_PASSWORD,
        'Password not accepted',
        'The PostgreSQL server replied, but the username or password was not accepted.',
        'Check the database username and password, then run Test Database again.',
      );
      status.message = 'PostgreSQL rejected the supplied username or password.';
    } else if (isServiceNotRunningError(error)) {
      setPostgresIssue(
        status,
        POSTGRES_ISSUE_CODES.SERVICE_NOT_RUNNING,
        'PostgreSQL not reachable',
        isLocalHost(config.host)
          ? 'We could not reach PostgreSQL on this computer. The service may be stopped, not installed, or listening on a different port.'
          : 'We could not reach the PostgreSQL server at the host and port provided.',
        isLocalHost(config.host)
          ? 'Start the PostgreSQL service, confirm the port, or install PostgreSQL, then run Test Database again.'
          : 'Check the server address, network access, and PostgreSQL port, then run Test Database again.',
      );
      status.message = isLocalHost(config.host)
        ? 'PostgreSQL is not reachable on this machine yet. Install it or start the service, then try again.'
        : 'PostgreSQL is not reachable with the current settings.';
    } else {
      setPostgresIssue(
        status,
        POSTGRES_ISSUE_CODES.UNKNOWN,
        'Database check failed',
        'The database check did not complete successfully, and the exact issue was not recognised automatically.',
        'Review the technical details below, then retry the check after adjusting the settings.',
      );
      status.message = 'PostgreSQL could not be checked with the current settings.';
    }
  } finally {
    await closePgClient(adminConnection?.client);
  }

  return status;
}

async function provisionPostgres(overrides = {}) {
  const config = normalizePostgresConfig(overrides);
  const status = buildPostgresStatus(config);
  let adminConnection = null;

  try {
    adminConnection = await connectWithFallbackDatabase(config);
    status.reachable = true;
    status.credentialsValid = true;

    status.databaseExists = await databaseExists(adminConnection.client, config.database);
    if (!status.databaseExists) {
      await adminConnection.client.query(`CREATE DATABASE ${quoteIdentifier(config.database)}`);
      status.databaseExists = true;
    }

    await closePgClient(adminConnection.client);
    adminConnection = null;

    await runDatabaseMigrations(config);
    status.migrationsRan = true;
    status.schemaReady = await checkSchemaReady(config);
    if (status.schemaReady) {
      setPostgresIssue(
        status,
        POSTGRES_ISSUE_CODES.READY,
        'Database ready',
        'The workspace database and Patrol Evidence tables were prepared successfully.',
        'You can continue with setup or restart services if you recently changed settings.',
      );
      status.message = 'PostgreSQL is ready and the patrol evidence schema has been prepared.';
    } else {
      setPostgresIssue(
        status,
        POSTGRES_ISSUE_CODES.MIGRATIONS_MISSING,
        'App tables missing',
        'The database was created, but Patrol Evidence tables still appear incomplete.',
        'Retry Create DB and run migrations, then use Test Database to confirm the schema is ready.',
      );
      status.message = 'Database was created, but the schema check did not complete successfully.';
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to provision PostgreSQL';
    status.error = message;

    if (isWrongPasswordError(error)) {
      status.reachable = true;
      setPostgresIssue(
        status,
        POSTGRES_ISSUE_CODES.WRONG_PASSWORD,
        'Password not accepted',
        'PostgreSQL is running, but the supplied username or password was not accepted.',
        'Correct the database username or password, then retry the workspace preparation.',
      );
      status.message = 'PostgreSQL rejected the supplied username or password.';
    } else if (isServiceNotRunningError(error)) {
      setPostgresIssue(
        status,
        POSTGRES_ISSUE_CODES.SERVICE_NOT_RUNNING,
        'PostgreSQL not reachable',
        isLocalHost(config.host)
          ? 'We could not reach PostgreSQL on this computer, so the workspace database could not be prepared.'
          : 'We could not reach the configured PostgreSQL server, so the workspace database could not be prepared.',
        isLocalHost(config.host)
          ? 'Start PostgreSQL or confirm the host and port, then retry the workspace preparation.'
          : 'Check the server address, network access, and PostgreSQL port, then retry the workspace preparation.',
      );
      status.message = isLocalHost(config.host)
        ? 'Could not prepare PostgreSQL automatically. Check the local PostgreSQL service and credentials, then try again.'
        : 'Could not prepare the configured PostgreSQL server with the supplied credentials.';
    } else {
      setPostgresIssue(
        status,
        status.databaseExists ? POSTGRES_ISSUE_CODES.MIGRATIONS_MISSING : POSTGRES_ISSUE_CODES.UNKNOWN,
        status.databaseExists ? 'App tables missing' : 'Database setup failed',
        status.databaseExists
          ? 'The workspace database exists, but migrations did not finish successfully.'
          : 'The workspace database could not be prepared automatically.',
        status.databaseExists
          ? 'Retry Create DB and run migrations after reviewing the technical details below.'
          : 'Review the technical details below, correct the database settings if needed, and try again.',
      );
      status.message = isLocalHost(config.host)
        ? 'Could not prepare PostgreSQL automatically. Check the local PostgreSQL service and credentials, then try again.'
        : 'Could not prepare the configured PostgreSQL server with the supplied credentials.';
    }
  } finally {
    await closePgClient(adminConnection?.client);
  }

  return status;
}

function updateLoginItemSettings() {
  const config = readWorkspaceConfig();
  app.setLoginItemSettings({
    openAtLogin: Boolean(config.autoLaunchApp),
    path: process.execPath,
  });
}

function waitForBackendReady(timeoutMs, expectedGeneration = backendHealthCheckGeneration) {
  const startedAt = Date.now();
  const healthUrl = getBackendHealthUrl();
  const resolvedTimeoutMs = resolveBackendHealthTimeoutMs(timeoutMs);

  appendDesktopLog(
    'backend-health-check-start',
    `url=${healthUrl} timeoutMs=${resolvedTimeoutMs} generation=${expectedGeneration}`,
  );

  return new Promise((resolve, reject) => {
    const tick = () => {
      if (expectedGeneration !== backendHealthCheckGeneration) {
        reject(new Error('Backend health check superseded'));
        return;
      }

      const elapsedMs = Date.now() - startedAt;
      const effectiveTimeoutMs =
        backendListeningDetected && elapsedMs <= resolvedTimeoutMs + BACKEND_LISTENING_GRACE_TIMEOUT_MS
          ? resolvedTimeoutMs + BACKEND_LISTENING_GRACE_TIMEOUT_MS
          : resolvedTimeoutMs;

      const request = http.get(healthUrl, (response) => {
        response.resume();
        if (response.statusCode === 200) {
          appendDesktopLog('backend-health-check-success', `${healthUrl} elapsedMs=${elapsedMs}`);
          resolve(true);
          return;
        }

        if (elapsedMs > effectiveTimeoutMs) {
          appendDesktopLog(
            'backend-health-check-timeout',
            `${healthUrl} status=${response.statusCode} elapsedMs=${elapsedMs} listening=${backendListeningDetected}`,
          );
          reject(new Error(`Backend health check timed out (${healthUrl} returned ${response.statusCode})`));
          return;
        }

        setTimeout(tick, 750);
      });

      request.on('error', (error) => {
        if (elapsedMs > effectiveTimeoutMs) {
          appendDesktopLog(
            'backend-health-check-timeout',
            `${healthUrl} elapsedMs=${elapsedMs} listening=${backendListeningDetected} error=${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          reject(new Error(`Backend health check timed out (${healthUrl} unreachable)`));
          return;
        }

        setTimeout(tick, 750);
      });

      request.setTimeout(5_000, () => {
        request.destroy();
      });
    };

    tick();
  });
}

async function recoverBackendPortConflict(child) {
  if (backendPortRecoveryInProgress) {
    return;
  }

  backendPortRecoveryInProgress = true;
  try {
    if (child && backendProcess === child) {
      backendProcess = null;
      try {
        child.kill();
      } catch {
        // Child may already have exited after EADDRINUSE.
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 750));

    if (await adoptExistingHealthyBackendIfAvailable()) {
      return;
    }

    await releaseStaleBackendPortIfNeeded();
    if (!backendProcess && backendState.status !== 'ready') {
      await startBackend();
    }
  } finally {
    backendPortRecoveryInProgress = false;
  }
}

async function startBackend() {
  if (backendProcess) {
    appendDesktopLog('Backend start skipped', 'process already running');
    return;
  }

  if (backendState.status === 'ready' && !backendProcess) {
    appendDesktopLog('backend-start-skipped-existing-healthy', `port=${getBackendPort()}`);
    return;
  }

  clearBackendRecoveryTimeout();

  if (await adoptExistingHealthyBackendIfAvailable()) {
    return;
  }

  await releaseStaleBackendPortIfNeeded();
  if (backendState.status === 'ready' && !backendProcess) {
    return;
  }

  backendHealthCheckGeneration += 1;
  const healthCheckGeneration = backendHealthCheckGeneration;
  backendListeningDetected = false;

  const runtimeValues = getConfiguredRuntimeValues();
  fs.mkdirSync(path.dirname(runtimeValues.sqliteDbPath), { recursive: true });
  fs.mkdirSync(runtimeValues.storageRootPath, { recursive: true });
  if (runtimeValues.whatsappSessionPath) {
    fs.mkdirSync(runtimeValues.whatsappSessionPath, { recursive: true });
  }

  // Keep Nest's config-driven path resolver aligned with packaged writable roots.
  const desktopConfigPath = getConfigPath();
  if (app.isPackaged) {
    const currentConfig = readWorkspaceConfig();
    const syncedConfig = {
      ...currentConfig,
      dbType: 'sqlite',
      sqliteDbPath: runtimeValues.sqliteDbPath,
      storageRootPath: runtimeValues.storageRootPath,
    };
    fs.mkdirSync(path.dirname(desktopConfigPath), { recursive: true });
    fs.writeFileSync(desktopConfigPath, JSON.stringify(syncedConfig, null, 2), 'utf8');
  }

  const env = applyLicensePublicKeyRuntimeEnv({
    ...process.env,
    PORT: String(getBackendPort()),
    DESKTOP_CONFIG_PATH: desktopConfigPath,
    DB_TYPE: runtimeValues.dbType,
    SQLITE_DB_PATH: runtimeValues.sqliteDbPath,
    STORAGE_ROOT_PATH: runtimeValues.storageRootPath,
    WHATSAPP_SESSION_PATH: runtimeValues.whatsappSessionPath,
    WHATSAPP_AUTO_START: runtimeValues.autoStartCollector ? 'true' : 'false',
    APP_DEBUG: process.env.APP_DEBUG === 'true' ? 'true' : process.env.APP_DEBUG,
    JWT_SECRET: ensureDesktopJwtSecret(),
    JWT_REFRESH_EXPIRES_IN_DAYS: process.env.JWT_REFRESH_EXPIRES_IN_DAYS || '90',
  });
  appendDesktopLog(
    runtimeValues.autoStartCollector ? 'WHATSAPP_AUTOSTART_ENABLED' : 'WHATSAPP_AUTOSTART_SKIPPED',
    `WHATSAPP_AUTO_START=${env.WHATSAPP_AUTO_START}`,
  );
  backendStartupEnv = {
    PORT: env.PORT,
    DESKTOP_CONFIG_PATH: env.DESKTOP_CONFIG_PATH,
    DB_TYPE: env.DB_TYPE,
    STORAGE_ROOT_PATH: env.STORAGE_ROOT_PATH,
    WHATSAPP_SESSION_PATH: env.WHATSAPP_SESSION_PATH ?? null,
    LICENSE_PUBLIC_KEY_FILE: env.LICENSE_PUBLIC_KEY_FILE ?? null,
  };
  backendExitDetails = {
    code: null,
    signal: null,
  };
  const cwd = getProjectRoot();
  appendDesktopLog(
    'Starting backend',
    `mode=${app.isPackaged ? 'packaged' : 'dev'} port=${env.PORT} cwd=${cwd} dbType=${env.DB_TYPE} sqlite=${env.SQLITE_DB_PATH} storage=${env.STORAGE_ROOT_PATH} whatsappSession=${env.WHATSAPP_SESSION_PATH}`,
  );

  if (app.isPackaged) {
    const backendResolution = resolveBackendEntryDetails();
    const entryPoint = backendResolution.resolved;
    backendEntryPoint = entryPoint;
    backendSpawnCommand = `${process.execPath} [ELECTRON_RUN_AS_NODE] ${entryPoint || 'MISSING'}`;
    appendDesktopLog(
      'Backend entry point resolved',
      `entry=${entryPoint || 'MISSING'} appRoot=${cwd} resourcesPath=${process.resourcesPath} candidates=${backendResolution.candidates
        .map((candidate) => `${candidate.path}:${candidate.exists ? 'exists' : 'missing'}`)
        .join('|')}`,
    );

    if (!entryPoint || !fs.existsSync(entryPoint)) {
      backendState = {
        status: 'failed',
        startedAt: backendState.startedAt,
        lastExitAt: new Date().toISOString(),
        pid: null,
      };
      backendExitDetails = { code: 1, signal: null };
      mainWindow?.webContents.send('desktop:backend-status', getDesktopState());
      renderStartupFailurePage(
        'Patrol Evidence Platform – Frontend Load Failed',
        'failed-to-start-local-backend',
        'Packaged backend entry file was not found. Expected resources/app/dist/main.js (Nest production build).',
      );
      return;
    }

    const packagedBackendEnv = {
      ...env,
      ELECTRON_RUN_AS_NODE: '1',
      PATROL_BACKEND_ENTRY_PATH: entryPoint,
      PATROL_APP_PATH: cwd,
    };
    delete packagedBackendEnv.PATROL_SMOKE_BACKEND_ONLY;
    delete packagedBackendEnv[BACKEND_CHILD_ENV_FLAG];
    // Run Nest directly under Electron's Node ABI (matches native modules).
    const child = spawn(process.execPath, [entryPoint], {
      cwd,
      env: packagedBackendEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    backendProcess = child;
    attachBackendProcessHandlers(child, healthCheckGeneration);
  } else {
    const nestCliPath = getNestCliPath();
    const devBackendEnv = getElectronNodeBackendEnv(env);
    backendSpawnCommand = `${process.execPath} [ELECTRON_RUN_AS_NODE] ${nestCliPath} start --watch --exec ${process.execPath}`;
    appendDesktopLog(
      'Backend dev command',
      `electron-node nest start --watch --exec electron nestCli=${nestCliPath} exists=${fs.existsSync(nestCliPath)}`,
    );
    const child = spawn(process.execPath, [nestCliPath, 'start', '--watch', '--exec', process.execPath], {
      cwd,
      env: devBackendEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    backendProcess = child;
    attachBackendProcessHandlers(child, healthCheckGeneration);
  }

  backendState = {
    status: 'starting',
    startedAt: new Date().toISOString(),
    lastExitAt: backendState.lastExitAt,
    pid: backendProcess.pid ?? null,
  };
  mainWindow?.webContents.send('desktop:backend-status', getDesktopState());

  const healthTimeoutMs = resolveBackendHealthTimeoutMs();
  void waitForBackendReady(healthTimeoutMs, healthCheckGeneration)
    .then(() => {
      if (healthCheckGeneration !== backendHealthCheckGeneration) {
        return;
      }

      clearBackendRecoveryTimeout();
      appendDesktopLog('backend-health-check-success', `${getBackendHealthUrl()} state=ready`);
      backendState = {
        ...backendState,
        status: 'ready',
        pid: backendProcess?.pid ?? backendState.pid,
      };
      mainWindow?.webContents.send('desktop:backend-status', getDesktopState());

      if (backendRestartInProgress && isShowingFrontendFallback) {
        reloadFrontendAfterBackendRecovery(getSetupRecoveryRouteHash());
      }
    })
    .catch((error) => {
      if (healthCheckGeneration !== backendHealthCheckGeneration) {
        appendDesktopLog('backend-health-check-superseded', error instanceof Error ? error.message : String(error));
        return;
      }

      if (backendListeningDetected || backendOutputBuffer.some((line) => backendOutputIndicatesListening(line))) {
        markBackendListeningDetected('health-check-timeout-with-listening-log');
        scheduleBackendRecoveryProbe();
        return;
      }

      appendDesktopLog('Backend health check failed', error instanceof Error ? error.message : String(error));
      backendState = {
        ...backendState,
        status: 'error',
      };
      mainWindow?.webContents.send('desktop:backend-status', getDesktopState());
      if (app.isPackaged && !backendRestartInProgress) {
        renderBackendFailurePage('backend-health-check-failed', error instanceof Error ? error.message : String(error));
        scheduleBackendRecoveryProbe();
      }
    });
}

function attachBackendProcessHandlers(child, healthCheckGeneration) {
  child.stdout?.on('data', (chunk) => {
    const text = chunk.toString();
    appendBackendOutput('stdout', text);
    if (backendOutputIndicatesListening(text)) {
      markBackendListeningDetected(`stdout:${getBackendHealthUrl()}`);
    }
  });

  child.stderr?.on('data', (chunk) => {
    const text = chunk.toString();
    appendBackendOutput('stderr', text);
    if (/Native SQLite module requires rebuild|NODE_MODULE_VERSION|was compiled against/i.test(text)) {
      appendDesktopLog(
        'backend-sqlite-native-mismatch',
        'Native SQLite module requires rebuild. Run: npm run rebuild:native',
      );
    }
    if (/EADDRINUSE|address already in use/i.test(text)) {
      appendDesktopLog('backend-port-in-use', text.trim().replace(/\s+/g, ' ').slice(0, 240));
      void recoverBackendPortConflict(child);
    }
    if (backendOutputIndicatesListening(text)) {
      markBackendListeningDetected(`stderr:${getBackendHealthUrl()}`);
    }
  });

  child.on('error', (error) => {
    if (backendProcess !== child) {
      return;
    }

    appendDesktopLog('Backend process error', error instanceof Error ? error.stack || error.message : String(error));
    if (app.isPackaged && !backendRestartInProgress) {
      renderBackendFailurePage('backend-process-error', error instanceof Error ? error.message : String(error));
    }
  });

  child.on('exit', (code, signal) => {
    const isCurrentProcess = backendProcess === child;
    appendDesktopLog(
      'Backend process exited',
      `pid=${child.pid ?? 'unknown'} code=${code} signal=${signal} current=${isCurrentProcess} restarting=${backendRestartInProgress}`,
    );

    if (!isCurrentProcess) {
      appendDesktopLog(
        'backend-process-exit-ignored-during-restart',
        `pid=${child.pid ?? 'unknown'} code=${code} signal=${signal}`,
      );
      return;
    }

    backendExitDetails = {
      code,
      signal,
    };
    const sawPortConflict = backendOutputBuffer.some((line) => /EADDRINUSE|address already in use/i.test(line));
    const failedDuringStartup = backendState.status !== 'ready' && !backendListeningDetected;
    backendState = {
      status: 'stopped',
      startedAt: backendState.startedAt,
      lastExitAt: new Date().toISOString(),
      pid: null,
    };
    backendProcess = null;
    mainWindow?.webContents.send('desktop:backend-status', getDesktopState());

    if (backendRestartInProgress || backendPortRecoveryInProgress) {
      appendDesktopLog(
        'backend-process-exit-ignored-during-restart',
        `pid=${child.pid ?? 'unknown'} code=${code} signal=${signal}`,
      );
      return;
    }

    if (sawPortConflict) {
      appendDesktopLog(
        'backend-process-exit-ignored-during-restart',
        `pid=${child.pid ?? 'unknown'} code=${code} signal=${signal} reason=port-conflict`,
      );
      void recoverBackendPortConflict(child);
      return;
    }

    if (app.isPackaged && failedDuringStartup) {
      void probeBackendHealthOnce().then((health) => {
        if (health.ok) {
          void adoptExistingHealthyBackendIfAvailable();
          return;
        }

        renderBackendFailurePage(
          'backend-process-exit',
          `The backend process exited before it became healthy. Exit code: ${code}, signal: ${signal}`,
        );
      });
    }
  });
}

function stopBackend() {
  clearBackendRecoveryTimeout();
  backendHealthCheckGeneration += 1;

  if (!backendProcess) {
    backendState = {
      status: 'stopped',
      startedAt: backendState.startedAt,
      lastExitAt: new Date().toISOString(),
      pid: null,
    };
    return Promise.resolve();
  }

  const child = backendProcess;
  backendState = {
    status: 'stopped',
    startedAt: backendState.startedAt,
    lastExitAt: backendState.lastExitAt,
    pid: child.pid ?? null,
  };

  return new Promise((resolve) => {
    let settled = false;

    const finish = () => {
      if (settled) {
        return;
      }

      settled = true;
      if (backendProcess === child) {
        backendProcess = null;
      }
      backendState = {
        status: 'stopped',
        startedAt: backendState.startedAt,
        lastExitAt: new Date().toISOString(),
        pid: null,
      };
      resolve();
    };

    const forceKillTimer = setTimeout(() => {
      if (backendProcess === child) {
        appendDesktopLog('Backend stop timeout reached', `pid=${child.pid ?? 'unknown'} forcing SIGKILL`);
        child.kill('SIGKILL');
      }
      finish();
    }, BACKEND_STOP_TIMEOUT_MS);

    child.once('exit', () => {
      clearTimeout(forceKillTimer);
      finish();
    });

    child.kill();
  });
}

async function restartBackend() {
  appendDesktopLog('backend-restart-requested', getBackendHealthUrl());
  backendRestartInProgress = true;
  backendState = {
    ...backendState,
    status: 'starting',
    pid: null,
  };
  mainWindow?.webContents.send('desktop:backend-status', getDesktopState());

  if (app.isPackaged) {
    renderBackendRestartingPage();
  }

  try {
    await stopBackend();
    if (await adoptExistingHealthyBackendIfAvailable()) {
      appendDesktopLog('backend-restart-complete', `${getBackendHealthUrl()} reused-existing`);
      if (isShowingFrontendFallback) {
        reloadFrontendAfterBackendRecovery(getSetupRecoveryRouteHash());
      }
      return getDesktopState();
    }
    await startBackend();
    if (backendState.status === 'ready' && !backendProcess) {
      appendDesktopLog('backend-restart-complete', `${getBackendHealthUrl()} reused-existing`);
      if (isShowingFrontendFallback) {
        reloadFrontendAfterBackendRecovery(getSetupRecoveryRouteHash());
      }
      return getDesktopState();
    }
    await waitForBackendReady(RESTART_BACKEND_HEALTH_TIMEOUT_MS);
    appendDesktopLog('setup-storage-restart-complete', getBackendHealthUrl());
    appendDesktopLog('backend-restart-complete', getBackendHealthUrl());
    if (isShowingFrontendFallback) {
      reloadFrontendAfterBackendRecovery(getSetupRecoveryRouteHash());
    }
    return getDesktopState();
  } catch (error) {
    appendDesktopLog('backend-restart-failed', error instanceof Error ? error.message : String(error));
    throw error;
  } finally {
    backendRestartInProgress = false;
  }
}

async function createMainWindow() {
  isShowingFrontendFallback = false;
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 980,
    minWidth: 1200,
    minHeight: 800,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.webContents.on('before-input-event', (_event, input) => {
    const key = String(input.key || '').toLowerCase();
    if (input.type === 'keyDown' && (input.control || input.meta) && input.shift && key === 'i') {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || isShowingFrontendFallback) {
      return;
    }

    const failureMessage = `${errorDescription} (code ${errorCode})`;
    frontendState.lastError = failureMessage;
    appendDesktopLog('Frontend did-fail-load', `url=${validatedURL} error=${failureMessage}`);
    openDebugToolsIfNeeded('frontend-load-failed');
    renderFrontendFailurePage(`did-fail-load for ${validatedURL}`, failureMessage);
  });

  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    if (!targetUrl.startsWith('patrol-recovery://')) {
      return;
    }

    event.preventDefault();
    const action = targetUrl.slice('patrol-recovery://'.length).split(/[/?#]/)[0];
    void handlePatrolRecoveryAction(action);
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    if (isShowingFrontendFallback) {
      return;
    }

    const message = `Renderer exited: ${details.reason}`;
    frontendState.lastError = message;
    appendDesktopLog('Renderer process gone', JSON.stringify(details));
    openDebugToolsIfNeeded('frontend-load-failed');
    renderFrontendFailurePage('render-process-gone', message);
  });

  mainWindow.webContents.on('did-finish-load', () => {
    appendDesktopLog('Frontend finished load', mainWindow?.webContents.getURL() ?? 'unknown');
  });

  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    const safeMessage = `${message}`.trim();
    if (!safeMessage) {
      return;
    }

    appendDesktopLog('Renderer console', `level=${level} source=${sourceId}:${line} message=${safeMessage}`);
  });

  mainWindow.on('unresponsive', () => {
    appendDesktopLog('Main window became unresponsive');
  });

  mainWindow.once('ready-to-show', () => {
    appendDesktopLog('Main window ready to show');
    mainWindow?.show();
  });

  if (!app.isPackaged && process.env.DESKTOP_DEV === 'true') {
    frontendState = {
      target: DEFAULT_WEB_URL,
      source: 'vite-dev-server',
      lastError: null,
    };
    appendDesktopLog('Loading frontend from dev server', DEFAULT_WEB_URL);
    await mainWindow.loadURL(DEFAULT_WEB_URL);
  } else {
    const frontendEntryPoint = getResolvedFrontendEntryPoint();
    const frontendUrl = pathToFileURL(frontendEntryPoint).toString();
    frontendState = {
      target: frontendEntryPoint,
      source: 'packaged-file',
      lastError: null,
    };
    appendDesktopLog('Loading frontend from file', `${frontendEntryPoint} exists=${fs.existsSync(frontendEntryPoint)}`);

    try {
      await mainWindow.loadURL(frontendUrl);
    } catch (error) {
      const message = error instanceof Error ? error.stack || error.message : String(error);
      frontendState.lastError = message;
      appendDesktopLog('Frontend load threw before render', message);
      openDebugToolsIfNeeded('frontend-load-failed');
      renderFrontendFailurePage(`loadURL failed for ${frontendUrl}`, message);
    }
  }
}

if (handleSquirrelEvent()) {
  // Squirrel install/update/uninstall event handled.
} else if (isBackendEntryProcess) {
  runPackagedBackendEntry();
} else {
  app.whenReady()
    .then(async () => {
      if (typeof app.setAboutPanelOptions === 'function') {
        app.setAboutPanelOptions({
          applicationName: PRODUCT_METADATA.productName,
          applicationVersion: PRODUCT_METADATA.version,
          version: PRODUCT_METADATA.buildId,
          copyright: PRODUCT_METADATA.copyright,
          credits: `${PRODUCT_METADATA.companyName}\nSupport: ${PRODUCT_METADATA.supportEmail}`,
        });
      }

      appendDesktopLog(
        'Electron app ready',
        `packaged=${app.isPackaged} appPath=${app.getAppPath()} resourcesPath=${process.resourcesPath}`,
      );
      const startupConfig = readWorkspaceConfig();
      appendDesktopLog('SETUP_COMPLETED_LOADED', startupConfig.setupCompleted === true ? 'true' : 'false');
      updateLoginItemSettings();
      await startBackend();
      if (isBackendSmokeOnlyMode()) {
        appendDesktopLog('Backend smoke mode enabled', `port=${getBackendPort()}`);
        return;
      }

      await createMainWindow();

      app.on('activate', async () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          await createMainWindow();
        }
      });
    })
    .catch((error) => {
      appendDesktopLog('Electron startup failed', error instanceof Error ? error.stack || error.message : String(error));
      throw error;
    });

  app.on('window-all-closed', () => {
    appendDesktopLog('All windows closed');
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('before-quit', () => {
    appendDesktopLog('Electron before-quit');
    stopBackend();
  });

  ipcMain.handle('desktop:get-state', async () => getDesktopState());
  ipcMain.handle('desktop:choose-storage-path', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
    });

    if (result.canceled || !result.filePaths[0]) {
      return null;
    }

    return result.filePaths[0];
  });
  ipcMain.handle('desktop:save-config', async (_event, partialConfig) => {
    const currentConfig = readWorkspaceConfig();
    const nextConfig = {
      ...currentConfig,
      ...partialConfig,
    };

    if (Object.prototype.hasOwnProperty.call(partialConfig, 'storageRootPath')) {
      const nextPath = validateStorageRootPath(partialConfig.storageRootPath);
      const currentPath = currentConfig.storageRootPath
        ? resolveStoragePathForCompare(currentConfig.storageRootPath)
        : '';
      nextConfig.storageRootPath = nextPath;
      if (currentPath && currentPath === nextPath) {
        appendDesktopLog('setup-storage-save-skipped-already-applied', `path=${nextPath}`);
      } else {
        appendDesktopLog('setup-storage-save-requested', `path=${nextPath}`);
        appendDesktopLog('storage-folder-applied', `path=${nextPath}`);
      }
    }

    if (Object.prototype.hasOwnProperty.call(partialConfig, 'autoStartCollector')) {
      nextConfig.autoStartCollector = partialConfig.autoStartCollector === true;
    }

    if (Object.prototype.hasOwnProperty.call(partialConfig, 'autoLaunchApp')) {
      nextConfig.autoLaunchApp = partialConfig.autoLaunchApp === true;
    }

    if (Object.prototype.hasOwnProperty.call(partialConfig, 'whatsappAllowFromMe')) {
      nextConfig.whatsappAllowFromMe = partialConfig.whatsappAllowFromMe === true;
    }

    writeWorkspaceConfig(nextConfig);
    updateLoginItemSettings();

    if (configChangeRequiresBackendRestart(partialConfig, currentConfig) && backendState.status !== 'stopped') {
      await restartBackend();
    }

    return getDesktopState();
  });
  ipcMain.handle('desktop:postgres-check', async (_event, partialConfig) => checkPostgres(partialConfig));
  ipcMain.handle('desktop:postgres-provision', async (_event, partialConfig) => provisionPostgres(partialConfig));
  ipcMain.handle('desktop:restart-backend', async () => restartBackend());
  ipcMain.handle('desktop:start-backend', async () => {
    await startBackend();
    if (backendState.status !== 'ready' || backendProcess) {
      await waitForBackendReady(RESTART_BACKEND_HEALTH_TIMEOUT_MS);
    }
    return getDesktopState();
  });
  ipcMain.handle('desktop:stop-backend', async () => {
    stopBackend();
    return getDesktopState();
  });
  ipcMain.handle('desktop:open-external', async (_event, targetUrl) => {
    await shell.openExternal(targetUrl);
    return true;
  });
  ipcMain.handle('desktop:open-path', async (_event, targetPath) => {
    return shell.openPath(targetPath);
  });
  ipcMain.handle('desktop:secure-store-get', async (_event, key) => readSecureStoreValue(key));
  ipcMain.handle('desktop:secure-store-set', async (_event, key, value) => {
    writeSecureStoreValue(key, String(value ?? ''));
    return true;
  });
  ipcMain.handle('desktop:secure-store-clear', async (_event, key) => {
    clearSecureStoreValue(key);
    return true;
  });
}
