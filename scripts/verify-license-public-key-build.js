const fs = require('fs');
const path = require('path');
const {
  assertNoPrivateKeysInPaths,
  getProjectRoot,
  getTrackedPublicKeyPath,
  logSafePublicKeyConfirmation,
  validatePublicKeyFile,
} = require('./lib/license-public-key.util');

function fail(message) {
  console.error(`LICENSE_PUBLIC_KEY_PACKAGE_VALIDATION_FAILED ${message}`);
  process.exit(1);
}

function main() {
  const projectRoot = getProjectRoot();
  const trackedPublicKeyPath = getTrackedPublicKeyPath(projectRoot);

  if (!fs.existsSync(trackedPublicKeyPath)) {
    fail(
      `Missing ${path.relative(projectRoot, trackedPublicKeyPath)}. Copy .license-keys/license-public.pem to resources/license-public.pem before release.`,
    );
  }

  let validation;
  try {
    validation = validatePublicKeyFile(trackedPublicKeyPath, 'resources/license-public.pem');
    assertNoPrivateKeysInPaths(
      [path.join(projectRoot, 'resources'), path.join(projectRoot, 'out')],
      'Release safety check',
    );
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }

  logSafePublicKeyConfirmation(trackedPublicKeyPath, validation.keyObject);
}

main();
