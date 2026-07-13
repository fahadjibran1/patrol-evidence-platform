const fs = require('fs');
const path = require('path');
const { createPublicKey } = require('crypto');

const PUBLIC_KEY_FILE_NAMES = ['license-public.pem', 'license-public.key'];
const PRIVATE_KEY_MARKERS = [/PRIVATE KEY/i, /BEGIN ED25519 PRIVATE KEY/i];
const PRIVATE_KEY_FILENAME_PATTERNS = [
  /license-private/i,
  /\.private\.pem$/i,
  /private\.key$/i,
];

function getProjectRoot(projectRoot = path.resolve(__dirname, '..', '..')) {
  return projectRoot;
}

function getTrackedPublicKeyPath(projectRoot = getProjectRoot()) {
  return path.join(projectRoot, 'resources', 'license-public.pem');
}

function getDevelopmentFallbackPublicKeyPath(projectRoot = getProjectRoot()) {
  return path.join(projectRoot, '.license-keys', 'license-public.pem');
}

function readFileIfExists(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }

  const contents = fs.readFileSync(filePath, 'utf8').trim();
  return contents || null;
}

function assertNotPrivateKeyMaterial(contents, label = 'key file') {
  if (!contents) {
    return;
  }

  for (const pattern of PRIVATE_KEY_MARKERS) {
    if (pattern.test(contents)) {
      throw new Error(`${label} appears to contain a private key and must not be packaged or committed as a public key.`);
    }
  }
}

function validatePublicKeyPem(contents, label = 'public key') {
  if (!contents || !contents.trim()) {
    throw new Error(`${label} is empty.`);
  }

  assertNotPrivateKeyMaterial(contents, label);

  let keyObject;
  try {
    keyObject = createPublicKey(contents);
  } catch (error) {
    throw new Error(`${label} is not valid PEM: ${error instanceof Error ? error.message : String(error)}`);
  }

  const keyType = keyObject.asymmetricKeyType;
  if (keyType !== 'ed25519') {
    throw new Error(`${label} must be an Ed25519 public key (received ${keyType || 'unknown'}).`);
  }

  return keyObject;
}

function validatePublicKeyFile(filePath, label = filePath) {
  const contents = readFileIfExists(filePath);
  if (!contents) {
    throw new Error(`${label} is missing.`);
  }

  const keyObject = validatePublicKeyPem(contents, label);
  return { contents, keyObject };
}

function getPackagedPublicKeyCandidatePaths(packagedAppDir) {
  const resourcesPath = path.join(packagedAppDir, 'resources');
  const appPath = path.join(resourcesPath, 'app');

  const candidates = [];
  for (const fileName of PUBLIC_KEY_FILE_NAMES) {
    candidates.push(path.join(resourcesPath, fileName));
    candidates.push(path.join(resourcesPath, 'resources', fileName));
    candidates.push(path.join(appPath, 'resources', fileName));
  }

  return candidates;
}

function resolvePackagedPublicKeyPath(packagedAppDir) {
  for (const candidate of getPackagedPublicKeyCandidatePaths(packagedAppDir)) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function findPrivateKeyViolations(rootDir) {
  const violations = [];
  if (!rootDir || !fs.existsSync(rootDir)) {
    return violations;
  }

  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const nextPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git') {
          continue;
        }
        stack.push(nextPath);
        continue;
      }

      const baseName = entry.name.toLowerCase();
      if (PRIVATE_KEY_FILENAME_PATTERNS.some((pattern) => pattern.test(baseName))) {
        violations.push(nextPath);
        continue;
      }

      if (!/\.(pem|key)$/i.test(entry.name)) {
        continue;
      }

      const contents = readFileIfExists(nextPath);
      if (!contents) {
        continue;
      }

      if (PRIVATE_KEY_MARKERS.some((pattern) => pattern.test(contents))) {
        violations.push(nextPath);
      }
    }
  }

  return violations;
}

function assertNoPrivateKeysInPaths(paths, contextLabel) {
  const violations = [];
  for (const targetPath of paths) {
    violations.push(...findPrivateKeyViolations(targetPath));
  }

  if (violations.length > 0) {
    throw new Error(
      `${contextLabel} contains private key material:\n${violations.map((entry) => `  - ${entry}`).join('\n')}`,
    );
  }
}

function logSafePublicKeyConfirmation(filePath, keyObject) {
  const fingerprint = keyObject.export({ type: 'spki', format: 'der' });
  const preview = fingerprint.subarray(0, 4).toString('hex');
  console.log(`LICENSE_PUBLIC_KEY_BUILD_VALID path=${filePath} type=ed25519 fingerprintPrefix=${preview}`);
}

module.exports = {
  PUBLIC_KEY_FILE_NAMES,
  getProjectRoot,
  getTrackedPublicKeyPath,
  getDevelopmentFallbackPublicKeyPath,
  readFileIfExists,
  assertNotPrivateKeyMaterial,
  validatePublicKeyPem,
  validatePublicKeyFile,
  getPackagedPublicKeyCandidatePaths,
  resolvePackagedPublicKeyPath,
  findPrivateKeyViolations,
  assertNoPrivateKeysInPaths,
  logSafePublicKeyConfirmation,
};
