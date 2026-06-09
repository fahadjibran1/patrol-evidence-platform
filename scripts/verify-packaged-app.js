const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const outRoot = path.join(projectRoot, 'out');

function fail(message) {
  console.error(`VERIFY FAILED: ${message}`);
  process.exitCode = 1;
}

function pass(message) {
  console.log(`OK: ${message}`);
}

function ensureExists(targetPath, label) {
  if (!fs.existsSync(targetPath)) {
    fail(`${label} is missing at ${targetPath}`);
    return false;
  }

  pass(`${label} found at ${targetPath}`);
  return true;
}

function findPackagedAppDir() {
  if (!fs.existsSync(outRoot)) {
    fail(`Output folder is missing: ${outRoot}`);
    return null;
  }

  const candidates = fs
    .readdirSync(outRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(outRoot, entry.name))
    .filter((entryPath) => /win32-x64$/i.test(path.basename(entryPath)));

  if (candidates.length === 0) {
    fail(`No packaged Windows app folder found under ${outRoot}`);
    return null;
  }

  candidates.sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);
  return candidates[0];
}

function findFirstRecursive(rootDir, predicate) {
  const stack = [rootDir];

  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const nextPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(nextPath);
        continue;
      }

      if (predicate(nextPath, entry.name)) {
        return nextPath;
      }
    }
  }

  return null;
}

function ensureNonEmptyDirectory(targetPath, label) {
  if (!ensureExists(targetPath, label)) {
    return false;
  }

  const entries = fs.readdirSync(targetPath);
  if (entries.length === 0) {
    fail(`${label} exists but is empty: ${targetPath}`);
    return false;
  }

  pass(`${label} contains ${entries.length} item(s)`);
  return true;
}

const packagedAppDir = findPackagedAppDir();
if (!packagedAppDir) {
  process.exit(process.exitCode || 1);
}

pass(`Using packaged app folder ${packagedAppDir}`);

const exePath = path.join(packagedAppDir, 'PatrolEvidencePlatform.exe');
const appRoot = path.join(packagedAppDir, 'resources', 'app');
const mainEntry = path.join(appRoot, 'desktop', 'main.js');
const preloadEntry = path.join(appRoot, 'desktop', 'preload.js');
const backendEntry = path.join(appRoot, 'dist', 'main.js');
const helperEntry = path.join(appRoot, 'dist', 'collectors', 'whatsapp-helper.main.js');
const frontendEntry = path.join(appRoot, 'web', 'dist', 'index.html');
const frontendAssetsDir = path.join(appRoot, 'web', 'dist', 'assets');
const betterSqliteRoot = path.join(appRoot, 'node_modules', 'better-sqlite3');
const sharpRoot = path.join(appRoot, 'node_modules', 'sharp');
const imgRoot = path.join(appRoot, 'node_modules', '@img');
const whatsappRoot = path.join(appRoot, 'node_modules', 'whatsapp-web.js');
const puppeteerRoot = path.join(appRoot, 'node_modules', 'puppeteer');

ensureExists(exePath, 'Packaged Windows executable');
ensureExists(mainEntry, 'Electron main entry');
ensureExists(preloadEntry, 'Electron preload');
ensureExists(backendEntry, 'Nest backend dist/main.js');
ensureExists(helperEntry, 'WhatsApp helper entry');
ensureExists(frontendEntry, 'Built frontend index.html');
ensureNonEmptyDirectory(frontendAssetsDir, 'Built frontend assets directory');
ensureExists(path.join(betterSqliteRoot, 'package.json'), 'better-sqlite3 package');
ensureExists(path.join(sharpRoot, 'package.json'), 'sharp package');
ensureExists(path.join(whatsappRoot, 'package.json'), 'whatsapp-web.js package');
ensureExists(path.join(puppeteerRoot, 'package.json'), 'puppeteer package');

const betterSqliteBinary = findFirstRecursive(
  betterSqliteRoot,
  (candidatePath, fileName) => fileName === 'better_sqlite3.node' || candidatePath.endsWith('.node'),
);

if (!betterSqliteBinary) {
  fail(`better-sqlite3 native binding was not found under ${betterSqliteRoot}`);
} else {
  pass(`better-sqlite3 native binding found at ${betterSqliteBinary}`);
}

const sharpBinary = findFirstRecursive(
  imgRoot,
  (_candidatePath, fileName) => fileName === 'sharp-win32-x64.node',
);

if (!sharpBinary) {
  fail(`sharp native binding was not found under ${imgRoot}`);
} else {
  pass(`sharp native binding found at ${sharpBinary}`);
}

const sharpLibvips = findFirstRecursive(
  imgRoot,
  (_candidatePath, fileName) => /^libvips.*\.(dll|so|dylib)$/i.test(fileName),
);

if (!sharpLibvips) {
  fail(`sharp libvips runtime file was not found under ${imgRoot}`);
} else {
  pass(`sharp libvips runtime file found at ${sharpLibvips}`);
}

const frontendHtml = fs.existsSync(frontendEntry) ? fs.readFileSync(frontendEntry, 'utf8') : '';
if (!frontendHtml.includes('./assets/')) {
  fail(`Frontend index.html does not use relative ./assets paths: ${frontendEntry}`);
} else {
  pass('Frontend index.html uses relative ./assets paths');
}

if (process.exitCode && process.exitCode !== 0) {
  process.exit(process.exitCode);
}

console.log('VERIFY PASSED: Packaged Windows app contains the expected runtime files.');
