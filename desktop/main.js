const { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } = require('electron');
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const {
  DEFAULT_BACKEND_PORT,
  getApiBaseUrl: formatApiBaseUrl,
  getApiBaseUrlArgument,
  getBackendProcessArguments,
  isExplicitCertificationLaunch,
  normalizeBackendPort,
} = require('./runtime-contract');
const {
  BACKEND_CHALLENGE_HEADER,
  BACKEND_IDENTITY_PATH,
  parseReadyAnnouncement,
  verifyIdentityResponse,
} = require('./backend-identity');
const { createDesktopProcessLifecycle } = require('./process-lifecycle');
const { pathToFileURL } = require('url');
const { Client } = require('pg');
const {
  assertTrustedIpcSender,
  isTrustedRendererNavigation,
  normalizeIanaTimeZone,
  productionDevToolsAllowed,
  sanitizeDesktopConfigPatch,
  sanitizePostgresConfig,
  validateExternalUrl,
  validateOpenPath,
  validateSecureStoreKey,
  validateSecureStoreValue,
} = require('./security-policy');
const {
  createPatrolSafeBackup,
  prepareSqliteDatabase,
  restorePatrolSafeBackup,
  verifyPatrolSafeBackup,
} = require('./data-durability');

const packageMetadata = require('../package.json');
const {
  getBackendEntryCandidates,
  getFrontendEntryCandidates,
  getPackagedAppRoot,
  getCanonicalBackendEntryPath,
} = require('./packaged-runtime-paths');

const PRODUCT_METADATA = {
  productName: packageMetadata.displayName || packageMetadata.productName || 'PatrolSafe by S4',
  version: packageMetadata.version || '1.0.0',
  // Prefer human-readable display build; never show windowsBuild as the About build label.
  buildId:
    packageMetadata.buildId ||
    packageMetadata.displayBuild ||
    '2026.07.20.1',
  displayBuild:
    packageMetadata.displayBuild ||
    packageMetadata.buildId ||
    '2026.07.20.1',
  copyright:
    packageMetadata.copyright || '© 2026 Vesoft Services Limited. All rights reserved.',
  companyName: packageMetadata.companyName || 'Vesoft Services Limited',
  supportEmail: packageMetadata.supportEmail || 'support@sfour.co.uk',
};

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
let backendStopOperation = null;
const processLifecycle = createDesktopProcessLifecycle();
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
let desktopApiToken = null;
let desktopRecoveryAuthority = null;
let backendEndpoint = null;
let backendIdentityVerified = false;
let backendExpectedSessionId = null;
let backendReadyAnnouncement = null;
let backendReadyAnnouncementResolve = null;
let backendReadyAnnouncementReject = null;
let backendStdoutRemainder = '';
let unresolvedMappingConflictCount = 0;
let quitCleanupStarted = false;
let quitCleanupComplete = false;

function notifyDesktopState() {
  return processLifecycle.notifyRenderer(mainWindow, 'desktop:backend-status', getDesktopState());
}

const DEFAULT_BACKEND_HEALTH_TIMEOUT_MS = 30_000;
const MIN_PACKAGED_BACKEND_HEALTH_TIMEOUT_MS = 90_000;
const PACKAGED_BACKEND_HEALTH_TIMEOUT_MS = 180_000;
const RESTART_BACKEND_HEALTH_TIMEOUT_MS = 90_000;
const BACKEND_LISTENING_GRACE_TIMEOUT_MS = 30_000;
const BACKEND_STOP_TIMEOUT_MS = 30_000;
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
      // Linking remains deliberate; an already-enabled monitoring preference resumes on launch.
      autoStartCollector: workspaceConfig.setupCompleted === true && workspaceConfig.autoStartCollector === true,
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
    autoStartCollector: workspaceConfig.setupCompleted === true && workspaceConfig.autoStartCollector === true,
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
  return productionDevToolsAllowed({
    packaged: app.isPackaged,
    appDebug: process.env.APP_DEBUG === 'true',
    supportMode: process.env.PATROLSAFE_SUPPORT_MODE === 'true',
  });
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

function ensureDesktopBoundarySecret(fileName) {
  const secretPath = path.join(app.getPath('userData'), fileName);
  try {
    if (fs.existsSync(secretPath)) {
      const existing = fs.readFileSync(secretPath, 'utf8').trim();
      if (existing.length >= 32) return existing;
    }
  } catch (error) {
    appendDesktopLog('desktop-boundary-secret-read-failed', error instanceof Error ? error.message : String(error));
  }

  const secret = crypto.randomBytes(48).toString('base64url');
  fs.mkdirSync(path.dirname(secretPath), { recursive: true });
  fs.writeFileSync(secretPath, secret, { encoding: 'utf8', mode: 0o600 });
  return secret;
}

function getDesktopApiToken() {
  desktopApiToken ||= ensureDesktopBoundarySecret('desktop-api-token.txt');
  return desktopApiToken;
}

function getDesktopRecoveryAuthority() {
  desktopRecoveryAuthority ||= ensureDesktopBoundarySecret('desktop-recovery-authority.txt');
  return desktopRecoveryAuthority;
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
  setupStage: 'company',
  autoLaunchApp: false,
  autoStartCollector: false,
  whatsappAllowFromMe: false,
  whatsappBrowser: 'auto',
};

