import { createHash, createPrivateKey, createPublicKey, sign, verify, type KeyObject } from 'crypto';
import { LICENSE_FORMAT_PREFIX, type LicensePayload, type LicenseVerificationResult } from './license.types';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ALLOWED_PLANS = new Set(['trial', 'monthly', 'annual']);

export function canonicalizeLicensePayloadJson(payload: LicensePayload): string {
  return JSON.stringify(payload);
}

export function hashLicensePayload(payload: LicensePayload): string {
  return createHash('sha256').update(canonicalizeLicensePayloadJson(payload)).digest('hex');
}

export function base64UrlEncode(input: Buffer | string): string {
  const buffer = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buffer.toString('base64url');
}

export function base64UrlDecode(input: string): Buffer {
  return Buffer.from(input, 'base64url');
}

export function parseSignedLicenseKey(licenseKey: string): {
  payloadSegment: string;
  signatureSegment: string;
  payloadBytes: Buffer;
  signatureBytes: Buffer;
} | null {
  const trimmed = licenseKey.trim();
  const parts = trimmed.split('.');
  if (parts.length !== 3 || parts[0] !== LICENSE_FORMAT_PREFIX) {
    return null;
  }

  const [, payloadSegment, signatureSegment] = parts;
  if (!payloadSegment || !signatureSegment) {
    return null;
  }

  try {
    const payloadBytes = base64UrlDecode(payloadSegment);
    const signatureBytes = base64UrlDecode(signatureSegment);
    if (payloadBytes.length === 0 || signatureBytes.length === 0) {
      return null;
    }

    return { payloadSegment, signatureSegment, payloadBytes, signatureBytes };
  } catch {
    return null;
  }
}

export function validateLicensePayload(payload: LicensePayload): string | null {
  if (payload.version !== 1) {
    return 'Unsupported licence payload version.';
  }

  if (!payload.licenseId?.trim()) {
    return 'Licence ID is required.';
  }

  if (!payload.companyName?.trim()) {
    return 'Company name is required.';
  }

  if (!ALLOWED_PLANS.has(payload.plan)) {
    return 'Licence plan is not allowed.';
  }

  for (const field of ['issuedAt', 'startsAt', 'expiresAt'] as const) {
    if (!DATE_PATTERN.test(payload[field])) {
      return `Invalid date format for ${field}.`;
    }
  }

  if (!Number.isInteger(payload.maxDevices) || payload.maxDevices < 1) {
    return 'maxDevices must be at least 1.';
  }

  if (!Array.isArray(payload.features)) {
    return 'Features must be an array.';
  }

  if (payload.startsAt > payload.expiresAt) {
    return 'startsAt must be on or before expiresAt.';
  }

  return null;
}

export function verifyLicenseSignature(
  payloadBytes: Buffer,
  signatureBytes: Buffer,
  publicKey: KeyObject,
): boolean {
  return verify(null, payloadBytes, publicKey, signatureBytes);
}

export function signLicensePayloadBytes(payloadBytes: Buffer, privateKeyPem: string): Buffer {
  return sign(null, payloadBytes, createPrivateKey(privateKeyPem));
}

export function createSignedLicenseKey(payload: LicensePayload, privateKeyPem: string): string {
  const payloadBytes = Buffer.from(canonicalizeLicensePayloadJson(payload), 'utf8');
  const signatureBytes = signLicensePayloadBytes(payloadBytes, privateKeyPem);
  return `${LICENSE_FORMAT_PREFIX}.${base64UrlEncode(payloadBytes)}.${base64UrlEncode(signatureBytes)}`;
}

export function parseLicensePayloadFromBytes(payloadBytes: Buffer): LicensePayload | null {
  try {
    return JSON.parse(payloadBytes.toString('utf8')) as LicensePayload;
  } catch {
    return null;
  }
}

export interface VerifySignedLicenseInput {
  licenseKey: string;
  publicKey: KeyObject | null;
  today: string;
  clockToleranceHours?: number;
}

