const fs = require('fs');
const path = require('path');
const {
  REQUIRED_EXECUTABLE_ROOT_FILES,
  OPTIONAL_EXECUTABLE_ROOT_FILES,
  REQUIRED_EXECUTABLE_ROOT_DIRS,
  REQUIRED_RESOURCES_CHILDREN,
  getElectronDistDir,
} = require('./lib/electron-runtime-manifest');

function copyFileIfMissingOrEmpty(sourcePath, destPath) {
  if (!fs.existsSync(sourcePath)) {
    return false;
  }

  if (fs.existsSync(destPath) && fs.statSync(destPath).size > 0) {
    return false;
  }

  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.copyFileSync(sourcePath, destPath);
  return true;
}

function copyMissingLocaleFiles(sourceDir, destDir) {
  if (!fs.existsSync(sourceDir)) {
    throw new Error(`Electron dist directory is missing: ${sourceDir}`);
  }

  fs.mkdirSync(destDir, { recursive: true });
  let copied = 0;

  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.pak')) {
      continue;
    }

    const sourcePath = path.join(sourceDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (copyFileIfMissingOrEmpty(sourcePath, destPath)) {
      copied += 1;
    }
  }

  return copied;
}

function copyOptionalDefaultAppAsar(sourceDir, destDir) {
  const sourcePath = path.join(sourceDir, 'default_app.asar');
  const destPath = path.join(destDir, 'default_app.asar');
  if (!fs.existsSync(sourcePath)) {
    return false;
  }

  return copyFileIfMissingOrEmpty(sourcePath, destPath);
}

function ensureElectronRuntimeFiles(packagedAppDir, projectRoot = path.resolve(__dirname, '..')) {
  const electronDistDir = getElectronDistDir(projectRoot);
  if (!fs.existsSync(electronDistDir)) {
    throw new Error(`Electron dist folder not found: ${electronDistDir}`);
  }

  const copied = [];

  for (const fileName of [...REQUIRED_EXECUTABLE_ROOT_FILES, ...OPTIONAL_EXECUTABLE_ROOT_FILES]) {
    const sourcePath = path.join(electronDistDir, fileName);
    if (!fs.existsSync(sourcePath)) {
      continue;
    }

    const destPath = path.join(packagedAppDir, fileName);
    if (copyFileIfMissingOrEmpty(sourcePath, destPath)) {
      copied.push(fileName);
    }
  }

  const localesSource = path.join(electronDistDir, 'locales');
  const localesDest = path.join(packagedAppDir, 'locales');
  if (!fs.existsSync(localesSource)) {
    throw new Error(`Required Electron runtime directory missing from dist: ${localesSource}`);
  }

  const localeFilesCopied = copyMissingLocaleFiles(localesSource, localesDest);
  if (localeFilesCopied > 0) {
    copied.push(`locales/*.pak (${localeFilesCopied})`);
  }

  const resourcesDest = path.join(packagedAppDir, 'resources');
  const resourcesSource = path.join(electronDistDir, 'resources');
  if (copyOptionalDefaultAppAsar(resourcesSource, resourcesDest)) {
    copied.push('resources/default_app.asar');
  }

  for (const relativeChild of REQUIRED_RESOURCES_CHILDREN) {
    const destChild = path.join(packagedAppDir, 'resources', relativeChild);
    if (!fs.existsSync(destChild)) {
      throw new Error(
        `Packaged resources/${relativeChild.replace(/\\/g, '/')} is missing. Re-run electron-forge package.`,
      );
    }
  }

  return { copied, electronDistDir };
}

module.exports = {
  ensureElectronRuntimeFiles,
};

if (require.main === module) {
  const { findPackagedAppDir } = require('./lib/packaged-app-dir');
  const packagedAppDir = process.argv[2] || findPackagedAppDir();
  if (!packagedAppDir) {
    console.error('ENSURE FAILED: No packaged Windows app folder found under out/.');
    process.exit(1);
  }

  const result = ensureElectronRuntimeFiles(packagedAppDir);
  if (result.copied.length === 0) {
    console.log(`ENSURE OK: Electron runtime files already present in ${packagedAppDir}`);
  } else {
    console.log(`ENSURE OK: Copied missing runtime files into ${packagedAppDir}`);
    for (const entry of result.copied) {
      console.log(`  + ${entry}`);
    }
  }
}
