const path = require('path');
const { createHash } = require('crypto');
const { validatePublicKeyFile } = require('./license-public-key.util');

const COMMERCIAL_PRODUCTION_KEY_ID = 'vesoft-online-v1';
const COMMERCIAL_PRODUCTION_PUBLIC_KEY_FILE = 'license-online-public.pem';
const COMMERCIAL_PRODUCTION_PUBLIC_KEY_SHA256 =
  'CEAA988A6B2AD61DA4323450B51FA56A18AF804881601DCF3F5FF03E78485F30';
const COMMERCIAL_STAGING_PUBLIC_KEY_SHA256 =
  '688340412959FBC23E8C3F0CB17BC6CFC2EE121254ACE2256D66216B2A512582';

function getTrackedProductionPublicKeyPath(projectRoot) {
  return path.join(projectRoot, 'resources', COMMERCIAL_PRODUCTION_PUBLIC_KEY_FILE);
}

function assertAuthorisedProductionFingerprint(
  derivedFingerprint,
  authorisedFingerprint = COMMERCIAL_PRODUCTION_PUBLIC_KEY_SHA256,
) {
  const derived = String(derivedFingerprint || '').trim().toUpperCase();
  const authorised = String(authorisedFingerprint || '').trim().toUpperCase();
  if (!/^[0-9A-F]{64}$/.test(authorised)) {
    throw new Error('COMMERCIAL_PRODUCTION_PUBLIC_KEY_AUTHORISATION_MISSING');
  }
  if (derived === COMMERCIAL_STAGING_PUBLIC_KEY_SHA256
    || authorised === COMMERCIAL_STAGING_PUBLIC_KEY_SHA256) {
    throw new Error('COMMERCIAL_PRODUCTION_STAGING_PUBLIC_KEY_REJECTED');
  }
  if (derived !== authorised || authorised !== COMMERCIAL_PRODUCTION_PUBLIC_KEY_SHA256) {
    throw new Error('COMMERCIAL_PRODUCTION_PUBLIC_KEY_FINGERPRINT_MISMATCH');
  }
}

function validateAuthorisedProductionPublicKeyFile(filePath) {
  const validation = validatePublicKeyFile(
    filePath,
    'authorised production online issuer public key',
  );
  const fingerprint = createHash('sha256')
    .update(validation.keyObject.export({ type: 'spki', format: 'der' }))
    .digest('hex')
    .toUpperCase();
  assertAuthorisedProductionFingerprint(fingerprint);
  return { ...validation, fingerprint };
}

module.exports = {
  COMMERCIAL_PRODUCTION_KEY_ID,
  COMMERCIAL_PRODUCTION_PUBLIC_KEY_FILE,
  COMMERCIAL_PRODUCTION_PUBLIC_KEY_SHA256,
  COMMERCIAL_STAGING_PUBLIC_KEY_SHA256,
  getTrackedProductionPublicKeyPath,
  assertAuthorisedProductionFingerprint,
  validateAuthorisedProductionPublicKeyFile,
};
