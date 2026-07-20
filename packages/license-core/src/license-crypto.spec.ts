import { generateKeyPairSync } from 'crypto';
import {
  addDays,
  createSignedLicenseKey,
  hashLicensePayload,
  isLicenseActiveOnDate,
  isLicenseExpiredOnDate,
  parseSignedLicenseKey,
  todayUtcDate,
  verifySignedLicenseKey,
} from './license-crypto';
import type { LicensePayload } from './license.types';

describe('@patrol/license-core', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

  const payload: LicensePayload = {
    version: 1,
    licenseId: 'PEL-2026-000001',
    companyName: 'ABC Security Ltd',
    plan: 'annual',
    issuedAt: '2026-07-13',
    startsAt: '2026-07-13',
    expiresAt: '2027-07-12',
    maxDevices: 1,
    features: ['collector'],
  };

  it('creates and verifies TG1 keys', () => {
    const key = createSignedLicenseKey(payload, privatePem);
    const result = verifySignedLicenseKey({
      licenseKey: key,
      publicKey,
      today: '2026-07-13',
    });
    expect(result.valid).toBe(true);
    expect(hashLicensePayload(payload)).toHaveLength(64);
  });

  it('treats expiresAt as inclusive for the full UTC day', () => {
    expect(isLicenseExpiredOnDate('2027-07-12', '2027-07-12')).toBe(false);
    expect(isLicenseExpiredOnDate('2027-07-12', '2027-07-13')).toBe(true);
    expect(isLicenseActiveOnDate('2026-07-13', '2027-07-12', '2027-07-12')).toBe(true);
  });

  it('rejects tampered payload segments', () => {
    const key = createSignedLicenseKey(payload, privatePem);
    const parsed = parseSignedLicenseKey(key)!;
    const tamperedPayload = JSON.parse(parsed.payloadBytes.toString('utf8')) as LicensePayload;
    tamperedPayload.companyName = 'Evil Co';
    const tampered = `TG1.${Buffer.from(JSON.stringify(tamperedPayload)).toString('base64url')}.${parsed.signatureSegment}`;
    const result = verifySignedLicenseKey({ licenseKey: tampered, publicKey, today: todayUtcDate() });
    expect(result.valid).toBe(false);
    expect(result.signatureValid).toBe(false);
  });

  it('adds days in UTC', () => {
    expect(addDays('2026-07-13', 365 - 1)).toBe('2027-07-12');
  });
});
