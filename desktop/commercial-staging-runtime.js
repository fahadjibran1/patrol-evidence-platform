const fs = require('fs');
const path = require('path');
const { createHash, createPublicKey } = require('crypto');

const COMMERCIAL_STAGING_CONFIG_FILE = 'patrolsafe-commercial-staging.json';
const COMMERCIAL_STAGING_PUBLIC_KEY_FILE = 'patrolsafe-staging-ed25519-public.pem';
const COMMERCIAL_STAGING_ORIGIN = 'https://patrolsafe-commercial-staging.onrender.com';
const COMMERCIAL_STAGING_KEY_ID = 'test-phase6-online-key';

function assertExactObject(value, expectedKeys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} is invalid.`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} contains unexpected fields.`);
  }
}

function loadPackagedCommercialStagingRuntime(resourcesPath, io = fs) {
  const configPath = path.resolve(resourcesPath, COMMERCIAL_STAGING_CONFIG_FILE);
  if (!io.existsSync(configPath)) return null;

  let config;
  try {
    config = JSON.parse(io.readFileSync(configPath, 'utf8'));
  } catch {
    throw new Error('Packaged commercial staging configuration is invalid.');
  }
  assertExactObject(config, [
    'schemaVersion',
    'staging',
    'serviceOrigin',
    'purchaseOrigin',
    'onlineKeyId',
    'onlinePublicKeyFile',
  ], 'Packaged commercial staging configuration');
  if (
    config.schemaVersion !== 1
    || config.staging !== true
    || config.serviceOrigin !== COMMERCIAL_STAGING_ORIGIN
    || config.purchaseOrigin !== COMMERCIAL_STAGING_ORIGIN
    || config.onlineKeyId !== COMMERCIAL_STAGING_KEY_ID
    || config.onlinePublicKeyFile !== COMMERCIAL_STAGING_PUBLIC_KEY_FILE
  ) {
    throw new Error('Packaged commercial staging configuration does not match the authorised staging identity.');
  }

  const publicKeyPath = path.resolve(resourcesPath, COMMERCIAL_STAGING_PUBLIC_KEY_FILE);
  const relative = path.relative(path.resolve(resourcesPath), publicKeyPath);
  if (relative.startsWith('..') || path.isAbsolute(relative) || !io.existsSync(publicKeyPath)) {
    throw new Error('Packaged commercial staging public key is missing.');
  }
  const publicKeyPem = io.readFileSync(publicKeyPath, 'utf8');
  if (/PRIVATE KEY/i.test(publicKeyPem)) {
    throw new Error('Packaged commercial staging key must be public-only.');
  }
  let publicKey;
  try {
    publicKey = createPublicKey(publicKeyPem);
  } catch {
    throw new Error('Packaged commercial staging public key is invalid.');
  }
  if (publicKey.asymmetricKeyType !== 'ed25519') {
    throw new Error('Packaged commercial staging public key must be Ed25519.');
  }
  const fingerprint = createHash('sha256')
    .update(publicKey.export({ type: 'spki', format: 'der' }))
    .digest('hex');

  return Object.freeze({
    configPath,
    publicKeyPath,
    keyId: COMMERCIAL_STAGING_KEY_ID,
    publicKeyFingerprintSha256: fingerprint,
    environment: Object.freeze({
      PATROLSAFE_COMMERCIAL_STAGING: 'true',
      PATROLSAFE_COMMERCIAL_STAGING_BUILD: 'true',
      PATROLSAFE_COMMERCIAL_SERVICE_ORIGIN: COMMERCIAL_STAGING_ORIGIN,
      PATROLSAFE_COMMERCIAL_PURCHASE_ORIGIN: COMMERCIAL_STAGING_ORIGIN,
      LICENSE_ONLINE_PUBLIC_KEY_FILE: publicKeyPath,
      LICENSE_ONLINE_PUBLIC_KEY_ID: COMMERCIAL_STAGING_KEY_ID,
    }),
  });
}

function applyPackagedCommercialStagingRuntime({ packaged, resourcesPath, environment = process.env }) {
  if (!packaged) return null;
  const runtime = loadPackagedCommercialStagingRuntime(resourcesPath);
  if (!runtime) return null;
  Object.assign(environment, runtime.environment);
  return runtime;
}

module.exports = {
  COMMERCIAL_STAGING_CONFIG_FILE,
  COMMERCIAL_STAGING_PUBLIC_KEY_FILE,
  COMMERCIAL_STAGING_ORIGIN,
  COMMERCIAL_STAGING_KEY_ID,
  loadPackagedCommercialStagingRuntime,
  applyPackagedCommercialStagingRuntime,
};
