/**
 * Generates unique build metadata for every desktop package build.
 *
 * - displayBuild: human-readable 6-part UTC timestamp (About UI / licence request)
 * - windowsBuild: Electron/Windows FILEVERSION-safe 4-part version (max 4 components)
 *
 * package.json.version remains the product semver (e.g. 1.0.0) and must never be
 * overwritten with the timestamp display build.
 */
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const packageJsonPath = path.join(projectRoot, 'package.json');
const buildInfoPath = path.join(projectRoot, 'build-info.json');

function pad(value) {
  return String(value).padStart(2, '0');
}

/**
 * Windows / Electron accept at most 4 numeric version components, each 0–65535.
 * Format: YYYY.M.D.N where N = minutes since midnight UTC (0–1439).
 */
function buildWindowsPackageVersion(now) {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const day = now.getUTCDate();
  const revision = now.getUTCHours() * 60 + now.getUTCMinutes();
  return `${year}.${month}.${day}.${revision}`;
}

function buildDisplayBuild(now) {
  return [
    now.getUTCFullYear(),
    pad(now.getUTCMonth() + 1),
    pad(now.getUTCDate()),
    pad(now.getUTCHours()),
    pad(now.getUTCMinutes()),
    pad(now.getUTCSeconds()),
  ].join('.');
}

function assertWindowsBuildSafe(windowsBuild) {
  const parts = String(windowsBuild).split('.');
  if (parts.length < 1 || parts.length > 4) {
    throw new Error(
      `windowsBuild must have 1–4 numeric components for Electron (got ${windowsBuild}).`,
    );
  }

  for (const part of parts) {
    if (!/^\d+$/.test(part)) {
      throw new Error(`windowsBuild components must be numeric (got ${windowsBuild}).`);
    }
    const value = Number(part);
    if (value < 0 || value > 65535) {
      throw new Error(`windowsBuild component out of range 0–65535 (got ${windowsBuild}).`);
    }
  }
}

function main() {
  const now = new Date();
  const displayBuild = buildDisplayBuild(now);
  const windowsBuild = buildWindowsPackageVersion(now);
  assertWindowsBuildSafe(windowsBuild);

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  if (!packageJson.version || !/^\d+\.\d+\.\d+/.test(packageJson.version)) {
    throw new Error('package.json version must remain a product semver such as 1.0.0');
  }

  // Human-readable build for About / UI. Never used as Electron packager buildVersion.
  packageJson.buildId = displayBuild;
  packageJson.windowsBuild = windowsBuild;
  // Explicitly preserve product version.
  packageJson.version = packageJson.version.trim() || '1.0.0';

  fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');

  const buildInfo = {
    productName: packageJson.productName || 'Patrol Evidence Platform',
    version: packageJson.version,
    displayBuild,
    windowsBuild,
    // Back-compat alias for readers that still expect buildId.
    buildId: displayBuild,
    generatedAt: now.toISOString(),
  };
  fs.writeFileSync(buildInfoPath, `${JSON.stringify(buildInfo, null, 2)}\n`, 'utf8');

  const distDir = path.join(projectRoot, 'dist');
  if (fs.existsSync(distDir)) {
    fs.writeFileSync(path.join(distDir, 'build-info.json'), `${JSON.stringify(buildInfo, null, 2)}\n`, 'utf8');
  }

  console.log(
    `BUILD_METADATA version=${packageJson.version} displayBuild=${displayBuild} windowsBuild=${windowsBuild}`,
  );
}

main();

module.exports = {
  buildDisplayBuild,
  buildWindowsPackageVersion,
  assertWindowsBuildSafe,
};