export function verifySignedLicenseKey(input: VerifySignedLicenseInput): LicenseVerificationResult {
  const parsed = parseSignedLicenseKey(input.licenseKey);
  if (!parsed) {
    return { valid: false, reason: 'Licence key format is not recognised.', signatureValid: false };
  }

  if (!input.publicKey) {
    return { valid: false, reason: 'Licence public key is not configured.', signatureValid: false };
  }

  const signatureValid = verifyLicenseSignature(parsed.payloadBytes, parsed.signatureBytes, input.publicKey);
  if (!signatureValid) {
    return { valid: false, reason: 'Licence signature is not valid.', signatureValid: false };
  }

  const payload = parseLicensePayloadFromBytes(parsed.payloadBytes);
  if (!payload) {
    return { valid: false, reason: 'Licence payload is not valid JSON.', signatureValid: true };
  }

  const payloadError = validateLicensePayload(payload);
  if (payloadError) {
    return { valid: false, reason: payloadError, signatureValid: true, payload };
  }

  const toleranceHours = input.clockToleranceHours ?? 48;
  const notYetValidReason = getNotYetValidReason(payload.startsAt, input.today, toleranceHours);
  if (notYetValidReason) {
    return { valid: false, reason: notYetValidReason, signatureValid: true, payload };
  }

  if (isLicenseExpiredOnDate(payload.expiresAt, input.today)) {
    return { valid: false, reason: 'Licence has expired.', signatureValid: true, payload };
  }

  return { valid: true, signatureValid: true, payload, legacy: false };
}

export function isLicenseExpiredOnDate(expiresAt: string, todayUtc: string): boolean {
  return todayUtc > expiresAt;
}

export function isLicenseActiveOnDate(startsAt: string, expiresAt: string, todayUtc: string): boolean {
  return todayUtc >= startsAt && !isLicenseExpiredOnDate(expiresAt, todayUtc);
}

function getNotYetValidReason(startsAt: string, today: string, clockToleranceHours: number): string | null {
  if (startsAt <= today) {
    return null;
  }

  const startMs = new Date(`${startsAt}T00:00:00.000Z`).getTime();
  const todayMs = new Date(`${today}T00:00:00.000Z`).getTime();
  const toleranceMs = clockToleranceHours * 60 * 60 * 1000;

  if (startMs - todayMs <= toleranceMs) {
    return null;
  }

  return 'Licence is not yet valid.';
}

export function diffDaysInclusive(fromDate: string, toDate: string): number {
  const from = new Date(`${fromDate}T00:00:00.000Z`);
  const to = new Date(`${toDate}T00:00:00.000Z`);
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1);
}

export function addDays(date: string, days: number): string {
  const next = new Date(`${date}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

export function todayUtcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function loadPublicKeyFromPem(publicKeyPem: string): KeyObject {
  return createPublicKey(publicKeyPem);
}

export function loadPrivateKeyFromPem(privateKeyPem: string): KeyObject {
  return createPrivateKey(privateKeyPem);
}

export function assertEd25519PrivateKey(privateKeyPem: string): KeyObject {
  const key = loadPrivateKeyFromPem(privateKeyPem);
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new Error('Signing key must be Ed25519.');
  }
  return key;
}

export function derivePublicKeyFromPrivate(privateKeyPem: string): KeyObject {
  const privateKey = assertEd25519PrivateKey(privateKeyPem);
  const publicKeyPem = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString();
  return createPublicKey(publicKeyPem);
}

export function maskSignedLicenseKey(licenseKey: string): string {
  const parsed = parseSignedLicenseKey(licenseKey);
  if (!parsed) {
    return 'TG1.[invalid]';
  }

  const payloadPreview = parsed.payloadSegment.slice(0, 8);
  const signaturePreview = parsed.signatureSegment.slice(-4);
  return `${LICENSE_FORMAT_PREFIX}.${payloadPreview}...${signaturePreview}`;
}
