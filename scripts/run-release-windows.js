const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const outRoot = path.join(projectRoot, 'out');
const portableOutputDir = path.join(outRoot, 'portable');

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function findPackagedAppDir() {
  if (!fs.existsSync(outRoot)) {
    return null;
  }

  const candidates = fs
    .readdirSync(outRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(outRoot, entry.name))
    .filter((entryPath) => /win32-x64$/i.test(path.basename(entryPath)));

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);
  return candidates[0];
}

function main() {
  console.log('RELEASE:WINDOWS — cleaning previous build outputs');
  run('npm', ['run', 'desktop:clean']);

  console.log('RELEASE:WINDOWS — building backend');
  run('npm', ['run', 'build']);

  console.log('RELEASE:WINDOWS — building web frontend');
  run('npm', ['--prefix', 'web', 'run', 'build']);

  console.log('RELEASE:WINDOWS — rebuilding native modules');
  run('npm', ['run', 'desktop:rebuild-native']);

  console.log('RELEASE:WINDOWS — packaging Electron app');
  run('npx', ['electron-forge', 'package']);

  console.log('RELEASE:WINDOWS — verifying runtime and first-run defaults');
  run('npm', ['run', 'desktop:verify-electron-runtime']);
  run('npm', ['run', 'desktop:verify-first-run-config']);

  console.log('RELEASE:WINDOWS — creating portable ZIP');
  run('node', ['scripts/create-portable-zip.js']);

  const packagedAppDir = findPackagedAppDir();
  const exePath = packagedAppDir
    ? fs
        .readdirSync(packagedAppDir)
        .filter((name) => name.toLowerCase().endsWith('.exe'))
        .map((name) => path.join(packagedAppDir, name))[0]
    : null;

  const zipCandidates = fs.existsSync(portableOutputDir)
    ? fs
        .readdirSync(portableOutputDir)
        .filter((name) => name.toLowerCase().endsWith('.zip'))
        .map((name) => path.join(portableOutputDir, name))
        .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs)
    : [];

  console.log('');
  console.log('RELEASE:WINDOWS COMPLETE');
  if (packagedAppDir) {
    console.log(`PORTABLE_FOLDER=${packagedAppDir}`);
  }
  if (exePath) {
    console.log(`EXE=${exePath}`);
  }
  if (zipCandidates[0]) {
    console.log(`ZIP=${zipCandidates[0]}`);
  }
}

main();
