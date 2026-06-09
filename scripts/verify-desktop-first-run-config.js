const fs = require('fs');
const path = require('path');
const os = require('os');

const projectRoot = path.resolve(__dirname, '..');

function fail(message) {
  console.error(`VERIFY FAILED: ${message}`);
  process.exitCode = 1;
}

function pass(message) {
  console.log(`OK: ${message}`);
}

function resolveConfigPath() {
  const explicit = process.env.DESKTOP_CONFIG_PATH?.trim();
  if (explicit) {
    return path.resolve(explicit);
  }

  const appName = 'Patrol Evidence Platform';
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), appName, 'workspace-config.json');
  }

  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', appName, 'workspace-config.json');
  }

  return path.join(os.homedir(), '.config', appName, 'workspace-config.json');
}

function loadWorkspaceConfig(configPath) {
  if (!fs.existsSync(configPath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (error) {
    fail(`Unable to parse desktop config at ${configPath}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function resolveActiveStoragePath(workspace, configPath) {
  const configured = workspace?.storageRootPath?.trim();
  if (configured) {
    return path.resolve(configured);
  }

  const dataDir = path.join(path.dirname(configPath), 'data');
  return path.join(dataDir, 'Security_Patrols');
}

function resolveDatabasePath(workspace, configPath) {
  const configured = workspace?.sqliteDbPath?.trim();
  if (configured) {
    return path.resolve(configured);
  }

  return path.join(path.dirname(configPath), 'data', 'patrol-evidence.db');
}

function main() {
  const configPath = resolveConfigPath();
  console.log(`CONFIG_PATH=${configPath}`);

  if (!fs.existsSync(configPath)) {
    pass('No desktop config file yet (expected before first-run setup completes).');
    pass('Default startPatrolMonitoringAfterLaunch=false for new installs.');
    if (process.exitCode) {
      process.exit(process.exitCode);
    }
    return;
  }

  pass(`Desktop config file exists at ${configPath}`);

  const workspace = loadWorkspaceConfig(configPath);
  if (!workspace) {
    process.exit(process.exitCode || 1);
    return;
  }

  const autoStart = workspace.autoStartCollector === true;
  if (autoStart) {
    fail(`startPatrolMonitoringAfterLaunch (autoStartCollector) must default to false; found true in ${configPath}`);
  } else {
    pass('startPatrolMonitoringAfterLaunch (autoStartCollector) is false');
  }

  const adminEmail = workspace.localAdminEmail?.trim().toLowerCase();
  if (!adminEmail) {
    fail(`localAdminEmail is missing from ${configPath}`);
  } else {
    pass(`Admin email persisted: ${adminEmail}`);
  }

  const configuredStorage = workspace.storageRootPath?.trim();
  const activeStorage = resolveActiveStoragePath(workspace, configPath);
  const databasePath = resolveDatabasePath(workspace, configPath);

  console.log(`DATABASE_PATH=${databasePath}`);
  console.log(`ACTIVE_IMAGE_STORAGE_PATH=${activeStorage}`);

  if (configuredStorage) {
    pass(`Selected storage path persisted: ${configuredStorage}`);
    if (path.resolve(configuredStorage) !== activeStorage) {
      fail(
        `Active storage path does not match selected storage path.\nselected=${path.resolve(configuredStorage)}\nactive=${activeStorage}`,
      );
    } else {
      pass('Active storage path matches selected storage path');
    }

    if (!fs.existsSync(activeStorage)) {
      fail(`Active storage path does not exist: ${activeStorage}`);
    } else {
      pass(`Active storage path exists: ${activeStorage}`);
    }
  } else {
    pass(`No custom storage path configured yet; default image storage would be ${activeStorage}`);
  }

  if (process.exitCode) {
    process.exit(process.exitCode);
  }

  console.log('VERIFY PASSED: Desktop first-run config checks completed.');
}

main();
