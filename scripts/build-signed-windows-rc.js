const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const hookPath = path.join(__dirname, 'artifact-signing-hook.js');
const verificationScript = path.join(__dirname, 'verify-windows-signatures.ps1');
const manifestPath = path.join(projectRoot, 'out', 'private-rc-verification-manifest.json');
const azureCliDir = path.join(
  process.env.ProgramFiles || 'C:\\Program Files',
  'Microsoft SDKs',
  'Azure',
  'CLI2',
  'wbin',
);
const azureCliPythonPath = path.join(azureCliDir, '..', 'python.exe');

function run(command, args, env) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    env,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function main() {
  if (process.platform !== 'win32') {
    throw new Error('SIGNED_WINDOWS_RC_REQUIRES_WINDOWS');
  }

  const packageMetadata = JSON.parse(
    fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'),
  );
  const releaseVersion = packageMetadata.version;
  if (typeof releaseVersion !== 'string' || !/^\d+\.\d+\.\d+$/.test(releaseVersion)) {
    throw new Error('SIGNED_WINDOWS_RC_INVALID_PACKAGE_VERSION');
  }
  const expectedProductName =
    process.env.PATROLSAFE_COMMERCIAL_STAGING_BUILD === 'true'
      ? 'PatrolSafe by S4 STAGING'
      : 'PatrolSafe by S4';

  const env = {
    ...process.env,
    PATH: `${azureCliDir};${process.env.PATH || ''}`,
    PATROLSAFE_WINDOWS_RELEASE: 'rc',
    PATROLSAFE_WINDOWS_SIGN_HOOK: hookPath,
    PATROLSAFE_ARTIFACT_SIGNING_CORRELATION_ID:
      process.env.PATROLSAFE_ARTIFACT_SIGNING_CORRELATION_ID ||
      `patrolsafe-${releaseVersion}-private-rc-${new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14)}`,
  };

  console.log('SIGNED RC: verifying the authorized Azure CLI identity');
  run(
    azureCliPythonPath,
    ['-IBm', 'azure.cli', 'account', 'show', '--query', 'name', '-o', 'tsv'],
    env,
  );
  console.log('SIGNED RC: building exactly one Forge/Squirrel release candidate');
  run('cmd', ['/c', 'npm', 'run', 'desktop:make'], env);
  console.log('SIGNED RC: verifying final signatures and generating the private manifest');
  run(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      verificationScript,
      '-OutRoot',
      path.join(projectRoot, 'out'),
      '-ManifestPath',
      manifestPath,
      '-ExpectedReleaseVersion',
      releaseVersion,
      '-ExpectedProductName',
      expectedProductName,
      '-RequireInstaller',
    ],
    env,
  );
  console.log(`SIGNED_PRIVATE_RC_COMPLETE manifest=${manifestPath}`);
  console.log('SIGNED_PRIVATE_RC_PUBLISHED=NO');
}

main();
