import { generateKeyPairSync } from 'crypto';
import {
  addDays,
  createSignedLicenseKey,
  isLicenseExpiredOnDate,
  verifySignedLicenseKey,
  type LicensePayload,
} from '@patrol/license-core';
import { deriveEffectiveStatus, mapPlanToCore, computeExpiresAt, allocateLicenseId } from '@/licences/licence.util';
import { LicensePlan, LicenseStatus } from '@prisma/client';

describe('licence.util', () => {
  it('maps plan enum to lowercase TG1 plan', () => {
    expect(mapPlanToCore(LicensePlan.ANNUAL)).toBe('annual');
    expect(mapPlanToCore(LicensePlan.TRIAL)).toBe('trial');
  });

  it('treats expiresAt as inclusive through end of UTC day', () => {
    expect(isLicenseExpiredOnDate('2027-07-12', '2027-07-12')).toBe(false);
    expect(isLicenseExpiredOnDate('2027-07-12', '2027-07-13')).toBe(true);
    expect(
      deriveEffectiveStatus({
        status: LicenseStatus.ACTIVE,
        startsAt: '2026-07-13',
        expiresAt: '2027-07-12',
        today: '2027-07-12',
      }),
    ).toBe('EXPIRING_SOON');
    expect(
      deriveEffectiveStatus({
        status: LicenseStatus.ACTIVE,
        startsAt: '2026-07-13',
        expiresAt: '2027-07-12',
        today: '2027-07-13',
      }),
    ).toBe('EXPIRED');
  });

  it('computes annual expiry inclusive of start day', () => {
    expect(computeExpiresAt('2026-07-13', LicensePlan.ANNUAL)).toBe(addDays('2026-07-13', 364));
  });

  it('generates TG1 keys accepted by license-core verifier', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
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

    const key = createSignedLicenseKey(payload, privatePem);
    const result = verifySignedLicenseKey({ licenseKey: key, publicKey, today: '2026-07-13' });
    expect(result.valid).toBe(true);
  });
});

describe('allocateLicenseId', () => {
  it('formats sequential values returned by the atomic SQL upsert', async () => {
    let next = 0;
    const tx = {
      $queryRaw: async <T>() => {
        next += 1;
        return [{ lastValue: next }] as T;
      },
    };

    const ids = await Promise.all([
      allocateLicenseId(tx, 2026),
      allocateLicenseId(tx, 2026),
      allocateLicenseId(tx, 2026),
    ]);

    expect(new Set(ids).size).toBe(3);
    expect(ids.sort()).toEqual(['PEL-2026-000001', 'PEL-2026-000002', 'PEL-2026-000003']);
  });
});
