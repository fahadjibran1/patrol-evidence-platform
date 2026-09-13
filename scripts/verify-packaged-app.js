const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  getBackendEntryCandidates,
  getFrontendEntryCandidates,
  getWhatsAppHelperEntryCandidates,
  getLicensePublicKeyUtilCandidates,
  getPackagedAppRoot,
} = require('../desktop/packaged-runtime-paths');
const {
  assertRuntimePackageManifest,
} = require('./lib/desktop-runtime-package-manifest');

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
const resourcesPath = path.join(packagedAppDir, 'resources');
const appRoot = getPackagedAppRoot({ resourcesPath }) || path.join(resourcesPath, 'app');
const mainEntry = path.join(appRoot, 'desktop', 'main.js');
const preloadEntry = path.join(appRoot, 'desktop', 'preload.js');
const runtimePathsModule = path.join(appRoot, 'desktop', 'packaged-runtime-paths.js');
const backendResolution = getBackendEntryCandidates({
  appRoot,
  resourcesPath,
  dirnameHint: appRoot,
  packaged: true,
});
const frontendResolution = getFrontendEntryCandidates({
  appRoot,
  resourcesPath,
  dirnameHint: appRoot,
  packaged: true,
});
const helperResolution = getWhatsAppHelperEntryCandidates({
  appRoot,
  resourcesPath,
  dirnameHint: appRoot,
  packaged: true,
});
const licenseUtilResolution = getLicensePublicKeyUtilCandidates({
  appRoot,
  resourcesPath,
  dirnameHint: appRoot,
  packaged: true,
});
const backendEntry = backendResolution.resolved;
const helperEntry = helperResolution.resolved;
const frontendEntry = frontendResolution.resolved;
const frontendAssetsDir = path.join(appRoot, 'web', 'dist', 'assets');
const packagedWindowsIcon = path.join(appRoot, 'desktop', 'assets', 'patrolsafe.ico');
const packagedAboutIcon = path.join(appRoot, 'web', 'dist', 'patrolsafe-icon.png');
const betterSqliteRoot = path.join(appRoot, 'node_modules', 'better-sqlite3');
const sharpRoot = path.join(appRoot, 'node_modules', 'sharp');
const imgRoot = path.join(appRoot, 'node_modules', '@img');
const whatsappRoot = path.join(appRoot, 'node_modules', 'whatsapp-web.js');
const puppeteerRoot = path.join(appRoot, 'node_modules', 'puppeteer');

ensureExists(exePath, 'Packaged Windows executable');
ensureExists(mainEntry, 'Electron main entry');
ensureExists(preloadEntry, 'Electron preload');
ensureExists(runtimePathsModule, 'Packaged runtime path resolver');

console.log('Backend entry candidates:');
for (const candidate of backendResolution.candidates) {
  console.log(`  ${candidate.exists ? 'EXISTS' : 'MISSING'} ${candidate.path}`);
}
if (!backendEntry) {
  fail('Nest backend entry could not be resolved (expected resources/app/dist/main.js)');
} else {
  pass(`Nest backend entry resolved at ${backendEntry}`);
}

if (!licenseUtilResolution.resolved) {
  fail('Packaged licence public-key util could not be resolved under dist/licensing/');
} else {
  pass(`Packaged licence public-key util resolved at ${licenseUtilResolution.resolved}`);
}

console.log('Frontend entry candidates:');
for (const candidate of frontendResolution.candidates) {
  console.log(`  ${candidate.exists ? 'EXISTS' : 'MISSING'} ${candidate.path}`);
}
if (!frontendEntry) {
  fail('Built frontend index.html could not be resolved');
} else {
  pass(`Built frontend index.html resolved at ${frontendEntry}`);
}

console.log('WhatsApp helper candidates:');
for (const candidate of helperResolution.candidates) {
  console.log(`  ${candidate.exists ? 'EXISTS' : 'MISSING'} ${candidate.path}`);
}
if (!helperEntry) {
  fail('WhatsApp helper entry could not be resolved');
} else {
  pass(`WhatsApp helper entry resolved at ${helperEntry}`);
}

ensureNonEmptyDirectory(frontendAssetsDir, 'Built frontend assets directory');
ensureExists(packagedWindowsIcon, 'Packaged PatrolSafe Windows icon');
ensureExists(packagedAboutIcon, 'Packaged PatrolSafe About icon');

