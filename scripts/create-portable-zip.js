const fs = require('fs');
const os = require('os');
const path = require('path');
const archiver = require('archiver');
const extract = require('extract-zip');

const projectRoot = path.resolve(__dirname, '..');
const outRoot = path.join(projectRoot, 'out');
const portableOutputDir = path.join(outRoot, 'portable');

const requiredRelativePaths = [
  'PatrolEvidencePlatform.exe',
  'icudtl.dat',
  'resources.pak',
  'chrome_100_percent.pak',
  'chrome_200_percent.pak',
  'snapshot_blob.bin',
  'v8_context_snapshot.bin',
  'ffmpeg.dll',
  path.join('locales', 'en-US.pak'),
  path.join('resources', 'app', 'desktop', 'main.js'),
  path.join('resources', 'app', 'desktop', 'preload.js'),
  path.join('resources', 'app', 'dist', 'main.js'),
  path.join('resources', 'app', 'dist', 'collectors', 'whatsapp-helper.main.js'),
  path.join('resources', 'app', 'dist', 'collectors', 'whatsapp-helper.types.js'),
  path.join('resources', 'app', 'dist', 'desktop', 'desktop-config.util.js'),
  path.join('resources', 'app', 'web', 'dist', 'index.html'),
  path.join('resources', 'app', 'node_modules', 'whatsapp-web.js', 'package.json'),
  path.join('resources', 'app', 'node_modules', 'puppeteer', 'package.json'),
  path.join('resources', 'app', 'node_modules', 'puppeteer-core', 'package.json'),
  path.join('resources', 'app', 'node_modules', 'better-sqlite3', 'package.json'),
  path.join('resources', 'app', 'node_modules', 'sharp', 'package.json'),
];

const forbiddenRelativePaths = [
  '.git',
  '.packtmp',
  'out',
  'logs',
  'tmp',
  'cache',
  '.cache',
  '.wwebjs_cache',
  'whatsapp-session',
  'Security_Patrols',
  path.join('resources', 'app', '.git'),
  path.join('resources', 'app', '.packtmp'),
  path.join('resources', 'app', 'out'),
  path.join('resources', 'app', 'logs'),
  path.join('resources', 'app', 'tmp'),
  path.join('resources', 'app', '.cache'),
  path.join('resources', 'app', '.wwebjs_cache'),
  path.join('resources', 'app', 'whatsapp-session'),
  path.join('resources', 'app', 'Security_Patrols'),
  path.join('resources', 'app', 'node_modules', 'puppeteer-core', '.local-chromium'),
  path.join('resources', 'app', 'node_modules', 'puppeteer', '.local-chromium'),
  path.join('resources', 'app', 'node_modules', 'electron'),
];

function fail(message) {
  console.error(`PORTABLE ZIP FAILED: ${message}`);
  process.exit(1);
}

function pass(message) {
  console.log(`OK: ${message}`);
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

function ensureSourceIsCurrent(packagedAppDir) {
  const packageStat = fs.statSync(packagedAppDir);
  const buildOutputs = [
    path.join(projectRoot, 'dist', 'main.js'),
    path.join(projectRoot, 'web', 'dist', 'index.html'),
    path.join(projectRoot, 'src', 'collectors', 'whatsapp-helper.main.ts'),
    path.join(projectRoot, 'desktop', 'main.js'),
    path.join(projectRoot, 'desktop', 'preload.js'),
  ].filter((candidate) => fs.existsSync(candidate));

  const newerInputs = buildOutputs.filter((candidate) => fs.statSync(candidate).mtimeMs > packageStat.mtimeMs + 1_000);
  if (newerInputs.length > 0) {
    fail(
      [
        'Packaged folder appears older than build/runtime inputs. Run npm run desktop:package first.',
        ...newerInputs.map((candidate) => `newer: ${candidate}`),
      ].join('\n'),
    );
  }
}

function ensureRequiredFiles(rootDir, label) {
  const missing = [];
  for (const relativePath of requiredRelativePaths) {
    const targetPath = path.join(rootDir, relativePath);
    if (!fs.existsSync(targetPath)) {
      missing.push(targetPath);
    }
  }

  if (missing.length > 0) {
    fail(`${label} is missing required runtime files:\n${missing.join('\n')}`);
  }

  for (const relativePath of requiredRelativePaths) {
    pass(`${label} contains ${relativePath.replace(/\\/g, '/')}`);
  }
}

function ensureForbiddenPathsAbsent(rootDir, label) {
  const present = [];
  for (const relativePath of forbiddenRelativePaths) {
    const targetPath = path.join(rootDir, relativePath);
    if (fs.existsSync(targetPath)) {
      present.push(targetPath);
    }
  }

  if (present.length > 0) {
    fail(`${label} includes runtime/dev data that must stay outside the portable ZIP:\n${present.join('\n')}`);
  }
}

function createZip(sourceDir, zipPath, folderName) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', {
      zlib: { level: 9 },
      forceZip64: false,
    });

    output.on('close', resolve);
    output.on('error', reject);
    archive.on('warning', reject);
    archive.on('error', reject);

    archive.pipe(output);
    archive.directory(sourceDir, folderName);
    archive.finalize();
  });
}

async function main() {
  const packagedAppDir = findPackagedAppDir();
  if (!packagedAppDir) {
    fail(`No packaged Windows app folder was found under ${outRoot}. Run "npm run desktop:package" first.`);
  }

  ensureSourceIsCurrent(packagedAppDir);
  ensureRequiredFiles(packagedAppDir, 'Packaged source folder');
  ensureForbiddenPathsAbsent(packagedAppDir, 'Packaged source folder');

  const packagedFolderName = path.basename(packagedAppDir);
  const zipFileName = `${packagedFolderName}.zip`;
  const zipPath = path.join(portableOutputDir, zipFileName);

  fs.mkdirSync(portableOutputDir, { recursive: true });
  if (fs.existsSync(zipPath)) {
    fs.rmSync(zipPath, { force: true });
  }

  await createZip(packagedAppDir, zipPath, packagedFolderName);

  if (!fs.existsSync(zipPath) || fs.statSync(zipPath).size === 0) {
    fail(`ZIP was not created or is empty: ${zipPath}`);
  }

  const extractRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'patrol-portable-zip-verify-'));
  await extract(zipPath, { dir: extractRoot });

  const extractedAppDir = path.join(extractRoot, packagedFolderName);
  if (!fs.existsSync(extractedAppDir)) {
    fail(`ZIP extraction did not produce expected app folder: ${extractedAppDir}`);
  }

  ensureRequiredFiles(extractedAppDir, 'Extracted ZIP folder');
  ensureForbiddenPathsAbsent(extractedAppDir, 'Extracted ZIP folder');

  console.log(`PORTABLE ZIP CREATED: ${zipPath}`);
  console.log(`PORTABLE ZIP SIZE MB: ${(fs.statSync(zipPath).size / 1024 / 1024).toFixed(2)}`);
  console.log(`PORTABLE ZIP VERIFIED EXTRACTED FOLDER: ${extractedAppDir}`);
}

main().catch((error) => {
  fail(error instanceof Error ? error.stack || error.message : String(error));
});
