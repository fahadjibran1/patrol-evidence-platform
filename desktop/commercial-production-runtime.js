const fs = require('fs');
const path = require('path');
const { createHash, createPublicKey } = require('crypto');

const COMMERCIAL_PRODUCTION_CONFIG_FILE = 'patrolsafe-commercial-production.json';
const COMMERCIAL_PRODUCTION_PUBLIC_KEY_FILE = 'license-online-public.pem';
const COMMERCIAL_PRODUCTION_ORIGIN = 'https://licensing.sfour.co.uk';
const COMMERCIAL_PRODUCTION_KEY_ID = 'vesoft-online-v1';

function loadPackagedCommercialProductionRuntime(resourcesPath, io = fs) {
  const configPath = path.resolve(resourcesPath, COMMERCIAL_PRODUCTION_CONFIG_FILE);
  if (!io.existsSync(configPath)) return null;
  let config;
  try { config = JSON.parse(io.readFileSync(configPath, 'utf8')); }
  catch { throw new Error('Packaged commercial production configuration is invalid.'); }
  const expectedKeys = ['schemaVersion', 'production', 'serviceOrigin', 'purchaseOrigin', 'onlineKeyId', 'onlinePublicKeyFile', 'onlinePublicKeySha256'].sort();
  const actualKeys = Object.keys(config || {}).sort();
  if (actualKeys.length !== expectedKeys.length || actualKeys.some((key, index) => key !== expectedKeys[index])) {
    throw new Error('Packaged commercial production configuration contains unexpected fields.');
  }
  if (config.schemaVersion !== 1 || config.production !== true
    || config.serviceOrigin !== COMMERCIAL_PRODUCTION_ORIGIN
    || config.purchaseOrigin !== COMMERCIAL_PRODUCTION_ORIGIN
    || config.onlineKeyId !== COMMERCIAL_PRODUCTION_KEY_ID
    || config.onlinePublicKeyFile !== COMMERCIAL_PRODUCTION_PUBLIC_KEY_FILE
    || !/^[0-9A-F]{64}$/.test(config.onlinePublicKeySha256)) {
    throw new Error('Packaged commercial production configuration does not match the authorised production identity.');
  }
  const publicKeyPath = path.resolve(resourcesPath, COMMERCIAL_PRODUCTION_PUBLIC_KEY_FILE);
  const relative = path.relative(path.resolve(resourcesPath), publicKeyPath);
  if (relative.startsWith('..') || path.isAbsolute(relative) || !io.existsSync(publicKeyPath)) {
    throw new Error('Packaged commercial production public key is missing.');
  }
  const publicKeyPem = io.readFileSync(publicKeyPath, 'utf8');
  if (/PRIVATE KEY/i.test(publicKeyPem)) throw new Error('Packaged commercial production key must be public-only.');
  let publicKey;
  try { publicKey = createPublicKey(publicKeyPem); }
  catch { throw new Error('Packaged commercial production public key is invalid.'); }
  if (publicKey.asymmetricKeyType !== 'ed25519') {
    throw new Error('Packaged commercial production public key must be Ed25519.');
  }
  const fingerprint = createHash('sha256').update(publicKey.export({ type: 'spki', format: 'der' })).digest('hex').toUpperCase();
  if (fingerprint !== config.onlinePublicKeySha256) {
    throw new Error('Packaged commercial production public key fingerprint is not authorised.');
  }
  return Object.freeze({
    keyId: COMMERCIAL_PRODUCTION_KEY_ID,
    publicKeyFingerprintSha256: fingerprint,
    environment: Object.freeze({
      PATROLSAFE_COMMERCIAL_PRODUCTION_BUILD: 'true',
      PATROLSAFE_COMMERCIAL_SERVICE_ORIGIN: COMMERCIAL_PRODUCTION_ORIGIN,
      PATROLSAFE_COMMERCIAL_PURCHASE_ORIGIN: COMMERCIAL_PRODUCTION_ORIGIN,
      LICENSE_ONLINE_PUBLIC_KEY_FILE: publicKeyPath,
      LICENSE_ONLINE_PUBLIC_KEY_ID: COMMERCIAL_PRODUCTION_KEY_ID,
    }),
  });
}

function applyPackagedCommercialProductionRuntime({ packaged, resourcesPath, environment = process.env }) {
  if (!packaged) return null;
  const runtime = loadPackagedCommercialProductionRuntime(resourcesPath);
  if (!runtime) return null;
  Object.assign(environment, runtime.environment);
  return runtime;
}

module.exports = {
  COMMERCIAL_PRODUCTION_CONFIG_FILE,
  COMMERCIAL_PRODUCTION_PUBLIC_KEY_FILE,
  COMMERCIAL_PRODUCTION_ORIGIN,
  COMMERCIAL_PRODUCTION_KEY_ID,
  loadPackagedCommercialProductionRuntime,
  applyPackagedCommercialProductionRuntime,
};