const {
  resolvePackagedPublicKeyPath,
  validatePublicKeyFile,
  findPrivateKeyViolations,
} = require('./lib/license-public-key.util');
const packagedPublicKeyPath = resolvePackagedPublicKeyPath(packagedAppDir);
if (!packagedPublicKeyPath) {
  fail('Packaged licence public key is missing. Expected resources/license-public.pem.');
} else {
  try {
    validatePublicKeyFile(packagedPublicKeyPath, 'Packaged licence public key');
    pass(`Packaged licence public key found at ${packagedPublicKeyPath}`);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

const privateKeyHits = findPrivateKeyViolations(packagedAppDir);
if (privateKeyHits.length > 0) {
  fail(`Private key material found in packaged output:\n${privateKeyHits.join('\n')}`);
} else {
  pass('No private key material found under packaged output');
}

try {
  const licenseCoreManifest = assertRuntimePackageManifest(appRoot);
  pass(
    `Runtime-only license-core package verified at ${licenseCoreManifest.runtimeRoot} (${licenseCoreManifest.fileCount} files)`,
  );
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

const buildInfoCandidates = [
  path.join(appRoot, 'build-info.json'),
  path.join(appRoot, 'dist', 'build-info.json'),
  path.join(projectRoot, 'build-info.json'),
];
const buildInfoPath = buildInfoCandidates.find((candidate) => fs.existsSync(candidate));
if (buildInfoPath) {
  const buildInfo = JSON.parse(fs.readFileSync(buildInfoPath, 'utf8'));
  pass(`Build metadata found at ${buildInfoPath}`);
  if (buildInfo.displayBuild) {
    pass(`displayBuild=${buildInfo.displayBuild}`);
  }
  if (buildInfo.windowsBuild) {
    const windowsParts = String(buildInfo.windowsBuild).split('.');
    if (windowsParts.length < 1 || windowsParts.length > 4) {
      fail(`windowsBuild must have 1–4 components, got ${buildInfo.windowsBuild}`);
    } else {
      pass(`windowsBuild=${buildInfo.windowsBuild}`);
    }
  }
} else {
  pass('Build metadata file not required in older packages (generate-build-metadata runs on package)');
}

const packagedPackageJsonPath = path.join(appRoot, 'package.json');
if (fs.existsSync(packagedPackageJsonPath)) {
  const packagedPackageJson = JSON.parse(fs.readFileSync(packagedPackageJsonPath, 'utf8'));
  if (packagedPackageJson.version !== '1.0.0' && !/^\d+\.\d+\.\d+/.test(String(packagedPackageJson.version))) {
    fail(`Packaged package.json version looks invalid: ${packagedPackageJson.version}`);
  } else {
    pass(`Packaged product version=${packagedPackageJson.version}`);
  }
  if (packagedPackageJson.displayName !== 'PatrolSafe by S4') {
    fail(`Packaged displayName is not PatrolSafe by S4: ${packagedPackageJson.displayName}`);
  } else {
    pass('Packaged displayName=PatrolSafe by S4');
  }
  if (packagedPackageJson.companyName !== 'Vesoft Services Limited') {
    fail(`Packaged companyName is not Vesoft Services Limited: ${packagedPackageJson.companyName}`);
  } else {
    pass('Packaged companyName=Vesoft Services Limited');
  }
  const packagedWindowsBuild = packagedPackageJson.windowsBuild;
  if (packagedWindowsBuild && String(packagedWindowsBuild).split('.').length > 4) {
    fail(`Packaged windowsBuild has too many components for Electron: ${packagedWindowsBuild}`);
  }
  if (packagedPackageJson.buildId && String(packagedPackageJson.buildId).split('.').length > 4) {
    // buildId/displayBuild may be 6-part; ensure it is not also used as windowsBuild.
    if (packagedPackageJson.buildId === packagedPackageJson.windowsBuild) {
      fail('display buildId must not equal windowsBuild when it has more than 4 components');
    } else {
      pass('Packaged display buildId is separate from windowsBuild');
    }
  }
}

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
  (_candidatePath, fileName) => /^sharp-win32-x64(?:-[0-9.]+)?\.node$/.test(fileName),
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

console.log('Running packaged backend smoke test as part of package verification...');
const smokeResult = spawnSync(process.execPath, [path.join(projectRoot, 'scripts', 'smoke-packaged-backend.js')], {
  cwd: projectRoot,
  stdio: 'inherit',
  windowsHide: true,
  env: process.env,
});

if ((smokeResult.status ?? 1) !== 0) {
  fail('Packaged backend smoke test failed. Packaging is not considered successful.');
  process.exit(process.exitCode || 1);
}

pass('Packaged backend smoke test passed');
console.log('VERIFY PASSED: Packaged Windows app contains the expected runtime files and backend starts.');