const VALID_SETUP_STAGES = new Set(['company', 'storage', 'whatsapp', 'site-setup', 'complete']);

function normalizeSetupStage(value, setupCompleted = false) {
  if (setupCompleted) {
    return 'complete';
  }
  return typeof value === 'string' && VALID_SETUP_STAGES.has(value) ? value : 'company';
}

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
      setupStage: normalizeSetupStage(parsed.setupStage, normalizeSetupCompleted(parsed.setupCompleted)),
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
    'whatsappBrowser',
    'whatsappHeadless',
    'appTimeZone',
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

  merged.setupStage = normalizeSetupStage(nextConfig.setupStage ?? current.setupStage, merged.setupCompleted);

  writeWorkspaceConfigAtomic(configPath, merged);
  if (merged.setupCompleted === true) {
    appendDesktopLog('SETUP_COMPLETED_SAVED', 'true');
  }
}

function writeWorkspaceConfigAtomic(configPath, config) {
  const temporaryPath = `${configPath}.tmp-${process.pid}-${Date.now()}`;
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  try {
    fs.writeFileSync(temporaryPath, JSON.stringify(config, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporaryPath, configPath);
  } catch (error) {
    fs.rmSync(temporaryPath, { force: true });
    throw error;
  }
}

function migrateLegacyWorkspaceTimeZone() {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) return false;
  const config = readWorkspaceConfig();
  if (config.appTimeZone !== undefined) {
    const normalized = normalizeIanaTimeZone(config.appTimeZone);
    if (!normalized) {
      throw new Error('Workspace configuration contains an invalid time zone. Contact PatrolSafe support.');
    }
    if (normalized !== config.appTimeZone) {
      writeWorkspaceConfig({ appTimeZone: normalized });
    }
    return false;
  }
  if (config.setupCompleted !== true) return false;

  writeWorkspaceConfig({ appTimeZone: 'Europe/London' });
  appendDesktopLog('WORKSPACE_TIMEZONE_MIGRATED', 'Europe/London source=legacy-v1-compatibility');
  return true;
}

function getBackendPort() {
  if (backendEndpoint?.port) {
    return backendEndpoint.port;
  }
  const config = readWorkspaceConfig();
  return normalizeBackendPort(config.backendPort);
}

function getApiBaseUrl() {
  if (isProductionDesktopMode() && !backendIdentityVerified) {
    return null;
  }
  if (backendEndpoint?.port) {
    return `http://127.0.0.1:${backendEndpoint.port}`;
  }
  return formatApiBaseUrl(getBackendPort());
}

function getBackendHealthUrl() {
  const apiBaseUrl = getApiBaseUrl();
  return apiBaseUrl ? `${apiBaseUrl}${BACKEND_HEALTH_PATH}` : null;
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

function resetBackendIdentityState() {
  backendEndpoint = null;
  backendIdentityVerified = false;
  backendExpectedSessionId = null;
  backendReadyAnnouncement = null;
  backendReadyAnnouncementResolve = null;
  backendReadyAnnouncementReject = null;
  backendStdoutRemainder = '';
}

function createBackendAnnouncementWaiter(expectedSessionId) {
  backendExpectedSessionId = expectedSessionId;
  backendReadyAnnouncement = new Promise((resolve, reject) => {
    backendReadyAnnouncementResolve = resolve;
    backendReadyAnnouncementReject = reject;
  });
  return backendReadyAnnouncement;
}

function consumeBackendStdoutLines(text, child) {
  backendStdoutRemainder += String(text || '');
  const lines = backendStdoutRemainder.split(/\r?\n/);
  backendStdoutRemainder = lines.pop() || '';

  for (const line of lines) {
    const announcement = parseReadyAnnouncement(line);
    if (!announcement) continue;

    if (
      announcement.processId !== child.pid ||
      announcement.sessionId !== backendExpectedSessionId ||
      announcement.host !== '127.0.0.1'
    ) {
      appendDesktopLog('backend-identity-announcement-rejected', 'reason=spawn-identity-mismatch');
      backendReadyAnnouncementReject?.(new Error('Spawned backend identity announcement did not match'));
      continue;
    }

    appendDesktopLog(
      'backend-endpoint-allocated',
      `host=127.0.0.1 port=${announcement.port} pid=${announcement.processId}`,
    );
    backendReadyAnnouncementResolve?.(announcement);
    backendReadyAnnouncementResolve = null;
    backendReadyAnnouncementReject = null;
  }
}

function requestBackendIdentity(endpoint, child, sessionId, timeoutMs = 5_000) {
  const challenge = crypto.randomBytes(32).toString('hex');
  const token = getDesktopApiToken();

  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: '127.0.0.1',
        port: endpoint.port,
        path: BACKEND_IDENTITY_PATH,
        method: 'GET',
        headers: {
          'x-patrolsafe-desktop-token': token,
          [BACKEND_CHALLENGE_HEADER]: challenge,
        },
      },
      (response) => {
        let body = '';
        response.on('data', (chunk) => {
          body += chunk.toString();
        });
        response.on('end', () => {
          if (response.statusCode !== 200) {
            reject(new Error(`Spawned backend identity check returned ${response.statusCode}`));
            return;
          }

          let payload;
          try {
            payload = JSON.parse(body);
          } catch {
            reject(new Error('Spawned backend identity response was invalid'));
            return;
          }

          const valid = verifyIdentityResponse(token, payload, {
            appVersion: PRODUCT_METADATA.version,
            buildId: PRODUCT_METADATA.displayBuild || PRODUCT_METADATA.buildId,
            processId: child.pid,
            sessionId,
            challenge,
          });
          if (!valid) {
            reject(new Error('Spawned backend identity verification failed'));
            return;
          }
          resolve(true);
        });
      },
    );

    request.on('error', reject);
    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error('Spawned backend identity check timed out'));
    });
    request.end();
  });
}

