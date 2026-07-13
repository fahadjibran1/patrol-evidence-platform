import { generateKeyPairSync } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { LicensingService } from './licensing.service';
import { LicenseService } from './license.service';
import { createSignedLicenseKey } from './license-crypto.util';
import type { LicensePayload } from './license.types';
import { clearActivatedLicense } from './license-store.util';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import * as path from 'path';

describe('LicensingService', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

  const tempRoot = path.join(process.cwd(), 'tmp-licensing-service-tests', String(process.pid));
  const configPath = path.join(tempRoot, 'workspace-config.json');
  const dbPath = path.join(tempRoot, 'data', 'patrol-evidence.db');
  const originalDesktopConfigPath = process.env.DESKTOP_CONFIG_PATH;
  const originalPublicKey = process.env.LICENSE_PUBLIC_KEY;

  function createConfigService(overrides?: Record<string, unknown>): ConfigService {
    const config = {
      businessTimeZone: 'Europe/London',
      trialDays: 30,
      licenseSigningSecret: 'patrol-evidence-platform-license-secret',
      licenseClockToleranceHours: 48,
      ...overrides,
    };

    return {
      get: jest.fn((key: string) => config[key as keyof typeof config]),
    } as never;
  }

  function createServices(): LicensingService {
    const configService = createConfigService();
    return new LicensingService(configService, new LicenseService(configService));
  }

  beforeAll(() => {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    writeFileSync(dbPath, '');
  });

  beforeEach(() => {
    process.env.DESKTOP_CONFIG_PATH = configPath;
    process.env.LICENSE_PUBLIC_KEY = publicPem;
    mkdirSync(path.dirname(configPath), { recursive: true });
    rmSync(configPath, { force: true });
    clearActivatedLicense();
    jest.useFakeTimers().setSystemTime(new Date('2026-05-10T09:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
    clearActivatedLicense();
  });

  afterAll(() => {
    process.env.DESKTOP_CONFIG_PATH = originalDesktopConfigPath;
    process.env.LICENSE_PUBLIC_KEY = originalPublicKey;
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('accepts the development trial key and computes days remaining', () => {
    const service = createServices();
    const snapshot = service.getLicenseSnapshot('Tech Guards Security', {
      companyName: 'Tech Guards Security',
      licenseKey: 'TG-TRIAL-DEV',
    });

    expect(snapshot.status).toBe('ACTIVE');
    expect(snapshot.licenseType).toBe('TRIAL');
    expect(snapshot.daysRemaining).toBe(30);
    expect(snapshot.collectorAllowed).toBe(true);
    expect(snapshot.legacy).toBe(true);
  });

  it('rejects a key generated for a different company', () => {
    const service = createServices();
    const snapshot = service.getLicenseSnapshot('Tech Guards Security', {
      companyName: 'Tech Guards Security',
      licenseKey: 'TG-TRIAL-another-company-20260510-30-ABCDEF123456',
    });

    expect(snapshot.status).toBe('INVALID');
    expect(snapshot.collectorAllowed).toBe(false);
  });

  it('treats an old development trial as expired when stored dates are past', () => {
    const service = createServices();
    const snapshot = service.getLicenseSnapshot('Tech Guards Security', {
      companyName: 'Tech Guards Security',
      licenseKey: 'TG-TRIAL-DEV',
      trialStartDate: '2026-03-01',
      trialEndDate: '2026-03-30',
    });

    expect(snapshot.status).toBe('EXPIRED');
    expect(snapshot.collectorAllowed).toBe(false);
  });

  it('maps commercial TG1 licences to licensed snapshots', () => {
    const service = createServices();
    const payload: LicensePayload = {
      version: 1,
      licenseId: 'annual-001',
      companyName: 'ABC Security Ltd',
      plan: 'annual',
      issuedAt: '2026-05-10',
      startsAt: '2026-05-10',
      expiresAt: '2027-05-09',
      maxDevices: 1,
      features: ['collector'],
    };
    const licenseKey = createSignedLicenseKey(payload, privatePem);
    const activation = service.activateLicense('ABC Security Ltd', licenseKey, { companyName: 'ABC Security Ltd' });

    expect(activation.snapshot.status).toBe('ACTIVE');
    expect(activation.snapshot.displayMode).toBe('Licensed');
    expect(activation.snapshot.licenseType).toBe('ANNUAL');
    expect(existsSync(dbPath)).toBe(true);
  });
});
