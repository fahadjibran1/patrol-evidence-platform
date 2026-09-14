import { generateKeyPairSync } from 'crypto';
import {
  canonicalizeJson,
  daysRemainingUntil,
  parseSignedCommercialLicenceJson,
  signCommercialLicencePayload,
  verifyCommercialLicence,
  type CommercialLicencePayload,
} from './index';

function createTestKeys() {
  return generateKeyPairSync('ed25519');
}

function samplePayload(overrides: Partial<CommercialLicencePayload> = {}): CommercialLicencePayload {
  return {
    version: 1,
    licenceId: 'lic-test-1',
    installationId: 'inst-1',
    machineFingerprint: 'a'.repeat(64),
    companyName: 'TechGuard Security Ltd',
    plan: 'annual',
    issuedAt: '2026-07-01',
    startsAt: '2026-07-01',
    expiresAt: '2027-07-01',
    features: {
      whatsappMonitoring: true,
      guardSafe: true,
      evidence: true,
      alerts: true,
      incidents: true,
      exports: true,
    },
    product: 'Patrol Evidence Platform',
    maxDevices: 1,
    ...overrides,
  };
}

describe('canonicalizeJson', () => {
  it('sorts object keys recursively', () => {
    expect(canonicalizeJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });
});

describe('commercial licence crypto', () => {
  const { privateKey, publicKey } = createTestKeys();
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

  it('accepts a valid signature', () => {
    const signed = signCommercialLicencePayload(samplePayload(), privatePem);
    const result = verifyCommercialLicence({
      licence: signed,
      publicKey,
      installationId: 'inst-1',
      machineFingerprint: 'a'.repeat(64),
      today: '2026-08-01',
    });
    expect(result.valid).toBe(true);
  });

  it('rejects a modified licence', () => {
    const signed = signCommercialLicencePayload(samplePayload(), privatePem);
    signed.payload.companyName = 'Tampered Co';
    const result = verifyCommercialLicence({
      licence: signed,
      publicKey,
      installationId: 'inst-1',
      machineFingerprint: 'a'.repeat(64),
      today: '2026-08-01',
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/signature/i);
  });

  it('rejects the wrong machine fingerprint', () => {
    const signed = signCommercialLicencePayload(samplePayload(), privatePem);
    const result = verifyCommercialLicence({
      licence: signed,
      publicKey,
      installationId: 'inst-1',
      machineFingerprint: 'b'.repeat(64),
      today: '2026-08-01',
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/workstation/i);
  });

  it('accepts a lifetime licence with expiresAt=null', () => {
    const signed = signCommercialLicencePayload(
      samplePayload({ plan: 'lifetime', expiresAt: null }),
      privatePem,
    );
    const result = verifyCommercialLicence({
      licence: signed,
      publicKey,
      installationId: 'inst-1',
      machineFingerprint: 'a'.repeat(64),
      today: '2099-01-01',
    });
    expect(result.valid).toBe(true);
    expect(daysRemainingUntil(null)).toBeNull();
  });

  it('continues to accept a valid previously issued three-year licence', () => {
    const signed = signCommercialLicencePayload(
      samplePayload({ plan: 'three_year', expiresAt: '2029-07-01' }),
      privatePem,
    );
    const result = verifyCommercialLicence({
      licence: signed,
      publicKey,
      installationId: 'inst-1',
      machineFingerprint: 'a'.repeat(64),
      today: '2028-07-01',
    });

    expect(result.valid).toBe(true);
  });

  it('rejects an expired commercial licence', () => {
    const signed = signCommercialLicencePayload(
      samplePayload({ startsAt: '2019-01-01', expiresAt: '2020-01-01' }),
      privatePem,
    );
    const result = verifyCommercialLicence({
      licence: signed,
      publicKey,
      installationId: 'inst-1',
      machineFingerprint: 'a'.repeat(64),
      today: '2026-08-01',
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/expired/i);
  });

  it('round-trips .tglic JSON', () => {
    const signed = signCommercialLicencePayload(samplePayload(), privatePem);
    const parsed = parseSignedCommercialLicenceJson(JSON.stringify(signed));
    expect(parsed?.payload.licenceId).toBe('lic-test-1');
  });
});
