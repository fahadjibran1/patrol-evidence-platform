import { createHash, generateKeyPairSync } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
  signCommercialLicencePayload,
  verifyCommercialLicenceWithTrustRing,
  type CommercialLicencePayload,
} from '@patrol/license-core';
import {
  LEGACY_PRODUCTION_SIGNING_KEY_ID,
  ONLINE_PRODUCTION_SIGNING_KEY_ID,
  ONLINE_PRODUCTION_PUBLIC_KEY_SHA256,
  loadLicensePublicKeyRing,
} from './license-public-key.util';

describe('production commercial desktop trust ring', () => {
  const originalEnv = { ...process.env };
  const legacy = generateKeyPairSync('ed25519');
  const online = generateKeyPairSync('ed25519');
  const staging = generateKeyPairSync('ed25519');
  const payload: CommercialLicencePayload = {
    version: 1,
    licenceId: 'lic-production-trust-test',
    installationId: 'install-production-trust-test',
    machineFingerprint: 'a'.repeat(64),
    companyName: 'Production Trust Test Ltd',
    plan: 'annual',
    issuedAt: '2026-09-29T10:00:00.000Z',
    startsAt: '2026-09-29',
    expiresAt: '2027-09-28',
    features: { whatsappMonitoring: true, guardSafe: true, evidence: true, alerts: true, incidents: true, exports: true },
    product: 'Patrol Evidence Platform',
    maxDevices: 1,
  };

  beforeEach(() => {
    process.env.LICENSE_PUBLIC_KEY = legacy.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    process.env.LICENSE_ONLINE_PUBLIC_KEY = online.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    process.env.LICENSE_ONLINE_PUBLIC_KEY_ID = ONLINE_PRODUCTION_SIGNING_KEY_ID;
    delete process.env.PATROLSAFE_COMMERCIAL_STAGING;
    delete process.env.PATROLSAFE_COMMERCIAL_STAGING_BUILD;
    delete process.env.PATROLSAFE_COMMERCIAL_PRODUCTION_BUILD;
  });

  afterAll(() => { process.env = { ...originalEnv }; });

  function verify(privateKey: string, overrides: Partial<CommercialLicencePayload> = {}) {
    return verifyCommercialLicenceWithTrustRing({
      licence: signCommercialLicencePayload({ ...payload, ...overrides }, privateKey),
      trustedKeys: loadLicensePublicKeyRing(),
      installationId: payload.installationId,
      machineFingerprint: payload.machineFingerprint,
      today: '2026-09-29',
      expectedProduct: 'Patrol Evidence Platform',
    });
  }

  it('verifies both legacy offline and authorised production online licences', () => {
    expect(loadLicensePublicKeyRing().map((entry) => entry.keyId)).toEqual([
      LEGACY_PRODUCTION_SIGNING_KEY_ID,
      ONLINE_PRODUCTION_SIGNING_KEY_ID,
    ]);
    expect(verify(legacy.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString())).toMatchObject({ valid: true, signingKeyId: LEGACY_PRODUCTION_SIGNING_KEY_ID });
    expect(verify(online.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString())).toMatchObject({ valid: true, signingKeyId: ONLINE_PRODUCTION_SIGNING_KEY_ID });
  });

  it('rejects staging, unknown, tampered, wrong-workstation, and expired licences', () => {
    expect(verify(staging.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString())).toMatchObject({ valid: false, signatureValid: false });
    const signed = signCommercialLicencePayload(payload, online.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString());
    expect(verifyCommercialLicenceWithTrustRing({ licence: { ...signed, signature: `${signed.signature.slice(0, -2)}aa` }, trustedKeys: loadLicensePublicKeyRing(), installationId: payload.installationId, machineFingerprint: payload.machineFingerprint, today: '2026-09-29' })).toMatchObject({ valid: false, signatureValid: false });
    expect(verifyCommercialLicenceWithTrustRing({ licence: signed, trustedKeys: loadLicensePublicKeyRing(), installationId: 'other-install', machineFingerprint: payload.machineFingerprint, today: '2026-09-29' })).toMatchObject({ valid: false, signatureValid: true });
    expect(verify(online.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), { issuedAt: '2025-09-29T10:00:00.000Z', startsAt: '2025-09-29', expiresAt: '2026-09-28' })).toMatchObject({ valid: false, signatureValid: true });
  });

  it('rejects test and unknown key IDs in a production desktop trust configuration', () => {
    process.env.LICENSE_ONLINE_PUBLIC_KEY_ID = 'test-phase6-online-key';
    expect(() => loadLicensePublicKeyRing()).toThrow(/not authorised/);
    process.env.LICENSE_ONLINE_PUBLIC_KEY_ID = 'vesoft-online-v2';
    expect(() => loadLicensePublicKeyRing()).toThrow(/not authorised/);
  });

  it('cannot switch a production build to staging trust through environment flags', () => {
    process.env.PATROLSAFE_COMMERCIAL_PRODUCTION_BUILD = 'true';
    process.env.PATROLSAFE_COMMERCIAL_STAGING = 'true';
    process.env.PATROLSAFE_COMMERCIAL_STAGING_BUILD = 'true';
    process.env.PATROLSAFE_COMMERCIAL_STAGING_KEY_ID = 'test-phase6-online-key';
    process.env.LICENSE_ONLINE_PUBLIC_KEY_ID = 'test-phase6-online-key';
    expect(() => loadLicensePublicKeyRing()).toThrow(/not authorised/);
  });

  it('loads the authorised packaged production key alongside legacy trust and no staging key', () => {
    process.env.LICENSE_ONLINE_PUBLIC_KEY = fs.readFileSync(
      path.resolve(__dirname, '..', '..', 'resources', 'license-online-public.pem'),
      'utf8',
    );
    process.env.PATROLSAFE_COMMERCIAL_PRODUCTION_BUILD = 'true';
    const ring = loadLicensePublicKeyRing();
    expect(ring.map((entry) => entry.keyId)).toEqual([
      LEGACY_PRODUCTION_SIGNING_KEY_ID,
      ONLINE_PRODUCTION_SIGNING_KEY_ID,
    ]);
    expect(ring.map((entry) => entry.keyId)).not.toContain('test-phase6-online-key');
    const onlineEntry = ring.find((entry) => entry.keyId === ONLINE_PRODUCTION_SIGNING_KEY_ID);
    const fingerprint = createHash('sha256')
      .update(onlineEntry!.publicKey.export({ type: 'spki', format: 'der' }))
      .digest('hex')
      .toUpperCase();
    expect(fingerprint).toBe(ONLINE_PRODUCTION_PUBLIC_KEY_SHA256);
  });

  it('rejects a substituted online public key in production build mode', () => {
    process.env.PATROLSAFE_COMMERCIAL_PRODUCTION_BUILD = 'true';
    expect(() => loadLicensePublicKeyRing()).toThrow(/fingerprint is not authorised/);
  });
});
