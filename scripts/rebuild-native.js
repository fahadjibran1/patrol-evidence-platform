const {
  detectSqliteNativeMismatch,
  getElectronRuntimeInfo,
  getNodeRuntimeInfo,
  getProjectVersions,
  probeBetterSqlite3Load,
  runRebuild,
} = require('./native-runtime.util');

const args = process.argv.slice(2);
const rebuildNode = args.includes('--node');
const rebuildElectron = args.includes('--electron') || !rebuildNode;

function logRuntime(label, info, versions) {
  console.log(`${label}: version=${info.version} NODE_MODULE_VERSION=${info.modules}`);
  if (info.electron) {
    console.log(`Electron: ${info.electron}`);
  }
  console.log(`better-sqlite3: ${versions.betterSqlite3Version}`);
}

function main() {
  const versions = getProjectVersions();
  console.log('REBUILD:NATIVE starting');

  if (rebuildElectron) {
    const electronInfo = getElectronRuntimeInfo();
    logRuntime('Target Electron runtime', electronInfo, versions);
    runRebuild('electron');
    const electronProbe = probeBetterSqlite3Load('electron');
    if (!electronProbe.ok) {
      console.error(`Electron better-sqlite3 probe failed: ${electronProbe.error?.message ?? 'unknown error'}`);
      process.exit(1);
    }
    console.log('OK: better-sqlite3 loads in Electron runtime');
  }

  if (rebuildNode) {
    const nodeInfo = getNodeRuntimeInfo();
    logRuntime('Target Node runtime', nodeInfo, versions);
    runRebuild('node');
    const nodeProbe = probeBetterSqlite3Load('node');
    if (!nodeProbe.ok) {
      console.error(`Node better-sqlite3 probe failed: ${nodeProbe.error?.message ?? 'unknown error'}`);
      process.exit(1);
    }
    console.log('OK: better-sqlite3 loads in Node runtime');
  }

  if (rebuildElectron) {
    const mismatch = detectSqliteNativeMismatch('electron');
    if (mismatch.mismatch) {
      console.error('Native SQLite module still mismatched for Electron after rebuild.');
      process.exit(1);
    }
  }

  if (rebuildNode) {
    const nodeMismatch = detectSqliteNativeMismatch('node');
    if (nodeMismatch.mismatch) {
      console.error('Native SQLite module still mismatched for Node after rebuild.');
      process.exit(1);
    }
  }

  console.log('REBUILD:NATIVE complete');
}

main();
