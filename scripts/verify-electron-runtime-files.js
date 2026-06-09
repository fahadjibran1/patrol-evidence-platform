const fs = require('fs');
const path = require('path');
const { findPackagedAppDir } = require('./lib/packaged-app-dir');
const {
  REQUIRED_EXECUTABLE_ROOT_FILES,
  OPTIONAL_EXECUTABLE_ROOT_FILES,
  REQUIRED_EXECUTABLE_ROOT_DIRS,
  REQUIRED_RESOURCES_CHILDREN,
  MIN_ICU_BYTES,
} = require('./lib/electron-runtime-manifest');
const { ensureElectronRuntimeFiles } = require('./ensure-electron-runtime-files');

const projectRoot = path.resolve(__dirname, '..');
const shouldRepair = process.argv.includes('--repair');

function fail(message) {
  console.error(`ELECTRON RUNTIME VERIFY FAILED: ${message}`);
  process.exitCode = 1;
}

function pass(message) {
  console.log(`OK: ${message}`);
}

function ensureFile(packagedAppDir, fileName) {
  const targetPath = path.join(packagedAppDir, fileName);
  if (!fs.existsSync(targetPath)) {
    fail(`Missing ${fileName} next to packaged executable (${targetPath})`);
    return false;
  }

  const size = fs.statSync(targetPath).size;
  if (fileName === 'icudtl.dat' && size < MIN_ICU_BYTES) {
    fail(`icudtl.dat exists but is too small (${size} bytes): ${targetPath}`);
    return false;
  }

  pass(`${fileName} (${size} bytes)`);
  return true;
}

function ensureDirectory(packagedAppDir, dirName) {
  const targetPath = path.join(packagedAppDir, dirName);
  if (!fs.existsSync(targetPath)) {
    fail(`Missing ${dirName}/ next to packaged executable (${targetPath})`);
    return false;
  }

  const entries = fs.readdirSync(targetPath);
  if (entries.length === 0) {
    fail(`${dirName}/ exists but is empty (${targetPath})`);
    return false;
  }

  pass(`${dirName}/ (${entries.length} entries)`);
  return true;
}

const packagedAppDir = findPackagedAppDir();
if (!packagedAppDir) {
  fail(`No packaged Windows app folder found under ${path.join(projectRoot, 'out')}. Run npm run desktop:package first.`);
  process.exit(1);
}

if (shouldRepair) {
  const repair = ensureElectronRuntimeFiles(packagedAppDir, projectRoot);
  if (repair.copied.length > 0) {
    pass(`Repaired missing runtime files: ${repair.copied.join(', ')}`);
  }
}

const exeCandidates = fs
  .readdirSync(packagedAppDir)
  .filter((name) => name.toLowerCase().endsWith('.exe'));

if (exeCandidates.length === 0) {
  fail(`No .exe found in packaged folder: ${packagedAppDir}`);
} else {
  pass(`Executable(s): ${exeCandidates.join(', ')}`);
}

console.log(`VERIFY: Electron shell runtime in ${packagedAppDir}`);

let ok = true;
for (const fileName of REQUIRED_EXECUTABLE_ROOT_FILES) {
  ok = ensureFile(packagedAppDir, fileName) && ok;
}

for (const fileName of OPTIONAL_EXECUTABLE_ROOT_FILES) {
  const targetPath = path.join(packagedAppDir, fileName);
  if (fs.existsSync(targetPath)) {
    pass(`${fileName} (${fs.statSync(targetPath).size} bytes)`);
  }
}

for (const dirName of REQUIRED_EXECUTABLE_ROOT_DIRS) {
  ok = ensureDirectory(packagedAppDir, dirName) && ok;
}

for (const relativeChild of REQUIRED_RESOURCES_CHILDREN) {
  const targetPath = path.join(packagedAppDir, 'resources', relativeChild);
  if (!fs.existsSync(targetPath)) {
    fail(`Missing resources/${relativeChild.replace(/\\/g, '/')} (${targetPath})`);
    ok = false;
  } else {
    pass(`resources/${relativeChild.replace(/\\/g, '/')}`);
  }
}

const localeSample = path.join(packagedAppDir, 'locales', 'en-US.pak');
if (!fs.existsSync(localeSample)) {
  fail(`Missing locales/en-US.pak (${localeSample})`);
  ok = false;
} else {
  pass('locales/en-US.pak');
}

if (!ok || process.exitCode) {
  process.exit(process.exitCode || 1);
}

console.log('ELECTRON RUNTIME VERIFY PASSED');
console.log(`PACKAGED_DIR=${packagedAppDir}`);
console.log(`EXE=${path.join(packagedAppDir, exeCandidates[0])}`);
