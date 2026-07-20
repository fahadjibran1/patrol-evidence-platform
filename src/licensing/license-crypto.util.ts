export {
  LICENSE_FORMAT_PREFIX,
  LICENSE_PAYLOAD_VERSION,
  LEGACY_TRIAL_REMOVAL_DATE,
  addDays,
  base64UrlDecode,
  base64UrlEncode,
  canonicalizeLicensePayloadJson,
  createSignedLicenseKey,
  diffDaysInclusive,
  hashLicensePayload,
  isLicenseActiveOnDate,
  isLicenseExpiredOnDate,
  loadPublicKeyFromPem,
  parseLicensePayloadFromBytes,
  parseSignedLicenseKey,
  signLicensePayloadBytes as signLicensePayload,
  validateLicensePayload,
  verifyLicenseSignature,
  verifySignedLicenseKey,
} from '@patrol/license-core';

export type { LicensePayload, LicensePlan, LicenseVerificationResult as CoreLicenseVerificationResult } from '@patrol/license-core';