function confirmBackendRuntimeVerified(endpoint, timeoutMs = 5_000) {
  const token = getDesktopApiToken();
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: '127.0.0.1',
        port: endpoint.port,
        path: '/desktop/bootstrap/runtime-verified',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': '0',
          'x-patrolsafe-desktop-token': token,
        },
      },
      (response) => {
        response.resume();
        response.on('end', () => {
          if (response.statusCode === 201 || response.statusCode === 200) {
            resolve(true);
            return;
          }
          reject(new Error(`Spawned backend runtime activation returned ${response.statusCode}`));
        });
      },
    );
    request.on('error', reject);
    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error('Spawned backend runtime activation timed out'));
    });
    request.end();
  });
}

async function waitForSpawnedBackendIdentity(child, sessionId, timeoutMs) {
  const announcement = await Promise.race([
    backendReadyAnnouncement,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Spawned backend did not announce a private endpoint in time')), timeoutMs),
    ),
  ]);

  await requestBackendIdentity(announcement, child, sessionId);
  await confirmBackendRuntimeVerified(announcement);
  backendEndpoint = { host: '127.0.0.1', port: announcement.port };
  backendIdentityVerified = true;
  markBackendListeningDetected('authenticated-child-identity');
  appendDesktopLog(
    'backend-identity-verified',
    `pid=${child.pid ?? 'unknown'} version=${PRODUCT_METADATA.version} build=${PRODUCT_METADATA.displayBuild || PRODUCT_METADATA.buildId}`,
  );
  return true;
}

