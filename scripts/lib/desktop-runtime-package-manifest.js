const fs = require('fs');
const path = require('path');

const LICENSE_CORE_RUNTIME_RELATIVE_PATH = path.join(
  'node_modules',
  '@patrol',
  'license-core',
);
const LICENSE_CORE_REQUIRED_FILES = Object.freeze(['package.json', path.join('dist', 'index.js')]);

function removeIfPresent(targetPath) {
  if (!fs.existsSync(targetPath)) {
    return false;
  }

  fs.rmSync(targetPath, { recursive: true, force: true });
  return true;
}

function listFiles(rootPath) {
  if (!fs.existsSync(rootPath)) {
    return [];
  }

  const files = [];
  const pending = [rootPath];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(entryPath);
      } else if (entry.isFile()) {
        files.push(entryPath);
      }
    }
  }
  return files;
}

function normalizeRelativePath(relativePath) {
  return String(relativePath).replace(/\\/g, '/');
}

function isTestOnlyLicenseCorePath(relativePath) {
  const normalized = normalizeRelativePath(relativePath).toLowerCase();
  return (
    normalized === 'jest.config.js' ||
    normalized === 'tsconfig.json' ||
    normalized.startsWith('src/') ||
    /(^|\/)[^/]+\.(?:spec|test)\.[^/]+$/.test(normalized) ||
    /(^|\/)__(?:tests|fixtures)__\//.test(normalized)
  );
}

function assertRuntimePackageManifest(buildPath) {
  const duplicateWorkspaceRoot = path.join(buildPath, 'packages');
  if (fs.existsSync(duplicateWorkspaceRoot)) {
    throw new Error(
      `DESKTOP_PACKAGE_MANIFEST_INVALID duplicate workspace tree present: ${duplicateWorkspaceRoot}`,
    );
  }

  const runtimeRoot = path.join(buildPath, LICENSE_CORE_RUNTIME_RELATIVE_PATH);
  for (const requiredFile of LICENSE_CORE_REQUIRED_FILES) {
    const requiredPath = path.join(runtimeRoot, requiredFile);
    if (!fs.existsSync(requiredPath) || !fs.statSync(requiredPath).isFile()) {
      throw new Error(
        `DESKTOP_PACKAGE_MANIFEST_INVALID required license-core runtime file missing: ${requiredPath}`,
      );
    }
  }

  const packageMetadata = JSON.parse(
    fs.readFileSync(path.join(runtimeRoot, 'package.json'), 'utf8'),
  );
  if (normalizeRelativePath(packageMetadata.main || '') !== 'dist/index.js') {
    throw new Error(
      `DESKTOP_PACKAGE_MANIFEST_INVALID license-core main must be dist/index.js, got ${packageMetadata.main || '<missing>'}`,
    );
  }

  const testOnlyFiles = listFiles(runtimeRoot)
    .map((filePath) => path.relative(runtimeRoot, filePath))
    .filter(isTestOnlyLicenseCorePath);
  if (testOnlyFiles.length > 0) {
    throw new Error(
      `DESKTOP_PACKAGE_MANIFEST_INVALID test-only license-core files present: ${testOnlyFiles
        .map(normalizeRelativePath)
        .join(', ')}`,
    );
  }

  return {
    runtimeRoot,
    requiredFiles: [...LICENSE_CORE_REQUIRED_FILES],
    fileCount: listFiles(runtimeRoot).length,
  };
}

function pruneDesktopRuntimeWorkspacePayload(buildPath) {
  const removed = [];
  const duplicateWorkspaceRoot = path.join(buildPath, 'packages');
  if (removeIfPresent(duplicateWorkspaceRoot)) {
    removed.push(path.relative(buildPath, duplicateWorkspaceRoot));
  }

  const runtimeRoot = path.join(buildPath, LICENSE_CORE_RUNTIME_RELATIVE_PATH);
  if (!fs.existsSync(runtimeRoot)) {
    throw new Error(
      `DESKTOP_PACKAGE_MANIFEST_INVALID license-core runtime package missing: ${runtimeRoot}`,
    );
  }

  for (const filePath of listFiles(runtimeRoot)) {
    const relativePath = path.relative(runtimeRoot, filePath);
    if (isTestOnlyLicenseCorePath(relativePath)) {
      fs.rmSync(filePath, { force: true });
      removed.push(path.join(LICENSE_CORE_RUNTIME_RELATIVE_PATH, relativePath));
    }
  }
  removeIfPresent(path.join(runtimeRoot, 'src'));

  return {
    removed,
    manifest: assertRuntimePackageManifest(buildPath),
  };
}

module.exports = {
  LICENSE_CORE_REQUIRED_FILES,
  LICENSE_CORE_RUNTIME_RELATIVE_PATH,
  assertRuntimePackageManifest,
  isTestOnlyLicenseCorePath,
  normalizeRelativePath,
  pruneDesktopRuntimeWorkspacePayload,
};
