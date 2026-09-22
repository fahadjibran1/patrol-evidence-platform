const fs = require('fs');
const { createPublicKey } = require('crypto');
const {
  LICENCE_PRODUCT_NAME,
  parseSignedCommercialLicenceJson,
  verifyCommercialLicenceWithTrustRing,
} = require('@patrol/license-core');

function readPublicKey(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  const pem = fs.readFileSync(filePath, 'utf8');
  if (/PRIVATE KEY/i.test(pem)) throw new Error('Licence trust file contains private key material');
  const key = createPublicKey(pem);
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('Licence trust file must contain an Ed25519 public key');
  return key;
}

function validateBackedUpCommercialLicence({ licencePath, identityPath, legacyPublicKeyPath, onlinePublicKeyPath }) {
  const licence = parseSignedCommercialLicenceJson(fs.readFileSync(licencePath, 'utf8'));
  const identity = JSON.parse(fs.readFileSync(identityPath, 'utf8'));
  if (!licence || !identity?.installationId || !/^[a-f0-9]{64}$/i.test(identity?.machineFingerprint || '')) {
    throw new Error('Commercial licence backup identity is invalid');
  }
  const trustedKeys = [];
  const legacy = readPublicKey(legacyPublicKeyPath);
  if (legacy) trustedKeys.push({ keyId: 'vesoft-offline-v1', publicKey: legacy, policy: 'legacy-v1' });
  const online = readPublicKey(onlinePublicKeyPath);
  if (online) trustedKeys.push({ keyId: 'vesoft-online-v1', publicKey: online, policy: 'online-annual-v1' });
  const verificationDate = licence.payload.expiresAt || licence.payload.startsAt.slice(0, 10);
  const result = verifyCommercialLicenceWithTrustRing({
    licence,
    trustedKeys,
    installationId: identity.installationId,
    machineFingerprint: identity.machineFingerprint,
    today: verificationDate,
    expectedProduct: LICENCE_PRODUCT_NAME,
  });
  if (!result.valid || !result.signatureValid || !result.payload) {
    throw new Error('Commercial licence backup does not validate for this installation');
  }
  return true;
}

module.exports = { validateBackedUpCommercialLicence };
