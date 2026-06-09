const {
  detectSqliteNativeMismatch,
  getElectronRuntimeInfo,
  getNodeRuntimeInfo,
  getProjectVersions,
  runRebuild,
} = require('./native-runtime.util');

function shouldSkipPostinstall() {
  if (process.env.PATROL_SKIP_NATIVE_REBUILD === 'true') {
    return 'PATROL_SKIP_NATIVE_REBUILD=true';
  }

  if (process.env.npm_config_ignore_scripts === 'true') {
    return 'npm ignore-scripts enabled';
  }

  if (process.env.CI === 'true' && process.env.PATROL_REBUILD_NATIVE_IN_CI !== 'true') {
    return 'CI environment without PATROL_REBUILD_NATIVE_IN_CI=true';
  }

  try {
    require.resolve('electron/package.json');
  } catch {
    return 'electron is not installed';
  }

  return null;
}

function main() {
  const skipReason = shouldSkipPostinstall();
  if (skipReason) {
    console.log(`postinstall-native: skipped (${skipReason})`);
    return;
  }

  const versions = getProjectVersions();
  const nodeInfo = getNodeRuntimeInfo();
  let electronInfo = null;

  try {
    electronInfo = getElectronRuntimeInfo();
  } catch (error) {
    console.warn(
      `postinstall-native: unable to probe Electron runtime (${error instanceof Error ? error.message : String(error)}); rebuilding anyway`,
    );
  }

  console.log(`postinstall-native: node=${nodeInfo.version} modules=${nodeInfo.modules}`);
  if (electronInfo) {
    console.log(
      `postinstall-native: electron=${electronInfo.electron} node=${electronInfo.version} modules=${electronInfo.modules}`,
    );
  }
  console.log(`postinstall-native: better-sqlite3=${versions.betterSqlite3Version}`);

  const electronMismatch = detectSqliteNativeMismatch('electron');
  const nodeMismatch = detectSqliteNativeMismatch('node');

  if (!electronMismatch.mismatch && !nodeMismatch.mismatch) {
    console.log('postinstall-native: better-sqlite3 already compatible; no rebuild required');
    return;
  }

  if (electronMismatch.mismatch) {
    console.log('postinstall-native: rebuilding native modules for Electron runtime');
    runRebuild('electron');
  } else {
    console.log('postinstall-native: Electron better-sqlite3 already compatible');
  }

  const finalElectronMismatch = detectSqliteNativeMismatch('electron');
  if (finalElectronMismatch.mismatch) {
    console.error('postinstall-native: Electron better-sqlite3 still incompatible after rebuild');
    console.error('Run manually: npm run rebuild:native');
    process.exit(1);
  }

  const remainingNodeMismatch = detectSqliteNativeMismatch('node');
  if (remainingNodeMismatch.mismatch) {
    console.warn(
      'postinstall-native: Node runtime still mismatched. Desktop/Electron is ready. For plain Node dev run: npm run rebuild:native -- --node',
    );
  }

  console.log('postinstall-native: native module rebuild complete');
}

main();
