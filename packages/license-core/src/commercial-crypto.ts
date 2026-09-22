import { createHash, sign, verify, type KeyObject } from 'crypto';
import { canonicalizeJson } from './canonical-json';
import {
  ALL_LICENCE_FEATURES,
  COMMERCIAL_LICENCE_PAYLOAD_VERSION,
  type CommercialLicencePayload,
  type LicenceFeatures,
  type LicencePlan,
  type SignedCommercialLicence,
} from './commercial.types';
import { base64UrlDecode, base64UrlEncode, todayUtcDate } from './license-crypto';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z)?$/;
const COMMERCIAL_PLANS = new Set(['annual', 'three_year', 'lifetime']);

export function defaultFeaturesForPlan(plan: Exclude<LicencePlan, 'trial'>): LicenceFeatures {
  return { ...ALL_LICENCE_FEATURES };
}

export function canonicalizeCommercialPayload(payload: CommercialLicencePayload): string {
  return canonicalizeJson(payload);
}

export function hashCommercialPayload(payload: CommercialLicencePayload): string {
  return createHash('sha256').update(canonicalizeCommercialPayload(payload), 'utf8').digest('hex');
}

export function validateCommercialLicencePayload(payload: CommercialLicencePayload): string | null {
  if (payload.version !== COMMERCIAL_LICENCE_PAYLOAD_VERSION) {
    return 'Unsupported commercial licence payload version.';
  }

  if (!payload.licenceId?.trim()) {
    return 'Licence ID is required.';
  }

  if (!payload.installationId?.trim()) {
    return 'Installation ID is required.';
  }

  if (!payload.machineFingerprint?.trim() || !/^[a-f0-9]{64}$/i.test(payload.machineFingerprint)) {
    return 'Machine fingerprint must be a SHA-256 hex digest.';
  }

  if (!payload.companyName?.trim()) {
    return 'Company name is required.';
  }

  if (!COMMERCIAL_PLANS.has(payload.plan)) {
    return 'Licence plan must be annual, three_year, or lifetime.';
  }

  if (payload.plan === 'lifetime' && payload.expiresAt !== null) {
    return 'Lifetime licences must set expiresAt to null.';
  }

  if (payload.plan !== 'lifetime' && (payload.expiresAt === null || !DATE_PATTERN.test(payload.expiresAt))) {
    return 'Non-lifetime licences require expiresAt as YYYY-MM-DD.';
  }

  for (const field of ['issuedAt', 'startsAt'] as const) {
    if (
      !payload[field] ||
      (!ISO_PATTERN.test(payload[field]) && !DATE_PATTERN.test(payload[field]))
    ) {
      return `Invalid date format for ${field}.`;
    }
  }

  if (!DATE_PATTERN.test(payload.startsAt.slice(0, 10))) {
    return 'startsAt must begin with YYYY-MM-DD.';
  }

  if (!Number.isInteger(payload.maxDevices) || payload.maxDevices < 1) {
    return 'maxDevices must be at least 1.';
  }

  if (!payload.features || typeof payload.features !== 'object') {
    return 'Features object is required.';
  }

  for (const key of Object.keys(ALL_LICENCE_FEATURES) as (keyof LicenceFeatures)[]) {
    if (typeof payload.features[key] !== 'boolean') {
      return `Feature ${key} must be a boolean.`;
    }
  }

  if (!payload.product?.trim()) {
    return 'Product name is required.';
  }

  if (payload.expiresAt && payload.startsAt.slice(0, 10) > payload.expiresAt) {
    return 'startsAt must be on or before expiresAt.';
  }

  return null;
}

export function signCommercialLicencePayload(
  payload: CommercialLicencePayload,
  privateKeyPem: string,
): SignedCommercialLicence {
  const payloadError = validateCommercialLicencePayload(payload);
  if (payloadError) {
    throw new Error(payloadError);
  }

  const canonical = canonicalizeCommercialPayload(payload);
  const signatureBytes = sign(null, Buffer.from(canonical, 'utf8'), privateKeyPem);
  return {
    payload,
    signature: base64UrlEncode(signatureBytes),
  };
}

export function verifyCommercialLicenceSignature(
  licence: SignedCommercialLicence,
  publicKey: KeyObject,
): boolean {
  try {
    const canonical = canonicalizeCommercialPayload(licence.payload);
    const signatureBytes = base64UrlDecode(licence.signature);
    return verify(null, Buffer.from(canonical, 'utf8'), publicKey, signatureBytes);
  } catch {
    return false;
  }
}

export interface VerifyCommercialLicenceInput {
  licence: SignedCommercialLicence;
  publicKey: KeyObject | null;
  installationId: string;
  machineFingerprint: string;
  today?: string;
  clockToleranceHours?: number;
}

export interface CommercialLicenceVerificationResult {
  valid: boolean;
  reason?: string;
  payload?: CommercialLicencePayload;
  signatureValid?: boolean;
  signingKeyId?: string;
}

