const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function getProjectVersions() {
  const packageJson = readJson(path.join(projectRoot, 'package.json'));
  const lockPath = path.join(projectRoot, 'package-lock.json');
  let betterSqlite3Version = packageJson.dependencies?.['better-sqlite3'] ?? 'unknown';
  let electronVersion = packageJson.devDependencies?.electron ?? 'unknown';

  if (fs.existsSync(lockPath)) {
    const lock = readJson(lockPath);
    const sqlitePkg = lock.packages?.['node_modules/better-sqlite3'];
    const electronPkg = lock.packages?.['node_modules/electron'];
    if (sqlitePkg?.version) {
      betterSqlite3Version = sqlitePkg.version;
    }
    if (electronPkg?.version) {
      electronVersion = electronPkg.version;
    }
  }

  return {
    betterSqlite3Version,
    electronVersion: String(electronVersion).replace(/^\^/, ''),
  };
}

function getNodeRuntimeInfo() {
  return {
    runtime: 'node',
    version: process.version,
    modules: process.versions.modules,
    electron: null,
  };
}

function resolveElectronExecutable() {
  return require('electron');
}

function spawnElectronScript(scriptPath) {
  const electronExecutable = resolveElectronExecutable();
  return spawnSync(electronExecutable, [scriptPath], {
    cwd: projectRoot,
    encoding: 'utf8',
    windowsHide: true,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
    },
  });
}

function spawnNodeScript(scriptPath) {
  return spawnSync(process.execPath, [scriptPath], {
    cwd: projectRoot,
    encoding: 'utf8',
    windowsHide: true,
    env: process.env,
  });
}

function getElectronRuntimeInfo() {
  const probePath = path.join(projectRoot, 'scripts', '.tmp-electron-runtime-probe.js');
  const probeSource = `
console.log(JSON.stringify({
  runtime: 'electron',
  version: process.version,
  modules: process.versions.modules,
  electron: process.versions.electron,
}));
`;

  fs.writeFileSync(probePath, probeSource, 'utf8');
  try {
    const result = spawnElectronScript(probePath);

    if (result.status !== 0) {
      throw new Error(result.stderr?.trim() || result.stdout?.trim() || 'Failed to probe Electron runtime');
    }

    return JSON.parse(String(result.stdout || '').trim());
  } finally {
    try {
      fs.rmSync(probePath, { force: true });
    } catch {
      // Ignore cleanup errors.
    }
  }
}

function isNativeModuleMismatchError(error) {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  return (
    normalized.includes('node_module_version') ||
    normalized.includes('was compiled against') ||
    normalized.includes('err_dlopen_failed') ||
    normalized.includes('invalid or incompatible binary')
  );
}

function probeBetterSqlite3Load(runtime = 'electron') {
  const probePath = path.join(projectRoot, 'scripts', '.tmp-sqlite-load-probe.js');
  const probeSource = `
try {
  const Database = require('better-sqlite3');
  const database = new Database(':memory:');
  const result = database.prepare('SELECT 1 AS value').get();
  database.close();
  if (result?.value !== 1) {
    throw new Error('Unexpected SQLite query result');
  }
  console.log('OK');
} catch (error) {
  console.log(error instanceof Error ? error.message : String(error));
  process.exit(2);
}
`;

  fs.writeFileSync(probePath, probeSource, 'utf8');

  try {
    // Keep native bindings out of this long-lived process. On Windows a loaded
    // .node file cannot be replaced by the electron-rebuild child process.
    const result = runtime === 'node' ? spawnNodeScript(probePath) : spawnElectronScript(probePath);

    if (result.status === 0 && String(result.stdout || '').trim() === 'OK') {
      return { ok: true, error: null };
    }

    const message = String(result.stdout || result.stderr || '').trim() || 'Unknown better-sqlite3 load failure';
    return { ok: false, error: new Error(message) };
  } finally {
    try {
      fs.rmSync(probePath, { force: true });
    } catch {
      // Ignore cleanup errors.
    }
  }
}

function detectSqliteNativeMismatch(runtime = 'electron') {
  const probe = probeBetterSqlite3Load(runtime);
  if (probe.ok) {
    return { mismatch: false, error: null };
  }

  if (isNativeModuleMismatchError(probe.error)) {
    return { mismatch: true, error: probe.error };
  }

  return { mismatch: true, error: probe.error };
}

function runRebuild(mode = 'electron') {
  if (mode === 'node') {
    const result = spawnSync('npm', ['rebuild', 'better-sqlite3', 'sharp'], {
      cwd: projectRoot,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    if (result.status !== 0) {
      process.exit(result.status ?? 1);
    }
    return;
  }

  const result = spawnSync(
    'npx',
    ['electron-rebuild', '-f', '--module-dir', '.', '--only', 'better-sqlite3,sharp'],
    {
      cwd: projectRoot,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    },
  );

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function formatRebuildMessage(runtimeInfo) {
  return [
    'Native SQLite module requires rebuild.',
    `Runtime: ${runtimeInfo.runtime} ${runtimeInfo.version}`,
    runtimeInfo.electron ? `Electron: ${runtimeInfo.electron}` : null,
    `NODE_MODULE_VERSION=${runtimeInfo.modules}`,
    'Run: npm run rebuild:native',
    'For plain Node dev only: npm run rebuild:native -- --node',
  ]
    .filter(Boolean)
    .join(' ');
}

module.exports = {
  projectRoot,
  getProjectVersions,
  getNodeRuntimeInfo,
  getElectronRuntimeInfo,
  isNativeModuleMismatchError,
  probeBetterSqlite3Load,
  detectSqliteNativeMismatch,
  runRebuild,
  formatRebuildMessage,
};
