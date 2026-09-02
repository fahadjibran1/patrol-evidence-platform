import { generateKeyPairSync } from 'crypto';
import {
  addDays,
  createSignedLicenseKey,
  isLicenseExpiredOnDate,
  verifySignedLicenseKey,
  type LicensePayload,
} from '@patrol/license-core';
import {
  deriveEffectiveStatus,
  mapPlanToCore,
  computeExpiresAt,
  allocateLicenseId,
  addCalendarMonths,
  addCalendarYears,
  computeCalendarExpiresAt,
  computeRenewalWindow,
} from '@/licences/licence.util';
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

describe('addCalendarMonths', () => {
  it('adds whole calendar months without drifting on ordinary days', () => {
    expect(addCalendarMonths('2026-01-15', 1)).toBe('2026-02-15');
    expect(addCalendarMonths('2026-01-15', 3)).toBe('2026-04-15');
    expect(addCalendarMonths('2026-11-15', 2)).toBe('2027-01-15');
  });

  it('clamps day overflow to the last day of the shorter target month', () => {
    expect(addCalendarMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addCalendarMonths('2028-01-31', 1)).toBe('2028-02-29'); // 2028 is a leap year
    expect(addCalendarMonths('2026-03-31', 1)).toBe('2026-04-30');
  });

  it('supports negative offsets', () => {
    expect(addCalendarMonths('2026-03-15', -1)).toBe('2026-02-15');
    expect(addCalendarMonths('2026-01-15', -1)).toBe('2025-12-15');
  });
});

describe('addCalendarYears', () => {
  it('adds whole calendar years', () => {
    expect(addCalendarYears('2026-07-13', 1)).toBe('2027-07-13');
    expect(addCalendarYears('2026-07-13', 3)).toBe('2029-07-13');
  });

  it('clamps 29 Feb on a leap year to 28 Feb on a non-leap target year', () => {
    expect(addCalendarYears('2028-02-29', 1)).toBe('2029-02-28');
  });
});

describe('computeCalendarExpiresAt', () => {
  it('computes an inclusive one-month window', () => {
    expect(computeCalendarExpiresAt('2026-01-15', 'MONTHLY')).toBe('2026-02-14');
  });

  it('computes an inclusive one-year window', () => {
    expect(computeCalendarExpiresAt('2026-07-13', 'ANNUAL')).toBe('2027-07-12');
  });

  it('clamps month-end overflow before subtracting a day', () => {
    // Jan 31 + 1 calendar month clamps to Feb 28 (non-leap), then -1 day => Feb 27.
    expect(computeCalendarExpiresAt('2026-01-31', 'MONTHLY')).toBe('2026-02-27');
  });
});

describe('computeRenewalWindow', () => {
  it('continues immediately after the source expiry when it has not lapsed', () => {
    const window = computeRenewalWindow({
      renewalPeriod: 'ANNUAL',
      sourceExpiresAt: '2026-12-31',
      today: '2026-07-13',
    });
    expect(window.validFrom).toBe('2027-01-01');
    expect(window.validUntil).toBe('2027-12-31');
  });

  it('defaults validFrom to today when the source licence has already expired', () => {
    const window = computeRenewalWindow({
      renewalPeriod: 'MONTHLY',
      sourceExpiresAt: '2026-01-01',
      today: '2026-07-13',
    });
    expect(window.validFrom).toBe('2026-07-13');
    expect(window.validUntil).toBe('2026-08-12');
  });

  it('requires validFrom and validUntil for CUSTOM renewals', () => {
    expect(() =>
      computeRenewalWindow({ renewalPeriod: 'CUSTOM', sourceExpiresAt: '2026-12-31', today: '2026-07-13' }),
    ).toThrow('CUSTOM renewal requires validFrom and validUntil');

    const window = computeRenewalWindow({
      renewalPeriod: 'CUSTOM',
      sourceExpiresAt: '2026-12-31',
      today: '2026-07-13',
      validFrom: '2027-03-01',
      validUntil: '2027-03-31',
    });
    expect(window).toEqual({ validFrom: '2027-03-01', validUntil: '2027-03-31' });
  });

  it('honours an explicit validFrom override for MONTHLY/ANNUAL periods', () => {
    const window = computeRenewalWindow({
      renewalPeriod: 'ANNUAL',
      sourceExpiresAt: '2026-12-31',
      today: '2026-07-13',
      validFrom: '2027-06-01',
    });
    expect(window.validFrom).toBe('2027-06-01');
    expect(window.validUntil).toBe('2028-05-31');
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