export interface CommercialLicenceTrustEntry {
  keyId: string;
  publicKey: KeyObject;
  /** New online issuers are deliberately narrower than the legacy offline issuer. */
  policy: 'legacy-v1' | 'online-annual-v1';
}

export interface VerifyCommercialLicenceWithTrustRingInput {
  licence: SignedCommercialLicence;
  trustedKeys: readonly CommercialLicenceTrustEntry[];
  installationId: string;
  machineFingerprint: string;
  today?: string;
  clockToleranceHours?: number;
  expectedProduct?: string;
}

export function verifyCommercialLicenceWithTrustRing(
  input: VerifyCommercialLicenceWithTrustRingInput,
): CommercialLicenceVerificationResult {
  if (!input.trustedKeys.length) {
    return { valid: false, reason: 'Licence public key is not configured on this installation.', signatureValid: false };
  }

  const matching = input.trustedKeys.filter((entry) =>
    verifyCommercialLicenceSignature(input.licence, entry.publicKey),
  );
  if (matching.length !== 1) {
    return { valid: false, reason: 'Licence signature is not trusted.', signatureValid: false };
  }

  const trusted = matching[0];
  const verification = verifyCommercialLicence({
    licence: input.licence,
    publicKey: trusted.publicKey,
    installationId: input.installationId,
    machineFingerprint: input.machineFingerprint,
    today: input.today,
    clockToleranceHours: input.clockToleranceHours,
  });
  if (!verification.valid || !verification.payload) {
    return { ...verification, signingKeyId: trusted.keyId };
  }

  if (trusted.policy === 'online-annual-v1') {
    if (verification.payload.product !== (input.expectedProduct ?? 'Patrol Evidence Platform')) {
      return {
        valid: false,
        reason: 'Licence product is not valid for PatrolSafe.',
        signatureValid: true,
        payload: verification.payload,
        signingKeyId: trusted.keyId,
      };
    }
    if (verification.payload.plan !== 'annual') {
      return {
        valid: false,
        reason: 'Online PatrolSafe licences must use the annual plan.',
        signatureValid: true,
        payload: verification.payload,
        signingKeyId: trusted.keyId,
      };
    }
  }

  return { ...verification, signingKeyId: trusted.keyId };
}

export function verifyCommercialLicence(
  input: VerifyCommercialLicenceInput,
): CommercialLicenceVerificationResult {
  if (!input.publicKey) {
    return { valid: false, reason: 'Licence public key is not configured on this installation.', signatureValid: false };
  }

  const payloadError = validateCommercialLicencePayload(input.licence.payload);
  if (payloadError) {
    return { valid: false, reason: payloadError, signatureValid: false };
  }

  const signatureValid = verifyCommercialLicenceSignature(input.licence, input.publicKey);
  if (!signatureValid) {
    return { valid: false, reason: 'Licence signature is not valid.', signatureValid: false };
  }

  const payload = input.licence.payload;

  if (payload.installationId !== input.installationId) {
    return {
      valid: false,
      reason: 'This licence is bound to a different installation ID.',
      signatureValid: true,
      payload,
    };
  }

  if (payload.machineFingerprint.toLowerCase() !== input.machineFingerprint.toLowerCase()) {
    return {
      valid: false,
      reason: 'This licence is bound to a different workstation.',
      signatureValid: true,
      payload,
    };
  }

  const today = input.today ?? todayUtcDate();
  const startsAt = payload.startsAt.slice(0, 10);
  const toleranceHours = input.clockToleranceHours ?? 48;

  if (startsAt > today) {
    const startMs = new Date(`${startsAt}T00:00:00.000Z`).getTime();
    const todayMs = new Date(`${today}T00:00:00.000Z`).getTime();
    if (startMs - todayMs > toleranceHours * 60 * 60 * 1000) {
      return { valid: false, reason: 'Licence is not yet valid.', signatureValid: true, payload };
    }
  }

  if (payload.expiresAt !== null && today > payload.expiresAt) {
    return { valid: false, reason: 'Licence has expired.', signatureValid: true, payload };
  }

  return { valid: true, signatureValid: true, payload };
}

export function parseSignedCommercialLicenceJson(raw: string): SignedCommercialLicence | null {
  try {
    const parsed = JSON.parse(raw) as SignedCommercialLicence;
    if (!parsed?.payload || typeof parsed.signature !== 'string') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function serializeSignedCommercialLicence(licence: SignedCommercialLicence): string {
  return `${canonicalizeJson(licence)}\n`;
}

export function daysRemainingUntil(expiresAt: string | null, today: string = todayUtcDate()): number | null {
  if (expiresAt === null) {
    return null;
  }

  const from = new Date(`${today}T00:00:00.000Z`).getTime();
  const to = new Date(`${expiresAt}T00:00:00.000Z`).getTime();
  return Math.max(0, Math.floor((to - from) / 86_400_000));
}