function probeBackendHealthOnce(timeoutMs = 4_000) {
  const healthUrl = getBackendHealthUrl();

  if (!healthUrl) {
    return Promise.resolve({ ok: false, statusCode: null, healthUrl: null });
  }

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
  notifyDesktopState();
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
  const testTimeoutMs = Number(process.env.PATROLSAFE_TEST_BACKEND_TIMEOUT_MS);
  if (
    process.env.PATROLSAFE_STARTUP_TEST_MODE === 'true' &&
    Number.isFinite(testTimeoutMs) &&
    testTimeoutMs >= 1_000
  ) {
    return Math.min(testTimeoutMs, 240_000);
  }

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
    migration: {
      unresolvedMappingConflicts: unresolvedMappingConflictCount,
    },
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

  if (shouldOpenDebugTools()) {
    appendDesktopLog('Opening DevTools', `reason=${reason}`);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

function renderStartupFailurePage(title, reason, errorMessage) {
  if (!mainWindow || mainWindow.isDestroyed() || isShowingFrontendFallback) {
    return;
  }

  isShowingFrontendFallback = true;
  if (isProductionDesktopMode()) {
    const safeHtml = `
      <!doctype html>
      <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>PatrolSafe could not start</title>
          <style>
            body { margin: 0; font-family: "Segoe UI", Arial, sans-serif; background: #f4f6f8; color: #182430; }
            .card { max-width: 680px; margin: 64px auto; padding: 32px; background: #fff; border: 1px solid #d8dee6; border-radius: 16px; box-shadow: 0 12px 30px rgba(24,36,48,.08); }
            h1 { margin: 0 0 12px; font-size: 28px; } p { line-height: 1.55; }
            .detail { margin-top: 20px; padding: 16px; background: #f8fafc; border-radius: 12px; }
          </style>
        </head>
        <body><main class="card">
          <h1>${escapeHtml(title)}</h1>
          <p>${escapeHtml(errorMessage || 'PatrolSafe could not securely start its local service.')}</p>
          <p>Close PatrolSafe and try again. If the problem continues, contact ${escapeHtml(PRODUCT_METADATA.supportEmail)}.</p>
          <div class="detail">
            <strong>Support reference</strong>
            <p>${escapeHtml(reason)} · ${escapeHtml(PRODUCT_METADATA.version)} · build ${escapeHtml(PRODUCT_METADATA.displayBuild || PRODUCT_METADATA.buildId)}</p>
            <p>Startup stage: ${backendProcess ? 'local service started; secure readiness incomplete' : 'local service process unavailable'}</p>
          </div>
        </main></body>
      </html>`;
    mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(safeHtml)}`).catch(() => undefined);
    mainWindow.show();
    return;
  }
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
        <title>PatrolSafe by S4 - Frontend Load Failed</title>
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
                <code>${escapeHtml(`${PRODUCT_METADATA.productName} ${PRODUCT_METADATA.version} (build ${PRODUCT_METADATA.displayBuild || PRODUCT_METADATA.buildId})`)}</code>
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
    'PatrolSafe could not open the desktop screen',
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
    'PatrolSafe could not start the local service',
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
        <title>PatrolSafe by S4 - Restarting</title>
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
            <p id="status-line">PatrolSafe is applying your setup changes and restarting the local service on port ${getBackendPort()}.</p>
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

function authorizeAdminRecovery(token) {
  const payload = JSON.stringify({ token });
  const target = new URL('/desktop/bootstrap/recovery/authorize', getApiBaseUrl());
  return new Promise((resolve, reject) => {
    const request = http.request(
      target,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'x-patrolsafe-desktop-token': getDesktopApiToken(),
          'x-patrolsafe-recovery-authority': getDesktopRecoveryAuthority(),
        },
      },
      (response) => {
        response.resume();
        response.on('end', () => {
          if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
            resolve(true);
          } else {
            reject(new Error(`Recovery authorization failed with status ${response.statusCode ?? 'unknown'}.`));
          }
        });
      },
    );
    request.setTimeout(10_000, () => request.destroy(new Error('Recovery authorization timed out.')));
    request.on('error', reject);
    request.end(payload);
  });
}

async function beginAdminRecovery() {
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons: ['Cancel', 'Authorize password reset'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
    title: 'PatrolSafe account recovery',
    message: 'Authorize a one-time local administrator password reset?',
    detail: 'This authorization expires in two minutes and works once on this workstation.',
  });
  if (result.response !== 1) return null;

  const token = crypto.randomBytes(48).toString('base64url');
  await authorizeAdminRecovery(token);
  appendDesktopLog('desktop-admin-recovery-authorized', 'singleUse=true ttlSeconds=120');
  return token;
}

function requestAuthenticatedDesktopUser(accessToken) {
  const target = new URL('/auth/me', getApiBaseUrl());
  return new Promise((resolve, reject) => {
    const request = http.request(
      target,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'x-patrolsafe-desktop-token': getDesktopApiToken(),
        },
      },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.on('end', () => {
          if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error('Administrator sign-in is required for backup and restore.'));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch {
            reject(new Error('PatrolSafe could not verify the current administrator session.'));
          }
        });
      },
    );
    request.setTimeout(10_000, () => request.destroy(new Error('Administrator verification timed out.')));
    request.on('error', reject);
    request.end();
  });
}

async function assertDataProtectionAdministrator(options = {}) {
  const rawSession = readSecureStoreValue('desktop-auth-session');
  if (!rawSession) throw new Error('Sign in as a company administrator before backing up or restoring data.');
  let session;
  try {
    session = JSON.parse(rawSession);
  } catch {
    throw new Error('The saved administrator session is unavailable. Sign in again.');
  }
  const role = String(session?.user?.role || '').toUpperCase();
  if (!['ADMIN', 'COMPANY_ADMIN'].includes(role) || !String(session?.accessToken || '').trim()) {
    throw new Error('Company administrator access is required for backup and restore.');
  }
  let verified;
  try {
    verified = await requestAuthenticatedDesktopUser(String(session.accessToken));
  } catch (error) {
    // A corrupt database can prevent the backend from starting. Restore remains
    // available only from the trusted Electron frame, with a DPAPI-protected
    // previously authenticated administrator session and native confirmation.
    if (options.allowBackendUnavailable !== true || !['stopped', 'error'].includes(backendState.status)) {
      throw error;
    }
    appendDesktopLog('DATA_RESTORE_OFFLINE_ADMIN_VERIFICATION', `backend=${backendState.status}`);
    return session.user;
  }
  const verifiedRole = String(verified?.role || '').toUpperCase();
  if (!['ADMIN', 'COMPANY_ADMIN'].includes(verifiedRole)) {
    throw new Error('Company administrator access is required for backup and restore.');
  }
  return verified;
}

function getDataProtectionPaths() {
  const runtimeValues = getConfiguredRuntimeValues();
  return {
    databasePath: runtimeValues.sqliteDbPath,
    evidenceRoot: runtimeValues.storageRootPath,
    configPath: getConfigPath(),
    userDataRoot: app.getPath('userData'),
  };
}

function assertBackupDestinationSafe(destinationParent, evidenceRoot, userDataRoot) {
  const destination = path.resolve(destinationParent);
  const evidence = path.resolve(evidenceRoot);
  const userData = path.resolve(userDataRoot);
  if (
    isPathInsideDirectory(evidence, destination)
    || isPathInsideDirectory(destination, evidence)
    || isPathInsideDirectory(userData, destination)
    || isPathInsideDirectory(destination, userData)
  ) {
    throw new Error('Choose a backup location outside PatrolSafe active data folders.');
  }
  return destination;
}

async function createCustomerBackup(destinationParent) {
  await assertDataProtectionAdministrator();
  const paths = getDataProtectionPaths();
  const safeDestination = assertBackupDestinationSafe(destinationParent, paths.evidenceRoot, paths.userDataRoot);
  const confirmation = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    buttons: ['Cancel', 'Create backup'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
    title: 'Backup PatrolSafe data',
    message: 'Create a verified PatrolSafe data backup?',
    detail: 'Monitoring pauses briefly while PatrolSafe checkpoints the database and copies evidence. No WhatsApp logout or unlink is performed.',
  });
  if (confirmation.response !== 1) return null;
  await stopBackend();
  try {
    const result = await createPatrolSafeBackup({
      ...paths,
      destinationParent: safeDestination,
      appVersion: PRODUCT_METADATA.version,
      buildId: PRODUCT_METADATA.displayBuild || PRODUCT_METADATA.buildId,
    });
    appendDesktopLog(
      'DATA_BACKUP_COMPLETE',
      `path=${result.backupPath} schemaVersion=${result.manifest.schemaVersion} evidenceFiles=${result.manifest.evidence.fileCount}`,
    );
    return {
      backupPath: result.backupPath,
      createdAt: result.manifest.createdAt,
      schemaVersion: result.manifest.schemaVersion,
      evidenceFileCount: result.manifest.evidence.fileCount,
      totalBytes: result.manifest.evidence.totalBytes,
      localAuthPortability: result.manifest.sameMachine.portability,
    };
  } finally {
    await startBackend();
    await waitForBackendReady(RESTART_BACKEND_HEALTH_TIMEOUT_MS);
  }
}

async function restoreCustomerBackup(backupRoot) {
  await assertDataProtectionAdministrator({ allowBackendUnavailable: true });
  const paths = getDataProtectionPaths();
  const verification = await verifyPatrolSafeBackup(path.resolve(backupRoot));
  const confirmation = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons: ['Cancel', 'Restore backup'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
    title: 'Restore PatrolSafe backup',
    message: 'Restore this verified PatrolSafe backup?',
    detail: 'Current database, evidence and configuration will be replaced after a recovery snapshot is created. PatrolSafe will restart its local service when complete.',
  });
  if (confirmation.response !== 1) return null;
  await stopBackend();
  try {
    const recoveryParent = path.join(paths.userDataRoot, 'recovery-backups');
    let recovery = null;
    try {
      recovery = await createPatrolSafeBackup({
        ...paths,
        destinationParent: recoveryParent,
        appVersion: PRODUCT_METADATA.version,
        buildId: PRODUCT_METADATA.displayBuild || PRODUCT_METADATA.buildId,
      });
    } catch (error) {
      if (error?.code !== 'PATROLSAFE_DATABASE_CORRUPT') throw error;
      appendDesktopLog('DATA_RESTORE_RECOVERY_BACKUP_SKIPPED', 'reason=active-database-corrupt');
    }
    const result = await restorePatrolSafeBackup({ ...paths, backupRoot: path.resolve(backupRoot) });
    appendDesktopLog(
      'DATA_RESTORE_COMPLETE',
      `backup=${path.resolve(backupRoot)} recovery=${recovery?.backupPath || result.rollbackPath} sameMachine=${result.sameMachine} relinkRequired=${result.requiresWhatsAppRelink}`,
    );
    return {
      restored: true,
      sameMachine: result.sameMachine,
      requiresWhatsAppRelink: result.requiresWhatsAppRelink,
      recoveryBackupPath: recovery?.backupPath || result.rollbackPath,
      schemaVersion: verification.manifest.schemaVersion,
      evidenceFileCount: verification.evidenceFileCount,
    };
  } finally {
    await startBackend();
    await waitForBackendReady(RESTART_BACKEND_HEALTH_TIMEOUT_MS);
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
        notifyDesktopState();
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
        'PostgreSQL is working and the PatrolSafe site records are ready on this workstation.',
        'You can continue with setup or restart services if you recently changed settings.',
      );
      status.message = 'PostgreSQL is ready for the desktop workspace.';
    } else if (status.databaseExists) {
      setPostgresIssue(
        status,
        POSTGRES_ISSUE_CODES.MIGRATIONS_MISSING,
        'App tables missing',
        'The database exists, but PatrolSafe records are still missing or incomplete.',
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
        'The workspace database and PatrolSafe records were prepared successfully.',
        'You can continue with setup or restart services if you recently changed settings.',
      );
      status.message = 'PostgreSQL is ready and the patrol evidence schema has been prepared.';
    } else {
      setPostgresIssue(
        status,
        POSTGRES_ISSUE_CODES.MIGRATIONS_MISSING,
        'App tables missing',
        'The database was created, but PatrolSafe records still appear incomplete.',
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

  if (backendState.status === 'ready' && !backendProcess && !isProductionDesktopMode()) {
    appendDesktopLog('backend-start-skipped-existing-healthy', `port=${getBackendPort()}`);
    return;
  }

  clearBackendRecoveryTimeout();

  if (!isProductionDesktopMode()) {
    if (await adoptExistingHealthyBackendIfAvailable()) {
      return;
    }

    await releaseStaleBackendPortIfNeeded();
    if (backendState.status === 'ready' && !backendProcess) {
      return;
    }
  } else {
    resetBackendIdentityState();
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

  if (runtimeValues.dbType === 'sqlite') {
    try {
      const migration = prepareSqliteDatabase({
        databasePath: runtimeValues.sqliteDbPath,
        preUpgradeBackupRoot: path.join(getUserDataDataDirectory(), 'pre-upgrade-backups'),
        appVersion: PRODUCT_METADATA.version,
        buildId: PRODUCT_METADATA.displayBuild || PRODUCT_METADATA.buildId,
      });
      appendDesktopLog(
        'SQLITE_SCHEMA_READY',
        `version=${migration.schemaVersion} applied=${migration.applied.join(',') || 'none'} adopted=${migration.adopted} mappingConflictsPaused=${migration.mappingConflictsPaused || 0} preUpgradeBackup=${migration.preUpgradeBackup?.databaseBackupPath || 'none'}`,
      );
      unresolvedMappingConflictCount = migration.mappingConflictsUnresolved ?? migration.mappingConflictsPaused ?? 0;
      if (migration.mappingConflictsPaused > 0) {
        void dialog.showMessageBox({
          type: 'warning',
          title: 'Review WhatsApp group mappings',
          message: 'PatrolSafe paused conflicting group mappings during the data upgrade.',
          detail: `${migration.mappingConflictsPaused} ambiguous mappings were preserved but paused. Sign in as a company administrator and reactivate only the correct mapping for each group before monitoring it.`,
          buttons: ['OK'],
          defaultId: 0,
          noLink: true,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const backupPath = error?.preUpgradeBackup || 'none';
      appendDesktopLog('SQLITE_SCHEMA_STARTUP_BLOCKED', `error=${message} preUpgradeBackup=${backupPath}`);
      dialog.showErrorBox(
        'PatrolSafe data needs recovery',
        error?.code === 'PATROLSAFE_DATABASE_CORRUPT'
          ? 'The PatrolSafe database did not pass its integrity check. It has not been replaced or reset. Restore a verified PatrolSafe backup or contact support.'
          : 'PatrolSafe could not safely upgrade the local database. The application has stopped before opening customer data. A pre-upgrade backup was retained where possible.',
      );
      throw error;
    }
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
    writeWorkspaceConfigAtomic(desktopConfigPath, syncedConfig);
  }

  const env = applyLicensePublicKeyRuntimeEnv({
    ...process.env,
    PORT: isProductionDesktopMode() ? '0' : String(getBackendPort()),
    DESKTOP_CONFIG_PATH: desktopConfigPath,
    DB_TYPE: runtimeValues.dbType,
    SQLITE_DB_PATH: runtimeValues.sqliteDbPath,
    STORAGE_ROOT_PATH: runtimeValues.storageRootPath,
    WHATSAPP_SESSION_PATH: runtimeValues.whatsappSessionPath,
    WHATSAPP_AUTO_START: runtimeValues.autoStartCollector ? 'true' : 'false',
    APP_DEBUG: process.env.APP_DEBUG === 'true' ? 'true' : process.env.APP_DEBUG,
    JWT_SECRET: ensureDesktopJwtSecret(),
    PATROLSAFE_DESKTOP_API_TOKEN: getDesktopApiToken(),
    PATROLSAFE_DESKTOP_RECOVERY_AUTHORITY: getDesktopRecoveryAuthority(),
    PATROLSAFE_APP_VERSION: PRODUCT_METADATA.version,
    PATROLSAFE_BUILD_ID: PRODUCT_METADATA.displayBuild || PRODUCT_METADATA.buildId,
    JWT_REFRESH_EXPIRES_IN_DAYS: process.env.JWT_REFRESH_EXPIRES_IN_DAYS || '90',
  });
  const backendSessionId = isProductionDesktopMode() ? crypto.randomUUID() : null;
  if (backendSessionId) {
    env.PATROLSAFE_DESKTOP_BACKEND_SESSION = backendSessionId;
    createBackendAnnouncementWaiter(backendSessionId);
  }
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

  const useCompiledBackend = app.isPackaged || process.env.DESKTOP_DEV !== 'true' || isExplicitCertificationLaunch(env, process.argv);
  if (useCompiledBackend) {
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
      notifyDesktopState();
      throw new Error('Compiled backend entry file was not found. Contact PatrolSafe support.');
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
    const child = spawn(process.execPath, getBackendProcessArguments(entryPoint, env, process.argv), {
      cwd,
      env: packagedBackendEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
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
    const child = spawn(
      process.execPath,
      getBackendProcessArguments(nestCliPath, env, process.argv, ['start', '--watch', '--exec', process.execPath]),
      {
        cwd,
        env: devBackendEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );
    backendProcess = child;
    attachBackendProcessHandlers(child, healthCheckGeneration);
  }

  backendState = {
    status: 'starting',
    startedAt: new Date().toISOString(),
    lastExitAt: backendState.lastExitAt,
    pid: backendProcess.pid ?? null,
  };
  notifyDesktopState();

  const healthTimeoutMs = resolveBackendHealthTimeoutMs();
  try {
    if (isProductionDesktopMode()) {
      await waitForSpawnedBackendIdentity(backendProcess, backendSessionId, healthTimeoutMs);
    } else {
      await waitForBackendReady(healthTimeoutMs, healthCheckGeneration);
    }
    if (healthCheckGeneration !== backendHealthCheckGeneration) {
      throw new Error('Backend readiness check superseded');
    }

    clearBackendRecoveryTimeout();
    appendDesktopLog('backend-readiness-complete', `identity=${isProductionDesktopMode() ? 'verified' : 'development-health'} state=ready`);
    backendState = {
      ...backendState,
      status: 'ready',
      pid: backendProcess?.pid ?? backendState.pid,
    };
    notifyDesktopState();

    if (backendRestartInProgress && isShowingFrontendFallback) {
      reloadFrontendAfterBackendRecovery(getSetupRecoveryRouteHash());
    }
  } catch (error) {
    appendDesktopLog('Backend readiness failed', error instanceof Error ? error.message : String(error));
    if (backendProcess) {
      await stopBackend();
    }
    backendIdentityVerified = false;
    backendState = {
      ...backendState,
      status: 'error',
    };
    notifyDesktopState();
    throw error;
  }
}

function attachBackendProcessHandlers(child, healthCheckGeneration) {
  child.stdout?.on('data', (chunk) => {
    const text = chunk.toString();
    appendBackendOutput('stdout', text);
    if (isProductionDesktopMode()) {
      consumeBackendStdoutLines(text, child);
    }
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
    if (!isProductionDesktopMode() && /EADDRINUSE|address already in use/i.test(text)) {
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
    backendReadyAnnouncementReject?.(error);
    if (app.isPackaged && !backendRestartInProgress) {
      renderBackendFailurePage('backend-process-error', error instanceof Error ? error.message : String(error));
    }
  });

  child.on('exit', (code, signal) => {
    const exitDisposition = processLifecycle.classifyChildExit(child, backendProcess, {
      restarting: backendRestartInProgress,
      recoveringPort: backendPortRecoveryInProgress,
    });
    const isCurrentProcess = exitDisposition.current;
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
    backendIdentityVerified = false;
    backendReadyAnnouncementReject?.(new Error(`Spawned backend exited before readiness (code ${code})`));
    notifyDesktopState();

    if (exitDisposition.expected) {
      appendDesktopLog(
        'backend-process-exit-expected',
        `pid=${child.pid ?? 'unknown'} code=${code} signal=${signal} quitting=${processLifecycle.isQuitting()}`,
      );
      return;
    }

    if (sawPortConflict && !isProductionDesktopMode()) {
      appendDesktopLog(
        'backend-process-exit-ignored-during-restart',
        `pid=${child.pid ?? 'unknown'} code=${code} signal=${signal} reason=port-conflict`,
      );
      void recoverBackendPortConflict(child);
      return;
    }

    if (app.isPackaged && failedDuringStartup && !isProductionDesktopMode()) {
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
  backendIdentityVerified = false;

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
  if (backendStopOperation?.child === child) {
    return backendStopOperation.promise;
  }

  processLifecycle.expectChildExit(child);
  backendState = {
    status: 'stopped',
    startedAt: backendState.startedAt,
    lastExitAt: backendState.lastExitAt,
    pid: child.pid ?? null,
  };

  const promise = require('./backend-shutdown').stopSpawnedBackend(child, {
    sessionId: isProductionDesktopMode() ? backendExpectedSessionId : null,
    timeoutMs: BACKEND_STOP_TIMEOUT_MS,
    isCurrent: () => backendProcess === child,
    forceKillTree: killProcessTree,
    log: appendDesktopLog,
  }).then(() => {
      if (backendProcess === child) {
        backendProcess = null;
      }
      backendState = {
        status: 'stopped',
        startedAt: backendState.startedAt,
        lastExitAt: new Date().toISOString(),
        pid: null,
      };
      if (backendStopOperation?.child === child) {
        backendStopOperation = null;
      }
  });
  backendStopOperation = { child, promise };
  return promise;
}

async function restartBackend() {
  appendDesktopLog('backend-restart-requested', getBackendHealthUrl());
  backendRestartInProgress = true;
  backendState = {
    ...backendState,
    status: 'starting',
    pid: null,
  };
  notifyDesktopState();

  if (app.isPackaged) {
    renderBackendRestartingPage();
  }

  try {
    await stopBackend();
    if (!isProductionDesktopMode() && await adoptExistingHealthyBackendIfAvailable()) {
      appendDesktopLog('backend-restart-complete', `${getBackendHealthUrl()} reused-existing`);
      if (isShowingFrontendFallback) {
        reloadFrontendAfterBackendRecovery(getSetupRecoveryRouteHash());
      }
      return getDesktopState();
    }
    await startBackend();
    if (backendState.status === 'ready') {
      appendDesktopLog('backend-restart-complete', `${getApiBaseUrl()} identity=verified`);
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

async function createMainWindow(options = {}) {
  const loadFrontend = options.loadFrontend !== false;
  isShowingFrontendFallback = false;
  mainWindow = new BrowserWindow({
    title: PRODUCT_METADATA.productName,
    icon: path.join(__dirname, 'assets', 'patrolsafe.ico'),
    width: 1480,
    height: 980,
    minWidth: 1200,
    minHeight: 800,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      additionalArguments: backendIdentityVerified ? [getApiBaseUrlArgument(getBackendPort())] : [],
      contextIsolation: true,
      nodeIntegration: false,
      devTools: shouldOpenDebugTools(),
    },
  });

  mainWindow.webContents.on('before-input-event', (event, input) => {
    const key = String(input.key || '').toLowerCase();
    if (input.type === 'keyDown' && (input.control || input.meta) && input.shift && key === 'i') {
      event.preventDefault();
      openDebugToolsIfNeeded('shortcut');
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      void shell.openExternal(validateExternalUrl(url));
    } catch (error) {
      appendDesktopLog('external-window-request-rejected', error instanceof Error ? error.message : String(error));
    }
    return { action: 'deny' };
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

  const handleRendererNavigation = (event, targetUrl) => {
    if (targetUrl.startsWith('patrol-recovery://')) {
      event.preventDefault();
      const action = targetUrl.slice('patrol-recovery://'.length).split(/[/?#]/)[0];
      void handlePatrolRecoveryAction(action);
      return;
    }

    if (
      isTrustedRendererNavigation(targetUrl, {
        packagedEntryUrl: pathToFileURL(getFrontendEntryPoint()).toString(),
        developmentUrl: process.env.DESKTOP_DEV === 'true' ? process.env.DESKTOP_WEB_URL || DEFAULT_WEB_URL : null,
      })
    ) {
      return;
    }

    event.preventDefault();
    try {
      void shell.openExternal(validateExternalUrl(targetUrl));
    } catch {
      appendDesktopLog('renderer-navigation-rejected', targetUrl.slice(0, 240));
    }
  };
  mainWindow.webContents.on('will-navigate', handleRendererNavigation);
  mainWindow.webContents.on('will-redirect', handleRendererNavigation);

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

  if (!loadFrontend) {
    return;
  }

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
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    appendDesktopLog('Second desktop launch redirected to the existing instance');
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady()
    .then(async () => {
      if (typeof app.setAboutPanelOptions === 'function') {
        app.setAboutPanelOptions({
          applicationName: PRODUCT_METADATA.productName,
          applicationVersion: PRODUCT_METADATA.version,
          version: PRODUCT_METADATA.displayBuild || PRODUCT_METADATA.buildId,
          copyright: PRODUCT_METADATA.copyright,
          credits: `${PRODUCT_METADATA.companyName}\nSupport: ${PRODUCT_METADATA.supportEmail}`,
        });
      }

      appendDesktopLog(
        'Electron app ready',
        `packaged=${app.isPackaged} appPath=${app.getAppPath()} resourcesPath=${process.resourcesPath}`,
      );
      migrateLegacyWorkspaceTimeZone();
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
      if (!isBackendSmokeOnlyMode()) {
        void createMainWindow({ loadFrontend: false }).then(() => {
          renderStartupFailurePage(
            'PatrolSafe could not start',
            'local-service-identity-or-readiness-failed',
            'PatrolSafe could not securely start its local service. Close PatrolSafe, try again, and contact support if the problem continues.',
          );
        });
        return;
      }
      throw error;
    });

  app.on('window-all-closed', () => {
    appendDesktopLog('All windows closed');
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('before-quit', (event) => {
    appendDesktopLog('Electron before-quit');
    processLifecycle.beginQuit();
    if (quitCleanupComplete) {
      return;
    }
    event.preventDefault();
    if (quitCleanupStarted) {
      return;
    }
    quitCleanupStarted = true;
    void stopBackend()
      .catch((error) => {
        appendDesktopLog('Backend shutdown during quit failed', error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        quitCleanupComplete = true;
        appendDesktopLog('Electron quit cleanup complete');
        app.quit();
      });
  });

  const handleTrusted = (channel, handler) => {
    ipcMain.handle(channel, async (event, ...args) => {
      assertTrustedIpcSender(event, mainWindow);
      return handler(...args);
    });
  };

  handleTrusted('desktop:get-api-base-url', async () => (backendIdentityVerified ? getApiBaseUrl() : null));
  handleTrusted('desktop:get-api-token', async () => {
    if (!backendIdentityVerified && isProductionDesktopMode()) {
      throw new Error('PatrolSafe local service identity has not been verified');
    }
    return getDesktopApiToken();
  });
  handleTrusted('desktop:begin-admin-recovery', async () => beginAdminRecovery());
  handleTrusted('desktop:get-state', async () => getDesktopState());
  handleTrusted('desktop:choose-storage-path', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
    });

    if (result.canceled || !result.filePaths[0]) {
      return null;
    }

    return result.filePaths[0];
  });
  handleTrusted('desktop:create-data-backup', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose a location for the PatrolSafe backup',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return createCustomerBackup(result.filePaths[0]);
  });
  handleTrusted('desktop:restore-data-backup', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose a PatrolSafe backup folder to restore',
      properties: ['openDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return restoreCustomerBackup(result.filePaths[0]);
  });
  handleTrusted('desktop:save-config', async (rawPartialConfig) => {
    const partialConfig = sanitizeDesktopConfigPatch(rawPartialConfig);
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
  handleTrusted('desktop:postgres-check', async (partialConfig) => checkPostgres(sanitizePostgresConfig(partialConfig)));
  handleTrusted('desktop:postgres-provision', async (partialConfig) => provisionPostgres(sanitizePostgresConfig(partialConfig)));
  handleTrusted('desktop:restart-backend', async () => restartBackend());
  handleTrusted('desktop:start-backend', async () => {
    await startBackend();
    if (backendState.status !== 'ready') {
      await waitForBackendReady(RESTART_BACKEND_HEALTH_TIMEOUT_MS);
    }
    return getDesktopState();
  });
  handleTrusted('desktop:stop-backend', async () => {
    await stopBackend();
    return getDesktopState();
  });
  handleTrusted('desktop:open-external', async (targetUrl) => {
    await shell.openExternal(validateExternalUrl(targetUrl));
    return true;
  });
  handleTrusted('desktop:open-path', async (targetPath) => {
    const runtimeValues = getConfiguredRuntimeValues();
    const safePath = validateOpenPath(targetPath, [
      app.getPath('userData'),
      runtimeValues.storageRootPath,
      runtimeValues.whatsappSessionPath,
    ]);
    return shell.openPath(safePath);
  });
  handleTrusted('desktop:secure-store-get', async (key) => readSecureStoreValue(validateSecureStoreKey(key)));
  handleTrusted('desktop:secure-store-set', async (key, value) => {
    writeSecureStoreValue(validateSecureStoreKey(key), validateSecureStoreValue(value));
    return true;
  });
  handleTrusted('desktop:secure-store-clear', async (key) => {
    clearSecureStoreValue(validateSecureStoreKey(key));
    return true;
  });
}
