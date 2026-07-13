const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { findPackagedAppDir } = require('./lib/packaged-app-dir');
const {
  assertNoPrivateKeysInPaths,
  getProjectRoot,
  logSafePublicKeyConfirmation,
  resolvePackagedPublicKeyPath,
  validatePublicKeyFile,
} = require('./lib/license-public-key.util');

function fail(message) {
  console.error(`LICENSE_PUBLIC_KEY_PACKAGE_VALIDATION_FAILED ${message}`);
  process.exit(1);
}

function probeBackendRuntimeResolution(publicKeyPath, projectRoot) {
  const probeConfigPath = path.join(os.tmpdir(), `patrol-license-probe-${process.pid}.json`);
  fs.writeFileSync(
    probeConfigPath,
    JSON.stringify(
      {
        setupCompleted: true,
        companyName: 'Probe Company',
      },
      null,
      2,
    ),
    'utf8',
  );

  const runtimeUtilPath = path.join(projectRoot, 'dist', 'licensing', 'license-public-key.util.js');
  if (!fs.existsSync(runtimeUtilPath)) {
    fail(`Backend runtime util is missing at ${runtimeUtilPath}. Run npm run build first.`);
  }

  const probeScript = `
    process.env.LICENSE_PUBLIC_KEY_FILE = ${JSON.stringify(publicKeyPath)};
    process.env.PATROL_DESKTOP_PACKAGED = 'true';
    process.env.DESKTOP_CONFIG_PATH = ${JSON.stringify(probeConfigPath)};
    const util = require(${JSON.stringify(runtimeUtilPath)});
    const pem = util.resolveLicensePublicKeyPem();
    if (!pem) {
      console.error('LICENSE_PUBLIC_KEY_PACKAGE_VALIDATION_FAILED backend could not resolve public key');
      process.exit(1);
    }
    const key = util.loadLicensePublicKey();
    if (!key) {
      console.error('LICENSE_PUBLIC_KEY_PACKAGE_VALIDATION_FAILED backend could not load public key');
      process.exit(1);
    }
    console.log('LICENSE_PUBLIC_KEY_RUNTIME_PROBE_OK');
  `;

  const result = spawnSync(process.execPath, ['-e', probeScript], {
    cwd: projectRoot,
    encoding: 'utf8',
    windowsHide: true,
  });

  try {
    fs.rmSync(probeConfigPath, { force: true });
  } catch {
    // Ignore probe cleanup errors.
  }

  if (result.status !== 0) {
    const details = `${result.stderr || ''}${result.stdout || ''}`.trim();
    fail(details || 'Packaged backend public key runtime probe failed.');
  }

  if (!String(result.stdout || '').includes('LICENSE_PUBLIC_KEY_RUNTIME_PROBE_OK')) {
    fail('Packaged backend public key runtime probe did not confirm resolution.');
  }

  console.log('LICENSE_PUBLIC_KEY_RUNTIME_PROBE_OK');
}

function main() {
  const projectRoot = getProjectRoot();
  const packagedAppDir = process.argv[2]
    ? path.resolve(process.argv[2])
    : findPackagedAppDir(path.join(projectRoot, 'out'));

  if (!packagedAppDir) {
    fail('No packaged Windows app folder found under out/.');
  }

  const publicKeyPath = resolvePackagedPublicKeyPath(packagedAppDir);
  if (!publicKeyPath) {
    fail(`Packaged public key not found under ${packagedAppDir}. Expected resources/license-public.pem via Electron extraResource.`);
  }

  let validation;
  try {
    validation = validatePublicKeyFile(publicKeyPath, publicKeyPath);
    assertNoPrivateKeysInPaths([packagedAppDir, path.join(projectRoot, 'out')], 'Packaged output safety check');
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }

  console.log(`LICENSE_PUBLIC_KEY_PACKAGED path=${publicKeyPath}`);
  logSafePublicKeyConfirmation(publicKeyPath, validation.keyObject);
  probeBackendRuntimeResolution(publicKeyPath, projectRoot);
}

main();
